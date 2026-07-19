

const JOINT_NAMES              = [
  "pelvis",
  "spine",
  "chest",
  "neck",
  "head",
  "lShoulder",
  "rShoulder",
  "lElbow",
  "rElbow",
  "lWrist",
  "rWrist",
  "lHip",
  "rHip",
  "lKnee",
  "rKnee",
  "lAnkle",
  "rAnkle",
];

export function lerpPose(a              , b              , t        )               {
  const out = {}                ;
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  for (const name of JOINT_NAMES) {
    const ja = a[name];
    const jb = b[name];
    out[name] = lerpJoint(ja, jb, clamped);
  }
  return out;
}

export function sampleClip(clip           , progress        )               {
  if (clip.frames.length === 0) {
    throw new Error("CoachClip has no frames");
  }
  if (clip.frames.length === 1) return clip.frames[0] ;
  // Clamp, not wrap: the preview loop already wraps progress upstream in
  // RealtimeStream, so a value of exactly 1 only arrives at session end —
  // every layer must hold the final frame there, never snap back to frame 0.
  const clamped = Math.max(0, Math.min(1, progress));
  const last = clip.frames.length - 1;
  const f = clamped * last;
  const lo = Math.floor(f);
  const hi = Math.min(lo + 1, last);
  const a = clip.frames[lo] ;
  const b = clip.frames[hi] ;
  return lerpPose(a, b, f - lo);
}

function lerpJoint(a           , b           , t        )            {
  return {
    position: lerpVec(a.position, b.position, t),
    rotation: a.rotation,
  };
}

function lerpVec(a            , b            , t        )             {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

export { JOINT_NAMES };
