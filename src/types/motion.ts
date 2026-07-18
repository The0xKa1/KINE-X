import type { MotionQuaternion } from "../core/three-compat.js";

export type Meters = number;
export type Degrees = number;
export type Centimeters = number;
export type TimestampMs = number;

export type Vec3Meters = [Meters, Meters, Meters];
export type QuaternionTuple = [number, number, number, number];

// Built-in seeds shipped with the app. squat = pre-baked clip; ugc-squat = a
// real video imported through the SAM3D backend and committed as an asset.
// Retired seeds (deadlift/baduanjin/street/basketball) survive as metric
// templates in data/exercises.ts (MOTION_METRIC_TEMPLATES).
export type ExerciseId = "squat" | "ugc-squat";

// Runtime-side exercise id: built-in literals OR an arbitrary string for
// imported clips. Keep `ExerciseId` strict for `data/exercises.ts`; use
// `RuntimeExerciseId` everywhere a user-imported seed can show up.
export type RuntimeExerciseId = ExerciseId | string;

export type MotionMode = "coach" | "mesh" | "stress";
export type CameraView = "front" | "side" | "top";
export type MetricRisk = "good" | "warn" | "risk";
export type StreamMode = "mock" | "camera";

export type JointName =
  | "pelvis"
  | "spine"
  | "chest"
  | "neck"
  | "head"
  | "lShoulder"
  | "rShoulder"
  | "lElbow"
  | "rElbow"
  | "lWrist"
  | "rWrist"
  | "lHip"
  | "rHip"
  | "lKnee"
  | "rKnee"
  | "lAnkle"
  | "rAnkle";

export interface JointPose {
  position: Vec3Meters;
  rotation: QuaternionTuple;
}

export type SkeletonPose = Record<JointName, JointPose>;

export interface JointMetricSeed {
  id: string;
  name: string;
  base: number;
  variance: number;
  angle: Degrees;
  distance: Centimeters;
}

export interface JointMetric extends JointMetricSeed {
  score: number;
  angleDeltaDeg: Degrees;
  distanceDeltaCm: Centimeters;
  risk: MetricRisk;
}

export interface SmplxMetadata {
  beta: string;
  theta: string;
  trans: string;
  format: string;
}

export type SeedMotion = "squat" | "hinge" | "flow" | "bounce" | "throw";

export interface CoachClip {
  id: string;
  name: string;
  fps: number;
  durationSeconds: number;
  frames: SkeletonPose[];
  motion: SeedMotion;
  capturedAt: number;
  thumbnails: string[];
}

export interface CoachVideoSources {
  front: string;
  side?: string | undefined;
  top?: string | undefined;
}

export interface ExerciseConfig {
  id: string;
  name: string;
  discipline: string;
  seedUrl: string;
  durationSeconds: number;
  motion: SeedMotion;
  target: string;
  params: SmplxMetadata;
  metrics: JointMetricSeed[];
  clip?: CoachClip;
  /** Optional photoreal coach video(s), one per camera angle. */
  coachVideo?: CoachVideoSources | undefined;
}

export interface MotionFrame {
  frame: number;
  timestampMs: TimestampMs;
  seedId: string;
  progress: number;
  score: number;
  combo: number;
  riskLabel: string;
  globalTransform: {
    translation: Vec3Meters;
    rotation: QuaternionTuple;
  };
  seedJoints: SkeletonPose;
  joints: SkeletonPose;
  localRotations: QuaternionTuple[];
  metrics: JointMetric[];
}

export interface RuntimeFrame extends Omit<MotionFrame, "globalTransform" | "seedJoints" | "joints" | "localRotations"> {
  globalTransform: {
    translation: Vec3Meters;
    rotation: MotionQuaternion;
  };
  seedJoints: Record<JointName, { position: Vec3Meters; rotation: MotionQuaternion }>;
  joints: Record<JointName, { position: Vec3Meters; rotation: MotionQuaternion }>;
  localRotations: MotionQuaternion[];
}

export interface FrameStreamPacket {
  type: "FRAME_STREAM";
  data: MotionFrame;
}

export interface ScoreUpdate {
  score: number;
  combo: number;
  metrics: JointMetric[];
  riskLabel: string;
  frame: number;
  progress: number;
}

export interface PipelineStep {
  name: string;
  detail: string;
}

export interface PipelineUpdate {
  runIndex: number;
  latencyMs: number;
  status: "queued" | "busy" | "ready";
}

export interface SeedUpdate {
  exercise: ExerciseConfig;
  message: string;
}
