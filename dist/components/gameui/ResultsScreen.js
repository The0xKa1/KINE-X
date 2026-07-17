import { formatCm } from "../../core/coordinates.js";
                                                       
import { modalA11y,                      } from "../../core/modalA11y.js";
import { prefersReducedMotion } from "../../core/motionPrefs.js";
                                                                         
                                                                             
                                                      
import { buildDiagnosisMessages, buildFallbackText,                   } from "../../core/llm/buildPrompt.js";
import { streamChat } from "../../core/llm/LLMClient.js";
                                                                           

                                
                
                    
                           
                       
                      
                       
                         
                       
                      
                        
                       
                       
                            
                   
                   
                                                           
                                            
                                   
                                 
                        
                             
 

const MEDALS                         = {
  squat: "重心掌控者",
};

export class ResultsScreen {
          options                      ;
          latest                     = null;
          currentExercise         = "squat";
          rollingScore           = [];
          rollingDelta           = [];
          riskHits = 0;
          a11y                 ;
          lastDiagnosis                                       = null;
          animationHandles           = [];

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

  setExercise(id        )       {
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
    const combo = stats.bestCombo || this.latest.combo;

    this.cancelAnimations();
    this.options.titleEl.textContent = `本次动作匹配度 ${score}%`;
    this.options.medalEl.textContent = MEDALS[this.currentExercise] ?? "限定数字勋章";

    this.options.sessionArchive.add({
      id: String(Date.now()),
      exerciseId: this.currentExercise,
      exerciseName: this.options.exercises[this.currentExercise]?.name ?? this.currentExercise,
      finishedAt: Date.now(),
      score,
      beat,
      bestCombo: combo,
      perfectFrames: stats.perfectFrames,
      avgDelta,
      riskHits: this.riskHits,
      medalName: MEDALS[this.currentExercise] ?? "限定数字勋章",
      summary: this.options.sessionRecorder.snapshot(),
    });

    this.options.root.classList.add("is-open");
    this.options.root.setAttribute("aria-hidden", "false");
    this.a11y.activate();

    this.animateNumber(this.options.scoreEl, 0, score, 720, (v) => String(Math.round(v)));
    this.animateNumber(this.options.beatEl, 0, beat, 760, (v) => `${Math.round(v)}%`);
    this.animateNumber(this.options.comboEl, 0, combo, 640, (v) => `×${Math.round(v)}`);
    this.animateNumber(this.options.perfectEl, 0, stats.perfectFrames, 680, (v) => String(Math.round(v)));
    this.animateNumber(this.options.deltaEl, 0, avgDelta, 720, (v) => formatCm(v));
    this.animateNumber(this.options.riskEl, 0, this.riskHits, 600, (v) => String(Math.round(v)));

    this.renderJointReport();
    this.runDiagnosis();
  }

          renderJointReport()       {
    const { joints } = this.options.sessionRecorder.snapshot();
    const container = this.options.jointsEl;
    container.innerHTML = "";
    const sorted = [...joints].sort((a, b) => a.avgScore - b.avgScore);
    for (const joint of sorted) {
      const row = document.createElement("div");
      row.className = `results-report-row${joint.riskHits > 0 ? " is-risk" : ""}`;
      row.innerHTML = `
        <span>${joint.name}</span>
        <b>${Math.round(joint.avgScore)}%</b>
        <b>${Math.round(joint.worstScore)}%</b>
        <span>${formatCm(joint.worstDistanceDeltaCm)}</span>
        <b class="report-risk">${joint.riskHits > 0 ? `×${joint.riskHits}` : "—"}</b>
      `;
      container.appendChild(row);
    }
  }

  close()       {
    if (!this.options.root.classList.contains("is-open")) return;
    this.cancelAnimations();
    this.options.aiCoach.cancel();
    this.options.root.classList.remove("is-open");
    this.options.root.setAttribute("aria-hidden", "true");
    this.a11y.deactivate();
    this.options.onClose?.();
  }

          animateNumber(
    el             ,
    from        ,
    to        ,
    durationMs        ,
    format                           ,
  )       {
    if (prefersReducedMotion() || durationMs <= 0) {
      el.textContent = format(to);
      return;
    }
    const start = performance.now();
    const tick = (now        ) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = from + (to - from) * eased;
      el.textContent = format(value);
      if (t < 1) {
        const handle = requestAnimationFrame(tick);
        this.animationHandles.push(handle);
      }
    };
    const handle = requestAnimationFrame(tick);
    this.animationHandles.push(handle);
  }

          cancelAnimations()       {
    for (const handle of this.animationHandles) cancelAnimationFrame(handle);
    this.animationHandles = [];
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
    const messages = buildDiagnosisMessages(exercise, summary, this.options.getPersona());
    void this.options.aiCoach
      .renderStreaming(
        (onDelta, signal) => streamChat(messages, onDelta, { signal }),
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

function summaryCacheKey(exerciseId        , summary                                         )         {
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
