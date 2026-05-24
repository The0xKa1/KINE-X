import { ScoreBoard } from "./components/gameui/ScoreBoard.js";
import { Timeline } from "./components/gameui/Timeline.js";
import { SeedCarousel } from "./components/gameui/SeedCarousel.js";
import { ComboBurst } from "./components/gameui/ComboBurst.js";
import { CalibrationOverlay } from "./components/gameui/CalibrationOverlay.js";
import { ResultsScreen } from "./components/gameui/ResultsScreen.js";
import { DnaExport } from "./components/gameui/DnaExport.js";
import { DnaDrawer } from "./components/gameui/DnaDrawer.js";
import { CameraSettings } from "./components/gameui/CameraSettings.js";
import { ImportDrawer } from "./components/gameui/ImportDrawer.js";
import { AiCoachPanel } from "./components/gameui/AiCoachPanel.js";
import { SessionStartOverlay } from "./components/gameui/SessionStartOverlay.js";
import { AppShell } from "./components/layout/AppShell.js";
import { AudioFx } from "./core/AudioFx.js";
import { CameraOverlay } from "./core/CameraOverlay.js";
import { drawerStack } from "./core/DrawerStack.js";
import { EventBus } from "./core/EventBus.js";
import { MotionFrameBuffer } from "./core/frameBuffer.js";
import { MotionStage } from "./core/MotionStage.js";
import { OkGestureDetector } from "./core/OkGestureDetector.js";
import { LandmarkerController } from "./core/PoseLandmarkerManager.js";
import { RealtimeStream, type RealtimeStreamState } from "./core/RealtimeStream.js";
import { SessionGate } from "./core/SessionGate.js";
import { CalibrationController } from "./core/scoring/CalibrationController.js";
import { CoachHistory } from "./core/scoring/CoachHistory.js";
import { SessionRecorder } from "./core/scoring/SessionRecorder.js";
import { UserPoseSource } from "./core/scoring/UserPoseSource.js";
import { UserProfileStore } from "./core/scoring/UserProfile.js";
import { WebCamManager } from "./core/WebCamManager.js";
import { exerciseOrder, exercises as builtinExercises, pipeline } from "./data/exercises.js";
import { useWebSocket } from "./hooks/useWebSocket.js";

const exercises: Record<string, ExerciseConfig> = { ...builtinExercises };
const exerciseOrderList: string[] = [...exerciseOrder];
const meshClipBySeed = new Map<string, MeshClip>();
let defaultMeshClip: MeshClip | null = null;
const BACKEND_URL = resolveBackendUrl();

function resolveBackendUrl(): string {
  const STORAGE_KEY = "holomotion.backendUrl";
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  const fromQuery = new URLSearchParams(window.location.search).get("backend");
  if (fromQuery) {
    try {
      localStorage.setItem(STORAGE_KEY, fromQuery);
    } catch {
      // ignore
    }
    return fromQuery.replace(/\/$/, "");
  }
  if (stored) return stored.replace(/\/$/, "");
  const protocol = window.location.protocol || "http:";
  const hostname = window.location.hostname || "localhost";
  return `${protocol}//${hostname}:8765`;
}
import { collectDomRefs } from "./bootstrap/dom.js";
import { ConnectionIndicator, renderDnaList, beatsPerMinute } from "./bootstrap/uiHelpers.js";
import { buildFrameThumbnails, buildFrameThumbnailsFromMeta, getCoachClipManifest, loadCoachClip } from "./core/import/loadCoachClip.js";
import { loadMeshClip, type MeshClip } from "./core/import/MeshClip.js";
import type { ExerciseConfig, JointMetricSeed, MotionMode, SeedMotion } from "./types/motion.js";

const dom = collectDomRefs();
const bus = new EventBus();
drawerStack.init(dom.drawerBackdrop);
const frameBuffer = new MotionFrameBuffer();
const socket = useWebSocket(frameBuffer, bus);
const audio = new AudioFx();
const connection = new ConnectionIndicator(dom.connectionText, dom.connectionDot);
connection.onClick(() => {
  if (socket.status() === "open") return;
  connection.set("WebSocket 重连中…", "busy");
  socket.reconnect();
});

const state: RealtimeStreamState = {
  exerciseId: "squat",
  mode: "coach",
  progress: 0.12,
  speed: 0.65,
  playing: true,
  frame: 0,
};

let lastFpsTick = performance.now();
let fpsFrames = 0;

const userPose = new UserPoseSource();
const landmarkerController = new LandmarkerController();
const profileStore = new UserProfileStore();
const calibrationController = new CalibrationController(userPose, profileStore);
const coachHistory = new CoachHistory();
const sessionRecorder = new SessionRecorder(bus);
const sessionGate = new SessionGate({ bus });
const CALIBRATION_SKIP_KEY = "holomotion.calibrationSkipped.v1";
function readCalibrationSkipped(): boolean {
  try {
    return localStorage.getItem(CALIBRATION_SKIP_KEY) === "1";
  } catch {
    return false;
  }
}
let calibrationReady = Boolean(profileStore.get()) || readCalibrationSkipped();
bus.on("seed:update", () => {
  sessionRecorder.reset();
  sessionGate.reset("system");
});

let okGestureDetector: OkGestureDetector | null = null;
let realtime: RealtimeStream | null = null;
const cameraOverlay = new CameraOverlay({
  canvas: dom.cameraOverlayCanvas,
  video: dom.cameraVideo,
  landmarkerController,
  userPose,
  onHands: (hands, nowMs) => okGestureDetector?.update(hands, nowMs),
  onPose: (world, nowMs) => realtime?.onPoseTick(world, nowMs),
});
const webcam = new WebCamManager(dom.cameraVideo, bus);

okGestureDetector = new OkGestureDetector({
  onFire: () => {
    if (sessionGate.getPhase() !== "idle") return;
    sessionGate.beginCountdown("gesture");
  },
  isEligible: () =>
    sessionGate.getPhase() === "idle" &&
    calibrationReady &&
    webcam.isActive() &&
    webcam.getMode() === "camera",
  onProgress: (state) => bus.emit("session:gesture", state),
});

const stage = new MotionStage({
  canvas: dom.motionCanvas,
  loadingOverlay: dom.loadingOverlay,
  frameBuffer,
  bus,
  mode: state.mode,
  view: "front",
  stress: true,
  cameraOverlay,
  isCameraActive: () => webcam.isActive() && webcam.getMode() === "camera",
});

realtime = new RealtimeStream({
  bus,
  sessionGate,
  socket,
  scorer: { exercises, webcam, userPose, profileStore, coachHistory },
  coachHistory,
  exercises,
  state,
  onProgressTick: (progress) => shell.setProgress(progress),
  onSessionFinished: () => resultsScreen.open(),
});

const scoreBoard = new ScoreBoard({
  bus,
  metricList: dom.metricList,
  pipelineList: dom.pipelineList,
  scoreValue: dom.scoreValue,
  comboLabel: dom.comboLabel,
  riskBadge: dom.riskBadge,
  frameLabel: dom.frameLabel,
  deltaLabel: dom.deltaLabel,
  pipelineLatency: dom.pipelineLatency,
  streamLabel: dom.streamLabel,
  pipeline,
});
void scoreBoard;

const seedCarousel = new SeedCarousel({
  bus,
  container: dom.seedCarousel,
  headName: dom.seedHeadName,
  exercises,
  order: exerciseOrderList,
  modeButtons: dom.modeButtons,
  onSeedChange: (nextId) => setExercise(nextId, "Seed action changed"),
  onModeChange: (nextMode) => setMode(nextMode),
});

const timeline = new Timeline({
  bus,
  container: dom.timelineFrames,
  label: dom.timelineLabel,
  onScrub: (nextProgress) => {
    shell.setPlaying(false);
    realtime?.setProgress(nextProgress);
  },
});

const comboBurst = new ComboBurst({
  bus,
  fxLayer: dom.fxLayer,
  flash: dom.fxFlash,
  burst: dom.fxBurst,
  combo: dom.fxCombo,
  audio,
});


const dnaExport = new DnaExport({
  root: dom.dnaExport,
  closeButton: dom.exportClose,
  bar: dom.exportBar,
  label: dom.exportLabel,
  head: dom.exportHead,
  sub: dom.exportSub,
  qr: dom.exportQr,
  qrCode: dom.exportQrCode,
});

const aiCoach = new AiCoachPanel({
  root: dom.aiCoachCard,
  textEl: dom.aiCoachText,
  statusEl: dom.aiCoachStatus,
  onOpenSettings: () => cameraSettings.open(),
});

const resultsScreen = new ResultsScreen({
  bus,
  root: dom.resultsScreen,
  closeButton: dom.resultsClose,
  scoreEl: dom.resultsScore,
  beatEl: dom.resultsBeat,
  comboEl: dom.resultsCombo,
  perfectEl: dom.resultsPerfect,
  deltaEl: dom.resultsDelta,
  riskEl: dom.resultsRisk,
  medalEl: dom.medalName,
  titleEl: dom.resultsTitle,
  exportButton: dom.exportButton,
  onExport: () => dnaExport.open(state.exerciseId),
  onClose: () => sessionGate.reset("system"),
  getStats: () => comboBurst.getStats(),
  exercises,
  sessionRecorder,
  aiCoach,
  getPersona: () => cameraSettings.getPersona(),
});

const dnaDrawer = new DnaDrawer({
  drawer: dom.dnaDrawer,
  trigger: dom.dnaButton,
  closeButton: dom.drawerClose,
});
void dnaDrawer;

const cameraSettings = new CameraSettings({
  webcam,
  landmarker: landmarkerController,
  calibration: calibrationController,
  profileStore,
  drawer: dom.cameraSettingsDrawer,
  trigger: dom.cameraSettingsButton,
  closeButton: dom.cameraSettingsClose,
  deviceSelect: dom.cameraDeviceSelect,
  resolutionSelect: dom.cameraResolutionSelect,
  fitSelect: dom.cameraFitSelect,
  mirrorToggle: dom.cameraMirrorToggle,
  safeZoneToggle: dom.cameraSafeZoneToggle,
  modelSelect: dom.poseModelSelect,
  modalityPoseToggle: dom.modalityPoseToggle,
  modalityHandToggle: dom.modalityHandToggle,
  modalityFaceToggle: dom.modalityFaceToggle,
  recalibrateButton: dom.recalibrateButton,
  calibrationStatusLabel: dom.calibrationStatusLabel,
  personaSelect: dom.personaSelect,
  callbacks: {
    onSafeZoneChange: (visible) => cameraOverlay.setSafeZoneVisible(visible),
  },
});
void cameraSettings;

const calibrationOverlay = new CalibrationOverlay({
  controller: calibrationController,
  root: dom.calibrationOverlay,
  title: dom.calibrationTitle,
  hint: dom.calibrationHint,
  bar: dom.calibrationBar,
  skipButton: dom.calibrationSkip,
  doneButton: dom.calibrationDone,
  redoButton: dom.calibrationRedo,
  onSkip: () => {
    try {
      localStorage.setItem(CALIBRATION_SKIP_KEY, "1");
    } catch {
      // ignore
    }
  },
  onDismiss: (reason) => {
    calibrationReady = true;
    bus.emit("calibration:ready", { reason: reason === "skip" ? "skip" : "done" });
  },
});
void calibrationOverlay;

calibrationController.onChange((status) => {
  if (status.phase === "waiting" || status.phase === "sampling") {
    if (calibrationReady) {
      calibrationReady = false;
      bus.emit("calibration:ready", { reason: "reset" });
    }
  }
});

const sessionStartOverlay = new SessionStartOverlay({
  bus,
  gate: sessionGate,
  root: dom.sessionOverlay,
  idleSection: dom.sessionIdle,
  countdownSection: dom.sessionCountdown,
  startButton: dom.sessionStartButton,
  countdownNumber: dom.sessionCountdownNumber,
  gestureValue: dom.sessionGestureValue,
  gestureBar: dom.sessionGestureBar,
  isCameraActive: () => webcam.isActive() && webcam.getMode() === "camera",
  isCalibrationReady: () => calibrationReady,
  isClipReady: () => Boolean(exercises[state.exerciseId].clip),
});
void sessionStartOverlay;

const importDrawer = new ImportDrawer({
  drawer: dom.importDrawer,
  trigger: dom.importButton,
  closeButton: dom.importClose,
  fileInput: dom.importFile,
  dropZone: dom.importDrop,
  motionSelect: dom.importMotionSelect,
  startButton: dom.importStart,
  applyButton: dom.importApply,
  segmentButton: dom.importSegment,
  segmentList: dom.segmentList,
  segmentSummary: dom.segmentSummary,
  progressBar: dom.importProgress,
  progressLabel: dom.importProgressLabel,
  statusLabel: dom.importStatus,
  preview: dom.importPreview,
  backendUrl: BACKEND_URL,
  onApply: ({ id, name, clip, meshClip, motion }) => {
    const newId = `imported-${id}`;
    const config: ExerciseConfig = {
      id: newId,
      name,
      discipline: "Imported",
      seedUrl: "",
      durationSeconds: clip.durationSeconds,
      motion,
      target: "用户导入动作",
      params: {
        beta: "",
        theta: "",
        trans: "",
        format: "imported.coach_clip.v1",
      },
      metrics: pickMetricsForMotion(motion),
      clip,
    };
    exercises[newId] = config;
    seedCarousel.addSeed(newId, config);
    if (meshClip) meshClipBySeed.set(newId, meshClip);
    else meshClipBySeed.delete(newId);
    shell.setPlaying(false);
    setExercise(newId, `Imported · ${name}`);
    importDrawer.close();
  },
});
void importDrawer;

const shell = new AppShell({
  railItems: dom.railItems,
  viewButtons: dom.viewButtons,
  playButton: dom.playButton,
  playIcon: dom.playIcon,
  stressToggle: dom.stressToggle,
  speedSlider: dom.speedSlider,
  timeSlider: dom.timeSlider,
  cameraButton: dom.cameraButton,
  onNavMode: (nextMode) => {
    setMode(nextMode);
    seedCarousel.setMode(nextMode);
  },
  onRebuild: () => setExercise(state.exerciseId, "Stage rebuild"),
  onSafety: () => {
    setMode("stress");
    seedCarousel.setMode("stress");
    dom.stressToggle.checked = true;
    stage.setStress(true);
  },
  onViewChange: (view) => stage.setView(view),
  onPlayChange: (nextPlaying) => {
    realtime?.setPlaying(nextPlaying);
    if (nextPlaying) audio.startBgm(currentBpm());
    else audio.stopBgm();
  },
  onStressChange: (enabled) => stage.setStress(enabled),
  onSpeedChange: (nextSpeed) => {
    state.speed = nextSpeed;
    if (state.playing) audio.startBgm(currentBpm());
  },
  onScrub: (nextProgress) => {
    realtime?.setProgress(nextProgress);
  },
  onCameraToggle: () => {
    audio.enable();
    audio.resume();
    void webcam.toggle();
  },
});

bus.on("session:state", (payload) => {
  shell.setControlsLocked(payload.phase === "active");
});

bus.on("camera:update", (payload) => {
  connection.set(payload.label, payload.mode === "camera" ? "ready" : "busy");
  const visible = payload.mode === "camera" && payload.active;
  dom.mirrorEmpty.classList.toggle("is-hidden", visible);
  dom.mirrorEmpty.classList.remove("is-error");
  dom.cameraRetry.hidden = true;
  if (!visible) {
    dom.mirrorEmptyTitle.textContent = "点击 Lens 唤起摄像头";
    dom.mirrorEmptyHint.textContent = "AI WILL LOCK ONTO YOUR JOINTS";
  }
  dom.mirrorTitle.textContent = visible ? "你的镜像 · LIVE" : "你的镜像";
  dom.cameraButton.classList.toggle("is-active", visible);
  dom.cameraButton.setAttribute("aria-pressed", String(visible));
  if (!visible) {
    cameraOverlay.clear();
    userPose.clear();
    calibrationController.cancel();
    sessionGate.reset("system");
    calibrationReady = Boolean(profileStore.get()) || readCalibrationSkipped();
    return;
  }
  // Pre-warm pose + hand modalities so the gesture detector starts producing
  // results within the first second after the camera turns on.
  landmarkerController.setEnabled("hand", true);
  landmarkerController.setEnabled("pose", true);
  void landmarkerController.ensureReady(["pose", "hand"]);
  let skipped = false;
  try {
    skipped = localStorage.getItem(CALIBRATION_SKIP_KEY) === "1";
  } catch {
    skipped = false;
  }
  const hasProfile = Boolean(profileStore.get());
  if (!hasProfile && !skipped && calibrationController.getStatus().phase === "idle") {
    calibrationReady = false;
    calibrationController.start();
  } else {
    calibrationReady = true;
    bus.emit("calibration:ready", { reason: hasProfile ? "profile" : "skip" });
  }
});

bus.on("camera:error", (payload) => {
  dom.mirrorEmpty.classList.remove("is-hidden");
  dom.mirrorEmpty.classList.add("is-error");
  dom.mirrorEmptyTitle.textContent = "摄像头无法启动";
  dom.mirrorEmptyHint.textContent = payload.message;
  dom.cameraRetry.hidden = false;
});

dom.cameraRetry.addEventListener("click", () => {
  audio.enable();
  audio.resume();
  void webcam.toggle();
});

bus.on("seed:update", (payload) => {
  dom.stageTitle.textContent = payload.exercise.name;
  seedCarousel.syncExercise(payload.exercise);
  timeline.setLabel(`${payload.exercise.discipline} · ${payload.exercise.target}`);
  timeline.setClip(payload.exercise.clip ?? null);
  renderDnaList(dom.dnaList, payload.exercise);
  resultsScreen.setExercise(payload.exercise.id);
});

bus.on("score:update", () => {
  fpsFrames += 1;
  const now = performance.now();
  if (now - lastFpsTick > 1000) {
    const fps = Math.round((fpsFrames * 1000) / (now - lastFpsTick));
    dom.fpsLabel.textContent = String(Math.min(120, fps));
    fpsFrames = 0;
    lastFpsTick = now;
  }
});

dom.finishButton.addEventListener("click", () => {
  sessionGate.markFinished("button");
  resultsScreen.open();
});

dom.demoPerfectButton.addEventListener("click", () => {
  audio.enable();
  audio.resume();
  comboBurst.triggerPerfectDemo();
});
dom.demoComboButton.addEventListener("click", () => {
  audio.enable();
  audio.resume();
  comboBurst.triggerComboDemo();
});

window.addEventListener(
  "pointerdown",
  () => {
    audio.enable();
    audio.resume();
  },
  { once: true },
);

window.addEventListener("resize", () => stage.resize());

const DEFAULT_WS_URL = "ws://localhost:8000/motion";

void stage.preload().then(async () => {
  await hydrateCoachClips();
  await hydrateMeshClip();
  setExercise(state.exerciseId, "Realtime evaluator streaming");
  stage.start();
  const wsUrl = new URLSearchParams(window.location.search).get("ws") ?? DEFAULT_WS_URL;
  socket.connect(wsUrl);
  // Fire-and-forget so a slow/unreachable backend (port-forward without :8765)
  // doesn't block stage.start() — imported seeds drop into the carousel later.
  void hydrateImportedJobs();
});

async function hydrateMeshClip(): Promise<void> {
  try {
    const clip = await loadMeshClip("public/coach_clips/single_leg_squat.mesh.meta.json");
    defaultMeshClip = clip;
    console.info(
      `[mesh-clip] loaded ${clip.meta.frameCount} frames · ${clip.meta.vertexCount} verts · ${clip.meta.faceCount} faces`,
    );
  } catch (err) {
    console.warn("[mesh-clip] skip:", err);
  }
}

async function hydrateCoachClips(): Promise<void> {
  await Promise.all(
    getCoachClipManifest().map(async (entry) => {
      try {
        const clip = await loadCoachClip(entry.url);
        const thumbs = buildFrameThumbnails(entry);
        if (thumbs.length > 0) clip.thumbnails = thumbs;
        const current = exercises[entry.exercise];
        exercises[entry.exercise] = {
          ...current,
          clip,
          durationSeconds: clip.durationSeconds,
          motion: clip.motion,
        };
      } catch (err) {
        console.warn(`[coach-clip] skip ${entry.exercise}:`, err);
      }
    }),
  );
}

interface PersistedJob {
  jobId: string;
  coachClipUrl: string;
  meshClipMetaUrl: string;
  framesDir: string;
  framePattern: string;
  frameCount: number;
  thumbnailCount?: number;
  durationSeconds: number;
  fps: number;
  name: string;
  motion: SeedMotion;
}

async function hydrateImportedJobs(): Promise<void> {
  let payload: { jobs: PersistedJob[] };
  try {
    // 4s timeout — if the backend isn't reachable (e.g. port-forward without
    // :8765) we want to drop the work, not block the carousel forever.
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 4000);
    const resp = await fetch(`${BACKEND_URL}/import/jobs`, { signal: ctrl.signal });
    window.clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    payload = (await resp.json()) as { jobs: PersistedJob[] };
  } catch (err) {
    console.warn("[imported-jobs] skip:", err);
    return;
  }
  await Promise.all(payload.jobs.map((job) => hydrateOneJob(job)));
}

async function hydrateOneJob(job: PersistedJob): Promise<void> {
  try {
    const [clip, meshClip] = await Promise.all([
      loadCoachClip(job.coachClipUrl),
      loadMeshClip(job.meshClipMetaUrl).catch((err) => {
        console.warn(`[imported-jobs] mesh skip ${job.jobId}:`, err);
        return null;
      }),
    ]);
    clip.thumbnails = buildFrameThumbnailsFromMeta({
      framesDir: job.framesDir,
      framePattern: job.framePattern,
      frameCount: job.frameCount,
      thumbnailCount: job.thumbnailCount,
    });
    const newId = `imported-${job.jobId}`;
    const config: ExerciseConfig = {
      id: newId,
      name: job.name,
      discipline: "Imported",
      seedUrl: "",
      durationSeconds: clip.durationSeconds,
      motion: job.motion,
      target: "用户导入动作",
      params: {
        beta: "",
        theta: "",
        trans: "",
        format: "imported.coach_clip.v1",
      },
      metrics: pickMetricsForMotion(job.motion),
      clip,
    };
    exercises[newId] = config;
    seedCarousel.addSeed(newId, config);
    if (meshClip) meshClipBySeed.set(newId, meshClip);
  } catch (err) {
    console.warn(`[imported-jobs] skip ${job.jobId}:`, err);
  }
}

function setMode(nextMode: MotionMode): void {
  state.mode = nextMode;
  stage.setMode(nextMode);
  seedCarousel.setMode(nextMode);
}

function setExercise(nextId: string, message: string): void {
  realtime?.resetForSeed(nextId);
  frameBuffer.reset();
  stage.resetForSeed();
  audio.seedActivate();
  const exercise = exercises[nextId];
  if (!exercise) return;
  state.exerciseId = nextId;
  applyMeshForSeed(nextId);
  connection.set(message, "busy");
  bus.emit("seed:update", { exercise, message });
  window.setTimeout(() => connection.set("Action DNA cache refreshed", "ready"), 420);
}

function applyMeshForSeed(seedId: string): void {
  const override = meshClipBySeed.get(seedId);
  if (override) {
    stage.setMeshClip(override);
    return;
  }
  if (defaultMeshClip) {
    stage.setMeshClip(defaultMeshClip);
    return;
  }
  stage.clearMeshClip();
}

function pickMetricsForMotion(motion: SeedMotion): JointMetricSeed[] {
  for (const id of exerciseOrder) {
    const candidate = builtinExercises[id];
    if (candidate.motion === motion) {
      return candidate.metrics.map((m) => ({ ...m }));
    }
  }
  return builtinExercises.squat.metrics.map((m) => ({ ...m }));
}

function currentBpm(): number {
  return beatsPerMinute(exercises[state.exerciseId].motion, state.speed);
}
