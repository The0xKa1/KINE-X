import type { EventBus, GestureProgressPayload, SessionStatePayload } from "../../core/EventBus.js";
import type { SessionGate } from "../../core/SessionGate.js";

interface SessionStartOverlayOptions {
  bus: EventBus;
  gate: SessionGate;
  root: HTMLElement;
  idleSection: HTMLElement;
  countdownSection: HTMLElement;
  startButton: HTMLButtonElement;
  countdownNumber: HTMLElement;
  gestureValue: HTMLElement;
  gestureBar: HTMLElement;
  isCameraActive: () => boolean;
  isCalibrationReady: () => boolean;
  isClipReady: () => boolean;
}

const GESTURE_PHASE_LABEL: Record<GestureProgressPayload["phase"], string> = {
  disabled: "未启用",
  "no-hand": "等待手",
  "wrong-pose": "对镜头比 OK",
  holding: "保持…",
  fired: "已触发",
  cooldown: "冷却中",
};

export class SessionStartOverlay {
  private options: SessionStartOverlayOptions;
  private currentPhase: SessionStatePayload["phase"] = "idle";

  constructor(options: SessionStartOverlayOptions) {
    this.options = options;
    this.bindClick();
    options.bus.on("session:state", (payload) => this.applyState(payload));
    options.bus.on("camera:update", () => this.syncVisibility());
    options.bus.on("calibration:ready", () => this.syncVisibility());
    options.bus.on("seed:update", () => this.syncVisibility());
    options.bus.on("session:gesture", (state) => this.renderGesture(state));
    this.syncVisibility();
    this.renderGesture({ phase: "no-hand", holdProgress: 0, handsCount: 0 });
  }

  private bindClick(): void {
    this.options.startButton.addEventListener("click", () => {
      if (!this.canStart()) return;
      this.options.gate.beginCountdown("button");
    });
  }

  private applyState(payload: SessionStatePayload): void {
    this.currentPhase = payload.phase;
    if (payload.phase === "countdown") {
      this.showCountdown(payload.countdownSecondsLeft ?? 3);
    } else if (payload.phase === "idle") {
      this.showIdleIfReady();
    } else {
      this.hide();
    }
  }

  private showIdleIfReady(): void {
    const ready = this.canStart();
    const cameraOn = this.options.isCameraActive();
    const calibrated = this.options.isCalibrationReady();
    const clipReady = this.options.isClipReady();
    this.options.idleSection.hidden = false;
    this.options.countdownSection.hidden = true;
    this.options.countdownNumber.classList.remove("is-go");
    this.options.startButton.disabled = !ready;
    this.options.idleSection.dataset.blockReason = ready
      ? ""
      : !cameraOn
        ? "camera"
        : !calibrated
          ? "calibration"
          : !clipReady
            ? "clip"
            : "";
    this.options.root.classList.toggle("is-visible", cameraOn);
  }

  private showCountdown(secondsLeft: number): void {
    this.options.idleSection.hidden = true;
    this.options.countdownSection.hidden = false;
    const isGo = secondsLeft <= 0;
    this.options.countdownNumber.textContent = isGo ? "GO" : String(secondsLeft);
    this.options.countdownNumber.classList.toggle("is-go", isGo);
    this.options.root.classList.add("is-visible");
  }

  private hide(): void {
    this.options.root.classList.remove("is-visible");
  }

  private syncVisibility(): void {
    if (this.currentPhase === "idle") this.showIdleIfReady();
  }

  private canStart(): boolean {
    return (
      this.options.isCameraActive() &&
      this.options.isCalibrationReady() &&
      this.options.isClipReady()
    );
  }

  private renderGesture(state: GestureProgressPayload): void {
    const label = GESTURE_PHASE_LABEL[state.phase];
    const detail = describeGestureDetail(state);
    this.options.gestureValue.textContent = detail ? `${label} · ${detail}` : label;
    this.options.gestureValue.classList.toggle(
      "is-on",
      state.phase === "holding" || state.phase === "fired",
    );
    this.options.gestureValue.classList.toggle("is-warn", state.phase === "disabled");
    const pct = Math.round(state.holdProgress * 100);
    this.options.gestureBar.style.setProperty("--value", `${pct}%`);
    if (typeof window !== "undefined") {
      (window as unknown as { __holomotionGesture?: GestureProgressPayload }).__holomotionGesture = state;
    }
  }
}

function describeGestureDetail(state: GestureProgressPayload): string {
  if (!state.metrics) {
    if (state.phase === "wrong-pose") return "无 21 点";
    if (state.phase === "no-hand") return `${state.handsCount} 手`;
    return "";
  }
  const m = state.metrics;
  if (m.failedCheck === null) {
    return `pinch ${m.okPinch.toFixed(2)} · ext ${m.midExt.toFixed(2)}`;
  }
  switch (m.failedCheck) {
    case "ok-pinch":
      return `pinch ${m.okPinch.toFixed(2)} 太大`;
    case "mid-ext":
      return `中指 ${m.midExt.toFixed(2)}`;
    case "ring-ext":
      return `无名 ${m.ringExt.toFixed(2)}`;
    case "pinky-ext":
      return `小指 ${m.pinkyExt.toFixed(2)}`;
    case "index-ext":
      return `食指 ${m.indexExt.toFixed(2)}`;
    case "wrist-low":
      return `腕 y ${m.wristY.toFixed(2)}`;
    case "palm-zero":
      return "palm=0";
    default:
      return "";
  }
}
