import { THREE,                    } from "../three-compat.js?v=0.1.11";









import { SCORING_BONES,               } from "./boneTable.js?v=0.1.11";
import { CoachHistory } from "./CoachHistory.js?v=0.1.11";
import { JOINT_ANGLES } from "./jointAngles.js?v=0.1.11";
import { normalizeMediaPipeWorld } from "./normalize.js?v=0.1.11";











// Penalty: ~1.2 score points per degree of joint-angle mismatch.
const ANGLE_PENALTY_PER_DEG = 1.2;

// Bone-length validity window relative to calibrated length. Allow ±35% before
// declaring the frame a MediaPipe glitch.
const BONE_LENGTH_LOW = 0.65;
const BONE_LENGTH_HIGH = 1.35;
const BONE_LENGTH_BAD_TOLERANCE = 2;

const USER_TMP = new THREE.Vector3();
const COACH_TMP = new THREE.Vector3();

// Combo = consecutive frames at or above the PERFECT line, not a score reskin.
const COMBO_SCORE_THRESHOLD = 80;
let scoreStreak = 0;

/** Called on session start / seed switch so streaks don't leak across rounds. */
export function resetScoreStreak()       {
  scoreStreak = 0;
}












// Distance-error sampling points: MediaPipe anchor on the user side, 17-joint
// name on the coach side. spine is proxied by the chest point.
const METRIC_DISTANCE_POINTS                                                            = {
  knee: [
    { mp: 25, joint: "lKnee" },
    { mp: 26, joint: "rKnee" },
  ],
  hip: [
    { mp: 23, joint: "lHip" },
    { mp: 24, joint: "rHip" },
  ],
  ankle: [
    { mp: 27, joint: "lAnkle" },
    { mp: 28, joint: "rAnkle" },
  ],
  shoulder: [
    { mp: 11, joint: "lShoulder" },
    { mp: 12, joint: "rShoulder" },
  ],
  wrist: [
    { mp: 15, joint: "lWrist" },
    { mp: 16, joint: "rWrist" },
  ],
  spine: [{ mp: "midShoulders", joint: "chest" }],
};

export function applyLiveScore(packet                   , ctx               )       {
  if (packet.type !== "FRAME_STREAM") return;
  if (!ctx.webcam.isActive() || ctx.webcam.getMode() !== "camera") return;

  const userWorld = ctx.userPose.readFresh(performance.now(), 150);
  if (!userWorld) return;

  const frame = packet.data;
  const exercise = ctx.exercises[frame.seedId];
  if (!exercise.metrics.length) return;

  const userVecs = normalizeMediaPipeWorld(userWorld);
  if (userVecs.length < 33) return;

  // Bone-length gate: skip frames where MediaPipe limbs are wildly off the
  // calibrated user. Two off-band bones is the threshold — a single bad bone
  // (occluded knee, etc.) doesn't kill the frame.
  const profile = ctx.profileStore.get();
  if (profile && countBadBones(userVecs, profile.boneLengths) > BONE_LENGTH_BAD_TOLERANCE) {
    return;
  }

  // DTW lite — try every coach pose in the recent history window and adopt
  // whichever scores highest. Absorbs the ~200–500ms human reaction lag so
  // users aren't penalised for being slightly behind the coach.
  const history = ctx.coachHistory.getAll();
  const candidates                 = history.length > 0 ? history : [frame.seedJoints];

  let best                        = null;
  for (const seed of candidates) {
    const snap = computeBuckets(userVecs, seed, exercise);
    if (!snap) continue;
    if (!best || snap.aggregate > best.aggregate) best = snap;
  }
  if (!best) return;

  // Overwrite the packet metrics + frame-level aggregates with the chosen buckets.
  let weightSum = 0;
  let scoreSum = 0;
  let worst                     = null;
  for (const m of frame.metrics) {
    const bucket = best.buckets[m.id];
    if (!bucket || bucket.n === 0) continue;
    const newScore = Math.round(bucket.sum / bucket.n);
    m.score = newScore;
    m.risk = riskFor(newScore);
    const angleErr = best.angleErrs[m.id];
    m.angleDeltaDeg = angleErr && angleErr.n > 0 ? Math.round((angleErr.sum / angleErr.n) * 10) / 10 : 0;
    const distErr = best.distErrs[m.id];
    m.distanceDeltaCm = distErr && distErr.n > 0 ? Math.round((distErr.sum / distErr.n) * 1000) / 10 : 0;
    weightSum += m.base;
    scoreSum += newScore * m.base;
    if (!worst || newScore < worst.score) worst = m;
  }

  if (weightSum === 0) return;
  frame.score = Math.round(scoreSum / weightSum);
  if (frame.score >= COMBO_SCORE_THRESHOLD) scoreStreak += 1;
  else scoreStreak = 0;
  frame.combo = clamp(scoreStreak, 1, 18);
  frame.riskLabel =
    !worst || worst.risk === "good"
      ? "对齐良好"
      : worst.risk === "warn"
        ? `注意${worst.name}`
        : `风险${worst.name}`;
}

function computeBuckets(
  userVecs                 ,
  seed              ,
  exercise                ,
)                        {
  // Work on a copy so yaw alignment for one history candidate doesn't pollute the next.
  const aligned = cloneVecs(userVecs);
  yawAlignToCoach(aligned, seed);

  const userMidHips = midpoint(aligned[23], aligned[24]);
  const userMidShoulders = midpoint(aligned[11], aligned[12]);
  if (!userMidHips || !userMidShoulders) return null;

  const buckets          = {};
  const angleErrs          = {};
  const distErrs          = {};

  for (const bone of SCORING_BONES) {
    const u = userBoneVec(aligned, userMidHips, userMidShoulders, bone.mpFrom, bone.mpTo);
    const c = coachBoneVec(seed, bone.from, bone.to);
    if (!u || !c) continue;
    if (u.length() === 0 || c.length() === 0) continue;
    u.normalize();
    c.normalize();
    const cos = clamp(u.dot(c), -1, 1);
    const boneScore = clamp(50 + 50 * cos, 0, 100);
    for (const id of bone.metricIds) pushBucket(buckets, id, boneScore);
  }

  for (const spec of JOINT_ANGLES) {
    const userAngle = jointAngleUser(aligned, spec.user.a, spec.user.b, spec.user.c);
    const coachAngle = jointAngleCoach(seed, spec.coach.a, spec.coach.b, spec.coach.c);
    if (userAngle === null || coachAngle === null) continue;
    const delta = Math.abs(userAngle - coachAngle);
    const angleScore = clamp(100 - delta * ANGLE_PENALTY_PER_DEG, 0, 100);
    pushBucket(buckets, spec.metricId, angleScore);
    pushBucket(angleErrs, spec.metricId, delta);
  }

  // Real distance error: per-metric joint offset relative to each side's own
  // root (user midHips vs coach pelvis), in meters.
  const coachPelvis = seed.pelvis?.position;
  if (coachPelvis) {
    for (const m of exercise.metrics) {
      const points = METRIC_DISTANCE_POINTS[m.id];
      if (!points) continue;
      for (const { mp, joint } of points) {
        const userP = resolveUserAnchor(aligned, userMidHips, userMidShoulders, mp);
        const coachP = seed[joint]?.position;
        if (!userP || !coachP) continue;
        const dx = userP.x - userMidHips.x - (coachP[0] - coachPelvis[0]);
        const dy = userP.y - userMidHips.y - (coachP[1] - coachPelvis[1]);
        const dz = userP.z - userMidHips.z - (coachP[2] - coachPelvis[2]);
        pushBucket(distErrs, m.id, Math.hypot(dx, dy, dz));
      }
    }
  }

  // Aggregate using metric.base as weight so "important" metrics dominate.
  let weightSum = 0;
  let scoreSum = 0;
  for (const m of exercise.metrics) {
    const bucket = buckets[m.id];
    if (!bucket || bucket.n === 0) continue;
    const metricScore = bucket.sum / bucket.n;
    weightSum += m.base;
    scoreSum += metricScore * m.base;
  }
  if (weightSum === 0) return null;
  return { buckets, angleErrs, distErrs, aggregate: scoreSum / weightSum };
}

function countBadBones(vecs                 , cal                        )         {
  const checks                                                                        = [
    [vecs[23], vecs[25], cal.lThigh],
    [vecs[25], vecs[27], cal.lShin],
    [vecs[24], vecs[26], cal.rThigh],
    [vecs[26], vecs[28], cal.rShin],
    [vecs[11], vecs[13], cal.lUpperArm],
    [vecs[13], vecs[15], cal.lForearm],
    [vecs[12], vecs[14], cal.rUpperArm],
    [vecs[14], vecs[16], cal.rForearm],
  ];
  let bad = 0;
  for (const [a, b, calibrated] of checks) {
    if (!a || !b || calibrated <= 0) continue;
    const len = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    const ratio = len / calibrated;
    if (ratio < BONE_LENGTH_LOW || ratio > BONE_LENGTH_HIGH) bad += 1;
  }
  return bad;
}



function cloneVecs(src                 )                  {
  return src.map((v) => new THREE.Vector3(v.x, v.y, v.z));
}

function pushBucket(buckets         , id        , value        )       {
  const bucket = buckets[id] ?? (buckets[id] = { sum: 0, n: 0 });
  bucket.sum += value;
  bucket.n += 1;
}

function yawAlignToCoach(userVecs                 , seed              )       {
  const uL = userVecs[11];
  const uR = userVecs[12];
  if (!uL || !uR) return;
  const cL = seed.lShoulder?.position;
  const cR = seed.rShoulder?.position;
  if (!cL || !cR) return;

  const userYaw = Math.atan2(uR.z - uL.z, uR.x - uL.x);
  const coachYaw = Math.atan2(cR[2] - cL[2], cR[0] - cL[0]);
  const dYaw = coachYaw - userYaw;
  if (Math.abs(dYaw) < 0.02) return;

  const cos = Math.cos(dYaw);
  const sin = Math.sin(dYaw);
  for (const v of userVecs) {
    if (!v) continue;
    const x = v.x * cos - v.z * sin;
    const z = v.x * sin + v.z * cos;
    v.x = x;
    v.z = z;
  }
}

function userBoneVec(
  vecs                 ,
  midHips               ,
  midShoulders               ,
  a          ,
  b          ,
)                       {
  const pa = resolveUserAnchor(vecs, midHips, midShoulders, a);
  const pb = resolveUserAnchor(vecs, midHips, midShoulders, b);
  if (!pa || !pb) return null;
  USER_TMP.subVectors(pb, pa);
  return USER_TMP;
}

function coachBoneVec(seed              , from           , to           )                       {
  const pa = seed[from]?.position;
  const pb = seed[to]?.position;
  if (!pa || !pb) return null;
  COACH_TMP.set(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
  return COACH_TMP;
}

function resolveUserAnchor(
  vecs                 ,
  midHips               ,
  midShoulders               ,
  anchor          ,
)                       {
  if (anchor === "midHips") return midHips;
  if (anchor === "midShoulders") return midShoulders;
  return vecs[anchor] ?? null;
}

function jointAngleUser(vecs                 , a        , b        , c        )                {
  const va = vecs[a];
  const vb = vecs[b];
  const vc = vecs[c];
  if (!va || !vb || !vc) return null;
  return angleAt([va.x, va.y, va.z], [vb.x, vb.y, vb.z], [vc.x, vc.y, vc.z]);
}

function jointAngleCoach(seed              , a           , b           , c           )                {
  const pa = seed[a]?.position;
  const pb = seed[b]?.position;
  const pc = seed[c]?.position;
  if (!pa || !pb || !pc) return null;
  return angleAt(pa, pb, pc);
}

function angleAt(
  a                                   ,
  b                                   ,
  c                                   ,
)                {
  const ba                           = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const bc                           = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const baLen = Math.hypot(ba[0], ba[1], ba[2]);
  const bcLen = Math.hypot(bc[0], bc[1], bc[2]);
  if (baLen === 0 || bcLen === 0) return null;
  const dot = (ba[0] * bc[0] + ba[1] * bc[1] + ba[2] * bc[2]) / (baLen * bcLen);
  const clamped = Math.min(1, Math.max(-1, dot));
  return (Math.acos(clamped) * 180) / Math.PI;
}

function midpoint(a                           , b                           )                       {
  if (!a || !b) return null;
  return new THREE.Vector3((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5);
}

function riskFor(score        )             {
  if (score < 68) return "risk";
  if (score < 82) return "warn";
  return "good";
}

function clamp(value        , lo        , hi        )         {
  return Math.min(hi, Math.max(lo, value));
}
