import { AVATAR_JOINT_COUNT,                          } from "./AvatarAssets.js?v=0.1.8";










export const AVATAR_PREVIEW_POSES                                     = [
  { id: "relaxed", label: "自然站", code: "RELAX", description: "双臂自然下垂" },
  { id: "akimbo", label: "叉腰站", code: "AKIMBO", description: "双手叉腰，默认预览" },
  { id: "victory", label: "胜利 V", code: "VICTORY", description: "双臂向上展开" },
  { id: "rest", label: "展臂", code: "RIG", description: "原始绑定姿态" },
];

const BODY_JOINT = {
  leftShoulder: 16,
  rightShoulder: 17,
  leftElbow: 18,
  rightElbow: 19,
  leftWrist: 20,
  rightWrist: 21,
}         ;

const POSE_ROTATIONS                                                        = {
  relaxed: [
    [BODY_JOINT.leftShoulder, 0, 0, 1, -74],
    [BODY_JOINT.rightShoulder, 0, 0, 1, 74],
    [BODY_JOINT.leftElbow, 0, 0, 1, -6],
    [BODY_JOINT.rightElbow, 0, 0, 1, 6],
  ],
  akimbo: [
    [BODY_JOINT.leftShoulder, 0, 0, 1, -54],
    [BODY_JOINT.rightShoulder, 0, 0, 1, 54],
    [BODY_JOINT.leftElbow, 0, 0, 1, -78],
    [BODY_JOINT.rightElbow, 0, 0, 1, 78],
    [BODY_JOINT.leftWrist, 0, 0, 1, 18],
    [BODY_JOINT.rightWrist, 0, 0, 1, -18],
  ],
  victory: [
    [BODY_JOINT.leftShoulder, 0, 0, 1, 48],
    [BODY_JOINT.rightShoulder, 0, 0, 1, -48],
    [BODY_JOINT.leftElbow, 0, 0, 1, 8],
    [BODY_JOINT.rightElbow, 0, 0, 1, -8],
  ],
  rest: [],
};









export function createAvatarPreviewPose(id                     )                      {
  const localRotations = new Float32Array(AVATAR_JOINT_COUNT * 4);
  for (let joint = 0; joint < AVATAR_JOINT_COUNT; joint++) localRotations[joint * 4 + 3] = 1;
  for (const [joint, axisX, axisY, axisZ, degrees] of POSE_ROTATIONS[id]) {
    writeAxisAngle(localRotations, joint, axisX, axisY, axisZ, degrees);
  }
  return {
    meta: { kind: "kinex.avatar-preview-pose", poseId: id },
    frameCount: 1,
    jointCount: AVATAR_JOINT_COUNT,
    localRotations,
    translations: new Float32Array(3),
    stageTranslations: new Float32Array(3),
    stageLinear: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
  };
}

function writeAxisAngle(
  target              ,
  joint        ,
  axisX        ,
  axisY        ,
  axisZ        ,
  degrees        ,
)       {
  const length = Math.hypot(axisX, axisY, axisZ);
  if (length === 0) throw new Error("[AvatarPreviewPoses] rotation axis must be non-zero");
  const halfAngle = degrees * Math.PI / 360;
  const scale = Math.sin(halfAngle) / length;
  const offset = joint * 4;
  target[offset] = axisX * scale;
  target[offset + 1] = axisY * scale;
  target[offset + 2] = axisZ * scale;
  target[offset + 3] = Math.cos(halfAngle);
}
