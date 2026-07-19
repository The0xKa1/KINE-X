// Adapted from "1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input
// in Interactive Systems" — Casiez, Roussel, Vogel (2012).
// Reference: https://gery.casiez.net/1euro/







export const DEFAULT_ONE_EURO_PARAMS                = {
  minCutoff: 1.0,
  beta: 0.05,
  dCutoff: 1.0,
};

export class OneEuroFilter {
          params               ;
          prevValue                = null;
          prevDeriv = 0;
          prevTimestamp                = null;

  constructor(params                = DEFAULT_ONE_EURO_PARAMS) {
    this.params = params;
  }

  reset()       {
    this.prevValue = null;
    this.prevDeriv = 0;
    this.prevTimestamp = null;
  }

  filter(value        , timestampMs        )         {
    if (this.prevTimestamp === null || this.prevValue === null) {
      this.prevTimestamp = timestampMs;
      this.prevValue = value;
      this.prevDeriv = 0;
      return value;
    }
    const dt = Math.max(1, timestampMs - this.prevTimestamp) / 1000;
    const deriv = (value - this.prevValue) / dt;
    const aD = alpha(this.params.dCutoff, dt);
    const smoothedDeriv = aD * deriv + (1 - aD) * this.prevDeriv;
    const cutoff = this.params.minCutoff + this.params.beta * Math.abs(smoothedDeriv);
    const a = alpha(cutoff, dt);
    const result = a * value + (1 - a) * this.prevValue;

    this.prevValue = result;
    this.prevDeriv = smoothedDeriv;
    this.prevTimestamp = timestampMs;
    return result;
  }
}

function alpha(cutoff        , dt        )         {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}
