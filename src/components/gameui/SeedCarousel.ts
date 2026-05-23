import type { EventBus } from "../../core/EventBus.js";
import { prefersReducedMotion } from "../../core/motionPrefs.js";
import type { ExerciseConfig, ExerciseId, MotionMode } from "../../types/motion.js";

interface SeedCarouselOptions {
  bus: EventBus;
  container: HTMLElement;
  headName: HTMLElement;
  exercises: Record<ExerciseId, ExerciseConfig>;
  order: ExerciseId[];
  modeButtons: HTMLButtonElement[];
  onSeedChange(exerciseId: ExerciseId): void;
  onModeChange(mode: MotionMode): void;
}

const tagFor: Record<string, string> = {
  Fitness: "FITNESS · 抖音热推",
  Strength: "STRENGTH · 训练营",
  Traditional: "TRADITIONAL · 国风",
  Dance: "DANCE · 街舞精选",
  Ball: "BALL · 校园联赛",
};

export class SeedCarousel {
  private options: SeedCarouselOptions;
  private cards = new Map<ExerciseId, HTMLButtonElement>();
  private activeId: ExerciseId | null = null;

  constructor(options: SeedCarouselOptions) {
    this.options = options;
    this.render();
    this.bindModes();
  }

  setActive(id: ExerciseId): void {
    this.activeId = id;
    this.cards.forEach((card, cardId) => {
      card.classList.toggle("is-active", cardId === id);
    });
    const exercise = this.options.exercises[id];
    if (exercise) this.options.headName.textContent = exercise.name;
    const card = this.cards.get(id);
    if (!card) return;
    const container = this.options.container;
    const target =
      card.offsetLeft - container.clientWidth / 2 + card.offsetWidth / 2;
    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    container.scrollTo({ left: Math.max(0, target), behavior });
  }

  setMode(mode: MotionMode): void {
    this.options.modeButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.mode === mode));
  }

  syncExercise(exercise: ExerciseConfig): void {
    this.setActive(exercise.id);
  }

  private render(): void {
    this.options.container.innerHTML = "";
    this.options.order.forEach((id) => {
      const exercise = this.options.exercises[id];
      const card = document.createElement("button");
      card.type = "button";
      card.className = "seed-card";
      card.dataset.id = id;
      card.setAttribute("role", "option");
      const tag = tagFor[exercise.discipline] ?? exercise.discipline.toUpperCase();
      card.innerHTML = `
        <div class="seed-tag">${tag}</div>
        <div class="seed-name">${exercise.name}</div>
        <div class="seed-meta">
          <span>${exercise.target}</span>
          <b>${exercise.durationSeconds.toFixed(1)}s</b>
        </div>
      `;
      card.addEventListener("click", () => {
        if (this.activeId === id) return;
        this.options.onSeedChange(id);
        this.options.bus.emit("pipeline:update", { runIndex: 1, latencyMs: 36, status: "busy" });
        window.setTimeout(() => {
          this.options.bus.emit("pipeline:update", { runIndex: 2, latencyMs: 42, status: "ready" });
        }, 460);
      });
      this.cards.set(id, card);
      this.options.container.appendChild(card);
    });
  }

  private bindModes(): void {
    this.options.modeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const mode = button.dataset.mode as MotionMode;
        this.options.onModeChange(mode);
        this.setMode(mode);
      });
    });
  }
}
