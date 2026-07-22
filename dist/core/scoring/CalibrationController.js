
import { normalizeMediaPipeWorld } from "./normalize.js?v=0.1.11";

import { UserProfileStore,                  } from "./UserProfile.js?v=0.1.11";

const REQUIRED_FRAMES = 30; // ~1s at 30Hz
const STABILITY_THRESHOLD = 0.05; // meters peak-to-peak Y deviation allowed during sampling
const MAX_FRAME_AGE_MS = 200;








export class CalibrationController {
          userPose                ;
          store                  ;
          listeners                                             = [];
          status                    = { phase: "idle" };
          tickHandle                = null;
          samples             = [];
          startedAt = 0;

  constructor(userPose                , store                  ) {
    this.userPose = userPose;
    this.store = store;
  }

  getStatus()                    {
    return this.status;
  }

  onChange(listener                                     )             {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((fn) => fn !== listener);
    };
  }

  start()       {
    this.cancel();
    this.samples = [];
    this.startedAt = performance.now();
    this.emit({ phase: "waiting", reason: "请站直，双臂自然下垂" });
    this.tickHandle = window.setInterval(() => this.tick(), 100);
  }

  cancel()       {
    if (this.tickHandle !== null) {
      window.clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
    if (this.status.phase !== "idle" && this.status.phase !== "done") {
      this.emit({ phase: "idle" });
    }
  }

          tick()       {
    const fresh = this.userPose.readFresh(performance.now(), MAX_FRAME_AGE_MS);
    if (!fresh) {
      this.emit({ phase: "waiting", reason: "未检测到全身，请站到摄像头取景安全区内" });
      return;
    }
    // record raw landmarks: we'll average the world coordinates over N frames.
    const flat           = new Array(fresh.length * 3);
    for (let i = 0; i < fresh.length; i += 1) {
      const lm = fresh[i]                      ;
      flat[i * 3] = lm.x;
      flat[i * 3 + 1] = lm.y;
      flat[i * 3 + 2] = lm.z;
    }
    this.samples.push(flat);
    if (this.samples.length < REQUIRED_FRAMES) {
      this.emit({ phase: "sampling", progress: this.samples.length / REQUIRED_FRAMES });
      return;
    }

    const averaged = averageSamples(this.samples, fresh.length);
    const stability = stabilityCheck(this.samples, fresh.length);
    if (stability > STABILITY_THRESHOLD) {
      this.samples = [];
      this.emit({ phase: "waiting", reason: "请尽量站稳保持一秒" });
      return;
    }

    const profile = derive(averaged);
    if (!profile) {
      this.emit({ phase: "failed", reason: "采样数据不完整，请重试" });
      this.stop();
      return;
    }
    this.store.set(profile);
    this.emit({ phase: "done", profile });
    this.stop();
  }

          stop()       {
    if (this.tickHandle !== null) {
      window.clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

          emit(status                   )       {
    this.status = status;
    this.listeners.forEach((fn) => fn(status));
  }
}

function averageSamples(samples            , count        )                       {
  const out                       = new Array(count);
  for (let i = 0; i < count; i += 1) {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const sample of samples) {
      sx += sample[i * 3] ?? 0;
      sy += sample[i * 3 + 1] ?? 0;
      sz += sample[i * 3 + 2] ?? 0;
    }
    out[i] = { x: sx / samples.length, y: sy / samples.length, z: sz / samples.length };
  }
  return out;
}

function stabilityCheck(samples            , count        )         {
  // Peak-to-peak Y of midHips index 23 (left hip y) — coarse but enough.
  if (count <= 23) return Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const sample of samples) {
    const y = sample[23 * 3 + 1];
    if (y === undefined) continue;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return maxY - minY;
}

function derive(averaged                      )                     {
  if (averaged.length < 33) return null;
  const vecs = normalizeMediaPipeWorld(averaged);
  const lShoulder = vecs[11];
  const rShoulder = vecs[12];
  const lElbow = vecs[13];
  const rElbow = vecs[14];
  const lWrist = vecs[15];
  const rWrist = vecs[16];
  const lHip = vecs[23];
  const rHip = vecs[24];
  const lKnee = vecs[25];
  const rKnee = vecs[26];
  const lAnkle = vecs[27];
  const rAnkle = vecs[28];
  const nose = vecs[0];
  if (
    !lShoulder ||
    !rShoulder ||
    !lElbow ||
    !rElbow ||
    !lWrist ||
    !rWrist ||
    !lHip ||
    !rHip ||
    !lKnee ||
    !rKnee ||
    !lAnkle ||
    !rAnkle ||
    !nose
  ) {
    return null;
  }

  const shoulderSpan = distance(lShoulder, rShoulder);
  const hipSpan = distance(lHip, rHip);
  const midHipY = (lHip.y + rHip.y) / 2;
  const midAnkleY = (lAnkle.y + rAnkle.y) / 2;
  const legLength = Math.abs(midHipY - midAnkleY);
  const heightMeters = Math.abs(nose.y - midAnkleY) + 0.12; // ~12cm head above nose
  const floorY = midAnkleY;

  return {
    heightMeters,
    shoulderSpanMeters: shoulderSpan,
    hipSpanMeters: hipSpan,
    legLengthMeters: legLength,
    floorY,
    capturedAt: Date.now(),
    boneLengths: {
      lThigh: distance(lHip, lKnee),
      lShin: distance(lKnee, lAnkle),
      rThigh: distance(rHip, rKnee),
      rShin: distance(rKnee, rAnkle),
      lUpperArm: distance(lShoulder, lElbow),
      lForearm: distance(lElbow, lWrist),
      rUpperArm: distance(rShoulder, rElbow),
      rForearm: distance(rElbow, rWrist),
    },
  };
}

function distance(a                                     , b                                     )         {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
