import type { CalibrationController, CalibrationStatus } from "../../core/scoring/CalibrationController.js";

interface CalibrationOverlayOptions {
  controller: CalibrationController;
  root: HTMLElement;
  title: HTMLElement;
  hint: HTMLElement;
  bar: HTMLElement;
  skipButton: HTMLButtonElement;
  doneButton: HTMLButtonElement;
  redoButton: HTMLButtonElement;
  onSkip(): void;
  onDismiss?(reason: "skip" | "done"): void;
}

export class CalibrationOverlay {
  private options: CalibrationOverlayOptions;

  constructor(options: CalibrationOverlayOptions) {
    this.options = options;
    this.options.skipButton.addEventListener("click", () => {
      this.options.controller.cancel();
      this.options.onSkip();
      this.hide();
      this.options.onDismiss?.("skip");
    });
    this.options.doneButton.addEventListener("click", () => {
      this.hide();
      this.options.onDismiss?.("done");
    });
    this.options.redoButton.addEventListener("click", () => {
      this.options.controller.start();
    });
    this.options.controller.onChange((status) => this.render(status));
    this.render(this.options.controller.getStatus());
  }

  private render(status: CalibrationStatus): void {
    switch (status.phase) {
      case "idle":
        this.hide();
        return;
      case "waiting":
        this.show();
        this.showSkipOnly();
        this.options.title.textContent = "等待全身入镜";
        this.options.hint.textContent = status.reason;
        this.options.bar.style.setProperty("--value", "0%");
        return;
      case "sampling":
        this.show();
        this.showSkipOnly();
        this.options.title.textContent = "采集体型中…";
        this.options.hint.textContent = "保持站立，约 1 秒";
        this.options.bar.style.setProperty("--value", `${Math.round(status.progress * 100)}%`);
        return;
      case "done":
        this.show();
        this.showDoneActions();
        this.options.title.textContent = "校准完成";
        this.options.hint.textContent = `身高 ${status.profile.heightMeters.toFixed(2)}m · 肩宽 ${status.profile.shoulderSpanMeters.toFixed(2)}m`;
        this.options.bar.style.setProperty("--value", "100%");
        return;
      case "failed":
        this.show();
        this.showRedoActions();
        this.options.title.textContent = "校准失败";
        this.options.hint.textContent = status.reason;
        this.options.bar.style.setProperty("--value", "0%");
        return;
    }
  }

  private show(): void {
    this.options.root.classList.add("is-visible");
  }

  private hide(): void {
    this.options.root.classList.remove("is-visible");
  }

  private showSkipOnly(): void {
    this.options.skipButton.hidden = false;
    this.options.doneButton.hidden = true;
    this.options.redoButton.hidden = true;
  }

  private showDoneActions(): void {
    this.options.skipButton.hidden = true;
    this.options.doneButton.hidden = false;
    this.options.redoButton.hidden = false;
  }

  private showRedoActions(): void {
    this.options.skipButton.hidden = false;
    this.options.doneButton.hidden = true;
    this.options.redoButton.hidden = false;
  }
}
