// MediaPipe Pose worldLandmarks: x:right, y:down, z:toward camera (image-aligned).
// KINE//X WORLD_SPACE: y:up, x:right, z:out-of-screen, right-hand.
// v1 default: (-x, -y, -z). Re-tune here once we have empirical L/R alignment data.
import { THREE, type MotionVector3 } from "../three-compat.js";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

export function normalizeMediaPipeWorld(landmarks: NormalizedLandmark[]): MotionVector3[] {
  return landmarks.map((p) => new THREE.Vector3(-p.x, -p.y, -p.z));
}
