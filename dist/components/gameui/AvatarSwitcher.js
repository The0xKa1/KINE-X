import {
  AvatarRegistryClient,

} from "../../core/avatar/AvatarRegistryClient.js?v=0.1.11";


















export function buildAvatarBindingRequest(
  context                       ,
  avatarId        ,
)                             {
  if (context.motionId) return { avatarId, motionId: context.motionId };
  if (context.jobId) return { avatarId, jobId: context.jobId };
  throw new Error("当前动作缺少可绑定的视频来源");
}








/** Server binding record shape (subset the switcher reads). */











const BINDING_STATUSES                      = new Set([
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
                   el             ;
                   backendUrl        ;
                   client                      ;
                   onSwitch                                           ;
                   onError                           ;
          context                               = null;
          open = false;
          loading = false;
          busyAvatarId                = null;
          identities                         = [];
          bindings                        = [];
          loadError = "";
          generation = 0;

  constructor(options                       ) {
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

  /** Point the switcher at a reusable motion or an imported source job. */
  setContext(context                              )       {
    this.context = context;
    if (!context) this.setOpen(false);
    this.render();
  }

          setOpen(open         )       {
    if (open === this.open) return;
    this.open = open;
    if (open) void this.refresh();
    this.render();
  }

          async refresh()                {
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

          async fetchBindings()                                 {
    const response = await fetch(`${this.backendUrl}/avatar-bindings`, { method: "GET" });
    if (!response.ok) throw new Error(`绑定查询失败（HTTP ${response.status}）`);
    const payload = (await response.json())           ;
    if (!Array.isArray(payload)) throw new Error("绑定响应格式无效");
    return payload                         ;
  }

          bindingFor(avatarId        )                             {
    const motionId = this.context?.motionId;
    if (!motionId) return null;
    return (
      this.bindings.find(
        (binding) => binding.avatarId === avatarId && binding.motionId === motionId,
      ) ?? null
    );
  }

          handleClick(event            )       {
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
    const row = target.closest             ("[data-switcher-avatar]");
    const avatarId = row?.dataset.switcherAvatar;
    if (avatarId && !this.busyAvatarId) void this.pick(avatarId);
  }

          async pick(avatarId        )                {
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

          async createBinding(
    avatarId        ,
    context                       ,
  )                               {
    const response = await fetch(`${this.backendUrl}/avatar-bindings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildAvatarBindingRequest(context, avatarId)),
    });
    const payload = (await response.json())           ;
    if (!response.ok) {
      const detail =
        payload && typeof payload === "object" && "detail" in payload
          ? (payload                       ).detail
          : null;
      const message =
        typeof detail === "string"
          ? detail
          : detail && typeof detail === "object" && "error" in detail
            ? String((detail                      ).error)
            : `创建绑定失败（HTTP ${response.status}）`;
      throw new Error(message);
    }
    if (!payload || typeof payload !== "object") throw new Error("创建绑定响应格式无效");
    return payload                       ;
  }

          toSnapshot(
    binding                     ,
    context                       ,
  )                               {
    const status = typeof binding.status === "string" && BINDING_STATUSES.has(binding.status)
      ? (binding.status                       )
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

          render()       {
    const context = this.context;
    if (!context) {
      this.el.hidden = true;
      this.el.innerHTML = "";
      return;
    }
    this.el.hidden = false;
    const rows = this.renderRows(context);
    const hasMotion = Boolean(context.motionId);
    this.el.innerHTML = `
      <button type="button" class="avatar-switcher-toggle" data-switcher-toggle aria-expanded="${this.open}" aria-label="${hasMotion ? "切换分身" : "应用分身"}">
        <span>${hasMotion ? "⇄ 分身" : "+ 应用分身"}</span><b>▾</b>
      </button>
      <div class="avatar-switcher-popover" role="menu" ${this.open ? "" : "hidden"}>
        <div class="avatar-switcher-head"><span>${hasMotion ? "IDENTITY × MOTION" : "VIDEO → AVATAR"}</span><b>${escapeHtml(context.motionId ?? context.jobId ?? "")}</b></div>
        ${rows}
      </div>
    `;
  }

          renderRows(context                       )         {
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
      .join("");
  }
}

function escapeHtml(value        )         {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char] );
}

function escapeAttribute(value        )         {
  return escapeHtml(value);
}
