import type { PipelineUpdate, ScoreUpdate, SeedUpdate } from "../types/motion.js";

export type CameraErrorKind = "NotAllowed" | "NotFound" | "Overconstrained" | "Busy" | "Other";

export interface CameraErrorPayload {
  kind: CameraErrorKind;
  message: string;
}

export type SessionLifecyclePhase = "idle" | "countdown" | "active" | "finished";

export interface SessionStatePayload {
  phase: SessionLifecyclePhase;
  countdownSecondsLeft?: number;
  source?: "button" | "gesture" | "system";
}

export type GestureRecognizerPhase =
  | "disabled"
  | "no-hand"
  | "wrong-pose"
  | "holding"
  | "fired"
  | "cooldown";

export interface GestureMetrics {
  okPinch: number;
  midExt: number;
  ringExt: number;
  pinkyExt: number;
  indexExt: number;
  wristY: number;
  failedCheck:
    | "ok-pinch"
    | "mid-ext"
    | "ring-ext"
    | "pinky-ext"
    | "index-ext"
    | "wrist-low"
    | "palm-zero"
    | null;
}

export interface GestureProgressPayload {
  phase: GestureRecognizerPhase;
  holdProgress: number;
  handsCount: number;
  metrics?: GestureMetrics;
}

export interface AppEvents {
  "score:update": ScoreUpdate;
  "pipeline:update": PipelineUpdate;
  "seed:update": SeedUpdate;
  "camera:update": { active: boolean; mode: "mock" | "camera"; label: string };
  "camera:error": CameraErrorPayload;
  "session:state": SessionStatePayload;
  "session:gesture": GestureProgressPayload;
  "calibration:ready": { reason: "done" | "skip" | "profile" | "reset" };
}

export type AppEventName = keyof AppEvents;
export type AppEventHandler<T extends AppEventName> = (payload: AppEvents[T]) => void;

export class EventBus {
  private listeners: Map<AppEventName, Set<(payload: AppEvents[AppEventName]) => void>>;

  constructor() {
    this.listeners = new Map();
  }

  on<T extends AppEventName>(event: T, handler: AppEventHandler<T>): () => void {
    const bucket = this.listeners.get(event) ?? new Set();
    bucket.add(handler as (payload: AppEvents[AppEventName]) => void);
    this.listeners.set(event, bucket);

    return () => bucket.delete(handler as (payload: AppEvents[AppEventName]) => void);
  }

  emit<T extends AppEventName>(event: T, payload: AppEvents[T]): void {
    const bucket = this.listeners.get(event);
    if (!bucket) return;
    bucket.forEach((handler) => handler(payload));
  }
}
