import type { PipelineUpdate, ScoreUpdate, SeedUpdate } from "../types/motion.js";

export type CameraErrorKind = "NotAllowed" | "NotFound" | "Overconstrained" | "Busy" | "Other";

export interface CameraErrorPayload {
  kind: CameraErrorKind;
  message: string;
}

export interface AppEvents {
  "score:update": ScoreUpdate;
  "pipeline:update": PipelineUpdate;
  "seed:update": SeedUpdate;
  "camera:update": { active: boolean; mode: "mock" | "camera"; label: string };
  "camera:error": CameraErrorPayload;
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
