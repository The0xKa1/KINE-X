











export const SCORING_BONES                = [
  { from: "lHip", to: "lKnee", mpFrom: 23, mpTo: 25, metricIds: ["knee", "hip"] },
  { from: "lKnee", to: "lAnkle", mpFrom: 25, mpTo: 27, metricIds: ["knee", "ankle"] },
  { from: "rHip", to: "rKnee", mpFrom: 24, mpTo: 26, metricIds: ["knee", "hip"] },
  { from: "rKnee", to: "rAnkle", mpFrom: 26, mpTo: 28, metricIds: ["knee", "ankle"] },
  { from: "lShoulder", to: "lElbow", mpFrom: 11, mpTo: 13, metricIds: ["shoulder"] },
  { from: "lElbow", to: "lWrist", mpFrom: 13, mpTo: 15, metricIds: ["shoulder", "wrist"] },
  { from: "rShoulder", to: "rElbow", mpFrom: 12, mpTo: 14, metricIds: ["shoulder"] },
  { from: "rElbow", to: "rWrist", mpFrom: 14, mpTo: 16, metricIds: ["shoulder", "wrist"] },
  { from: "chest", to: "lShoulder", mpFrom: "midShoulders", mpTo: 11, metricIds: ["shoulder"] },
  { from: "chest", to: "rShoulder", mpFrom: "midShoulders", mpTo: 12, metricIds: ["shoulder"] },
  { from: "pelvis", to: "chest", mpFrom: "midHips", mpTo: "midShoulders", metricIds: ["spine", "hip"] },
  { from: "neck", to: "head", mpFrom: "midShoulders", mpTo: 0, metricIds: ["spine"] },
];
