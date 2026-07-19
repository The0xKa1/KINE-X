// MediaPipe Pose worldLandmarks: x:right, y:down, z:toward camera (image-aligned).
// KINE//X WORLD_SPACE: y:up, x:right, z:out-of-screen, right-hand.
// v1 default: (-x, -y, -z). Re-tune here once we have empirical L/R alignment data.
import { THREE,                    } from "../three-compat.js";


export function normalizeMediaPipeWorld(landmarks                      )                  {
  return landmarks.map((p) => new THREE.Vector3(-p.x, -p.y, -p.z));
}
