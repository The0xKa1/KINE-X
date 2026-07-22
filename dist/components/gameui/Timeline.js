
import { prefersReducedMotion } from "../../core/motionPrefs.js?v=0.1.13";









const MOCK_FRAME_COUNT = 18;
const DRAG_THRESHOLD_PX = 4;

export class Timeline {
          options                 ;
          progress = 0;
          clip                   = null;
          buttons                      = [];
          activeIndex = -1;
          locked = false;
          playhead                ;
          dragState                                                                   = null;
          suppressClick = false;

  constructor(options                 ) {
    this.options = options;
    this.playhead = document.createElement("div");
    this.playhead.className = "timeline-playhead";
    this.playhead.setAttribute("aria-hidden", "true");
    this.options.bus.on("score:update", (payload) => this.handle(payload));
    this.options.bus.on("session:state", (payload) => this.setLocked(payload.phase === "active"));
    this.bindScrub();
    this.build();
  }

  setLabel(text        )       {
    this.options.label.textContent = text;
  }

  setClip(clip                  )       {
    this.clip = clip;
    this.build();
  }

  setLocked(locked         )       {
    if (this.locked === locked) return;
    this.locked = locked;
    this.options.container.classList.toggle("is-locked", locked);
  }

  /** Continuous playhead — the strip doubles as the single progress surface,
   * so it must track playback between discrete frame highlights. */
  setPlayhead(progress        )       {
    const clamped = Math.max(0, Math.min(1, progress));
    const x = clamped * this.options.container.scrollWidth;
    this.playhead.style.transform = `translateX(${x}px)`;
  }

          handle(payload             )       {
    this.progress = payload.progress;
    this.updateActive();
  }

          build()       {
    const container = this.options.container;
    container.innerHTML = "";
    this.buttons = [];
    this.activeIndex = -1;

    const thumbs = this.clip?.thumbnails;
    const count = thumbs && thumbs.length > 0 ? thumbs.length : MOCK_FRAME_COUNT;
    const lastIndex = Math.max(1, count - 1);

    for (let index = 0; index < count; index += 1) {
      const frameProgress = index / lastIndex;
      const button = document.createElement("button");
      button.type = "button";
      const classes = ["timeline-frame"];
      if (thumbs) {
        classes.push("has-thumb");
        button.style.backgroundImage = `url("${thumbs[index]}")`;
      } else {
        const energy = 18 + Math.round((Math.sin(frameProgress * Math.PI * 2 - Math.PI / 5) + 1) * 22);
        button.style.setProperty("--energy", `${energy}px`);
        button.style.setProperty(
          "--timeline-color",
          energy > 52 ? "rgba(255, 180, 72, 0.58)" : "rgba(40, 217, 202, 0.52)",
        );
      }
      button.className = classes.join(" ");
      button.innerHTML = `<span>${String(index + 1).padStart(2, "0")}</span>`;
      button.addEventListener("click", () => {
        if (this.locked) return;
        this.options.onScrub(frameProgress);
      });
      container.appendChild(button);
      this.buttons.push(button);
    }
    container.appendChild(this.playhead);
    this.setPlayhead(this.progress);
    this.updateActive();
  }

  /**
   * Drag anywhere on the strip to scrub continuously; a press that never
   * leaves the threshold stays a plain click on the frame button. Pointer
   * capture is only taken once the gesture becomes a scrub — taking it on
   * pointerdown would retarget the eventual click away from the button.
   */
          bindScrub()       {
    const container = this.options.container;
    container.addEventListener("pointerdown", (event) => {
      if (this.locked || event.button !== 0) return;
      this.dragState = { pointerId: event.pointerId, startX: event.clientX, scrubbing: false };
    });
    container.addEventListener("pointermove", (event) => {
      const drag = this.dragState;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!drag.scrubbing && Math.abs(event.clientX - drag.startX) >= DRAG_THRESHOLD_PX) {
        drag.scrubbing = true;
        try {
          container.setPointerCapture(event.pointerId);
        } catch {
          // Synthetic or already-released pointers can't be captured; scrub
          // still works while the pointer stays over the strip.
        }
      }
      if (drag.scrubbing) this.scrubAt(event.clientX);
    });
    const endDrag = (event              )       => {
      const drag = this.dragState;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (drag.scrubbing) this.suppressClick = true;
      this.dragState = null;
    };
    container.addEventListener("pointerup", endDrag);
    container.addEventListener("pointercancel", endDrag);
    container.addEventListener(
      "click",
      (event) => {
        if (!this.suppressClick) return;
        this.suppressClick = false;
        event.stopPropagation();
        event.preventDefault();
      },
      true,
    );
  }

          scrubAt(clientX        )       {
    const container = this.options.container;
    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left + container.scrollLeft;
    const progress = Math.max(0, Math.min(1, x / Math.max(1, container.scrollWidth)));
    this.options.onScrub(progress);
  }

          updateActive()       {
    const count = this.buttons.length;
    if (count === 0) return;
    const lastIndex = Math.max(0, count - 1);
    const idx = Math.min(lastIndex, Math.max(0, Math.round(this.progress * lastIndex)));
    if (idx === this.activeIndex) return;
    if (this.activeIndex >= 0) {
      this.buttons[this.activeIndex]?.classList.remove("is-active");
    }
    const next = this.buttons[idx];
    if (next) {
      next.classList.add("is-active");
      // While the user is drag-scrubbing they own the scroll position.
      if (!this.dragState?.scrubbing) this.scrollIntoView(next);
    }
    this.activeIndex = idx;
  }

          scrollIntoView(button                   )       {
    const container = this.options.container;
    const cLeft = container.scrollLeft;
    const cRight = cLeft + container.clientWidth;
    const bLeft = button.offsetLeft;
    const bRight = bLeft + button.offsetWidth;
    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    if (bLeft < cLeft) {
      container.scrollTo({ left: bLeft, behavior });
    } else if (bRight > cRight) {
      container.scrollTo({ left: bRight - container.clientWidth, behavior });
    }
  }
}
