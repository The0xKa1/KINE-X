# KINE//X 交接文档

> 事实快照：2026-07-22（用户自配 AI、动作同步、独立分身成片 API 上线后）。只记当前可复现状态与下一步，不记开发流水。

## 零、停止点

- main：用户自配 AI API、DNA 导出移除、训练记录单条删除、导入完成后的分身补绑，以及训练舱分身视频导出入口均已落地；`v0.1.13` 已部署到服务器 `/root/KINE-X`，尚未 push GitHub `origin/main`。
- 门禁：`npm run check` ✓、`npm run test:ai` 8/8 ✓、`npm run test:session` 3/3 ✓、`npm run test:avatar` 48/48 ✓；Python 四套件 57/57 ✓；`npx tsc --noEmit` 保留 8 个既有参考诊断（未入门禁）。
- AutoDL 全栈运行：**单端口 `:8765` 同时服务前端静态与 API**（Starlette 挂载仓库根，带 Range）；旧 `:5173`（http.server）仍在但视频不可 seek，仅作兜底。
- 独立分身成片 API 与训练舱入口已部署：`POST /avatar-video-exports` 用 ready `avatarId + motionId` 异步生成 MP4，查询/列表走同名前缀 GET。分身切换器旁的按钮承担提交、进度、失败重试与下载；身份弹层限定三行后内部滚动。服务器启动脚本固定 `PYOPENGL_PLATFORM=egl`，运行时拒绝 llvmpipe；记录、成片与恢复状态持久化在 `public/coach_clips/avatar-video-exports/`。
- 2026-07-22 真实验收：七海千秋 `av-d01e4...` × ugc-dance `motion-20260719-111338-cf2d79` 生成 `export-928d5d61196948bea73a5efd69d65d57`，约 13 秒到 ready；记录返回 RTX 4080 / OpenGL 4.1，成片 H.264 1920×1080、15 FPS、150 帧、10 秒，服务器环回与公网 HTTPS Range 均为 206；重复 POST 返回同一 ready export，不重复渲染。
- 2026-07-21 公网部署复验：HTTPS `/healthz` 返回 CUDA ready，根页为 `v0.1.10`；用 `avatarId + jobId` 为任务 `20260721-203028-f26db1` 请求“绫波丽”时返回既有 ready 绑定 `binding-9d1d48f458954a1980f5a4281ee50e58` 与同一 `motion-20260721-203028-f26db1`，证明后置补绑契约已上线且幂等。AI 双链路测试、追问上下文限制、Vault 四种预览姿态、训练记录删除与 DNA 导出移除仍保留。
- 种子卡：squat / ugc-squat / ugc-yoga(flow) / ugc-dance(bounce)；身份 `av-legacy-demo`（白裙少女，ready）× 两条 `motion-<jobId>` 的绑定均 ready，训练舱分身按钮已解锁。
- 播放同步批次：① 采样边界统一 clamp（`sampleClip`/`sampleFrameIndex`/`updateAvatar`，progress=1 不再跳回第 0 帧）；② CoachVideo 速率按 `speed×video时长/clip时长` 跟踪 + 结算后钉住末帧；③ 时间轴帧条=唯一进度面（点帧跳转并暂停、整条拖拽刮擦、playhead 竖线），右侧 timeSlider 删除，左侧 Tempo 加 `×0.65` 实时读数；④ 后端静态挂载修视频 seek + 全量 mp4 faststart；⑤ `resolveBackendUrl` 回退改同源（5173 除外）+ `/import/jobs` 水合等 load 事件并重试；⑥ 分身二进制与前端本地业务模块/CSS 已统一做版本化缓存失效。

## 零·五、已解决的验收问题（ugc-dance / ugc-yoga）

用户录屏：分身动作约 2–3 倍速于 timeline，角落 video 完全不动。排查结论与待办：

1. **分身过快 = LHM 重复读取整段视频（根因与存量资产均已修）**
   - 事实：两条 `motion-<jobId>` 的 `record.json` 均为 `frameCount=480 @15fps`（=32s），而对应 `segment.mp4` 为 240 帧（24fps×10s）、CoachClip 为 150 帧（15fps×10s）。
   - 真正根因：当前 LHM checkout 的 `video2motion.py::load_video()` 在 `for i in range(2)` 内读取并 append，240 帧输入实际变成完整视频串联两遍的 480 帧。随后压到 150 帧会把动作重复两次塞入同一条 10 秒时间轴。2026-07-21 首轮 segment 重烘的新旧哈希完全相同，正是因为旧资产也来自同一个重复读取缺陷。
   - 代码修复：`backend/avatar_motion.py` 在打包前比较两半 SMPL-X pose/trans；只有确认整段逐帧重复时才丢弃第二遍，再重采样到 CoachClip 帧数。`backend/app.py` 同时改为私存 job 的 `segment.mp4` 并交给 LHM，保证动作、CoachClip、timeline、video 覆盖同一时间区间。
   - 存量处理（2026-07-21 完成）：首轮 segment 重烘因仍受 LHM 重复读取影响，新旧哈希相同，未解决问题；随后把远端 LHM 改为单遍读取并再次重烘。两条输入均为 240 帧，输出均规范化为 150 帧，且新旧 SHA-256 明确不同：yoga `a9fb73… → f056cb…`，dance `066ee4… → 2e1a46…`。原 bindingId、motionId、identity 保持不变；临时错误代码与 `.bak/.orig/backup` 文件已清理。
   - 运行复验：8765 已重启并加载新防护，`/healthz` 与 `/avatar-bindings` 正常，视频 Range 请求返回 206。浏览器在分身模式分别抽查两条动作的起点/中点/终点：timeline `0.0% / 52.9% / 100%` 对应 yoga video `0.000 / 5.294 / 9.950s`、dance video `0.000 / 5.299 / 9.960s`；三个采样画面均发生变化，中点的分身、视频与 timeline 姿态方向一致。`scripts/resample-motion-bin.py` 只允许做已确认同区间的帧数规范化。
2. **video 不动（已解决：入口端口 + seekable 守卫）**
   - 根因：用户当时走的是 `:15173`（http.server 无 Range）：faststart 后 Chrome 能发起 seek 却无法完成，`currentTime` 赋值让视频永久 seeking 卡死；`:18765` 探针播放/刮擦 drift≈0 全正常。
   - 已修：CoachVideo 加 `canSeekTo` 守卫——`video.seekable` 覆盖 target 才赋值，否则只线性播放（速率匹配兜底）。复验：15173 线性播放不卡死、刮擦不再冻结；18765 刮擦 drift=0。用户入口固定 `http://localhost:18765/`。

## 一、产品边界

单 DOM 五页 hash-router SPA：`#/` 动作库、`#/train/:seedId` 训练舱、`#/report/:sessionId?` 报告、`#/create` 视频导入、`#/avatars` 分身身份库。
训练主链 CoachClip / MeshClip 立即可用；分身绑定后台渐进就绪，失败不阻塞教练/骨骼/评分/报告。训练后的 DNA/WebM 视频导出已移除。

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
- API 在 `identityUrl` / `motionAssetUrl` / `previewUrl`（以及旧 `avatarBinUrl`）末尾追加由文件 `mtime_ns + size` 生成的 `?v=`；manifest 内仍保存无 query 的稳定相对路径。终态绑定也会在启动 discovery 时与服务器重对账，重烘后旧浏览器无需清 localStorage。

## 三、资产与数据位置

| 位置 | 内容 | 规则 |
|---|---|---|
| `public/coach_clips/jobs/<jobId>/` | CoachClip、MeshClip、抽帧图、`segment.mp4` | 前端静态可访问 |
| `public/coach_clips/avatar-identities/<avatarId>/` | `record.json`、`identity.bin`、预览图 | 注册表真源，不得镜像删除 |
| `public/coach_clips/motions/<motionId>/` | `record.json`、`motion.bin` | 不得镜像删除 |
| `public/coach_clips/avatar-bindings/` | identity×motion manifest | ready 绑定在身份软删后保留 |
| `public/coach_clips/avatar-video-exports/` | 独立成片 manifest + `avatar.mp4` | 运行时真源；部署不可 `--delete` |
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
- 同步代码（2026-07-21 起 git 化）：服务器 `/root/KINE-X` 是 git 工作区（main，origin 指向裸仓 `/root/kinex.git`）；本地 remote `autodl` 已配好（`core.sshCommand` 带密钥）。流程：本地 `git push autodl main` → 服务器 `git -C /root/KINE-X pull`（工作区保持干净即可快进）。注册表目录（`avatar-identities/motions/avatar-bindings`）与 `jobs/` 未跟踪，不受 pull 影响；faststart mp4 已入库。旧的显式 rsync 清单弃用。
- 重启后端：`pkill -f "[u]vicorn backend.app"`（**方括号必须有**，否则 pkill 匹配到自身远程 shell、ssh 直接断）→ `bash /root/start_all.sh` → 轮询 `/healthz`（冷启动 ~15–60s）。
- 后端启动脚本（`/root/start_backend.sh`）负责 SAM / MHR / SMPL-X / LHM 路径与 `PYTHONPATH`。

## 五、端点速查（:8765）

- `GET /healthz`；`GET /import/jobs`（记录含 `sourceVideoUrl`，当 `segment.mp4` 存在时）
- `POST /import/video`：multipart；可选 `startSec / endSec / motion / targetFps / name / avatarId`
- `GET|POST /avatars`；`PATCH|DELETE /avatars/{avatarId}`；`POST /import/avatar` 仅为兼容别名（`seedId` 忽略）
- `GET /avatar-bindings`；`POST /avatar-bindings` 支持 `avatarId + motionId` 复用已有动作，或 `avatarId + jobId` 为已完成但未选分身的导入延迟生成 `motion-<jobId>` 并建绑
- `POST /avatar-video-exports` 创建/幂等复用分身成片；`GET /avatar-video-exports/{exportId}` 查询；`GET /avatar-video-exports?avatarId=&motionId=` 过滤列表

## 六、坑位备忘（只留真坑）

- 前端版本当前为 `0.1.10`。`index.html` 的入口 CSS/JS、22 个 CSS `@import` 与构建产物内全部相对 JS 模块引用使用同一 `?v=0.1.10`；版本号来自 `package.json`，guardrail 会拒绝不一致。部署新版本后普通刷新一次即可，不应再要求用户清缓存或换浏览器。
- MLLM 与赛后教练由浏览器直连用户填写的 OpenAI-compatible API：Base URL / API Key 共用，模型名分开配置，保存在当前浏览器 localStorage；服务商必须支持 CORS，建议只用可撤销、有限额的 Key。
- `python -m http.server` 不支持 Range：Chrome 线性下载完也 `seekable=[0,0]`，`currentTime` 赋值全部弹回 0——教练视频"能播不能拖"。前端必须走 :8765 的 Starlette 静态挂载；mp4 另需 `ffmpeg -c copy -movflags +faststart`（moov 前置）。**注意：faststart 后的文件放在无 Range 的服务器上反而更糟——Chrome 能发起 seek 却无法完成，视频从"能播不能拖"退化为永久 seeking 卡死；`CoachVideo` 的 `video.seekable` 守卫已生效，只在线性可播放时降级。**
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

1. ~~部署动作同步修复并重烘两条存量 motion~~（2026-07-21 完成）：`backend/app.py` 固定使用 `segment.mp4`，`backend/avatar_motion.py` 防御 LHM 重复整段输出，两条 motion 已按单遍 240 帧输入重建为 150 帧并通过浏览器同步复验。CoachVideo seekable 守卫此前已修。
2. 打磨清单（P1 余项、答辩叙事；原 `docs/review.md` 已随 2026-07-21 文档精简移除，内容按需从 git 历史取回）。
3. 长期：`tsc` 清零入门禁；真实 WS 帧流后端；Google Fonts 本地化。
4. ~~数字分身vault页美化~~（已修复，2026-07-21）：① 预览人物沉进网格——身份 rest pose 脚底 y<0，`GaussianAvatar` 新增 `restGroundY` + `setBaseOffsetY`（折叠进 `uTrans`，训练舱默认 0 不受影响），vault 预览抬到脚踩网格；② 档案卡一片黑——legacy 身份无 `previewUrl`，预览渲染 6 帧后同帧 `toDataURL` 快照自愈卡片（任何缺 preview 的身份通用），快照已持久化为服务器 `preview.png` 并补写 `record.json`；占位块改为网格底 + 首字母大字。③ 档案卡图片优先显示原始照片（`identityUrl` 目录 + `sourcePhoto` 拼 URL），竖图 `object-position: center 18%` 保头部。
5. ~~分身切换与导入后补绑 UI~~（2026-07-21 完成）：训练舱渲染模式旁的 `AvatarSwitcher` 对 motion 类种子提供换绑；对没有 motion 但保留 `jobId` 的已导入种子显示“应用分身”，选择 READY 身份后由 `POST /avatar-bindings` 延迟生成唯一 `motion-<jobId>`，不重复 SAM 解析，同动作进程内去重 worker。快照经 `assignBindingSnapshot` + `controller.track()` 轮询并在 ready 后自动上场。注意：`applyBindingSnapshotToSeed` 的 bindingId 守卫要求换绑先改 exercise 再 track；localStorage 记录仍是选择真源，服务器 discovery 在同 motion 多绑定时选 createdAt 最旧者。
6. ~~分身与前端缓存版本化~~（2026-07-21 完成）：API 文件 URL 按真实文件状态生成版本；终态绑定启动时重对账；旧 avatar 实例在资产 key 变化时释放；前端入口、CSS 依赖和完整本地业务 ES module 图统一 cache bust。线上已核验 `/healthz`、根页、`/avatars`、`/avatar-bindings` 与两条重烘 motion SHA-256。

## 八、修改原则

- 高频帧数据只经 `MotionFrameBuffer.pushPacket`，不进 UI 事件或响应式状态。
- 单位只用米，坐标只用右手系，旋转只用四元数。
- 切换动作必须走 `MotionStage.resetForSeed()` 与资源释放边界。
- 不要复活 `MockStream`、`mockFrameSource`、`landmarksToPose` 或 `postProcess`。
- 完成前至少运行 `npm run check`；分身变更还应运行 Python 五套件（含 `backend.test_avatar_video`）与 `npm run test:avatar`。
