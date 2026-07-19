# Current

## 定位

本文描述 KINE//X 的当前事实状态。
不记录开发流水。
用于团队接手、答辩准备和后端联调前对齐。

## 阶段

复赛产品化打磨阶段，多页面骨架已落地。
hash 路由五页：动作库 `#/`、训练舱 `#/train/:seedId`、训练报告 `#/report/:sessionId?`、创作工坊 `#/create`、分身身份库 `#/avatars`。
单 DOM 容器切页，无整页跳转：MediaPipe 资产、WebSocket、摄像头流在页面间存活。
3D 舞台为真实 Three.js WebGL 渲染（圆柱骨骼 + 球关节 + 可选 SMPL-X mesh clip 回放 + 可选 3DGS 数字分身层）。分身身份与动作已拆分为 `KINEXGI1` / `KINEXGM1`，运行时由 `GaussianAvatar` 组合驱动；历史 `KINEXGS1` 仅作内置兼容。
浏览器内 MediaPipe（Pose / Hand / Face）已落地，可独立完成 live 评测。
视频 → CoachClip 导入链路走 SAM 3D Body 后端（:8765），可选 MLLM 分片前置（:8766）。
评分、用户标定、Session 门禁（倒计时 / OK 手势）、结算页、Session 历史存档、AI 教练流式输出已联通。
帧流 WebSocket 客户端已就绪（自动重连 + 心跳），但符合 `FRAME_STREAM` 的真实后端不存在于本仓库。
本地 `npm run dev` 即可完整演示（three 与 MediaPipe 全部本地化，仅 Google Fonts 走 CDN，离线降级系统字体）。

## 信息架构

`src/core/Router.ts`：hash 路由，`parse` 支持 `#/`、`#/train/:seedId`、`#/report/:sessionId?`、`#/create`、`#/avatars`，未知路由回退 `#/`。
页面接口 `{ el, enter?(params), leave?() }`；路由只切 `hidden` 并调生命周期，首次 apply 隐藏其余全部页面。
`TrainPage.enter`：`stage.start()` + 恢复播放 + 路由 seed 同步；`leave`：`stage.stop()` + 暂停播放（摄像头流保持，返回即恢复）。
种子轮播切换 → `router.navigate('#/train/' + id)`；直接访问 `#/train/xxx` → `onSeedRequest` 换种。
左侧 rail 为页面导航（动作库 / 训练舱 / 报告 / 创作 / 分身身份库），active 跟随路由；品牌、rail 底部 LIVE、两个抽屉（DNA / 摄像头设置）、结算模态、boot 保持全局。
boot 完成后进入初始路由，默认 `#/`。
`?backend=` / `?api=` / `?ws=` / `?mode=` 查询参数保持原有行为（启动读取一次）。

## 视觉与交互

页面采用瑞士网格 / 编辑器极简风。
底色 `#e9e4d8` / `#f7f1e5` 暖纸色。
文字与 1px 实线 `#111111` 工业黑。
点缀色仅 `--hot` `#ff4d00`（PERFECT、激活态、警示），3D 应力关节另用 `#ff5500`。
全局直角，无阴影、无渐变、无辉光；Archivo Black 宏排版 + JetBrains Mono 微排版。
语言规则：英文 mono 大写小字为机器声部（结构标签 / 数据字段 / 状态词），中文 Noto Sans SC 为用户声部（操作指引 / 有后果按钮 / 叙事文案）；mono 中出现中文走 `--mono-cjk` 字体栈。
首屏为开机编排：巨型字标 + mono 自检逐行点亮（CoachClip / SMPL-X mesh / MediaPipe / 帧流，全部挂钩真实启动里程碑），退出后各区块交错入场。
动作库：海报式标题 + 种子卡墙（封面缩略图、时长 / 帧数 / 训练场次与最好成绩）+ 导入入口卡 + 最近训练记录条（点击直达对应报告）。
训练舱为左右两舱：左舱「现实镜像」摄像头水平镜像 + 2D 骨骼贴合层；右舱「全息标准舱」由数字分身（真人教练视频）与结构蓝图（Three.js 3D 教练）共享——模式决定主视图（教练模式 = 分身主角、蓝图缩为角标小卡；骨骼 / 应力 / 分身模式 = 蓝图主角、视频缩为小卡），点击小卡即换主视图。
右舱模式行为四键：教练（twin 视频主角）/ 分身（3DGS 数字分身全幅，当 `avatarUrl` 或已就绪的 `identityUrl + motionAssetUrl` 存在时显示）/ 骨骼（线框 + 骨架）/ 应力（蒙皮 + 风险着色）；绑定排队或失败不阻塞普通教练与骨骼模式。
右下 SYNC 巨数区（clamp 72–132px Archivo Black），分数跳变机械闪切；PERFECT 触发全屏描边巨字（描边→填橙）。
两个 bay 四角 crosshair 角标，右舱左下 mono telemetry 数据带（FRAME / PROG / LAT / Δ），顶栏连接指示带实时延迟读数。
全站覆盖低透明度 SVG 噪点纹理（multiply），时间轴缩略图印刷化灰度处理（active/hover 恢复全彩）。
训练报告页：总分巨数 / 印章勋章 / 四宫格统计 / 阶段均分条（最差阶段标橙）/ 历史趋势条（当前场标橙）/ 关节报告表 / AI 教练全文。
创作工坊：四步向导（01 上传 → 02 分片 → 03 解析 → 04 入库），解析前可选择一个 READY 分身身份；默认为“不使用分身”。
分身身份库：服务器持久化档案、照片上传、重命名、保守软删除，以及独立 Three.js 实时预览（拖拽环绕 / 滚轮缩放）。
切页过渡为统一的 pageIn 上浮淡入；控件统一 hover/press 反馈；模态 modalA11y 焦点圈禁 + Esc。

## 数据流

`RealtimeStream` 是帧生产的唯一驱动：自驱 RAF 循环 + `CameraOverlay.onPose` 回调双源 tick，30ms 门限防双泵。
每个 tick：`sampleClip(exercise.clip, progress)` 从当前 CoachClip 取标准姿态，`buildPacket` 组装 `FRAME_STREAM`。
Session 处于 `active` 阶段时，`applyLiveScore` 用 `PoseScorer`（MediaPipe world landmarks + clip seed）的真实结果覆盖 score / combo / metrics。
`useWebSocket.consumePacket → MotionFrameBuffer.pushPacket` 是帧的唯一入口；外部 WS 后端推送的 `FRAME_STREAM` 也走同一路径，与本地帧透明混合。
`MotionFrameBuffer` 仅保留最新一帧。
`MotionStage` 在 RAF 中拉取最新帧渲染 Three.js 场景；节流 ~120ms 向 EventBus 发出 `score:update`。
EventBus 事件共八类：`score:update` / `pipeline:update` / `seed:update` / `camera:update` / `camera:error` / `session:state` / `session:gesture` / `calibration:ready`。
`ScoreBoard` / `Timeline` / `ResultsScreen` / `ComboBurst` / `SessionStartOverlay` / `SessionRecorder` 等订阅事件。
`UserPoseSource` 接 `CameraOverlay.detect()` 的 world landmarks，把最新姿态喂给 `PoseScorer` 与 `CalibrationController`。
高频骨骼帧不进入任何 UI 组件状态。
`SessionGate` 管理 `idle → countdown(3s) → active → finished`；`active` 下 progress 到 1 自动进结算；开始按钮或 OK 手势触发倒计时。
内置种子仅保留 squat（其余已下架；其评分权重以 `MOTION_METRIC_TEMPLATES` 形式保留给导入动作复用）。

## MediaPipe 与离线资产

`LandmarkerController` 封装 `@mediapipe/tasks-vision@0.10.14` 的 Pose / Hand / Face。
模型档位（lite / full / heavy）与三模态开关由 `CameraSettings` 抽屉控制。
`ensureReady(modalities)` 在重活儿前 await WASM + landmarker 初始化；摄像头开启时预热 pose + hand，让手势识别尽快可用。
单调 timestamp 由 `detect()` 内部强制（`max(timestampMs, lastTs + 1)`）。
所有 MediaPipe 运行时资产位于 `public/mediapipe/`：
- `tasks-vision/vision_bundle.mjs`（SDK，134KB）
- `wasm/vision_wasm_internal{,_nosimd}.{js,wasm}`（18MB）
- `models/{pose_landmarker_lite,full,heavy,hand_landmarker,face_landmarker}.task`（5 个模型，约 55MB）
`index.html` importmap 把 `@mediapipe/tasks-vision` 指向本地 mjs；`PoseLandmarkerManager.ts` 的 WASM_BASE 与 5 个模型 URL 全部走 `./public/mediapipe/...`。

## 视频导入链路

创作工坊页（`#/create`）承载视频 → CoachClip / MeshClip 流程，`src/core/import/ImportFlow.ts` 为容器无关的流程控制器：
1. 上传后可先点「用 MLLM 切片」：`VideoSeeker` 每 1.5s 采一个关键帧，`VideoSegmentationClient` POST 到 :8766 `/api/segment`，渲染可选片段（含中段缩略图）。
2. 点「开始解析」：`FormData` 上传视频（选中片段时附 `startSec` / `endSec`）到 :8765 `POST /import/video`。
3. 后端 ffmpeg 抽帧 → SAM 3D Body 逐帧推理 → pack / bake / coach，产出 `coach.json` + `mesh.bin` + 逐帧 jpg；请求同步返回普通动作产物。选了 `avatarId` 时，响应同时带 `motionId / bindingId / bindingStatus`，分身动作在后台继续准备。
4. 前端 `loadCoachClip` + `loadMeshClip` 拉取产物，`onApply` 立即生成 `imported-<jobId>` 新种子并进入训练；`AvatarBindingController` 低频轮询服务器 manifest，只在身份与动作资产都 ready 后解锁“分身”。
5. 页面刷新后 `main.ts hydrateImportedJobs()` 从 `GET /import/jobs` 再水合已导入种子（4s 超时静默放弃）。
6. 旧浏览器端 heavy 模型导入链路（`landmarksToPose.ts` / `postProcess.ts`）已废弃，文件保留但未引用；旧 `ImportDrawer` 已删除，逻辑由 `ImportFlow` 继承。

## 可复用分身链路（3DGS 数字人）

1. `#/avatars` 或兼容端点 `POST /import/avatar` 上传单人全身照；服务端建立稳定 `avatarId`，通过 `GET /avatars` 持久化状态。`seedId` 参数仅兼容接收，不再把身份绑死到种子。
2. 照片经 LHM 导出、坐标对齐与严格校验后生成 `KINEXGI1` 身份；身份只含静态高斯与 55 关节休息骨架，可被多个动作复用。
3. 视频导入选择身份后，原始视频私有副本落在 `~/.local/share/kinex/avatar-jobs`，LHM 后台提取 `KINEXGM1` 动作；`GET /avatar-bindings` 记录 `queued / running / ready / error / cancelled`。
4. 前端分身预览仅加载身份休息姿态；训练舞台把 `KINEXGI1` 与 `KINEXGM1` 组合，通过顶点 shader LBS + CPU 深度排序回放。
5. 删除身份是保守软删除：从活跃身份库移除并取消未完成绑定，已 ready 的训练绑定和动作产物保留可播放。

## 评分与标定

`CalibrationController` 摄像头开启后采 30 帧（~1s @30Hz）稳定站姿（双臂自然下垂，Y 峰谷偏差 < 0.05m），推导骨长 + Y 参考，写入 `localStorage`。
`UserProfileStore` 提供 `get` / `set` / `clear`，`CameraSettings` 抽屉有 "重新校准" 入口；可跳过标定（记录 `kinex.calibrationSkipped.v1`）。
`PoseScorer` 用标定后的骨长把 MediaPipe world landmarks 还原到米制，计算关节角度（`JOINT_ANGLES`）与 3D 距离差，加权综合到帧分；超出 ±35% 骨长偏差直接判风险。
关节角度差与关节偏移为真实测量值（逐 metric 聚合写入 `angleDeltaDeg` / `distanceDeltaCm`），不再从分数派生。
`CoachHistory` 维护教练姿态滑窗（应对评委反应延迟），评委当前帧与最近 N 帧 seed 取最优。
实时评分仅在 Session `active` 阶段进行；其余时间 metrics 展示种子基准值（Standby）。

## Session 总结、存档与 AI 教练

`SessionRecorder` 监听 `score:update`，按 progress 把帧分桶到 `intro / mid / peak / outro` 四阶段；累计 per-joint 平均分、最差分、风险触发次数；`seed:update` 时重置。
结算模态 `ResultsScreen` 展示 count-up 总分、勋章、四宫格与关节报告表，百分位按本机历史场次真实计算（无历史时显示"—"），并在 `open()` 时把整场（含 `SessionSummary`）写入 `SessionArchive`；idle 状态结算按钮被门禁拦截。
`SessionArchive`（`localStorage` key `kinex.sessions.v1`，最多 20 场）驱动报告页与动作库统计（场次 / 最好成绩 / 最近训练）。
结算模态的「查看完整报告」跳 `#/report`（缺省显示最近一场，支持 `#/report/:id` 深链）。
报告页 AI 教练复用 `AiCoachPanel` 第二实例，按存档的 `SessionSummary` 重新流式诊断，结果按 session id 内存缓存。
`AiCoachPanel` + `core/llm/LLMClient.streamChat`：POST 到 :8766 `/api/chat-stream`（OpenAI 兼容 SSE 透传），`renderMarkdown` 安全渲染为 HTML。
LLM 凭据由 `server/.env` 托管（`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`），浏览器不再保存 API Key；诊断 persona（运动生物力学专家 / 八段锦传人）由 CameraSettings 抽屉选择。

## 约束契约

空间坐标单位是米。
坐标系右手系，Y 上、X 右、Z 朝屏幕外。
摄像头视频走 CSS `transform: scaleX(-1)`。
3D 教练画布不镜像。
旋转使用 `QuaternionTuple` 在线传输，运行时升级为真实 THREE 四元数实例。
旋转平滑使用 `slerp(target, 0.4)`。
源码禁止出现 `Euler`、`useState`、`ref(`。
3D 舞台为 Three.js WebGL 渲染；`three-compat.ts` 是对真实 `three` 的门面 re-export，importmap 指向本地 `public/three/three.module.min.js`（r160，670KB），不再依赖 CDN。
摄像头舱内 2D 骨骼贴合层由 `CameraOverlay` 在 Canvas 2D 上绘制。
MediaPipe 资产走本地 `public/mediapipe/`；仅 Google Fonts 仍走 CDN（离线降级系统字体）。

## 资源生命周期

首屏由 `BootSequence` 驱动：真实里程碑（clip / mesh / MediaPipe 探测 / 帧流）逐行点亮，全部就绪或点击跳过或 9s 兜底后退出，进入初始路由。
页面切换只切 `hidden`：`TrainPage.leave` 停 stage RAF 与播放，`enter` 恢复；landmarker、WebSocket、摄像头流不重建。
`MotionStage.preload()` 仅保留 stage bay 的 loading 节奏（旧的 gltf 预加载已移除；`assets/smpl-lite-rig.gltf` 为未被引用的占位文件）。
切换种子调用 `MotionStage.resetForSeed()`：依次 `disposeSceneResources()`、`createSceneResources()`、重建骨骼网格。
`setMeshClip` / `clearMeshClip` 负责 SMPL-X 实体 mesh 与线框 mesh 的挂载和 `geometry/material.dispose()`。
`ThreeResourceTracker` 管理 geometry / material disposal。
MediaPipe landmarker 在模型档位或模态切换时 `close()` 旧实例后异步重建。
`SessionRecorder` 在 `seed:update` 时 `reset()`。
`AiCoachPanel` 持有 `AbortController`，关闭面板 / 重置 / 新生成 / 离开报告页都会 `abort()`。
WebGL 不可用时 `MotionStage` 构造器捕获异常并优雅降级（3D 舞台离线，摄像头舱与评分 UI 继续工作）。
MediaPipe WASM / 模型初始化失败走 `camera:error` UI 提示，3s 节流自动重试，`resetRetries()` 支持手动立即重试。

## 反馈系统

PERFECT 阈值 score ≥ 80。
触发时屏幕中心硬边显示 `--hot` 橙实色块 + 白色 mono `PERFECT` 字样 + 全屏描边巨字（描边→填橙 620ms），附满屏一道横向扫光；节流 600ms。
Combo 升档触发 `COMBO ×NN` 黑底白字硬边方块出现 / 消失；节流 1000ms。
风险关节用 `#FF5500` 实色圆 + 短虚线指示，配白底黑边 mono `WARN` 标签。
WebAudio 合成 PERFECT 三泛音、Combo 升档锯齿、种子激活四音和弦、播放期低 BPM kick（节奏随 speed）。
首次手势后激活 AudioContext。
结算页与报告页 AI 教练面板提供长文本流式反馈，可换 persona（默认运动生物力学专家）。

## 检查机制

`scripts/build.mjs` 只做 TypeScript 类型擦除（Node `stripTypeScriptTypes`）。
`scripts/guardrails.mjs` 检查必需字符串：`unit: "meters"`、`handedness: "right-hand"`、`scaleX(-1)`、`requestAnimationFrame`、`.slerp(`、`disposeSceneResources(`、`pushPacket(packet`。
guardrails 禁止 `Euler` / `useState` / `ref(`。
guardrails 对 `dist/**/*.js` 做语法检查。
`tsc --noEmit` 目前 11 个已知诊断（`noUncheckedIndexedAccess` 严格性），仅作开发参考，未入门禁。
`npm run check` 是唯一发布门禁。

## 后端边界

帧流 WS 客户端已就绪（`useWebSocket`：自动重连退避 1s→30s、PING/PONG 心跳 15s/8s 超时、点击连接指示手动重连），默认 `ws://localhost:8000/motion`，`?ws=` 覆盖；但真实帧流后端不在本仓库。
外部帧与本地帧共用 `consumePacket → pushPacket`；前端 MediaPipe / Scoring 链路保留为后端不可用时的离线方案。
LLM 一律经 `server/` 代理（:8766）；`API_BASE_URL` 可用 `?api=` 覆盖并持久化到 localStorage。
导入后端（:8765）`BACKEND_URL` 可用 `?backend=` 覆盖并持久化到 localStorage；`POST /import/video` 返回普通 CoachClip / MeshClip，可选同时建立分身绑定。身份源于 `GET|POST /avatars`，重命名/软删除用 `PATCH|DELETE /avatars/{id}`，绑定用 `GET|POST /avatar-bindings`；`POST /import/avatar` 仅是身份上传兼容别名。
Session 历史存于浏览器 localStorage（`kinex.sessions.v1`），不上送后端。
内置种子只保留 squat（绑定真实 CoachClip `single_leg_squat.json`，118 帧）；deadlift / baduanjin / street / basketball 已下架，评分权重保留在 `MOTION_METRIC_TEMPLATES` 供导入动作复用。
所有坐标必须米制，所有旋转必须 `[x, y, z, w]`。

## 风险

Google Fonts 走 CDN，离线时降级到系统等宽 / 系统黑体（three 与 MediaPipe 已本地化，无此风险）。
`public/coach_clips/single_leg_squat_frames` 是指向原开发机的绝对符号链接，换机后原始缩略图 404；`main.ts healTimelineThumbnails()` 会探测首帧失败并从内存 mesh clip 重新渲染缩略图（自愈），原帧找回后自动优先使用。
`MockStream` / `mockFrameSource` / `landmarksToPose` / `postProcess` 为未引用遗留代码，误引用会开历史倒车。
后端如传 Euler 或非米制坐标，骨架会错位。
UI 若直接订阅高频帧，页面会卡顿。
切换动作如果绕过 `resetForSeed()`，长时间演示存在内存泄露隐患。
`public/mediapipe/` 约 73MB，仓库 clone 体积偏大；升级 SDK 版本时需手工替换并 bump `WASM_BASE` / 模型路径相关常量。
导入后端 `POST /import/video` 的 SAM 推理在 worker thread 中执行，但 HTTP 请求仍需等普通动作产物完成后才返回；LHM 绑定另行异步。`config.py` 的 SAM / LHM 默认路径面向开发主机，换机时必须用同名环境变量覆盖。
分身资产以文件系统 manifest 为真源；部署不得使用会删除 `public/coach_clips/avatar-identities`、`motions`、`avatar-bindings` 或私有 `~/.local/share/kinex/avatar-jobs` 的镜像同步。
LLM 上游报错会被代理吞成静默错误帧，前端表现为 AI 教练空回复、无报错 UI。
`tsc` 诊断未清零，strict 报错积累会掩盖新引入的类型错误。

## 下一步优先级

打磨工作清单以 `docs/review.md` 为准（含评审维度对照、P0 防穿帮、P1 涨分点、P2 锦上添花与答辩叙事）。长期项：

清理遗留：删除或归档 `MockStream` / `mockFrameSource` / `landmarksToPose` / `postProcess` / `smpl-lite-rig.gltf`；找回或替换 `single_leg_squat_frames` 原始帧图。
`tsc --noEmit` 清零（当前 11 个）后纳入 `npm run check` 门禁。
接入生产级 WebSocket 帧流服务；将 `MotionFrame` 固化为 OpenAPI / JSON Schema 文档。
视频导入改为真正的 202 任务队列 + 断点恢复；为 SAM / LHM 加健康分层、队列观测与超时重试策略。
报告页阶段曲线（帧级分）与多 session 趋势分析；动作库搜索 / 分组。
VFR / UGC 视频逐物理帧处理、断线低帧率兜底、答辩脚本。
可选：Google Fonts 本地化（JetBrains Mono / Archivo Black → `public/fonts/`）。

## 判断

项目具备复赛演示能力：完整产品骨架（库 / 练 / 报告 / 创作 / 分身身份库），完全离线可用（字体降级无碍）。
项目具备与后端合体的稳定数据边界。
3D 渲染、MediaPipe、评分、标定、Session 门禁与存档、AI 教练、视频导入均已上真，不再纯 mock。
照片 → 可复用身份 × 视频动作 → 浏览器实时 3DGS 数字分身全链路已通；2026-07-19 远端验收实测了持久化身份库、拖拽/缩放预览、普通导入先返回、后台 LHM 绑定就绪、训练回放、WebM 导出与软删除后已完成训练保留。随后的尺度回归使用全新 470 帧 `KINEXGM1` 确认了固定米制 `scale=1.0`；前视、侧视、全程播放和拖拽/缩放后均保持完整人体轮廓，并生成 849066 字节 WebM。
帧流 WebSocket 客户端就绪，真实后端缺席。
当前最重要的原则是帧数据隔离、渲染层独立、数据契约稳定与视觉规范严格执行。
