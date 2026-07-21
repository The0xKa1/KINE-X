import { clamp, lerp, meters } from "../core/coordinates.js?v=0.1.6";
import { quaternionFromAxisAmount } from "../core/three-compat.js?v=0.1.6";












const identityQuat                  = [0, 0, 0, 1];
const jointOrder              = [
  "pelvis",
  "spine",
  "chest",
  "neck",
  "head",
  "lShoulder",
  "rShoulder",
  "lElbow",
  "rElbow",
  "lWrist",
  "rWrist",
  "lHip",
  "rHip",
  "lKnee",
  "rKnee",
  "lAnkle",
  "rAnkle",
];










function metricRisk(score        )             {
  if (score < 68) return "risk";
  if (score < 82) return "warn";
  return "good";
}

function buildMetrics(options                  )                {
  const t = options.progress * Math.PI * 2;
  const strictness = options.mode === "stress" ? 7 : options.mode === "mesh" ? -2 : 0;
  const cameraLift = options.evaluatorActive ? 0 : -3;

  return options.exercise.metrics.map((metric, index) => {
    const wave = Math.sin(t * (1.2 + index * 0.18) + index * 1.7 + options.timestampMs * 0.0004);
    const score = clamp(metric.base + wave * metric.variance + cameraLift - strictness, 44, 99);
    const miss = Math.max(0, 100 - score);
    return {
      ...metric,
      score,
      angleDeltaDeg: metric.angle + miss * 0.16,
      distanceDeltaCm: metric.distance + miss * 0.22,
      risk: metricRisk(score),
    };
  });
}

function joint(position                          , rotation                  = identityQuat) {
  return {
    position: meters(position[0], position[1], position[2]),
    rotation,
  };
}

function buildPose(options                  , variant                 )               {
  const t = options.progress * Math.PI * 2;
  const beat = (Math.sin(t) + 1) / 2;
  const user = variant === "user";
  const drift = user ? 0.16 + (options.mode === "stress" ? 0.08 : 0) : 0;
  const xShift = user ? 0.22 : -0.22;
  const pose               = {
    pelvis: joint([xShift, 0.82, 0]),
    spine: joint([xShift, 1.1, 0]),
    chest: joint([xShift, 1.34, 0]),
    neck: joint([xShift, 1.54, 0]),
    head: joint([xShift, 1.72, 0]),
    lShoulder: joint([xShift - 0.22, 1.42, 0]),
    rShoulder: joint([xShift + 0.22, 1.42, 0]),
    lElbow: joint([xShift - 0.34, 1.18, 0.02]),
    rElbow: joint([xShift + 0.34, 1.18, 0.02]),
    lWrist: joint([xShift - 0.36, 0.96, 0.02]),
    rWrist: joint([xShift + 0.36, 0.96, 0.02]),
    lHip: joint([xShift - 0.14, 0.78, 0]),
    rHip: joint([xShift + 0.14, 0.78, 0]),
    lKnee: joint([xShift - 0.2, 0.46, 0.03]),
    rKnee: joint([xShift + 0.2, 0.46, 0.03]),
    lAnkle: joint([xShift - 0.22, 0.08, 0.08]),
    rAnkle: joint([xShift + 0.22, 0.08, 0.08]),
  };

  if (options.exercise.motion === "squat") {
    const depth = beat;
    pose.pelvis.position[1] -= depth * 0.25;
    pose.spine.position[1] -= depth * 0.22;
    pose.chest.position[1] -= depth * 0.17;
    pose.neck.position[1] -= depth * 0.13;
    pose.head.position[1] -= depth * 0.13;
    pose.lKnee.position[0] -= depth * 0.1 - drift * 0.13;
    pose.rKnee.position[0] += depth * 0.1 - drift * 0.13;
    pose.lKnee.position[1] -= depth * 0.05;
    pose.rKnee.position[1] -= depth * 0.05;
    pose.lElbow.position[1] += depth * 0.18;
    pose.rElbow.position[1] += depth * 0.18;
    pose.lWrist.position[1] += depth * 0.3;
    pose.rWrist.position[1] += depth * 0.3;
    pose.chest.position[2] += depth * 0.08 + drift * 0.12;
  }

  if (options.exercise.motion === "hinge") {
    const hinge = beat;
    pose.pelvis.position[2] -= hinge * 0.12;
    pose.chest.position[2] += hinge * 0.38 + drift * 0.12;
    pose.neck.position[2] += hinge * 0.42 + drift * 0.13;
    pose.head.position[2] += hinge * 0.44 + drift * 0.14;
    pose.lWrist.position[1] = lerp(0.96, 0.44, hinge);
    pose.rWrist.position[1] = lerp(0.96, 0.44, hinge);
    pose.lWrist.position[2] += hinge * 0.28;
    pose.rWrist.position[2] += hinge * 0.28;
    pose.lElbow.position[1] = lerp(1.18, 0.72, hinge);
    pose.rElbow.position[1] = lerp(1.18, 0.72, hinge);
  }

  if (options.exercise.motion === "flow") {
    const flow = Math.sin(t);
    pose.lWrist.position[0] = xShift - 0.5 + flow * 0.2;
    pose.rWrist.position[0] = xShift + 0.5 + flow * 0.2;
    pose.lWrist.position[1] = 1.1 + Math.cos(t) * 0.18;
    pose.rWrist.position[1] = 1.18 - Math.cos(t) * 0.18;
    pose.lElbow.position[0] = xShift - 0.34 + flow * 0.14;
    pose.rElbow.position[0] = xShift + 0.34 + flow * 0.14;
    pose.pelvis.position[0] += flow * 0.07;
    pose.spine.position[0] += flow * 0.06;
    pose.chest.position[0] += flow * 0.05;
  }

  if (options.exercise.motion === "bounce") {
    const bounce = Math.abs(Math.sin(t * 1.5));
    pose.pelvis.position[1] -= bounce * 0.08;
    pose.chest.position[1] -= bounce * 0.06;
    pose.lAnkle.position[0] -= Math.sin(t) * 0.16;
    pose.rAnkle.position[0] += Math.sin(t) * 0.14;
    pose.lKnee.position[0] -= Math.sin(t) * 0.1;
    pose.rKnee.position[0] += Math.sin(t) * 0.08;
    pose.lWrist.position[0] -= Math.cos(t * 1.2) * 0.16;
    pose.rWrist.position[0] += Math.cos(t * 1.2) * 0.16;
    pose.lWrist.position[1] += Math.sin(t * 1.2) * 0.16;
    pose.rWrist.position[1] -= Math.sin(t * 1.2) * 0.16;
  }

  if (options.exercise.motion === "throw") {
    const lift = clamp(beat * 1.25, 0, 1);
    pose.rElbow.position[1] = lerp(1.08, 1.62, lift);
    pose.rWrist.position[1] = lerp(0.96, 1.92, lift);
    pose.rWrist.position[0] += lift * 0.12 + drift * 0.08;
    pose.rElbow.position[0] += lift * 0.1;
    pose.lWrist.position[1] = lerp(0.98, 1.36, lift * 0.7);
    pose.lElbow.position[1] = lerp(1.12, 1.26, lift * 0.7);
    pose.pelvis.position[1] += Math.sin(t) * 0.03;
    pose.lKnee.position[1] += lift * 0.05;
    pose.rKnee.position[1] += lift * 0.05;
  }

  if (user) {
    pose.spine.position[0] += Math.sin(t * 1.9) * drift * 0.14;
    pose.chest.position[0] += Math.sin(t * 1.9) * drift * 0.16;
    pose.head.position[0] += Math.sin(t * 1.9) * drift * 0.17;
    pose.rWrist.position[2] += drift * 0.22;
    pose.lWrist.position[2] -= drift * 0.12;
  }

  jointOrder.forEach((jointName, index) => {
    const amount = Math.sin(t + index * 0.37) * 0.24;
    pose[jointName].rotation = quaternionFromAxisAmount([0.2, 1, 0.16], amount);
  });

  return pose;
}

const FALLBACK_METRIC              = {
  id: "pelvis",
  name: "pelvis",
  base: 100,
  variance: 0,
  angle: 0,
  distance: 0,
  score: 100,
  angleDeltaDeg: 0,
  distanceDeltaCm: 0,
  risk: "good",
};

export function createMockPacket(options                  )                    {
  const metrics = buildMetrics(options);
  const score = Math.round(metrics.reduce((sum, metric) => sum + metric.score, 0) / metrics.length);
  const sorted = [...metrics].sort((a, b) => a.score - b.score);
  const worst              = sorted[0] ?? FALLBACK_METRIC;
  const seedJoints = buildPose(options, "seed");
  const evaluatorJoints = buildPose(options, "user");
  const frame              = {
    frame: options.frame,
    timestampMs: options.timestampMs,
    seedId: options.exercise.id,
    progress: options.progress,
    score,
    combo: clamp(Math.floor((score - 62) / 3), 1, 18),
    riskLabel: worst.risk === "good" ? "Clean alignment" : worst.risk === "warn" ? `Guard ${worst.name}` : `Risk ${worst.name}`,
    globalTransform: {
      translation: meters(0, 0, 0),
      rotation: identityQuat,
    },
    seedJoints,
    joints: evaluatorJoints,
    localRotations: jointOrder.map((jointName) => seedJoints[jointName].rotation),
    metrics,
  };

  return {
    type: "FRAME_STREAM",
    data: frame,
  };
}
