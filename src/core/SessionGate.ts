import type { EventBus, SessionLifecyclePhase, SessionStatePayload } from "./EventBus.js";

interface SessionGateOptions {
  bus: EventBus;
  countdownSeconds?: number;
}

const DEFAULT_COUNTDOWN_SECONDS = 3;

export class SessionGate {
  private bus: EventBus;
  private phase: SessionLifecyclePhase = "idle";
  private countdownSeconds: number;
  private countdownTimer = 0;
  private countdownEndAt = 0;

  constructor(options: SessionGateOptions) {
    this.bus = options.bus;
    this.countdownSeconds = options.countdownSeconds ?? DEFAULT_COUNTDOWN_SECONDS;
  }

  getPhase(): SessionLifecyclePhase {
    return this.phase;
  }

  isActive(): boolean {
    return this.phase === "active";
  }

  beginCountdown(source: SessionStatePayload["source"] = "button"): void {
    if (this.phase !== "idle" && this.phase !== "finished") return;
    this.cancelTimer();
    this.phase = "countdown";
    this.countdownEndAt = performance.now() + this.countdownSeconds * 1000;
    this.emit({ phase: "countdown", countdownSecondsLeft: this.countdownSeconds, source });

    const tick = (): void => {
      const remainingMs = Math.max(0, this.countdownEndAt - performance.now());
      const secondsLeft = Math.ceil(remainingMs / 1000);
      if (this.phase !== "countdown") return;
      if (remainingMs <= 0) {
        this.cancelTimer();
        this.markActive(source);
        return;
      }
      this.emit({ phase: "countdown", countdownSecondsLeft: secondsLeft, source });
      this.countdownTimer = window.setTimeout(tick, remainingMs - (secondsLeft - 1) * 1000);
    };
    tick();
  }

  markActive(source: SessionStatePayload["source"] = "system"): void {
    this.phase = "active";
    this.emit({ phase: "active", source });
  }

  markFinished(source: SessionStatePayload["source"] = "system"): void {
    this.cancelTimer();
    this.phase = "finished";
    this.emit({ phase: "finished", source });
  }

  reset(source: SessionStatePayload["source"] = "system"): void {
    this.cancelTimer();
    this.phase = "idle";
    this.emit({ phase: "idle", source });
  }

  private cancelTimer(): void {
    if (this.countdownTimer) {
      window.clearTimeout(this.countdownTimer);
      this.countdownTimer = 0;
    }
  }

  private emit(payload: SessionStatePayload): void {
    this.bus.emit("session:state", payload);
  }
}
