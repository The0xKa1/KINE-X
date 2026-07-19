












/**
 * Thin lifecycle wrapper around the existing stage: pauses rendering and
 * playback when the user navigates away (camera stream stays open so coming
 * back is instant), resumes on return, and syncs the seed with the route.
 */
export class TrainPage                 {
  el             ;
          options                  ;

  constructor(options                  ) {
    this.options = options;
    this.el = options.el;
  }

  enter(params                        )       {
    const seedId = params.seedId;
    if (seedId && seedId !== this.options.getCurrentSeedId() && this.options.hasSeed(seedId)) {
      this.options.onSeedRequest(seedId);
    }
    this.options.stage.start();
    this.options.realtime.setPlaying(true);
  }

  leave()       {
    this.options.realtime.setPlaying(false);
    this.options.stage.stop();
  }
}
