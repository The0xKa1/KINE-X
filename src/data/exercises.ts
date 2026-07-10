import type { ExerciseConfig, ExerciseId, PipelineStep } from "../types/motion.js";

export const exerciseOrder: ExerciseId[] = ["squat", "deadlift", "baduanjin", "street", "basketball"];

export const exercises: Record<ExerciseId, ExerciseConfig> = {
  squat: {
    id: "squat",
    name: "Deep Squat Tutor",
    discipline: "Fitness",
    seedUrl: "douyin://seed/deep-squat-0421",
    durationSeconds: 7.2,
    motion: "squat",
    target: "Keep knees tracking over toes",
    params: {
      beta: "[0.08, -0.04, 0.13, 0.02, ...]",
      theta: "24x3 quaternion, 180 frames",
      trans: "[x:0.00m, y:0.84m, z:0.18m]",
      format: "kinex.v1.motion_dna.json",
    },
    metrics: [
      { id: "knee", name: "Knee Valgus", base: 90, variance: 9, angle: 6, distance: 8 },
      { id: "hip", name: "Hip Depth", base: 86, variance: 7, angle: 9, distance: 12 },
      { id: "spine", name: "Lumbar Stack", base: 78, variance: 12, angle: 14, distance: 18 },
      { id: "ankle", name: "Ankle Load", base: 84, variance: 8, angle: 8, distance: 10 },
    ],
  },
  deadlift: {
    id: "deadlift",
    name: "Deadlift Spine Guard",
    discipline: "Strength",
    seedUrl: "douyin://seed/deadlift-spine-1602",
    durationSeconds: 6.4,
    motion: "hinge",
    target: "Neutral spine through hinge",
    params: {
      beta: "[0.04, 0.02, -0.03, 0.11, ...]",
      theta: "24x3 quaternion, 160 frames",
      trans: "[x:0.02m, y:0.91m, z:0.24m]",
      format: "kinex.v1.motion_dna.json",
    },
    metrics: [
      { id: "spine", name: "Lumbar Stack", base: 76, variance: 14, angle: 17, distance: 20 },
      { id: "hip", name: "Hip Hinge", base: 88, variance: 8, angle: 7, distance: 11 },
      { id: "shoulder", name: "Bar Path", base: 82, variance: 9, angle: 10, distance: 13 },
      { id: "knee", name: "Knee Drift", base: 86, variance: 6, angle: 5, distance: 9 },
    ],
  },
  baduanjin: {
    id: "baduanjin",
    name: "Baduanjin Cloud Hands",
    discipline: "Traditional",
    seedUrl: "douyin://seed/baduanjin-cloud-0909",
    durationSeconds: 9.5,
    motion: "flow",
    target: "Slow shoulder and wrist symmetry",
    params: {
      beta: "[-0.02, 0.06, 0.03, -0.01, ...]",
      theta: "24x3 quaternion, 240 frames",
      trans: "[x:-0.01m, y:0.88m, z:0.10m]",
      format: "kinex.v1.motion_dna.json",
    },
    metrics: [
      { id: "shoulder", name: "Shoulder Arc", base: 91, variance: 5, angle: 5, distance: 7 },
      { id: "wrist", name: "Wrist Trace", base: 83, variance: 10, angle: 8, distance: 15 },
      { id: "spine", name: "Center Axis", base: 88, variance: 7, angle: 6, distance: 8 },
      { id: "hip", name: "Weight Shift", base: 80, variance: 9, angle: 11, distance: 14 },
    ],
  },
  street: {
    id: "street",
    name: "Street Dance Toprock",
    discipline: "Dance",
    seedUrl: "douyin://seed/toprock-basic-2314",
    durationSeconds: 5.8,
    motion: "bounce",
    target: "Beat lock and shoulder groove",
    params: {
      beta: "[0.01, 0.01, 0.05, -0.05, ...]",
      theta: "24x3 quaternion, 144 frames",
      trans: "[x:0.13m, y:0.86m, z:0.08m]",
      format: "kinex.v1.motion_dna.json",
    },
    metrics: [
      { id: "shoulder", name: "Shoulder Groove", base: 84, variance: 12, angle: 10, distance: 16 },
      { id: "hip", name: "Hip Rhythm", base: 87, variance: 11, angle: 9, distance: 12 },
      { id: "ankle", name: "Foot Timing", base: 79, variance: 13, angle: 12, distance: 19 },
      { id: "spine", name: "Upper Bounce", base: 82, variance: 9, angle: 8, distance: 11 },
    ],
  },
  basketball: {
    id: "basketball",
    name: "Free Throw Release",
    discipline: "Ball",
    seedUrl: "douyin://seed/free-throw-0818",
    durationSeconds: 4.9,
    motion: "throw",
    target: "Elbow line and wrist release",
    params: {
      beta: "[0.03, -0.06, 0.02, 0.07, ...]",
      theta: "24x3 quaternion, 120 frames",
      trans: "[x:0.00m, y:0.90m, z:0.16m]",
      format: "kinex.v1.motion_dna.json",
    },
    metrics: [
      { id: "shoulder", name: "Shot Pocket", base: 86, variance: 9, angle: 9, distance: 11 },
      { id: "wrist", name: "Wrist Snap", base: 81, variance: 13, angle: 13, distance: 16 },
      { id: "knee", name: "Knee Drive", base: 84, variance: 8, angle: 7, distance: 12 },
      { id: "spine", name: "Release Axis", base: 88, variance: 7, angle: 6, distance: 9 },
    ],
  },
};

export const pipeline: PipelineStep[] = [
  { name: "YOLOv8-Pose", detail: "bbox + 2D keypoints" },
  { name: "WHAM / gvHMR", detail: "mock SMPL-X sequence" },
  { name: "Action DNA", detail: "normalized motion cache" },
  { name: "MediaPipe", detail: "browser pose stream" },
  { name: "Angle Solver", detail: "3D distance + score" },
];
