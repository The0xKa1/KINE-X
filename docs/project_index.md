# Project Index

## 定位

KINE//X 的项目结构索引。
不记录开发流水。
只保留稳定结构和维护规则。

## 根目录

`index.html`：浏览器入口，加载 `src/styles.css` 与构建后的 `dist/main.js`；含 boot overlay、五个页面容器（`#page-library` / `#page-train` / `#page-report` / `#page-create` / `#page-avatars`）、两个全局抽屉与两个模态；importmap 把 `@mediapipe/tasks-vision` 映射到 `public/mediapipe/`，把 `three` 映射到 `public/three/`。
`package.json`：本地命令入口（build / dev / check / server:install / server）。
`tsconfig.json`：TypeScript 诊断配置（`noEmit: true`），不负责构建输出。
`README.md`：使用说明、模块清单、数据契约。
`CLAUDE.md` / `AGENTS.md`：面向代码助手的工程约束说明（内容一致，修改时保持同步）。
`.env.example`：LLM 代理（server/）的环境变量模板。
`assets/`：历史演示资源；`smpl-lite-rig.gltf` 为未被代码引用的占位文件。
`public/`：离线运行时资产。`public/mediapipe/`（约 73MB）、`public/three/`（r160 min，670KB）、`public/coach_clips/`（内置 clip、SMPL-X mesh、导入产物 `jobs/`）。
`docs/`：项目文档与海报参考。
`scripts/`：构建、守卫与调试脚本。
`src/`：TypeScript / CSS 源码。
`dist/`：构建产物，不手工修改。
`backend/`：SAM 3D Body 视频导入 + Avatar Vault 身份/动作/绑定服务（FastAPI，:8765）。
`server/`：LLM 代理服务（FastAPI，:8766）。
`sam_3d_body/`：SAM / SMPL-X 转换与导出的一次性 CLI 脚本（backend 不 import 它们）。

## 常用命令

`npm run build`：将 `src/**/*.ts` 类型擦除为 `dist/**/*.js`（Node 内置 `stripTypeScriptTypes`，无打包）。
`npm run dev`：构建并启动 `5173` 静态服务。
`npm run check`：构建并跑 `scripts/guardrails.mjs`，是唯一发布门禁。
`npm run server:install` / `npm run server`：安装并启动 LLM 代理（:8766，需 `.env`）。
源码 `import` 必须使用 `.js` 后缀，浏览器在 `dist/` 解析模块。
项目零 `dependencies`；three 与 MediaPipe 均走本地 `public/`，仅 Google Fonts 走 CDN。
`npx tsc --noEmit` 仅作参考，目前 11 个已知诊断，未入门禁。

## 信息架构（hash 路由）

`src/core/Router.ts`：`#/` 动作库、`#/train/:seedId` 训练舱、`#/report/:sessionId?` 报告、`#/create` 创作、`#/avatars` 分身身份库；未知路由回退 `#/`。
页面是同一 DOM 中的容器（`hidden` 切换 + `enter/leave` 生命周期），**不做整页跳转**——MediaPipe、WebSocket、摄像头流在页面间存活。
`src/components/pages/LibraryPage.ts`：种子卡墙（封面 / 场次 / 最好成绩）+ 导入入口 + 最近训练条。
`src/components/pages/TrainPage.ts`：训练舱生命周期封装（enter 恢复渲染与播放、leave 停 stage RAF 与播放、路由 seed 同步）。
`src/components/pages/ReportPage.ts`：存档 session 的整页报告（总分 / 勋章 / 阶段条 / 趋势条 / 关节表 / AI 教练）。
`src/components/pages/CreatePage.ts`：视频 → 虚拟教练四步向导，驱动 `ImportFlow`；解析前通过 `AvatarRegistryClient` 显示可选的 READY 身份。
`src/components/pages/AvatarVaultPage.ts`：服务器身份档案库；上传、重命名、保守软删除、持久化列表与独立 3DGS 实时预览。

## src 总览

`src/main.ts`：组合根；装配 EventBus、帧缓存、Stage、RealtimeStream、SessionGate、Router 与五个页面、全部 UI 组件、MediaPipe、Calibration、Scoring、SessionRecorder / SessionArchive、AI Coach；启动时驱动 BootSequence、水合 clip / mesh / 导入 jobs，并从服务器 manifest 发现和恢复分身绑定。
`src/config.ts`：`API_BASE_URL` 解析（`?api=` → localStorage → 当前 host :8766）。
`src/types/`：前后端数据契约类型 + 手写三方库声明。
`src/core/`：路由、渲染、帧流、会话门禁、摄像头、MediaPipe、评分、导入、LLM / MLLM 客户端、资源生命周期。
`src/components/`：UI 组件（layout / gameui / pages）。
`src/bootstrap/`：主入口辅助层（DOM 收集、装配小工具、遗留 mock）。
`src/hooks/`：外部数据流入口。
`src/mock/`：遗留 mock 帧生成器（未引用）。
`src/data/`：动作种子与 pipeline 配置。
`src/styles/`：分层 CSS，`src/styles.css` 是 `@import` 入口。

## bootstrap

`bootstrap/dom.ts`：`$` / `$$` 选择器与 `collectDomRefs()`，集中管理所有页面元素引用。
`bootstrap/uiHelpers.ts`：`ConnectionIndicator`、`renderDnaList`、`beatsPerMinute` 等装配期小工具。
`bootstrap/MockStream.ts`：**遗留死代码**（pre-CoachClip mock 路径），无任何引用；帧生产已由 `RealtimeStream` 接管。

## components/layout

`AppShell.ts`：静态外壳装配——视角切换、播放 / 速度 / 时间轴控件、摄像头开关与控件锁定（Session active 时）；rail 页面导航由 Router 直驱。

## components/gameui

`BootSequence.ts`：开机编排 overlay；真实里程碑逐行点亮，点击跳过或 9s 兜底，退出后进入初始路由。
`CoachVideo.ts`：数字分身视频层；按种子的 `coachVideo`（front/side/top 多角度源）管理播放源并与 RealtimeStream 的 progress / speed / playing 状态同步；主视图 / 缩略小卡的布局由 stage 的 `data-primary` 与模式联动（点击小卡换主视图）。
`SeedCarousel.ts`：种子卡片轮播 + 模式分段控件（`prefers-reduced-motion` 感知；新种子交错入场）。
`ScoreBoard.ts`：score / combo / risk / joint metrics / pipeline 渲染（写入抽屉内 DOM）；分数跳变触发巨数区机械闪切。
`Timeline.ts`：clip 帧节奏条；缩略图一帧一格，flex 横向滚动，当前帧自动 `scrollIntoView`；无 clip 时回退 18 帧 mock。
`ComboBurst.ts`：监听 `score:update` 触发 PERFECT（≥80，节流 600ms，含全屏描边巨字）与 Combo（节流 1000ms）视觉特效 + WebAudio 音效。
`SessionStartOverlay.ts`：Session 门禁 UI——开始按钮、3s 倒计时、OK 手势进度条。
`CalibrationOverlay.ts`：用户标定流程的全屏遮罩与进度（站直采样 / 跳过 / 重做）。
`ResultsScreen.ts`：结算模态（count-up、印章勋章、四宫格、关节报告表、跳完整报告）；`open()` 时把整场写入 `SessionArchive`；modalA11y 焦点圈禁。
`DnaExport.ts`：用 `canvas.captureStream(30)` + `MediaRecorder` 录制真实 4 秒 WebM，生成 blob 预览与下载链接。
`DnaDrawer.ts`：右侧 DNA 抽屉（注册进 DrawerStack）。
`CameraSettings.ts`：摄像头 + MediaPipe 设置抽屉（设备、分辨率、画面适配、镜像、安全区、模型档位、模态开关、重新校准、AI persona）。
`AiCoachPanel.ts`：流式 AI 教练文本面板（结算模态与报告页各一个实例）。

## core

`core/Router.ts`：hash 路由；页面显隐 + `enter/leave` 生命周期；首次 apply 隐藏其余页面。
`core/MotionStage.ts`：动作舞台编排器；Three.js WebGLRenderer + 圆柱骨骼 / 球关节 + 可选 SMPL-X 实体 / 线框回放；视角切换阻尼飞行、无交互 idle 摆动、stress 关节脉冲；mesh 模式骨骼向骨盆轴线收缩（0.72）避免与包络相缠；拥有 RAF 主循环、`slerp` 平滑、`disposeSceneResources` 调度、UI 节流发射。
`core/RealtimeStream.ts`：帧生产驱动；自驱 RAF + 摄像头姿态双源 tick（30ms 门限），按 progress 从 CoachClip 采样组装 `FRAME_STREAM`，active 阶段接入实时评分，progress 到 1 自动结算。
`core/SessionGate.ts`：Session 生命周期 `idle → countdown(3s) → active → finished`。
`core/OkGestureDetector.ts`：OK 手势识别（拇指食指捏合 + 其余三指伸展，保持 0.6s 触发，3s 冷却）。
`core/frameBuffer.ts`：高频帧缓存；`pushPacket(packet)` 是唯一写入点；只保存最新 `RuntimeFrame`。
`core/EventBus.ts`：低频 UI 事件总线（score / pipeline / seed / camera / camera:error / session:state / session:gesture / calibration:ready）。
`core/coordinates.ts`：单位与坐标契约（米、右手系、Y up、X right、Z out-of-screen）。
`core/three-compat.ts`：对真实 `three`（importmap → 本地 `public/three/`）的门面 re-export，统一 `THREE` 入口与四元数工具。
`core/CameraOverlay.ts`：摄像头舱内 2D 骨骼贴合渲染（Canvas 2D）、安全区线框、MediaPipe 多模态 overlay。
`core/WebCamManager.ts`：摄像头权限 / 流 / 镜像 / 错误分类上报。
`core/PoseLandmarkerManager.ts`：`LandmarkerController` MediaPipe 封装；三个 landmarker、模型档位切换、单调时间戳、`ensureReady()`、`LandmarkSmoother` 平滑。
`core/AudioFx.ts`：WebAudio 合成器（PERFECT 叮、Combo 升档、种子激活、低 BPM kick / BGM）。
`core/ThreeResourceTracker.ts`：资源释放与场景重建。
`core/DrawerStack.ts`：抽屉栈单例；互斥开启、backdrop 点击 / Esc 关闭。
`core/modalA11y.ts`：模态焦点圈禁 + Esc（ResultsScreen / DnaExport 使用）。
`core/motionPrefs.ts`：`prefers-reduced-motion` 媒体查询助手。
`core/motion/skeleton.ts`：骨骼连接表与风险关节映射（纯数据）。
`core/motion/StageInteractions.ts`：canvas 拖拽、滚轮缩放、双击复位的指针交互；记录 `lastInputAt` 供舞台 idle 摆动。

### core/avatar

`AvatarAssets.ts`：`KINEXGI1` / `KINEXGM1` / 历史 `KINEXGS1` 二进制解析与校验；四元数 FK、休息骨架皮肤矩阵和 stage similarity 只应用一次。
`GaussianAvatar.ts`：高斯分身渲染器；可分别加载身份与 `GaussianMotion`，顶点 shader 做 top-4 LBS，CPU 做深度排序。
`AvatarRegistryClient.ts`：`/avatars` CRUD 与低频 watch；明确区分服务离线、HTTP 失败和本地重命名草稿。
`AvatarBindingController.ts`：按 seed 保存绑定快照，轮询 `/avatar-bindings`，对排队/运行/就绪/失败做非阻塞呈现，并能从服务器 motionId 重建 localStorage 丢失的绑定。

### core/scoring

`PoseScorer.ts`：核心评分器（`applyLiveScore`）；骨长还原米制、关节角度误差与 3D 距离误差加权综合；riskLabel 输出中文（对齐良好 / 注意xx / 风险xx）。
`CoachHistory.ts`：教练帧滑窗（黑客松抗延迟）。
`CalibrationController.ts`：站姿标定，采 30 帧（~1s）稳定帧推导骨长 + Y 参考。
`UserProfile.ts`：标定结果的 `localStorage` 持久化（`UserProfileStore`）。
`UserPoseSource.ts`：MediaPipe world landmarks → `PoseScorer` / `CalibrationController` 的桥。
`LandmarkSmoother.ts` / `OneEuroFilter.ts`：landmark 平滑。
`SessionRecorder.ts`：监听 `score:update`，累计 per-joint 统计与阶段（intro/mid/peak/outro）均分，结算页消费。
`SessionArchive.ts`：已结算 session 的 `localStorage` 存档（`kinex.sessions.v1`，最多 20 场）；报告页与动作库统计的数据源。
`normalize.ts` / `jointAngles.ts` / `boneTable.ts`：landmark 归一化、关节角度定义、骨骼锚点表。

### core/import

`ImportFlow.ts`：容器无关的视频 → CoachClip 流程控制器（文件、MLLM 分片、上传 :8765、产物水合、状态回调）；由 CreatePage 驱动。
`AvatarImportFlow.ts`：历史照片分身入口的兼容控制器；新产品入口为 `#/avatars`，不再把身份附着到固定 seed。
`VideoSeeker.ts`：本地视频挂隐藏 `<video>`；`load()`、`probeFps()`、`iterate/iterateRange` 逐帧 seek。用于 MLLM 采样与片段缩略图。
`loadCoachClip.ts`：内置 clip 清单（`COACH_CLIP_MANIFEST`）、`loadCoachClip` fetch + 校验、`buildFrameThumbnails(FromMeta)` 等距缩略图 URL。
`MeshClip.ts`：`loadMeshClip`、`buildMeshPrimitive`、`copyFrameVerticesInto`、`sampleFrameIndex`。
`renderMeshThumbs.ts`：离屏渲染 mesh clip 等距姿态为 dataURL 缩略图；原始帧图缺失时由 `main.ts healTimelineThumbnails()` 自愈时间轴。
`CoachClip.ts`：clip 关节插值工具（`sampleClip` / `lerpPose`）。
`landmarksToPose.ts` / `postProcess.ts`：**遗留死代码**（旧浏览器端导入管线），未引用。

### core/llm

`LLMClient.ts`：`streamChat(settings, messages, onDelta)`；POST 到 :8766 `/api/chat-stream`，逐行解析 SSE。
`buildPrompt.ts`：`SessionSummary` → 系统 + 用户提示词；含本地兜底文案 `buildFallbackText`。
`renderMarkdown.ts`：极简安全 markdown → HTML 渲染器。

### core/mllm

`VideoSegmentationClient.ts`：MLLM 视频分片客户端；`sampleFramesAtInterval` 抽帧，POST 到 :8766 `/api/segment`。
`SegmentResourceStore.ts`：分片结果内存 store。

## styles

`src/styles.css`：仅含 `@import` 入口（22 个分文件）。
`styles/tokens.css`：颜色、字体、`--hairline`、`--slant`、`--mono-cjk` 等变量。
`styles/base.css`：reset、`app-shell`、`workspace` 网格、全局噪点纹理层。
`styles/controls.css`：按钮、range、toggle、segmented、status / risk badge（统一 hover/press/disabled）。
`styles/rail.css`：左侧导航（页面切换，active 跟随路由）。
`styles/topbar.css`：顶栏、海报式标题、连接指示延迟读数。
`styles/seed-strip.css`：种子卡片轮播（含入场动画）。
`styles/bay.css`：左右双舱舞台、loading mask、playbar、镜像视频与色彩滤镜。
`styles/hud.css`：HUD chip、分数面板、telemetry 数据带。
`styles/fx.css`：PERFECT / Combo / 全屏描边巨字 / 扫光 / 分数闪切关键帧。
`styles/drawer.css`：DNA / 摄像头设置抽屉、metric / pipeline 行、风险态、import/segment 通用样式（创作工坊复用）。
`styles/timeline.css`：时间轴横向滚动（缩略图印刷化灰度）。
`styles/results.css`：结算页四宫格 + 关节报告表 + AI 教练面板。
`styles/dna-export.css`：二维码导出弹窗。
`styles/responsive.css`：媒体查询。
`styles/c3-surfaces.css` / `styles/c3-workspace.css`：c3 视觉迭代表面 / 工作区覆盖层（含 bay crosshair 角标）。
`styles/boot.css`：开机编排 overlay 与首屏交错入场。
`styles/pages.css`：页面容器显隐与切页过渡。
`styles/library.css` / `styles/report.css` / `styles/create.css` / `styles/avatar-vault.css`：页面专用样式；身份库预览舞台使用显式尺寸隔离 canvas 内在尺寸，避免网格高度反馈循环。

## data mock hooks types

`data/exercises.ts`：内置动作种子（仅 squat，经 manifest 绑定真实 clip）+ `MOTION_METRIC_TEMPLATES`（五类评分模板，源自已下架种子）与推理管线配置。
`mock/mockFrameSource.ts`：**遗留死代码**，仅被同样遗留的 `bootstrap/MockStream.ts` 引用。
`hooks/useWebSocket.ts`：WebSocket 客户端；重连退避、PING/PONG 心跳；本地帧与远端帧共用 `consumePacket → buffer.pushPacket`；默认 `ws://localhost:8000/motion`，`?ws=` 覆盖。
`types/motion.ts`：核心类型契约（`MotionFrame` / `QuaternionTuple` / `JointName` / `RuntimeFrame` / `ScoreUpdate` / `CoachClip` / `SkeletonPose`…）。
`types/three.d.ts`：手写 three 声明（随用法扩充，非完整 API）。
`types/mediapipe.d.ts`：MediaPipe 相关声明。

## public

`public/mediapipe/`：`tasks-vision` SDK + WASM + 5 个 `.task` 模型，版本固定 0.10.14；升级时整体替换并改 `PoseLandmarkerManager.ts` 与 `index.html` 的引用。
`public/three/`：`three.module.min.js`（r160，unpkg 官方 min build）；升级时整体替换。
`public/coach_clips/`：内置 clip / mesh、导入产物 `jobs/`、身份 `avatar-identities/`、动作 `motions/`、绑定 manifest `avatar-bindings/`。`single_leg_squat_frames` 为死符号链接，缩略图由 `healTimelineThumbnails` 自愈。

## scripts

`scripts/build.mjs`：构建脚本，仅做类型擦除，不打包。
`scripts/guardrails.mjs`：守卫检查（必需 / 禁用字符串 + `node --check`）。
`scripts/shot.mjs`：CDP 无头截图工具（调试 / 视觉验收用）。
`scripts/migrate-legacy-avatar.py`：把历史 `KINEXGS1` 只读源拆成可复用身份/动作和 manifest；支持全量 dry-run、原子发布、幂等复跑与显式 `--replace`。

## backend

`backend/app.py`：FastAPI 路由与组合根；视频导入、身份 CRUD、绑定创建/查询和后台任务状态协调。
`backend/avatar.py`：照片校验、LHM 导出、坐标对齐和身份资产发布。
`backend/avatar_assets.py`：`KINEXGI1` / `KINEXGM1` codec，历史 combined asset 拆分、旋转/四元数验证与原子写入。
`backend/avatar_registry.py`：文件系统 manifest 真源；稳定 id、幂等 identity×motion 绑定、软删除和原子 JSON replace。
`backend/avatar_motion.py`：视频 → LHM SMPL-X 局部旋转，基于 CoachClip root 轨迹拟合 stage similarity，打包独立动作。
`backend/config.py`：SAM / LHM / 注册表 / 私有源视频路径与超时环境变量。
`backend/test_avatar_{api,assets,binding,registry}.py`：分身服务的回归门禁。

## docs

`docs/Constraint.md`：工程与数据流硬约束。
`docs/design.png`：视觉锚点海报（瑞士网格风）。
`docs/project_index.md`：当前结构索引（本文）。
`docs/goal.md`：最终目标。
`docs/curren.md`：当前事实状态。
`docs/review.md`：复赛评审报告与打磨工作清单（P0/P1/P2 + 答辩叙事）。
`docs/motion-frame.schema.json`：`FRAME_STREAM` 数据包的 JSON Schema。
`docs/server-workflow.md`：AutoDL 服务器开发与演示 Cheatsheet。
`docs/handoff.md`：交接文档（资产地图、环境、断点、坑位备忘）。
`docs/idea.md`：原始构思与三层架构草稿（历史文档）。
`docs/demo/`：README 内联的演示 GIF 与完整 mp4。

## 协作边界

UI 视觉调整：进入 `src/styles/` 对应分文件（boot/pages/library/report/create 最后引入）。
新增页面：`src/components/pages/`，注册进 `main.ts` 的 Router，DOM 容器加进 `index.html`，样式新建 `styles/<page>.css`。
新增 UI 组件（页面内局部）：放入 `src/components/gameui/` 并订阅 EventBus。
渲染层调整：`src/core/MotionStage.ts` 与 `src/core/motion/`。
摄像头 / MediaPipe：`src/core/WebCamManager.ts`、`src/core/CameraOverlay.ts`、`src/core/PoseLandmarkerManager.ts`。
评分逻辑：`src/core/scoring/`；新指标补到 `jointAngles.ts` / `PoseScorer.ts`。
视频导入：`src/components/pages/CreatePage.ts`、`src/core/import/ImportFlow.ts` 与 `backend/`；MLLM 分片进 `src/core/mllm/` 与 `server/main.py`。
分身身份/动作/绑定：`src/components/pages/AvatarVaultPage.ts`、`src/core/avatar/`、`backend/avatar*.py` 与 `public/coach_clips/{avatar-identities,motions,avatar-bindings}`；私有上传视频不得进 `public/`。
LLM 集成：`src/core/llm/` 与 `src/components/gameui/AiCoachPanel.ts`；凭据在 `server/.env`。
后端联调：`src/hooks/useWebSocket.ts` 与 `src/core/RealtimeStream.ts`。
动作数据修改：`src/data/`。
DOM id 变化：同步 `src/bootstrap/dom.ts` 与 `index.html`。
类型契约变化：同步 `src/types/motion.ts` 与 README。

## 维护原则

高频帧数据只进 `MotionFrameBuffer`。
低频 UI 更新只走 `EventBus`。
页面切换只切 `hidden`（单 DOM hash 路由），不做整页跳转。
旋转只传 Quaternion，绝不引入 Euler。
空间单位只用米。
摄像头视频镜像，3D 教练画布不镜像。
切换动作必须经 `MotionStage.resetForSeed()` 释放旧资源。
MediaPipe 与 three 资产升级走 `public/` 整体替换 + 引用版本号同步；Google Fonts 走 CDN（本地化可选）。
视觉点缀色仅 `--hot` `#ff4d00`（3D 应力关节另用 `#ff5500`），总占比 < 2%。
关键数字使用等宽字体并 `font-variant-numeric: tabular-nums`。
语言规则：英文 mono 大写小字为机器声部，中文 Noto Sans SC 为用户声部；mono 上下文中的中文用 `--mono-cjk`。
全局直角，无 `box-shadow` / `text-shadow` / 渐变 / 辉光；FX 动效保留 `steps()` 机械感签名。
遗留死代码（MockStream / mockFrameSource / landmarksToPose / postProcess）不引用、不扩散。
修改后至少运行 `npm run check`。
