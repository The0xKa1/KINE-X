import { API_BASE_URL } from "../../config.js?v=0.1.1";

































/**
 * Sample frames at a fixed time interval from the seeker. Returns at least one
 * frame even if the video is shorter than the interval. Frames are JPEG-encoded
 * data URLs at the requested max-width, preserving aspect ratio.
 */
export async function sampleFramesAtInterval(
  seeker             ,
  intervalSec        ,
  options                                              = {},
)                          {
  const maxWidth = options.maxWidth ?? 480;
  const jpegQuality = options.jpegQuality ?? 0.72;
  const video = seeker.getVideo();
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("VideoSeeker not loaded or duration unknown");
  }

  const fps = 1 / Math.max(0.1, intervalSec);
  const capture = createFrameCapture(video, maxWidth, jpegQuality);
  const out                 = [];
  await seeker.iterateRange(0, duration, fps, (v, t) => {
    out.push({ dataUrl: capture(v), timestampSec: t });
  });
  return out;
}

function createFrameCapture(
  video                  ,
  maxWidth        ,
  quality        ,
)                                  {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => "";
  return (v) => {
    const vw = v.videoWidth || 640;
    const vh = v.videoHeight || 360;
    const scale = Math.min(1, maxWidth / vw);
    const w = Math.max(1, Math.round(vw * scale));
    const h = Math.max(1, Math.round(vh * scale));
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(v, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  };
}

export class VideoSegmentationClient {
  async segmentVideo(request                          )                                       {
    if (!request.frames.length) {
      throw new Error("没有采样到关键帧,无法分割");
    }
    const init              = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: request.fileName ?? "",
        durationSeconds: request.durationSeconds,
        frames: request.frames,
      }),
    };
    if (request.signal) {
      init.signal = request.signal;
    }
    const response = await fetch(`${API_BASE_URL}/api/segment`, init);

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`后端分割失败 HTTP ${response.status} · ${compact(detail)}`);
    }

    let json                      ;
    try {
      json = (await response.json())                        ;
    } catch {
      throw new Error("后端响应不是合法 JSON");
    }

    const content = json.content;
    if (!content) throw new Error("后端响应缺少 content 字段");
    return normalizeSegmentationContent(content, request.durationSeconds);
  }
}

export function normalizeSegmentationContent(content        , durationSeconds        )                              {
  let parsed         ;
  try {
    parsed = JSON.parse(stripJsonFence(content));
  } catch {
    throw new Error("MLLM 输出不是合法 JSON");
  }
  if (!isRecord(parsed)) throw new Error("MLLM 输出 JSON 必须是对象");

  const rawSegments = Array.isArray(parsed.segments) ? parsed.segments : [];
  if (rawSegments.length === 0) throw new Error("MLLM 输出没有可用 segments");

  const segments                     = [];
  const dropped                                                         = [];
  rawSegments.forEach((item, index) => {
    const result = tryNormalizeSegment(item, index, durationSeconds);
    if ("segment" in result) {
      segments.push(result.segment);
    } else {
      dropped.push({ index, reason: result.reason, raw: item });
    }
  });

  if (dropped.length > 0) {
    console.warn("[VideoSegmentationClient] dropped invalid segments", {
      durationSeconds,
      dropped,
    });
  }

  if (segments.length === 0) {
    throw new Error(
      `MLLM 输出 ${rawSegments.length} 个 segments 全部时间范围无效 ` +
        `(视频长度 ${durationSeconds.toFixed(2)}s)。已在控制台打印原始内容,可调整 prompt 或换模型`,
    );
  }

  return {
    summary: stringValue(parsed.summary) || "AI segmented motion library",
    globalTags: Array.isArray(parsed.globalTags) ? parsed.globalTags.map(stringValue).filter(Boolean) : [],
    segments,
  };
}



function tryNormalizeSegment(value         , index        , durationSeconds        )                 {
  if (!isRecord(value)) return { reason: "not an object" };
  const rawStart = numberValue(value.startSec);
  const rawEnd = numberValue(value.endSec);
  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) return { reason: "startSec/endSec not finite" };

  // Clamp to video bounds — models routinely hallucinate times slightly past the end.
  const startSec = clamp(rawStart, 0, durationSeconds);
  const endSec = clamp(rawEnd, 0, durationSeconds);
  if (endSec - startSec < 0.05) {
    return { reason: `degenerate range after clamp [${startSec.toFixed(2)}, ${endSec.toFixed(2)}]` };
  }

  const label = stringValue(value.actionLabel) || stringValue(value.name) || `动作 ${index + 1}`;
  return {
    segment: {
      id: stringValue(value.id) || `seg-${String(index + 1).padStart(2, "0")}`,
      name: stringValue(value.name) || label,
      actionLabel: label,
      startSec,
      endSec,
      confidence: clamp(numberValue(value.confidence, 0.7), 0, 1),
      metadata: normalizeMetadata(value.metadata),
      notes: stringValue(value.notes),
    },
  };
}

function normalizeMetadata(value         )                      {
  if (!isRecord(value)) return {};
  const out                      = {};
  for (const [key, raw] of Object.entries(value)) {
    const cleanKey = key.trim();
    if (!cleanKey) continue;
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
      out[cleanKey] = String(raw).trim();
    } else if (raw != null) {
      out[cleanKey] = JSON.stringify(raw);
    }
  }
  return out;
}

function stripJsonFence(text        )         {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function compact(text        )         {
  return text.replace(/\s+/g, " ").trim().slice(0, 160);
}

function isRecord(value         )                                   {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value         )         {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value         , fallback = Number.NaN)         {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function clamp(value        , min        , max        )         {
  return Math.min(max, Math.max(min, value));
}
