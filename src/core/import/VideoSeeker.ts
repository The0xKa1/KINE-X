export interface VideoMeta {
  durationSeconds: number;
  videoWidth: number;
  videoHeight: number;
}

export type FrameVisitor = (
  video: HTMLVideoElement,
  videoTimeSeconds: number,
  index: number,
  total: number,
) => Promise<void> | void;

export class VideoSeeker {
  private file: File;
  private video: HTMLVideoElement | null = null;
  private objectUrl: string | null = null;
  private duration = 0;

  constructor(file: File) {
    this.file = file;
  }

  async load(): Promise<VideoMeta> {
    this.objectUrl = URL.createObjectURL(this.file);
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.setAttribute("playsinline", "true");
    video.src = this.objectUrl;
    this.video = video;

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        video.removeEventListener("loadeddata", onReady);
        video.removeEventListener("error", onErr);
      };
      const onReady = () => {
        if (video.readyState < 2) return;
        cleanup();
        resolve();
      };
      const onErr = () => {
        cleanup();
        reject(new Error("视频解码失败 (可能是不支持的格式)"));
      };
      video.addEventListener("loadeddata", onReady);
      video.addEventListener("error", onErr);
      if (video.readyState >= 2) onReady();
    });

    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error("无法读取视频时长");
    }
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      throw new Error("无法读取视频尺寸 (codec 可能不被浏览器支持)");
    }
    this.duration = video.duration;
    return {
      durationSeconds: video.duration,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
    };
  }

  getVideo(): HTMLVideoElement {
    if (!this.video) throw new Error("VideoSeeker not loaded");
    return this.video;
  }

  /**
   * Probe the source video's native frame rate by playing it briefly and
   * sampling `requestVideoFrameCallback` mediaTime deltas. Returns 30 when the
   * API is unavailable or playback fails (e.g. autoplay blocked).
   */
  async probeFps(): Promise<number> {
    if (!this.video) throw new Error("VideoSeeker not loaded");
    const video = this.video;
    if (typeof video.requestVideoFrameCallback !== "function") return 30;

    const SAMPLES = 8;
    const TIMEOUT_MS = 2500;

    return new Promise<number>((resolve) => {
      const deltas: number[] = [];
      let lastMediaTime = -1;
      let settled = false;
      const cleanup = (fps: number) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        try {
          video.pause();
          video.currentTime = 0;
        } catch {
          // ignore
        }
        resolve(fps);
      };
      const bestGuess = (): number => {
        if (deltas.length === 0) return 30;
        const sorted = [...deltas].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
        if (!(median > 0)) return 30;
        return Math.max(1, Math.round(1 / median));
      };
      const timer = window.setTimeout(() => cleanup(bestGuess()), TIMEOUT_MS);
      const onFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
        if (settled) return;
        if (lastMediaTime >= 0) {
          const delta = meta.mediaTime - lastMediaTime;
          if (delta > 0) deltas.push(delta);
        }
        lastMediaTime = meta.mediaTime;
        if (deltas.length < SAMPLES) {
          video.requestVideoFrameCallback(onFrame);
        } else {
          cleanup(bestGuess());
        }
      };
      try {
        video.muted = true;
        video.currentTime = 0;
      } catch {
        // ignore
      }
      video.requestVideoFrameCallback(onFrame);
      video.play().catch(() => cleanup(bestGuess()));
    });
  }

  async iterate(targetFps: number, visitor: FrameVisitor): Promise<void> {
    if (!this.video) throw new Error("VideoSeeker not loaded");
    const fps = Math.max(1, targetFps);
    const total = Math.max(1, Math.round(this.duration * fps));
    const step = this.duration / total;
    for (let i = 0; i < total; i += 1) {
      const t = Math.min(this.duration - 1 / fps / 2, i * step);
      await this.seekTo(t);
      await visitor(this.video, t, i, total);
    }
  }

  dispose(): void {
    if (this.video) {
      this.video.removeAttribute("src");
      this.video.load();
      this.video = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  private seekTo(time: number): Promise<void> {
    if (!this.video) throw new Error("VideoSeeker not loaded");
    const video = this.video;
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        video.removeEventListener("seeked", onSeeked);
        resolve();
      };
      const onSeeked = () => {
        const v = video as HTMLVideoElement & {
          requestVideoFrameCallback?: (cb: () => void) => number;
        };
        if (typeof v.requestVideoFrameCallback === "function") {
          let settled = false;
          const wrap = () => {
            if (settled) return;
            settled = true;
            finish();
          };
          v.requestVideoFrameCallback(wrap);
          // Failsafe: some browsers may not fire rVFC after a seek when the
          // element isn't actively playing. Bail out after a short timeout.
          window.setTimeout(wrap, 120);
        } else {
          finish();
        }
      };
      video.addEventListener("seeked", onSeeked);
      const target = Math.abs(video.currentTime - time) < 1e-4 ? time + 1e-3 : time;
      try {
        video.currentTime = target;
      } catch {
        finish();
      }
    });
  }
}
