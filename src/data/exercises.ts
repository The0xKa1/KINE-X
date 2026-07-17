import type { ExerciseConfig, ExerciseId, JointMetricSeed, PipelineStep, SeedMotion } from "../types/motion.js";

// Metric weight templates per motion category, used both by the built-in seed
// and to score imported clips. Retired built-in seeds live on here as
// templates (deadlift→hinge, baduanjin→flow, street→bounce, basketball→throw).
// `name` is user-facing copy (Chinese); `id` stays stable for stress mapping.
export const MOTION_METRIC_TEMPLATES: Record<SeedMotion, JointMetricSeed[]> = {
  squat: [
    { id: "knee", name: "膝盖内扣", base: 90, variance: 9, angle: 6, distance: 8 },
    { id: "hip", name: "髋部深度", base: 86, variance: 7, angle: 9, distance: 12 },
    { id: "spine", name: "腰椎稳定", base: 78, variance: 12, angle: 14, distance: 18 },
    { id: "ankle", name: "踝关节负荷", base: 84, variance: 8, angle: 8, distance: 10 },
  ],
  hinge: [
    { id: "spine", name: "腰椎稳定", base: 76, variance: 14, angle: 17, distance: 20 },
    { id: "hip", name: "髋铰链", base: 88, variance: 8, angle: 7, distance: 11 },
    { id: "shoulder", name: "杠铃轨迹", base: 82, variance: 9, angle: 10, distance: 13 },
    { id: "knee", name: "膝盖前冲", base: 86, variance: 6, angle: 5, distance: 9 },
  ],
  flow: [
    { id: "shoulder", name: "肩臂弧线", base: 91, variance: 5, angle: 5, distance: 7 },
    { id: "wrist", name: "手腕轨迹", base: 83, variance: 10, angle: 8, distance: 15 },
    { id: "spine", name: "中轴稳定", base: 88, variance: 7, angle: 6, distance: 8 },
    { id: "hip", name: "重心转换", base: 80, variance: 9, angle: 11, distance: 14 },
  ],
  bounce: [
    { id: "shoulder", name: "肩部律动", base: 84, variance: 12, angle: 10, distance: 16 },
    { id: "hip", name: "髋部节奏", base: 87, variance: 11, angle: 9, distance: 12 },
    { id: "ankle", name: "脚步节拍", base: 79, variance: 13, angle: 12, distance: 19 },
    { id: "spine", name: "上身弹性", base: 82, variance: 9, angle: 8, distance: 11 },
  ],
  throw: [
    { id: "shoulder", name: "持球点稳定", base: 86, variance: 9, angle: 9, distance: 11 },
    { id: "wrist", name: "压腕拨球", base: 81, variance: 13, angle: 13, distance: 16 },
    { id: "knee", name: "膝盖发力", base: 84, variance: 8, angle: 7, distance: 12 },
    { id: "spine", name: "出手轴心", base: 88, variance: 7, angle: 6, distance: 9 },
  ],
};

export const exerciseOrder: ExerciseId[] = ["squat"];

export const exercises: Record<ExerciseId, ExerciseConfig> = {
  squat: {
    id: "squat",
    name: "Deep Squat Tutor",
    discipline: "Fitness",
    seedUrl: "douyin://seed/deep-squat-0421",
    durationSeconds: 7.2,
    motion: "squat",
    target: "膝盖始终对准脚尖方向",
    params: {
      beta: "[0.08, -0.04, 0.13, 0.02, ...]",
      theta: "24x3 quaternion, 180 frames",
      trans: "[x:0.00m, y:0.84m, z:0.18m]",
      format: "kinex.v1.motion_dna.json",
    },
    metrics: MOTION_METRIC_TEMPLATES.squat.map((m) => ({ ...m })),
  },
};

export const pipeline: PipelineStep[] = [
  { name: "YOLOv8-Pose", detail: "bbox + 2D keypoints" },
  { name: "WHAM / gvHMR", detail: "mock SMPL-X sequence" },
  { name: "Action DNA", detail: "normalized motion cache" },
  { name: "MediaPipe", detail: "browser pose stream" },
  { name: "Angle Solver", detail: "3D distance + score" },
];
