

export class AudioFx {
          context                  = null;
          master                  = null;
          bgmTimer = 0;
          bgmRunning = false;

  enable()       {
    if (this.context) return;
    const Ctor = window.AudioContext ?? (window                                                           ).webkitAudioContext;
    if (!Ctor) return;
    this.context = new Ctor();
    this.master = this.context.createGain();
    this.master.gain.value = 0.32;
    this.master.connect(this.context.destination);
  }

  resume()       {
    if (this.context && this.context.state === "suspended") {
      void this.context.resume();
    }
  }

  perfect()       {
    const ctx = this.context;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    [880, 1320, 1760].forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now + index * 0.04);
      gain.gain.setValueAtTime(0, now + index * 0.04);
      gain.gain.linearRampToValueAtTime(0.4, now + index * 0.04 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.04 + 0.45);
      osc.connect(gain).connect(this.master );
      osc.start(now + index * 0.04);
      osc.stop(now + index * 0.04 + 0.5);
    });
  }

  combo(value        )       {
    const ctx = this.context;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    const base = 110 + Math.min(20, value) * 12;
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(base * 1.6, now + 0.18);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1800;
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.36);
  }

  seedActivate()       {
    const ctx = this.context;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    [220, 330, 440, 660].forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + index * 0.05);
      gain.gain.setValueAtTime(0, now + index * 0.05);
      gain.gain.linearRampToValueAtTime(0.18, now + index * 0.05 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.05 + 0.5);
      osc.connect(gain).connect(this.master );
      osc.start(now + index * 0.05);
      osc.stop(now + index * 0.05 + 0.55);
    });
  }

  startBgm(bpm        )       {
    const ctx = this.context;
    if (!ctx || !this.master) return;
    if (this.bgmRunning) this.stopBgm();
    this.bgmRunning = true;
    const interval = (60 / Math.max(50, bpm)) * 1000;
    let beat = 0;
    this.bgmTimer = window.setInterval(() => {
      if (!this.bgmRunning) return;
      this.kick(beat);
      beat += 1;
    }, interval);
  }

  stopBgm()       {
    this.bgmRunning = false;
    if (this.bgmTimer) {
      window.clearInterval(this.bgmTimer);
      this.bgmTimer = 0;
    }
  }

          kick(beat        )       {
    const ctx = this.context;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = beat % 2 === 0 ? "sine" : "triangle";
    osc.frequency.setValueAtTime(beat % 4 === 0 ? 110 : 80, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.1);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.2);
  }
}
