import { formatCm } from "../../core/coordinates.js";
import type { EventBus } from "../../core/EventBus.js";
import { modalA11y, type ModalA11yHandle } from "../../core/modalA11y.js";
import { prefersReducedMotion } from "../../core/motionPrefs.js";
import type { ExerciseConfig, ScoreUpdate } from "../../types/motion.js";
import type { SessionRecorder } from "../../core/scoring/SessionRecorder.js";
import type { AiCoachPanel } from "./AiCoachPanel.js";
import { buildDiagnosisMessages, buildFallbackText, type CoachPersona } from "../../core/llm/buildPrompt.js";
import { streamChat } from "../../core/llm/LLMClient.js";
import type { SessionArchive } from "../../core/scoring/SessionArchive.js";

interface ResultsScreenOptions {
  bus: EventBus;
  root: HTMLElement;
  closeButton: HTMLElement;
  scoreEl: HTMLElement;
  beatEl: HTMLElement;
  comboEl: HTMLElement;
  perfectEl: HTMLElement;
  deltaEl: HTMLElement;
  riskEl: HTMLElement;
  jointsEl: HTMLElement;
  medalEl: HTMLElement;
  titleEl: HTMLElement;
  exportButton: HTMLElement;
  onExport(): void;
  onClose?(): void;
  getStats(): { bestCombo: number; perfectFrames: number };
  exercises: Record<string, ExerciseConfig>;
  sessionRecorder: SessionRecorder;
  sessionArchive: SessionArchive;
  aiCoach: AiCoachPanel;
  getPersona(): CoachPersona;
}

const MEDALS: Record<string, string> = {
  squat: "重心掌控者",
};

export class ResultsScreen {
  private options: ResultsScreenOptions;
  private latest: ScoreUpdate | null = null;
  private currentExercise: string = "squat";
  private rollingScore: number[] = [];
  private rollingDelta: number[] = [];
  private riskHits = 0;
  private a11y: ModalA11yHandle;
  private lastDiagnosis: { key: string; text: string } | null = null;
  private animationHandles: number[] = [];

  constructor(options: ResultsScreenOptions) {
    this.options = options;
    this.a11y = modalA11y({
      root: this.options.root,
      onEscape: () => this.close(),
      initialFocus: () => this.options.closeButton as HTMLElement,
    });
    this.options.bus.on("score:update", (payload) => this.handle(payload));
    this.options.closeButton.addEventListener("click", () => this.close());
    this.options.exportButton.addEventListener("click", () => this.options.onExport());
    this.options.root.addEventListener("click", (event) => {
      if (event.target === this.options.root) this.close();
    });
  }

  setExercise(id: string): void {
    this.currentExercise = id;
    this.rollingScore = [];
    this.rollingDelta = [];
    this.riskHits = 0;
    this.lastDiagnosis = null;
  }

  open(): void {
    if (!this.latest) return;
    const score = Math.round(this.latest.score);
    const stats = this.options.getStats();
    const beat = Math.min(99, Math.max(40, Math.round(60 + (score - 60) * 1.6)));
    const avgDelta = average(this.rollingDelta);
    const combo = stats.bestCombo || this.latest.combo;

    this.cancelAnimations();
    this.options.titleEl.textContent = `本次动作匹配度 ${score}%`;
    this.options.medalEl.textContent = MEDALS[this.currentExercise] ?? "限定数字勋章";

    this.options.sessionArchive.add({
      id: String(Date.now()),
      exerciseId: this.currentExercise,
      exerciseName: this.options.exercises[this.currentExercise]?.name ?? this.currentExercise,
      finishedAt: Date.now(),
      score,
      beat,
      bestCombo: combo,
      perfectFrames: stats.perfectFrames,
      avgDelta,
      riskHits: this.riskHits,
      medalName: MEDALS[this.currentExercise] ?? "限定数字勋章",
      summary: this.options.sessionRecorder.snapshot(),
    });

    this.options.root.classList.add("is-open");
    this.options.root.setAttribute("aria-hidden", "false");
    this.a11y.activate();

    this.animateNumber(this.options.scoreEl, 0, score, 720, (v) => String(Math.round(v)));
    this.animateNumber(this.options.beatEl, 0, beat, 760, (v) => `${Math.round(v)}%`);
    this.animateNumber(this.options.comboEl, 0, combo, 640, (v) => `×${Math.round(v)}`);
    this.animateNumber(this.options.perfectEl, 0, stats.perfectFrames, 680, (v) => String(Math.round(v)));
    this.animateNumber(this.options.deltaEl, 0, avgDelta, 720, (v) => formatCm(v));
    this.animateNumber(this.options.riskEl, 0, this.riskHits, 600, (v) => String(Math.round(v)));

    this.renderJointReport();
    this.runDiagnosis();
  }

  private renderJointReport(): void {
    const { joints } = this.options.sessionRecorder.snapshot();
    const container = this.options.jointsEl;
    container.innerHTML = "";
    const sorted = [...joints].sort((a, b) => a.avgScore - b.avgScore);
    for (const joint of sorted) {
      const row = document.createElement("div");
      row.className = `results-report-row${joint.riskHits > 0 ? " is-risk" : ""}`;
      row.innerHTML = `
        <span>${joint.name}</span>
        <b>${Math.round(joint.avgScore)}%</b>
        <b>${Math.round(joint.worstScore)}%</b>
        <span>${formatCm(joint.worstDistanceDeltaCm)}</span>
        <b class="report-risk">${joint.riskHits > 0 ? `×${joint.riskHits}` : "—"}</b>
      `;
      container.appendChild(row);
    }
  }

  close(): void {
    if (!this.options.root.classList.contains("is-open")) return;
    this.cancelAnimations();
    this.options.aiCoach.cancel();
    this.options.root.classList.remove("is-open");
    this.options.root.setAttribute("aria-hidden", "true");
    this.a11y.deactivate();
    this.options.onClose?.();
  }

  private animateNumber(
    el: HTMLElement,
    from: number,
    to: number,
    durationMs: number,
    format: (value: number) => string,
  ): void {
    if (prefersReducedMotion() || durationMs <= 0) {
      el.textContent = format(to);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = from + (to - from) * eased;
      el.textContent = format(value);
      if (t < 1) {
        const handle = requestAnimationFrame(tick);
        this.animationHandles.push(handle);
      }
    };
    const handle = requestAnimationFrame(tick);
    this.animationHandles.push(handle);
  }

  private cancelAnimations(): void {
    for (const handle of this.animationHandles) cancelAnimationFrame(handle);
    this.animationHandles = [];
  }

  private runDiagnosis(): void {
    const exercise = this.options.exercises[this.currentExercise];
    const summary = this.options.sessionRecorder.snapshot();
    const fallback = buildFallbackText(exercise, summary);
    if (summary.frames === 0) {
      this.options.aiCoach.renderStatic(fallback, "no samples");
      return;
    }
    const cacheKey = summaryCacheKey(this.currentExercise, summary);
    if (this.lastDiagnosis && this.lastDiagnosis.key === cacheKey) {
      this.options.aiCoach.renderStatic(this.lastDiagnosis.text, "cached");
      return;
    }
    const messages = buildDiagnosisMessages(exercise, summary, this.options.getPersona());
    void this.options.aiCoach
      .renderStreaming(
        (onDelta, signal) => streamChat(messages, onDelta, { signal }),
        fallback,
      )
      .then((text) => {
        if (text) this.lastDiagnosis = { key: cacheKey, text };
      });
  }

  private handle(payload: ScoreUpdate): void {
    this.latest = payload;
    this.rollingScore.push(payload.score);
    if (this.rollingScore.length > 240) this.rollingScore.shift();
    const avgDelta =
      payload.metrics.reduce((sum, m) => sum + m.distanceDeltaCm, 0) / Math.max(1, payload.metrics.length);
    this.rollingDelta.push(avgDelta);
    if (this.rollingDelta.length > 240) this.rollingDelta.shift();
    if (payload.metrics.some((m) => m.risk === "risk")) this.riskHits += 1;
  }
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function summaryCacheKey(exerciseId: string, summary: ReturnType<SessionRecorder["snapshot"]>): string {
  const joints = summary.joints
    .map((j) => `${j.id}:${j.avgScore.toFixed(1)}`)
    .join(",");
  return [
    exerciseId,
    summary.frames,
    summary.avgScore.toFixed(2),
    summary.worstFrameScore.toFixed(2),
    summary.worstPhase,
    joints,
  ].join("|");
}
