/**
 * Photo → 3DGS avatar branch of the create wizard: pick one photo, name the
 * digital human, POST it to the LHM backend (`/import/avatar`), then poll
 * `/import/jobs` until the job lands. On completion the new KINEXGS1 binary
 * is attached to the target seed as its `avatarUrl` — the 分身 display mode
 * of that seed lights up.
 *
 * Backend job contract (kind === "avatar"):
 *   { jobId, kind, name, seedId, status, progress, avatarBinUrl?, error? }
 * status: "queued" | "running" | "done" | "error"; progress is 0..1.
 *
 * Local UI bring-up without a backend: `?mockAvatar=1` fakes the whole run
 * against the committed gs_avatar_coach.bin.
 */






































const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 8 * 60 * 1000;
const MOCK_DURATION_MS = 6000;
const MOCK_AVATAR_BIN = "public/coach_clips/gs_avatar_coach.bin";

export class AvatarImportFlow {
          options                         ;
          file              = null;
          busy = false;
          applied                            = null;
          pollTimer = 0;
          mockTimer = 0;
                   mock         ;

  constructor(options                         ) {
    this.options = options;
    this.mock = new URLSearchParams(window.location.search).get("mockAvatar") === "1";
    this.bindEvents();
    this.options.submitButton.disabled = true;
    this.options.enterButton.hidden = true;
    this.setStatus("等待选择照片");
    this.setProgress(0);
    this.emitState("empty");
  }

          emitState(state                 )       {
    this.options.onStateChange?.(state);
  }

          bindEvents()       {
    this.options.fileInput.addEventListener("change", () => {
      const next = this.options.fileInput.files?.[0] ?? null;
      this.handleFile(next);
    });

    const dz = this.options.dropZone;
    dz.addEventListener("dragover", (e) => {
      e.preventDefault();
      dz.classList.add("is-drag");
    });
    dz.addEventListener("dragleave", () => dz.classList.remove("is-drag"));
    dz.addEventListener("drop", (e) => {
      e.preventDefault();
      dz.classList.remove("is-drag");
      const next = e.dataTransfer?.files?.[0] ?? null;
      if (next && e.dataTransfer) {
        this.options.fileInput.files = e.dataTransfer.files;
        this.handleFile(next);
      }
    });

    this.options.submitButton.addEventListener("click", () => void this.runImport());
    this.options.enterButton.addEventListener("click", () => {
      if (this.applied) this.options.onEnter(this.applied);
    });
  }

          handleFile(file             )       {
    if (this.busy) return;
    this.file = file;
    this.applied = null;
    this.options.enterButton.hidden = true;
    this.setProgress(0);
    if (!file) {
      this.setStatus("等待选择照片");
      this.options.submitButton.disabled = true;
      this.options.preview.hidden = true;
      this.options.preview.removeAttribute("src");
      this.emitState("empty");
      return;
    }
    this.options.preview.src = URL.createObjectURL(file);
    this.options.preview.hidden = false;
    if (!this.options.nameInput.value.trim()) {
      this.options.nameInput.value = stripExt(file.name);
    }
    this.setStatus(`已选择 ${file.name}`);
    this.options.submitButton.disabled = false;
    this.emitState("photo");
  }

          async runImport()                {
    if (!this.file || this.busy) return;
    this.busy = true;
    this.applied = null;
    this.cancelTimers();
    this.options.submitButton.disabled = true;
    this.options.enterButton.hidden = true;
    this.emitState("building");
    const name = this.options.nameInput.value.trim() || stripExt(this.file.name) || "我的分身";
    try {
      const payload = this.mock
        ? await this.runMock(name)
        : await this.runReal(name);
      this.applied = payload;
      this.setProgress(1);
      this.setStatus(`生成完成 · ${payload.name} · 已挂到 UGC Squat`);
      this.options.enterButton.hidden = false;
      this.options.onReady(payload);
      this.emitState("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[AvatarImportFlow] avatar import failed", err);
      this.setStatus(`生成失败：${msg}（可重试）`);
      this.setProgress(0);
      this.options.submitButton.disabled = false;
      this.emitState("error");
    } finally {
      this.busy = false;
    }
  }

  /** Simulated end-to-end run for local UI bring-up (?mockAvatar=1). */
          runMock(name        )                              {
    this.setStatus("上传到 mock 重建后端…");
    const started = performance.now();
    return new Promise((resolve) => {
      const step = () => {
        const t = Math.min(1, (performance.now() - started) / MOCK_DURATION_MS);
        // Ease-out climb to 95%, then snap to done — same feel as polling.
        this.setProgress(t < 1 ? 0.05 + 0.9 * (1 - Math.pow(1 - t, 2)) : 1);
        if (t < 0.35) this.setStatus("上传到 mock 重建后端…");
        else if (t < 1) this.setStatus("LHM 重建高斯分身…（mock）");
        if (t < 1) {
          this.mockTimer = window.setTimeout(step, 120);
        } else {
          resolve({ seedId: this.options.seedId, name, avatarBinUrl: MOCK_AVATAR_BIN });
        }
      };
      step();
    });
  }

          async runReal(name        )                              {
    this.setStatus(`上传到 ${this.options.backendUrl}…`);
    this.setProgress(0.05);

    const form = new FormData();
    form.append("photo", this.file        );
    form.append("name", name);
    form.append("seedId", this.options.seedId);

    const resp = await fetch(`${this.options.backendUrl}/import/avatar`, {
      method: "POST",
      body: form,
    });
    if (!resp.ok) throw new Error(await this.readError(resp));
    const accepted = (await resp.json())             ;
    const jobId = accepted.jobId;
    if (!jobId) throw new Error("后端未返回 jobId");

    this.setStatus("LHM 重建高斯分身…");
    return this.pollJob(jobId, name);
  }

          pollJob(jobId        , name        )                              {
    const started = performance.now();
    return new Promise((resolve, reject) => {
      const tick = async () => {
        try {
          const resp = await fetch(`${this.options.backendUrl}/import/jobs`);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const payload = (await resp.json())                         ;
          const job = payload.jobs.find((entry) => entry.jobId === jobId);
          if (job) {
            if (typeof job.progress === "number") {
              // Backend reports 0-100; tolerate 0..1 too. Keep 5% headroom
              // for the upload step, then track the backend.
              const ratio = job.progress > 1 ? job.progress / 100 : job.progress;
              this.setProgress(Math.max(0.05, Math.min(1, ratio)));
            }
            if (job.status === "done" && job.avatarBinUrl) {
              resolve({ seedId: this.options.seedId, name, avatarBinUrl: job.avatarBinUrl });
              return;
            }
            if (job.status === "error" || job.status === "failed") {
              reject(new Error(job.error || "后端重建失败"));
              return;
            }
          }
          if (performance.now() - started > POLL_TIMEOUT_MS) {
            reject(new Error("等待后端超时（8 分钟）"));
            return;
          }
          this.pollTimer = window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };
      void tick();
    });
  }

          cancelTimers()       {
    if (this.pollTimer) {
      window.clearTimeout(this.pollTimer);
      this.pollTimer = 0;
    }
    if (this.mockTimer) {
      window.clearTimeout(this.mockTimer);
      this.mockTimer = 0;
    }
  }

          async readError(resp          )                  {
    try {
      const json = await resp.json();
      if (json && typeof json === "object" && "detail" in json) {
        const detail = (json                       ).detail;
        if (typeof detail === "string") return detail;
      }
      return `${resp.status} ${resp.statusText}`;
    } catch {
      return `${resp.status} ${resp.statusText}`;
    }
  }

          setProgress(ratio        )       {
    const clamped = Math.max(0, Math.min(1, ratio));
    this.options.progressLabel.textContent = clamped === 0 ? "—" : `${Math.round(clamped * 100)}%`;
    this.options.progressBar.style.width = `${(clamped * 100).toFixed(1)}%`;
  }

          setStatus(text        )       {
    this.options.statusLabel.textContent = text;
  }
}

function stripExt(name        )         {
  return name.replace(/\.[^.]+$/, "");
}
