export const $ =                    (selector        )    => {
  const element = document.querySelector   (selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};

export const $$ =                    (selector        )      =>
  Array.from(document.querySelectorAll   (selector));

                          
                          
                           
                              
                             
                             
                       
                          
                     
                       
                        
                           
                                
                               
                                 
                                
                                         
                                  
                              
                           
                           
                         
                          
                          

                          
                            
                          
                          
                         
                          
                          
                               
                           
                       

                            
                            
                                   
                              
                             

                       
                       
                       
                       
                       
                           

                             
                            
                            
                           
                            
                              
                            
                           
                             
                         
                            
                                       
                            

                         
                           
                         
                           
                          
                         
                        
                            

                         
                              
                         
                           

                                    
                                    
                                   
                                        
                                            
                                     
                                       
                                         
                                     
                                       
                                       
                                       
                                       
                                      
                                   
                           
                           
                             

                                  
                                
                               
                              
                                     
                                     
                                     

                              
                           
                                
                                        
                                      
                                   
                                 

                            

                                 
                                   
                                
                       
                                 
                                
                               
                                  
                            
                                       
                                     
 

export function collectDomRefs()          {
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
    mirrorEmpty: $("#mirrorEmpty"),
    mirrorEmptyTitle: $("#mirrorEmptyTitle"),
    mirrorEmptyHint: $("#mirrorEmptyHint"),
    cameraRetry: $("#cameraRetry")                     ,
    cameraVideo: $("#cameraVideo")                    ,
    cameraOverlayCanvas: $("#cameraOverlay")                     ,
    motionCanvas: $("#motionCanvas")                     ,
    loadingOverlay: $("#loadingOverlay"),
    bootOverlay: $("#bootOverlay"),
    pageLibrary: $("#page-library"),
    pageTrain: $("#page-train"),
    pageReport: $("#page-report"),
    pageCreate: $("#page-create"),

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
    modeButtons: $$                   ("[data-mode]"),
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
    resultsReportLink: $("#resultsReportLink")                     ,
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
    cameraDeviceSelect: $("#cameraDeviceSelect")                     ,
    cameraResolutionSelect: $("#cameraResolutionSelect")                     ,
    cameraFitSelect: $("#cameraFitSelect")                     ,
    cameraMirrorToggle: $("#cameraMirrorToggle")                    ,
    cameraSafeZoneToggle: $("#cameraSafeZoneToggle")                    ,
    poseModelSelect: $("#poseModelSelect")                     ,
    modalityPoseToggle: $("#modalityPoseToggle")                    ,
    modalityHandToggle: $("#modalityHandToggle")                    ,
    modalityFaceToggle: $("#modalityFaceToggle")                    ,
    recalibrateButton: $("#recalibrateButton")                     ,
    calibrationStatusLabel: $("#calibrationStatusLabel"),
    personaSelect: $("#personaSelect")                     ,
    aiCoachCard: $("#aiCoachCard"),
    aiCoachText: $("#aiCoachText"),
    aiCoachStatus: $("#aiCoachStatus"),

    calibrationOverlay: $("#calibrationOverlay"),
    calibrationTitle: $("#calibrationTitle"),
    calibrationHint: $("#calibrationHint"),
    calibrationBar: $("#calibrationBar"),
    calibrationSkip: $("#calibrationSkip")                     ,
    calibrationDone: $("#calibrationDone")                     ,
    calibrationRedo: $("#calibrationRedo")                     ,

    sessionOverlay: $("#sessionOverlay"),
    sessionIdle: $("#sessionIdle"),
    sessionCountdown: $("#sessionCountdown"),
    sessionStartButton: $("#sessionStartButton")                     ,
    sessionCountdownNumber: $("#sessionCountdownNumber"),
    sessionGestureValue: $("#sessionGestureValue"),
    sessionGestureBar: $("#sessionGestureBar"),

    importButton: $("#importButton"),

    railItems: $$                   (".rail-item"),
    viewButtons: $$                   ("[data-view]"),
    playButton: $("#playButton")                     ,
    playIcon: $("#playIcon")                         ,
    stressToggle: $("#stressToggle")                    ,
    speedSlider: $("#speedSlider")                    ,
    timeSlider: $("#timeSlider")                    ,
    cameraButton: $("#cameraButton")                     ,
    finishButton: $("#finishButton"),
    demoPerfectButton: $("#demoPerfect")                     ,
    demoComboButton: $("#demoCombo")                     ,
  };
}
