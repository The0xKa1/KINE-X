# KINE//X 交接文档（Handoff）

> 面向接手 agent / 队友的续跑指南。读完这份就能不重排雷地继续。
> 最后更新：2026-07-18 深夜（**3DGS 实时数字人已上线**；**照片分身产品化闭环已通**：创作工坊上传照片 → LHM-1B → 种子分身模式）。

## 一、这是什么

KINE//X：把短视频动作教学变成可交互实时动作教练（抖音精选赛道黑客松，复赛入围）。
闭环：动作库 → 训练舱（摄像头 MediaPipe 实时姿态 vs 3D/真人教练，逐帧评分）→ 训练报告（关节报告 + LLM 教练 + 历史）→ 创作工坊（上传视频 → MLLM 分片 → SAM3D 重建 → 入库）。

## 二、三处资产位置

| 位置 | 角色 | 内容 |
|---|---|---|
| **本地 Mac** `/Users/zhangjinkai/KINE-X` | 真源 | 前端全部源码/文档/种子资产。改代码都在这 |
| **GitHub** `The0xKa1/KINE-X` | 同步 | main 已推送最新（工作区干净） |
| **AutoDL** `westc:24060`（克隆机，RTX 4080 32G） | 演示 + 重活 | `/root/KINE-X`（前端副本 + SAM3D 后端 :8765）、`/root/autodl-tmp/`（MimicMotion / LHM 环境与权重） |

- SSH 免密密钥：`.deploy-tmp/autodl_ed25519`（已装到新实例；**该目录不入库**）
- 密码不入库，看 AutoDL 控制台实例页
- 服务器一键服务：`bash /root/start_all.sh`（拉起后端 :8765 + 前端 :5173）
- 隧道：`ssh -i .deploy-tmp/autodl_ed25519 -p 24060 -N -L 15173:localhost:5173 -L 18765:localhost:8765 root@connect.westc.seetacloud.com`，浏览器开 `http://localhost:15173/?backend=http://localhost:18765`
- 代码同步（本地→服务器）：`rsync -az --delete -e "ssh -i .deploy-tmp/autodl_ed25519 -p 24060" dist index.html src public --exclude 'coach_clips/jobs' root@connect.westc.seetacloud.com:/root/KINE-X/`
- **关机省费**：AutoDL 控制台关机（SSH 里 shutdown 不停计费）；连续关机 15 天数据清空

## 三、当前完成状态（已验证）

- **前端**：四页 hash 路由（动作库 `#/` / 训练舱 `#/train/:seedId` / 报告 `#/report` / 创作 `#/create`），单 DOM 不切页；开机编排、巨型 SYNC、telemetry、噪点纹理、中英双声部文案。
- **PIP 舞台**：右舱数字分身（真人视频）与结构蓝图（Three.js 3D）共享，模式决定主视图，小卡点击互换；无视频种子自动只有蓝图层。
- **种子**：squat（内置 clip + SMPL-X mesh）+ **ugc-squat**（真实 SAM3D 导入的 UGC 深蹲：118 帧 + mesh + 帧图 + 两版视频，已提交进仓库）。
- **评分**：真实关节角度差/距离差（非分数派生）、历史百分位、Combo 真连击、结算门禁、WebGL 优雅降级、MediaPipe 失败上 UI + 重试。
- **分身视频**：`ugc_squat_twin.mp4`（MimicMotion 烘焙，照片级）已在舞台上线；**LHM 多角度分身**：`ugc_squat_lhm_side.mp4` / `ugc_squat_lhm_top.mp4` 已接入 `coachVideo.side/top`（视角按钮切换；已二次修复时长=7.87s 与 clip 同步，见坑位备忘「动作时长两倍」），`ugc_squat_lhm_turntable.mp4`（360° 转盘）在库备用。
- **3DGS 实时数字人（方案 A）**：单张照片 → LHM-1B 重建 4 万高斯 → 自研 WebGL 可变形 splat 渲染器（`src/core/avatar/GaussianAvatar.ts`，顶点 shader LBS + EWA splat + CPU 深度排序 ~1.3ms）在浏览器实时驱动。新种子卡 **gs-avatar**（`#/train/gs-avatar`）：FRONT/SIDE/TOP 切视角 = 真 3D 环绕；教练模式显分身、骨骼模式显线框+骨架。资产：`public/coach_clips/gs_avatar_coach.bin`（5.35MB，KINEXGS1 v1 格式）。
- **评审清单**：`docs/review.md` 的 P0 全部完成、P1/P2 基本完成（见勾选状态）。

## 四、服务器环境地图（AutoDL）

| 路径 | 内容 |
|---|---|
| `/root/KINE-X` | 前端副本（已与本地同步）+ SAM3D 导入后端（base conda env 跑 uvicorn :8765） |
| `/root/miniconda3/envs/mimicmotion` | MimicMotion 环境（torch 2.0.1+cu117 pip 版，numpy 1.26） |
| `/root/autodl-tmp/envs/lhm` | LHM 环境（torch 2.3.0+cu121、pytorch3d 0.7.8、sam2、diff-gaussian、simple-knn、BasicSR、chumpy 补丁版，numpy 1.26） |
| `/root/autodl-tmp/MimicMotion/models/` | DWPose×2 + `MimicMotion_1-1.pth`（3.05GB 完整版） |
| `/root/autodl-tmp/models/svd-xt` | SVD 底模 fp16 文件集（ModelScope 拉的，~4.5GB） |
| `/root/autodl-tmp/LHM/pretrained_models/` | LHM 全部权重：LHM-MINI（`models/Damo_XR_Lab--LHM-MINI/`）、sapiens torchscript、gagatracker、human_model_files（vitpose/yolov8x/smplx） |
| `/root/autodl-tmp/LHM/train_data/custom_motion/test_video/smplx_params` | **已提取好的姿态序列**（470 帧 JSON，可直接用） |
| `/root/autodl-tmp/MimicMotion/outputs/` | MimicMotion 产物 mp4 |
| `/root/test_video.webm` | squat 驱动视频源（480×640, 7.86s） |

## 五、断点（下一步从这里续）

**照片分身产品化 ✅ 已完成（2026-07-18，feb7efa）**：创作工坊 `#/create`「照片分身」支路 → `POST /import/avatar`（202 异步 + GPU 导出锁 + 磁盘持久化）→ LHM-1B 导出 → 服务器侧对齐 → bin 落 `coach_clips/jobs/avatar/`。分身是**种子的第四种显示模式**（ugc-squat：教练/分身/骨骼/应力，按钮按 avatarUrl 显隐），不再是独立种子卡。开机水合把**最新 done** 的 avatar job 挂到对应种子（按 finishedAt，别按列表顺序——后端是 newest-first）。端到端已用真照片验证（进度 5→100 实时、训练舱分身模式出 3DGS 人）。

- **已知余量/维护点**：
- v1：目标种子固定 ugc-squat、动作固定 squat（bin 按该 clip 烘）。扩动作 = 新 smplx 参数序列 + `--clip` 换对齐目标（`AVATAR_ALIGN_CLIP` env 可改）。
- 分身模式在 avatar 未加载完时显示蒙皮占位（正常）；加载失败回退蒙皮并 console.warn。
- 服务器 `coach_clips/jobs/avatar/` 下的测试任务（StubBot/RealBot/ProgressBot/大力士分身）可按需清理——水合永远取最新 done，想回白裙少女就删掉比它新的 job 或重跑一张。
- CDP 截图验收的坑：同 URL 只变 hash 是 same-document 不重载，换 query 强制真刷新。
- **备胎与补丁的存放**（服务器关机也不丢，但本地都有保险副本）：同一人分身 `avatar_squat.bin`+`avatar_squat_debug.npz`（未对齐的原始导出，要用先跑 solve_alignment）在本地 `.deploy-tmp/avatar-lab/` 与服务器 `/root/lhm_outputs/` 双份；LHM 相机补丁文件在本地 `.deploy-tmp/lhm-patch/`（服务器原位在 `/root/autodl-tmp/LHM/LHM/runners/infer/`，原版备份 `/root/backup_utils.py`、`/root/backup_human_lrm.py`）；导出脚本 `export_avatar_kinex.py` 在 `.deploy-tmp/avatar-lab/` 与服务器 LHM 根目录双份。

**3DGS 实时数字人（方案 A）✅ 已完成（2026-07-18，5290aff）**：管线全部打通并验收。关键资产与工具：

- **导出**：`/root/autodl-tmp/LHM/export_avatar_kinex.py`（本地副本 `.deploy-tmp/avatar-lab/`），跑一次 ~4.5 分钟、峰值 19.6G。换照片 = 换 `--image` 即换分身。产物 `avatar_coach.bin` + 调试 npz。
- **对齐重烘**：`.deploy-tmp/avatar-lab/solve_alignment.py`（Kabsch 关节轨迹拟合 + 变换预烘进 bin + 按 clip 时长裁剪帧）。**任何新分身都必须跑这一步**，否则位置/朝向/时间全错（后端已 vendor 为 `backend/alignment.py`）。
- **浏览器渲染器**：`src/core/avatar/GaussianAvatar.ts`（API：load/object3d/setFrame/update(camera)/dispose）；测试台 `.deploy-tmp/avatar-lab/index.html`（`?file=&view=&frame=`）。
- **变形机制结论**（逆向实证）：逐帧零神经网络；每高斯 = 锚点 + 学习偏移 + 固定 [N,55] LBS 权重（top-4 压缩导出）；每帧 55 关节矩阵 + trans。

**下一个断点**：`docs/review.md` P1「预导入 2–3 条真实短视频入库」仍差 1–2 条非 squat 类型（hinge / flow / bounce）。走 AutoDL :8765 导入后端，产物 rsync 回本地 `public/coach_clips/jobs/` 后内置为种子卡（参照 ugc-squat 的做法，commit d5ea929）。

---

### 附：LHM 多角度分身烘焙（更早完成的工作）

**LHM 多角度分身烘焙 ✅ 已完成（2026-07-18）**：side/top/turntable 三条已烘好入库，`ugc-squat` 种子的 `coachVideo` 已有 front（MimicMotion）+ side/top（LHM）三视角，训练舱视角按钮可切。转盘视频 `ugc_squat_lhm_turntable.mp4` 在库备用（未接 UI）。实现要点：

- LHM 打了相机补丁：`LHM/runners/infer/utils.py` `prepare_motion_seqs` 新增 `camera_orbit`（front/side/top/turntable，绕主体均位 trans 轨道）+ `camera_zoom`（focal 缩放），CLI 直传；`human_lrm.py` 两个调用点已透传。原版文件备份在服务器 `/root/backup_utils.py`、`/root/backup_human_lrm.py`。
- 渲染命令（在 `/root/autodl-tmp/LHM` 下，每条 ~9 分钟，470 帧，RTX 4080）：
  ```bash
  HF_ENDPOINT=https://hf-mirror.com PYTORCH_CUDA_ALLOC_CONF=max_split_size_mb:256 \
  /root/autodl-tmp/envs/lhm/bin/python -m LHM.launch infer.human_lrm \
    model_name=LHM-MINI image_input=./train_data/ref_squat.jpg export_video=True \
    motion_seqs_dir=./train_data/custom_motion/test_video/smplx_params \
    motion_img_dir=None vis_motion=true motion_img_need_mask=true \
    render_fps=60 motion_video_read_fps=30 \
    camera_orbit=side camera_zoom=2.0   # front/side/top/turntable；zoom 1.0=原始取景
  ```
  产物固定写到 `exps/videos/LHM-training-from-scratch/LHM-MINI/test_video/ref_squat.mp4`（每条跑完立刻改名拷走，会被下一条覆盖）。
- 成片原始件在服务器 `/root/lhm_outputs/`（front/side/top/turntable 四条 + 抽帧）；入库的是 setpts/4 提速到 7.83s@60fps 的版本（与 twin 的 7.867s 时间线对齐，CoachVideo 按 progress 同步不漂）。

**下一个断点**：`docs/review.md` P1「预导入 2–3 条真实短视频入库」仍差 1–2 条非 squat 类型（hinge / flow / bounce）。走 AutoDL :8765 导入后端，产物 rsync 回本地 `public/coach_clips/jobs/` 后内置为种子卡（参照 ugc-squat 的做法，commit d5ea929）。

## 六、坑位备忘（别再踩）

- **env 隔离**：SAM3D=base env、MimicMotion=mimicmotion env、LHM=lhm env，互相不混装。同项目增量往已有 env 加。
- **numpy 必须 <2**（两个 env 都是 1.26.4；torch 2.0.1 与 chumpy 都吃这套）。
- **编译型包装隔离**：`--no-build-isolation`（diff-gaussian、simple-knn、pytorch3d、mmcv）。
- **chumpy 打不上**：PyPI sdist 的 setup.py 有上古 `import pip` bug；已打过补丁的包在 `/tmp/chumpy-0.70`（服务器上，重装直接 `pip install /tmp/chumpy-0.70`）。
- **conda 插件坑（克隆机）**：别加 `CONDA_NO_PLUGINS`（会把 libmamba solver 弄崩）；`conda create` 走交互式最稳。
- **磁盘**：系统盘 30G 很紧，环境一律放 `/root/autodl-tmp`（50G）；不够就 `conda clean -a` + 删重复 tar。
- **下载镜像实测**：HF 大文件 → `HF_ENDPOINT=https://hf-mirror.com` 或 turbo（`source /etc/network_turbo`）；PyPI 缺货（tb-nightly）→ 阿里云 `mirrors.aliyun.com/pypi/simple/`；ModelScope（`snapshot_download`）在国内最快，SVD/dinov2/LHM 权重都能走这条；`download.pytorch.org` 慢，torch 走 tuna PyPI。
- **HF gated repo**（SVD 官方）要授权，绕道 ModelScope `AI-ModelScope/stable-video-diffusion-img2vid-xt`。
- **人脸检测模型**在 `xinntao/facexlib` releases（不是 TencentARC/GFPGAN）。
- **本地没有 ffmpeg**：用 `/opt/homebrew/Caskroom/miniconda/base/lib/python3.13/site-packages/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1`；服务器有系统 `ffmpeg`（/usr/bin/ffmpeg）。
- **GitHub releases 大文件**（facexlib / GFPGAN / SAM2 权重）：`source /etc/network_turbo` 后 wget 秒下（81MB~900MB 均 <2 分钟）；直连只有 ~20-150kB/s 会卡死。注意 turbo 开启后 pip 等普通源反而变慢，下完即弃该 shell。
- **LHM 渲染前的权重体检**（都曾踩过）：`parsing_parsenet.pth`→`LHM/gfpgan/weights/`（facexlib releases）；`GFPGANv1.3.pth`→lhm env 的 `site-packages/gfpgan/weights/`；`sam2.1_hiera_large.pt` 在 `pretrained_models/sam2/`，**曾有 234MB 截断版**（真身 898MB，torch.load 报 "failed finding central directory" 即此症）。SAM2Seg 初始化失败会静默退回 rembg 的 `remove()`（未 import）报 NameError，别误判为代码 bug。
- **LHM-MINI 权重已在两处各存一份**（sha256 一致）：HF 缓存布局 `pretrained_models/huggingface/models--3DAIGC--LHM-MINI/`（AutoModelQuery Step 2 命中）+ ModelScope 副本 `pretrained_models/models/Damo_XR_Lab--LHM-MINI/`。dinov2 权重在 `~/.cache/torch/hub/checkpoints/`。
- **无头验收工具**：`scripts/shot.mjs`（CDP 截图）+ Chrome `--remote-debugging-port=9223`；截图前确认 dev server 活着，Chrome 僵尸进程先 `pkill -f remote-debugging-port`。
- **TF32 精度坑（LHM 导出）**：`from_pretrained`/`infer_single_view` 会把 `torch.backends.cuda.matmul.allow_tf32` 打开（torchinductor 嫌疑），FK 链式 matmul 随之产生 ~7e-4 噪声（zero-pose 的 G 偏离单位阵、误差正比于 |c|）。导出脚本在模型跑完后强制 `allow_tf32=False` + `set_float32_matmul_precision("highest")`，否则重放验证只能到 7e-4（正常应 5e-7）。
- **accelerate 未初始化**：standalone 脚本直接 `from_pretrained` LHM 会抛 "You must initialize the accelerate state"（模型构造函数里用了 accelerate.logging）。先 `Accelerator()` 再构建（同 runner 基类）。
- **LHM 的 lbs 把 root trans 拆在矩阵外**：FK 关节轨迹（`T_posed@joint_null`）在 root 相对系（z≈0），渲染表面点在 +trans 后（z≈6.4）。**坐标对齐拟合时必须给关节补 trans**；把变换烘进 bin 时矩阵只左乘 sR（不含 t），trans 单独 `sR·trans+t`（否则 t 被加两次，分身整体漂移）。
- **动作时长两倍**：`test_video/smplx_params` 的 470 帧 @30fps = 15.7s，是 CoachClip（118 帧 7.867s）的 2 倍——clip 对应其前 235 帧 2:1（头 Y 互相关 mse=0.009 实锤）。凡按 clip 对齐的产物（KINEXGS1 bin、多角度 mp4）都要先裁剪到前 235 帧再定时到 7.83s，否则动作 2 倍速。
- **磁盘已扩**：数据盘 50G→200G（2026-07-18，控制台重启生效）。
- **前后端 progress 量纲**：后端 `/import/jobs` 的 progress 是 0–100，前端消费时自行归一（曾按 0..1 直接 clamp，进度条开局即满格）。
- **分身缓存按 URL 校验**：`avatarBySeed` 缓存键带 url（曾只按 seedId 缓存，任务替换 avatarUrl 后旧分身顶包）。
- **水合顺序**：服务端 jobs 是 newest-first，按列表顺序覆盖会让最旧的赢——按 finishedAt 取每种子最新 done（Stub 测试任务曾靠这条 bug 长期占位）。

## 七、日常命令

```bash
npm run dev     # 本地前端 :5173
npm run check   # 唯一门禁（构建 + guardrails），改完必跑
git push origin main
```

后端联调/导入演示：创作工坊 `#/create` 上传视频 → :8765 重建 → 新种子入库。
烘焙新分身：MimicMotion 改 `configs/kinex_squat.yaml` 的 `ref_image_path`（换照片即换分身），跑一次 ~17 分钟。

## 八、文档地图

- `docs/review.md`：评审报告 + 打磨清单（P0✅/P1/P2 勾选状态）
- `docs/curren.md`：系统当前事实状态
- `docs/project_index.md`：模块索引与协作边界
- `docs/server-workflow.md`：AutoDL 完整工作流（隧道/同步/演示清单）
- `docs/motion-frame.schema.json`：帧数据契约
- `docs/handoff.md`：本文
