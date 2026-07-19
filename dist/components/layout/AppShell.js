

















export class AppShell {
          options                 ;
          playing = true;
          locked = false;

  constructor(options                 ) {
    this.options = options;
    this.bind();
    this.renderPlayIcon();
  }

  setProgress(progress        )       {
    this.options.timeSlider.value = String(Math.round(progress * 1000));
  }

  setPlaying(playing         , notify          = true)       {
    if (this.playing === playing) return;
    this.playing = playing;
    this.renderPlayIcon();
    if (notify) this.options.onPlayChange(playing);
  }

  isPlaying()          {
    return this.playing;
  }

  setControlsLocked(locked         )       {
    if (this.locked === locked) return;
    this.locked = locked;
    // Note: speed slider stays live during active — users may want to dial
    // the coach tempo while performing.
    this.options.playButton.disabled = locked;
    this.options.timeSlider.disabled = locked;
    this.options.playButton.classList.toggle("is-locked", locked);
    this.options.timeSlider.classList.toggle("is-locked", locked);
  }

  isLocked()          {
    return this.locked;
  }

          bind()       {
    this.options.viewButtons.forEach((button) => {
      button.addEventListener("click", () => {
        this.options.viewButtons.forEach((item) => item.classList.remove("is-active"));
        button.classList.add("is-active");
        this.options.onViewChange(button.dataset.view              );
      });
    });

    this.options.playButton.addEventListener("click", () => {
      this.setPlaying(!this.playing);
    });

    this.options.stressToggle.addEventListener("change", () => this.options.onStressChange(this.options.stressToggle.checked));
    this.options.speedSlider.addEventListener("input", () => this.options.onSpeedChange(Number(this.options.speedSlider.value) / 100));
    this.options.timeSlider.addEventListener("input", () => {
      this.setPlaying(false);
      this.options.onScrub(Number(this.options.timeSlider.value) / 1000);
    });
    this.options.cameraButton.addEventListener("click", () => this.options.onCameraToggle());
  }

          renderPlayIcon()       {
    this.options.playIcon.innerHTML = this.playing
      ? '<path d="M7 5h4v14H7zM13 5h4v14h-4z" />'
      : '<path d="m8 5 11 7-11 7V5Z" />';
  }
}
