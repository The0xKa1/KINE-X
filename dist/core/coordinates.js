

export const WORLD_SPACE = {
  unit: "meters",
  handedness: "right-hand",
  yAxis: "up",
  xAxis: "right",
  zAxis: "out-of-screen",
  coachCanvasMirrored: false,
  cameraCanvasTransform: "scaleX(-1)",
};

export function meters(x        , y        , z        )             {
  return [x, y, z];
}

export function clamp(value        , min        , max        )         {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a        , b        , t        )         {
  return a + (b - a) * t;
}

export function formatCm(value        )         {
  return `${value.toFixed(1)} cm`;
}

export function formatDeg(value        )         {
  return `${Math.round(value)} deg`;
}
