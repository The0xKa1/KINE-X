import { prefersReducedMotion } from "../../core/motionPrefs.js";

                                                                    

                               
                    
                      
 

const ALL_CHECKS                 = ["clip", "mesh", "mediapipe", "stream"];
const ALL_CLEAR_DELAY_MS = 640;
const EXIT_MS = 560;

/**
 * Full-screen boot overlay driven by real startup milestones (main.ts calls
 * `tick` as each subsystem reports in). Finishes when every check landed, on
 * click-to-skip, or on a failsafe timeout so the app can never hang behind
 * the overlay.
 */
export class BootSequence {
          options                     ;
          finished = false;
          pending                   ;
          failsafe        ;

  constructor(options                     ) {
    this.options = options;
    this.pending = new Set(ALL_CHECKS);
    this.options.root.addEventListener("click", () => this.finish());
    this.failsafe = window.setTimeout(() => this.finish(), this.options.failsafeMs ?? 9000);
    if (prefersReducedMotion()) {
      window.setTimeout(() => this.finish(), 240);
    }
  }

  tick(check              , status        )       {
    if (this.finished) return;
    const item = this.options.root.querySelector(`[data-check="${check}"]`);
    if (item) {
      item.classList.add("is-ok");
      const label = item.querySelector("b");
      if (label) label.textContent = status;
    }
    this.pending.delete(check);
    if (this.pending.size === 0) {
      window.setTimeout(() => this.finish(), ALL_CLEAR_DELAY_MS);
    }
  }

  finish()       {
    if (this.finished) return;
    this.finished = true;
    window.clearTimeout(this.failsafe);
    const root = this.options.root;
    document.body.classList.remove("boot-pending");
    document.body.classList.add("boot-done");
    if (prefersReducedMotion()) {
      root.remove();
      return;
    }
    root.classList.add("is-exiting");
    window.setTimeout(() => root.remove(), EXIT_MS);
  }
}
