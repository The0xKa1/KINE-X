import type { Page } from "../../core/Router.js";
import { formatCm } from "../../core/coordinates.js";
import { buildDiagnosisMessages, buildFallbackText, type CoachPersona } from "../../core/llm/buildPrompt.js";
import { streamChat, type ChatMessage, type LlmSettings } from "../../core/llm/LLMClient.js";
import { renderMarkdown } from "../../core/llm/renderMarkdown.js";
import { AiCoachPanel } from "../gameui/AiCoachPanel.js";
import type { ArchivedSession, SessionArchive } from "../../core/scoring/SessionArchive.js";
import type { SessionPhase } from "../../core/scoring/SessionRecorder.js";
import type { ExerciseConfig } from "../../types/motion.js";

interface ReportPageOptions {
  el: HTMLElement;
  archive: SessionArchive;
  exercises: Record<string, ExerciseConfig>;
  getLlmConfig: () => LlmSettings | null;
  getPersona: () => CoachPersona;
  onOpenSettings: () => void;
}

const PHASES: Array<{ key: SessionPhase; label: string }> = [
  { key: "intro", label: "INTRO" },
  { key: "mid", label: "MID" },
  { key: "peak", label: "PEAK" },
  { key: "outro", label: "OUTRO" },
];

/**
 * Full-page training report for one archived session: score, medal, joint
 * telemetry table, phase bars, history trend and the AI coach write-up.
 * Falls back to the latest session when no id is given.
 */
export class ReportPage implements Page {
  el: HTMLElement;
  private options: ReportPageOptions;
  private coach: AiCoachPanel | null = null;
  private diagnosisCache = new Map<string, string>();
  private chatBase: ChatMessage[] | null = null;
  private chatHistory: ChatMessage[] = [];
  private chatBusy = false;
  private chatAbort: AbortController | null = null;
  private diagnosisText = "";

  constructor(options: ReportPageOptions) {
    this.options = options;
    this.el = options.el;
  }

  enter(params: Record<string, string>): void {
    const sessionId = params.sessionId;
    const session =
      (sessionId ? this.options.archive.get(sessionId) : null) ?? this.options.archive.latest();
    this.render(session);
  }

  leave(): void {
    this.coach?.cancel();
    this.chatAbort?.abort();
    this.chatAbort = null;
  }

  private render(session: ArchivedSession | null): void {
    this.coach?.cancel();
    this.coach = null;
    this.chatAbort?.abort();
    this.chatAbort = null;
    this.chatBase = null;
    this.chatHistory = [];
    this.chatBusy = false;
    this.diagnosisText = "";
    if (!session) {
      this.el.innerHTML = `
        <div class="page-placeholder">
          <span class="eyebrow">03 · REPORT / 训练报告</span>
          <strong>还没有训练记录</strong>
          <button type="button" class="primary-button" data-go-train>去训练舱完成第一场 →</button>
        </div>
      `;
      this.el.querySelector("[data-go-train]")?.addEventListener("click", () => {
        window.location.hash = "#/train";
      });
      return;
    }

    const { summary } = session;
    const date = new Date(session.finishedAt);
    const dateLabel = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    // Percentile recomputed from the archive so older entries stay accurate.
    const others = this.options.archive.forExercise(session.exerciseId).filter((s) => s.id !== session.id);
    const beatText =
      others.length > 0
        ? `超过你历史 <b>${Math.round((others.filter((s) => s.score < session.score).length / others.length) * 100)}%</b> 的训练场次`
        : "你的第一场正式记录";

    const phaseRows = PHASES.map(({ key, label }) => {
      const value = summary.phaseAvgScores[key];
      const pct = Math.max(0, Math.min(100, Math.round(value)));
      const isWorst = summary.worstPhase === key;
      return `
        <div class="report-phase${isWorst ? " is-worst" : ""}">
          <span>${label}</span>
          <i style="width:${pct}%"></i>
          <b>${pct}</b>
        </div>
      `;
    }).join("");

    const jointRows = [...summary.joints]
      .sort((a, b) => a.avgScore - b.avgScore)
      .map(
        (joint) => `
        <div class="results-report-row${joint.riskHits > 0 ? " is-risk" : ""}">
          <span>${joint.name}</span>
          <b>${Math.round(joint.avgScore)}%</b>
          <b>${Math.round(joint.worstScore)}%</b>
          <span>${formatCm(joint.worstDistanceDeltaCm)}</span>
          <b class="report-risk">${joint.riskHits > 0 ? `×${joint.riskHits}` : "—"}</b>
        </div>
      `,
      )
      .join("");

    const trend = this.options.archive
      .forExercise(session.exerciseId)
      .slice(0, 10)
      .reverse();
    const trendBars = trend
      .map((s) => {
        const active = s.id === session.id ? " is-current" : "";
        return `<i class="${active.trim()}" style="height:${Math.max(6, Math.round(s.score))}%" title="${s.score}"></i>`;
      })
      .join("");

    this.el.innerHTML = `
      <div class="report-scroll">
        <header class="report-head">
          <div>
            <span class="eyebrow">03 · REPORT / SESSION ${session.id}</span>
            <h2>${session.exerciseName} · 训练报告</h2>
          </div>
          <div class="report-head-actions">
            <span class="report-date">${dateLabel}</span>
            <button type="button" class="report-delete-session" data-delete-report>删除本次记录</button>
          </div>
        </header>

        <section class="report-grid">
          <div class="report-score-card">
            <div class="report-score-big">${session.score}</div>
            <div class="report-score-label">SYNC SCORE</div>
            <div class="report-score-beat">${beatText}</div>
            <div class="report-medal">
              <span class="report-medal-stamp">印</span>
              <div><span>UNLOCKED MEDAL</span><b>${session.medalName}</b></div>
            </div>
          </div>
          <div class="report-side">
            <div class="report-stats">
              <div><span>Combo Max</span><b>×${session.bestCombo}</b></div>
              <div><span>Perfect</span><b>${session.perfectFrames}</b></div>
              <div><span>Avg Δ</span><b>${formatCm(session.avgDelta)}</b></div>
              <div><span>Risk Hits</span><b>${session.riskHits}</b></div>
            </div>
            <div class="report-phases">
              <div class="report-block-title">PHASE AVG <em>· 最差阶段标橙</em></div>
              ${phaseRows}
            </div>
            <div class="report-trend">
              <div class="report-block-title">RECENT SESSIONS <em>· ${trend.length} 场</em></div>
              <div class="report-trend-bars">${trendBars || "<span class=\"report-trend-empty\">—</span>"}</div>
            </div>
          </div>
        </section>

        <section class="results-report report-joints">
          <header class="results-report-head">
            <span>JOINT</span><span>AVG</span><span>WORST</span><span>Δ MAX</span><span>RISK</span>
          </header>
          <div class="results-report-rows">${jointRows}</div>
        </section>

        <section class="results-ai-card report-ai">
          <header class="results-ai-head">
            <span class="eyebrow">[ AI COACH DIAGNOSIS ]</span>
            <span id="reportAiStatus" class="results-ai-status">idle</span>
          </header>
          <p id="reportAiText" class="results-ai-text"></p>
          <div id="reportChatThread" class="report-chat-thread"></div>
          <div class="report-chat-input">
            <input id="reportChatInput" type="text" placeholder="追问你的教练：这个关节该怎么练？" autocomplete="off" />
            <button id="reportChatSend" class="secondary-button" type="button">发送</button>
          </div>
        </section>
      </div>
    `;

    const textEl = this.el.querySelector<HTMLElement>("#reportAiText");
    const statusEl = this.el.querySelector<HTMLElement>("#reportAiStatus");
    if (textEl && statusEl) {
      this.coach = new AiCoachPanel({
        root: this.el,
        textEl,
        statusEl,
        onOpenSettings: this.options.onOpenSettings,
      });
      this.runDiagnosis(session, this.coach);
    }
    this.el.querySelector<HTMLButtonElement>("[data-delete-report]")?.addEventListener("click", () => {
      const confirmed = window.confirm(`确定删除「${session.exerciseName}」这次训练记录吗？此操作无法撤销。`);
      if (!confirmed || !this.options.archive.remove(session.id)) return;
      this.diagnosisCache.delete(session.id);
      const next = this.options.archive.latest();
      window.history.replaceState(null, "", next ? `#/report/${next.id}` : "#/report");
      this.render(next);
    });
    this.bindChat(session);
  }

  private runDiagnosis(session: ArchivedSession, coach: AiCoachPanel): void {
    const exercise = this.options.exercises[session.exerciseId];
    if (exercise) {
      this.chatBase = buildDiagnosisMessages(exercise, session.summary, this.options.getPersona());
    }
    const cached = this.diagnosisCache.get(session.id);
    if (cached) {
      this.diagnosisText = cached;
      coach.renderStatic(cached, "cached");
      return;
    }
    if (!exercise || session.summary.frames === 0) {
      coach.renderStatic("本次训练数据不足，先完成一场完整跟练。", "no samples");
      return;
    }
    const fallback = buildFallbackText(exercise, session.summary);
    const config = this.options.getLlmConfig();
    if (!config) {
      coach.renderSetupRequired(fallback);
      return;
    }
    void coach
      .renderStreaming(
        (onDelta, signal) => streamChat(config, this.chatBase ?? [], onDelta, { signal }),
        fallback,
      )
      .then((text) => {
        if (text) {
          this.diagnosisCache.set(session.id, text);
          this.diagnosisText = text;
        }
      });
  }

  private bindChat(session: ArchivedSession): void {
    const input = this.el.querySelector<HTMLInputElement>("#reportChatInput");
    const send = this.el.querySelector<HTMLButtonElement>("#reportChatSend");
    if (!input || !send) return;
    const fire = () => {
      const question = input.value.trim();
      if (!question) return;
      input.value = "";
      void this.sendChat(session, question);
    };
    send.addEventListener("click", fire);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") fire();
    });
  }

  private async sendChat(session: ArchivedSession, question: string): Promise<void> {
    if (this.chatBusy) return;
    const thread = this.el.querySelector<HTMLElement>("#reportChatThread");
    if (!thread) return;
    this.chatBusy = true;
    this.chatAbort?.abort();
    const controller = new AbortController();
    this.chatAbort = controller;

    const userRow = document.createElement("div");
    userRow.className = "report-chat-row is-user";
    userRow.textContent = question;
    thread.appendChild(userRow);
    const botRow = document.createElement("div");
    botRow.className = "report-chat-row is-bot";
    thread.appendChild(botRow);
    thread.scrollTop = thread.scrollHeight;

    if (!this.chatBase) {
      botRow.textContent = "教练暂时缺少上下文，先完成一场训练再追问。";
      this.chatBusy = false;
      return;
    }
    const config = this.options.getLlmConfig();
    if (!config) {
      botRow.textContent = "请先在摄像头设置中填写赛后教练 API。";
      this.chatBusy = false;
      return;
    }

    const messages: ChatMessage[] = [
      ...this.chatBase,
      ...(this.diagnosisText ? [{ role: "assistant", content: this.diagnosisText } as ChatMessage] : []),
      ...this.chatHistory,
      { role: "user", content: question },
    ];

    let answer = "";
    try {
      answer = await streamChat(
        config,
        messages,
        (delta) => {
          answer += delta;
          botRow.innerHTML = renderMarkdown(answer);
          thread.scrollTop = thread.scrollHeight;
        },
        { signal: controller.signal },
      );
    } catch {
      if (!controller.signal.aborted) {
        botRow.textContent = "教练暂时不可用，请检查 API 配置、模型权限与浏览器跨域设置。";
      }
    }
    if (answer) {
      this.chatHistory.push({ role: "user", content: question });
      this.chatHistory.push({ role: "assistant", content: answer });
    }
    this.chatBusy = false;
  }
}
