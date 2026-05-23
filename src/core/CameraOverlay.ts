import type { RuntimeFrame } from "../types/motion.js";
import type { HandResult, LandmarkerController } from "./PoseLandmarkerManager.js";
import type { UserPoseSource } from "./scoring/UserPoseSource.js";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

const LANDMARK_BONES: Array<[number, number]> = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
];

const HAND_BONES: Array<[number, number]> = [
  // Thumb
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  // Index
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  // Middle
  [9, 10],
  [10, 11],
  [11, 12],
  // Ring
  [13, 14],
  [14, 15],
  [15, 16],
  // Pinky
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  // Palm
  [5, 9],
  [9, 13],
  [13, 17],
];

// MediaPipe FaceMesh contour subset — face oval (jawline + forehead).
const FACE_OVAL: number[] = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];

// Key facial feature points: eye corners, nose tip, mouth corners.
const FACE_FEATURE_POINTS: number[] = [1, 33, 263, 61, 291, 199, 159, 386];

interface CameraOverlayOptions {
  canvas: HTMLCanvasElement;
  video?: HTMLVideoElement;
  landmarkerController?: LandmarkerController;
  userPose?: UserPoseSource;
  onHands?(hands: HandResult[], nowMs: number): void;
}

export class CameraOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private video: HTMLVideoElement | null;
  private landmarkerController: LandmarkerController | null;
  private userPose: UserPoseSource | null;
  private onHands: ((hands: HandResult[], nowMs: number) => void) | null;
  private safeZoneVisible = false;

  constructor(options: CameraOverlayOptions) {
    const ctx = options.canvas.getContext("2d");
    if (!ctx) throw new Error("Camera overlay context unavailable");
    this.canvas = options.canvas;
    this.ctx = ctx;
    this.video = options.video ?? null;
    this.landmarkerController = options.landmarkerController ?? null;
    this.userPose = options.userPose ?? null;
    this.onHands = options.onHands ?? null;
    this.resize();
  }

  setSafeZoneVisible(visible: boolean): void {
    this.safeZoneVisible = visible;
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  clear(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.ctx.clearRect(0, 0, rect.width, rect.height);
  }

  render(_frame: RuntimeFrame, now: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    this.ctx.clearRect(0, 0, w, h);

    this.drawMediaPipe(w, h, now);
    if (this.safeZoneVisible) this.drawSafeZone(w, h);
  }

  private videoDisplayRect(w: number, h: number): { left: number; top: number; width: number; height: number } {
    const video = this.video;
    if (!video || !video.videoWidth || !video.videoHeight) {
      return { left: 0, top: 0, width: w, height: h };
    }
    const isCover = video.classList.contains("is-cover");
    const ratioStage = w / h;
    const ratioVideo = video.videoWidth / video.videoHeight;
    let dw = w;
    let dh = h;
    if (isCover ? ratioVideo > ratioStage : ratioVideo < ratioStage) {
      dh = h;
      dw = h * ratioVideo;
    } else {
      dw = w;
      dh = w / ratioVideo;
    }
    return { left: (w - dw) / 2, top: (h - dh) / 2, width: dw, height: dh };
  }

  private projectLandmark(lm: { x: number; y: number }, rect: { left: number; top: number; width: number; height: number }, mirror: boolean): { x: number; y: number } {
    const lx = mirror ? 1 - lm.x : lm.x;
    return { x: rect.left + lx * rect.width, y: rect.top + lm.y * rect.height };
  }

  private drawSafeZone(w: number, h: number): void {
    const aspect = 3 / 4;
    const targetH = h * 0.9;
    const targetW = Math.min(w * 0.85, targetH * aspect);
    const left = (w - targetW) / 2;
    const top = (h - targetH) / 2;

    this.ctx.save();
    this.ctx.strokeStyle = "rgba(255, 85, 0, 0.55)";
    this.ctx.lineWidth = 1.2;
    this.ctx.setLineDash([6, 6]);
    this.ctx.strokeRect(left, top, targetW, targetH);
    this.ctx.setLineDash([]);

    this.ctx.fillStyle = "rgba(255, 85, 0, 0.85)";
    this.ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    this.ctx.textAlign = "left";
    this.ctx.textBaseline = "alphabetic";
    this.ctx.fillText("FULL BODY ZONE", left + 4, top + 14);
    this.ctx.restore();
  }

  private drawMediaPipe(w: number, h: number, _now: number): void {
    if (!this.video || !this.landmarkerController) return;
    const result = this.landmarkerController.detect(this.video, _now);
    if (!result) return;

    const rect = this.videoDisplayRect(w, h);
    const mirror = !this.video.classList.contains("no-mirror");

    if (result.pose) {
      const landmarks = result.pose.image;
      if (landmarks.length > 0 && this.userPose && result.pose.world.length === 33) {
        this.userPose.setLatest(result.pose.world, performance.now());
      }
      this.drawPose(landmarks, rect, mirror);
    }
    if (result.hands.length > 0) {
      result.hands.forEach((hand) => this.drawHand(hand.landmarks, rect, mirror));
    }
    if (this.onHands) this.onHands(result.hands, _now);
    if (result.face) {
      this.drawFace(result.face, rect, mirror);
    }
  }

  private drawPose(landmarks: NormalizedLandmark[], rect: ReturnType<typeof this.videoDisplayRect>, mirror: boolean): void {
    if (landmarks.length === 0) return;
    this.ctx.save();
    this.ctx.strokeStyle = "rgba(255, 85, 0, 0.85)";
    this.ctx.lineWidth = 1.5;
    LANDMARK_BONES.forEach(([a, b]) => {
      const pa = landmarks[a];
      const pb = landmarks[b];
      if (!pa || !pb) return;
      const projA = this.projectLandmark(pa, rect, mirror);
      const projB = this.projectLandmark(pb, rect, mirror);
      this.ctx.beginPath();
      this.ctx.moveTo(projA.x, projA.y);
      this.ctx.lineTo(projB.x, projB.y);
      this.ctx.stroke();
    });
    this.ctx.fillStyle = "rgba(255, 85, 0, 0.95)";
    landmarks.forEach((lm) => {
      const p = this.projectLandmark(lm, rect, mirror);
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
      this.ctx.fill();
    });
    this.ctx.restore();
  }

  private drawHand(landmarks: NormalizedLandmark[], rect: ReturnType<typeof this.videoDisplayRect>, mirror: boolean): void {
    if (landmarks.length < 21) return;
    this.ctx.save();
    this.ctx.strokeStyle = "rgba(92, 124, 158, 0.95)";
    this.ctx.lineWidth = 1.4;
    HAND_BONES.forEach(([a, b]) => {
      const pa = landmarks[a];
      const pb = landmarks[b];
      if (!pa || !pb) return;
      const projA = this.projectLandmark(pa, rect, mirror);
      const projB = this.projectLandmark(pb, rect, mirror);
      this.ctx.beginPath();
      this.ctx.moveTo(projA.x, projA.y);
      this.ctx.lineTo(projB.x, projB.y);
      this.ctx.stroke();
    });
    this.ctx.fillStyle = "rgba(92, 124, 158, 1)";
    landmarks.forEach((lm) => {
      const p = this.projectLandmark(lm, rect, mirror);
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      this.ctx.fill();
    });
    this.ctx.restore();
  }

  private drawFace(landmarks: NormalizedLandmark[], rect: ReturnType<typeof this.videoDisplayRect>, mirror: boolean): void {
    if (landmarks.length < 478) return;
    this.ctx.save();
    this.ctx.strokeStyle = "rgba(17, 17, 17, 0.6)";
    this.ctx.lineWidth = 1.1;
    this.ctx.beginPath();
    FACE_OVAL.forEach((idx, i) => {
      const lm = landmarks[idx];
      if (!lm) return;
      const p = this.projectLandmark(lm, rect, mirror);
      if (i === 0) this.ctx.moveTo(p.x, p.y);
      else this.ctx.lineTo(p.x, p.y);
    });
    this.ctx.closePath();
    this.ctx.stroke();

    this.ctx.fillStyle = "rgba(17, 17, 17, 0.85)";
    FACE_FEATURE_POINTS.forEach((idx) => {
      const lm = landmarks[idx];
      if (!lm) return;
      const p = this.projectLandmark(lm, rect, mirror);
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
      this.ctx.fill();
    });
    this.ctx.restore();
  }
}
