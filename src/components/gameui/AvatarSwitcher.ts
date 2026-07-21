import {
  AvatarRegistryClient,
  type AvatarIdentityRecord,
} from "../../core/avatar/AvatarRegistryClient.js";
import type {
  AvatarBindingSnapshot,
  AvatarBindingStatus,
} from "../../core/avatar/AvatarBindingController.js";

export interface AvatarSwitcherContext {
  seedId: string;
  motionId: string;
  avatarId?: string | undefined;
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

  constructor(options: AvatarSwitcherOptions) {
    this.el = options.el;
    this.backendUrl = options.backendUrl.replace(/\/$/, "");
    this.client = new AvatarRegistryClient(this.backendUrl);
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

  /** Point the switcher at a seed; null hides it (seed has no reusable motion). */
  setContext(context: AvatarSwitcherContext | null): void {
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
    const row = target.closest<HTMLElement>("[data-switcher-avatar]");
    const avatarId = row?.dataset.switcherAvatar;
    if (avatarId && !this.busyAvatarId) void this.pick(avatarId);
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
        binding = await this.createBinding(avatarId, context.motionId);
        this.bindings = [
          ...this.bindings.filter(
            (candidate) => !(candidate.avatarId === avatarId && candidate.motionId === context.motionId),
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

  private async createBinding(avatarId: string, motionId: string): Promise<ServerBindingRecord> {
    const response = await fetch(`${this.backendUrl}/avatar-bindings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatarId, motionId }),
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
    this.el.innerHTML = `
      <button type="button" class="avatar-switcher-toggle" data-switcher-toggle aria-expanded="${this.open}" aria-label="切换分身">
        <span>⇄ 分身</span><b>▾</b>
      </button>
      <div class="avatar-switcher-popover" role="menu" ${this.open ? "" : "hidden"}>
        <div class="avatar-switcher-head"><span>IDENTITY × MOTION</span><b>${escapeHtml(context.motionId)}</b></div>
        ${rows}
      </div>
    `;
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
    return ready
      .map((identity) => {
        const binding = this.bindingFor(identity.avatarId);
        const current = identity.avatarId === context.avatarId;
        const busy = identity.avatarId === this.busyAvatarId;
        const state = busy
          ? "切换中…"
          : current
            ? "使用中"
            : !binding || binding.status === "error" || binding.status === "cancelled"
              ? "建立绑定"
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
      .join("");
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
