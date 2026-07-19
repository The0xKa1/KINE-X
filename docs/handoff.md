# KINE//X 交接文档

> 事实快照：2026-07-19。本文只记录当前可复现状态，不代表已合并或已推送到任何远端分支。

## 一、当前产品边界

KINE//X 是单 DOM 的五页 hash-router SPA：

- `#/`：动作库
- `#/train/:seedId`：训练舱
- `#/report/:sessionId?`：训练报告
- `#/create`：视频导入
- `#/avatars`：可复用分身身份库

训练主链是 CoachClip / MeshClip 立即可用，分身绑定在后台渐进就绪。分身失败不阻塞普通教练、骨骼、评分、报告或 WebM 导出。

## 二、可复用分身架构

```text
照片 → /avatars → KINEXGI1 identity
视频 → /import/video → CoachClip + MeshClip（先返回）
                         └→ LHM motion → KINEXGM1
identity × motion → /avatar-bindings → 训练舞台解锁分身
```

- 身份、动作、绑定是三类独立持久化记录。
- `KINEXGI1` 含静态高斯、55 关节休息骨架与层级。
- `KINEXGM1` 含局部四元数、root translation 与 stage similarity。
- 历史 `KINEXGS1` 仅作内置兼容；迁移用 `scripts/migrate-legacy-avatar.py`。
- 身份库列表、重命名和软删除以服务器 manifest 为真源，localStorage 只是训练绑定缓存。

## 三、资产与数据位置

| 位置 | 内容 | 处理规则 |
|---|---|---|
| `public/coach_clips/jobs/<jobId>/` | CoachClip、MeshClip、抽帧图 | 前端静态可访问 |
| `public/coach_clips/avatar-identities/<avatarId>/` | `record.json`、`identity.bin`、预览图 | 注册表真源，不得镜像删除 |
| `public/coach_clips/motions/<motionId>/` | `record.json`、`motion.bin` | 已完成训练资产，不得镜像删除 |
| `public/coach_clips/avatar-bindings/` | identity×motion manifest | ready 绑定在身份软删除后仍保留 |
| `~/.local/share/kinex/avatar-jobs/` | LHM 所需的私有源视频 | 绝不得放到前端静态根 |

部署代码时使用明确文件清单且不带 `--delete`。不得删除历史 jobs、注册表、ready 绑定或私有源视频。

## 四、开发与启动

```bash
npm run build
npm run dev
npm run check
python3 -m unittest \
  backend.test_avatar_assets \
  backend.test_avatar_registry \
  backend.test_avatar_api \
  backend.test_avatar_binding -v
npm run test:avatar
```

`npm run check` 是发布门禁。`npx tsc --noEmit` 仍有已知诊断，只作参考。TypeScript 源码的相对 import 必须保留 `.js` 后缀。

AutoDL 开发主机上，前端为 `:5173`，导入后端为 `:8765`。后端启动脚本必须设置 SAM / MHR / SMPL-X / LHM 的模型路径和 `PYTHONPATH`。冷启动需加载 CUDA 模型；进程已存在但 `/healthz` 暂时不通时，应轮询现有进程，不要重复启动。

## 五、端点速查

- `GET /healthz`：SAM 服务健康状态。
- `POST /import/video`：视频导入；可选 `startSec / endSec / avatarId`。
- `GET /import/jobs`：普通导入任务水合。
- `GET|POST /avatars`：身份列表/上传。
- `PATCH|DELETE /avatars/{avatarId}`：重命名/保守软删除。
- `POST /import/avatar`：`POST /avatars` 兼容别名，`seedId` 被忽略。
- `GET|POST /avatar-bindings`：绑定列表/创建。

## 六、2026-07-19 远端验收证据

验收在正常 CUDA 服务前后执行，中间只为照片出口显式开启过一次 `AVATAR_EXPORT_STUB=1`，结束后已恢复正常模式。

- 迁移 dry-run、真实发布与幂等复跑成功；历史源文件 SHA-256 前后一致。
- 新 stub 身份进入 `ready`，HTTP 身份文件头为 `KINEXGI1`。
- 1.5 秒视频用 4.47 秒返回 8 帧普通动作产物和 queued 绑定；真实 LHM 任务后续达到 `ready`，动作文件头为 `KINEXGM1`。
- `#/avatars` 跨刷新重建服务器档案；预览 canvas 尺寸稳定，overlay 在 ready 后真正 `display:none`；拖拽环绕与滚轮缩放都有明显视角变化。
- 导入种子显示 ready 状态并解锁“分身”；回放从 frame `000000` / `0.2%` 推进到 `000006` / `83.4%`。
- DNA 导出在可见训练舞台上生成 613,931 字节 `video/webm`。
- 只软删除该临时身份后，ready 绑定、动作资产和导入训练仍可播放。
- 最终 `/healthz`、`/avatars`、`/avatar-bindings` 和前端均为 HTTP 200，后端进程环境不含 `AVATAR_EXPORT_STUB`。

## 七、已知风险与下一步

1. 分身身份库的休息姿态预览已可正常环绕/缩放；但本次短视频的真实 LHM 绑定在训练舞台上出现明显压缩/团块化观感。资产可加载、可动画且交互有响应，但动作重定向/坐标对齐的视觉质量仍需独立标定，不能仅以 manifest `ready` 判定。
2. 旧的失败验收记录被保留为证据；不要用批量清理命令删除。
3. `public/coach_clips/single_leg_squat_frames` 仍是死符号链接，时间轴依赖运行时自愈缩略图。
4. 真实 WebSocket 帧流后端仍不在本仓库；默认 `ws://localhost:8000/motion` 不应被当作演示必要条件。
5. 部署后必须同时验证真实资产请求，不能只看根页或 `/healthz`。

## 八、修改原则

- 高频帧数据只经 `MotionFrameBuffer.pushPacket`，不进 UI 事件或响应式状态。
- 单位只用米，坐标只用右手系，旋转只用四元数。
- 切换动作必须走 `MotionStage.resetForSeed()` 与资源释放边界。
- 不要复活 `MockStream`、`mockFrameSource`、`landmarksToPose` 或 `postProcess`。
- 完成前至少运行 `npm run check`；分身变更还应运行 Python 四模块套件与 `npm run test:avatar`。
