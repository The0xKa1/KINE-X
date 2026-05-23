import { ScoreBoard } from "./components/gameui/ScoreBoard.js";
import { Timeline } from "./components/gameui/Timeline.js";
import { SeedCarousel } from "./components/gameui/SeedCarousel.js";
import { ComboBurst } from "./components/gameui/ComboBurst.js";
import { CoachingTip } from "./components/gameui/CoachingTip.js";
import { ResultsScreen } from "./components/gameui/ResultsScreen.js";
import { DnaExport } from "./components/gameui/DnaExport.js";
import { DnaDrawer } from "./components/gameui/DnaDrawer.js";
import { CameraSettings } from "./components/gameui/CameraSettings.js";
import { CalibrationOverlay } from "./components/gameui/CalibrationOverlay.js";
import { ImportDrawer } from "./components/gameui/ImportDrawer.js";
import { AiCoachPanel } from "./components/gameui/AiCoachPanel.js";
import { AppShell } from "./components/layout/AppShell.js";
import { AudioFx } from "./core/AudioFx.js";
import { CameraOverlay } from "./core/CameraOverlay.js";
import { EventBus } from "./core/EventBus.js";
import { MotionFrameBuffer } from "./core/frameBuffer.js";
import { MotionStage } from "./core/MotionStage.js";
import { LandmarkerController } from "./core/PoseLandmarkerManager.js";
import { CalibrationController } from "./core/scoring/CalibrationController.js";
import { CoachHistory } from "./core/scoring/CoachHistory.js";
import { SessionRecorder } from "./core/scoring/SessionRecorder.js";
import { UserPoseSource } from "./core/scoring/UserPoseSource.js";
import { UserProfileStore } from "./core/scoring/UserProfile.js";
import { WebCamManager } from "./core/WebCamManager.js";
import { exerciseOrder, exercises, pipeline } from "./data/exercises.js";
import { useWebSocket } from "./hooks/useWebSocket.js";
import { collectDomRefs } from "./bootstrap/dom.js";
import { MockStream, type MockStreamState } from "./bootstrap/MockStream.js";
import { ConnectionIndicator, renderDnaList, beatsPerMinute } from "./bootstrap/uiHelpers.js";
import type { ExerciseId, MotionMode } from "./types/motion.js";

const dom = collectDomRefs();
const bus = new EventBus();
const frameBuffer = new MotionFrameBuffer();
const socket = useWebSocket(frameBuffer, bus);
const audio = new AudioFx();
const connection = new ConnectionIndicator(dom.connectionText, dom.connectionDot);

const state: MockStreamState = {
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
bus.on("seed:update", () => sessionRecorder.reset());

const cameraOverlay = new CameraOverlay({
  canvas: dom.cameraOverlayCanvas,
  video: dom.cameraVideo,
  landmarkerController,
  userPose,
});
const webcam = new WebCamManager(dom.cameraVideo, bus);

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

const mockStream = new MockStream({
  state,
  exercises,
  socket,
  buffer: frameBuffer,
  webcam,
  coachHistory,
  scorer: { exercises, webcam, userPose, profileStore, coachHistory },
  onProgressTick: (progress) => shell.setProgress(progress),
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
  order: exerciseOrder,
  modeButtons: dom.modeButtons,
  onSeedChange: (nextId) => setExercise(nextId, "Seed action changed"),
  onModeChange: (nextMode) => setMode(nextMode),
});

const timeline = new Timeline({
  bus,
  container: dom.timelineFrames,
  label: dom.timelineLabel,
  onScrub: (nextProgress) => {
    state.progress = nextProgress;
    frameBuffer.reset();
    mockStream.pushFrame(performance.now());
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

const coachingTip = new CoachingTip({
  bus,
  bubble: dom.coachingTip,
  stage: dom.mirrorStage,
});
void coachingTip;

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
  getStats: () => comboBurst.getStats(),
  exercises,
  sessionRecorder,
  aiCoach,
  getLlmConfig: () => cameraSettings.getLlmConfig(),
  getPersona: () => cameraSettings.getPersona(),
});

const dnaDrawer = new DnaDrawer({
  drawer: dom.dnaDrawer,
  backdrop: dom.drawerBackdrop,
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
  backdrop: dom.drawerBackdrop,
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
  llmBaseUrl: dom.llmBaseUrl,
  llmApiKey: dom.llmApiKey,
  llmModel: dom.llmModel,
  personaSelect: dom.personaSelect,
  callbacks: {
    onSafeZoneChange: (visible) => cameraOverlay.setSafeZoneVisible(visible),
  },
});
void cameraSettings;

const CALIBRATION_SKIP_KEY = "holomotion.calibrationSkipped.v1";
const calibrationOverlay = new CalibrationOverlay({
  controller: calibrationController,
  root: dom.calibrationOverlay,
  title: dom.calibrationTitle,
  hint: dom.calibrationHint,
  bar: dom.calibrationBar,
  skipButton: dom.calibrationSkip,
  onSkip: () => {
    try {
      localStorage.setItem(CALIBRATION_SKIP_KEY, "1");
    } catch {
      // ignore
    }
  },
});
void calibrationOverlay;

const importDrawer = new ImportDrawer({
  drawer: dom.importDrawer,
  backdrop: dom.drawerBackdrop,
  trigger: dom.importButton,
  closeButton: dom.importClose,
  fileInput: dom.importFile,
  dropZone: dom.importDrop,
  motionSelect: dom.importMotionSelect,
  startButton: dom.importStart,
  applyButton: dom.importApply,
  progressBar: dom.importProgress,
  progressLabel: dom.importProgressLabel,
  statusLabel: dom.importStatus,
  preview: dom.importPreview,
  landmarkerController,
  onApply: (clip) => {
    const current = exercises[state.exerciseId];
    exercises[state.exerciseId] = {
      ...current,
      clip,
      durationSeconds: clip.durationSeconds,
      motion: clip.motion,
    };
    mockStream.resetForSeed(state.exerciseId);
    bus.emit("seed:update", {
      exercise: exercises[state.exerciseId],
      message: `Imported · ${clip.name}`,
    });
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
  onViewChange: (view) => stage.setView(view),
  onPlayChange: (nextPlaying) => {
    state.playing = nextPlaying;
    if (state.playing) audio.startBgm(currentBpm());
    else audio.stopBgm();
  },
  onStressChange: (enabled) => stage.setStress(enabled),
  onSpeedChange: (nextSpeed) => {
    state.speed = nextSpeed;
    if (state.playing) audio.startBgm(currentBpm());
  },
  onScrub: (nextProgress) => {
    state.progress = nextProgress;
    mockStream.pushFrame(performance.now());
  },
  onCameraToggle: () => {
    audio.enable();
    audio.resume();
    void webcam.toggle();
  },
});

bus.on("camera:update", (payload) => {
  connection.set(payload.label, payload.mode === "camera" ? "ready" : "busy");
  const visible = payload.mode === "camera" && payload.active;
  dom.mirrorEmpty.classList.toggle("is-hidden", visible);
  dom.mirrorTitle.textContent = visible ? "你的镜像 · LIVE" : "你的镜像";
  if (!visible) {
    cameraOverlay.clear();
    userPose.clear();
    calibrationController.cancel();
    return;
  }
  let skipped = false;
  try {
    skipped = localStorage.getItem(CALIBRATION_SKIP_KEY) === "1";
  } catch {
    skipped = false;
  }
  if (!profileStore.get() && !skipped && calibrationController.getStatus().phase === "idle") {
    // Defer a tick so the camera has a chance to push the first landmarks.
    window.setTimeout(() => calibrationController.start(), 600);
  }
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

dom.runPipelineButton.addEventListener("click", () => {
  audio.enable();
  audio.resume();
  audio.seedActivate();
  if (state.playing) audio.startBgm(currentBpm());
  bus.emit("pipeline:update", { runIndex: 1, latencyMs: 36, status: "busy" });
  window.setTimeout(() => {
    bus.emit("pipeline:update", { runIndex: 2, latencyMs: 42, status: "ready" });
  }, 540);
});

dom.finishButton.addEventListener("click", () => {
  resultsScreen.open();
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

void stage.preload().then(() => {
  setExercise(state.exerciseId, "Mock WebSocket streaming");
  mockStream.start();
  stage.start();
  const wsUrl = new URLSearchParams(window.location.search).get("ws") ?? DEFAULT_WS_URL;
  socket.connect(wsUrl);
});

function setMode(nextMode: MotionMode): void {
  state.mode = nextMode;
  stage.setMode(nextMode);
  seedCarousel.setMode(nextMode);
}

function setExercise(nextId: ExerciseId, message: string): void {
  mockStream.resetForSeed(nextId);
  stage.resetForSeed();
  audio.seedActivate();
  const exercise = exercises[nextId];
  connection.set(message, "busy");
  bus.emit("seed:update", { exercise, message });
  window.setTimeout(() => connection.set("Action DNA cache refreshed", "ready"), 420);
}

function currentBpm(): number {
  return beatsPerMinute(exercises[state.exerciseId].motion, state.speed);
}
