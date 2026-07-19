









const DRIFT_TOLERANCE_SEC = 0.2;

/** True when the media can actually be seeked to `target` — a [0,0] or empty
 * seekable list means the bytes came from a server without Range support. */
function canSeekTo(video                  , target        )          {
  const ranges = video.seekable;
  for (let index = 0; index < ranges.length; index += 1) {
    if (ranges.end(index) > 0.01 && target >= ranges.start(index) - 0.05 && target <= ranges.end(index) + 0.05) {
      return true;
    }
  }
  return false;
}

/**
 * Photoreal coach layer. The video element lives inside the stage bay where
 * CSS decides whether it is the full-bleed primary view or the corner
 * thumbnail; this class only manages sources and keeps playback in sync with
 * the RealtimeStream state (scrub / tempo / play-pause).
 */
export class CoachVideo {
          options                   ;
          sources                           = null;
          view             = "front";
          raf = 0;

  constructor(options                   ) {
    this.options = options;
    this.options.video.loop = true;
    this.options.video.muted = true;
    this.options.video.playsInline = true;
    this.tick = this.tick.bind(this);
    this.raf = requestAnimationFrame(this.tick);
  }

  hasVideo()          {
    return this.sources !== null;
  }

  setSources(sources                          )       {
    this.sources = sources;
    if (!sources) {
      this.options.video.removeAttribute("src");
      this.options.video.load();
      return;
    }
    this.applyViewSource();
  }

  setView(view            )       {
    if (this.view === view) return;
    this.view = view;
    this.applyViewSource();
  }

          applyViewSource()       {
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
        if (video.duration > 0 && canSeekTo(video, resumeAt * video.duration)) {
          video.currentTime = resumeAt * video.duration;
        }
      },
      { once: true },
    );
  }

          tick()       {
    this.raf = requestAnimationFrame(this.tick);
    const video = this.options.video;
    if (!this.sources) {
      if (!video.paused) video.pause();
      return;
    }
    const { progress, speed, playing, durationSeconds } = this.options.getPlayback();
    if (video.duration > 0) {
      // Track progress × videoDuration without periodic hard snaps: the raw
      // playbackRate must account for the clip/video length mismatch, not
      // just the tempo, or drift keeps tripping the 0.2s corrector.
      const rate = durationSeconds > 0 ? speed * (video.duration / durationSeconds) : speed;
      if (Math.abs(video.playbackRate - rate) > 0.01) video.playbackRate = rate;
      if (progress >= 1) {
        // Session end: pin the last frame instead of letting loop wrap fight
        // the drift corrector (that fight showed up as end-of-clip flicker).
        const end = Math.max(0, video.duration - 0.05);
        if (canSeekTo(video, end) && Math.abs(video.currentTime - end) > 0.05) {
          video.currentTime = end;
        }
        if (!video.paused) video.pause();
        return;
      }
      const target = progress * video.duration;
      // Never assign currentTime on unseekable media (e.g. served without
      // HTTP Range): on faststart files Chrome starts a seek it cannot
      // finish and the video freezes solid. Linear playback stays in sync
      // via the rate match above, so skipping the corrector is safe.
      if (Math.abs(video.currentTime - target) > DRIFT_TOLERANCE_SEC && canSeekTo(video, target)) {
        video.currentTime = target;
      }
    } else if (video.playbackRate !== speed) {
      video.playbackRate = speed;
    }
    if (playing && video.paused) void video.play().catch(() => undefined);
    else if (!playing && !video.paused) video.pause();
  }
}
