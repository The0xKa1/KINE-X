
import { hasPlayableAvatarAsset } from "../core/avatar/AvatarBindingController.js?v=0.1.10";
















export function hasPlayableAvatar(
  exercise                                                  ,
)          {
  return hasPlayableAvatarAsset(exercise);
}

// Metric weight templates per motion category, used both by the built-in seed
// and to score imported clips. Retired built-in seeds live on here as
// templates (deadlift→hinge, baduanjin→flow, street→bounce, basketball→throw).
// `name` is user-facing copy (Chinese); `id` stays stable for stress mapping.
export const MOTION_METRIC_TEMPLATES                                        = {
  squat: [
    { id: "knee", name: "膝关节屈伸", base: 90, variance: 9, angle: 6, distance: 8 },
    { id: "hip", name: "髋部深度", base: 86, variance: 7, angle: 9, distance: 12 },
    { id: "spine", name: "腰椎稳定", base: 78, variance: 12, angle: 14, distance: 18 },
    { id: "ankle", name: "踝关节姿态", base: 84, variance: 8, angle: 8, distance: 10 },
  ],
  hinge: [
    { id: "spine", name: "腰椎稳定", base: 76, variance: 14, angle: 17, distance: 20 },
    { id: "hip", name: "髋铰链", base: 88, variance: 8, angle: 7, distance: 11 },
    { id: "shoulder", name: "杠铃轨迹", base: 82, variance: 9, angle: 10, distance: 13 },
    { id: "knee", name: "膝部屈曲", base: 86, variance: 6, angle: 5, distance: 9 },
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

export const exerciseOrder               = ["squat", "ugc-squat"];

export const exercises                                           = {
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
  "ugc-squat": {
    id: "ugc-squat",
    name: "UGC Squat Import",
    discipline: "Imported",
    seedUrl: "local://import/ugc-squat",
    durationSeconds: 7.867,
    motion: "squat",
    target: "上传视频重建的私人教练",
    params: {
      beta: "",
      theta: "",
      trans: "",
      format: "kinex.coach_clip.v1",
    },
    metrics: MOTION_METRIC_TEMPLATES.squat.map((m) => ({ ...m })),
    coachVideo: {
      front: "public/coach_clips/ugc_squat_twin.mp4",
      side: "public/coach_clips/ugc_squat_lhm_side.mp4",
      top: "public/coach_clips/ugc_squat_lhm_top.mp4",
    },
    // 3DGS digital human (KINEXGS1) — a display mode of this seed, not a seed
    // of its own. Switch the stage to 分身 mode to bring it up.
    avatarUrl: "public/coach_clips/gs_avatar_coach.bin",
  },
};

export const pipeline                 = [
  { name: "SAM 3D Body", detail: "video → SMPL-X 离线重建" },
  { name: "Action DNA", detail: "coach clip 归一化缓存" },
  { name: "MediaPipe Pose", detail: "33pt world landmarks · 浏览器实时" },
  { name: "Angle Solver", detail: "骨向 + 关节角 + DTW-lite" },
  { name: "Score Fusion", detail: "加权帧分 · 风险标记" },
];
