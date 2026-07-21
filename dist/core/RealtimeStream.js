
import { meters } from "./coordinates.js?v=0.1.9";

import { JOINT_NAMES, sampleClip } from "./import/CoachClip.js?v=0.1.9";

import { applyLiveScore, resetScoreStreak,                    } from "./scoring/PoseScorer.js?v=0.1.9";


































const IDENTITY                  = [0, 0, 0, 1];
const MIN_PACKET_INTERVAL_MS = 30;

export class RealtimeStream {
          options                       ;
          phase                       ;
          lastTickMs = 0;
          lastPacketMs = 0;
          finishFired = false;

  constructor(options                       ) {
    this.options = options;
    this.phase = options.sessionGate.getPhase();
    options.bus.on("session:state", (payload) => this.onPhaseChange(payload.phase));
    // Self-driven RAF so the coach keeps animating even when the camera is off.
    // When the camera is on, both this loop and `CameraOverlay.onPose` call
    // `onPoseTick`; the MIN_PACKET_INTERVAL_MS gate prevents double-pumping.
    const loop = (now        )       => {
      this.onPoseTick(null, now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // Called from CameraOverlay.onPose on every MediaPipe detect cycle.
  onPoseTick(_world                             , nowMs        )       {
    if (nowMs - this.lastPacketMs < MIN_PACKET_INTERVAL_MS) return;
    const dtMs = this.lastTickMs > 0 ? nowMs - this.lastTickMs : 33;
    this.lastTickMs = nowMs;
    this.lastPacketMs = nowMs;

    const exercise = this.options.exercises[this.options.state.exerciseId];
    if (!exercise.clip) return;

    // Progress advances incrementally from dt so live tempo changes apply
    // without snapping the playhead.
    const dProgress = (dtMs / 1000) * this.options.state.speed / exercise.durationSeconds;
    if (this.phase === "active") {
      this.options.state.progress = Math.min(1, this.options.state.progress + dProgress);
      this.options.state.frame += 1;
    } else if (this.options.state.playing) {
      this.options.state.progress = (this.options.state.progress + dProgress) % 1;
      this.options.state.frame += 1;
    }

    this.options.onProgressTick?.(this.options.state.progress);

    const seedJoints = sampleClip(exercise.clip, this.options.state.progress);
    this.options.coachHistory.push(seedJoints);
    const packet = buildPacket({
      exercise,
      state: this.options.state,
      seedJoints,
      timestampMs: nowMs,
      sessionActive: this.phase === "active",
    });
    if (this.phase === "active") {
      applyLiveScore(packet, this.options.scorer);
    }
    this.options.socket.consumePacket(packet);

    if (this.phase === "active" && this.options.state.progress >= 1 && !this.finishFired) {
      this.finishFired = true;
      this.options.sessionGate.markFinished("system");
      this.options.onSessionFinished?.();
    }
  }

  setProgress(progress        )       {
    if (this.phase === "active") return;
    this.options.state.progress = Math.max(0, Math.min(1, progress));
  }

  setPlaying(playing         )       {
    if (this.phase === "active") return;
    this.options.state.playing = playing;
  }

  resetForSeed(id        )       {
    this.options.state.exerciseId = id;
    this.options.state.progress = 0.1;
    this.options.state.frame = 0;
    this.lastTickMs = 0;
    this.options.coachHistory.reset();
    resetScoreStreak();
  }

          onPhaseChange(phase                       )       {
    this.phase = phase;
    if (phase === "active") {
      this.options.state.progress = 0;
      this.options.state.frame = 0;
      this.lastTickMs = 0;
      this.finishFired = false;
      this.options.coachHistory.reset();
      resetScoreStreak();
    } else if (phase === "idle" || phase === "finished") {
      this.finishFired = false;
    }
  }
}









function buildPacket(input                  )                    {
  const { exercise, state, seedJoints, timestampMs, sessionActive } = input;
  const metrics                = exercise.metrics.map((seed) => ({
    ...seed,
    score: seed.base,
    angleDeltaDeg: seed.angle,
    distanceDeltaCm: seed.distance,
    risk: riskFor(seed.base),
  }));
  const baseline = Math.round(metrics.reduce((sum, m) => sum + m.score, 0) / Math.max(1, metrics.length));
  const frame              = {
    frame: state.frame,
    timestampMs,
    seedId: exercise.id,
    progress: state.progress,
    score: baseline,
    combo: 1,
    riskLabel: sessionActive ? "Live capture" : "Standby",
    globalTransform: {
      translation: meters(0, 0, 0),
      rotation: IDENTITY,
    },
    seedJoints,
    joints: seedJoints,
    localRotations: JOINT_NAMES.map((name) => seedJoints[name].rotation),
    metrics,
  };
  return { type: "FRAME_STREAM", data: frame };
}

function riskFor(score        )             {
  if (score < 68) return "risk";
  if (score < 82) return "warn";
  return "good";
}
