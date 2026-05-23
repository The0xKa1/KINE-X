                                               
                                                                      

                                   
             
               
                   
                     
                             
                               
                          
                   
 

                                                              

                                 
                 
                          
                   
                          
                           
                                               
                             
 

                            
             
               
                   
                
                     
                             
                               
                          
                   
 

                            
              
                
 

const PHASES                 = ["intro", "mid", "peak", "outro"];
const FRAME_EMIT_INTERVAL_MS = 120;

export class SessionRecorder {
          joints = new Map                          ();
          phaseStats                                         = {
    intro: { sum: 0, count: 0 },
    mid: { sum: 0, count: 0 },
    peak: { sum: 0, count: 0 },
    outro: { sum: 0, count: 0 },
  };
          totalScoreSum = 0;
          frames = 0;
          worstFrameScore = 100;
          active = false;

  constructor(bus          ) {
    bus.on("score:update", (payload) => this.ingest(payload));
    bus.on("session:state", (payload) => {
      if (payload.phase === "active") {
        this.reset();
        this.active = true;
      } else if (payload.phase === "finished" || payload.phase === "idle") {
        this.active = false;
      } else {
        this.active = false;
      }
    });
  }

  reset()       {
    this.joints.clear();
    PHASES.forEach((p) => {
      this.phaseStats[p] = { sum: 0, count: 0 };
    });
    this.totalScoreSum = 0;
    this.frames = 0;
    this.worstFrameScore = 100;
  }

  ingest(payload             )       {
    if (!this.active) return;
    this.frames += 1;
    this.totalScoreSum += payload.score;
    if (payload.score < this.worstFrameScore) this.worstFrameScore = payload.score;

    const phase = pickPhase(payload.progress);
    const bucket = this.phaseStats[phase];
    bucket.sum += payload.score;
    bucket.count += 1;

    payload.metrics.forEach((metric             ) => {
      let acc = this.joints.get(metric.id);
      if (!acc) {
        acc = {
          id: metric.id,
          name: metric.name,
          sumScore: 0,
          count: 0,
          worstScore: 100,
          worstAngleDeltaDeg: 0,
          worstDistanceDeltaCm: 0,
          worstAtProgress: 0,
          riskHits: 0,
        };
        this.joints.set(metric.id, acc);
      }
      acc.sumScore += metric.score;
      acc.count += 1;
      if (metric.score < acc.worstScore) {
        acc.worstScore = metric.score;
        acc.worstAngleDeltaDeg = metric.angleDeltaDeg;
        acc.worstDistanceDeltaCm = metric.distanceDeltaCm;
        acc.worstAtProgress = payload.progress;
      }
      if (metric.risk === "risk") acc.riskHits += 1;
    });
  }

  snapshot()                 {
    const frames = this.frames;
    const avgScore = frames > 0 ? this.totalScoreSum / frames : 0;
    const phaseAvg                               = {
      intro: avgFor(this.phaseStats.intro),
      mid: avgFor(this.phaseStats.mid),
      peak: avgFor(this.phaseStats.peak),
      outro: avgFor(this.phaseStats.outro),
    };
    let worstPhase               = "intro";
    let worstPhaseScore = Infinity;
    PHASES.forEach((p) => {
      const bucket = this.phaseStats[p];
      if (bucket.count === 0) return;
      const a = phaseAvg[p];
      if (a < worstPhaseScore) {
        worstPhaseScore = a;
        worstPhase = p;
      }
    });

    const joints                     = Array.from(this.joints.values())
      .map((acc) => ({
        id: acc.id,
        name: acc.name,
        avgScore: acc.count > 0 ? acc.sumScore / acc.count : 0,
        worstScore: acc.worstScore,
        worstAngleDeltaDeg: acc.worstAngleDeltaDeg,
        worstDistanceDeltaCm: acc.worstDistanceDeltaCm,
        worstAtProgress: acc.worstAtProgress,
        riskHits: acc.riskHits,
      }))
      .sort((a, b) => a.worstScore - b.worstScore);

    return {
      frames,
      durationSeconds: (frames * FRAME_EMIT_INTERVAL_MS) / 1000,
      avgScore,
      worstFrameScore: this.worstFrameScore,
      worstPhase,
      phaseAvgScores: phaseAvg,
      joints,
    };
  }
}

function pickPhase(progress        )               {
  if (progress < 0.25) return "intro";
  if (progress < 0.5) return "mid";
  if (progress < 0.75) return "peak";
  return "outro";
}

function avgFor(bucket                  )         {
  return bucket.count > 0 ? bucket.sum / bucket.count : 0;
}
