import { formatCm, formatDeg } from "../../core/coordinates.js";
import type { EventBus } from "../../core/EventBus.js";
import type { JointMetric, PipelineStep, PipelineUpdate, ScoreUpdate } from "../../types/motion.js";

interface ScoreBoardOptions {
  bus: EventBus;
  metricList: HTMLElement;
  pipelineList: HTMLElement;
  scoreValue: HTMLElement;
  comboLabel: HTMLElement;
  riskBadge: HTMLElement;
  frameLabel: HTMLElement;
  deltaLabel: HTMLElement;
  pipelineLatency: HTMLElement;
  streamLabel: HTMLElement;
  pipeline: PipelineStep[];
}

export class ScoreBoard {
  private options: ScoreBoardOptions;
  private pipelineRun = 0;
  private lastScore: number | null = null;

  constructor(options: ScoreBoardOptions) {
    this.options = options;
    this.options.bus.on("score:update", (payload) => this.renderScore(payload));
    this.options.bus.on("pipeline:update", (payload) => this.renderPipeline(payload));
    this.options.bus.on("camera:update", (payload) => {
      this.options.streamLabel.textContent = payload.mode === "camera" ? "Camera stream active" : "MediaPipe mock active";
    });
    this.renderPipeline({ runIndex: 0, latencyMs: 42, status: "queued" });
  }

  renderScore(payload: ScoreUpdate): void {
    if (this.lastScore !== payload.score) {
      this.lastScore = payload.score;
      const orbit = this.options.scoreValue.closest(".score-orbit");
      if (orbit) {
        orbit.classList.remove("is-tick");
        void (orbit as HTMLElement).offsetWidth;
        orbit.classList.add("is-tick");
      }
    }
    this.options.scoreValue.textContent = String(payload.score);
    this.options.comboLabel.textContent = `x${String(payload.combo).padStart(2, "0")}`;
    this.options.frameLabel.textContent = String(payload.frame).padStart(3, "0");
    this.options.deltaLabel.textContent = formatCm(averageDistance(payload.metrics));
    this.renderMetrics(payload.metrics);
    this.renderRisk(payload);
  }

  renderPipeline(payload: PipelineUpdate): void {
    this.pipelineRun = payload.runIndex;
    this.options.pipelineList.innerHTML = "";
    this.options.pipelineLatency.textContent = `${Math.max(1, Math.round(payload.latencyMs || 42))} ms frame`;

    this.options.pipeline.forEach((step, index) => {
      const item = document.createElement("div");
      const statusClass =
        payload.status === "queued" ? "is-queued" : index === this.pipelineRun % this.options.pipeline.length ? "is-busy" : "";
      item.className = `pipeline-step ${statusClass}`;
      item.innerHTML = `
        <div>
          <strong>${step.name}</strong>
          <span>${step.detail}</span>
        </div>
        <i aria-hidden="true"></i>
      `;
      this.options.pipelineList.appendChild(item);
    });
  }

  private renderMetrics(metrics: JointMetric[]): void {
    this.options.metricList.innerHTML = "";

    metrics.forEach((metric) => {
      const row = document.createElement("article");
      row.className = `metric-row ${metric.risk === "warn" ? "is-warn" : ""} ${metric.risk === "risk" ? "is-risk" : ""}`;
      const color = metric.risk === "risk" ? "var(--red)" : metric.risk === "warn" ? "var(--amber)" : "var(--cyan)";
      row.innerHTML = `
        <div class="metric-top">
          <strong>${metric.name}</strong>
          <span>${Math.round(metric.score)}%</span>
        </div>
        <div class="metric-bar" style="--bar-color: ${color}">
          <i style="--value: ${metric.score}%"></i>
        </div>
        <div class="metric-values">
          <span>${formatDeg(metric.angleDeltaDeg)} angle</span>
          <span>${formatCm(metric.distanceDeltaCm)} 3D delta</span>
        </div>
      `;
      this.options.metricList.appendChild(row);
    });
  }

  private renderRisk(payload: ScoreUpdate): void {
    const badge = this.options.riskBadge;
    const worst = [...payload.metrics].sort((a, b) => a.score - b.score)[0];
    badge.textContent = payload.riskLabel;
    badge.classList.toggle("is-warning", worst?.risk === "warn");
    badge.classList.toggle("is-danger", worst?.risk === "risk");
  }
}

function averageDistance(metrics: JointMetric[]): number {
  if (!metrics.length) return 0;
  return metrics.reduce((sum, metric) => sum + metric.distanceDeltaCm, 0) / metrics.length;
}
