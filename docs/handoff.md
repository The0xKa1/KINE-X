# KINE//X 交接文档

> 事实快照：2026-07-19（main 已合并 avatar-vault）。只记当前可复现状态与下一步，不记开发流水。

## 零、停止点

- main：`4353468`（合并 codex/avatar-vault）+ 水合修复 `7b8e552` / `94f9f6b` / `5a1e51c`；分支与 worktree 已清理。
- 门禁：`npm run check` ✓、`npm run test:avatar` 41/41 ✓、Python 四套件 46/46 ✓；`npx tsc --noEmit` 12 行参考诊断（未入门禁）。
- AutoDL 全栈运行：后端 `:8765`、前端 `:5173`；验收残留已清——身份库仅 `av-legacy-demo`（Legacy Coach，ready），motions 仅 `motion-legacy-squat`，绑定为空。种子卡：squat / ugc-squat / ugc-yoga(flow) / ugc-dance(bounce)。
- 在途工作：① coachVideo 改为直接播原视频切片（后端 `segment.mp4` + `sourceVideoUrl`，MimicMotion 烘焙退役）；② `av-legacy-demo` 绑定 ugc-yoga / ugc-dance 两条动作（需先补 `KINEXGM1` 动作资产）。

## 一、产品边界

单 DOM 五页 hash-router SPA：`#/` 动作库、`#/train/:seedId` 训练舱、`#/report/:sessionId?` 报告、`#/create` 视频导入、`#/avatars` 分身身份库。
训练主链 CoachClip / MeshClip 立即可用；分身绑定后台渐进就绪，失败不阻塞教练/骨骼/评分/报告/WebM 导出。

## 二、可复用分身架构（身份 × 动作解耦）

```text
照片 → /avatars → KINEXGI1 身份（静态高斯 + 55 关节休息骨架 + LBS 权重，一次重建）
视频 → /import/video → CoachClip + MeshClip（先返回可用）
                         └→ 后台 LHM → KINEXGM1 动作（局部四元数 + root 位移）
身份 × 动作 → /avatar-bindings（幂等记录）→ 运行时 FK 55 关节现场组合 → 训练舱解锁分身
```

- 谁都不存蒙皮矩阵（依赖两者）；运行时 `GaussianAvatar` 每帧 FK + shader LBS + CPU 排序。
- 历史 `KINEXGS1`（高斯+动画同文件）仅作内置兼容；迁移用 `scripts/migrate-legacy-avatar.py`。
- 服务器 manifest 是真源；软删身份保留 ready 绑定可播；queued/running 身份服务重启可恢复。

## 三、资产与数据位置

| 位置 | 内容 | 规则 |
|---|---|---|
| `public/coach_clips/jobs/<jobId>/` | CoachClip、MeshClip、抽帧图、`segment.mp4` | 前端静态可访问 |
| `public/coach_clips/avatar-identities/<avatarId>/` | `record.json`、`identity.bin`、预览图 | 注册表真源，不得镜像删除 |
| `public/coach_clips/motions/<motionId>/` | `record.json`、`motion.bin` | 不得镜像删除 |
| `public/coach_clips/avatar-bindings/` | identity×motion manifest | ready 绑定在身份软删后保留 |
| `~/.local/share/kinex/avatar-jobs/` | LHM 私有源视频 | 绝不放到前端静态根 |

## 四、运行与部署

```bash
npm run dev          # 本地 :5173
npm run check        # 唯一发布门禁
npm run test:avatar  # 分身前端测试
python3 -m unittest backend.test_avatar_assets backend.test_avatar_registry backend.test_avatar_api backend.test_avatar_binding
```

- 服务器一键起：`bash /root/start_all.sh`（pgrep 守卫，不会重复起）。
- 隧道：`ssh -i .deploy-tmp/autodl_ed25519 -p 24060 -N -L 15173:localhost:5173 -L 18765:localhost:8765 root@connect.westc.seetacloud.com`，浏览器开 `http://localhost:15173/?backend=http://localhost:18765`。
- 同步代码：显式文件清单 rsync（`backend/`、`dist/`、`src/`、`scripts/`、`index.html`），**不带 `--delete`**，不动注册表与私有源。
- 重启后端：`pkill -f "[u]vicorn backend.app"`（**方括号必须有**，否则 pkill 匹配到自身远程 shell、ssh 直接断）→ `bash /root/start_all.sh` → 轮询 `/healthz`（冷启动 ~15–60s）。
- 后端启动脚本（`/root/start_backend.sh`）负责 SAM / MHR / SMPL-X / LHM 路径与 `PYTHONPATH`。

## 五、端点速查（:8765）

- `GET /healthz`；`GET /import/jobs`（记录含 `sourceVideoUrl`，当 `segment.mp4` 存在时）
- `POST /import/video`：multipart；可选 `startSec / endSec / motion / targetFps / name / avatarId`
- `GET|POST /avatars`；`PATCH|DELETE /avatars/{avatarId}`；`POST /import/avatar` 仅为兼容别名（`seedId` 忽略）
- `GET|POST /avatar-bindings`：绑定要求动作记录已存在（动作只在带 `avatarId` 的导入或后台 worker 中产生）

## 六、坑位备忘（只留真坑）

- 浏览器对 `dist/` 启发式缓存：验证前端改动必须禁缓存或换 query 强刷，否则以为没生效。
- CDP `captureScreenshot` 在本应用页面会卡死：调试用 `Runtime.evaluate` 探针（`.deploy-tmp/cdp-eval.mjs`）或 headless Chrome `--screenshot`。
- LHM 的 lbs 把 root trans 拆在矩阵外：对齐拟合必须给关节补 trans，烘 bin 时矩阵只左乘 sR；TF32 会污染精确数学（推理后强制关）。
- jobs 列表水合 newest-wins：每种子取 `finishedAt` 最新的 done 记录。
- `ws://localhost:8000/motion` 403 重连噪音是预期（真实帧流后端不在本仓库）。
- `public/coach_clips/single_leg_squat_frames` 是死符号链接，时间轴靠 `healTimelineThumbnails` 自愈。
- 部署后必须验证真实资产请求（coach.json / segment.mp4 / identity.bin），不能只看根页 200。

## 七、下一步

1. 给 ugc-yoga / ugc-dance 补 `KINEXGM1` 动作并绑定 `av-legacy-demo`（复刻 `_run_motion_binding_job` 路径，源视频用 `segment.mp4` 或本地原片）。
2. `docs/review.md` 打磨清单（P1 余项、答辩叙事）。
3. 长期：`tsc` 清零入门禁；真实 WS 帧流后端；Google Fonts 本地化。

## 八、修改原则

- 高频帧数据只经 `MotionFrameBuffer.pushPacket`，不进 UI 事件或响应式状态。
- 单位只用米，坐标只用右手系，旋转只用四元数。
- 切换动作必须走 `MotionStage.resetForSeed()` 与资源释放边界。
- 不要复活 `MockStream`、`mockFrameSource`、`landmarksToPose` 或 `postProcess`。
- 完成前至少运行 `npm run check`；分身变更还应运行 Python 四套件与 `npm run test:avatar`。
