要在网页端实现“实时摄像头采集 → 姿态估计 → 与标准 3D 动作比对打分”的完整闭环，并且保证 30+ FPS 的极低延迟，最核心的工程策略是：“计算本地化，比对轻量化”。

绝对不要把评委的现场视频流实时传回后端服务器，那样带宽和延时会瞬间把系统拖垮。正确的做法是利用 MediaPipe (BlazePose) 在前端浏览器本地完成 3D 骨骼提取，然后与后端传来的标准 KINE//X 动作序列在前端进行高频数学比对。

以下是为你梳理的完整前端实时打分技术实现方案与核心代码：

🛠️ 实时打分系统的三层架构

[ 1. 采集与预测 (MediaPipe) ]  ──► 实时抓取评委身体的 33 个 3D 关键点 (Camera 坐标系)

              │

              ▼

[ 2. 空间与时序对齐 (工程对齐) ] ──► 消除评委高矮胖瘦、站位远近的干扰

              │

              ▼

[ 3. 仿射相似度计算 (数学打分) ] ──► 计算核心关节角度的四元数内积 ──► 触发游戏化 UI

一、 第一步：本地轻量化 3D 姿态估计 (MediaPipe)

首先在前端 WebCamManager.tsx 中引入 MediaPipe，捕获评委的 3D 骨骼点。MediaPipe 吐出的坐标是相机坐标系下的相对空间位置（以人体骨盘为中心）。

TypeScript



import { Pose, LandmarkList } from '@mediapipe/pose';// 初始化 MediaPipe Poseconst pose = new Pose({

  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,

});



pose.setOptions({

  modelComplexity: 1, // 1 为平衡，2 为最高精度（黑客松推荐 1，保证帧率）

  smoothLandmarks: true,

  minDetectionConfidence: 0.5,

  minTrackingConfidence: 0.5,

});// 监听摄像头帧的实时预测输出

pose.onResults((results) => {

  if (!results.poseWorldLandmarks) return;

  

  // poseWorldLandmarks 包含了 33 个点在真实世界（米）下的 3D 相对坐标

  const judgeKeypoints3D = results.poseWorldLandmarks;

  

  // 触发对齐与打分引擎

  processMotionMatching(judgeKeypoints3D);

});

二、 第二步：消除干扰的“空间归一化”（工程关键）

评委在摄像头前站得远或近、长得高或矮，都会让原始的 3D 坐标绝对值产生巨大偏差。绝不能直接去比对坐标的距离，必须将其转化为“与体型无关的关节点向量/角度”：

1. 向量化表示

我们将核心骨骼（如：大腿、小腿、大臂、前臂）抽象为空间方向向量。

例如，右前臂向量 = 右手腕 3D 坐标 — 右手肘 3D 坐标：

$$\vec{v}_{\text{forearm}} = P_{\text{wrist}} - P_{\text{elbow}}$$

2. 局部坐标系规范（或者计算骨骼夹角）

直接比对向量的夹角余弦值（Cosine Similarity），这能天然免疫体型和距离的干扰：

TypeScript



// 计算两个 3D 关键点构成的骨骼向量function getBoneVector(p1: any, p2: any): THREE.Vector3 {

  return new THREE.Vector3(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z).normalize();

}// 计算两条骨骼之间的夹角相似度（如大臂与前臂的夹角）function calculateJointMatch(v1: THREE.Vector3, v2: THREE.Vector3): number {

  const dotProduct = v1.dot(v2); // 向量内积，因为已经 normalize，结果在 [-1, 1] 之间

  // 将 [-1, 1] 映射到 [0, 1] 的得分区间

  return (dotProduct + 1) / 2;

}

三、 第三步：高频比对与动态打分管线 (The Evaluation Engine)

在页面的 Three.js 主循环中，我们要拿着评委这一帧的骨骼向量，去跟后端通过 WebSocket 广播出来的标准 KINE//X 帧进行对齐。

为了让打分更符合人类直觉，我们需要对核心运动关节进行加权权重（Weighting）：如果是做深蹲，就重点看膝盖和髋关节；如果是挥拳，就重点看手肘和肩膀。

TypeScript



// 核心比对函数：评委实时点 vs 标准动作帧function processMotionMatching(judgePoints: LandmarkList) {

  if (!latestFrameBuffer.current) return; // 确保收到后端标准帧

  const coachFrame = latestFrameBuffer.current;



  // 1. 提取评委的核心骨骼向量（以右手臂为例：MediaPipe 12=右肩, 14=右手肘, 16=右手腕）

  const judgeRightUpperArm = getBoneVector(judgePoints[12], judgePoints[14]);

  const judgeRightForearm  = getBoneVector(judgePoints[14], judgePoints[16]);



  // 2. 提取标准教练的对应骨骼向量

  // 提示：后端发来的是 SMPL 旋转，可以直接通过 Three.js 的标准小人骨骼节点计算出世界坐标向量

  const coachBones = coachSkinnedMesh.skeleton.bones;

  // SMPL 索引：17 为右肩，19 为右手肘，21 为右手腕

  const coachRightUpperArm = new THREE.Vector3().subVectors(bones[19].position, bones[17].position).normalize();

  const coachRightForearm  = new THREE.Vector3().subVectors(bones[21].position, bones[19].position).normalize();



  // 3. 计算各个关键部位的相似度得分

  const scoreRightArm = calculateJointMatch(judgeRightUpperArm, coachRightUpperArm);

  const scoreRightForearm = calculateJointMatch(judgeRightForearm, coachRightForearm);

  

  // 4. 加权综合得分 (根据当前动作动态调配权重)

  // 假设当前是上肢动作，手臂权重各占 50%

  const finalFrameScore = (scoreRightArm * 0.5 + scoreRightForearm * 0.5) * 100;



  // 5. 驱动游戏化 UI 状态更新

  updateGameUI(finalFrameScore);

}

四、 第四步：配合海报秩序感的“高冷游戏化Feedback”

计算出 finalFrameScore 之后，我们如何让它在页面上优雅地呈现，既好玩，又符合海报的高级感？

TypeScript



let combo = 0;function updateGameUI(score: number) {

  // 1. 动态数字更新：让等宽字体数字（如 93%）在页面右上角利落跳动

  scoreElement.innerText = `${Math.round(score)}%`;

  

  // 2. 实时误差标尺（海报中的橙色折线图数据注入）

  const jointErrorDeg = Math.acos((score / 100) * 2 - 1) * (180 / Math.PI);

  errorTextElement.innerText = `${jointErrorDeg.toFixed(1)}°`;



  // 3. 克制的 Combo 触发机制 (Octalysis CD2 落地)

  if (score > 90) { // PERFECT 阈值

    combo++;

    // 触发工业橙高亮闪烁，或者给 UI 边缘拉出一道莫兰迪蓝的细边框

    statusTag.innerText = "PERFECT ALIGNMENT";

    statusTag.style.color = "#00FFCC"; // 霓虹青

    comboElement.innerText = `COMBO ${combo}`;

    comboElement.style.transform = "scale(1.05)"; // 极微弱的瞬时震动

  } else if (score > 75) {

    statusTag.innerText = "GOOD";

    statusTag.style.color = "#111111"; // 恢复常态黑

  } else {

    combo = 0; // Combo 中断 (黑客松黑帽驱动，让评委产生紧张感)

    statusTag.innerText = "ALIGNMENT DISTORTION";

    statusTag.style.color = "#FF5500"; // 工业橙警告

    comboElement.innerText = "";

  }

}

💡 黑客松答辩时的“防翻车”工程底线：时序对齐（DTW）延迟容忍

现场演示时，评委的动作往往会比屏幕上的教练慢半拍（大约 200ms-500ms 的人类反应延迟）。如果直接进行“当前绝对帧对齐”，评委即使动作做得很标准，也会因为“做慢了”被判为 MISS。

最优雅的解法（作弊码）： 前端建立一个容量为 15 帧的历史滑动窗口（History Buffer），存放最近半秒内教练的标准动作。当评委做完一个动作，前端自动拿评委的当前状态，去跟这 15 帧历史数据逐一比对，取相似度最高的那一帧作为最终得分。
