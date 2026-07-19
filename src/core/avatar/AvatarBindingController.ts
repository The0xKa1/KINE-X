export const AVATAR_BINDING_STORAGE_KEY = "kinex.avatarBindings.v1";

export type AvatarBindingStatus =
  | "queued"
  | "running"
  | "ready"
  | "error"
  | "cancelled";

export interface AvatarBindingSnapshot {
  seedId: string;
  bindingId?: string | undefined;
  avatarId: string;
  motionId: string;
  status: AvatarBindingStatus;
  progress: number;
  progressNote?: string | undefined;
  identityUrl?: string | undefined;
  motionAssetUrl?: string | undefined;
  error?: string | undefined;
  createdAt?: number | undefined;
  finishedAt?: number | undefined;
  updatedAt?: number | undefined;
}

export interface AvatarPickerRecord {
  avatarId: string;
  name: string;
  status: AvatarBindingStatus;
  progress: number;
  identityUrl?: string | null | undefined;
}

export interface AvatarPickerChoice {
  avatarId: string | null;
  label: string;
  status: AvatarBindingStatus | "none";
  progress: number;
  disabled: boolean;
}

export interface AvatarAssetMetadata {
  avatarUrl?: string | undefined;
  identityUrl?: string | undefined;
  motionAssetUrl?: string | undefined;
  avatarBindingStatus?: AvatarBindingStatus | undefined;
  avatarBindingError?: string | undefined;
}

export function buildAvatarPickerChoices(records: AvatarPickerRecord[]): AvatarPickerChoice[] {
  return [
    { avatarId: null, label: "不使用分身", status: "none", progress: 0, disabled: false },
    ...records.map((record) => ({
      avatarId: record.avatarId,
      label: record.name,
      status: record.status,
      progress: record.progress,
      disabled: record.status !== "ready" || !record.identityUrl,
    })),
  ];
}

export function appendSelectedAvatar(
  form: FormData,
  avatarId: string | null | undefined,
): void {
  const selected = avatarId?.trim();
  if (selected) form.append("avatarId", selected);
}

export function hasPlayableAvatarAsset(
  exercise: AvatarAssetMetadata | null | undefined,
): boolean {
  if (!exercise) return false;
  if (exercise.avatarUrl) return true;
  if (exercise.avatarBindingStatus === "error" || exercise.avatarBindingStatus === "cancelled") {
    return false;
  }
  return Boolean(exercise.identityUrl && exercise.motionAssetUrl);
}

interface ServerBindingRecord {
  bindingId?: string;
  avatarId?: string;
  motionId?: string;
  status?: AvatarBindingStatus;
  progress?: number;
  progressNote?: string;
  identityUrl?: string | null;
  motionAssetUrl?: string | null;
  error?: string | null;
  createdAt?: number;
  finishedAt?: number;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type ScheduleLike = (callback: () => void, delayMs: number) => number;
type CancelScheduleLike = (handle: number) => void;

interface AvatarBindingControllerOptions {
  backendUrl: string;
  storage?: StorageLike;
  fetch?: FetchLike;
  schedule?: ScheduleLike;
  cancelSchedule?: CancelScheduleLike;
  pollIntervalMs?: number;
  maxPollIntervalMs?: number;
  onUpdate?(record: AvatarBindingSnapshot): void;
  onReady?(record: AvatarBindingSnapshot): void;
  onTerminalError?(record: AvatarBindingSnapshot): void;
  onNetworkError?(error: unknown): void;
}

const TERMINAL_STATUSES = new Set<AvatarBindingStatus>(["ready", "error", "cancelled"]);
const VALID_STATUSES = new Set<AvatarBindingStatus>([
  "queued",
  "running",
  "ready",
  "error",
  "cancelled",
]);

/**
 * Owns durable, low-frequency binding status. It deliberately has no page or
 * render-loop dependency: callers hydrate a seed from onReady and keep ordinary
 * CoachClip/mesh rendering available for every other state.
 */
export class AvatarBindingController {
  private readonly backendUrl: string;
  private readonly storage: StorageLike;
  private readonly fetchImpl: FetchLike;
  private readonly schedule: ScheduleLike;
  private readonly cancelSchedule: CancelScheduleLike;
  private readonly pollIntervalMs: number;
  private readonly maxPollIntervalMs: number;
  private readonly onUpdate: (record: AvatarBindingSnapshot) => void;
  private readonly onReady: (record: AvatarBindingSnapshot) => void;
  private readonly onTerminalError: (record: AvatarBindingSnapshot) => void;
  private readonly onNetworkError: (error: unknown) => void;
  private readonly records = new Map<string, AvatarBindingSnapshot>();
  private readonly discoveryTargets = new Map<string, string>();
  private readonly terminalNotifications = new Set<string>();
  private timer: number | null = null;
  private inFlight: Promise<void> | null = null;
  private failureCount = 0;
  private disposed = false;

  constructor(options: AvatarBindingControllerOptions) {
    this.backendUrl = options.backendUrl.replace(/\/$/, "");
    this.storage = options.storage ?? resolveStorage();
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.schedule = options.schedule ?? ((callback, delayMs) => window.setTimeout(callback, delayMs));
    this.cancelSchedule = options.cancelSchedule ?? ((handle) => window.clearTimeout(handle));
    this.pollIntervalMs = Math.max(1, options.pollIntervalMs ?? 2000);
    this.maxPollIntervalMs = Math.max(this.pollIntervalMs, options.maxPollIntervalMs ?? 8000);
    this.onUpdate = options.onUpdate ?? (() => {});
    this.onReady = options.onReady ?? (() => {});
    this.onTerminalError = options.onTerminalError ?? (() => {});
    this.onNetworkError = options.onNetworkError ?? (() => {});
    for (const record of readStoredBindings(this.storage)) this.records.set(record.seedId, record);
  }

  /** Replay persisted terminal hydration and resume one shared pending poll. */
  resume(): void {
    if (this.disposed) return;
    this.persist();
    this.records.forEach((record) => this.notify(record));
    this.ensureScheduled(0);
  }

  /** Add or replace the sole binding associated with a runtime seed. */
  track(record: AvatarBindingSnapshot): void {
    if (this.disposed) return;
    const normalized = normalizeBinding(record);
    if (!normalized) return;
    const previous = this.records.get(normalized.seedId);
    if (previous && bindingKey(previous) !== bindingKey(normalized)) {
      this.clearNotificationsForSeed(normalized.seedId);
    }
    this.records.set(normalized.seedId, normalized);
    this.persist();
    this.notify(normalized);
    this.ensureScheduled(0);
  }

  remove(seedId: string): void {
    const removed = this.records.delete(seedId);
    for (const [motionId, targetSeedId] of this.discoveryTargets) {
      if (targetSeedId === seedId) this.discoveryTargets.delete(motionId);
    }
    if (!removed) {
      if (!this.hasPollableRecords()) this.clearTimer();
      return;
    }
    this.clearNotificationsForSeed(seedId);
    this.persist();
    if (!this.hasPollableRecords()) this.clearTimer();
  }

  get(seedId: string): AvatarBindingSnapshot | null {
    const record = this.records.get(seedId);
    return record ? { ...record } : null;
  }

  list(): AvatarBindingSnapshot[] {
    return Array.from(this.records.values(), (record) => ({ ...record }));
  }

  /**
   * Rebuild missing local metadata from the server manifest during boot. The
   * import backend gives every motion job a stable `motion-<jobId>` id, so the
   * caller can join server bindings back to its runtime seed without relying on
   * localStorage. Existing local records remain authoritative because they
   * preserve the exact binding selected when the import was created.
   */
  async discover(seedByMotion: ReadonlyMap<string, string>): Promise<void> {
    if (this.disposed || seedByMotion.size === 0) return;
    seedByMotion.forEach((seedId, motionId) => {
      if (!this.records.has(seedId)) this.discoveryTargets.set(motionId, seedId);
    });
    await this.pollNow();
  }

  pollNow(): Promise<void> {
    if (this.disposed || !this.hasPollableRecords()) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    this.clearTimer();
    const request = this.performPoll().finally(() => {
      if (this.inFlight === request) this.inFlight = null;
    });
    this.inFlight = request;
    return request;
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.records.clear();
    this.discoveryTargets.clear();
    this.terminalNotifications.clear();
  }

  private async performPoll(): Promise<void> {
    try {
      const payload = await this.fetchServerBindings();
      if (this.disposed) return;
      this.failureCount = 0;
      this.reconcile(payload);
      this.reconcileDiscovery(payload);
      this.ensureScheduled(this.pollIntervalMs);
    } catch (error) {
      if (this.disposed) return;
      this.onNetworkError(error);
      const delay = Math.min(
        this.pollIntervalMs * 2 ** this.failureCount,
        this.maxPollIntervalMs,
      );
      this.failureCount += 1;
      this.ensureScheduled(delay);
    }
  }

  private async fetchServerBindings(): Promise<ServerBindingRecord[]> {
    const response = await this.fetchImpl(`${this.backendUrl}/avatar-bindings`, { method: "GET" });
    if (!response.ok) throw new Error(`分身绑定查询失败（HTTP ${response.status}）`);
    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) throw new Error("分身绑定响应格式无效");
    return payload as ServerBindingRecord[];
  }

  private reconcile(serverRecords: ServerBindingRecord[]): void {
    const byBindingId = new Map(
      serverRecords
        .filter((record): record is ServerBindingRecord & { bindingId: string } =>
          typeof record.bindingId === "string" && record.bindingId.length > 0)
        .map((record) => [record.bindingId, record]),
    );
    let changed = false;
    this.records.forEach((current, seedId) => {
      if (!current.bindingId || TERMINAL_STATUSES.has(current.status)) return;
      const server = byBindingId.get(current.bindingId);
      if (!server) return;
      if (server.avatarId !== current.avatarId || server.motionId !== current.motionId) return;
      const merged = mergeServerBinding(current, server);
      if (!merged || sameBinding(current, merged)) return;
      // The seed may have been removed/replaced while the request was in flight.
      const live = this.records.get(seedId);
      if (!live || bindingKey(live) !== bindingKey(current)) return;
      this.records.set(seedId, merged);
      changed = true;
      this.notify(merged);
    });
    if (changed) this.persist();
  }

  private reconcileDiscovery(serverRecords: ServerBindingRecord[]): void {
    if (this.discoveryTargets.size === 0) return;
    const targets = new Map(this.discoveryTargets);
    // A successful manifest response is authoritative: motions with no binding
    // are ordinary imports and must not cause a permanent background poll.
    this.discoveryTargets.clear();
    const discovered = new Map<string, AvatarBindingSnapshot>();
    for (const server of serverRecords) {
      const motionId = textValue(server.motionId);
      if (!motionId) continue;
      const seedId = targets.get(motionId);
      if (!seedId || this.records.has(seedId)) continue;
      const candidate = normalizeBinding({ ...server, seedId });
      if (!candidate) continue;
      const previous = discovered.get(seedId);
      if (!previous || compareDiscoveredBindings(candidate, previous) < 0) {
        discovered.set(seedId, candidate);
      }
    }
    if (discovered.size === 0) return;
    discovered.forEach((record, seedId) => {
      if (this.records.has(seedId)) return;
      this.records.set(seedId, record);
      this.notify(record);
    });
    this.persist();
  }

  private notify(record: AvatarBindingSnapshot): void {
    this.onUpdate({ ...record });
    if (!TERMINAL_STATUSES.has(record.status)) return;
    const key = `${record.seedId}:${bindingKey(record)}:${record.status}`;
    if (this.terminalNotifications.has(key)) return;
    this.terminalNotifications.add(key);
    if (record.status === "ready" && record.identityUrl && record.motionAssetUrl) {
      this.onReady({ ...record });
    } else if (record.status === "error" || record.status === "cancelled") {
      this.onTerminalError({ ...record });
    }
  }

  private ensureScheduled(delayMs: number): void {
    if (this.disposed || this.timer !== null || !this.hasPollableRecords()) return;
    this.timer = this.schedule(() => {
      this.timer = null;
      void this.pollNow();
    }, delayMs);
  }

  private hasPollableRecords(): boolean {
    return this.discoveryTargets.size > 0 || Array.from(this.records.values()).some(
      (record) => Boolean(record.bindingId) && !TERMINAL_STATUSES.has(record.status),
    );
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    this.cancelSchedule(this.timer);
    this.timer = null;
  }

  private clearNotificationsForSeed(seedId: string): void {
    for (const key of this.terminalNotifications) {
      if (key.startsWith(`${seedId}:`)) this.terminalNotifications.delete(key);
    }
  }

  private persist(): void {
    try {
      this.storage.setItem(AVATAR_BINDING_STORAGE_KEY, JSON.stringify({
        version: 1,
        bindings: Array.from(this.records.values()),
      }));
    } catch {
      // localStorage may be unavailable; server manifests remain authoritative.
    }
  }
}

function readStoredBindings(storage: StorageLike): AvatarBindingSnapshot[] {
  let raw: string | null = null;
  try {
    raw = storage.getItem(AVATAR_BINDING_STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    const candidates = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { bindings?: unknown }).bindings)
        ? (parsed as { bindings: unknown[] }).bindings
        : parsed && typeof parsed === "object"
          ? Object.values(parsed as Record<string, unknown>)
          : [];
    return candidates
      .map((candidate) => normalizeBinding(candidate))
      .filter((record): record is AvatarBindingSnapshot => record !== null);
  } catch {
    return [];
  }
}

function resolveStorage(): StorageLike {
  try {
    if (typeof window !== "undefined") return window.localStorage;
  } catch {
    // Privacy modes can throw while merely reading window.localStorage.
  }
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function normalizeBinding(value: unknown): AvatarBindingSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const seedId = textValue(candidate.seedId) ?? textValue(candidate.exerciseId);
  const avatarId = textValue(candidate.avatarId);
  const motionId = textValue(candidate.motionId);
  const status = candidate.status;
  if (!seedId || !avatarId || !motionId || !VALID_STATUSES.has(status as AvatarBindingStatus)) {
    return null;
  }
  return {
    seedId,
    bindingId: textValue(candidate.bindingId),
    avatarId,
    motionId,
    status: status as AvatarBindingStatus,
    progress: finiteProgress(candidate.progress),
    progressNote: textValue(candidate.progressNote),
    identityUrl: textValue(candidate.identityUrl),
    motionAssetUrl: textValue(candidate.motionAssetUrl),
    error: textValue(candidate.error),
    createdAt: finiteNumber(candidate.createdAt),
    finishedAt: finiteNumber(candidate.finishedAt),
    updatedAt: Date.now(),
  };
}

function mergeServerBinding(
  current: AvatarBindingSnapshot,
  server: ServerBindingRecord,
): AvatarBindingSnapshot | null {
  if (!server.status || !VALID_STATUSES.has(server.status)) return null;
  return {
    ...current,
    status: server.status,
    progress: finiteProgress(server.progress),
    progressNote: textValue(server.progressNote),
    identityUrl: textValue(server.identityUrl),
    motionAssetUrl: textValue(server.motionAssetUrl),
    error: textValue(server.error),
    createdAt: finiteNumber(server.createdAt) ?? current.createdAt,
    finishedAt: finiteNumber(server.finishedAt),
    updatedAt: Date.now(),
  };
}

function textValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function finiteProgress(value: unknown): number {
  const numeric = finiteNumber(value) ?? 0;
  return Math.max(0, Math.min(100, numeric));
}

function bindingKey(record: AvatarBindingSnapshot): string {
  return record.bindingId ?? `${record.avatarId}:${record.motionId}`;
}

function sameBinding(left: AvatarBindingSnapshot, right: AvatarBindingSnapshot): boolean {
  const { updatedAt: leftUpdatedAt, ...leftStable } = left;
  const { updatedAt: rightUpdatedAt, ...rightStable } = right;
  void leftUpdatedAt;
  void rightUpdatedAt;
  return JSON.stringify(leftStable) === JSON.stringify(rightStable);
}

function compareDiscoveredBindings(
  left: AvatarBindingSnapshot,
  right: AvatarBindingSnapshot,
): number {
  const leftCreatedAt = left.createdAt ?? Number.POSITIVE_INFINITY;
  const rightCreatedAt = right.createdAt ?? Number.POSITIVE_INFINITY;
  if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt - rightCreatedAt;
  return bindingKey(left).localeCompare(bindingKey(right));
}
