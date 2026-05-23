                                                                  
                                                                                                    
                                                             

                                                    
                                                       

                                    
                  
                      
                 
                         
                                              
 

const DEFAULT_HOLD_MS = 600;
const DEFAULT_COOLDOWN_MS = 3000;

const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_TIP = 12;
const RING_TIP = 16;
const PINKY_TIP = 20;

const OK_PINCH_MAX = 0.95;
const MID_EXT_MIN = 1.0;
const RING_EXT_MIN = 0.9;
const PINKY_EXT_MIN = 0.8;
const INDEX_EXT_MIN = 0.1;
const WRIST_Y_MAX = 0.98;

export class OkGestureDetector {
          holdStartMs = 0;
          lastFireMs = -Infinity;
          holdMs        ;
          cooldownMs        ;
          onFire            ;
          isEligible               ;
          onProgress                                         ;

  constructor(options                          ) {
    this.holdMs = options.holdMs ?? DEFAULT_HOLD_MS;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.onFire = options.onFire;
    this.isEligible = options.isEligible ?? (() => true);
    this.onProgress = options.onProgress ?? null;
  }

  reset()       {
    this.holdStartMs = 0;
    this.emit({ phase: "no-hand", holdProgress: 0, handsCount: 0 });
  }

  update(hands              , nowMs        )       {
    if (!this.isEligible()) {
      this.holdStartMs = 0;
      this.emit({ phase: "disabled", holdProgress: 0, handsCount: hands.length });
      return;
    }
    if (nowMs - this.lastFireMs < this.cooldownMs) {
      this.holdStartMs = 0;
      this.emit({ phase: "cooldown", holdProgress: 0, handsCount: hands.length });
      return;
    }
    if (hands.length === 0) {
      this.holdStartMs = 0;
      this.emit({ phase: "no-hand", holdProgress: 0, handsCount: 0 });
      return;
    }
    // Pick the hand with the highest wrist (smallest y); also use it whether or
    // not pose mistook a face for a second hand.
    const best = pickBestHand(hands);
    const lms = best?.landmarks;
    if (!lms || lms.length !== 21) {
      this.holdStartMs = 0;
      this.emit({ phase: "wrong-pose", holdProgress: 0, handsCount: hands.length });
      return;
    }
    const metrics = computeMetrics(lms);
    if (metrics.failedCheck !== null) {
      this.holdStartMs = 0;
      this.emit({ phase: "wrong-pose", holdProgress: 0, handsCount: hands.length, metrics });
      return;
    }
    if (this.holdStartMs === 0) {
      this.holdStartMs = nowMs;
    }
    const elapsed = nowMs - this.holdStartMs;
    const progress = Math.min(1, elapsed / this.holdMs);
    if (elapsed >= this.holdMs) {
      this.lastFireMs = nowMs;
      this.holdStartMs = 0;
      this.emit({ phase: "fired", holdProgress: 1, handsCount: hands.length, metrics });
      this.onFire();
      return;
    }
    this.emit({ phase: "holding", holdProgress: progress, handsCount: hands.length, metrics });
  }

          emit(state                   )       {
    if (this.onProgress) this.onProgress(state);
  }
}

function pickBestHand(hands              )                    {
  let best                    = null;
  let bestY = Infinity;
  for (const hand of hands) {
    const wrist = hand.landmarks?.[WRIST];
    if (!wrist) continue;
    if (wrist.y < bestY) {
      best = hand;
      bestY = wrist.y;
    }
  }
  return best;
}

function computeMetrics(lms                      )                 {
  const wrist = lms[WRIST] ;
  const palm = dist2d(lms[WRIST] , lms[MIDDLE_MCP] );
  if (palm < 1e-4) {
    return {
      okPinch: NaN,
      midExt: NaN,
      ringExt: NaN,
      pinkyExt: NaN,
      indexExt: NaN,
      wristY: wrist.y,
      failedCheck: "palm-zero",
    };
  }
  const okPinch = dist2d(lms[THUMB_TIP] , lms[INDEX_TIP] ) / palm;
  const midExt = dist2d(lms[MIDDLE_TIP] , lms[WRIST] ) / palm;
  const ringExt = dist2d(lms[RING_TIP] , lms[WRIST] ) / palm;
  const pinkyExt = dist2d(lms[PINKY_TIP] , lms[WRIST] ) / palm;
  const indexExt = dist2d(lms[INDEX_TIP] , lms[INDEX_MCP] ) / palm;
  let failedCheck                                = null;
  if (wrist.y > WRIST_Y_MAX) failedCheck = "wrist-low";
  else if (okPinch > OK_PINCH_MAX) failedCheck = "ok-pinch";
  else if (midExt < MID_EXT_MIN) failedCheck = "mid-ext";
  else if (ringExt < RING_EXT_MIN) failedCheck = "ring-ext";
  else if (pinkyExt < PINKY_EXT_MIN) failedCheck = "pinky-ext";
  else if (indexExt < INDEX_EXT_MIN) failedCheck = "index-ext";
  return { okPinch, midExt, ringExt, pinkyExt, indexExt, wristY: wrist.y, failedCheck };
}

function dist2d(a                    , b                    )         {
  // Use 2D distance only — MediaPipe's z is relative depth and adds noise to
  // ratios that are otherwise stable in image plane.
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}
