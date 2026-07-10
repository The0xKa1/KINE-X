                                                       
                                                     
                                                         

                             
                
                       
                     
                     
                     
                 
                              
 

const PERFECT_THRESHOLD = 80;
const PERFECT_THROTTLE_MS = 600;
const COMBO_STEP = 2;
const COMBO_BASELINE = 5;
const COMBO_THROTTLE_MS = 1000;

export class ComboBurst {
          options                   ;
          lastBurst = 0;
          lastCombo = 0;
          lastComboTrigger = 0;
          bestCombo = 0;
          perfectFrames = 0;
          demoComboValue = 0;
          active = false;

  constructor(options                   ) {
    this.options = options;
    this.options.bus.on("score:update", (payload) => this.handle(payload));
    this.options.bus.on("session:state", (payload) => {
      if (payload.phase === "active") {
        this.reset();
        this.active = true;
      } else {
        this.active = false;
      }
    });
  }

  reset()       {
    this.lastBurst = 0;
    this.lastCombo = 0;
    this.lastComboTrigger = 0;
    this.bestCombo = 0;
    this.perfectFrames = 0;
    this.demoComboValue = 0;
  }

  getStats()                                               {
    return { bestCombo: this.bestCombo, perfectFrames: this.perfectFrames };
  }

  // Bypasses score/threshold logic — fires the cue stack unconditionally.
  // Used by demo buttons to drive the show without performing the exercise.
  triggerPerfectDemo()       {
    this.lastBurst = performance.now();
    this.perfectFrames += 1;
    this.fireBurst();
    this.spawnShards(8);
    this.options.audio.perfect();
  }

  triggerComboDemo()       {
    this.demoComboValue = (this.demoComboValue % 16) + 2;
    if (this.demoComboValue > this.bestCombo) this.bestCombo = this.demoComboValue;
    this.lastComboTrigger = performance.now();
    this.fireCombo(this.demoComboValue);
    this.options.audio.combo(this.demoComboValue);
  }

          handle(payload             )       {
    if (!this.active) return;
    const now = performance.now();
    if (payload.combo > this.bestCombo) this.bestCombo = payload.combo;
    if (payload.score >= PERFECT_THRESHOLD) {
      this.perfectFrames += 1;
      this.options.onPerfectFrame?.();
    }

    if (payload.score >= PERFECT_THRESHOLD && now - this.lastBurst > PERFECT_THROTTLE_MS) {
      this.lastBurst = now;
      this.fireBurst();
      this.spawnShards(6);
      this.options.audio.perfect();
    }

    if (
      payload.combo >= this.lastCombo + COMBO_STEP ||
      (payload.combo >= COMBO_BASELINE && now - this.lastComboTrigger > COMBO_THROTTLE_MS)
    ) {
      this.lastComboTrigger = now;
      this.fireCombo(payload.combo);
      this.options.audio.combo(payload.combo);
    }
    this.lastCombo = payload.combo;
  }

          fireBurst()       {
    this.replay(this.options.flash, "is-firing");
    this.replay(this.options.burst, "is-firing");
  }

          fireCombo(combo        )       {
    this.options.combo.textContent = `COMBO ×${String(combo).padStart(2, "0")}`;
    this.replay(this.options.combo, "is-firing");
  }

          spawnShards(count        )       {
    const layer = this.options.fxLayer;
    for (let i = 0; i < count; i += 1) {
      const dot = document.createElement("span");
      dot.className = "fx-shard";
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const distance = 110 + Math.random() * 80;
      dot.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
      dot.style.setProperty("--dy", `${Math.sin(angle) * distance}px`);
      dot.style.setProperty("--rot", `${Math.floor(Math.random() * 80) - 40}deg`);
      layer.appendChild(dot);
      window.setTimeout(() => dot.remove(), 900);
    }
  }

          replay(element             , className        )       {
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
  }
}
