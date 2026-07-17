import type { Page } from "../../core/Router.js";
import type { MotionStage } from "../../core/MotionStage.js";
import type { RealtimeStream } from "../../core/RealtimeStream.js";

interface TrainPageOptions {
  el: HTMLElement;
  stage: MotionStage;
  realtime: RealtimeStream;
  getCurrentSeedId: () => string;
  hasSeed: (seedId: string) => boolean;
  onSeedRequest: (seedId: string) => void;
}

/**
 * Thin lifecycle wrapper around the existing stage: pauses rendering and
 * playback when the user navigates away (camera stream stays open so coming
 * back is instant), resumes on return, and syncs the seed with the route.
 */
export class TrainPage implements Page {
  el: HTMLElement;
  private options: TrainPageOptions;

  constructor(options: TrainPageOptions) {
    this.options = options;
    this.el = options.el;
  }

  enter(params: Record<string, string>): void {
    const seedId = params.seedId;
    if (seedId && seedId !== this.options.getCurrentSeedId() && this.options.hasSeed(seedId)) {
      this.options.onSeedRequest(seedId);
    }
    this.options.stage.start();
    this.options.realtime.setPlaying(true);
  }

  leave(): void {
    this.options.realtime.setPlaying(false);
    this.options.stage.stop();
  }
}
