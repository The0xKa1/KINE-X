import {
  AvatarRegistryClient,
  type AvatarIdentityRecord,
} from "../../core/avatar/AvatarRegistryClient.js";
import type {
  AvatarBindingSnapshot,
  AvatarBindingStatus,
} from "../../core/avatar/AvatarBindingController.js";
import {
  AvatarVideoExportClient,
  buildAvatarVideoExportRequest,
  resolveAvatarVideoUrl,
  type AvatarVideoExportRecord,
} from "../../core/avatar/AvatarVideoExportClient.js";

export interface AvatarSwitcherContext {
  seedId: string;
  motionId?: string | undefined;
  jobId?: string | undefined;
  avatarId?: string | undefined;
  bindingStatus?: AvatarBindingStatus | undefined;
}

export interface AvatarBindingCreateRequest {
  avatarId: string;
  motionId?: string | undefined;
  jobId?: string | undefined;
}

export function buildAvatarBindingRequest(
  context: AvatarSwitcherContext,
  avatarId: string,
): AvatarBindingCreateRequest {
  if (context.motionId) return { avatarId, motionId: context.motionId };
  if (context.jobId) return { avatarId, jobId: context.jobId };
  throw new Error("当前动作缺少可绑定的视频来源");
}

export interface AvatarSwitcherOptions {
  el: HTMLElement;
  backendUrl: string;
  onSwitch: (snapshot: AvatarBindingSnapshot) => void;
  onError?: ((message: string) => void) | undefined;
}

/** Server binding record shape (subset the switcher reads). */
interface ServerBindingRecord {
  bindingId?: unknown;
  avatarId?: unknown;
  motionId?: unknown;
  status?: unknown;
  progress?: unknown;
  error?: unknown;
  identityUrl?: unknown;
  motionAssetUrl?: unknown;
}

const BINDING_STATUSES: ReadonlySet<string> = new Set([
  "queued",
  "running",
  "ready",
  "error",
  "cancelled",
]);

/**
 * Train-bay avatar switcher: a tiny popover next to the render-mode segmented
 * control that lets any READY identity take over the current seed's motion.
 * Existing bindings are adopted instantly; a missing pair is created through
 * POST /avatar-bindings and handed to the caller as a pending snapshot so the
 * shared AvatarBindingController keeps polling it.
 */
export class AvatarSwitcher {
  private readonly el: HTMLElement;
  private readonly backendUrl: string;
  private readonly client: AvatarRegistryClient;
  private readonly exportClient: AvatarVideoExportClient;
  private readonly onSwitch: (snapshot: AvatarBindingSnapshot) => void;
  private readonly onError: (message: string) => void;
  private context: AvatarSwitcherContext | null = null;
  private open = false;
  private loading = false;
  private busyAvatarId: string | null = null;
  private identities: AvatarIdentityRecord[] = [];
  private bindings: ServerBindingRecord[] = [];
  private loadError = "";
  private generation = 0;
  private exportRecord: AvatarVideoExportRecord | null = null;
  private exportSubmitting = false;
  private exportPollTimer = 0;
  private exportGeneration = 0;

  constructor(options: AvatarSwitcherOptions) {
    this.el = options.el;
    this.backendUrl = options.backendUrl.replace(/\/$/, "");
    this.client = new AvatarRegistryClient(this.backendUrl);
    this.exportClient = new AvatarVideoExportClient(this.backendUrl);
    this.onSwitch = options.onSwitch;
    this.onError = options.onError ?? ((message) => console.warn("[avatar-switcher]", message));
    this.el.addEventListener("click", (event) => this.handleClick(event));
    document.addEventListener("pointerdown", (event) => {
      if (this.open && event.target instanceof Node && !this.el.contains(event.target)) {
        this.setOpen(false);
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.open) this.setOpen(false);
    });
  }

  /** Point the switcher at a reusable motion or an imported source job. */
  setContext(context: AvatarSwitcherContext | null): void {
    const previousPair = this.exportPair(this.context);
    const nextPair = this.exportPair(context);
    if (previousPair !== nextPair) this.resetExport();
    this.context = context;
    if (!context) this.setOpen(false);
    this.render();
  }

  private setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    if (open) void this.refresh();
    this.render();
  }

  private async refresh(): Promise<void> {
    const generation = ++this.generation;
    this.loading = true;
    this.loadError = "";
    this.render();
    try {
      const [identities, bindings] = await Promise.all([
        this.client.list(),
        this.fetchBindings(),
      ]);
      if (generation !== this.generation) return;
      this.identities = identities;
      this.bindings = bindings;
      this.loading = false;
      this.render();
    } catch (error) {
      if (generation !== this.generation) return;
      this.loading = false;
      this.loadError = error instanceof Error ? error.message : "读取分身清单失败";
      this.render();
    }
  }

  private async fetchBindings(): Promise<ServerBindingRecord[]> {
    const response = await fetch(`${this.backendUrl}/avatar-bindings`, { method: "GET" });
    if (!response.ok) throw new Error(`绑定查询失败（HTTP ${response.status}）`);
    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) throw new Error("绑定响应格式无效");
    return payload as ServerBindingRecord[];
  }

  private bindingFor(avatarId: string): ServerBindingRecord | null {
    const motionId = this.context?.motionId;
    if (!motionId) return null;
    return (
      this.bindings.find(
        (binding) => binding.avatarId === avatarId && binding.motionId === motionId,
      ) ?? null
    );
  }

  private handleClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("[data-switcher-toggle]")) {
      if (this.context) this.setOpen(!this.open);
      return;
    }
    if (target.closest("[data-switcher-retry]")) {
      void this.refresh();
      return;
    }
    if (target.closest("[data-avatar-export]")) {
      void this.handleExport();
      return;
    }
    const row = target.closest<HTMLElement>("[data-switcher-avatar]");
    const avatarId = row?.dataset.switcherAvatar;
    if (avatarId && !this.busyAvatarId) void this.pick(avatarId);
  }

  private async handleExport(): Promise<void> {
    const context = this.context;
    if (!context?.avatarId || !context.motionId || context.bindingStatus !== "ready") return;
    if (this.exportRecord?.status === "ready" && this.exportRecord.videoUrl) {
      this.downloadExport(this.exportRecord.videoUrl);
      return;
    }
    if (this.exportSubmitting || this.exportRecord?.status === "queued" || this.exportRecord?.status === "running") {
      return;
    }
    const generation = ++this.exportGeneration;
    this.exportSubmitting = true;
    this.render();
    try {
      const record = await this.exportClient.create(
        buildAvatarVideoExportRequest(context.avatarId, context.motionId),
      );
      if (generation !== this.exportGeneration) return;
      this.exportRecord = record;
      this.exportSubmitting = false;
      this.render();
      if (record.status === "queued" || record.status === "running") {
        this.scheduleExportPoll(generation);
      }
      if (record.status === "error" || record.status === "cancelled") {
        this.onError(`视频导出失败：${record.error ?? "渲染任务未完成"}`);
      }
    } catch (error) {
      if (generation !== this.exportGeneration) return;
      this.exportSubmitting = false;
      this.exportRecord = null;
      const message = error instanceof Error ? error.message : "创建分身视频失败";
      this.onError(`视频导出失败：${message}`);
      this.render();
    }
  }

  private scheduleExportPoll(generation: number): void {
    window.clearTimeout(this.exportPollTimer);
    this.exportPollTimer = window.setTimeout(() => void this.pollExport(generation), 1500);
  }

  private async pollExport(generation: number): Promise<void> {
    const exportId = this.exportRecord?.exportId;
    if (!exportId || generation !== this.exportGeneration) return;
    try {
      const record = await this.exportClient.get(exportId);
      if (generation !== this.exportGeneration) return;
      this.exportRecord = record;
      this.render();
      if (record.status === "queued" || record.status === "running") {
        this.scheduleExportPoll(generation);
      } else if (record.status === "error" || record.status === "cancelled") {
        this.onError(`视频导出失败：${record.error ?? "渲染任务未完成"}`);
      }
    } catch (error) {
      if (generation !== this.exportGeneration) return;
      const message = error instanceof Error ? error.message : "读取导出进度失败";
      this.exportRecord = {
        ...this.exportRecord!,
        status: "error",
        error: message,
      };
      this.onError(`视频导出失败：${message}`);
      this.render();
    }
  }

  private downloadExport(videoUrl: string): void {
    const anchor = document.createElement("a");
    anchor.href = resolveAvatarVideoUrl(this.backendUrl, videoUrl);
    anchor.download = "kinex-avatar.mp4";
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }

  private resetExport(): void {
    this.exportGeneration += 1;
    window.clearTimeout(this.exportPollTimer);
    this.exportPollTimer = 0;
    this.exportSubmitting = false;
    this.exportRecord = null;
  }

  private exportPair(context: AvatarSwitcherContext | null): string {
    return context?.avatarId && context.motionId ? `${context.avatarId}\n${context.motionId}` : "";
  }

  private async pick(avatarId: string): Promise<void> {
    const context = this.context;
    if (!context || avatarId === context.avatarId) {
      this.setOpen(false);
      return;
    }
    this.busyAvatarId = avatarId;
    this.render();
    try {
      let binding = this.bindingFor(avatarId);
      if (!binding || binding.status === "error" || binding.status === "cancelled") {
        binding = await this.createBinding(avatarId, context);
        this.bindings = [
          ...this.bindings.filter(
            (candidate) => !(candidate.avatarId === avatarId && candidate.motionId === binding?.motionId),
          ),
          binding,
        ];
      }
      const snapshot = this.toSnapshot(binding, context);
      if (!snapshot) throw new Error("绑定记录不完整，请稍后重试");
      this.setOpen(false);
      this.onSwitch(snapshot);
    } catch (error) {
      this.onError(error instanceof Error ? error.message : "切换分身失败");
    } finally {
      this.busyAvatarId = null;
      this.render();
    }
  }

  private async createBinding(
    avatarId: string,
    context: AvatarSwitcherContext,
  ): Promise<ServerBindingRecord> {
    const response = await fetch(`${this.backendUrl}/avatar-bindings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildAvatarBindingRequest(context, avatarId)),
    });
    const payload = (await response.json()) as unknown;
    if (!response.ok) {
      const detail =
        payload && typeof payload === "object" && "detail" in payload
          ? (payload as { detail: unknown }).detail
          : null;
      const message =
        typeof detail === "string"
          ? detail
          : detail && typeof detail === "object" && "error" in detail
            ? String((detail as { error: unknown }).error)
            : `创建绑定失败（HTTP ${response.status}）`;
      throw new Error(message);
    }
    if (!payload || typeof payload !== "object") throw new Error("创建绑定响应格式无效");
    return payload as ServerBindingRecord;
  }

  private toSnapshot(
    binding: ServerBindingRecord,
    context: AvatarSwitcherContext,
  ): AvatarBindingSnapshot | null {
    const status = typeof binding.status === "string" && BINDING_STATUSES.has(binding.status)
      ? (binding.status as AvatarBindingStatus)
      : null;
    const avatarId = typeof binding.avatarId === "string" ? binding.avatarId : null;
    const motionId = typeof binding.motionId === "string" ? binding.motionId : null;
    if (!status || !avatarId || !motionId) return null;
    return {
      seedId: context.seedId,
      bindingId: typeof binding.bindingId === "string" ? binding.bindingId : undefined,
      avatarId,
      motionId,
      status,
      progress: typeof binding.progress === "number" ? binding.progress : status === "ready" ? 100 : 0,
      identityUrl: typeof binding.identityUrl === "string" ? binding.identityUrl : undefined,
      motionAssetUrl: typeof binding.motionAssetUrl === "string" ? binding.motionAssetUrl : undefined,
      error: typeof binding.error === "string" ? binding.error : undefined,
    };
  }

  private render(): void {
    const context = this.context;
    if (!context) {
      this.el.hidden = true;
      this.el.innerHTML = "";
      return;
    }
    this.el.hidden = false;
    const rows = this.renderRows(context);
    const hasMotion = Boolean(context.motionId);
    const exportPresentation = this.describeExport(context);
    this.el.innerHTML = `
      <div class="avatar-switcher-actions">
        <button type="button" class="avatar-switcher-toggle" data-switcher-toggle aria-expanded="${this.open}" aria-label="${hasMotion ? "切换分身" : "应用分身"}">
          <span>${hasMotion ? "⇄ 分身" : "+ 应用分身"}</span><b>▾</b>
        </button>
        <button type="button" class="avatar-video-export${exportPresentation.ready ? " is-ready" : ""}" data-avatar-export ${exportPresentation.disabled ? "disabled" : ""} title="${escapeAttribute(exportPresentation.title)}" aria-label="${escapeAttribute(exportPresentation.title)}">
          ${escapeHtml(exportPresentation.label)}
        </button>
        <span class="avatar-video-export-live" aria-live="polite">${escapeHtml(exportPresentation.live)}</span>
      </div>
      <div class="avatar-switcher-popover" role="menu" ${this.open ? "" : "hidden"}>
        <div class="avatar-switcher-head"><span>${hasMotion ? "IDENTITY × MOTION" : "VIDEO → AVATAR"}</span><b>${escapeHtml(context.motionId ?? context.jobId ?? "")}</b></div>
        ${rows}
      </div>
    `;
  }

  private describeExport(context: AvatarSwitcherContext): {
    label: string;
    title: string;
    live: string;
    disabled: boolean;
    ready: boolean;
  } {
    const canExport = Boolean(
      context.avatarId && context.motionId && context.bindingStatus === "ready",
    );
    if (!canExport) {
      return {
        label: "↓ 视频",
        title: "当前分身动作就绪后可导出视频",
        live: "分身视频暂不可导出",
        disabled: true,
        ready: false,
      };
    }
    if (this.exportSubmitting) {
      return { label: "提交中…", title: "正在创建分身视频任务", live: "正在提交导出任务", disabled: true, ready: false };
    }
    const record = this.exportRecord;
    if (!record) {
      return { label: "↓ 视频", title: "导出当前分身的完整动作视频", live: "可导出分身视频", disabled: false, ready: false };
    }
    if (record.status === "ready" && record.videoUrl) {
      return { label: "↓ 下载", title: "分身视频已就绪，点击下载", live: "分身视频已生成", disabled: false, ready: true };
    }
    if (record.status === "error" || record.status === "cancelled") {
      return { label: "↻ 重试", title: record.error ?? "导出失败，点击重试", live: "分身视频导出失败", disabled: false, ready: false };
    }
    const progress = Math.max(0, Math.min(100, Math.round(record.progress)));
    return {
      label: record.status === "queued" && progress === 0 ? "排队中…" : `${progress}%`,
      title: record.progressNote ?? "GPU 正在渲染分身视频",
      live: `分身视频导出进度 ${progress}%`,
      disabled: true,
      ready: false,
    };
  }

  private renderRows(context: AvatarSwitcherContext): string {
    if (this.loading) return `<p class="avatar-switcher-note">读取分身清单…</p>`;
    if (this.loadError) {
      return `<div class="avatar-switcher-note is-error"><span>${escapeHtml(this.loadError)}</span><button type="button" data-switcher-retry>重试</button></div>`;
    }
    const ready = this.identities.filter(
      (identity) => identity.status === "ready" && Boolean(identity.identityUrl),
    );
    if (ready.length === 0) {
      return `<p class="avatar-switcher-note">身份库暂无 READY 分身，先到 #/avatars 上传照片重建。</p>`;
    }
    return `<div class="avatar-switcher-list">${ready
      .map((identity) => {
        const binding = this.bindingFor(identity.avatarId);
        const current = identity.avatarId === context.avatarId;
        const busy = identity.avatarId === this.busyAvatarId;
        const state = busy
          ? context.motionId ? "切换中…" : "生成动作…"
          : current
            ? "使用中"
            : !binding || binding.status === "error" || binding.status === "cancelled"
              ? context.motionId ? "建立绑定" : "应用并生成动作"
              : binding.status === "ready"
                ? "切换"
                : `准备中 ${Math.round(typeof binding.progress === "number" ? binding.progress : 0)}%`;
        return `
          <button type="button" class="avatar-switcher-row${current ? " is-current" : ""}" data-switcher-avatar="${escapeAttribute(identity.avatarId)}" ${busy ? "disabled" : ""} role="menuitem">
            <strong>${escapeHtml(identity.name)}</strong>
            <span>${escapeHtml(state)}</span>
          </button>
        `;
      })
      .join("")}</div>`;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]!);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
