# KINE//X 交接文档（Handoff）

> 面向接手 agent / 队友的续跑指南。读完这份就能不重排雷地继续。
> 最后更新：2026-07-18（复赛打磨期，答辩 7.21–23）。

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
- **分身视频**：`ugc_squat_twin.mp4`（MimicMotion 烘焙，照片级）已在舞台上线。
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

**任务：LHM 多角度分身烘焙**（`docs/review.md` P1 的延伸 + 用户拍板的方向）。

1. **短路 checkpoint 下载**：渲染启动时 `from_pretrained` 会从 HF `3DAIGC/LHM-MINI` 重拉（81.4MB 那文件停在 27%）。本地已有 ModelScope 副本：`/root/autodl-tmp/LHM/pretrained_models/models/Damo_XR_Lab--LHM-MINI/snapshots/master/`（config.json、configuration.json、model.safetensors 齐全）。把它铺进 `~/.cache/huggingface/hub/models--3DAIGC--LHM-MINI/snapshots/<sha>/` + `refs/main` 即可跳过。
2. **渲染命令**（在 `/root/autodl-tmp/LHM` 下）：
   ```bash
   HF_ENDPOINT=https://hf-mirror.com PYTORCH_CUDA_ALLOC_CONF=max_split_size_mb:256 \
   /root/autodl-tmp/envs/lhm/bin/python -m LHM.launch infer.human_lrm \
     model_name=LHM-MINI image_input=./train_data/ref_squat.jpg export_video=True \
     motion_seqs_dir=./train_data/custom_motion/test_video/smplx_params \
     motion_img_dir=None vis_motion=true motion_img_need_mask=true \
     render_fps=15 motion_video_read_fps=30
   ```
   产物在 `LHM/outputs/`。
3. **多角度**：渲染相机在 `LHM/runners/infer/utils.py` 的 `prepare_motion_seqs`（render_c2ws 生成处），改相机参数烘 front/side/top 三条 + 一条 360° 转盘（绕 yaw 扫一圈）。
4. **接入前端**：视频放回 `public/coach_clips/`，`data/exercises.ts` 的 `coachVideo` 加 `side`/`top` 字段（集成层已支持多角度源），提交。

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
- **本地没有 ffmpeg**：用 `/opt/homebrew/Caskroom/miniconda/base/lib/python3.13/site-packages/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1`。
- **无头验收工具**：`scripts/shot.mjs`（CDP 截图）+ Chrome `--remote-debugging-port=9223`；截图前确认 dev server 活着，Chrome 僵尸进程先 `pkill -f remote-debugging-port`。

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
