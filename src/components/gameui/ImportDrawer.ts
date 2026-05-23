import { drawerStack } from "../../core/DrawerStack.js";
import { buildFrameThumbnailsFromMeta, loadCoachClip } from "../../core/import/loadCoachClip.js";
import { loadMeshClip, type MeshClip } from "../../core/import/MeshClip.js";
import type { CoachClip, SeedMotion } from "../../types/motion.js";

export interface ImportApplyPayload {
  id: string;
  name: string;
  clip: CoachClip;
  meshClip: MeshClip | null;
  motion: SeedMotion;
}

interface ImportJobResult {
  jobId: string;
  coachClipUrl: string;
  meshClipMetaUrl: string;
  framesDir: string;
  framePattern: string;
  frameCount: number;
  thumbnailCount?: number;
  durationSeconds: number;
  fps: number;
  name: string;
  motion: SeedMotion;
  elapsedSeconds?: number;
}

interface PendingImport {
  meta: ImportJobResult;
  clip: CoachClip;
  meshClip: MeshClip | null;
}

interface ImportDrawerOptions {
  drawer: HTMLElement;
  trigger: HTMLElement;
  closeButton: HTMLElement;
  fileInput: HTMLInputElement;
  dropZone: HTMLElement;
  motionSelect: HTMLSelectElement;
  startButton: HTMLButtonElement;
  applyButton: HTMLButtonElement;
  progressBar: HTMLElement;
  progressLabel: HTMLElement;
  statusLabel: HTMLElement;
  preview: HTMLVideoElement;
  backendUrl: string;
  onApply(payload: ImportApplyPayload): void;
}

const SIMULATED_DURATION_MS = 50_000;

export class ImportDrawer {
  private options: ImportDrawerOptions;
  private isOpen = false;
  private file: File | null = null;
  private pending: PendingImport | null = null;
  private busy = false;

  constructor(options: ImportDrawerOptions) {
    this.options = options;
    drawerStack.register({
      id: "import",
      onForceClose: () => {
        if (this.busy) return false;
        this.close();
      },
      trigger: this.options.trigger,
    });
    this.bindEvents();
    this.setStatus("等待上传视频");
    this.setProgress(0, 0);
    this.options.startButton.disabled = true;
    this.options.applyButton.disabled = true;
  }

  open(): void {
    this.isOpen = true;
    this.options.drawer.classList.add("is-open");
    drawerStack.open("import");
  }

  close(): void {
    if (this.busy) return;
    this.isOpen = false;
    this.options.drawer.classList.remove("is-open");
    drawerStack.close("import");
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  private bindEvents(): void {
    this.options.trigger.addEventListener("click", () => this.toggle());
    this.options.closeButton.addEventListener("click", () => this.close());

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
      if (next) {
        this.options.fileInput.files = e.dataTransfer!.files;
        this.handleFile(next);
      }
    });

    this.options.startButton.addEventListener("click", () => void this.runImport());
    this.options.applyButton.addEventListener("click", () => {
      if (!this.pending) return;
      const { meta, clip, meshClip } = this.pending;
      this.options.onApply({
        id: meta.jobId,
        name: meta.name,
        clip,
        meshClip,
        motion: meta.motion,
      });
    });
  }

  private handleFile(file: File | null): void {
    this.file = file;
    this.pending = null;
    this.options.applyButton.disabled = true;
    this.setProgress(0, 0);
    if (!file) {
      this.setStatus("等待上传视频");
      this.options.startButton.disabled = true;
      this.options.preview.removeAttribute("src");
      return;
    }
    this.setStatus(`已选择 ${file.name}`);
    this.options.startButton.disabled = false;
    const url = URL.createObjectURL(file);
    this.options.preview.src = url;
  }

  private async runImport(): Promise<void> {
    if (!this.file || this.busy) return;
    this.busy = true;
    this.options.startButton.disabled = true;
    this.options.applyButton.disabled = true;
    this.setStatus(`上传到 ${this.options.backendUrl}…`);
    this.setProgress(0.05);

    const form = new FormData();
    form.append("file", this.file);
    form.append("motion", this.options.motionSelect.value || "flow");
    form.append("name", stripExt(this.file.name));

    const stopSim = this.simulateProgress();
    try {
      const resp = await fetch(`${this.options.backendUrl}/import/video`, {
        method: "POST",
        body: form,
      });
      if (!resp.ok) {
        const text = await this.readError(resp);
        throw new Error(text);
      }
      const meta = (await resp.json()) as ImportJobResult;
      this.setStatus("加载教练资源…");
      this.setProgress(0.92);

      const clip = await loadCoachClip(meta.coachClipUrl);
      clip.thumbnails = buildFrameThumbnailsFromMeta({
        framesDir: meta.framesDir,
        framePattern: meta.framePattern,
        frameCount: meta.frameCount,
        thumbnailCount: meta.thumbnailCount,
      });

      let meshClip: MeshClip | null = null;
      try {
        meshClip = await loadMeshClip(meta.meshClipMetaUrl);
      } catch (err) {
        console.warn("[ImportDrawer] mesh clip load failed; skeleton-only result", err);
      }

      this.pending = { meta, clip, meshClip };
      this.setProgress(1);
      const elapsed = meta.elapsedSeconds ? ` · ${meta.elapsedSeconds.toFixed(1)}s` : "";
      this.setStatus(`就绪 · ${meta.name} · ${meta.frameCount} 帧${elapsed}`);
      this.options.applyButton.disabled = false;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[ImportDrawer] backend import failed", err);
      this.setStatus(`解析失败：${msg}`);
      this.setProgress(0);
    } finally {
      stopSim();
      this.options.startButton.disabled = false;
      this.busy = false;
    }
  }

  private simulateProgress(): () => void {
    const start = performance.now();
    const target = 0.9;
    let raf = 0;
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / SIMULATED_DURATION_MS);
      // Ease out so the first 50% climbs quickly, then we creep toward 90%.
      const eased = 1 - Math.pow(1 - t, 2);
      this.setProgress(0.05 + (target - 0.05) * eased);
      if (t < 1 && this.busy) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }

  private async readError(resp: Response): Promise<string> {
    try {
      const json = await resp.json();
      if (json && typeof json === "object" && "detail" in json) {
        const detail = (json as { detail: unknown }).detail;
        if (typeof detail === "string") return detail;
        if (detail && typeof detail === "object") {
          const obj = detail as { error?: string; stage?: string };
          return `${obj.stage ?? "pipeline"}: ${obj.error ?? "未知错误"}`;
        }
      }
      return `${resp.status} ${resp.statusText}`;
    } catch {
      return `${resp.status} ${resp.statusText}`;
    }
  }

  private setProgress(ratioOrDone: number, total?: number): void {
    let ratio: number;
    if (total === undefined) {
      ratio = Math.max(0, Math.min(1, ratioOrDone));
      this.options.progressLabel.textContent = ratio === 0 ? "—" : `${Math.round(ratio * 100)}%`;
    } else {
      ratio = total === 0 ? 0 : Math.min(1, ratioOrDone / total);
      this.options.progressLabel.textContent = total === 0 ? "—" : `${ratioOrDone} / ${total}`;
    }
    this.options.progressBar.style.width = `${(ratio * 100).toFixed(1)}%`;
  }

  private setStatus(text: string): void {
    this.options.statusLabel.textContent = text;
  }
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}
