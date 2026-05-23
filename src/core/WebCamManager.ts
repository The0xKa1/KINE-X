import { WORLD_SPACE } from "./coordinates.js";
import type { CameraErrorKind, EventBus } from "./EventBus.js";
import type { StreamMode } from "../types/motion.js";

export type VideoFit = "contain" | "cover";

export interface CameraSettings {
  deviceId: string | null;
  resolution: { width: number; height: number };
  mirror: boolean;
  fit: VideoFit;
}

export const DEFAULT_CAMERA_SETTINGS: CameraSettings = {
  deviceId: null,
  resolution: { width: 1280, height: 720 },
  mirror: true,
  fit: "contain",
};

export class WebCamManager {
  private video: HTMLVideoElement;
  private bus: EventBus;
  private active = false;
  private mode: StreamMode = "mock";
  private settings: CameraSettings = { ...DEFAULT_CAMERA_SETTINGS };

  constructor(video: HTMLVideoElement, bus: EventBus) {
    this.video = video;
    this.bus = bus;
    this.applyPresentation();
  }

  isActive(): boolean {
    return this.active;
  }

  getMode(): StreamMode {
    return this.mode;
  }

  getSettings(): CameraSettings {
    return { ...this.settings, resolution: { ...this.settings.resolution } };
  }

  async applySettings(next: Partial<CameraSettings>): Promise<void> {
    const previous = this.settings;
    this.settings = {
      ...previous,
      ...next,
      resolution: next.resolution ? { ...next.resolution } : previous.resolution,
    };
    this.applyPresentation();

    const needsRestart =
      this.active &&
      this.mode === "camera" &&
      (next.deviceId !== undefined && next.deviceId !== previous.deviceId ||
        (next.resolution !== undefined &&
          (next.resolution.width !== previous.resolution.width ||
            next.resolution.height !== previous.resolution.height)));

    if (needsRestart) {
      await this.startStream();
    }
  }

  async toggle(): Promise<void> {
    if (this.active) {
      this.stop();
      return;
    }
    await this.startStream();
  }

  stop(): void {
    if (this.video.srcObject) {
      const stream = this.video.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      this.video.srcObject = null;
    }
    this.active = false;
    this.mode = "mock";
    this.video.classList.remove("is-visible");
    this.bus.emit("camera:update", { active: false, mode: "mock", label: "Mock WebSocket streaming" });
  }

  private async startStream(): Promise<void> {
    const previous = this.video.srcObject;
    if (previous) {
      const stream = previous as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      this.video.srcObject = null;
    }

    const { deviceId, resolution } = this.settings;
    const videoConstraints: MediaTrackConstraints = {
      width: { ideal: resolution.width },
      height: { ideal: resolution.height },
    };
    if (deviceId) {
      videoConstraints.deviceId = { exact: deviceId };
    } else {
      videoConstraints.facingMode = "user";
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
      this.video.srcObject = stream;
      await this.video.play();
      this.active = true;
      this.mode = "camera";
      this.video.classList.add("is-visible");
      this.bus.emit("camera:update", { active: true, mode: "camera", label: "Local camera pose stream" });
    } catch (err) {
      this.active = false;
      this.mode = "mock";
      this.video.classList.remove("is-visible");
      const { kind, message } = classifyCameraError(err);
      this.bus.emit("camera:update", { active: false, mode: "mock", label: "摄像头未开启" });
      this.bus.emit("camera:error", { kind, message });
    }
  }

  private applyPresentation(): void {
    this.video.style.transform = this.settings.mirror ? WORLD_SPACE.cameraCanvasTransform : "";
    this.video.classList.toggle("no-mirror", !this.settings.mirror);
    this.video.classList.toggle("is-cover", this.settings.fit === "cover");
  }
}

function classifyCameraError(err: unknown): { kind: CameraErrorKind; message: string } {
  const name = err instanceof DOMException ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return { kind: "NotAllowed", message: "浏览器拒绝授权 · 在地址栏点 🔒 允许摄像头" };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return { kind: "NotFound", message: "找不到摄像头设备 · 请检查是否连接" };
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return { kind: "Overconstrained", message: "当前分辨率不支持 · 请在设置里改低" };
    case "NotReadableError":
    case "TrackStartError":
      return { kind: "Busy", message: "摄像头被其他程序占用 · 请关闭其它应用后重试" };
    default:
      return {
        kind: "Other",
        message: err instanceof Error ? err.message : "摄像头启动失败 · 请重试",
      };
  }
}
