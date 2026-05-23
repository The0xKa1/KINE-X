                               
                    
                      
                        
 

                     
                                   
                      
                     

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
    this.setStatus("idle");
  }

  renderStatic(text        , statusLabel         = "offline sample")       {
    this.cancel();
    this.options.textEl.textContent = text;
    this.options.textEl.classList.add("is-done");
    this.options.textEl.classList.remove("is-error");
    this.setStatus(statusLabel);
  }

  async renderStreaming(runner              , fallbackText        )                {
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

  cancel()       {
    if (this.controller) {
      this.controller.abort();
      this.controller = null;
    }
  }

          setStatus(text        )       {
    this.options.statusEl.textContent = text;
  }
}

function truncate(text        , max        )         {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
