





import { LandmarkSmoother } from "./scoring/LandmarkSmoother.js";




const WASM_BASE = "./public/mediapipe/wasm";

const POSE_MODEL_URLS                            = {
  lite: "./public/mediapipe/models/pose_landmarker_lite.task",
  full: "./public/mediapipe/models/pose_landmarker_full.task",
  heavy: "./public/mediapipe/models/pose_landmarker_heavy.task",
};

const HAND_MODEL_URL = "./public/mediapipe/models/hand_landmarker.task";
const FACE_MODEL_URL = "./public/mediapipe/models/face_landmarker.task";

const POSE_LANDMARK_COUNT = 33;
const HAND_LANDMARK_COUNT = 21;
const FACE_LANDMARK_COUNT = 478;





































export class LandmarkerController {
          model            = "lite";
          enabled                                = { pose: true, hand: true, face: false };
          vision                                                                                                                   = null;
          visionPending                       = null;
          visionRetryAt = 0;
          retryAt                               = { pose: 0, hand: 0, face: 0 };
          onError                                                                        ;
          pose           = {
    landmarker: null,
    pending: null,
    imageSmoother: new LandmarkSmoother(POSE_LANDMARK_COUNT),
    worldSmoother: new LandmarkSmoother(POSE_LANDMARK_COUNT),
  };
          hand           = { landmarker: null, pending: null };
          face           = {
    landmarker: null,
    pending: null,
    smoother: new LandmarkSmoother(FACE_LANDMARK_COUNT),
  };
          lastTs = -1;

  constructor(options                                                                         ) {
    this.onError = options?.onError;
  }

  /** Clears the init-failure throttles so the next ensure retries immediately. */
  resetRetries()       {
    this.visionRetryAt = 0;
    this.retryAt = { pose: 0, hand: 0, face: 0 };
  }

  getModel()            {
    return this.model;
  }

  setModel(model           )       {
    if (model === this.model) return;
    this.model = model;
    this.disposePose();
  }

  isEnabled(kind              )          {
    return this.enabled[kind];
  }

  setEnabled(kind              , on         )       {
    if (this.enabled[kind] === on) return;
    this.enabled[kind] = on;
    if (!on) {
      if (kind === "pose") this.disposePose();
      if (kind === "hand") this.disposeHand();
      if (kind === "face") this.disposeFace();
    }
  }

  async ensureReady(modalities                 = ["pose", "hand", "face"])                {
    await this.ensureVision();
    const ready = this.vision;
    if (!ready) return;
    const pending                  = [];
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

  detect(video                  , timestampMs        )                      {
    if (video.readyState < 2 || video.videoWidth === 0) return null;
    const ts = timestampMs > this.lastTs ? timestampMs : this.lastTs + 1;
    this.lastTs = ts;

    void this.ensureVision();
    const ready = this.vision;
    if (!ready) return null;

    const result               = { pose: null, hands: [], face: null };

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

          async ensureVision()                {
    if (this.vision) return;
    if (this.visionPending) return this.visionPending;
    if (performance.now() < this.visionRetryAt) return;
    this.visionPending = (async () => {
      try {
        const module = await import("@mediapipe/tasks-vision");
        const fileset = await module.FilesetResolver.forVisionTasks(WASM_BASE);
        this.vision = { module, fileset };
      } catch (error) {
        console.warn("[LandmarkerController] vision init failed", error);
        this.visionRetryAt = performance.now() + 3000;
        this.onError?.("vision", errorMessage(error));
      } finally {
        // Clear the cached promise so a later ensure can retry (throttled),
        // instead of caching the failure forever.
        this.visionPending = null;
      }
    })();
    return this.visionPending;
  }

          ensurePose(ready                                 )       {
    if (this.pose.landmarker || this.pose.pending) return;
    if (performance.now() < this.retryAt.pose) return;
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
        this.retryAt.pose = performance.now() + 3000;
        this.onError?.("pose", errorMessage(error));
      } finally {
        this.pose.pending = null;
      }
    })();
  }

          ensureHand(ready                                 )       {
    if (this.hand.landmarker || this.hand.pending) return;
    if (performance.now() < this.retryAt.hand) return;
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
        this.retryAt.hand = performance.now() + 3000;
        this.onError?.("hand", errorMessage(error));
      } finally {
        this.hand.pending = null;
      }
    })();
  }

          ensureFace(ready                                 )       {
    if (this.face.landmarker || this.face.pending) return;
    if (performance.now() < this.retryAt.face) return;
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
        this.retryAt.face = performance.now() + 3000;
        this.onError?.("face", errorMessage(error));
      } finally {
        this.face.pending = null;
      }
    })();
  }

          disposePose()       {
    this.pose.landmarker?.close();
    this.pose.landmarker = null;
    this.pose.imageSmoother.reset();
    this.pose.worldSmoother.reset();
  }

          disposeHand()       {
    this.hand.landmarker?.close();
    this.hand.landmarker = null;
  }

          disposeFace()       {
    this.face.landmarker?.close();
    this.face.landmarker = null;
    this.face.smoother.reset();
  }
}

export { HAND_LANDMARK_COUNT, POSE_LANDMARK_COUNT, FACE_LANDMARK_COUNT };

function errorMessage(error         )         {
  return error instanceof Error ? error.message : String(error);
}
