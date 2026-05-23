import type {
  FaceLandmarker,
  HandLandmarker,
  NormalizedLandmark,
  PoseLandmarker,
} from "@mediapipe/tasks-vision";
import { LandmarkSmoother } from "./scoring/LandmarkSmoother.js";

export type PoseModel = "lite" | "full" | "heavy";
export type ModalityKind = "pose" | "hand" | "face";

const WASM_BASE = "./public/mediapipe/wasm";

const POSE_MODEL_URLS: Record<PoseModel, string> = {
  lite: "./public/mediapipe/models/pose_landmarker_lite.task",
  full: "./public/mediapipe/models/pose_landmarker_full.task",
  heavy: "./public/mediapipe/models/pose_landmarker_heavy.task",
};

const HAND_MODEL_URL = "./public/mediapipe/models/hand_landmarker.task";
const FACE_MODEL_URL = "./public/mediapipe/models/face_landmarker.task";

const POSE_LANDMARK_COUNT = 33;
const HAND_LANDMARK_COUNT = 21;
const FACE_LANDMARK_COUNT = 478;

export interface PoseResult {
  image: NormalizedLandmark[];
  world: NormalizedLandmark[];
}

export interface HandResult {
  landmarks: NormalizedLandmark[];
  handedness: string;
}

export interface DetectResult {
  pose: PoseResult | null;
  hands: HandResult[];
  face: NormalizedLandmark[] | null;
}

type VisionModule = typeof import("@mediapipe/tasks-vision");

interface PoseSlot {
  landmarker: PoseLandmarker | null;
  pending: Promise<void> | null;
  imageSmoother: LandmarkSmoother;
  worldSmoother: LandmarkSmoother;
}

interface HandSlot {
  landmarker: HandLandmarker | null;
  pending: Promise<void> | null;
}

interface FaceSlot {
  landmarker: FaceLandmarker | null;
  pending: Promise<void> | null;
  smoother: LandmarkSmoother;
}

export class LandmarkerController {
  private model: PoseModel = "lite";
  private enabled: Record<ModalityKind, boolean> = { pose: true, hand: true, face: true };
  private vision: { module: VisionModule; fileset: Awaited<ReturnType<VisionModule["FilesetResolver"]["forVisionTasks"]>> } | null = null;
  private visionPending: Promise<void> | null = null;
  private pose: PoseSlot = {
    landmarker: null,
    pending: null,
    imageSmoother: new LandmarkSmoother(POSE_LANDMARK_COUNT),
    worldSmoother: new LandmarkSmoother(POSE_LANDMARK_COUNT),
  };
  private hand: HandSlot = { landmarker: null, pending: null };
  private face: FaceSlot = {
    landmarker: null,
    pending: null,
    smoother: new LandmarkSmoother(FACE_LANDMARK_COUNT),
  };
  private lastTs = -1;

  getModel(): PoseModel {
    return this.model;
  }

  setModel(model: PoseModel): void {
    if (model === this.model) return;
    this.model = model;
    this.disposePose();
  }

  isEnabled(kind: ModalityKind): boolean {
    return this.enabled[kind];
  }

  setEnabled(kind: ModalityKind, on: boolean): void {
    if (this.enabled[kind] === on) return;
    this.enabled[kind] = on;
    if (!on) {
      if (kind === "pose") this.disposePose();
      if (kind === "hand") this.disposeHand();
      if (kind === "face") this.disposeFace();
    }
  }

  async ensureReady(modalities: ModalityKind[] = ["pose", "hand", "face"]): Promise<void> {
    await this.ensureVision();
    const ready = this.vision;
    if (!ready) return;
    const pending: Promise<void>[] = [];
    for (const kind of modalities) {
      if (!this.enabled[kind]) continue;
      if (kind === "pose") {
        this.ensurePose(ready);
        if (this.pose.pending) pending.push(this.pose.pending);
      } else if (kind === "hand") {
        this.ensureHand(ready);
        if (this.hand.pending) pending.push(this.hand.pending);
      } else if (kind === "face") {
        this.ensureFace(ready);
        if (this.face.pending) pending.push(this.face.pending);
      }
    }
    if (pending.length > 0) await Promise.all(pending);
  }

  detect(video: HTMLVideoElement, timestampMs: number): DetectResult | null {
    if (video.readyState < 2 || video.videoWidth === 0) return null;
    const ts = timestampMs > this.lastTs ? timestampMs : this.lastTs + 1;
    this.lastTs = ts;

    void this.ensureVision();
    const ready = this.vision;
    if (!ready) return null;

    const result: DetectResult = { pose: null, hands: [], face: null };

    if (this.enabled.pose) {
      this.ensurePose(ready);
      const inst = this.pose.landmarker;
      if (inst) {
        const r = inst.detectForVideo(video, ts);
        const rawImage = r.landmarks[0];
        if (rawImage) {
          const rawWorld = r.worldLandmarks?.[0] ?? [];
          const image = this.pose.imageSmoother.smooth(rawImage, ts);
          const world = rawWorld.length === POSE_LANDMARK_COUNT ? this.pose.worldSmoother.smooth(rawWorld, ts) : rawWorld;
          result.pose = { image, world };
        }
      }
    }

    if (this.enabled.hand) {
      this.ensureHand(ready);
      const inst = this.hand.landmarker;
      if (inst) {
        const r = inst.detectForVideo(video, ts);
        const allLandmarks = r.landmarks ?? [];
        const allHandedness = r.handedness ?? r.handednesses ?? [];
        result.hands = allLandmarks.map((lms, i) => {
          const label = allHandedness[i]?.[0]?.categoryName ?? "Unknown";
          return { landmarks: lms, handedness: label };
        });
      }
    }

    if (this.enabled.face) {
      this.ensureFace(ready);
      const inst = this.face.landmarker;
      if (inst) {
        const r = inst.detectForVideo(video, ts);
        const lms = r.faceLandmarks?.[0];
        if (lms) {
          result.face = lms.length === FACE_LANDMARK_COUNT ? this.face.smoother.smooth(lms, ts) : lms;
        }
      }
    }

    return result;
  }

  private async ensureVision(): Promise<void> {
    if (this.vision) return;
    if (this.visionPending) return this.visionPending;
    this.visionPending = (async () => {
      try {
        const module = await import("@mediapipe/tasks-vision");
        const fileset = await module.FilesetResolver.forVisionTasks(WASM_BASE);
        this.vision = { module, fileset };
      } catch (error) {
        console.warn("[LandmarkerController] vision init failed", error);
      }
    })();
    return this.visionPending;
  }

  private ensurePose(ready: NonNullable<typeof this.vision>): void {
    if (this.pose.landmarker || this.pose.pending) return;
    this.pose.pending = (async () => {
      try {
        const landmarker = await ready.module.PoseLandmarker.createFromOptions(ready.fileset, {
          baseOptions: { modelAssetPath: POSE_MODEL_URLS[this.model], delegate: "GPU" },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        if (this.enabled.pose) {
          this.pose.landmarker = landmarker;
        } else {
          landmarker.close();
        }
      } catch (error) {
        console.warn("[LandmarkerController] pose init failed", error);
      } finally {
        this.pose.pending = null;
      }
    })();
  }

  private ensureHand(ready: NonNullable<typeof this.vision>): void {
    if (this.hand.landmarker || this.hand.pending) return;
    this.hand.pending = (async () => {
      try {
        const landmarker = await ready.module.HandLandmarker.createFromOptions(ready.fileset, {
          baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        if (this.enabled.hand) {
          this.hand.landmarker = landmarker;
        } else {
          landmarker.close();
        }
      } catch (error) {
        console.warn("[LandmarkerController] hand init failed", error);
      } finally {
        this.hand.pending = null;
      }
    })();
  }

  private ensureFace(ready: NonNullable<typeof this.vision>): void {
    if (this.face.landmarker || this.face.pending) return;
    this.face.pending = (async () => {
      try {
        const landmarker = await ready.module.FaceLandmarker.createFromOptions(ready.fileset, {
          baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numFaces: 1,
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        if (this.enabled.face) {
          this.face.landmarker = landmarker;
        } else {
          landmarker.close();
        }
      } catch (error) {
        console.warn("[LandmarkerController] face init failed", error);
      } finally {
        this.face.pending = null;
      }
    })();
  }

  private disposePose(): void {
    this.pose.landmarker?.close();
    this.pose.landmarker = null;
    this.pose.imageSmoother.reset();
    this.pose.worldSmoother.reset();
  }

  private disposeHand(): void {
    this.hand.landmarker?.close();
    this.hand.landmarker = null;
  }

  private disposeFace(): void {
    this.face.landmarker?.close();
    this.face.landmarker = null;
    this.face.smoother.reset();
  }
}

export { HAND_LANDMARK_COUNT, POSE_LANDMARK_COUNT, FACE_LANDMARK_COUNT };
