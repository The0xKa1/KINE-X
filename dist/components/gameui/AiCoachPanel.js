                               
                    
                      
                        
                              
 

                     
                                   
                      
                     

export class AiCoachPanel {
          options                     ;
          controller                         = null;

  constructor(options                     ) {
    this.options = options;
    this.reset();
  }

  reset()       {
    this.cancel();
    this.options.textEl.textContent = "";
    this.options.textEl.classList.remove("is-done", "is-error");
    this.clearStatus();
    this.setStatus("idle");
  }

  renderStatic(text        , statusLabel         = "offline sample")       {
    this.cancel();
    this.options.textEl.textContent = text;
    this.options.textEl.classList.add("is-done");
    this.options.textEl.classList.remove("is-error");
    this.clearStatus();
    this.setStatus(statusLabel);
  }

  async renderStreaming(runner              , fallbackText        )                  {
    this.cancel();
    this.options.textEl.textContent = "";
    this.options.textEl.classList.remove("is-done", "is-error");
    this.clearStatus();
    this.setStatus("diagnosing");

    const controller = new AbortController();
    this.controller = controller;

    try {
      let received = 0;
      const finalText = await runner((delta) => {
        if (controller.signal.aborted) return;
        this.options.textEl.textContent = (this.options.textEl.textContent ?? "") + delta;
        received += delta.length;
      }, controller.signal);

      if (controller.signal.aborted) return "";
      if (received === 0) {
        this.options.textEl.textContent = fallbackText;
        this.options.textEl.classList.add("is-done");
        this.setStatus("empty · fallback");
        return fallbackText;
      }
      this.options.textEl.classList.add("is-done");
      this.setStatus("ready");
      return finalText || this.options.textEl.textContent || "";
    } catch (err) {
      if (controller.signal.aborted) return "";
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[AiCoachPanel] stream failed", err);
      this.options.textEl.textContent = fallbackText;
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
