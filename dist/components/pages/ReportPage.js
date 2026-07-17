                                                 
import { formatCm } from "../../core/coordinates.js";
import { buildDiagnosisMessages, buildFallbackText,                   } from "../../core/llm/buildPrompt.js";
import { streamChat } from "../../core/llm/LLMClient.js";
import { AiCoachPanel } from "../gameui/AiCoachPanel.js";
                                                                                            
                                                                          
                                                            

                             
                  
                          
                                            
                                 
 

const PHASES                                              = [
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
export class ReportPage                 {
  el             ;
          options                   ;
          coach                      = null;
          diagnosisCache = new Map                ();

  constructor(options                   ) {
    this.options = options;
    this.el = options.el;
  }

  enter(params                        )       {
    const sessionId = params.sessionId;
    const session =
      (sessionId ? this.options.archive.get(sessionId) : null) ?? this.options.archive.latest();
    this.render(session);
  }

  leave()       {
    this.coach?.cancel();
  }

          render(session                        )       {
    this.coach?.cancel();
    this.coach = null;
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
          <span class="report-date">${dateLabel}</span>
        </header>

        <section class="report-grid">
          <div class="report-score-card">
            <div class="report-score-big">${session.score}</div>
            <div class="report-score-label">SYNC SCORE</div>
            <div class="report-score-beat">击败了全球 <b>${session.beat}%</b> 的数字练习者</div>
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
        </section>
      </div>
    `;

    const textEl = this.el.querySelector             ("#reportAiText");
    const statusEl = this.el.querySelector             ("#reportAiStatus");
    if (textEl && statusEl) {
      this.coach = new AiCoachPanel({ root: this.el, textEl, statusEl });
      this.runDiagnosis(session, this.coach);
    }
  }

          runDiagnosis(session                 , coach              )       {
    const cached = this.diagnosisCache.get(session.id);
    if (cached) {
      coach.renderStatic(cached, "cached");
      return;
    }
    const exercise = this.options.exercises[session.exerciseId];
    if (!exercise || session.summary.frames === 0) {
      coach.renderStatic("本次训练数据不足，先完成一场完整跟练。", "no samples");
      return;
    }
    const fallback = buildFallbackText(exercise, session.summary);
    const messages = buildDiagnosisMessages(exercise, session.summary, this.options.getPersona());
    void coach
      .renderStreaming((onDelta, signal) => streamChat(messages, onDelta, { signal }), fallback)
      .then((text) => {
        if (text) this.diagnosisCache.set(session.id, text);
      });
  }
}
