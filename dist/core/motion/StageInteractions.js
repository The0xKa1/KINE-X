                                 
                    
                      
               
 

export class StageInteractions {
          canvas                   ;
          state                ;
          dragging = false;
          lastPointerX = 0;
          lastPointerY = 0;
  /** Timestamp of the last pointer/wheel input — drives the stage's idle sway. */
  lastInputAt = 0;

  constructor(canvas                   , state                ) {
    this.canvas = canvas;
    this.state = state;
    this.bind();
  }

  resetCameraOffsets()       {
    this.state.yawOffset = 0;
    this.state.pitchOffset = 0;
  }

          bind()       {
    this.canvas.addEventListener("pointerdown", (event) => {
      this.dragging = true;
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
      this.lastInputAt = performance.now();
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.dragging) return;
      const dx = event.clientX - this.lastPointerX;
      const dy = event.clientY - this.lastPointerY;
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
      this.lastInputAt = performance.now();
      this.state.yawOffset += dx * 0.008;
      this.state.pitchOffset = Math.max(-0.6, Math.min(0.6, this.state.pitchOffset + dy * 0.005));
    });
    const release = (event              ) => {
      this.dragging = false;
      try {
        this.canvas.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    };
    this.canvas.addEventListener("pointerup", release);
    this.canvas.addEventListener("pointercancel", release);
    this.canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.lastInputAt = performance.now();
        const factor = Math.exp(-event.deltaY * 0.0015);
        this.state.zoom = Math.max(0.55, Math.min(1.8, this.state.zoom * factor));
      },
      { passive: false },
    );
    this.canvas.addEventListener("dblclick", () => {
      this.lastInputAt = performance.now();
      this.state.yawOffset = 0;
      this.state.pitchOffset = 0;
      this.state.zoom = 1;
    });
  }
}
