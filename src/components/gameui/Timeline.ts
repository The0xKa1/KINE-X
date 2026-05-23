import type { EventBus } from "../../core/EventBus.js";
import { prefersReducedMotion } from "../../core/motionPrefs.js";
import type { CoachClip, ScoreUpdate } from "../../types/motion.js";

interface TimelineOptions {
  bus: EventBus;
  container: HTMLElement;
  label: HTMLElement;
  onScrub(progress: number): void;
}

const MOCK_FRAME_COUNT = 18;

export class Timeline {
  private options: TimelineOptions;
  private progress = 0;
  private clip: CoachClip | null = null;
  private buttons: HTMLButtonElement[] = [];
  private activeIndex = -1;
  private locked = false;

  constructor(options: TimelineOptions) {
    this.options = options;
    this.options.bus.on("score:update", (payload) => this.handle(payload));
    this.options.bus.on("session:state", (payload) => this.setLocked(payload.phase === "active"));
    this.build();
  }

  setLabel(text: string): void {
    this.options.label.textContent = text;
  }

  setClip(clip: CoachClip | null): void {
    this.clip = clip;
    this.build();
  }

  setLocked(locked: boolean): void {
    if (this.locked === locked) return;
    this.locked = locked;
    this.options.container.classList.toggle("is-locked", locked);
  }

  private handle(payload: ScoreUpdate): void {
    this.progress = payload.progress;
    this.updateActive();
  }

  private build(): void {
    const container = this.options.container;
    container.innerHTML = "";
    this.buttons = [];
    this.activeIndex = -1;

    const thumbs = this.clip?.thumbnails;
    const count = thumbs && thumbs.length > 0 ? thumbs.length : MOCK_FRAME_COUNT;
    const lastIndex = Math.max(1, count - 1);

    for (let index = 0; index < count; index += 1) {
      const frameProgress = index / lastIndex;
      const button = document.createElement("button");
      button.type = "button";
      const classes = ["timeline-frame"];
      if (thumbs) {
        classes.push("has-thumb");
        button.style.backgroundImage = `url("${thumbs[index]}")`;
      } else {
        const energy = 18 + Math.round((Math.sin(frameProgress * Math.PI * 2 - Math.PI / 5) + 1) * 22);
        button.style.setProperty("--energy", `${energy}px`);
        button.style.setProperty(
          "--timeline-color",
          energy > 52 ? "rgba(255, 180, 72, 0.58)" : "rgba(40, 217, 202, 0.52)",
        );
      }
      button.className = classes.join(" ");
      button.innerHTML = `<span>${String(index + 1).padStart(2, "0")}</span>`;
      button.addEventListener("click", () => {
        if (this.locked) return;
        this.options.onScrub(frameProgress);
      });
      container.appendChild(button);
      this.buttons.push(button);
    }
    this.updateActive();
  }

  private updateActive(): void {
    const count = this.buttons.length;
    if (count === 0) return;
    const lastIndex = Math.max(0, count - 1);
    const idx = Math.min(lastIndex, Math.max(0, Math.round(this.progress * lastIndex)));
    if (idx === this.activeIndex) return;
    if (this.activeIndex >= 0) {
      this.buttons[this.activeIndex]?.classList.remove("is-active");
    }
    const next = this.buttons[idx];
    if (next) {
      next.classList.add("is-active");
      this.scrollIntoView(next);
    }
    this.activeIndex = idx;
  }

  private scrollIntoView(button: HTMLButtonElement): void {
    const container = this.options.container;
    const cLeft = container.scrollLeft;
    const cRight = cLeft + container.clientWidth;
    const bLeft = button.offsetLeft;
    const bRight = bLeft + button.offsetWidth;
    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    if (bLeft < cLeft) {
      container.scrollTo({ left: bLeft, behavior });
    } else if (bRight > cRight) {
      container.scrollTo({ left: bRight - container.clientWidth, behavior });
    }
  }
}
