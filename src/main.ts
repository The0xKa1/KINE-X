import { ScoreBoard } from "./components/gameui/ScoreBoard.js";
import { Timeline } from "./components/gameui/Timeline.js";
import { SeedCarousel } from "./components/gameui/SeedCarousel.js";
import { CoachVideo } from "./components/gameui/CoachVideo.js";
import { ComboBurst } from "./components/gameui/ComboBurst.js";
import { CalibrationOverlay } from "./components/gameui/CalibrationOverlay.js";
import { ResultsScreen } from "./components/gameui/ResultsScreen.js";
import { DnaDrawer } from "./components/gameui/DnaDrawer.js";
import { CameraSettings } from "./components/gameui/CameraSettings.js";
import { CreatePage } from "./components/pages/CreatePage.js";
import { AvatarVaultPage } from "./components/pages/AvatarVaultPage.js";
import { AiCoachPanel } from "./components/gameui/AiCoachPanel.js";
import { SessionStartOverlay } from "./components/gameui/SessionStartOverlay.js";
import { BootSequence } from "./components/gameui/BootSequence.js";
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
import { SessionArchive } from "./core/scoring/SessionArchive.js";
import { ReportPage } from "./components/pages/ReportPage.js";
import { UserPoseSource } from "./core/scoring/UserPoseSource.js";
import { UserProfileStore } from "./core/scoring/UserProfile.js";
import { WebCamManager } from "./core/WebCamManager.js";
import {
  exerciseOrder,
  exercises as builtinExercises,
  hasPlayableAvatar,
  MOTION_METRIC_TEMPLATES,
  pipeline,
  type AvatarExerciseConfig,
} from "./data/exercises.js";
import { GaussianAvatar, GaussianMotion } from "./core/avatar/GaussianAvatar.js";
import { AvatarRegistryClient } from "./core/avatar/AvatarRegistryClient.js";
import {
  AvatarBindingController,
  describeAvatarBinding,
  type AvatarBindingSnapshot,
} from "./core/avatar/AvatarBindingController.js";
import { Router } from "./core/Router.js";
import { TrainPage } from "./components/pages/TrainPage.js";
import { AvatarSwitcher } from "./components/gameui/AvatarSwitcher.js";
import { LibraryPage } from "./components/pages/LibraryPage.js";
import { useWebSocket } from "./hooks/useWebSocket.js";

const exercises: Record<string, AvatarExerciseConfig> = { ...builtinExercises };
const exerciseOrderList: string[] = [...exerciseOrder];
const meshClipBySeed = new Map<string, MeshClip>();
const avatarBySeed = new Map<string, { assetKey: string; avatar: GaussianAvatar }>();
const avatarLoads = new Map<string, { assetKey: string; promise: Promise<GaussianAvatar | null> }>();
let defaultMeshClip: MeshClip | null = null;
const BACKEND_URL = resolveBackendUrl();

function resolveBackendUrl(): string {
  const STORAGE_KEY = "kinex.backendUrl";
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
  // The dev static server (5173) has no API — talk to the backend on 8765.
  // Everywhere else the backend serves the frontend itself (single-port
  // deployment), so the API lives on the same origin.
  if (window.location.port === "5173") return `${protocol}//${hostname}:8765`;
  return window.location.origin.replace(/\/$/, "");
}
import { collectDomRefs } from "./bootstrap/dom.js";
import { ConnectionIndicator, renderDnaList, beatsPerMinute } from "./bootstrap/uiHelpers.js";
import { formatCm } from "./core/coordinates.js";
import { buildFrameThumbnails, buildFrameThumbnailsFromMeta, getCoachClipManifest, loadCoachClip } from "./core/import/loadCoachClip.js";
import { renderMeshThumbnails } from "./core/import/renderMeshThumbs.js";
import { loadMeshClip, type MeshClip } from "./core/import/MeshClip.js";
import type { CameraView, JointMetricSeed, MotionMode, SeedMotion } from "./types/motion.js";

const dom = collectDomRefs();
const avatarBindingStatusSurface = createAvatarBindingStatusSurface(
  dom.stageTitle.parentElement ?? dom.stageBay,
);
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

// Deep-link a stage mode for demos / tests, e.g. ?mode=mesh or ?mode=avatar.
const initialMode = new URLSearchParams(window.location.search).get("mode");
if (initialMode === "coach" || initialMode === "mesh" || initialMode === "stress" || initialMode === "avatar") {
  state.mode = initialMode;
}

let lastFpsTick = performance.now();
let fpsFrames = 0;

const userPose = new UserPoseSource();
const landmarkerController = new LandmarkerController({
  onError: (kind, message) => {
    console.warn(`[mediapipe] ${kind} init failed:`, message);
    bus.emit("camera:error", { kind: "Other", message: `姿态引擎初始化失败（${kind}），请检查模型资产后重试` });
  },
});
const profileStore = new UserProfileStore();
const calibrationController = new CalibrationController(userPose, profileStore);
const coachHistory = new CoachHistory();
const sessionRecorder = new SessionRecorder(bus);
const sessionArchive = new SessionArchive();
const sessionGate = new SessionGate({ bus });
const CALIBRATION_SKIP_KEY = "kinex.calibrationSkipped.v1";
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

let currentView: CameraView = "front";
const coachVideo = new CoachVideo({
  video: dom.coachVideo,
  bus,
  getPlayback: () => ({
    progress: state.progress,
    speed: state.speed,
    playing: state.playing,
    durationSeconds: exercises[state.exerciseId]?.durationSeconds ?? 0,
  }),
  getView: () => currentView,
});

/** The stage hosts two layers; mode decides which one is primary, the other
 * shrinks to a corner thumbnail (only when the seed ships a coach video).
 * coach keeps the twin video primary; mesh/stress/avatar force the 3D
 * blueprint primary full-bleed. */
function syncStagePrimary(): void {
  const hasVideo = coachVideo.hasVideo();
  dom.stageBay.classList.toggle("has-video", hasVideo);
  const primary = hasVideo && state.mode === "coach" ? "twin" : "blueprint";
  if (dom.stageBay.dataset.primary !== primary) {
    dom.stageBay.dataset.primary = primary;
    dom.thumbLabel.textContent = primary === "twin" ? "3D" : "VIDEO";
    requestAnimationFrame(() => stage.resize());
  }
}

dom.thumbHotspot.addEventListener("click", () => {
  setMode(dom.stageBay.dataset.primary === "twin" ? "mesh" : "coach");
});

realtime = new RealtimeStream({
  bus,
  sessionGate,
  socket,
  scorer: { exercises, webcam, userPose, profileStore, coachHistory },
  coachHistory,
  exercises,
  state,
  onProgressTick: (progress) => timeline.setPlayhead(progress),
  onSessionFinished: () => resultsScreen.open(),
});

// Display helper: map playback progress to the coach clip's frame index
// (wraps with the preview loop; clamps on the final frame during a session).
const clipFrameIndex = (progress: number): number => {
  const clip = exercises[state.exerciseId]?.clip;
  const count = clip?.frames.length ?? 0;
  if (count === 0) return 0;
  return Math.min(count - 1, Math.floor(progress * count));
};

const scoreBoard = new ScoreBoard({
  bus,
  metricList: dom.metricList,
  pipelineList: dom.pipelineList,
  scoreValue: dom.scoreValue,
  comboLabel: dom.comboLabel,
  riskBadge: dom.riskBadge,
  stageRisk: dom.stageRisk,
  frameLabel: dom.frameLabel,
  getFrameIndex: clipFrameIndex,
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

seedCarousel.setMode(state.mode);

const comboBurst = new ComboBurst({
  bus,
  fxLayer: dom.fxLayer,
  flash: dom.fxFlash,
  burst: dom.fxBurst,
  combo: dom.fxCombo,
  giant: dom.fxGiant,
  audio,
});


const aiCoach = new AiCoachPanel({
  root: dom.aiCoachCard,
  textEl: dom.aiCoachText,
  statusEl: dom.aiCoachStatus,
  onOpenSettings: () => cameraSettings.openAiSettings(),
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
  jointsEl: dom.resultsJoints,
  medalEl: dom.medalName,
  titleEl: dom.resultsTitle,
  onClose: () => sessionGate.reset("system"),
  getStats: () => comboBurst.getStats(),
  exercises,
  sessionRecorder,
  sessionArchive,
  aiCoach,
  getLlmConfig: () => cameraSettings.getCoachConfig(),
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
  aiApiSection: dom.aiApiSection,
  llmBaseUrl: dom.llmBaseUrl,
  llmApiKey: dom.llmApiKey,
  mllmModel: dom.mllmModel,
  coachModel: dom.coachModel,
  llmTestButton: dom.llmTest,
  llmClearButton: dom.llmClear,
  llmStatusLabel: dom.llmStatus,
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
  isClipReady: () => Boolean(exercises[state.exerciseId]?.clip),
});
void sessionStartOverlay;

const avatarBindingController = new AvatarBindingController({
  backendUrl: BACKEND_URL,
  onUpdate: (record) => applyBindingSnapshotToSeed(record),
  onReady: (record) => {
    applyBindingSnapshotToSeed(record);
    if (record.seedId !== state.exerciseId) return;
    applyAvatarForSeed(record.seedId);
    syncAvatarModeButton();
    connection.set("分身动作已就绪 · 可切换分身模式", "ready");
  },
  onTerminalError: (record) => {
    applyBindingSnapshotToSeed(record);
    if (record.seedId !== state.exerciseId) return;
    syncAvatarModeButton();
    connection.set(`分身准备失败 · ${record.error ?? "普通教练仍可使用"}`, "ready");
  },
  onNetworkError: (error) => {
    console.warn("[avatar-binding] status refresh failed; ordinary coach remains available", error);
  },
});

// Train-bay avatar switcher: rebinds the current seed's motion to any READY
// identity. Adopted snapshots replace the seed's bindingId, so the guard in
// applyBindingSnapshotToSeed must see the reassignment first.
const avatarSwitcher = new AvatarSwitcher({
  el: document.getElementById("avatarSwitcher") as HTMLElement,
  backendUrl: BACKEND_URL,
  onSwitch: (snapshot) => {
    const exercise = exercises[snapshot.seedId];
    if (!exercise) return;
    assignBindingSnapshot(exercise, snapshot);
    avatarBindingController.track(snapshot);
    if (snapshot.seedId !== state.exerciseId) return;
    syncAvatarBindingSurface(exercise);
    syncAvatarModeButton();
    applyAvatarForSeed(snapshot.seedId);
    connection.set(
      snapshot.status === "ready" ? "分身已切换" : "分身绑定准备中 · 就绪后自动上场",
      "ready",
    );
  },
  onError: (message) => connection.set(`分身切换失败 · ${message}`, "busy"),
});

const createPage = new CreatePage({
  el: dom.pageCreate,
  backendUrl: BACKEND_URL,
  getMllmConfig: () => cameraSettings.getMllmConfig(),
  onOpenSettings: () => cameraSettings.openAiSettings(),
  onApply: ({
    id,
    name,
    clip,
    meshClip,
    motion,
    hint,
    avatarId,
    motionId,
    bindingId,
    bindingStatus,
    bindingProgress,
    bindingError,
    identityUrl,
    motionAssetUrl,
  }) => {
    const newId = `imported-${id}`;
    const config: AvatarExerciseConfig = {
      id: newId,
      name,
      discipline: "Imported",
      seedUrl: "",
      durationSeconds: clip.durationSeconds,
      motion,
      target: hint ?? "用户导入动作",
      params: {
        beta: "",
        theta: "",
        trans: "",
        format: "imported.coach_clip.v1",
      },
      metrics: pickMetricsForMotion(motion),
      clip,
      avatarId,
      motionId,
      bindingId,
      avatarBindingStatus: bindingStatus,
      avatarBindingProgress: bindingProgress,
      avatarBindingError: bindingError,
      identityUrl,
      motionAssetUrl,
    };
    exercises[newId] = config;
    seedCarousel.addSeed(newId, config);
    if (meshClip) meshClipBySeed.set(newId, meshClip);
    else meshClipBySeed.delete(newId);
    if (avatarId && motionId && bindingStatus) {
      avatarBindingController.track({
        seedId: newId,
        bindingId,
        avatarId,
        motionId,
        status: bindingStatus,
        progress: bindingProgress ?? (bindingStatus === "ready" ? 100 : 0),
        error: bindingError,
        identityUrl,
        motionAssetUrl,
      });
    }
    shell.setPlaying(false);
    setExercise(newId, `Imported · ${name}`);
    router.navigate(`#/train/${newId}`);
  },
});
dom.importButton.addEventListener("click", () => router.navigate("#/create"));

const shell = new AppShell({
  viewButtons: dom.viewButtons,
  playButton: dom.playButton,
  playIcon: dom.playIcon,
  stressToggle: dom.stressToggle,
  speedSlider: dom.speedSlider,
  cameraButton: dom.cameraButton,
  onViewChange: (view) => {
    currentView = view;
    stage.setView(view);
    coachVideo.setView(view);
  },
  onPlayChange: (nextPlaying) => {
    realtime?.setPlaying(nextPlaying);
    if (nextPlaying) audio.startBgm(currentBpm());
    else audio.stopBgm();
  },
  onStressChange: (enabled) => stage.setStress(enabled),
  onSpeedChange: (nextSpeed) => {
    state.speed = nextSpeed;
    dom.speedValue.textContent = `×${nextSpeed.toFixed(2)}`;
    if (state.playing) audio.startBgm(currentBpm());
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
  dom.mirrorEmptyTitle.textContent = payload.kind === "Other" ? "姿态引擎初始化失败" : "摄像头无法启动";
  dom.mirrorEmptyHint.textContent = payload.message;
  dom.cameraRetry.hidden = false;
});

dom.cameraRetry.addEventListener("click", () => {
  audio.enable();
  audio.resume();
  if (webcam.isActive() && webcam.getMode() === "camera") {
    // Pose-engine retry — the camera itself is fine, don't toggle it off.
    dom.mirrorEmpty.classList.add("is-hidden");
    dom.mirrorEmpty.classList.remove("is-error");
    dom.cameraRetry.hidden = true;
    landmarkerController.resetRetries();
    void landmarkerController.ensureReady(["pose", "hand"]);
    return;
  }
  void webcam.toggle();
});

bus.on("seed:update", (payload) => {
  dom.stageTitle.textContent = payload.exercise.name;
  seedCarousel.syncExercise(payload.exercise);
  timeline.setLabel(`${payload.exercise.discipline} · ${payload.exercise.target}`);
  timeline.setClip(payload.exercise.clip ?? null);
  coachVideo.setSources(payload.exercise.coachVideo ?? null);
  syncAvatarModeButton();
  syncStagePrimary();
  renderDnaList(dom.dnaList, payload.exercise);
  resultsScreen.setExercise(payload.exercise.id);
});

bus.on("score:update", (payload) => {
  fpsFrames += 1;
  const now = performance.now();
  if (now - lastFpsTick > 1000) {
    const fps = Math.round((fpsFrames * 1000) / (now - lastFpsTick));
    dom.fpsLabel.textContent = String(Math.min(120, fps));
    fpsFrames = 0;
    lastFpsTick = now;
  }
  // Telemetry strip + topbar latency readout (already throttled to ~120ms upstream).
  dom.tlFrame.textContent = String(clipFrameIndex(payload.progress)).padStart(6, "0");
  dom.tlProgress.textContent = `${(payload.progress * 100).toFixed(1)}%`;
  const latency = socket.latencyMs();
  dom.tlLat.textContent = latency > 0 ? `${Math.round(latency)}ms` : "—";
  dom.connectionLat.textContent = latency > 0 ? `${Math.round(latency)}ms` : "";
  const avgDelta = payload.metrics.length
    ? payload.metrics.reduce((sum, m) => sum + m.distanceDeltaCm, 0) / payload.metrics.length
    : 0;
  dom.tlDelta.textContent = formatCm(avgDelta);
});

dom.finishButton.addEventListener("click", () => {
  if (sessionGate.getPhase() === "idle") {
    connection.set("先开始一场跟练，再结算", "busy");
    window.setTimeout(() => connection.set("Action DNA cache refreshed", "ready"), 1600);
    return;
  }
  sessionGate.markFinished("button");
  resultsScreen.open();
});

dom.resultsReportLink.addEventListener("click", () => {
  resultsScreen.close();
  router.navigate("#/report");
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

const trainPage = new TrainPage({
  el: dom.pageTrain,
  stage,
  realtime,
  getCurrentSeedId: () => state.exerciseId,
  hasSeed: (seedId) => Boolean(exercises[seedId]),
  onSeedRequest: (seedId) => setExercise(seedId, "Route seed changed"),
});
const libraryPage = new LibraryPage({ el: dom.pageLibrary, exercises, order: exerciseOrderList, archive: sessionArchive });
const reportPage = new ReportPage({
  el: dom.pageReport,
  archive: sessionArchive,
  exercises,
  getLlmConfig: () => cameraSettings.getCoachConfig(),
  getPersona: () => cameraSettings.getPersona(),
  onOpenSettings: () => cameraSettings.openAiSettings(),
});
const avatarVaultPage = new AvatarVaultPage({
  el: dom.pageAvatars,
  client: new AvatarRegistryClient(BACKEND_URL),
});
const router = new Router({
  pages: {
    library: libraryPage,
    train: trainPage,
    report: reportPage,
    create: createPage,
    avatars: avatarVaultPage,
  },
  onNavigate: (route) => {
    dom.railItems.forEach((item) => item.classList.toggle("is-active", item.dataset.route === route.name));
  },
});

dom.railItems.forEach((button) => {
  button.addEventListener("click", () => {
    const route = button.dataset.route;
    if (route === "library") router.navigate("#/");
    else if (route === "train") router.navigate(`#/train/${state.exerciseId}`);
    else if (route === "report") router.navigate("#/report");
    else if (route === "create") router.navigate("#/create");
    else if (route === "avatars") router.navigate("#/avatars");
  });
});

const boot = new BootSequence({ root: dom.bootOverlay });
bus.on("pipeline:update", (payload) => {
  if (payload.status === "ready" && payload.runIndex === 1) boot.tick("stream", "LIVE");
});

void (async () => {
  await stage.preload();
  await hydrateCoachClips();
  const squatClip = exercises.squat?.clip;
  boot.tick("clip", squatClip ? `OK · ${squatClip.frames.length}F` : "SKIP");
  const loadedMesh = await hydrateMeshClip();
  boot.tick("mesh", loadedMesh ? `OK · ${loadedMesh.meta.vertexCount}V` : "SKIP");
  await hydrateSeedMeshClips();
  await healTimelineThumbnails(loadedMesh);
  void probeMediapipeRuntime().then((ok) => boot.tick("mediapipe", ok ? "OK" : "FAIL"));
  // Respect deep links: when the URL names a train seed, boot straight into it
  // instead of the default exercise (otherwise the initial setExercise would
  // rewrite the URL to the default seed).
  const initialRoute = router.currentRoute();
  const routeSeed = initialRoute.params.seedId;
  const initialSeed =
    initialRoute.name === "train" && routeSeed && exercises[routeSeed] ? routeSeed : state.exerciseId;
  // Deep link to a seed that only exists after hydration (imported-*)? The
  // fallback above loses it — remember it and repair once hydration lands.
  const pendingSeed =
    initialRoute.name === "train" && routeSeed && !exercises[routeSeed] ? routeSeed : null;
  setExercise(initialSeed, "Realtime evaluator streaming");
  router.start();
  const wsUrl = new URLSearchParams(window.location.search).get("ws") ?? DEFAULT_WS_URL;
  socket.connect(wsUrl);
  boot.tick("stream", "STANDBY");
  // Fire-and-forget so a slow/unreachable backend (port-forward without :8765)
  // doesn't block stage.start() — imported seeds drop into the carousel later.
  void hydrateImportedJobs()
    .then(() => {
      // Honor the original deep link — but only if the user hasn't already
      // switched to another seed by hand.
      if (pendingSeed && exercises[pendingSeed] && state.exerciseId === initialSeed) {
        setExercise(pendingSeed, "Imported seed hydrated");
      }
    })
    .finally(() => avatarBindingController.resume());
})();

async function probeMediapipeRuntime(): Promise<boolean> {
  try {
    const resp = await fetch("public/mediapipe/tasks-vision/vision_bundle.mjs", { method: "HEAD" });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * The baked frame JPGs for the built-in clip may be missing (the frames dir
 * was a machine-local symlink). Probe the first thumbnail; when it fails,
 * re-render replacements from the in-memory SMPL-X mesh clip instead.
 */
async function healTimelineThumbnails(mesh: MeshClip | null): Promise<void> {
  if (!mesh) return;
  const clip = exercises.squat?.clip;
  if (!clip || clip.thumbnails.length === 0) return;
  const firstThumb = clip.thumbnails[0];
  if (!firstThumb) return;
  try {
    const probe = await fetch(firstThumb, { method: "HEAD" });
    if (probe.ok) return;
  } catch {
    // fall through to mesh-rendered replacements
  }
  const thumbs = renderMeshThumbnails(mesh, clip.thumbnails.length);
  if (thumbs.length > 0) {
    clip.thumbnails = thumbs;
    console.info(`[mesh-thumbs] rendered ${thumbs.length} thumbnails from mesh clip`);
  }
}

async function hydrateMeshClip(): Promise<MeshClip | null> {
  try {
    const clip = await loadMeshClip("public/coach_clips/single_leg_squat.mesh.meta.json");
    defaultMeshClip = clip;
    console.info(
      `[mesh-clip] loaded ${clip.meta.frameCount} frames · ${clip.meta.vertexCount} verts · ${clip.meta.faceCount} faces`,
    );
    return clip;
  } catch (err) {
    console.warn("[mesh-clip] skip:", err);
    return null;
  }
}

/** Per-seed mesh envelopes for built-in seeds that ship their own SMPL-X clip. */
async function hydrateSeedMeshClips(): Promise<void> {
  const perSeed: Array<[string, string]> = [
    ["ugc-squat", "public/coach_clips/ugc_squat.mesh.meta.json"],
  ];
  await Promise.all(
    perSeed.map(async ([seedId, url]) => {
      try {
        meshClipBySeed.set(seedId, await loadMeshClip(url));
      } catch (err) {
        console.warn(`[mesh-clip] seed ${seedId} skip:`, err);
      }
    }),
  );
}

async function hydrateCoachClips(): Promise<void> {
  await Promise.all(
    getCoachClipManifest().map(async (entry) => {
      try {
        const clip = await loadCoachClip(entry.url);
        const thumbs = buildFrameThumbnails(entry);
        if (thumbs.length > 0) clip.thumbnails = thumbs;
        const current = exercises[entry.exercise];
        if (!current) return;
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
  /** Public sliced source video (segment.mp4); shown as the coach video. */
  sourceVideoUrl?: string;
}

async function hydrateImportedJobs(): Promise<void> {
  // Wait out the initial resource storm: dozens of module/asset fetches can
  // saturate a port-forwarded connection, and a fetch fired in that window
  // dies even though the backend is healthy. Capped so a slow asset can't
  // postpone hydration forever.
  if (document.readyState !== "complete") {
    await new Promise((resolve) => {
      const timer = window.setTimeout(resolve, 8000);
      window.addEventListener(
        "load",
        () => {
          window.clearTimeout(timer);
          resolve(undefined);
        },
        { once: true },
      );
    });
  }
  let payload: { jobs: unknown[] } | null = null;
  // Retry with backoff: a cold backend (checkpoint still loading) or a flaky
  // tunnel can kill the first fetch even though it answers fine moments
  // later. The loop stays fire-and-forget — boot never awaits it.
  for (let attempt = 0; attempt < 5 && payload === null; attempt += 1) {
    try {
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), 5000);
      const resp = await fetch(`${BACKEND_URL}/import/jobs`, { signal: ctrl.signal });
      window.clearTimeout(timer);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      payload = (await resp.json()) as { jobs: unknown[] };
    } catch (err) {
      if (attempt === 4) {
        console.warn("[imported-jobs] skip:", err);
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2000 * 2 ** attempt));
    }
  }
  if (!payload) return;
  const motionJobs = payload.jobs.filter(isPersistedMotionJob);
  await Promise.all(motionJobs.map((job) => hydrateOneJob(job)));

  // localStorage is only a cache. A fresh browser can rebuild the import's
  // selected binding by joining the backend's canonical motion id back to the
  // stable imported seed id. Ordinary coach/mesh hydration above never waits
  // on this optional avatar request.
  const seedByMotion = new Map(
    motionJobs.map((job) => [`motion-${job.jobId}`, `imported-${job.jobId}`]),
  );
  await avatarBindingController.discover(seedByMotion);
  // LibraryPage renders once on enter() and has no subscriptions; boot starts
  // the router before this hydration finishes, so a direct refresh would
  // never show imported seeds. Re-render if the user is sitting on #/.
  if (router.currentRoute().name === "library") libraryPage.enter();
}

function isPersistedMotionJob(job: unknown): job is PersistedJob {
  if (!job || typeof job !== "object") return false;
  const candidate = job as Partial<PersistedJob>;
  return typeof candidate.jobId === "string"
    && typeof candidate.coachClipUrl === "string"
    && typeof candidate.meshClipMetaUrl === "string";
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
    const config: AvatarExerciseConfig = {
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
      // The sliced source video doubles as the coach (twin) video for
      // imported seeds; no baked photoreal clip is produced anymore.
      coachVideo: job.sourceVideoUrl ? { front: job.sourceVideoUrl } : undefined,
    };
    const storedBinding = avatarBindingController.get(newId);
    if (storedBinding) assignBindingSnapshot(config, storedBinding);
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
  if (nextMode === "avatar") applyAvatarForSeed(state.exerciseId);
  syncStagePrimary();
}

/** Keep pending/error reusable bindings out of avatar mode while preserving
 * legacy KINEXGS1 visibility. */
function syncAvatarModeButton(): void {
  const exercise = exercises[state.exerciseId];
  const hasAvatar = hasPlayableAvatar(exercise);
  dom.modeButtons.forEach((button) => {
    if (button.dataset.mode === "avatar") button.hidden = !hasAvatar;
  });
  if (!hasAvatar && state.mode === "avatar") setMode("coach");
  // The switcher only makes sense for seeds backed by a reusable motion.
  avatarSwitcher.setContext(
    exercise?.motionId
      ? { seedId: state.exerciseId, motionId: exercise.motionId, avatarId: exercise.avatarId }
      : null,
  );
}

function setExercise(nextId: string, message: string): void {
  realtime?.resetForSeed(nextId);
  frameBuffer.reset();
  stage.resetForSeed();
  audio.seedActivate();
  const exercise = exercises[nextId];
  if (!exercise) return;
  state.exerciseId = nextId;
  syncAvatarBindingSurface(exercise);
  applyMeshForSeed(nextId);
  applyAvatarForSeed(nextId);
  connection.set(message, "busy");
  bus.emit("seed:update", { exercise, message });
  // Keep the URL honest when the seed changes from inside the train bay.
  if (router.currentRoute().name === "train" && router.currentRoute().params.seedId !== nextId) {
    router.navigate(`#/train/${nextId}`);
  }
  window.setTimeout(() => connection.set("Action DNA cache refreshed", "ready"), 420);
}

function applyAvatarForSeed(seedId: string): void {
  const asset = avatarAssetForSeed(seedId);
  if (!asset) {
    stage.setAvatar(null);
    return;
  }
  const cached = avatarBySeed.get(seedId);
  if (cached && cached.assetKey === asset.key) {
    stage.setAvatar(cached.avatar);
    if (state.mode === "avatar") dom.loadingOverlay.classList.add("is-hidden");
    return;
  }
  // Skeleton/mesh fallback stays on stage while the avatar streams in.
  stage.setAvatar(null);
  if (cached) {
    cached.avatar.dispose();
    avatarBySeed.delete(seedId);
  }
  if (state.mode === "avatar") dom.loadingOverlay.classList.remove("is-hidden");
  let pending = avatarLoads.get(seedId);
  if (!pending || pending.assetKey !== asset.key) {
    const promise = loadAvatarAsset(asset)
      .then((avatar) => {
        if (avatarAssetForSeed(seedId)?.key !== asset.key) {
          avatar.dispose();
          return null;
        }
        avatarBySeed.set(seedId, { assetKey: asset.key, avatar });
        return avatar;
      })
      .catch((err) => {
        console.warn(`[gs-avatar] load failed for ${seedId}:`, err);
        const exercise = exercises[seedId];
        if (exercise) exercise.avatarBindingError = err instanceof Error ? err.message : String(err);
        if (state.exerciseId === seedId) {
          setLoadingCopy("分身资源载入失败", "教练与骨骼模式仍可正常使用");
          connection.set("分身资源载入失败 · 普通教练仍可使用", "ready");
        }
        return null;
      });
    pending = { assetKey: asset.key, promise };
    avatarLoads.set(seedId, pending);
  }
  const pendingLoad = pending;
  void pending.promise.then((avatar) => {
    if (avatarLoads.get(seedId) === pendingLoad) avatarLoads.delete(seedId);
    // Ignore stale loads after the user switched seeds or either reusable URL moved.
    if (avatar && state.exerciseId === seedId && avatarAssetForSeed(seedId)?.key === asset.key) {
      stage.setAvatar(avatar);
      if (state.mode === "avatar") dom.loadingOverlay.classList.add("is-hidden");
    }
  });
}

type AvatarAsset =
  | { key: string; kind: "legacy"; url: string }
  | { key: string; kind: "reusable"; identityUrl: string; motionAssetUrl: string };

function avatarAssetForSeed(seedId: string): AvatarAsset | null {
  const exercise = exercises[seedId];
  if (!exercise) return null;
  if (
    exercise.identityUrl &&
    exercise.motionAssetUrl &&
    exercise.avatarBindingStatus !== "error" &&
    exercise.avatarBindingStatus !== "cancelled"
  ) {
    return {
      key: `reusable:${exercise.identityUrl}|${exercise.motionAssetUrl}`,
      kind: "reusable",
      identityUrl: exercise.identityUrl,
      motionAssetUrl: exercise.motionAssetUrl,
    };
  }
  return exercise.avatarUrl
    ? { key: `legacy:${exercise.avatarUrl}`, kind: "legacy", url: exercise.avatarUrl }
    : null;
}

async function loadAvatarAsset(asset: AvatarAsset): Promise<GaussianAvatar> {
  if (asset.kind === "legacy") return GaussianAvatar.load(asset.url);
  const avatar = await GaussianAvatar.loadIdentity(asset.identityUrl);
  try {
    const motion = await GaussianMotion.load(asset.motionAssetUrl);
    avatar.setMotion(motion);
    return avatar;
  } catch (error) {
    avatar.dispose();
    throw error;
  }
}

function applyBindingSnapshotToSeed(record: AvatarBindingSnapshot): void {
  const exercise = exercises[record.seedId];
  if (!exercise) return;
  if (exercise.bindingId && record.bindingId && exercise.bindingId !== record.bindingId) return;
  assignBindingSnapshot(exercise, record);
  if (record.seedId !== state.exerciseId) return;
  syncAvatarBindingSurface(exercise);
  syncAvatarModeButton();
}

function assignBindingSnapshot(
  exercise: AvatarExerciseConfig,
  record: AvatarBindingSnapshot,
): void {
  exercise.avatarId = record.avatarId;
  exercise.motionId = record.motionId;
  exercise.bindingId = record.bindingId;
  exercise.avatarBindingStatus = record.status;
  exercise.avatarBindingProgress = record.progress;
  exercise.avatarBindingError = record.error;
  exercise.identityUrl = record.identityUrl;
  exercise.motionAssetUrl = record.motionAssetUrl;
}

function syncAvatarBindingSurface(exercise: AvatarExerciseConfig): void {
  const status = exercise.avatarBindingStatus;
  const presentation = describeAvatarBinding(exercise);
  avatarBindingStatusSurface.root.hidden = !presentation.visible;
  avatarBindingStatusSurface.root.dataset.tone = presentation.tone;
  avatarBindingStatusSurface.title.textContent = presentation.title;
  avatarBindingStatusSurface.detail.textContent = presentation.detail;
  dom.loadingOverlay.dataset.avatarBindingStatus = status ?? "none";
  if (presentation.visible) {
    setLoadingCopy(presentation.title, presentation.detail);
    return;
  }
  setLoadingCopy("初始化全息舱…", "预加载 SMPL-Lite 骨骼 / 校准动作 DNA");
}

interface AvatarBindingStatusSurface {
  root: HTMLElement;
  title: HTMLElement;
  detail: HTMLElement;
}

function createAvatarBindingStatusSurface(parent: HTMLElement): AvatarBindingStatusSurface {
  const root = document.createElement("div");
  root.className = "avatar-binding-status";
  root.hidden = true;
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.setAttribute("aria-atomic", "true");

  const marker = document.createElement("i");
  marker.setAttribute("aria-hidden", "true");
  const copy = document.createElement("span");
  const title = document.createElement("strong");
  const detail = document.createElement("small");
  copy.append(title, detail);
  root.append(marker, copy);
  parent.appendChild(root);
  return { root, title, detail };
}

function setLoadingCopy(title: string, detail: string): void {
  const strong = document.createElement("strong");
  strong.textContent = title;
  const span = document.createElement("span");
  span.textContent = detail;
  dom.loadingOverlay.replaceChildren(strong, span);
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
  const template = MOTION_METRIC_TEMPLATES[motion] ?? MOTION_METRIC_TEMPLATES.squat;
  return template.map((m) => ({ ...m }));
}

function currentBpm(): number {
  return beatsPerMinute(exercises[state.exerciseId]?.motion ?? "squat", state.speed);
}
