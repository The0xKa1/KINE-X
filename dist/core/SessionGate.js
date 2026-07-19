






const DEFAULT_COUNTDOWN_SECONDS = 3;

export class SessionGate {
          bus          ;
          phase                        = "idle";
          countdownSeconds        ;
          countdownTimer = 0;
          countdownEndAt = 0;

  constructor(options                    ) {
    this.bus = options.bus;
    this.countdownSeconds = options.countdownSeconds ?? DEFAULT_COUNTDOWN_SECONDS;
  }

  getPhase()                        {
    return this.phase;
  }

  isActive()          {
    return this.phase === "active";
  }

  beginCountdown(source                                = "button")       {
    if (this.phase !== "idle" && this.phase !== "finished") return;
    this.cancelTimer();
    this.phase = "countdown";
    this.countdownEndAt = performance.now() + this.countdownSeconds * 1000;
    this.emit({ phase: "countdown", countdownSecondsLeft: this.countdownSeconds, source });

    const tick = ()       => {
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

  markActive(source                                = "system")       {
    this.phase = "active";
    this.emit({ phase: "active", source });
  }

  markFinished(source                                = "system")       {
    this.cancelTimer();
    this.phase = "finished";
    this.emit({ phase: "finished", source });
  }

  reset(source                                = "system")       {
    this.cancelTimer();
    this.phase = "idle";
    this.emit({ phase: "idle", source });
  }

          cancelTimer()       {
    if (this.countdownTimer) {
      window.clearTimeout(this.countdownTimer);
      this.countdownTimer = 0;
    }
  }

          emit(payload                     )       {
    this.bus.emit("session:state", payload);
  }
}
