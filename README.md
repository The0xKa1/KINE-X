# KINE//X

[![Award](https://img.shields.io/badge/🏆_抖音AI创变计划-长三角TOP高校站黑客松_赛道二_二等奖-FF1744?style=for-the-badge)](#)

[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r160-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![MediaPipe](https://img.shields.io/badge/MediaPipe-Tasks_Vision-4285F4?logo=google&logoColor=white)](https://developers.google.com/mediapipe)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![SAM 3D Body](https://img.shields.io/badge/SAM_3D_Body-SMPL--X-FF6F00)](https://github.com/facebookresearch/sam)
[![Status](https://img.shields.io/badge/status-prototype-orange)](#)

<table>
<tr>
<td valign="top">

KINE//X 是一个面向运动教学、健身跟练和黑客松现场演示的 Web 原型系统。用户可以导入标准动作视频，系统将其转化为 Action DNA、3D 骨骼轨迹与可播放的虚拟教练；练习者打开摄像头后，浏览器端实时提取身体关键点，与标准动作进行逐帧对齐、评分和风险提示，并在训练结束后生成 AI 教练点评。

把视频里的动作结构化为可计算的运动序列，让用户能旋转观察、慢放拆解、实时比对，并获得关节级反馈。

</td>
</tr>
</table>

## 核心亮点

- **短视频生成虚拟教练**：上传 mp4 / webm 后，后端可通过 SAM 3D Body 生成 `coach.json`、SMPL-X mesh 与逐帧缩略图，前端直接加载为新的动作种子。
- **浏览器端实时姿态估计**：MediaPipe Pose / Hand / Face 资产随仓库离线提供，运行时不依赖 CDN 即可完成本地检测。
- **动作级实时评分**：摄像头采集用户姿态，按关节角度、骨骼方向、3D 距离和动作历史窗口做匹配，输出综合同步分、Combo 与风险关节。
- **可交互 3D 动作舞台**：标准动作在右侧全息舞台中播放，支持 front / side / top 视角、拖拽旋转、滚轮缩放和时间轴 scrub。
- **标定与延迟容忍**：T-pose 标定用于适配不同身高体型；CoachHistory 滑动窗口吸收用户比教练慢半拍的自然反应延迟。
- **AI 教练总结**：训练结束后将 SessionSummary 从浏览器直接交给用户配置的 OpenAI-compatible API，流式输出中文动作反馈。
- **前后端解耦**：高频帧进入 `MotionFrameBuffer`，渲染层由 RAF 主动拉取；低频 UI 事件走 `EventBus`，方便替换真实 WebSocket 后端。

## 系统架构

```mermaid
flowchart LR
  A["标准动作视频"] --> B["Import Backend :8765<br/>SAM 3D Body / SMPL-X"]
  B --> C["CoachClip + MeshClip<br/>coach.json / mesh.bin / thumbnails"]
  C --> D["KINE//X Frontend<br/>TypeScript + Canvas / Three.js"]
  E["用户摄像头"] --> F["MediaPipe Tasks Vision<br/>Pose / Hand / Face"]
  F --> G["PoseScorer<br/>关节角度 / 骨骼方向 / 3D 距离"]
  D --> G
  G --> H["实时反馈<br/>SYNC / Combo / Risk / Timeline"]
  H --> I["SessionRecorder"]
  I --> J["用户配置的 AI API<br/>OpenAI-compatible SSE"]
  J --> K["AI Coach Feedback"]
```

## 模块状态

| 模块 | 当前状态 |
| --- | --- |
| 前端 UI / 动作舞台 / 时间轴 | 已可演示，hash 路由五页（动作库 / 训练舱 / 报告 / 创作 / 分身身份库） |
| MediaPipe Pose / Hand / Face | 已本地离线运行 |
| 视频导入为 CoachClip | 已可用：可选 MLLM 分段，上传 SAM3D 后端逐帧重建；训练舱直接回放原视频切片 |
| 可复用 3DGS 分身 | 已可用：身份（KINEXGI1）× 动作（KINEXGM1）解耦，绑定渐进就绪，训练舱实时组合 |
| 资产缓存一致性 | 前端 `0.1.4`：入口、CSS 依赖和完整本地业务 ES module 图统一版本；可重烘的身份 / 动作 / 预览 URL 按文件状态自动换版 |
| SAM 3D Body 导入后端 | 已接入，需要本机模型资产与 Python 环境 |
| 用户标定与实时评分 | 已可用，摄像头开启后参与评分 |
| Session 结果页与 AI 教练 | 已可用；用户在摄像头设置中填写 Base URL、API Key 与赛后分析模型 |
| Session 历史存档 | 已可用，localStorage 保留最近 20 场，驱动报告页与动作库统计；动作库或当前报告均可确认后删除单场记录 |
| WebSocket 外部帧流 | 接口已预留，当前前端可用本地 RealtimeStream / mock 兜底演示 |

## 技术栈

- **Frontend**：TypeScript, native ES modules, Canvas / Three.js, MediaPipe Tasks Vision
- **Motion Runtime**：Quaternion rotation, right-hand coordinate system, meter-based 3D positions
- **Scoring**：MediaPipe world landmarks, pose normalization, joint-angle solver, One-Euro smoothing, history-window matching
- **Import Backend**：FastAPI, ffmpeg, SAM 3D Body, SMPL-X mesh packing
- **AI API**：浏览器直连用户配置的 OpenAI-compatible `/chat/completions`；MLLM 与赛后分析模型可分别指定
- **Build**：Node `stripTypeScriptTypes`，无打包器；构建时为相对 ES module import 注入与 `package.json` 一致的版本 query，`index.html` 加载同版本 `dist/main.js`

## 快速开始

### 1. 启动前端

```bash
npm run dev
```

然后打开：

```text
http://localhost:5173
```

`npm run dev` 会先执行构建，再用 Python 静态服务器托管前端。页面默认会连接 `ws://localhost:8000/motion`；如果没有真实 WebSocket 后端，系统仍可使用本地 RealtimeStream / mock 路径完成演示。

### 2. 配置用户自己的 AI API

在创作工坊点击紧凑的「配置 AI API」卡片，或打开训练舱右上角的「摄像头与 AI 设置」，页面会直接定位到 **AI API / MLLM + POST-MATCH** 区。MLLM 分片和赛后分析共用前两项连接配置，模型名称分别填写：

- OpenAI-compatible Base URL（例如 `https://api.openai.com/v1`，也可直接填完整的 `/chat/completions` 地址）
- API Key
- MLLM 视频切片模型
- 赛后分析模型

配置保存在当前浏览器的 `localStorage`，视频关键帧和赛后摘要都由浏览器直接发往该 API，不经过 KINE//X 服务器。服务商必须允许浏览器跨域请求；建议使用限额且可随时撤销的 Key，不要在共享设备保存生产密钥。

### 3. 启动 SAM 3D Body 导入后端

视频导入服务位于 `backend/`，用于把上传视频转为 KINE//X 可消费的动作资源。该服务需要本机已准备好 SAM 3D Body、MHR、SMPL-X 相关模型资产。

```bash
# 根据你的 Python / CUDA / 模型路径环境调整
PYTHONPATH=/path/to/sam-3d-body:$(pwd) \
python -m uvicorn backend.app:app --host 0.0.0.0 --port 8765
```

核心端点：

| Method | Path | 用途 |
| --- | --- | --- |
| `GET` | `/healthz` | 检查 SAM 模型加载状态 |
| `GET` | `/import/jobs` | 列出已完成导入任务 |
| `POST` | `/import/video` | 上传视频并生成 CoachClip / MeshClip |

前端默认会访问当前 host 的 `:8765`。如需覆盖导入后端地址，可在 URL 中加入：

```text
http://localhost:5173/?backend=http://localhost:8765
```

## 项目结构

```text
.
├── index.html                 # 浏览器入口，importmap 指向本地 MediaPipe 与本地 Three.js（public/three/）
├── src/                       # TypeScript 源码
│   ├── bootstrap/             # DOM 收集、启动辅助与 mock stream（遗留）
│   ├── components/            # UI 组件：layout / gameui / pages（五页：动作库、训练舱、报告、创作、分身身份库）
│   ├── core/                  # 路由、动作渲染、摄像头、MediaPipe、评分、导入、LLM 客户端
│   ├── data/                  # 内置动作种子与 pipeline 配置
│   ├── hooks/                 # WebSocket 帧流入口
│   ├── styles/                # 分层 CSS
│   └── types/                 # 前后端共享运动数据契约
├── dist/                      # 构建产物，由 scripts/build.mjs 生成
├── public/
│   ├── mediapipe/             # 离线 WASM / task 模型资产
│   ├── three/                 # 本地化 Three.js（r160）
│   └── coach_clips/           # 预置或导入生成的动作资源
├── backend/                   # SAM 3D Body 视频导入服务
├── sam_3d_body/               # SAM / SMPL-X 转换与导出脚本
├── scripts/                   # 构建、guardrail 检查与调试工具
└── docs/                      # 项目文档、视觉参考与后续 demo 视频
```

## 页面与路由

应用为单 DOM 的 hash 路由 SPA（页面切换不重载，MediaPipe / WebSocket / 摄像头流在页面间存活）：

| Route | 页面 | 内容 |
| --- | --- | --- |
| `#/` | 动作库 | 种子卡墙、导入入口、最近训练记录 |
| `#/train/:seedId` | 训练舱 | 摄像头跟练主舞台（镜像 + 3D 教练 + 教练视频 + 实时评分 + 时间轴） |
| `#/report/:sessionId?` | 训练报告 | 总分、关节报告表、阶段均分、AI 教练、历史趋势 |
| `#/create` | 创作工坊 | 视频上传 → MLLM 分片 → SAM3D 重建 → 入库四步向导（可选一个 READY 分身身份） |
| `#/avatars` | 分身身份库 | 照片 → 3DGS 身份：上传、重命名、保守软删除、实时环绕预览 |

训练记录（最近 20 场）保存在浏览器 localStorage（`kinex.sessions.v1`）。动作库列出全部保留记录，每场可单独删除；报告页也可删除当前记录，删除后历史统计和趋势立即重算。

## 运动数据契约

前后端对齐的核心数据包是 `FRAME_STREAM`。所有 3D 坐标单位均为米，坐标系为右手系，旋转统一使用 `[x, y, z, w]` 四元数。

```json
{
  "type": "FRAME_STREAM",
  "data": {
    "frame": 128,
    "timestampMs": 5333,
    "seedId": "squat",
    "progress": 0.42,
    "score": 87,
    "combo": 8,
    "riskLabel": "Guard knee",
    "globalTransform": {
      "translation": [0, 0, 0],
      "rotation": [0, 0, 0, 1]
    },
    "joints": {
      "pelvis": {
        "position": [0, 0.84, 0.18],
        "rotation": [0, 0, 0, 1]
      }
    },
    "seedJoints": {},
    "localRotations": [[0, 0, 0, 1]],
    "metrics": [
      {
        "id": "knee",
        "name": "knee",
        "score": 87,
        "angleDeltaDeg": 8.4,
        "distanceDeltaCm": 11.2,
        "risk": "warn"
      }
    ]
  }
}
```

约束摘要：

- `joints` 与 `seedJoints` 使用同一组 17 个关节名。
- 摄像头视频镜像显示，3D 教练画布不镜像。
- 高频运动帧只进入 `MotionFrameBuffer`，不进入 UI state。
- `MotionStage` 在 `requestAnimationFrame` 中主动读取最新帧并渲染。
- 切换动作种子必须释放旧资源，避免长时间演示时内存泄漏。

## 质量检查

```bash
npm run check
```

该命令会：

- 重新构建 `dist/`
- 检查坐标系、米制单位、摄像头镜像、RAF 拉取、Quaternion smoothing、资源释放等工程守卫
- 禁止在高频路径中引入 `Euler`、`useState`、`ref(`
- 对所有构建后的 JS 文件执行 `node --check`

## 后续规划

- 接入生产级 WebSocket 帧流服务，替换当前演示兜底路径
- 强化 VFR / UGC 视频的逐物理帧处理
- 将 `MotionFrame` 固化为 OpenAPI / JSON Schema 文档
- 为更多动作类型补充专业评分权重与风险规则
- 增加训练计划、课程内容与多 Session 趋势分析

## 为什么是 KINE//X

传统运动视频只能“看”，KINE//X 想把它变成可以计算、可以比较、可以反馈的动作对象。它适合用来展示：

- AI 如何把短视频内容转化为结构化动作数据
- 浏览器端如何完成低延迟姿态估计和实时评分
- 运动教学如何从单向观看升级为交互式训练
- 前端如何在没有重模型实时推理压力的情况下，承接一个可扩展的 3D / AI 体验

KINE//X 当前仍是原型，但它已经具备完整演示闭环：导入标准动作、生成虚拟教练、开启摄像头跟练、实时评分、结算复盘与 AI 教练反馈。
