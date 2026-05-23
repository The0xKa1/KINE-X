interface AiCoachPanelOptions {
  root: HTMLElement;
  textEl: HTMLElement;
  statusEl: HTMLElement;
}

type StreamRunner = (
  onDelta: (delta: string) => void,
  signal: AbortSignal,
) => Promise<string>;

export class AiCoachPanel {
  private options: AiCoachPanelOptions;
  private controller: AbortController | null = null;

  constructor(options: AiCoachPanelOptions) {
    this.options = options;
    this.reset();
  }

  reset(): void {
    this.cancel();
    this.options.textEl.textContent = "";
    this.options.textEl.classList.remove("is-done", "is-error");
    this.setStatus("idle");
  }

  renderStatic(text: string, statusLabel: string = "offline sample"): void {
    this.cancel();
    this.options.textEl.textContent = text;
    this.options.textEl.classList.add("is-done");
    this.options.textEl.classList.remove("is-error");
    this.setStatus(statusLabel);
  }

  async renderStreaming(runner: StreamRunner, fallbackText: string): Promise<void> {
    this.cancel();
    this.options.textEl.textContent = "";
    this.options.textEl.classList.remove("is-done", "is-error");
    this.setStatus("diagnosing");

    const controller = new AbortController();
    this.controller = controller;

    try {
      let received = 0;
      await runner((delta) => {
        if (controller.signal.aborted) return;
        this.options.textEl.textContent = (this.options.textEl.textContent ?? "") + delta;
        received += delta.length;
      }, controller.signal);

      if (controller.signal.aborted) return;
      if (received === 0) {
        this.options.textEl.textContent = fallbackText;
        this.options.textEl.classList.add("is-done");
        this.setStatus("empty · fallback");
        return;
      }
      this.options.textEl.classList.add("is-done");
      this.setStatus("ready");
    } catch (err) {
      if (controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[AiCoachPanel] stream failed", err);
      this.options.textEl.textContent = fallbackText;
      this.options.textEl.classList.add("is-done", "is-error");
      this.setStatus(`error · ${truncate(msg, 48)}`);
    } finally {
      if (this.controller === controller) {
        this.controller = null;
      }
    }
  }

  cancel(): void {
    if (this.controller) {
      this.controller.abort();
      this.controller = null;
    }
  }

  private setStatus(text: string): void {
    this.options.statusEl.textContent = text;
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
