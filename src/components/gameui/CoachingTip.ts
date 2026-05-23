import type { EventBus } from "../../core/EventBus.js";
import type { JointMetric, ScoreUpdate } from "../../types/motion.js";

interface CoachingTipOptions {
  bus: EventBus;
  bubble: HTMLElement;
  stage: HTMLElement;
}

const COPY: Record<string, { warn: string[]; risk: string[] }> = {
  knee: {
    warn: ["膝盖再压低 5 厘米", "膝盖跟脚尖一条线", "重心再稳一些，膝盖别内扣"],
    risk: ["重心再稳一下，膝盖跟脚尖一条线", "膝盖向外侧打开一些"],
  },
  hip: {
    warn: ["髋向后再坐一点点", "髋部再下沉一些"],
    risk: ["髋部再往后坐 5 厘米", "髋位回到正中"],
  },
  spine: {
    warn: ["腰背再立一立", "保持中线，别塌腰"],
    risk: ["腰背立起来，收紧核心", "保持脊柱中线"],
  },
  ankle: {
    warn: ["脚踝再放松一些", "脚跟踩稳"],
    risk: ["重心回到脚跟，脚踝放松"],
  },
  shoulder: {
    warn: ["肩膀放松，别耸起来", "肩线再水平一点"],
    risk: ["沉肩，放松上斜方"],
  },
  wrist: {
    warn: ["手腕再翻一点", "手腕保持中立位"],
    risk: ["手腕回到中立位"],
  },
};

export class CoachingTip {
  private options: CoachingTipOptions;
  private lastShown = 0;
  private lastKey = "";

  constructor(options: CoachingTipOptions) {
    this.options = options;
    this.options.bus.on("score:update", (payload) => this.handle(payload));
  }

  private handle(payload: ScoreUpdate): void {
    const worst = [...payload.metrics].sort((a, b) => a.score - b.score)[0];
    if (!worst || worst.risk === "good") {
      this.hide();
      return;
    }
    const key = `${worst.id}:${worst.risk}`;
    const now = performance.now();
    if (key !== this.lastKey || now - this.lastShown > 2400) {
      this.lastKey = key;
      this.lastShown = now;
      this.show(worst);
    }
  }

  private show(metric: JointMetric): void {
    const lines = COPY[metric.id] ?? { warn: [`留意 ${metric.name}`], risk: [`${metric.name} 风险高`] };
    const pool = metric.risk === "risk" ? lines.risk : lines.warn;
    const text = pool[Math.floor(Math.random() * pool.length)] ?? `留意 ${metric.name}`;
    this.options.bubble.textContent = text;
    if (window.innerWidth > 760) {
      const stageRect = this.options.stage.getBoundingClientRect();
      const x = stageRect.width * (0.36 + Math.random() * 0.18);
      const y = stageRect.height * (0.32 + Math.random() * 0.18);
      this.options.bubble.style.left = `${x}px`;
      this.options.bubble.style.top = `${y}px`;
    } else {
      this.options.bubble.style.left = "";
      this.options.bubble.style.top = "";
    }
    this.options.bubble.classList.add("is-visible");
  }

  private hide(): void {
    this.options.bubble.classList.remove("is-visible");
    this.lastKey = "";
  }
}
