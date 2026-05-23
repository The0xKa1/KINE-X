import { formatCm } from "../../core/coordinates.js";
import type { EventBus } from "../../core/EventBus.js";
import { modalA11y, type ModalA11yHandle } from "../../core/modalA11y.js";
import { prefersReducedMotion } from "../../core/motionPrefs.js";
import type { ExerciseConfig, ExerciseId, ScoreUpdate } from "../../types/motion.js";
import type { SessionRecorder } from "../../core/scoring/SessionRecorder.js";
import type { AiCoachPanel } from "./AiCoachPanel.js";
import { buildDiagnosisMessages, buildFallbackText, type CoachPersona } from "../../core/llm/buildPrompt.js";
import { streamChat, type LlmSettings } from "../../core/llm/LLMClient.js";

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
  medalEl: HTMLElement;
  titleEl: HTMLElement;
  exportButton: HTMLElement;
  onExport(): void;
  getStats(): { bestCombo: number; perfectFrames: number };
  exercises: Record<ExerciseId, ExerciseConfig>;
  sessionRecorder: SessionRecorder;
  aiCoach: AiCoachPanel;
  getLlmConfig(): LlmSettings | null;
  getPersona(): CoachPersona;
}

const MEDALS: Record<ExerciseId, string> = {
  squat: "重心掌控者",
  deadlift: "脊柱守护者",
  baduanjin: "太极初窥门径",
  street: "节奏掠夺者",
  basketball: "罚球线刺客",
};

export class ResultsScreen {
  private options: ResultsScreenOptions;
  private latest: ScoreUpdate | null = null;
  private currentExercise: ExerciseId = "squat";
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

  setExercise(id: ExerciseId): void {
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

    this.options.root.classList.add("is-open");
    this.options.root.setAttribute("aria-hidden", "false");
    this.a11y.activate();

    this.animateNumber(this.options.scoreEl, 0, score, 720, (v) => String(Math.round(v)));
    this.animateNumber(this.options.beatEl, 0, beat, 760, (v) => `${Math.round(v)}%`);
    this.animateNumber(this.options.comboEl, 0, combo, 640, (v) => `×${Math.round(v)}`);
    this.animateNumber(this.options.perfectEl, 0, stats.perfectFrames, 680, (v) => String(Math.round(v)));
    this.animateNumber(this.options.deltaEl, 0, avgDelta, 720, (v) => formatCm(v));
    this.animateNumber(this.options.riskEl, 0, this.riskHits, 600, (v) => String(Math.round(v)));

    this.runDiagnosis();
  }

  close(): void {
    this.cancelAnimations();
    this.options.aiCoach.cancel();
    this.options.root.classList.remove("is-open");
    this.options.root.setAttribute("aria-hidden", "true");
    this.a11y.deactivate();
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
    const config = this.options.getLlmConfig();
    if (!config) {
      this.options.aiCoach.renderStatic(fallback);
      return;
    }
    const messages = buildDiagnosisMessages(exercise, summary, this.options.getPersona());
    void this.options.aiCoach
      .renderStreaming(
        (onDelta, signal) => streamChat(config, messages, onDelta, { signal }),
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

function summaryCacheKey(exerciseId: ExerciseId, summary: ReturnType<SessionRecorder["snapshot"]>): string {
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
