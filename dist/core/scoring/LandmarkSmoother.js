
import { OneEuroFilter, DEFAULT_ONE_EURO_PARAMS,                    } from "./OneEuroFilter.js?v=0.1.8";

export class LandmarkSmoother {
          filters                 ;
          count        ;

  constructor(count        , params                = DEFAULT_ONE_EURO_PARAMS) {
    this.count = count;
    this.filters = Array.from({ length: count * 3 }, () => new OneEuroFilter(params));
  }

  reset()       {
    this.filters.forEach((f) => f.reset());
  }

  smooth(landmarks                      , timestampMs        )                       {
    if (landmarks.length === 0) return landmarks;
    const limit = Math.min(landmarks.length, this.count);
    const result                       = new Array(landmarks.length);
    for (let i = 0; i < landmarks.length; i += 1) {
      const src = landmarks[i];
      if (!src) continue;
      if (i >= limit) {
        result[i] = src;
        continue;
      }
      const baseIdx = i * 3;
      const fx = this.filters[baseIdx];
      const fy = this.filters[baseIdx + 1];
      const fz = this.filters[baseIdx + 2];
      if (!fx || !fy || !fz) continue;
      const smoothed                     = {
        x: fx.filter(src.x, timestampMs),
        y: fy.filter(src.y, timestampMs),
        z: fz.filter(src.z, timestampMs),
      };
      if (src.visibility !== undefined) {
        smoothed.visibility = src.visibility;
      }
      result[i] = smoothed;
    }
    return result;
  }
}
