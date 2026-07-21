
import {
  AsyncGenerationGuard,
  AvatarRegistryClient,
  AvatarRegistryOfflineError,
  AvatarRenameDraftStore,

} from "../../core/avatar/AvatarRegistryClient.js?v=0.1.4";
import { GaussianAvatar } from "../../core/avatar/GaussianAvatar.js?v=0.1.4";
import { THREE } from "../../core/three-compat.js?v=0.1.4";








const PREVIEW_TARGET_Y = 1.05;
const MIN_CAMERA_DISTANCE = 2.4;
const MAX_CAMERA_DISTANCE = 7.2;

export class AvatarVaultPage                 {
  el             ;
                   client                      ;
          records                         = [];
          loadState                 = "idle";
          loadError = "";
          stopWatch                      = null;
          selectedId                = null;
          renamingId                = null;
          deletingId                = null;
          uploading = false;
          activePreviewId                = null;
          previewToken = 0;
          previewAvatar                        = null;
  /** Self-healed card thumbnails for identities whose record has no previewUrl. */
                   cardSnapshots = new Map                ();
          snapshotFramesLeft = 0;
          renderer                                                  = null;
          scene                                          = null;
          camera                                                      = null;
          previewRaf = 0;
          yaw = 0;
          pitch = 0.08;
          cameraDistance = 4.4;
          dragging = false;
          pointerX = 0;
          pointerY = 0;
                   lifecycle = new AsyncGenerationGuard();
                   renameDrafts = new AvatarRenameDraftStore();

  constructor(options                        ) {
    this.el = options.el;
    this.client = options.client;
    this.renderShell();
    this.bindShell();
  }

  enter()       {
    const generation = this.lifecycle.enter();
    this.uploading = false;
    this.syncUploadButton();
    this.restartWatch(true, generation);
  }

  leave()       {
    this.lifecycle.leave();
    this.uploading = false;
    this.stopWatch?.();
    this.stopWatch = null;
    this.disposePreview();
  }

          renderShell()       {
    this.el.innerHTML = `
      <div class="avatar-vault">
        <header class="avatar-vault-head">
          <div>
            <span class="eyebrow">05 · AVATAR VAULT / 身份库</span>
            <h2>一次重建，反复上场</h2>
            <p>照片只负责生成身份。动作独立保存，训练时再组合。</p>
          </div>
          <form class="avatar-upload" id="avatarVaultUpload">
            <label for="avatarVaultName">分身名称</label>
            <input id="avatarVaultName" type="text" maxlength="48" placeholder="例如：Kai / Match Day" />
            <label class="avatar-upload-file" for="avatarVaultFile">
              <span id="avatarVaultFileLabel">选择全身照片</span>
              <input id="avatarVaultFile" type="file" accept="image/jpeg,image/png,image/webp" required />
            </label>
            <button class="primary-button" id="avatarVaultSubmit" type="submit">开始重建</button>
          </form>
        </header>

        <div id="avatarVaultNotice" class="avatar-vault-notice" role="status" aria-live="polite" hidden></div>

        <div class="avatar-vault-layout">
          <section class="avatar-vault-gallery" aria-labelledby="avatarVaultGalleryTitle">
            <div class="avatar-vault-section-head">
              <div>
                <span>IDENTITY INDEX</span>
                <h3 id="avatarVaultGalleryTitle">分身档案</h3>
              </div>
              <b id="avatarVaultCount">00</b>
            </div>
            <div id="avatarVaultList" class="avatar-vault-list" aria-live="polite"></div>
          </section>

          <aside class="avatar-preview-panel" aria-labelledby="avatarPreviewTitle">
            <div class="avatar-vault-section-head">
              <div>
                <span>REAL-TIME 3DGS</span>
                <h3 id="avatarPreviewTitle">身份预览</h3>
              </div>
              <b>01</b>
            </div>
            <div id="avatarPreviewStage" class="avatar-preview-stage">
              <canvas id="avatarPreviewCanvas" aria-label="可旋转的 3DGS 分身预览"></canvas>
              <div id="avatarPreviewState" class="avatar-preview-state">
                <strong>选择 READY 档案</strong>
                <span>拖拽旋转 · 滚轮缩放</span>
              </div>
              <div class="avatar-preview-axis" aria-hidden="true"><i></i><span>Y</span></div>
            </div>
            <div id="avatarPreviewMeta" class="avatar-preview-meta">
              <span>IDENTITY</span><b>未选择</b>
              <span>RENDER</span><b>STANDBY</b>
            </div>
          </aside>
        </div>
      </div>
    `;
    this.renderGallery();
  }

          bindShell()       {
    const form = this.requireElement                 ("#avatarVaultUpload");
    const fileInput = this.requireElement                  ("#avatarVaultFile");
    const canvas = this.requireElement                   ("#avatarPreviewCanvas");

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.uploadSelectedFile();
    });
    fileInput.addEventListener("change", () => {
      const label = this.requireElement             ("#avatarVaultFileLabel");
      label.textContent = fileInput.files?.[0]?.name ?? "选择全身照片";
    });
    canvas.addEventListener("pointerdown", (event) => {
      if (!this.previewAvatar) return;
      this.dragging = true;
      this.pointerX = event.clientX;
      this.pointerY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("is-dragging");
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!this.dragging) return;
      this.yaw -= (event.clientX - this.pointerX) * 0.009;
      this.pitch = clamp(this.pitch + (event.clientY - this.pointerY) * 0.004, -0.28, 0.34);
      this.pointerX = event.clientX;
      this.pointerY = event.clientY;
      this.positionPreviewCamera();
    });
    const releasePointer = (event              )       => {
      this.dragging = false;
      canvas.classList.remove("is-dragging");
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener("pointerup", releasePointer);
    canvas.addEventListener("pointercancel", releasePointer);
    canvas.addEventListener(
      "wheel",
      (event) => {
        if (!this.previewAvatar) return;
        event.preventDefault();
        this.cameraDistance = clamp(this.cameraDistance + event.deltaY * 0.004, MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE);
        this.positionPreviewCamera();
      },
      { passive: false },
    );
  }

          restartWatch(showLoading = false, generation = this.lifecycle.capture())       {
    if (!this.lifecycle.isCurrent(generation)) return;
    this.stopWatch?.();
    if (showLoading && this.records.length === 0) {
      this.loadState = "loading";
      this.renderGallery();
    }
    this.stopWatch = this.client.watch(
      (records) => {
        if (!this.lifecycle.isCurrent(generation)) return;
        this.records = records;
        if (this.renamingId && !records.some((record) => record.avatarId === this.renamingId)) {
          this.renameDrafts.finish(this.renamingId);
          this.renamingId = null;
        }
        this.loadState = "ready";
        this.loadError = "";
        this.renderGallery();
        this.syncSelection();
      },
      (error) => {
        if (!this.lifecycle.isCurrent(generation)) return;
        this.loadState = error instanceof AvatarRegistryOfflineError ? "offline" : "error";
        this.loadError = error instanceof Error ? error.message : "加载分身档案失败";
        this.renderGallery();
      },
    );
  }

          async uploadSelectedFile()                {
    if (this.uploading) return;
    const fileInput = this.requireElement                  ("#avatarVaultFile");
    const nameInput = this.requireElement                  ("#avatarVaultName");
    const photo = fileInput.files?.[0];
    if (!photo) {
      this.setNotice("请先选择 JPG、PNG 或 WEBP 全身照片。", true);
      fileInput.focus();
      return;
    }
    const generation = this.lifecycle.capture();
    if (!this.lifecycle.isCurrent(generation)) return;
    this.uploading = true;
    this.syncUploadButton();
    this.setNotice("照片上传中，身份重建将在 GPU 队列中开始。", false);
    try {
      const created = await this.client.upload(photo, nameInput.value);
      if (!this.lifecycle.isCurrent(generation)) return;
      this.records = [created, ...this.records.filter((record) => record.avatarId !== created.avatarId)];
      fileInput.value = "";
      nameInput.value = "";
      this.requireElement             ("#avatarVaultFileLabel").textContent = "选择全身照片";
      this.setNotice(`“${created.name}”已进入重建队列。`, false);
      this.renderGallery();
      this.restartWatch(false, generation);
    } catch (error) {
      if (this.lifecycle.isCurrent(generation)) {
        this.setNotice(error instanceof Error ? error.message : "上传失败，请重试。", true);
      }
    } finally {
      if (this.lifecycle.isCurrent(generation)) {
        this.uploading = false;
        this.syncUploadButton();
      }
    }
  }

          renderGallery()       {
    this.captureRenameDraft();
    const list = this.requireElement             ("#avatarVaultList");
    const count = this.requireElement             ("#avatarVaultCount");
    count.textContent = String(this.records.length).padStart(2, "0");

    if (this.loadState === "loading") {
      list.innerHTML = `
        <div class="avatar-vault-loading" aria-label="正在加载分身档案">
          <i></i><i></i><i></i><span>正在读取服务器身份清单…</span>
        </div>`;
      return;
    }

    if ((this.loadState === "offline" || this.loadState === "error") && this.records.length === 0) {
      const offline = this.loadState === "offline";
      list.innerHTML = `
        <div class="avatar-vault-empty is-error">
          <span>${offline ? "SERVICE OFFLINE" : "REGISTRY ERROR"}</span>
          <strong>${offline ? "分身服务未连接" : "档案读取失败"}</strong>
          <p>${escapeHtml(this.loadError)}</p>
          <button type="button" class="secondary-button" data-retry-list>重新连接</button>
        </div>`;
      list.querySelector                   ("[data-retry-list]")?.addEventListener("click", () => this.restartWatch(true));
      return;
    }

    if (this.records.length === 0) {
      list.innerHTML = `
        <div class="avatar-vault-empty">
          <span>NO IDENTITY YET</span>
          <strong>建立第一份可复用身份</strong>
          <p>上传一张单人正面全身照。动作不写进身份，可在之后的训练中重复组合。</p>
          <button type="button" class="secondary-button" data-focus-upload>选择照片</button>
        </div>`;
      list.querySelector                   ("[data-focus-upload]")?.addEventListener("click", () => {
        this.requireElement                  ("#avatarVaultFile").click();
      });
      return;
    }

    const banner = this.loadState === "offline" || this.loadState === "error"
      ? `<div class="avatar-vault-inline-error"><span>${escapeHtml(this.loadError)}</span><button type="button" data-retry-list>重试同步</button></div>`
      : "";
    list.innerHTML = banner + this.records.map((record, index) => this.renderCard(record, index)).join("");
    list.querySelector                   ("[data-retry-list]")?.addEventListener("click", () => this.restartWatch());
    this.bindCardActions(list);
    this.restoreRenameDraftFocus();
  }

          renderCard(record                      , index        )         {
    const selected = record.avatarId === this.selectedId;
    const building = record.status === "queued" || record.status === "running";
    const ready = record.status === "ready" && Boolean(record.identityUrl);
    const failed = record.status === "error" || record.status === "cancelled";
    const progress = clamp(Math.round(record.progress || 0), 0, 100);
    // Cards show the original photo first; the rendered preview/snapshot is
    // only a fallback for identities without one (e.g. legacy migrations).
    const photoUrl = record.sourcePhoto && record.identityUrl
      ? `${record.identityUrl.slice(0, record.identityUrl.lastIndexOf("/") + 1)}${record.sourcePhoto}`
      : null;
    const preview = photoUrl
      ? `<img src="${escapeAttribute(photoUrl)}" alt="${escapeAttribute(record.name)} 的原始照片" loading="lazy" />`
      : record.previewUrl
        ? `<img src="${escapeAttribute(record.previewUrl)}" alt="${escapeAttribute(record.name)} 的重建预览" loading="lazy" />`
        : this.cardSnapshots.has(record.avatarId)
          ? `<img src="${this.cardSnapshots.get(record.avatarId) }" alt="${escapeAttribute(record.name)} 的实时渲染快照" loading="lazy" />`
          : `<div class="avatar-card-placeholder" aria-hidden="true"><b>${escapeHtml(record.name.trim().charAt(0).toUpperCase() || "?")}</b><span>NO PREVIEW · 待快照</span></div>`;
    const statusLabel = record.status === "queued" ? "QUEUED" : record.status.toUpperCase();
    const draft = this.renameDrafts.read(record.avatarId, record.name);
    const rename = this.renamingId === record.avatarId
      ? `<form class="avatar-card-rename" data-rename-form="${escapeAttribute(record.avatarId)}">
          <label for="rename-${escapeAttribute(record.avatarId)}">新名称</label>
          <input id="rename-${escapeAttribute(record.avatarId)}" data-rename-input value="${escapeAttribute(draft.value)}" maxlength="48" />
          <button type="submit">保存</button><button type="button" data-cancel-rename>取消</button>
        </form>`
      : "";
    const deletion = this.deletingId === record.avatarId
      ? `<div class="avatar-card-delete" role="alert">
          <p>将从身份库移除，并取消未完成绑定。已完成训练仍可播放。</p>
          <button type="button" data-confirm-delete="${escapeAttribute(record.avatarId)}">确认软删除</button>
          <button type="button" data-cancel-delete>保留</button>
        </div>`
      : "";

    return `
      <article class="avatar-card${selected ? " is-selected" : ""}${ready ? " is-ready" : ""}" style="--reveal-index:${index}">
        <button type="button" class="avatar-card-select" data-select-avatar="${escapeAttribute(record.avatarId)}" ${ready ? "" : "disabled"} aria-label="${ready ? `预览 ${escapeAttribute(record.name)}` : `${escapeAttribute(record.name)} 尚不可预览`}">
          <div class="avatar-card-image">${preview}<span>${statusLabel}</span></div>
          <div class="avatar-card-title"><strong>${escapeHtml(record.name)}</strong><small>${escapeHtml(record.avatarId)}</small></div>
        </button>
        <div class="avatar-card-data">
          <span>CREATED</span><b>${formatDate(record.createdAt)}</b>
          <span>3DGS</span><b>${ready ? "AVAILABLE" : building ? `${progress}%` : "UNAVAILABLE"}</b>
        </div>
        ${building ? `<div class="avatar-card-progress" aria-label="重建进度 ${progress}%"><i style="transform:scaleX(${progress / 100})"></i></div>` : ""}
        ${failed ? `<p class="avatar-card-error">${escapeHtml(record.error || "重建未完成，请换一张照片重新提交。")}</p>` : ""}
        <div class="avatar-card-actions">
          ${failed ? `<button type="button" data-replacement-upload>上传替代照片</button>` : ""}
          <button type="button" data-rename-avatar="${escapeAttribute(record.avatarId)}">重命名</button>
          <button type="button" data-delete-avatar="${escapeAttribute(record.avatarId)}">删除</button>
        </div>
        ${rename}${deletion}
      </article>`;
  }

          bindCardActions(list             )       {
    list.querySelectorAll                   ("[data-select-avatar]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.selectAvatar;
        if (!id || id === this.selectedId) return;
        this.selectedId = id;
        this.renderGallery();
        this.syncSelection();
      });
    });
    list.querySelectorAll                   ("[data-replacement-upload]").forEach((button) => {
      button.addEventListener("click", () => this.requireElement                  ("#avatarVaultFile").click());
    });
    list.querySelectorAll                   ("[data-rename-avatar]").forEach((button) => {
      button.addEventListener("click", () => {
        const nextId = button.dataset.renameAvatar ?? null;
        if (this.renamingId) this.renameDrafts.finish(this.renamingId);
        this.renamingId = nextId;
        const record = this.records.find((candidate) => candidate.avatarId === nextId);
        if (nextId && record) this.renameDrafts.begin(nextId, record.name);
        this.deletingId = null;
        this.renderGallery();
        this.el.querySelector                  ("[data-rename-input]")?.focus();
      });
    });
    list.querySelectorAll                   ("[data-delete-avatar]").forEach((button) => {
      button.addEventListener("click", () => {
        if (this.renamingId) this.renameDrafts.finish(this.renamingId);
        this.deletingId = button.dataset.deleteAvatar ?? null;
        this.renamingId = null;
        this.renderGallery();
        this.el.querySelector                   ("[data-confirm-delete]")?.focus();
      });
    });
    list.querySelectorAll                   ("[data-cancel-rename]").forEach((button) => {
      button.addEventListener("click", () => {
        if (this.renamingId) this.renameDrafts.finish(this.renamingId);
        this.renamingId = null;
        this.renderGallery();
      });
    });
    list.querySelectorAll                   ("[data-cancel-delete]").forEach((button) => {
      button.addEventListener("click", () => {
        this.deletingId = null;
        this.renderGallery();
      });
    });
    list.querySelectorAll                 ("[data-rename-form]").forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const id = form.dataset.renameForm;
        const input = form.querySelector                  ("[data-rename-input]");
        if (id && input) void this.renameAvatar(id, input.value);
      });
    });
    list.querySelectorAll                   ("[data-confirm-delete]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.confirmDelete;
        if (id) void this.deleteAvatar(id);
      });
    });
  }

          async renameAvatar(avatarId        , name        )                {
    const trimmed = name.trim();
    if (!trimmed) {
      this.setNotice("分身名称不能为空。", true);
      return;
    }
    const generation = this.lifecycle.capture();
    if (!this.lifecycle.isCurrent(generation)) return;
    try {
      const updated = await this.client.rename(avatarId, trimmed);
      if (!this.lifecycle.isCurrent(generation)) return;
      this.records = this.records.map((record) => record.avatarId === avatarId ? updated : record);
      this.renameDrafts.finish(avatarId);
      this.renamingId = null;
      this.setNotice(`已重命名为“${updated.name}”。`, false);
      this.renderGallery();
      if (this.selectedId === avatarId) this.renderPreviewMetadata(updated);
    } catch (error) {
      if (this.lifecycle.isCurrent(generation)) {
        this.setNotice(error instanceof Error ? error.message : "重命名失败。", true);
      }
    }
  }

          async deleteAvatar(avatarId        )                {
    const generation = this.lifecycle.capture();
    if (!this.lifecycle.isCurrent(generation)) return;
    try {
      await this.client.remove(avatarId);
      if (!this.lifecycle.isCurrent(generation)) return;
      this.records = this.records.filter((record) => record.avatarId !== avatarId);
      this.deletingId = null;
      if (this.selectedId === avatarId) {
        this.selectedId = null;
        this.disposePreview();
      }
      this.setNotice("身份已从档案库移除。", false);
      this.renderGallery();
      this.syncSelection();
    } catch (error) {
      if (this.lifecycle.isCurrent(generation)) {
        this.setNotice(error instanceof Error ? error.message : "删除失败。", true);
      }
    }
  }

          syncSelection()       {
    const selected = this.records.find((record) => record.avatarId === this.selectedId && isPreviewReady(record));
    const next = selected ?? this.records.find(isPreviewReady) ?? null;
    if (!next) {
      this.selectedId = null;
      this.disposePreview();
      this.renderPreviewStandby("等待 READY 档案", "重建完成后可拖拽旋转预览");
      return;
    }
    if (this.selectedId !== next.avatarId) {
      this.selectedId = next.avatarId;
      this.renderGallery();
    }
    if (this.activePreviewId !== next.avatarId) void this.mountPreview(next);
    else this.renderPreviewMetadata(next);
  }

          async mountPreview(record                      )                {
    const generation = this.lifecycle.capture();
    if (!this.lifecycle.isCurrent(generation)) return;
    this.disposePreview();
    const identityUrl = record.identityUrl;
    if (!identityUrl) return;
    const token = this.previewToken;
    this.activePreviewId = record.avatarId;
    this.renderPreviewStandby("载入 3DGS 身份…", "正在分配实时渲染资源");

    const canvas = this.requireElement                   ("#avatarPreviewCanvas");
    try {
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setClearColor(0xffffff, 0);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
      const grid = new THREE.GridHelper(4, 16, 0x111111, 0xbdb7aa);
      scene.add(grid);
      this.renderer = renderer;
      this.scene = scene;
      this.camera = camera;
      this.resizePreview();
      this.positionPreviewCamera();

      const avatar = await GaussianAvatar.loadIdentity(identityUrl);
      if (
        token !== this.previewToken ||
        this.activePreviewId !== record.avatarId ||
        !this.lifecycle.isCurrent(generation)
      ) {
        avatar.dispose();
        return;
      }
      this.previewAvatar = avatar;
      scene.add(avatar.object3d);
      // Identity-only previews have no motion translation to stand on: lift the
      // rest pose so the feet line sits exactly on the grid plane (y = 0).
      avatar.setBaseOffsetY(-avatar.restGroundY);
      // Arm a one-shot canvas snapshot for cards whose record lacks a preview.
      this.snapshotFramesLeft = !record.previewUrl && !this.cardSnapshots.has(record.avatarId) ? 6 : 0;
      const bufferSize = renderer.getDrawingBufferSize(new THREE.Vector2());
      avatar.setViewport(bufferSize.x, bufferSize.y);
      this.renderPreviewMetadata(record);
      this.requireElement             ("#avatarPreviewState").hidden = true;
      this.previewRaf = requestAnimationFrame(() => this.tickPreview());
    } catch (error) {
      if (token !== this.previewToken || !this.lifecycle.isCurrent(generation)) return;
      this.disposePreview();
      this.renderPreviewStandby(
        "3D 预览不可用",
        error instanceof Error ? error.message : "WebGL 初始化失败，档案管理仍可使用。",
        true,
      );
    }
  }

          tickPreview()       {
    if (!this.renderer || !this.scene || !this.camera || !this.previewAvatar) return;
    this.resizePreview();
    this.previewAvatar.update(this.camera);
    this.renderer.render(this.scene, this.camera);
    if (this.snapshotFramesLeft > 0) {
      this.snapshotFramesLeft -= 1;
      if (this.snapshotFramesLeft === 0) this.captureCardSnapshot();
    }
    this.previewRaf = requestAnimationFrame(() => this.tickPreview());
  }

  /** Snapshot the freshly rendered frame into the gallery card (same-task capture). */
          captureCardSnapshot()       {
    const avatarId = this.activePreviewId;
    if (!avatarId || this.cardSnapshots.has(avatarId)) return;
    const record = this.records.find((candidate) => candidate.avatarId === avatarId);
    if (!record || record.previewUrl) return;
    const canvas = this.requireElement                   ("#avatarPreviewCanvas");
    let dataUrl        ;
    try {
      dataUrl = canvas.toDataURL("image/png");
    } catch {
      return; // tainted or unreadable canvas: keep the placeholder
    }
    this.cardSnapshots.set(avatarId, dataUrl);
    const image = this.el.querySelector             (`[data-select-avatar="${avatarId}"] .avatar-card-image`);
    image?.querySelector(".avatar-card-placeholder")?.replaceWith(
      Object.assign(document.createElement("img"), {
        src: dataUrl,
        alt: `${record.name} 的实时渲染快照`,
      }),
    );
  }

          resizePreview()       {
    if (!this.renderer || !this.camera) return;
    const canvas = this.requireElement                   ("#avatarPreviewCanvas");
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const expectedWidth = Math.floor(width * pixelRatio);
    const expectedHeight = Math.floor(height * pixelRatio);
    if (canvas.width !== expectedWidth || canvas.height !== expectedHeight) {
      this.renderer.setPixelRatio(pixelRatio);
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      if (this.previewAvatar) {
        const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
        this.previewAvatar.setViewport(size.x, size.y);
      }
    }
  }

          positionPreviewCamera()       {
    if (!this.camera) return;
    const horizontal = Math.cos(this.pitch) * this.cameraDistance;
    this.camera.position.set(
      Math.sin(this.yaw) * horizontal,
      PREVIEW_TARGET_Y + Math.sin(this.pitch) * this.cameraDistance,
      Math.cos(this.yaw) * horizontal,
    );
    this.camera.lookAt(0, PREVIEW_TARGET_Y, 0);
  }

          disposePreview()       {
    this.previewToken += 1;
    this.activePreviewId = null;
    this.snapshotFramesLeft = 0;
    if (this.previewRaf) cancelAnimationFrame(this.previewRaf);
    this.previewRaf = 0;
    if (this.previewAvatar) {
      this.scene?.remove(this.previewAvatar.object3d);
      this.previewAvatar.dispose();
    }
    this.previewAvatar = null;
    this.renderer?.dispose();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.dragging = false;
  }

          renderPreviewMetadata(record                      )       {
    const meta = this.requireElement             ("#avatarPreviewMeta");
    meta.innerHTML = `
      <span>IDENTITY</span><b>${escapeHtml(record.name)}</b>
      <span>CREATED</span><b>${formatDate(record.createdAt)}</b>
      <span>ASSET</span><b>KINEXGI1</b>
      <span>RENDER</span><b>LIVE</b>`;
  }

          renderPreviewStandby(title        , detail        , isError = false)       {
    const state = this.requireElement             ("#avatarPreviewState");
    state.hidden = false;
    state.classList.toggle("is-error", isError);
    state.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span>`;
    this.requireElement             ("#avatarPreviewMeta").innerHTML = `
      <span>IDENTITY</span><b>未选择</b>
      <span>RENDER</span><b>${isError ? "UNAVAILABLE" : "STANDBY"}</b>`;
  }

          setNotice(message        , isError         )       {
    const notice = this.requireElement             ("#avatarVaultNotice");
    notice.hidden = false;
    notice.classList.toggle("is-error", isError);
    notice.textContent = message;
  }

          syncUploadButton()       {
    const button = this.requireElement                   ("#avatarVaultSubmit");
    button.disabled = this.uploading;
    button.textContent = this.uploading ? "上传中…" : "开始重建";
  }

          captureRenameDraft()       {
    if (!this.renamingId) return;
    const input = this.el.querySelector                  ("[data-rename-input]");
    if (!input) return;
    this.renameDrafts.capture(
      this.renamingId,
      input.value,
      document.activeElement === input,
      input.selectionStart,
      input.selectionEnd,
    );
  }

          restoreRenameDraftFocus()       {
    if (!this.renamingId) return;
    const draft = this.renameDrafts.read(this.renamingId, "");
    if (!draft.focused) return;
    const input = this.el.querySelector                  ("[data-rename-input]");
    if (!input) return;
    input.focus({ preventScroll: true });
    if (draft.selectionStart !== null && draft.selectionEnd !== null) {
      input.setSelectionRange(draft.selectionStart, draft.selectionEnd);
    }
  }

          requireElement                   (selector        )    {
    const element = this.el.querySelector   (selector);
    if (!element) throw new Error(`[AvatarVaultPage] missing ${selector}`);
    return element;
  }
}

function isPreviewReady(record                      )          {
  return record.status === "ready" && Boolean(record.identityUrl);
}

function clamp(value        , min        , max        )         {
  return Math.min(max, Math.max(min, value));
}

function formatDate(timestamp                    )         {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp * 1000));
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
