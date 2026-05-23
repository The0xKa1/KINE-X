import { formatCm } from "../../core/coordinates.js";
import type { EventBus } from "../../core/EventBus.js";
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

  constructor(options: ResultsScreenOptions) {
    this.options = options;
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
  }

  open(): void {
    if (!this.latest) return;
    const score = Math.round(this.latest.score);
    const stats = this.options.getStats();
    const beat = Math.min(99, Math.max(40, Math.round(60 + (score - 60) * 1.6)));
    const avgDelta = average(this.rollingDelta);

    this.options.scoreEl.textContent = String(score);
    this.options.titleEl.textContent = `本次动作匹配度 ${score}%`;
    this.options.beatEl.textContent = `${beat}%`;
    this.options.comboEl.textContent = `×${stats.bestCombo || this.latest.combo}`;
    this.options.perfectEl.textContent = String(stats.perfectFrames);
    this.options.deltaEl.textContent = formatCm(avgDelta);
    this.options.riskEl.textContent = String(this.riskHits);
    this.options.medalEl.textContent = MEDALS[this.currentExercise] ?? "限定数字勋章";

    this.options.root.classList.add("is-open");
    this.options.root.setAttribute("aria-hidden", "false");

    this.runDiagnosis();
  }

  close(): void {
    this.options.aiCoach.cancel();
    this.options.root.classList.remove("is-open");
    this.options.root.setAttribute("aria-hidden", "true");
  }

  private runDiagnosis(): void {
    const exercise = this.options.exercises[this.currentExercise];
    const summary = this.options.sessionRecorder.snapshot();
    const fallback = buildFallbackText(exercise, summary);
    if (summary.frames === 0) {
      this.options.aiCoach.renderStatic(fallback, "no samples");
      return;
    }
    const config = this.options.getLlmConfig();
    if (!config) {
      this.options.aiCoach.renderStatic(fallback);
      return;
    }
    const messages = buildDiagnosisMessages(exercise, summary, this.options.getPersona());
    void this.options.aiCoach.renderStreaming(
      (onDelta, signal) => streamChat(config, messages, onDelta, { signal }),
      fallback,
    );
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
