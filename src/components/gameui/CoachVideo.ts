import type { EventBus } from "../../core/EventBus.js";
import type { CameraView, CoachVideoSources } from "../../types/motion.js";

interface CoachVideoOptions {
  video: HTMLVideoElement;
  bus: EventBus;
  getPlayback: () => { progress: number; speed: number; playing: boolean };
  getView: () => CameraView;
}

const DRIFT_TOLERANCE_SEC = 0.2;

/**
 * Photoreal coach layer. The video element lives inside the stage bay where
 * CSS decides whether it is the full-bleed primary view or the corner
 * thumbnail; this class only manages sources and keeps playback in sync with
 * the RealtimeStream state (scrub / tempo / play-pause).
 */
export class CoachVideo {
  private options: CoachVideoOptions;
  private sources: CoachVideoSources | null = null;
  private view: CameraView = "front";
  private raf = 0;

  constructor(options: CoachVideoOptions) {
    this.options = options;
    this.options.video.loop = true;
    this.options.video.muted = true;
    this.options.video.playsInline = true;
    this.tick = this.tick.bind(this);
    this.raf = requestAnimationFrame(this.tick);
  }

  hasVideo(): boolean {
    return this.sources !== null;
  }

  setSources(sources: CoachVideoSources | null): void {
    this.sources = sources;
    if (!sources) {
      this.options.video.removeAttribute("src");
      this.options.video.load();
      return;
    }
    this.applyViewSource();
  }

  setView(view: CameraView): void {
    if (this.view === view) return;
    this.view = view;
    this.applyViewSource();
  }

  private applyViewSource(): void {
    if (!this.sources) return;
    const url =
      (this.view === "side" && this.sources.side) ||
      (this.view === "top" && this.sources.top)
        ? (this.view === "side" ? this.sources.side : this.sources.top)
        : this.sources.front;
    const video = this.options.video;
    if (!url || video.dataset.src === url) return;
    const resumeAt = video.duration > 0 ? video.currentTime / video.duration : 0;
    video.dataset.src = url;
    video.src = url;
    video.load();
    video.addEventListener(
      "loadedmetadata",
      () => {
        if (video.duration > 0) video.currentTime = resumeAt * video.duration;
      },
      { once: true },
    );
  }

  private tick(): void {
    this.raf = requestAnimationFrame(this.tick);
    const video = this.options.video;
    if (!this.sources) {
      if (!video.paused) video.pause();
      return;
    }
    const { progress, speed, playing } = this.options.getPlayback();
    if (video.duration > 0) {
      const target = progress * video.duration;
      if (Math.abs(video.currentTime - target) > DRIFT_TOLERANCE_SEC) {
        video.currentTime = target;
      }
    }
    if (video.playbackRate !== speed) video.playbackRate = speed;
    if (playing && video.paused) void video.play().catch(() => undefined);
    else if (!playing && !video.paused) video.pause();
  }
}
