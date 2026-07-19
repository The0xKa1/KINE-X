export const AVATAR_BINDING_STORAGE_KEY = "kinex.avatarBindings.v1";
























































export function buildAvatarPickerChoices(records                      )                       {
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
  form          ,
  avatarId                           ,
)       {
  const selected = avatarId?.trim();
  if (selected) form.append("avatarId", selected);
}

export function hasPlayableAvatarAsset(
  exercise                                        ,
)          {
  if (!exercise) return false;
  if (exercise.avatarUrl) return true;
  if (exercise.avatarBindingStatus === "error" || exercise.avatarBindingStatus === "cancelled") {
    return false;
  }
  return Boolean(exercise.identityUrl && exercise.motionAssetUrl);
}

/** Low-frequency copy for the non-blocking train-bay binding status surface. */
export function describeAvatarBinding(
  exercise                                        ,
)                            {
  const status = exercise?.avatarBindingStatus;
  if (!status) return { visible: false, tone: "none", title: "", detail: "" };
  if (status === "queued") {
    return {
      visible: true,
      tone: "progress",
      title: "分身动作已排队",
      detail: "普通教练与骨骼模式可继续使用",
    };
  }
  if (status === "running") {
    const progress = Math.round(finiteProgress(exercise.avatarBindingProgress));
    return {
      visible: true,
      tone: "progress",
      title: `分身动作准备中 · ${progress}%`,
      detail: "普通教练与骨骼模式可继续使用",
    };
  }
  if (status === "error") {
    const error = textValue(exercise.avatarBindingError);
    return {
      visible: true,
      tone: "error",
      title: "分身准备失败",
      detail: error ? `${error} · 普通教练仍可使用` : "普通教练与骨骼模式仍可使用",
    };
  }
  if (status === "cancelled") {
    return {
      visible: true,
      tone: "error",
      title: "分身准备已取消",
      detail: "普通教练与骨骼模式仍可使用",
    };
  }
  if (exercise?.identityUrl && exercise.motionAssetUrl) {
    return {
      visible: true,
      tone: "ready",
      title: "分身资源已就绪",
      detail: "现在可切换到分身模式",
    };
  }
  return {
    visible: true,
    tone: "progress",
    title: "分身资源同步中",
    detail: "普通教练与骨骼模式可继续使用",
  };
}







































const TERMINAL_STATUSES = new Set                     (["ready", "error", "cancelled"]);
const VALID_STATUSES = new Set                     ([
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
                   backendUrl        ;
                   storage             ;
                   fetchImpl           ;
                   schedule              ;
                   cancelSchedule                    ;
                   pollIntervalMs        ;
                   maxPollIntervalMs        ;
                   onUpdate                                         ;
                   onReady                                         ;
                   onTerminalError                                         ;
                   onNetworkError                          ;
                   records = new Map                               ();
                   discoveryTargets = new Map                ();
                   terminalNotifications = new Set        ();
          timer                = null;
          inFlight                       = null;
          failureCount = 0;
          disposed = false;

  constructor(options                                ) {
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
  resume()       {
    if (this.disposed) return;
    this.persist();
    this.records.forEach((record) => this.notify(record));
    this.ensureScheduled(0);
  }

  /** Add or replace the sole binding associated with a runtime seed. */
  track(record                       )       {
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

  remove(seedId        )       {
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

  get(seedId        )                               {
    const record = this.records.get(seedId);
    return record ? { ...record } : null;
  }

  list()                          {
    return Array.from(this.records.values(), (record) => ({ ...record }));
  }

  /**
   * Rebuild missing local metadata from the server manifest during boot. The
   * import backend gives every motion job a stable `motion-<jobId>` id, so the
   * caller can join server bindings back to its runtime seed without relying on
   * localStorage. Existing local records remain authoritative because they
   * preserve the exact binding selected when the import was created.
   */
  async discover(seedByMotion                             )                {
    if (this.disposed || seedByMotion.size === 0) return;
    seedByMotion.forEach((seedId, motionId) => {
      if (!this.records.has(seedId)) this.discoveryTargets.set(motionId, seedId);
    });
    await this.pollNow();
  }

  pollNow()                {
    if (this.disposed || !this.hasPollableRecords()) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    this.clearTimer();
    const request = this.performPoll().finally(() => {
      if (this.inFlight === request) this.inFlight = null;
    });
    this.inFlight = request;
    return request;
  }

  dispose()       {
    this.disposed = true;
    this.clearTimer();
    this.records.clear();
    this.discoveryTargets.clear();
    this.terminalNotifications.clear();
  }

          async performPoll()                {
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

          async fetchServerBindings()                                 {
    const response = await this.fetchImpl(`${this.backendUrl}/avatar-bindings`, { method: "GET" });
    if (!response.ok) throw new Error(`分身绑定查询失败（HTTP ${response.status}）`);
    const payload = (await response.json())           ;
    if (!Array.isArray(payload)) throw new Error("分身绑定响应格式无效");
    return payload                         ;
  }

          reconcile(serverRecords                       )       {
    const byBindingId = new Map(
      serverRecords
        .filter((record)                                                        =>
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

          reconcileDiscovery(serverRecords                       )       {
    if (this.discoveryTargets.size === 0) return;
    const targets = new Map(this.discoveryTargets);
    // A successful manifest response is authoritative: motions with no binding
    // are ordinary imports and must not cause a permanent background poll.
    this.discoveryTargets.clear();
    const discovered = new Map                               ();
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

          notify(record                       )       {
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

          ensureScheduled(delayMs        )       {
    if (this.disposed || this.timer !== null || !this.hasPollableRecords()) return;
    this.timer = this.schedule(() => {
      this.timer = null;
      void this.pollNow();
    }, delayMs);
  }

          hasPollableRecords()          {
    return this.discoveryTargets.size > 0 || Array.from(this.records.values()).some(
      (record) => Boolean(record.bindingId) && !TERMINAL_STATUSES.has(record.status),
    );
  }

          clearTimer()       {
    if (this.timer === null) return;
    this.cancelSchedule(this.timer);
    this.timer = null;
  }

          clearNotificationsForSeed(seedId        )       {
    for (const key of this.terminalNotifications) {
      if (key.startsWith(`${seedId}:`)) this.terminalNotifications.delete(key);
    }
  }

          persist()       {
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

function readStoredBindings(storage             )                          {
  let raw                = null;
  try {
    raw = storage.getItem(AVATAR_BINDING_STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw)           ;
    const candidates = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed                          ).bindings)
        ? (parsed                           ).bindings
        : parsed && typeof parsed === "object"
          ? Object.values(parsed                           )
          : [];
    return candidates
      .map((candidate) => normalizeBinding(candidate))
      .filter((record)                                  => record !== null);
  } catch {
    return [];
  }
}

function resolveStorage()              {
  try {
    if (typeof window !== "undefined") return window.localStorage;
  } catch {
    // Privacy modes can throw while merely reading window.localStorage.
  }
  const values = new Map                ();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function normalizeBinding(value         )                               {
  if (!value || typeof value !== "object") return null;
  const candidate = value                           ;
  const seedId = textValue(candidate.seedId) ?? textValue(candidate.exerciseId);
  const avatarId = textValue(candidate.avatarId);
  const motionId = textValue(candidate.motionId);
  const status = candidate.status;
  if (!seedId || !avatarId || !motionId || !VALID_STATUSES.has(status                       )) {
    return null;
  }
  return {
    seedId,
    bindingId: textValue(candidate.bindingId),
    avatarId,
    motionId,
    status: status                       ,
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
  current                       ,
  server                     ,
)                               {
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

function textValue(value         )                     {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function finiteNumber(value         )                     {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function finiteProgress(value         )         {
  const numeric = finiteNumber(value) ?? 0;
  return Math.max(0, Math.min(100, numeric));
}

function bindingKey(record                       )         {
  return record.bindingId ?? `${record.avatarId}:${record.motionId}`;
}

function sameBinding(left                       , right                       )          {
  const { updatedAt: leftUpdatedAt, ...leftStable } = left;
  const { updatedAt: rightUpdatedAt, ...rightStable } = right;
  void leftUpdatedAt;
  void rightUpdatedAt;
  return JSON.stringify(leftStable) === JSON.stringify(rightStable);
}

function compareDiscoveredBindings(
  left                       ,
  right                       ,
)         {
  const leftCreatedAt = left.createdAt ?? Number.POSITIVE_INFINITY;
  const rightCreatedAt = right.createdAt ?? Number.POSITIVE_INFINITY;
  if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt - rightCreatedAt;
  return bindingKey(left).localeCompare(bindingKey(right));
}
