import { buildFrameThumbnailsFromMeta, loadCoachClip } from "./loadCoachClip.js";
import { loadMeshClip, type MeshClip } from "./MeshClip.js";
import { VideoSeeker } from "./VideoSeeker.js";
import { SegmentResourceStore, type SegmentResource } from "../mllm/SegmentResourceStore.js";
import {
  VideoSegmentationClient,
  sampleFramesAtInterval,
  type MllmVideoSegment,
} from "../mllm/VideoSegmentationClient.js";
import type { CoachClip, SeedMotion } from "../../types/motion.js";

const SEGMENT_SAMPLE_INTERVAL_SEC = 1.5;
const SEGMENT_THUMB_MAX_WIDTH = 160;

export interface ImportApplyPayload {
  id: string;
  name: string;
  clip: CoachClip;
  meshClip: MeshClip | null;
  motion: SeedMotion;
  /** User-facing coaching hint derived from MLLM segment metadata. */
  hint?: string | undefined;
}

export type ImportFlowState =
  | "empty"
  | "file"
  | "segmenting"
  | "segmented"
  | "parsing"
  | "ready"
  | "applied"
  | "error";

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

export interface ImportFlowOptions {
  fileInput: HTMLInputElement;
  dropZone: HTMLElement;
  motionSelect: HTMLSelectElement;
  startButton: HTMLButtonElement;
  applyButton: HTMLButtonElement;
  segmentButton: HTMLButtonElement;
  segmentList: HTMLElement;
  segmentSummary: HTMLElement;
  progressBar: HTMLElement;
  progressLabel: HTMLElement;
  statusLabel: HTMLElement;
  preview: HTMLVideoElement;
  backendUrl: string;
  onApply(payload: ImportApplyPayload): void;
  onStateChange?(state: ImportFlowState): void;
}

const SIMULATED_DURATION_MS = 50_000;

/**
 * Container-agnostic video → CoachClip import flow: file handling, optional
 * MLLM segmentation, backend upload, result hydration. Drives whatever DOM it
 * is handed (the create page wizard today; a drawer before that).
 */
export class ImportFlow {
  private options: ImportFlowOptions;
  private file: File | null = null;
  private pending: PendingImport | null = null;
  private busy = false;
  private segmentClient = new VideoSegmentationClient();
  private resourceStore = new SegmentResourceStore();
  private selectedSegment: MllmVideoSegment | null = null;

  constructor(options: ImportFlowOptions) {
    this.options = options;
    this.bindEvents();
    this.setStatus("等待上传视频");
    this.setProgress(0, 0);
    this.options.startButton.disabled = true;
    this.options.applyButton.disabled = true;
    this.options.segmentButton.disabled = true;
    this.renderSegments([]);
    this.emitState("empty");
  }

  private emitState(state: ImportFlowState): void {
    this.options.onStateChange?.(state);
  }

  private bindEvents(): void {
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

    this.options.segmentButton.addEventListener("click", () => void this.runSegmentation());
    this.options.startButton.addEventListener("click", () => void this.runImport());
    this.options.applyButton.addEventListener("click", () => {
      if (!this.pending) return;
      const { meta, clip, meshClip } = this.pending;
      this.emitState("applied");
      this.options.onApply({
        id: meta.jobId,
        name: meta.name,
        clip,
        meshClip,
        motion: meta.motion,
        hint: buildHint(this.selectedSegment),
      });
    });
  }

  private handleFile(file: File | null): void {
    this.file = file;
    this.pending = null;
    this.selectedSegment = null;
    this.resourceStore.clear();
    this.renderSegments([]);
    this.options.applyButton.disabled = true;
    this.setProgress(0, 0);
    if (!file) {
      this.setStatus("等待上传视频");
      this.options.startButton.disabled = true;
      this.options.segmentButton.disabled = true;
      this.options.preview.removeAttribute("src");
      this.emitState("empty");
      return;
    }
    this.setStatus(`已选择 ${file.name}`);
    this.options.startButton.disabled = false;
    this.options.segmentButton.disabled = false;
    this.options.preview.src = URL.createObjectURL(file);
    this.emitState("file");
  }

  private async runSegmentation(): Promise<void> {
    if (!this.file || this.busy) return;
    this.busy = true;
    this.options.segmentButton.disabled = true;
    this.options.startButton.disabled = true;
    this.options.applyButton.disabled = true;
    this.selectedSegment = null;
    this.renderSegments([]);
    this.setStatus("采样关键帧…");
    this.setProgress(0.1);
    this.emitState("segmenting");

    const seeker = new VideoSeeker(this.file);
    try {
      const meta = await seeker.load();
      const frames = await sampleFramesAtInterval(seeker, SEGMENT_SAMPLE_INTERVAL_SEC);
      this.setStatus(`已采样 ${frames.length} 帧，调用 MLLM 分段…`);
      this.setProgress(0.45);

      const result = await this.segmentClient.segmentVideo({
        fileName: this.file.name,
        durationSeconds: meta.durationSeconds,
        frames,
      });

      this.setStatus("生成 segment 缩略图…");
      this.setProgress(0.85);
      const thumbnails = await this.buildSegmentThumbnails(seeker, result.segments);

      const resources = this.resourceStore.replace(this.file, result, thumbnails);
      this.renderSegments(resources);
      this.setStatus(`分段完成 · ${resources.length} 段`);
      this.setProgress(1);
      this.emitState("segmented");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[ImportFlow] MLLM segmentation failed", err);
      this.setStatus(`分段失败：${msg}`);
      this.setProgress(0);
      this.renderSegments([]);
      this.emitState("error");
    } finally {
      seeker.dispose();
      this.busy = false;
      this.options.segmentButton.disabled = this.file === null;
      this.options.startButton.disabled = this.file === null;
    }
  }

  private async buildSegmentThumbnails(
    seeker: VideoSeeker,
    segments: MllmVideoSegment[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (segments.length === 0) return out;
    const video = seeker.getVideo();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return out;
    for (const segment of segments) {
      const midpoint = (segment.startSec + segment.endSec) / 2;
      try {
        await seeker.iterateRange(midpoint, midpoint + 0.01, 30, (v) => {
          const vw = v.videoWidth || 320;
          const vh = v.videoHeight || 180;
          const scale = Math.min(1, SEGMENT_THUMB_MAX_WIDTH / vw);
          canvas.width = Math.max(1, Math.round(vw * scale));
          canvas.height = Math.max(1, Math.round(vh * scale));
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          out.set(segment.id, canvas.toDataURL("image/jpeg", 0.7));
        });
      } catch {
        // Drop this thumbnail — segment will render without preview.
      }
    }
    return out;
  }

  private renderSegments(resources: SegmentResource[]): void {
    const list = this.options.segmentList;
    list.textContent = "";
    list.classList.toggle("is-empty", resources.length === 0);

    if (resources.length === 0) {
      const result = this.resourceStore.all();
      this.options.segmentSummary.textContent =
        result.length === 0 ? "" : result[0]?.summary ?? "";
      return;
    }

    this.options.segmentSummary.textContent = resources[0]?.summary ?? "";

    for (const resource of resources) {
      const { segment } = resource;
      const card = document.createElement("button");
      card.type = "button";
      card.className = "segment-card";
      card.dataset.segmentId = segment.id;
      if (this.selectedSegment?.id === segment.id) card.classList.add("is-selected");

      if (resource.thumbnail) {
        const img = document.createElement("img");
        img.src = resource.thumbnail;
        img.alt = segment.actionLabel;
        img.className = "segment-thumb";
        card.appendChild(img);
      }

      const body = document.createElement("div");
      body.className = "segment-body";

      const title = document.createElement("div");
      title.className = "segment-title";
      title.textContent = segment.actionLabel || segment.name;
      body.appendChild(title);

      const range = document.createElement("div");
      range.className = "segment-range";
      range.textContent = `${segment.startSec.toFixed(1)}s → ${segment.endSec.toFixed(1)}s · ${(
        segment.endSec - segment.startSec
      ).toFixed(1)}s`;
      body.appendChild(range);

      if (segment.notes) {
        const notes = document.createElement("div");
        notes.className = "segment-notes";
        notes.textContent = segment.notes;
        body.appendChild(notes);
      }

      card.appendChild(body);
      card.addEventListener("click", () => this.selectSegment(segment));
      list.appendChild(card);
    }
  }

  private selectSegment(segment: MllmVideoSegment): void {
    this.selectedSegment = segment;
    this.renderSegments(this.resourceStore.all());
    // Let the MLLM's understanding flow downstream: pre-fill the motion type
    // so the backend + scoring templates inherit it.
    const inferred = inferMotionFromSegment(segment);
    if (inferred) this.options.motionSelect.value = inferred;
    const range = `${segment.startSec.toFixed(1)}s → ${segment.endSec.toFixed(1)}s`;
    this.setStatus(`已选段 ${segment.actionLabel} (${range})`);
  }

  private async runImport(): Promise<void> {
    if (!this.file || this.busy) return;
    this.busy = true;
    this.options.startButton.disabled = true;
    this.options.applyButton.disabled = true;
    this.options.segmentButton.disabled = true;
    this.emitState("parsing");
    const segment = this.selectedSegment;
    const range = segment
      ? ` · ${segment.startSec.toFixed(1)}s–${segment.endSec.toFixed(1)}s`
      : "";
    this.setStatus(`上传到 ${this.options.backendUrl}${range}…`);
    this.setProgress(0.05);

    const form = new FormData();
    form.append("file", this.file);
    form.append("motion", this.options.motionSelect.value || "flow");
    // Prefer the MLLM's action label over the raw filename for the seed name.
    form.append("name", segment?.actionLabel || segment?.name || stripExt(this.file.name));
    if (segment) {
      form.append("startSec", segment.startSec.toFixed(3));
      form.append("endSec", segment.endSec.toFixed(3));
    }

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
        console.warn("[ImportFlow] mesh clip load failed; skeleton-only result", err);
      }

      this.pending = { meta, clip, meshClip };
      this.setProgress(1);
      const elapsed = meta.elapsedSeconds ? ` · ${meta.elapsedSeconds.toFixed(1)}s` : "";
      this.setStatus(`就绪 · ${meta.name} · ${meta.frameCount} 帧${elapsed}`);
      this.options.applyButton.disabled = false;
      this.emitState("ready");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[ImportFlow] backend import failed", err);
      this.setStatus(`解析失败：${msg}`);
      this.setProgress(0);
      this.emitState("error");
    } finally {
      stopSim();
      this.options.startButton.disabled = false;
      this.options.segmentButton.disabled = this.file === null;
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

/** Maps the MLLM's semantic labels onto our scoring motion categories. */
function inferMotionFromSegment(segment: MllmVideoSegment): SeedMotion | null {
  const text = `${segment.actionLabel} ${segment.name} ${segment.notes}`.toLowerCase();
  if (/投掷|投篮|出手|throw|shoot/.test(text)) return "throw";
  if (/跳跃|跳绳|跳操|bounce|jump/.test(text)) return "bounce";
  if (/硬拉|髋铰|俯身划船|deadlift|hinge/.test(text)) return "hinge";
  if (/深蹲|下蹲|蹲起|squat/.test(text)) return "squat";
  if (/八段锦|太极|瑜伽|舞蹈|flow|yoga|taichi/.test(text)) return "flow";
  return null;
}

/** Builds the user-facing coaching hint from MLLM segment metadata. */
function buildHint(segment: MllmVideoSegment | null): string | undefined {
  if (!segment) return undefined;
  const parts: string[] = [];
  const difficulty = segment.metadata["难度"];
  const focus = segment.metadata["核心受力部位"];
  if (difficulty) parts.push(`难度${difficulty}`);
  if (focus) parts.push(focus);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
