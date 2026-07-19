

export class UserPoseSource {
          latest                                                     = null;

  setLatest(world                      , ts        )       {
    if (world.length < 33) return;
    this.latest = { world, ts };
  }

  readFresh(now        , maxAgeMs        )                              {
    if (!this.latest) return null;
    return now - this.latest.ts <= maxAgeMs ? this.latest.world : null;
  }

  clear()       {
    this.latest = null;
  }
}
