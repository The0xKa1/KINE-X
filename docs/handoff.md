# KINE//X 交接文档

> 事实快照：2026-07-19 晚（播放同步批次后）。只记当前可复现状态与下一步，不记开发流水。

## 零、停止点

- main：`4353468`（合并 codex/avatar-vault）+ 水合修复三枚 + 播放同步批次（见下）；分支与 worktree 已清理。**播放同步批次改动尚未 commit**（工作区含 `backend/app.py`、`dist/`、`src/`、`index.html`、`docs/` 的已暂存改动），服务器已先行部署同一份代码。
- 门禁：`npm run check` ✓、`npm run test:avatar` 41/41 ✓、Python 四套件 46/46 ✓；`npx tsc --noEmit` 12 行参考诊断（未入门禁）。
- AutoDL 全栈运行：**单端口 `:8765` 同时服务前端静态与 API**（Starlette 挂载仓库根，带 Range）；旧 `:5173`（http.server）仍在但视频不可 seek，仅作兜底。
- 种子卡：squat / ugc-squat / ugc-yoga(flow) / ugc-dance(bounce)；身份 `av-legacy-demo`（白裙少女，ready）× 两条 `motion-<jobId>` 的绑定均 ready，训练舱分身按钮已解锁。
- 播放同步批次：① 采样边界统一 clamp（`sampleClip`/`sampleFrameIndex`/`updateAvatar`，progress=1 不再跳回第 0 帧）；② CoachVideo 速率按 `speed×video时长/clip时长` 跟踪 + 结算后钉住末帧；③ 时间轴帧条=唯一进度面（点帧跳转并暂停、整条拖拽刮擦、playhead 竖线），右侧 timeSlider 删除，左侧 Tempo 加 `×0.65` 实时读数；④ 后端静态挂载修视频 seek + 全量 mp4 faststart；⑤ `resolveBackendUrl` 回退改同源（5173 除外）+ `/import/jobs` 水合等 load 事件并重试。

## 零·五、验收未通过（2026-07-19 晚，分身模式，ugc-dance）

用户录屏：分身动作约 2–3 倍速于 timeline，角落 video 完全不动。排查结论与待办：

1. **分身过快 = 动作资产与 clip 时长不匹配（已定位，未修）**
   - 事实：两条 `motion-<jobId>` 的 `record.json` 均为 `frameCount=480 @15fps`（=32s），而对应 `segment.mp4` 为 240 帧（24fps×10s）、CoachClip 为 150 帧（15fps×10s）。
   - 链路：`prepare_motion_asset`（backend/avatar_motion.py:54）直接打包 LHM 输出的全部帧 JSON，未按 `fps`/coach 时长重采样；前端 `updateAvatar` 按 `progress→frameIndex` 归一化播放，于是 32s 内容压进 10s 循环 ≈ 3.2x。
   - 待办（二选一）：A. 重烘——`prepare_motion_asset` 增加按 `fps` 重采样到 coach 帧数（150@15），重跑 `/root/kinex-bind/bind_legacy.py`（源用私有副本，防 `finally` 删源）；B. 前端按 `motion帧数/(fps×clip时长)` 限速播放。推荐 A，资产即真源。
2. **video 不动（已解决：入口端口 + seekable 守卫）**
   - 根因：用户当时走的是 `:15173`（http.server 无 Range）：faststart 后 Chrome 能发起 seek 却无法完成，`currentTime` 赋值让视频永久 seeking 卡死；`:18765` 探针播放/刮擦 drift≈0 全正常。
   - 已修：CoachVideo 加 `canSeekTo` 守卫——`video.seekable` 覆盖 target 才赋值，否则只线性播放（速率匹配兜底）。复验：15173 线性播放不卡死、刮擦不再冻结；18765 刮擦 drift=0。用户入口固定 `http://localhost:18765/`。

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
- 隧道：`ssh -i .deploy-tmp/autodl_ed25519 -p 24060 -N -L 15173:localhost:5173 -L 18765:localhost:8765 root@connect.westc.seetacloud.com`，**浏览器开 `http://localhost:18765/`**（单端口，前端+API 同源；`15173` 是旧 http.server，视频不可 seek，别用）。
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
- `python -m http.server` 不支持 Range：Chrome 线性下载完也 `seekable=[0,0]`，`currentTime` 赋值全部弹回 0——教练视频"能播不能拖"。前端必须走 :8765 的 Starlette 静态挂载；mp4 另需 `ffmpeg -c copy -movflags +faststart`（moov 前置）。**注意：faststart 后的文件放在无 Range 的服务器上反而更糟——Chrome 能发起 seek 却无法完成，视频从"能播不能拖"退化为永久 seeking 卡死；CoachVideo 必须先用 `video.seekable` 判断可拖再赋值（守卫待加，见「零·五」）。**
- 采样边界语义：`sampleClip`/`sampleFrameIndex`/`updateAvatar` 统一 clamp——预览循环的回绕在上游 RealtimeStream 完成，progress=1 只会出现在会话结算，各层必须钉住末帧而不是跳回第 0 帧。
- `_run_motion_binding_job` 的 `finally` 会删除传入的 source_video：复用该 worker 必须给私有副本。公开资产（如 `segment.mp4`）曾被误删导致种子视频窗消失；`d790102` 起删除被限制在私有根内。
- CDP `captureScreenshot` 在本应用页面会卡死：调试用 `Runtime.evaluate` 探针（`.deploy-tmp/cdp-eval.mjs` / `cdp-debug.mjs`，`CDP_PORT` 环境变量选端口）。**被占用的 headless 标签页 `visibilityState=hidden` 会冻结 RAF**，整个 App（帧流/视频/时间轴）假死、探针全假阴性——必须自起干净 headless 实例（`--headless=new --remote-debugging-port=9224`）验证。
- LHM 的 lbs 把 root trans 拆在矩阵外：对齐拟合必须给关节补 trans，烘 bin 时矩阵只左乘 sR；TF32 会污染精确数学（推理后强制关）。
- jobs 列表水合 newest-wins：每种子取 `finishedAt` 最新的 done 记录。
- `resolveBackendUrl` 回退：5173 → `:8765`；其余端口 → 同源（单端口部署）。`?backend=` 仍优先并持久化。
- `ws://localhost:8000/motion` 403 重连噪音是预期（真实帧流后端不在本仓库）。
- `public/coach_clips/single_leg_squat_frames` 是死符号链接，时间轴靠 `healTimelineThumbnails` 自愈。
- 部署后必须验证真实资产请求（coach.json / segment.mp4 / identity.bin），不能只看根页 200。

## 七、下一步

1. 修「零·五」两条：`prepare_motion_asset` 按 fps 重采样到 coach 帧数后重烘两条 motion；CoachVideo 加 seekable 守卫。
2. `docs/review.md` 打磨清单（P1 余项、答辩叙事）。
3. 长期：`tsc` 清零入门禁；真实 WS 帧流后端；Google Fonts 本地化。

## 八、修改原则

- 高频帧数据只经 `MotionFrameBuffer.pushPacket`，不进 UI 事件或响应式状态。
- 单位只用米，坐标只用右手系，旋转只用四元数。
- 切换动作必须走 `MotionStage.resetForSeed()` 与资源释放边界。
- 不要复活 `MockStream`、`mockFrameSource`、`landmarksToPose` 或 `postProcess`。
- 完成前至少运行 `npm run check`；分身变更还应运行 Python 四套件与 `npm run test:avatar`。
