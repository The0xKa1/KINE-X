

// Joint flexion: angle between bone (a→b) and bone (b→c), measured at b.
// 0° = fully extended (bones collinear, opposite directions). 180° = fully flexed.
// We compute the supplementary angle of acos(dot(v_ba, v_bc)) so the interpretation
// matches biomechanical convention.









export const JOINT_ANGLES                   = [
  // Knee: hip → knee → ankle
  { metricId: "knee", coach: { a: "lHip", b: "lKnee", c: "lAnkle" }, user: { a: 23, b: 25, c: 27 } },
  { metricId: "knee", coach: { a: "rHip", b: "rKnee", c: "rAnkle" }, user: { a: 24, b: 26, c: 28 } },
  // Hip: shoulder → hip → knee (torso-thigh angle)
  { metricId: "hip", coach: { a: "lShoulder", b: "lHip", c: "lKnee" }, user: { a: 11, b: 23, c: 25 } },
  { metricId: "hip", coach: { a: "rShoulder", b: "rHip", c: "rKnee" }, user: { a: 12, b: 24, c: 26 } },
  // Elbow → captured under shoulder metric (we don't have an "elbow" metric id today)
  { metricId: "shoulder", coach: { a: "lShoulder", b: "lElbow", c: "lWrist" }, user: { a: 11, b: 13, c: 15 } },
  { metricId: "shoulder", coach: { a: "rShoulder", b: "rElbow", c: "rWrist" }, user: { a: 12, b: 14, c: 16 } },
];
