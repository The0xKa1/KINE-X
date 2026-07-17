# 复赛评审报告（docs/review.md）

> 来源：赛道二官方评审表 + 2026-07 对代码与文档的分维度审查（5 个评审代理交叉核对）。
> 用途：复赛打磨的工作清单。每项完成后在复选框打勾，并同步 `docs/curren.md` 的「下一步优先级」。

## 官方评审锚点

「内容，是否被转化为用户能看懂、能学到、能用上的体验，并在过程中带来获得感与一定趣味性？」

## 分维度结论

| 维度 | 权重 | 评级 | 一句话 |
| --- | --- | --- | --- |
| 场景与问题洞察 | 15% | 中 | 痛点真实（收藏夹吃灰），但"抖音内容"目前靠一个 SAM 官方 demo 资产撑着，用户定义分裂 |
| AI 能力与产品结合 | 20% | 强 | 四环 AI（MLLM / SAM3D / MediaPipe / LLM）全部真实接线，默认教练本身就是重建物证 |
| 体验完整性 | 15% | 中偏强 | 主闭环纯前端可走通、兜底扎实；存在 WebGL 冻结 / MediaPipe 静默死两处演示断点 |
| 用户价值感 | 30% | 中偏上 | 测量链路真实，但三个最显眼的数字（角度误差、距离误差、全球百分位）是伪造的 |
| 创新性与延展潜力 | 20% | 强 | 契约 / 模板 / 门禁都是代码级证据；最大风险是 DnaExport 假二维码反噬可信度 |

## 跨维度共性风险（评委最可能戳的点）

1. **假数据三件套**：`PoseScorer.ts:92-93` 的 °/cm 误差是分数线性反推（真实测量算完即弃）；"击败全球 X%" 是公式编造；Combo 是分数换皮不是连击。
2. **化石 mock 层**：DNA 抽屉 pipeline 仍写 "YOLOv8-Pose / WHAM mock SMPL-X"（`data/exercises.ts` pipeline 字段），与 SAM3D 叙事正面矛盾；`DnaExport.ts` 假二维码，评委扫码即穿帮。
3. **两处静默死**：`MotionStage.ts` 构造器 `new WebGLRenderer` 无防护（无 GPU 环境整页冻结，boot 兜底也进不去）；`PoseLandmarkerManager.ts` WASM 加载失败只 console.warn 且 `visionPending` 缓存 resolved 永不重试。
4. **内容宽度 = 1**：仅 squat 一个真种子（且为高阶单腿深蹲，评委做不动）；MLLM 分片语义（actionLabel / 难度 / 受力部位）只用于展示，不进种子。

## 行动清单

### P0 · 防穿帮（约 1 天代码量）— ✅ 已完成（2026-07-17）

- [x] **真实误差接上**：`computeBuckets` 已算出真角度差，按 metric 聚合写入 `angleDeltaDeg` / `distanceDeltaCm`（`src/core/scoring/PoseScorer.ts`，~20 行）。下游报告表 / AI prompt / fallback 文案自动全部变真。
- [x] **"全球百分位"改本机历史百分位**：用 `SessionArchive.forExercise()` 真实分布算"超过你历史 X% 场次"（`ResultsScreen.ts:78`、`ReportPage.ts` 文案，~10 行）。
- [x] **pipeline 面板换血**：`data/exercises.ts` 的 pipeline 改为真实链路描述（SAM 3D Body / MediaPipe / Angle Solver），删掉 mock 字样。
- [x] **WebGL 构造器防护**：`MotionStage.ts` 构造 try-catch，失败时在 loadingOverlay 显示降级文案并继续 boot。
- [x] **MediaPipe 失败上 UI**：catch 里走 `camera:error` 事件复用现有错误 UI；`ensureVision` 失败后清空 `visionPending` 允许重试（`src/core/PoseLandmarkerManager.ts`）。
- [x] **结算按钮门禁**：仅非 idle 状态可结算（`main.ts` finishButton handler），避免无 session 产出假报告污染存档。

### P1 · 涨分点

- [~] **预导入 2–3 条真实短视频入库**（hinge / flow / bounce 各一，产物提交进 `public/coach_clips/`）→ 内容宽度 1→4。依赖 GPU 导入后端（AutoDL 环境）。**进展**：已将 AutoDL 导入的 UGC squat（118 帧 + SMPL-X mesh + 帧图）rsync 回本地并内置为第二张种子卡 `ugc-squat`（commit d5ea929）；再补 1–2 条非 squat 类型即完成。
- [x] **MLLM 语义沉淀**：选中 segment 后用 `actionLabel` 自动填种子名、按语义预选 motion（`src/core/import/ImportFlow.ts`、`data/exercises.ts`）。
- [x] **LLM 教练多轮追问**：报告页加输入框，SessionSummary 作 context 续接对话（`ReportPage.ts`、`AiCoachPanel.ts`；server `/api/chat-stream` 已通用）。
- [x] **中文风险标签进主舱**：riskLabel 已随 `score:update` 广播，SYNC 巨数区下方加 badge 订阅（`index.html` + `ScoreBoard.ts`）。
- [x] **指标名对齐真实测量**："膝盖内扣"→"膝关节屈伸"等（`data/exercises.ts` 的 name 字段；当前测的是屈伸角，测不出额状面内扣）。

### P2 · 锦上添花

- [x] **Combo 改真连击**：连续 score≥80 的帧数计 combo（`PoseScorer.ts` 或 `ComboBurst.ts`）。
- [x] **MotionFrame 固化 JSON Schema**（`docs/` + README 引用）。→ `docs/motion-frame.schema.json`
- [x] **DnaExport 接真产物**：MediaRecorder 录 `MotionStage` canvas 成 webm，二维码指向真实文件。**实现调整**：MediaRecorder 录舞台 canvas 直出 webm + 页内预览 + 下载按钮（无公网地址可挂二维码，改为真实可下载产物）。
- [x] **导入后端异步化**：`run_in_executor` + 任务轮询，导入进度条从模拟变真实（`backend/app.py`、`ImportFlow.ts`）。**实现**:`run_in_executor` 放开事件循环（已同步服务器）。
- [x] **Face 模态默认关闭或给说法**（478 点目前纯装饰，白占推理资源）。

### 答辩叙事（零成本，PPT / 讲稿层）

- [ ] 用户一句话收敛："抖音上收藏健身/舞蹈教学、在家跟练但没反馈的人"；开场 hook「收藏 ≠ 学会」。
- [ ] 开场第一句坐实物证："你们看到的默认教练，是 SAM 3D Body 从一段普通视频重建的"（展示 `single_leg_squat.json` 的 `_meta.source`）。
- [ ] 评分引擎主动定性"AI 姿态估计 + 可解释几何评分"，不是黑箱打分——诚实反而加分。
- [ ] 单种子讲成"深度标杆 + 五类评分模板扩展"（`MOTION_METRIC_TEMPLATES`）；DnaExport 避开或定性为 roadmap。
- [ ] 演示前在目标机器跑一遍 `npm run check` + 摄像头 + 开 devtools 确认无红字；`docs/demo/` 三段录屏作为链路实证。

## 证据摘录（各维度关键发现）

- **AI 结合（强）**：内置种子 `_meta.source: "sam-3d-body/mhr70"` 是重建物证；MLLM 分片前端做了时间戳 clamp 与幻觉容错（`VideoSegmentationClient.ts`）；评分用 worldLandmarks 米制 3D + DTW-lite 滑窗 + 骨长标定门禁；LLM prompt 强制"带数字单位 + 生物力学因果 + 可执行动作"结尾。
- **体验（中偏强）**：闭环六环逐环可走通；兜底齐全（boot 9s、摄像头五类错误、LLM 三层 fallback、缩略图自愈、WS 退避重连）。断点：WebGL 冻结、MediaPipe 静默、无摄像头点结算出假报告。
- **价值感（中偏上）**：测量（骨向余弦相似度 + 关节屈曲角加权）真实；但 `angleDeltaDeg = angle + miss * 0.16` 线性反推；"击败全球 X%" 为公式；风险标签只在 DNA 抽屉，主舱不可见。
- **创新（强）**：`FRAME_STREAM` 类型化契约 + 真 WS 客户端；`/import/jobs` 与 `/import/video` 响应同构；guardrails 把架构约束固化为门禁；SessionArchive 20 场历史已驱动报告页与动作库。
- **场景（中）**：痛点与转化链路真实；但目标用户三处定义不一、唯一种子是 SAM 官方 demo 资产非抖音内容、`seedUrl: douyin://` 为假 URI、"抖音热推"标签无实据。
