# Project Index

## 定位

KINE//X 的项目结构索引。
不记录开发流水。
只保留稳定结构和维护规则。

## 根目录

`index.html`：浏览器入口，加载 `src/styles.css` 与构建后的 `dist/main.js`；importmap 把 `@mediapipe/tasks-vision` 映射到本地 `public/mediapipe/tasks-vision/vision_bundle.mjs`。
`package.json`：本地命令入口（build / dev / check）。
`tsconfig.json`：TypeScript 诊断配置（`noEmit: true`），不负责构建输出。
`README.md`：使用说明、模块清单、mock-to-real 边界。
`CLAUDE.md`：面向代码助手的工程约束说明。
`assets/`：演示资源目录（含 `smpl-lite-rig.gltf`）。
`public/`：离线运行时资产，目前仅含 `public/mediapipe/`（SDK + WASM + 5 个 .task 模型，约 76MB）。
`docs/`：项目文档与海报参考。
`scripts/`：构建与守卫脚本。
`src/`：TypeScript / CSS 源码。
`dist/`：构建产物，不手工修改。

## 常用命令

`npm run build`：将 `src/**/*.ts` 类型擦除为 `dist/**/*.js`（Node 内置 `stripTypeScriptTypes`，无打包）。
`npm run dev`：构建并启动 `5173` 静态服务。
`npm run check`：构建并跑 `scripts/guardrails.mjs`，是唯一发布门禁。
源码 `import` 必须使用 `.js` 后缀，浏览器在 `dist/` 解析模块。
项目零 `dependencies`，仅靠 importmap 引入 three 与 MediaPipe；MediaPipe 走本地路径，three 仍走 esm.sh。

## src 总览

`src/main.ts`：组合根；装配 EventBus、帧缓存、Stage、MockStream、所有 UI 组件、MediaPipe、Calibration、Scoring、SessionRecorder、AI Coach。
`src/styles.css`：仅作为入口，按主题 `@import` 拆分到 `src/styles/`。
`src/types/`：前后端数据契约类型（含 `CoachClip` / `SkeletonPose` / `JointName` 等）。
`src/core/`：渲染、帧缓存、坐标、事件、摄像头、MediaPipe、资源生命周期、音频、scoring、import、llm 子目录。
`src/components/`：非 3D 的 UI 组件。
`src/bootstrap/`：主入口辅助层（DOM 收集、mock 流、UI 小工具）。
`src/hooks/`：外部数据流入口。
`src/mock/`：mock 动作帧生成器。
`src/data/`：动作种子和推理流程配置。

## bootstrap

`bootstrap/dom.ts`：`$` / `$$` 选择器与 `collectDomRefs()`，集中管理所有页面元素引用（含 import drawer / camera settings drawer / AI coach / calibration overlay 的全部节点）。
`bootstrap/MockStream.ts`：`MockStream` 类，封装 33ms 定时器与 `pushFrame` 路径，是后端接入的唯一替换点；构造时接收 `scorer` 上下文，当摄像头开启时改走真实评分。
`bootstrap/uiHelpers.ts`：`ConnectionIndicator`、`renderDnaList`、`beatsPerMinute` 等装配期小工具。

## components/gameui

`SeedCarousel.ts`：种子卡片轮播 + 模式分段控件。
`ScoreBoard.ts`：score / combo / risk / joint metrics / pipeline 渲染（写入抽屉内 DOM）。
`Timeline.ts`：clip 帧节奏条；导入后按 `clip.thumbnails.length` 一帧一格，flex 横向滚动，当前帧自动 `scrollIntoView`；无 clip 时回退 18 帧 mock。
`ComboBurst.ts`：监听 `score:update` 触发 PERFECT 与 Combo 视觉特效。
`CoachingTip.ts`：根据最差关节风险等级，在镜像舱浮出软萌中文纠错气泡。
`ResultsScreen.ts`：结算页（分数、击败百分比、勋章、四宫格、二创入口）；从 `SessionRecorder` 取真实统计。
`DnaExport.ts`：DNA 二创视频导出弹窗（mock 进度 + 假二维码）。
`DnaDrawer.ts`：右侧 DNA 抽屉的开 / 合 / Esc 关闭。
`CameraSettings.ts`：摄像头 + MediaPipe 设置抽屉（设备、分辨率、镜像、安全区、模型档位、模态开关、重新校准、LLM endpoint）。
`CalibrationOverlay.ts`：用户标定流程的全屏遮罩与进度。
`ImportDrawer.ts`：视频 → CoachClip 导入流程（拖放、`probeFps`、`ensureReady`、逐帧 detect、缩略图、`postProcessFrames`、apply）。
`AiCoachPanel.ts`：流式 AI 教练文本面板，调用 `core/llm/LLMClient.streamChat`。

## core

`core/MotionStage.ts`：动作舞台编排器；拥有 RAF 主循环、`slerp` 平滑、`disposeSceneResources` 调度、UI 节流发射。
`core/motion/skeleton.ts`：骨骼连接表与风险关节映射（纯数据）。
`core/motion/StageInteractions.ts`：canvas 拖拽、滚轮、双击复位的指针交互。
`core/CameraOverlay.ts`：摄像头舱内 2D 骨骼贴合渲染、安全区线框、MediaPipe 多模态 overlay。
`core/WebCamManager.ts`：摄像头权限 / 流 / 镜像 / mock fallback。
`core/PoseLandmarkerManager.ts`：`LandmarkerController` MediaPipe 封装；管理 pose / hand / face 三个 landmarker、模型档位切换、单调时间戳、`ensureReady()`、`LandmarkSmoother` 平滑。
`core/frameBuffer.ts`：高频帧缓存；`pushPacket(packet)` 是唯一写入点；只保存最新 `RuntimeFrame`。
`core/EventBus.ts`：低频 UI 事件总线（score / pipeline / seed / camera）。
`core/coordinates.ts`：单位与坐标契约（米、右手系、Y up、X right、Z out-of-screen）。
`core/three-compat.ts`：轻量 Quaternion 兼容层。
`core/AudioFx.ts`：WebAudio 合成器（PERFECT 叮、Combo 升档、种子激活、低 BPM kick）。
`core/assetPreloader.ts`：骨骼资源预加载。
`core/ThreeResourceTracker.ts`：资源释放与场景重建。

### core/scoring

`PoseScorer.ts`：核心评分器；用标定后的骨长把 MediaPipe world landmarks 换算到米制，再用 `JOINT_ANGLES` 算关节角度误差和 3D 距离误差，加权综合到帧分。
`CoachHistory.ts`：教练帧滑窗（黑客松抗延迟），评委姿态与最近 N 帧标准姿态比对取最优。
`CalibrationController.ts`：T-pose 标定，采 ~1s 稳定帧推导骨长 + Y 参考。
`UserProfile.ts`：标定结果的 `localStorage` 持久化（`UserProfileStore`）。
`UserPoseSource.ts`：把 `CameraOverlay` 拿到的 MediaPipe world landmarks 推送给 `PoseScorer` / `CalibrationController` 的桥。
`LandmarkSmoother.ts`：MediaPipe landmark 平滑（pose / face）。
`OneEuroFilter.ts`：One-Euro 滤波，用于导入后的逐帧时序平滑。
`SessionRecorder.ts`：监听 `score:update`，累计 per-joint 平均/最差分、阶段（intro/mid/peak/outro）平均、风险触发次数，结算页消费。
`normalize.ts` / `jointAngles.ts` / `boneTable.ts`：landmark 归一化、关节角度定义、骨骼锚点表。

### core/import

`VideoSeeker.ts`：把本地视频文件挂到隐藏 `<video>`；`load()` 等 `loadeddata`，`probeFps()` 用 `requestVideoFrameCallback` 探测原生帧率，`iterate(fps, visitor)` 逐帧 seek（seeked + rVFC 双保险）。
`landmarksToPose.ts`：MediaPipe 33 点 world landmarks → 17 关节 `SkeletonPose`。
`postProcess.ts`：补空洞 + 时间维 One-Euro 平滑 + 居中 + 1m 身高归一化。
`CoachClip.ts`：clip 关节插值工具（`lerpPose`），供 MockStream 按 `progress` 取出当前姿态。

### core/llm

`buildPrompt.ts`：把结算页的 `SessionSummary` 拼成系统 + 用户提示词。
`LLMClient.ts`：`streamChat(settings, messages, onDelta)`；OpenAI 兼容 `/chat/completions` SSE 流式实现，settings 来自 CameraSettings 抽屉里的 baseUrl / apiKey / model。

## styles

`src/styles.css`：仅含 `@import` 入口。
`styles/tokens.css`：颜色、字体、`--hairline` 等 CSS 变量。
`styles/base.css`：reset、`app-shell`、`workspace` 网格。
`styles/controls.css`：按钮、range、toggle、segmented、status / risk badge。
`styles/rail.css`：左侧导航。
`styles/topbar.css`：顶栏与海报式标题。
`styles/seed-strip.css`：种子卡片轮播。
`styles/bay.css`：左右双舱舞台、loading mask、playbar、镜像视频镜像与色彩滤镜。
`styles/hud.css`：HUD chip、分数面板、coaching tip。
`styles/fx.css`：PERFECT / Combo / 扫光关键帧。
`styles/drawer.css`：DNA / 摄像头设置 / Import 抽屉、metric / pipeline 行、风险态。
`styles/timeline.css`：时间轴 flex 横向滚动布局（少帧 `flex: 1` 铺满，多帧按 `26px` 横滚）。
`styles/results.css`：结算页四宫格 + AI 教练面板。
`styles/dna-export.css`：二维码导出弹窗。
`styles/responsive.css`：媒体查询。

## data mock hooks types

`data/exercises.ts`：动作种子与推理管线（squat / deadlift / baduanjin / street / basketball）；导入的 `CoachClip` 会原地替换 seed 的 `clip` 字段。
`mock/mockFrameSource.ts`：确定性 mock 帧生成器，输出 `FRAME_STREAM` + seedJoints / joints / localRotations / metrics。摄像头开启时该路径让位给 `PoseScorer`。
`hooks/useWebSocket.ts`：FastAPI WebSocket 接入点；mock 与真实流共用 `consumePacket`。
`types/motion.ts`：核心类型契约（`MotionFrame` / `QuaternionTuple` / `JointName` / `RuntimeFrame` / `ScoreUpdate` / `CoachClip` / `SkeletonPose`…）。

## public/mediapipe

`tasks-vision/vision_bundle.mjs`：`@mediapipe/tasks-vision@0.10.14` ES 模块入口（替代 esm.sh）。
`wasm/vision_wasm_internal{,_nosimd}.{js,wasm}`：SIMD 与回退 WASM 对。
`models/pose_landmarker_{lite,full,heavy}.task`：三档 BlazePose；`heavy` 由 import 流程使用，`lite` 是 live 默认。
`models/hand_landmarker.task` / `models/face_landmarker.task`：手 / 脸模态。
全部资产来自 jsdelivr 与 storage.googleapis.com 镜像，版本固定 0.10.14；升级时整体替换并改 `PoseLandmarkerManager.ts` 与 `index.html` 的引用版本。

## scripts

`scripts/build.mjs`：构建脚本，仅做类型擦除，不打包。
`scripts/guardrails.mjs`：守卫检查。
必需字符串：`unit: "meters"`、`handedness: "right-hand"`、`scaleX(-1)`、`requestAnimationFrame`、`.slerp(`、`disposeSceneResources(`、`pushPacket(packet`。
禁用字符串：`Euler`、`useState`、`ref(`。
对 `dist/**/*.js` 执行 `node --check` 语法校验。

## docs

`docs/Constraint.md`：工程与数据流硬约束。
`docs/design.png`：视觉锚点海报（瑞士网格风）。
`docs/project_index.md`：当前结构索引（本文）。
`docs/goal.md`：最终目标。
`docs/curren.md`：当前事实状态。
`docs/idea.md`：原始构思与三层架构草稿（已大部分落地）。

## 协作边界

UI 视觉调整：进入 `src/styles/` 对应分文件。
新增 UI 组件：放入 `src/components/gameui/` 并订阅 EventBus。
渲染层调整：进入 `src/core/motion/` 子模块；`MotionStage` 仅做编排。
摄像头 / MediaPipe：进入 `src/core/WebCamManager.ts`、`src/core/CameraOverlay.ts`、`src/core/PoseLandmarkerManager.ts`。
评分逻辑：进入 `src/core/scoring/` 对应文件；新指标补充到 `jointAngles.ts` / `PoseScorer.ts`。
视频导入：进入 `src/core/import/` 与 `src/components/gameui/ImportDrawer.ts`；MediaPipe 资产升级同步 `public/mediapipe/`。
LLM 集成：`src/core/llm/` 与 `src/components/gameui/AiCoachPanel.ts`；endpoint 配置由 `CameraSettings.ts` 暴露。
后端联调：进入 `src/hooks/useWebSocket.ts` 与 `src/bootstrap/MockStream.ts`。
动作数据修改：进入 `src/data/` 与 `src/mock/`。
DOM id 变化：同步 `src/bootstrap/dom.ts` 与 `index.html`。
类型契约变化：同步 `src/types/motion.ts` 与 README。

## 维护原则

高频帧数据只进 `MotionFrameBuffer`。
低频 UI 更新只走 `EventBus`。
旋转只传 Quaternion，绝不引入 Euler。
空间单位只用米。
摄像头视频镜像，3D 教练画布不镜像。
切换动作必须经 `MotionStage.resetForSeed()` 释放旧资源。
MediaPipe 资源升级走 `public/mediapipe/` + 引用版本号同步，不在运行时再走 CDN。
视觉点缀色仅 `#5C7C9E` 与 `#FF5500`，总占比 < 2%。
关键数字使用等宽字体并 `font-variant-numeric: tabular-nums`。
全局直角，无 `box-shadow` / `text-shadow` / 渐变 / 辉光。
修改后至少运行 `npm run check`。
