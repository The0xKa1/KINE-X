import type { CameraView } from "../../types/motion.js";

interface AppShellOptions {
  viewButtons: HTMLButtonElement[];
  playButton: HTMLButtonElement;
  playIcon: SVGElement;
  stressToggle: HTMLInputElement;
  speedSlider: HTMLInputElement;
  cameraButton: HTMLButtonElement;
  onViewChange(view: CameraView): void;
  onPlayChange(playing: boolean): void;
  onStressChange(enabled: boolean): void;
  onSpeedChange(speed: number): void;
  onCameraToggle(): void;
}

export class AppShell {
  private options: AppShellOptions;
  private playing = true;
  private locked = false;

  constructor(options: AppShellOptions) {
    this.options = options;
    this.bind();
    this.renderPlayIcon();
  }

  setPlaying(playing: boolean, notify: boolean = true): void {
    if (this.playing === playing) return;
    this.playing = playing;
    this.renderPlayIcon();
    if (notify) this.options.onPlayChange(playing);
  }

  isPlaying(): boolean {
    return this.playing;
  }

  setControlsLocked(locked: boolean): void {
    if (this.locked === locked) return;
    this.locked = locked;
    // Note: speed slider stays live during active — users may want to dial
    // the coach tempo while performing.
    this.options.playButton.disabled = locked;
    this.options.playButton.classList.toggle("is-locked", locked);
  }

  isLocked(): boolean {
    return this.locked;
  }

  private bind(): void {
    this.options.viewButtons.forEach((button) => {
      button.addEventListener("click", () => {
        this.options.viewButtons.forEach((item) => item.classList.remove("is-active"));
        button.classList.add("is-active");
        this.options.onViewChange(button.dataset.view as CameraView);
      });
    });

    this.options.playButton.addEventListener("click", () => {
      this.setPlaying(!this.playing);
    });

    this.options.stressToggle.addEventListener("change", () => this.options.onStressChange(this.options.stressToggle.checked));
    this.options.speedSlider.addEventListener("input", () => this.options.onSpeedChange(Number(this.options.speedSlider.value) / 100));
    this.options.cameraButton.addEventListener("click", () => this.options.onCameraToggle());
  }

  private renderPlayIcon(): void {
    this.options.playIcon.innerHTML = this.playing
      ? '<path d="M7 5h4v14H7zM13 5h4v14h-4z" />'
      : '<path d="m8 5 11 7-11 7V5Z" />';
  }
}
