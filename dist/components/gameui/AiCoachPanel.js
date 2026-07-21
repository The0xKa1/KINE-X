






import { renderMarkdown } from "../../core/llm/renderMarkdown.js?v=0.1.6";






export class AiCoachPanel {
          options                     ;
          controller                         = null;
          rawText = "";

  constructor(options                     ) {
    this.options = options;
    this.reset();
  }

  reset()       {
    this.cancel();
    this.rawText = "";
    this.options.textEl.replaceChildren();
    this.options.textEl.classList.remove("is-done", "is-error");
    this.clearStatus();
    this.setStatus("idle");
  }

  renderStatic(text        , statusLabel         = "offline sample")       {
    this.cancel();
    this.rawText = text;
    this.options.textEl.innerHTML = renderMarkdown(text);
    this.options.textEl.classList.add("is-done");
    this.options.textEl.classList.remove("is-error");
    this.clearStatus();
    this.setStatus(statusLabel);
  }

  renderSetupRequired(text        )       {
    this.renderStatic(text, "");
    this.clearStatus();
    const prefix = document.createElement("span");
    prefix.textContent = "API 未配置 · ";
    this.options.statusEl.appendChild(prefix);
    if (!this.options.onOpenSettings) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "results-ai-action";
    button.textContent = "去设置 →";
    button.addEventListener("click", () => this.options.onOpenSettings?.());
    this.options.statusEl.appendChild(button);
  }

  async renderStreaming(runner              , fallbackText        )                  {
    this.cancel();
    this.rawText = "";
    this.options.textEl.replaceChildren();
    this.options.textEl.classList.remove("is-done", "is-error");
    this.clearStatus();
    this.setStatus("diagnosing");

    const controller = new AbortController();
    this.controller = controller;

    try {
      let received = 0;
      const finalText = await runner((delta) => {
        if (controller.signal.aborted) return;
        const el = this.options.textEl;
        const stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 16;
        this.rawText += delta;
        el.innerHTML = renderMarkdown(this.rawText);
        received += delta.length;
        if (stickToBottom) el.scrollTop = el.scrollHeight;
      }, controller.signal);

      if (controller.signal.aborted) return "";
      if (received === 0) {
        this.rawText = fallbackText;
        this.options.textEl.innerHTML = renderMarkdown(fallbackText);
        this.options.textEl.classList.add("is-done");
        this.setStatus("empty · fallback");
        return fallbackText;
      }
      this.options.textEl.classList.add("is-done");
      this.setStatus("ready");
      return finalText || this.rawText || "";
    } catch (err) {
      if (controller.signal.aborted) return "";
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[AiCoachPanel] stream failed", err);
      this.rawText = fallbackText;
      this.options.textEl.innerHTML = renderMarkdown(fallbackText);
      this.options.textEl.classList.add("is-done", "is-error");
      this.renderErrorStatus(msg);
      return "";
    } finally {
      if (this.controller === controller) {
        this.controller = null;
      }
    }
  }

  cancel()       {
    if (this.controller) {
      this.controller.abort();
      this.controller = null;
    }
  }

          setStatus(text        )       {
    this.options.statusEl.textContent = text;
  }

          clearStatus()       {
    this.options.statusEl.replaceChildren();
  }

          renderErrorStatus(message        )       {
    this.clearStatus();
    const onOpenSettings = this.options.onOpenSettings;
    if (!onOpenSettings) {
      this.setStatus(`error · ${truncate(message, 48)}`);
      return;
    }
    const link = document.createElement("button");
    link.type = "button";
    link.className = "results-ai-action";
    link.textContent = "去设置 API Key →";
    link.addEventListener("click", () => onOpenSettings());
    const prefix = document.createElement("span");
    prefix.textContent = `error · ${truncate(message, 32)} · `;
    this.options.statusEl.appendChild(prefix);
    this.options.statusEl.appendChild(link);
  }
}

function truncate(text        , max        )         {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
