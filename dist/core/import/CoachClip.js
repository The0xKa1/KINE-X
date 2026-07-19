

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
  const wrapped = ((progress % 1) + 1) % 1; // wrap to [0, 1)
  const last = clip.frames.length - 1;
  const f = wrapped * last;
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
