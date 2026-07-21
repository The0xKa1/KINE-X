


import { createMockPacket } from "../mock/mockFrameSource.js?v=0.1.1";
import { applyLiveScore,                    } from "../core/scoring/PoseScorer.js?v=0.1.1";

import { sampleClip } from "../core/import/CoachClip.js?v=0.1.1";






















export class MockStream {
          options                   ;
          timer = 0;

  constructor(options                   ) {
    this.options = options;
  }

  start()       {
    this.stop();
    this.timer = window.setInterval(() => {
      const exercise = this.options.exercises[this.options.state.exerciseId];
      if (this.options.state.playing) {
        this.options.state.progress =
          (this.options.state.progress + (1 / exercise.durationSeconds) * this.options.state.speed * 0.033) % 1;
        this.options.state.frame += 1;
        this.options.onProgressTick?.(this.options.state.progress);
      }
      this.pushFrame(performance.now());
    }, 33);
  }

  stop()       {
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = 0;
    }
  }

  pushFrame(now        )       {
    const exercise = this.options.exercises[this.options.state.exerciseId];
    const packet = createMockPacket({
      exercise,
      mode: this.options.state.mode,
      progress: this.options.state.progress,
      frame: this.options.state.frame,
      timestampMs: now,
      evaluatorActive: this.options.webcam.isActive(),
    });
    if (exercise.clip) {
      packet.data.seedJoints = sampleClip(exercise.clip, this.options.state.progress);
    }
    this.options.coachHistory?.push(packet.data.seedJoints);
    if (this.options.scorer) applyLiveScore(packet, this.options.scorer);
    this.options.socket.consumePacket(packet);
  }

  resetForSeed(nextId            )       {
    this.options.state.exerciseId = nextId;
    this.options.state.progress = 0.1;
    this.options.state.frame = 0;
    this.options.buffer.reset();
    this.options.coachHistory?.reset();
  }
}
