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
  connectionLat: HTMLElement;
  tlFrame: HTMLElement;
  tlProgress: HTMLElement;
  tlLat: HTMLElement;
  tlDelta: HTMLElement;
  fpsLabel: HTMLElement;
  stageRisk: HTMLElement;
  mirrorEmpty: HTMLElement;
  mirrorEmptyTitle: HTMLElement;
  mirrorEmptyHint: HTMLElement;
  cameraRetry: HTMLButtonElement;
  cameraVideo: HTMLVideoElement;
  cameraOverlayCanvas: HTMLCanvasElement;
  motionCanvas: HTMLCanvasElement;
  coachVideo: HTMLVideoElement;
  stageBay: HTMLElement;
  thumbHotspot: HTMLElement;
  thumbLabel: HTMLElement;
  loadingOverlay: HTMLElement;
  bootOverlay: HTMLElement;
  pageLibrary: HTMLElement;
  pageTrain: HTMLElement;
  pageReport: HTMLElement;
  pageCreate: HTMLElement;
  pageAvatars: HTMLElement;

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
  fxGiant: HTMLElement;
  mirrorStage: HTMLElement;

  resultsScreen: HTMLElement;
  resultsClose: HTMLElement;
  resultsScore: HTMLElement;
  resultsBeat: HTMLElement;
  resultsCombo: HTMLElement;
  resultsPerfect: HTMLElement;
  resultsDelta: HTMLElement;
  resultsRisk: HTMLElement;
  resultsJoints: HTMLElement;
  medalName: HTMLElement;
  resultsTitle: HTMLElement;
  resultsReportLink: HTMLButtonElement;

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
  aiApiSection: HTMLElement;
  llmBaseUrl: HTMLInputElement;
  llmApiKey: HTMLInputElement;
  mllmModel: HTMLInputElement;
  coachModel: HTMLInputElement;
  llmClear: HTMLButtonElement;
  llmStatus: HTMLElement;
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

  importButton: HTMLElement;

  railItems: HTMLButtonElement[];
  viewButtons: HTMLButtonElement[];
  playButton: HTMLButtonElement;
  playIcon: SVGElement;
  stressToggle: HTMLInputElement;
  speedSlider: HTMLInputElement;
  speedValue: HTMLElement;
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
    connectionLat: $("#connectionLat"),
    tlFrame: $("#tlFrame"),
    tlProgress: $("#tlProgress"),
    tlLat: $("#tlLat"),
    tlDelta: $("#tlDelta"),
    fpsLabel: $("#fpsLabel"),
    stageRisk: $("#stageRisk"),
    mirrorEmpty: $("#mirrorEmpty"),
    mirrorEmptyTitle: $("#mirrorEmptyTitle"),
    mirrorEmptyHint: $("#mirrorEmptyHint"),
    cameraRetry: $("#cameraRetry") as HTMLButtonElement,
    cameraVideo: $("#cameraVideo") as HTMLVideoElement,
    cameraOverlayCanvas: $("#cameraOverlay") as HTMLCanvasElement,
    motionCanvas: $("#motionCanvas") as HTMLCanvasElement,
    coachVideo: $("#coachVideo") as HTMLVideoElement,
    stageBay: $("#stageBay"),
    thumbHotspot: $("#thumbHotspot"),
    thumbLabel: $("#thumbLabel"),
    loadingOverlay: $("#loadingOverlay"),
    bootOverlay: $("#bootOverlay"),
    pageLibrary: $("#page-library"),
    pageTrain: $("#page-train"),
    pageReport: $("#page-report"),
    pageCreate: $("#page-create"),
    pageAvatars: $("#page-avatars"),

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
    fxGiant: $("#fxGiant"),
    mirrorStage: $("#mirrorStage"),

    resultsScreen: $("#resultsScreen"),
    resultsClose: $("#resultsClose"),
    resultsScore: $("#resultsScore"),
    resultsBeat: $("#resultsBeat"),
    resultsCombo: $("#resultsCombo"),
    resultsPerfect: $("#resultsPerfect"),
    resultsDelta: $("#resultsDelta"),
    resultsRisk: $("#resultsRisk"),
    resultsJoints: $("#resultsJoints"),
    medalName: $("#medalName"),
    resultsTitle: $("#resultsTitle"),
    resultsReportLink: $("#resultsReportLink") as HTMLButtonElement,

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
    aiApiSection: $("#aiApiSettingsSection"),
    llmBaseUrl: $("#llmBaseUrl") as HTMLInputElement,
    llmApiKey: $("#llmApiKey") as HTMLInputElement,
    mllmModel: $("#mllmModel") as HTMLInputElement,
    coachModel: $("#coachModel") as HTMLInputElement,
    llmClear: $("#llmClear") as HTMLButtonElement,
    llmStatus: $("#llmStatus"),
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

    importButton: $("#importButton"),

    railItems: $$<HTMLButtonElement>(".rail-item"),
    viewButtons: $$<HTMLButtonElement>("[data-view]"),
    playButton: $("#playButton") as HTMLButtonElement,
    playIcon: $("#playIcon") as unknown as SVGElement,
    stressToggle: $("#stressToggle") as HTMLInputElement,
    speedSlider: $("#speedSlider") as HTMLInputElement,
    speedValue: $("#speedValue"),
    cameraButton: $("#cameraButton") as HTMLButtonElement,
    finishButton: $("#finishButton"),
    demoPerfectButton: $("#demoPerfect") as HTMLButtonElement,
    demoComboButton: $("#demoCombo") as HTMLButtonElement,
  };
}
