import { OneEuroFilter, DEFAULT_ONE_EURO_PARAMS } from "../scoring/OneEuroFilter.js?v=0.1.8";
import { JOINT_NAMES } from "./CoachClip.js?v=0.1.8";


const TARGET_HEIGHT_METERS = 1.0;

export function postProcessFrames(input                            , fps        )                 {
  const filled = fillGaps(input);
  if (filled.length === 0) return [];
  const smoothed = smoothOverTime(filled, fps);
  const centered = recenter(smoothed);
  const scaled = normalizeHeight(centered);
  return scaled;
}

function fillGaps(input                            )                 {
  const total = input.length;
  if (total === 0) return [];

  let firstReal = -1;
  for (let i = 0; i < total; i += 1) {
    if (input[i]) { firstReal = i; break; }
  }
  if (firstReal === -1) return [];

  const result                 = new Array(total);
  for (let i = 0; i < firstReal; i += 1) {
    result[i] = clonePose(input[firstReal] );
  }
  result[firstReal] = clonePose(input[firstReal] );

  let prevReal = firstReal;
  for (let i = firstReal + 1; i < total; i += 1) {
    const current = input[i];
    if (current) {
      // bridge the gap between prevReal and i with linear interpolation
      const gap = i - prevReal;
      if (gap > 1) {
        const a = result[prevReal] ;
        for (let k = 1; k < gap; k += 1) {
          const t = k / gap;
          result[prevReal + k] = lerpPose(a, current, t);
        }
      }
      result[i] = clonePose(current);
      prevReal = i;
    }
  }
  // tail
  for (let i = prevReal + 1; i < total; i += 1) {
    result[i] = clonePose(result[prevReal] );
  }
  return result;
}

function smoothOverTime(frames                , fps        )                 {
  const dtMs = 1000 / Math.max(1, fps);
  const filters                  = [];
  for (let i = 0; i < JOINT_NAMES.length * 3; i += 1) {
    filters.push(new OneEuroFilter(DEFAULT_ONE_EURO_PARAMS));
  }
  return frames.map((frame, i) => {
    const t = i * dtMs;
    const out = {}                ;
    JOINT_NAMES.forEach((name           , ji        ) => {
      const src = frame[name];
      const fx = filters[ji * 3] ;
      const fy = filters[ji * 3 + 1] ;
      const fz = filters[ji * 3 + 2] ;
      const smoothed             = [
        fx.filter(src.position[0], t),
        fy.filter(src.position[1], t),
        fz.filter(src.position[2], t),
      ];
      out[name] = { position: smoothed, rotation: src.rotation };
    });
    return out;
  });
}

function recenter(frames                )                 {
  return frames.map((frame) => {
    const [px, py, pz] = frame.pelvis.position;
    const out = {}                ;
    JOINT_NAMES.forEach((name           ) => {
      const src = frame[name];
      out[name] = {
        position: [src.position[0] - px, src.position[1] - py, src.position[2] - pz],
        rotation: src.rotation,
      };
    });
    return out;
  });
}

function normalizeHeight(frames                )                 {
  const heights           = [];
  for (const frame of frames) {
    const h = Math.hypot(
      frame.head.position[0] - frame.pelvis.position[0],
      frame.head.position[1] - frame.pelvis.position[1],
      frame.head.position[2] - frame.pelvis.position[2],
    );
    if (Number.isFinite(h) && h > 0.05) heights.push(h);
  }
  if (heights.length === 0) return frames;
  heights.sort((a, b) => a - b);
  const idx = Math.min(heights.length - 1, Math.floor(heights.length * 0.9));
  const p90 = heights[idx] ?? heights[heights.length - 1] ;
  if (!p90 || p90 < 0.05) return frames;
  const scale = TARGET_HEIGHT_METERS / p90;
  return frames.map((frame) => {
    const out = {}                ;
    JOINT_NAMES.forEach((name           ) => {
      const src = frame[name];
      out[name] = {
        position: [src.position[0] * scale, src.position[1] * scale, src.position[2] * scale],
        rotation: src.rotation,
      };
    });
    return out;
  });
}

function clonePose(pose              )               {
  const out = {}                ;
  JOINT_NAMES.forEach((name           ) => {
    const src = pose[name];
    out[name] = {
      position: [src.position[0], src.position[1], src.position[2]],
      rotation: src.rotation,
    };
  });
  return out;
}

function lerpPose(a              , b              , t        )               {
  const out = {}                ;
  JOINT_NAMES.forEach((name           ) => {
    const ja = a[name];
    const jb = b[name];
    out[name] = {
      position: [
        ja.position[0] + (jb.position[0] - ja.position[0]) * t,
        ja.position[1] + (jb.position[1] - ja.position[1]) * t,
        ja.position[2] + (jb.position[2] - ja.position[2]) * t,
      ],
      rotation: ja.rotation,
    };
  });
  return out;
}
