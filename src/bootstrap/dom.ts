export const $ = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};

export const $$ = <T extends Element>(selector: string): T[] =>
  Array.from(document.querySelectorAll<T>(selector));

export interface DomRefs {
  stageTitle: HTMLElement;
  mirrorTitle: HTMLElement;
  connectionText: HTMLElement;
  connectionDot: HTMLElement;
  fpsLabel: HTMLElement;
  mirrorEmpty: HTMLElement;
  mirrorEmptyTitle: HTMLElement;
  mirrorEmptyHint: HTMLElement;
  cameraRetry: HTMLButtonElement;
  cameraVideo: HTMLVideoElement;
  cameraOverlayCanvas: HTMLCanvasElement;
  motionCanvas: HTMLCanvasElement;
  loadingOverlay: HTMLElement;

  metricList: HTMLElement;
  pipelineList: HTMLElement;
  scoreValue: HTMLElement;
  comboLabel: HTMLElement;
  riskBadge: HTMLElement;
  frameLabel: HTMLElement;
  deltaLabel: HTMLElement;
  pipelineLatency: HTMLElement;
  streamLabel: HTMLElement;
  dnaList: HTMLElement;

  seedCarousel: HTMLElement;
  seedHeadName: HTMLElement;
  modeButtons: HTMLButtonElement[];
  timelineFrames: HTMLElement;
  timelineLabel: HTMLElement;

  fxLayer: HTMLElement;
  fxFlash: HTMLElement;
  fxBurst: HTMLElement;
  fxCombo: HTMLElement;
  mirrorStage: HTMLElement;

  resultsScreen: HTMLElement;
  resultsClose: HTMLElement;
  resultsScore: HTMLElement;
  resultsBeat: HTMLElement;
  resultsCombo: HTMLElement;
  resultsPerfect: HTMLElement;
  resultsDelta: HTMLElement;
  resultsRisk: HTMLElement;
  medalName: HTMLElement;
  resultsTitle: HTMLElement;
  exportButton: HTMLElement;

  dnaExport: HTMLElement;
  exportClose: HTMLElement;
  exportBar: HTMLElement;
  exportLabel: HTMLElement;
  exportHead: HTMLElement;
  exportSub: HTMLElement;
  exportQr: HTMLElement;
  exportQrCode: HTMLElement;

  dnaDrawer: HTMLElement;
  drawerBackdrop: HTMLElement;
  dnaButton: HTMLElement;
  drawerClose: HTMLElement;

  cameraSettingsDrawer: HTMLElement;
  cameraSettingsButton: HTMLElement;
  cameraSettingsClose: HTMLElement;
  cameraDeviceSelect: HTMLSelectElement;
  cameraResolutionSelect: HTMLSelectElement;
  cameraFitSelect: HTMLSelectElement;
  cameraMirrorToggle: HTMLInputElement;
  cameraSafeZoneToggle: HTMLInputElement;
  poseModelSelect: HTMLSelectElement;
  modalityPoseToggle: HTMLInputElement;
  modalityHandToggle: HTMLInputElement;
  modalityFaceToggle: HTMLInputElement;
  recalibrateButton: HTMLButtonElement;
  calibrationStatusLabel: HTMLElement;
  personaSelect: HTMLSelectElement;
  aiCoachCard: HTMLElement;
  aiCoachText: HTMLElement;
  aiCoachStatus: HTMLElement;

  calibrationOverlay: HTMLElement;
  calibrationTitle: HTMLElement;
  calibrationHint: HTMLElement;
  calibrationBar: HTMLElement;
  calibrationSkip: HTMLButtonElement;
  calibrationDone: HTMLButtonElement;
  calibrationRedo: HTMLButtonElement;

  sessionOverlay: HTMLElement;
  sessionIdle: HTMLElement;
  sessionCountdown: HTMLElement;
  sessionStartButton: HTMLButtonElement;
  sessionCountdownNumber: HTMLElement;
  sessionGestureValue: HTMLElement;
  sessionGestureBar: HTMLElement;

  importDrawer: HTMLElement;
  importButton: HTMLElement;
  importClose: HTMLElement;
  importFile: HTMLInputElement;
  importDrop: HTMLElement;
  importMotionSelect: HTMLSelectElement;
  importStart: HTMLButtonElement;
  importApply: HTMLButtonElement;
  importSegment: HTMLButtonElement;
  segmentList: HTMLElement;
  segmentSummary: HTMLElement;
  importProgress: HTMLElement;
  importProgressLabel: HTMLElement;
  importStatus: HTMLElement;
  importPreview: HTMLVideoElement;

  railItems: HTMLButtonElement[];
  viewButtons: HTMLButtonElement[];
  playButton: HTMLButtonElement;
  playIcon: SVGElement;
  stressToggle: HTMLInputElement;
  speedSlider: HTMLInputElement;
  timeSlider: HTMLInputElement;
  cameraButton: HTMLButtonElement;
  finishButton: HTMLElement;
  demoPerfectButton: HTMLButtonElement;
  demoComboButton: HTMLButtonElement;
}

export function collectDomRefs(): DomRefs {
  return {
    stageTitle: $("#stageTitle"),
    mirrorTitle: $("#mirrorTitle"),
    connectionText: $("#connectionText"),
    connectionDot: $("#connectionDot"),
    fpsLabel: $("#fpsLabel"),
    mirrorEmpty: $("#mirrorEmpty"),
    mirrorEmptyTitle: $("#mirrorEmptyTitle"),
    mirrorEmptyHint: $("#mirrorEmptyHint"),
    cameraRetry: $("#cameraRetry") as HTMLButtonElement,
    cameraVideo: $("#cameraVideo") as HTMLVideoElement,
    cameraOverlayCanvas: $("#cameraOverlay") as HTMLCanvasElement,
    motionCanvas: $("#motionCanvas") as HTMLCanvasElement,
    loadingOverlay: $("#loadingOverlay"),

    metricList: $("#metricList"),
    pipelineList: $("#pipelineList"),
    scoreValue: $("#scoreValue"),
    comboLabel: $("#comboLabel"),
    riskBadge: $("#riskBadge"),
    frameLabel: $("#frameLabel"),
    deltaLabel: $("#deltaLabel"),
    pipelineLatency: $("#pipelineLatency"),
    streamLabel: $("#streamLabel"),
    dnaList: $("#dnaList"),

    seedCarousel: $("#seedCarousel"),
    seedHeadName: $("#seedHeadName"),
    modeButtons: $$<HTMLButtonElement>("[data-mode]"),
    timelineFrames: $("#timelineFrames"),
    timelineLabel: $("#timelineLabel"),

    fxLayer: $("#mirrorFx"),
    fxFlash: $("#fxFlash"),
    fxBurst: $("#fxBurst"),
    fxCombo: $("#fxCombo"),
    mirrorStage: $("#mirrorStage"),

    resultsScreen: $("#resultsScreen"),
    resultsClose: $("#resultsClose"),
    resultsScore: $("#resultsScore"),
    resultsBeat: $("#resultsBeat"),
    resultsCombo: $("#resultsCombo"),
    resultsPerfect: $("#resultsPerfect"),
    resultsDelta: $("#resultsDelta"),
    resultsRisk: $("#resultsRisk"),
    medalName: $("#medalName"),
    resultsTitle: $("#resultsTitle"),
    exportButton: $("#exportButton"),

    dnaExport: $("#dnaExport"),
    exportClose: $("#exportClose"),
    exportBar: $("#exportBar"),
    exportLabel: $("#exportLabel"),
    exportHead: $("#exportHead"),
    exportSub: $("#exportSub"),
    exportQr: $("#exportQr"),
    exportQrCode: $("#exportQrCode"),

    dnaDrawer: $("#dnaDrawer"),
    drawerBackdrop: $("#drawerBackdrop"),
    dnaButton: $("#dnaButton"),
    drawerClose: $("#drawerClose"),

    cameraSettingsDrawer: $("#cameraSettingsDrawer"),
    cameraSettingsButton: $("#cameraSettingsButton"),
    cameraSettingsClose: $("#cameraSettingsClose"),
    cameraDeviceSelect: $("#cameraDeviceSelect") as HTMLSelectElement,
    cameraResolutionSelect: $("#cameraResolutionSelect") as HTMLSelectElement,
    cameraFitSelect: $("#cameraFitSelect") as HTMLSelectElement,
    cameraMirrorToggle: $("#cameraMirrorToggle") as HTMLInputElement,
    cameraSafeZoneToggle: $("#cameraSafeZoneToggle") as HTMLInputElement,
    poseModelSelect: $("#poseModelSelect") as HTMLSelectElement,
    modalityPoseToggle: $("#modalityPoseToggle") as HTMLInputElement,
    modalityHandToggle: $("#modalityHandToggle") as HTMLInputElement,
    modalityFaceToggle: $("#modalityFaceToggle") as HTMLInputElement,
    recalibrateButton: $("#recalibrateButton") as HTMLButtonElement,
    calibrationStatusLabel: $("#calibrationStatusLabel"),
    personaSelect: $("#personaSelect") as HTMLSelectElement,
    aiCoachCard: $("#aiCoachCard"),
    aiCoachText: $("#aiCoachText"),
    aiCoachStatus: $("#aiCoachStatus"),

    calibrationOverlay: $("#calibrationOverlay"),
    calibrationTitle: $("#calibrationTitle"),
    calibrationHint: $("#calibrationHint"),
    calibrationBar: $("#calibrationBar"),
    calibrationSkip: $("#calibrationSkip") as HTMLButtonElement,
    calibrationDone: $("#calibrationDone") as HTMLButtonElement,
    calibrationRedo: $("#calibrationRedo") as HTMLButtonElement,

    sessionOverlay: $("#sessionOverlay"),
    sessionIdle: $("#sessionIdle"),
    sessionCountdown: $("#sessionCountdown"),
    sessionStartButton: $("#sessionStartButton") as HTMLButtonElement,
    sessionCountdownNumber: $("#sessionCountdownNumber"),
    sessionGestureValue: $("#sessionGestureValue"),
    sessionGestureBar: $("#sessionGestureBar"),

    importDrawer: $("#importDrawer"),
    importButton: $("#importButton"),
    importClose: $("#importClose"),
    importFile: $("#importFile") as HTMLInputElement,
    importDrop: $("#importDrop"),
    importMotionSelect: $("#importMotionSelect") as HTMLSelectElement,
    importStart: $("#importStart") as HTMLButtonElement,
    importApply: $("#importApply") as HTMLButtonElement,
    importSegment: $("#importSegment") as HTMLButtonElement,
    segmentList: $("#segmentList"),
    segmentSummary: $("#segmentSummary"),
    importProgress: $("#importProgress"),
    importProgressLabel: $("#importProgressLabel"),
    importStatus: $("#importStatus"),
    importPreview: $("#importPreview") as HTMLVideoElement,

    railItems: $$<HTMLButtonElement>(".rail-item"),
    viewButtons: $$<HTMLButtonElement>("[data-view]"),
    playButton: $("#playButton") as HTMLButtonElement,
    playIcon: $("#playIcon") as unknown as SVGElement,
    stressToggle: $("#stressToggle") as HTMLInputElement,
    speedSlider: $("#speedSlider") as HTMLInputElement,
    timeSlider: $("#timeSlider") as HTMLInputElement,
    cameraButton: $("#cameraButton") as HTMLButtonElement,
    finishButton: $("#finishButton"),
    demoPerfectButton: $("#demoPerfect") as HTMLButtonElement,
    demoComboButton: $("#demoCombo") as HTMLButtonElement,
  };
}
