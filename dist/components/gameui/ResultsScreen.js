import { formatCm } from "../../core/coordinates.js";
                                                       
import { modalA11y,                      } from "../../core/modalA11y.js";
                                                                                     
                                                                             
                                                      
import { buildDiagnosisMessages, buildFallbackText,                   } from "../../core/llm/buildPrompt.js";
import { streamChat,                  } from "../../core/llm/LLMClient.js";

                                
                
                    
                           
                       
                      
                       
                         
                       
                      
                       
                       
                            
                   
                                                           
                                                
                                   
                        
                                     
                             
 

const MEDALS                             = {
  squat: "重心掌控者",
  deadlift: "脊柱守护者",
  baduanjin: "太极初窥门径",
  street: "节奏掠夺者",
  basketball: "罚球线刺客",
};

export class ResultsScreen {
          options                      ;
          latest                     = null;
          currentExercise             = "squat";
          rollingScore           = [];
          rollingDelta           = [];
          riskHits = 0;
          a11y                 ;
          lastDiagnosis                                       = null;

  constructor(options                      ) {
    this.options = options;
    this.a11y = modalA11y({
      root: this.options.root,
      onEscape: () => this.close(),
      initialFocus: () => this.options.closeButton               ,
    });
    this.options.bus.on("score:update", (payload) => this.handle(payload));
    this.options.closeButton.addEventListener("click", () => this.close());
    this.options.exportButton.addEventListener("click", () => this.options.onExport());
    this.options.root.addEventListener("click", (event) => {
      if (event.target === this.options.root) this.close();
    });
  }

  setExercise(id            )       {
    this.currentExercise = id;
    this.rollingScore = [];
    this.rollingDelta = [];
    this.riskHits = 0;
    this.lastDiagnosis = null;
  }

  open()       {
    if (!this.latest) return;
    const score = Math.round(this.latest.score);
    const stats = this.options.getStats();
    const beat = Math.min(99, Math.max(40, Math.round(60 + (score - 60) * 1.6)));
    const avgDelta = average(this.rollingDelta);

    this.options.scoreEl.textContent = String(score);
    this.options.titleEl.textContent = `本次动作匹配度 ${score}%`;
    this.options.beatEl.textContent = `${beat}%`;
    this.options.comboEl.textContent = `×${stats.bestCombo || this.latest.combo}`;
    this.options.perfectEl.textContent = String(stats.perfectFrames);
    this.options.deltaEl.textContent = formatCm(avgDelta);
    this.options.riskEl.textContent = String(this.riskHits);
    this.options.medalEl.textContent = MEDALS[this.currentExercise] ?? "限定数字勋章";

    this.options.root.classList.add("is-open");
    this.options.root.setAttribute("aria-hidden", "false");
    this.a11y.activate();

    this.runDiagnosis();
  }

  close()       {
    this.options.aiCoach.cancel();
    this.options.root.classList.remove("is-open");
    this.options.root.setAttribute("aria-hidden", "true");
    this.a11y.deactivate();
  }

          runDiagnosis()       {
    const exercise = this.options.exercises[this.currentExercise];
    const summary = this.options.sessionRecorder.snapshot();
    const fallback = buildFallbackText(exercise, summary);
    if (summary.frames === 0) {
      this.options.aiCoach.renderStatic(fallback, "no samples");
      return;
    }
    const cacheKey = summaryCacheKey(this.currentExercise, summary);
    if (this.lastDiagnosis && this.lastDiagnosis.key === cacheKey) {
      this.options.aiCoach.renderStatic(this.lastDiagnosis.text, "cached");
      return;
    }
    const config = this.options.getLlmConfig();
    if (!config) {
      this.options.aiCoach.renderStatic(fallback);
      return;
    }
    const messages = buildDiagnosisMessages(exercise, summary, this.options.getPersona());
    void this.options.aiCoach
      .renderStreaming(
        (onDelta, signal) => streamChat(config, messages, onDelta, { signal }),
        fallback,
      )
      .then((text) => {
        if (text) this.lastDiagnosis = { key: cacheKey, text };
      });
  }

          handle(payload             )       {
    this.latest = payload;
    this.rollingScore.push(payload.score);
    if (this.rollingScore.length > 240) this.rollingScore.shift();
    const avgDelta =
      payload.metrics.reduce((sum, m) => sum + m.distanceDeltaCm, 0) / Math.max(1, payload.metrics.length);
    this.rollingDelta.push(avgDelta);
    if (this.rollingDelta.length > 240) this.rollingDelta.shift();
    if (payload.metrics.some((m) => m.risk === "risk")) this.riskHits += 1;
  }
}

function average(values          )         {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function summaryCacheKey(exerciseId            , summary                                         )         {
  const joints = summary.joints
    .map((j) => `${j.id}:${j.avgScore.toFixed(1)}`)
    .join(",");
  return [
    exerciseId,
    summary.frames,
    summary.avgScore.toFixed(2),
    summary.worstFrameScore.toFixed(2),
    summary.worstPhase,
    joints,
  ].join("|");
}
