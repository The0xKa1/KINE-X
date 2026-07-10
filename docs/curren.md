# Current

## 定位

本文描述 KINE//X 的当前事实状态。
不记录开发流水。
用于团队接手、答辩准备和后端联调前对齐。

## 阶段

前端原型阶段，模型 / 推理已部分上真。
浏览器内 MediaPipe（Pose / Hand / Face）已落地，可独立完成 live 评测。
视频 → CoachClip 导入链路已可用，逐帧 BlazePose Heavy 推理 + 时序平滑。
评分、用户标定、Session 总结、AI 教练流式输出已联通。
后端帧流（FastAPI WebSocket）尚未接入，仍由 `MockStream` 兜底。
本地 `npm run dev` 即可完整演示（含离线模型资产）。

## 视觉与交互

页面采用瑞士网格 / 编辑器极简风。
底色 `#F4F4F2` 暖白。
文字与 1px 实线 `#111111` 工业黑。
点缀色仅 `#5C7C9E`（PERFECT、安全态）和 `#FF5500`（WARNING、风险关节）。
全局直角，无阴影、无渐变、无辉光。
关键数字使用 JetBrains Mono 等宽字体。

页面主体为左右双舱。
左舱「现实镜像」：摄像头视频水平镜像 + 黑色 2D 骨骼贴合层 + MediaPipe Pose / Hand / Face 实时 overlay。
右舱「全息标准舱」：黑色细线 3D 影子教练，可拖拽旋转 yaw、滚轮缩放、双击复位。
顶栏含 hol[ō]motion 海报式标题与等宽副标题。
种子区是横向卡片轮播，激活卡反白。
右上 DNA 按钮 / 摄像头设置 / Import 按钮分别唤出不同抽屉。
底部时间轴：未导入 clip 时显示 18 帧 mock 占位；导入 clip 后渲染逐帧缩略图，flex 横向滚动并自动定位当前帧。
结算页与 DNA 二创二维码导出弹窗为模态。
结算页含 AI 教练面板，可流式输出针对本次 Session 的中文点评。

## 数据流

`mockFrameSource.ts` 生成 `FRAME_STREAM`（未接入摄像头或后端时的 mock 路径）。
`bootstrap/MockStream.ts` 是 mock 与真实评分之间的开关：摄像头开启后，每帧改由 `PoseScorer` 用 MediaPipe world landmarks + clip seed 计算。
`useWebSocket.ts` 提供统一帧消费入口（mock 与真实后端共用 `consumePacket → buffer.pushPacket`）。
`MotionFrameBuffer` 仅保留最新一帧。
`MotionStage` 在 RAF 中拉取最新帧并绘制；节流 ~120ms 向 EventBus 发出 `score:update`。
`EventBus` 承载 `score:update` / `pipeline:update` / `seed:update` / `camera:update` 四类低频事件。
`ScoreBoard` / `Timeline` / `ResultsScreen` / `ComboBurst` / `CoachingTip` / `SessionRecorder` 订阅事件。
`UserPoseSource` 接 `CameraOverlay.detect()` 的 world landmarks，把最新姿态喂给 `PoseScorer` 与 `CalibrationController`。
高频骨骼帧不进入任何 UI 组件状态。

## MediaPipe 与离线资产

`LandmarkerController` 封装 `@mediapipe/tasks-vision@0.10.14` 的 Pose / Hand / Face。
模型档位（lite / full / heavy）与三模态开关由 `CameraSettings` 抽屉控制。
`ensureReady(modalities)` 在重活儿（视频导入）前 await WASM + landmarker 初始化，避免首批帧因异步未就绪被丢。
单调 timestamp 由 `detect()` 内部强制（`max(timestampMs, lastTs + 1)`）。
所有 MediaPipe 运行时资产位于 `public/mediapipe/`：
- `tasks-vision/vision_bundle.mjs`（SDK，134KB）
- `wasm/vision_wasm_internal{,_nosimd}.{js,wasm}`（18MB）
- `models/{pose_landmarker_lite,full,heavy,hand_landmarker,face_landmarker}.task`（57MB）
`index.html` importmap 把 `@mediapipe/tasks-vision` 指向本地 mjs；`PoseLandmarkerManager.ts` 的 WASM_BASE 与 6 个模型 URL 全部走 `./public/mediapipe/...`。

## 视频导入链路

`ImportDrawer` 接管视频文件 → CoachClip 流程：
1. `VideoSeeker.load()` 等 `loadeddata`（readyState ≥ 2），并校验 videoWidth/Height。
2. `VideoSeeker.probeFps()` 短暂 `play()`，用 `requestVideoFrameCallback` 采 8 个 `mediaTime` delta 中位数推原生 fps；2.5s 超时回退 30；rVFC 不可用回退 30。
3. `LandmarkerController.setModel("heavy") + ensureReady(["pose"])` await 完毕再进迭代循环。
4. `VideoSeeker.iterate(fps, visitor)` 逐帧 `seekTo(t)`，等 `seeked` 之后再等 `requestVideoFrameCallback`（120ms 兜底）保帧已渲染，再调用 `ctrl.detect()` + `thumbCapture()`。
5. `landmarksToPose()` 把 33 点 world landmarks 转 17 关节 `SkeletonPose`。
6. `postProcessFrames()` 补空洞 + 时间维 One-Euro 平滑 + 居中 + 1m 身高归一化。
7. 失败诊断分四类（`noResult` / `noPose` / `shortWorld` / `badPose`），错误文案给出计数，DevTools 进一步看 `[ImportDrawer] low detection rate` 日志。
8. 成功后构建 `CoachClip { frames, thumbnails, fps, durationSeconds }` 并 `onApply` 到当前 exercise，`Timeline` 立即按 clip.thumbnails.length 重建格子。

## 评分与标定

`CalibrationController` 摄像头开启后采 ~1s 稳定 T-pose，推导骨长 + Y 参考，写入 `localStorage`。
`UserProfileStore` 提供 `get` / `set` / `clear`，`CameraSettings` 抽屉有 "重新校准" 入口。
`PoseScorer` 用标定后的骨长把 MediaPipe world landmarks 还原到米制，计算关节角度（`JOINT_ANGLES`）与 3D 距离差，加权综合到帧分；超出 ±35% 骨长偏差直接判风险。
`CoachHistory` 维护教练姿态滑窗（应对评委反应延迟），评委当前帧与最近 N 帧 seed 取最优。

## Session 总结与 AI 教练

`SessionRecorder` 监听 `score:update`，按 progress 把帧分桶到 `intro / mid / peak / outro` 四阶段；累计 per-joint 平均分、最差分、风险触发次数；`seed:update` 时重置。
结算页 `ResultsScreen` 调用 `sessionRecorder.summarize()` 写入勋章、击败百分比、阶段平均、四宫格关节统计。
`AiCoachPanel` + `core/llm/LLMClient.streamChat`：把 `SessionSummary` + `buildPrompt` 拼成 system + user 消息，SSE 流式调用 OpenAI 兼容 `/chat/completions`；baseUrl / apiKey / model / persona 由 CameraSettings 抽屉持久化到 `localStorage`。

## 约束契约

空间坐标单位是米。
坐标系右手系，Y 上、X 右、Z 朝屏幕外。
摄像头视频走 CSS `transform: scaleX(-1)`。
3D 教练画布不镜像。
旋转使用 `QuaternionTuple` 在线传输，运行时升级为 `MotionQuaternion` 实例。
旋转平滑使用 `slerp(target, 0.4)`。
源码禁止出现 `Euler`、`useState`、`ref(`。
当前使用 Canvas 2D 绘制 3D 投影骨架。
`three-compat.ts` 提供轻量 Quaternion，可后续替换为真实 Three.js。
MediaPipe 资产走本地 `public/mediapipe/`，不在运行时拉 CDN。

## 资源生命周期

入口预加载 `assets/smpl-lite-rig.gltf`。
预加载完成前展示 `loading-mask`。
切换种子调用 `MotionStage.resetForSeed()`。
该方法依次调用 `disposeSceneResources()` 与 `createSceneResources()`。
`ThreeResourceTracker` 当前管理 geometry / material disposal。
MediaPipe landmarker 在模型档位或模态切换时 `close()` 旧实例后异步重建（`disposePose/Hand/Face` + 下次 `detect()` 重新 `ensure*`）。
`SessionRecorder` 在 `seed:update` 时 `reset()`。
`AiCoachPanel` 持有 `AbortController`，关闭面板 / 重置 / 新生成都会 `abort()`。

## 反馈系统

PERFECT 阈值 score ≥ 88。
触发时屏幕中心硬边显示 `#5C7C9E` 实色块 + 白色 mono `PERFECT` 字样，附满屏一道 220ms 横向扫光。
冷却 1.1s。
Combo 升档触发 `COMBO ×NN` 黑底白字硬边方块出现 / 消失。
风险关节用 `#FF5500` 1.5px 实色圆 + 短虚线指示，旁边白底黑边 mono `WARN` 标签。
软萌中文纠错气泡（`CoachingTip`）按关节与风险等级随机选取文案。
WebAudio 合成 PERFECT 三泛音、Combo 升档锯齿、种子激活四音和弦、播放期低 BPM kick。
首次手势后激活 AudioContext。
结算页 AI 教练面板提供长文本流式反馈，可换 persona（默认中文教练）。

## 检查机制

`scripts/build.mjs` 只做 TypeScript 类型擦除（Node `stripTypeScriptTypes`）。
`scripts/guardrails.mjs` 检查必需字符串：`unit: "meters"`、`handedness: "right-hand"`、`scaleX(-1)`、`requestAnimationFrame`、`.slerp(`、`disposeSceneResources(`、`pushPacket(packet`。
guardrails 禁止 `Euler` / `useState` / `ref(`。
guardrails 对 `dist/**/*.js` 做语法检查。
TypeScript 诊断不强制（`npx tsc --noEmit` 仅作开发参考）。
`npm run check` 是唯一发布门禁。

## 后端边界

后端帧流 `FRAME_STREAM` 尚未接入；live 评分目前由前端 `PoseScorer` 完成。
WebSocket 接入点已在 `useWebSocket.ts` 就绪。
真实后端推送符合 `MotionFrame` 形状的数据包时，`bootstrap/MockStream.ts` 的定时器路径会被替换为后端流；前端 MediaPipe / Scoring 链路可保留，作为延迟兜底或后端不可用时的离线方案。
所有坐标必须米制，所有旋转必须 `[x, y, z, w]`。
LLM endpoint 由用户在 CameraSettings 抽屉配置，前端只持本地 `localStorage`，不写后端。

## 风险

无真实 Three.js / WHAM / gvHMR / SMPL 皮肤，3D 教练仍是抽象骨骼。
后端如传 Euler 或非米制坐标，骨架会错位。
UI 若直接订阅高频帧，页面会卡顿。
切换动作如果绕过 `resetForSeed()`，长时间演示存在内存泄露隐患。
JetBrains Mono 字体未打包，本机无字体时降级到系统等宽。
`public/mediapipe/` 总 76MB，单文件最大 29MB（`pose_landmarker_heavy.task`），未超 GitHub 50MB 上限但仓库 clone 体积偏大；升级 SDK 版本时需手工替换并 bump `WASM_BASE` / 模型路径相关常量。
VFR（可变帧率）视频在 `probeFps()` 下只能拿到中位数，遇到强 VFR 抖音 / UGC 素材可能丢帧；如需逐物理帧得改成 rVFC 驱动的播放路径。
Safari < 16 不支持 `requestVideoFrameCallback`，会回退到 30fps 等价采样，并失去帧渲染确认。
LLM 调用是直连第三方 endpoint，CORS / 速率 / Key 泄露风险由用户自担。

## 下一步优先级

接入真实 Three.js 骨架渲染（替换 `three-compat.ts` 与 `MotionStage` 绘制层）。
接入真实 WebSocket（替换 `bootstrap/MockStream.ts` 的定时器路径）。
固化 `MotionFrame` 到后端 OpenAPI 文档。
导入流程支持 VFR：基于 rVFC 播放 + 队列处理替代当前 seek 逐帧。
公开 `public/mediapipe/` 资产升级脚本，自动从官方源拉取并写入 `PoseLandmarkerManager.ts`。
补充断线重连、低帧率兜底与答辩脚本。

## 判断

项目具备黑客松前端独立演示能力。
项目具备与后端合体的稳定数据边界。
MediaPipe / 评分 / 标定 / Session / AI 教练已上真，不再纯 mock。
3D 渲染层与帧流 WebSocket 仍是替身阶段。
当前最重要的原则是帧数据隔离、渲染层独立、数据契约稳定与视觉规范严格执行。
