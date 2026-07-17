import type { CoachClip, JointName, SeedMotion, SkeletonPose, Vec3Meters } from "../../types/motion.js";

export interface CoachClipManifestEntry {
  exercise: string;
  url: string;
  framesDir?: string;
  frameCount?: number;
  framePattern?: string;
  thumbnailCount?: number;
}

export interface FrameThumbnailMeta {
  framesDir: string;
  framePattern: string;
  frameCount: number;
  thumbnailCount?: number | undefined;
}

const COACH_CLIP_MANIFEST: CoachClipManifestEntry[] = [
  {
    exercise: "squat",
    url: "public/coach_clips/single_leg_squat.json",
    framesDir: "public/coach_clips/single_leg_squat_frames",
    frameCount: 118,
    framePattern: "frame_{i:05}.jpg",
    thumbnailCount: 18,
  },
  {
    exercise: "ugc-squat",
    url: "public/coach_clips/ugc_squat.json",
    framesDir: "public/coach_clips/ugc_squat_frames",
    frameCount: 118,
    framePattern: "frame_{i:05}.jpg",
    thumbnailCount: 18,
  },
];

interface RawJoint {
  position: [number, number, number];
  rotation: [number, number, number, number];
}

interface RawClip {
  id: string;
  name: string;
  fps: number;
  durationSeconds: number;
  frames: Array<Record<string, RawJoint>>;
  motion: SeedMotion;
  capturedAt: number;
  thumbnails: string[];
}

const JOINT_NAMES: JointName[] = [
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

export function getCoachClipManifest(): readonly CoachClipManifestEntry[] {
  return COACH_CLIP_MANIFEST;
}

export async function loadCoachClip(url: string): Promise<CoachClip> {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Failed to fetch coach clip ${url}: ${response.status}`);
  }
  const raw = (await response.json()) as RawClip;
  return validateClip(raw);
}

export function buildFrameThumbnails(entry: CoachClipManifestEntry): string[] {
  if (!entry.framesDir || !entry.frameCount || !entry.framePattern) return [];
  return buildFrameThumbnailsFromMeta({
    framesDir: entry.framesDir,
    framePattern: entry.framePattern,
    frameCount: entry.frameCount,
    thumbnailCount: entry.thumbnailCount,
  });
}

export function buildFrameThumbnailsFromMeta(meta: FrameThumbnailMeta): string[] {
  const total = meta.frameCount;
  if (total <= 0) return [];
  const count = Math.min(meta.thumbnailCount ?? 18, total);
  const denom = Math.max(1, count - 1);
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const idx = Math.round((i / denom) * (total - 1)) + 1;
    out.push(`${meta.framesDir}/${formatFrameName(meta.framePattern, idx)}`);
  }
  return out;
}

function formatFrameName(pattern: string, index: number): string {
  return pattern.replace(/\{i:(\d+)\}/g, (_, widthStr) => {
    const width = Number(widthStr);
    return String(index).padStart(width, "0");
  });
}

function validateClip(raw: RawClip): CoachClip {
  if (!Array.isArray(raw.frames) || raw.frames.length === 0) {
    throw new Error("Coach clip has no frames");
  }
  if (typeof raw.fps !== "number" || raw.fps <= 0) {
    throw new Error("Coach clip fps is invalid");
  }
  const frames = raw.frames.map((frame, index) => toSkeletonPose(frame, index));
  return {
    id: raw.id,
    name: raw.name,
    fps: raw.fps,
    durationSeconds: raw.durationSeconds,
    frames,
    motion: raw.motion,
    capturedAt: raw.capturedAt,
    thumbnails: Array.isArray(raw.thumbnails) ? raw.thumbnails : [],
  };
}

function toSkeletonPose(frame: Record<string, RawJoint>, index: number): SkeletonPose {
  const out = {} as SkeletonPose;
  for (const name of JOINT_NAMES) {
    const raw = frame[name];
    if (!raw) {
      throw new Error(`Coach clip frame ${index} missing joint ${name}`);
    }
    const position: Vec3Meters = [raw.position[0], raw.position[1], raw.position[2]];
    out[name] = {
      position,
      rotation: [raw.rotation[0], raw.rotation[1], raw.rotation[2], raw.rotation[3]],
    };
  }
  return out;
}
