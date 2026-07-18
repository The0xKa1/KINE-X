                                                       
                                                                           

                             
                          
                     
                
                                                                           
                            
 

const DRIFT_TOLERANCE_SEC = 0.2;

/**
 * Photoreal coach layer living in its own "digital twin" bay. Scrub / tempo /
 * play state stay in sync with the RealtimeStream playback state; angle
 * variants (front/side/top) swap sources when they exist.
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

  setSources(sources                          )       {
    this.sources = sources;
    this.options.empty.classList.toggle("is-hidden", sources !== null);
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
        if (video.duration > 0) video.currentTime = resumeAt * video.duration;
      },
      { once: true },
    );
  }

          isActive()          {
    // The twin bay is dedicated to the photoreal coach — it plays whenever the
    // seed ships a video, regardless of the blueprint's render mode or view.
    return this.sources !== null;
  }

          tick()       {
    this.raf = requestAnimationFrame(this.tick);
    const video = this.options.video;
    const active = this.isActive();
    video.classList.toggle("is-active", active);
    if (!active) {
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
