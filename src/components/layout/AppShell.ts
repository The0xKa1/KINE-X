import type { CameraView, MotionMode } from "../../types/motion.js";

interface AppShellOptions {
  railItems: HTMLButtonElement[];
  viewButtons: HTMLButtonElement[];
  playButton: HTMLButtonElement;
  playIcon: SVGElement;
  stressToggle: HTMLInputElement;
  speedSlider: HTMLInputElement;
  timeSlider: HTMLInputElement;
  cameraButton: HTMLButtonElement;
  onNavMode(mode: MotionMode): void;
  onRebuild(): void;
  onSafety(): void;
  onViewChange(view: CameraView): void;
  onPlayChange(playing: boolean): void;
  onStressChange(enabled: boolean): void;
  onSpeedChange(speed: number): void;
  onScrub(progress: number): void;
  onCameraToggle(): void;
}

export class AppShell {
  private options: AppShellOptions;
  private playing = true;

  constructor(options: AppShellOptions) {
    this.options = options;
    this.bind();
    this.renderPlayIcon();
  }

  setProgress(progress: number): void {
    this.options.timeSlider.value = String(Math.round(progress * 1000));
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

  private bind(): void {
    this.options.railItems.forEach((button) => {
      button.addEventListener("click", () => {
        this.options.railItems.forEach((item) => item.classList.remove("is-active"));
        button.classList.add("is-active");
        const nav = button.dataset.nav;
        if (nav === "seed") this.options.onNavMode("coach");
        else if (nav === "compare") this.options.onNavMode("stress");
        else if (nav === "rebuild") this.options.onRebuild();
        else if (nav === "score") this.options.onSafety();
      });
    });

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
    this.options.timeSlider.addEventListener("input", () => {
      this.setPlaying(false);
      this.options.onScrub(Number(this.options.timeSlider.value) / 1000);
    });
    this.options.cameraButton.addEventListener("click", () => this.options.onCameraToggle());
  }

  private renderPlayIcon(): void {
    this.options.playIcon.innerHTML = this.playing
      ? '<path d="M7 5h4v14H7zM13 5h4v14h-4z" />'
      : '<path d="m8 5 11 7-11 7V5Z" />';
  }
}
