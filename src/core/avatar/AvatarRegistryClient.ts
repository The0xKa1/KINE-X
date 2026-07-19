export type AvatarIdentityStatus = "queued" | "running" | "ready" | "error" | "cancelled";

export interface AvatarIdentityRecord {
  avatarId: string;
  name: string;
  status: AvatarIdentityStatus;
  progress: number;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  identityUrl?: string | null;
  previewUrl?: string | null;
  sourcePhoto?: string;
  error?: string | null;
  alignment?: Record<string, unknown>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type ScheduleLike = (callback: () => void, delayMs: number) => number;
type CancelScheduleLike = (handle: number) => void;

interface AvatarRegistryClientOptions {
  fetch?: FetchLike;
  schedule?: ScheduleLike;
  cancelSchedule?: CancelScheduleLike;
  pollIntervalMs?: number;
  maxPollIntervalMs?: number;
}

export interface AvatarRenameDraft {
  value: string;
  focused: boolean;
  selectionStart: number | null;
  selectionEnd: number | null;
}

export class AsyncGenerationGuard {
  private generation = 0;
  private active = false;

  enter(): number {
    this.active = true;
    this.generation += 1;
    return this.generation;
  }

  leave(): void {
    this.active = false;
    this.generation += 1;
  }

  capture(): number {
    return this.generation;
  }

  isCurrent(generation: number): boolean {
    return this.active && generation === this.generation;
  }
}

export class AvatarRenameDraftStore {
  private readonly drafts = new Map<string, AvatarRenameDraft>();

  begin(avatarId: string, value: string): void {
    this.drafts.set(avatarId, {
      value,
      focused: false,
      selectionStart: null,
      selectionEnd: null,
    });
  }

  capture(
    avatarId: string,
    value: string,
    focused: boolean,
    selectionStart: number | null,
    selectionEnd: number | null,
  ): void {
    this.drafts.set(avatarId, { value, focused, selectionStart, selectionEnd });
  }

  read(avatarId: string, fallback: string): AvatarRenameDraft {
    return this.drafts.get(avatarId) ?? {
      value: fallback,
      focused: false,
      selectionStart: null,
      selectionEnd: null,
    };
  }

  finish(avatarId: string): void {
    this.drafts.delete(avatarId);
  }
}

export class AvatarRegistryHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AvatarRegistryHttpError";
    this.status = status;
  }
}

export class AvatarRegistryOfflineError extends Error {
  constructor() {
    super("无法连接分身服务");
    this.name = "AvatarRegistryOfflineError";
  }
}

export class AvatarRegistryClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly schedule: ScheduleLike;
  private readonly cancelSchedule: CancelScheduleLike;
  private readonly pollIntervalMs: number;
  private readonly maxPollIntervalMs: number;

  constructor(baseUrl: string, options: AvatarRegistryClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.schedule = options.schedule ?? ((callback, delayMs) => window.setTimeout(callback, delayMs));
    this.cancelSchedule = options.cancelSchedule ?? ((handle) => window.clearTimeout(handle));
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;
    this.maxPollIntervalMs = Math.max(this.pollIntervalMs, options.maxPollIntervalMs ?? 8000);
  }

  list(): Promise<AvatarIdentityRecord[]> {
    return this.request<AvatarIdentityRecord[]>("/avatars", { method: "GET" });
  }

  upload(photo: File, name?: string): Promise<AvatarIdentityRecord> {
    const body = new FormData();
    body.append("photo", photo);
    const trimmed = name?.trim();
    if (trimmed) body.append("name", trimmed);
    return this.request<AvatarIdentityRecord>("/avatars", { method: "POST", body });
  }

  rename(avatarId: string, name: string): Promise<AvatarIdentityRecord> {
    return this.request<AvatarIdentityRecord>(`/avatars/${encodeURIComponent(avatarId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
  }

  remove(avatarId: string): Promise<AvatarIdentityRecord> {
    return this.request<AvatarIdentityRecord>(`/avatars/${encodeURIComponent(avatarId)}`, {
      method: "DELETE",
    });
  }

  watch(
    onRecords: (records: AvatarIdentityRecord[]) => void,
    onError: (error: unknown) => void = () => {},
  ): () => void {
    let active = true;
    let scheduled: number | null = null;
    let failureCount = 0;
    let shouldRecover = true;

    const scheduleNext = (delayMs: number): void => {
      scheduled = this.schedule(() => {
        scheduled = null;
        void tick();
      }, delayMs);
    };

    const tick = async (): Promise<void> => {
      if (!active) return;
      try {
        const records = await this.list();
        if (!active) return;
        failureCount = 0;
        onRecords(records);
        shouldRecover = records.some((record) => record.status === "queued" || record.status === "running");
        if (shouldRecover) scheduleNext(this.pollIntervalMs);
      } catch (error) {
        if (!active) return;
        onError(error);
        if (shouldRecover) {
          const retryDelay = Math.min(
            this.pollIntervalMs * 2 ** failureCount,
            this.maxPollIntervalMs,
          );
          failureCount += 1;
          scheduleNext(retryDelay);
        }
      }
    };

    void tick();
    return () => {
      active = false;
      if (scheduled !== null) this.cancelSchedule(scheduled);
      scheduled = null;
    };
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    } catch {
      throw new AvatarRegistryOfflineError();
    }
    if (!response.ok) {
      throw new AvatarRegistryHttpError(response.status, await readErrorMessage(response));
    }
    return (await response.json()) as T;
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      detail?: string | { error?: string };
      error?: string;
    };
    if (typeof payload.detail === "string") return payload.detail;
    if (payload.detail && typeof payload.detail.error === "string") return payload.detail.error;
    if (typeof payload.error === "string") return payload.error;
  } catch {
    // Fall through to a stable status-based message.
  }
  return `分身服务请求失败（HTTP ${response.status}）`;
}
