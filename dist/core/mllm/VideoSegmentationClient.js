
import {
  assertLlmSettings,
  buildLlmHeaders,
  chatCompletionsUrl,

} from "../llm/LLMClient.js?v=0.1.9";
































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
  async segmentVideo(
    settings             ,
    request                          ,
  )                                       {
    if (!request.frames.length) {
      throw new Error("没有采样到关键帧,无法分割");
    }
    assertLlmSettings(settings);
    const init              = {
      method: "POST",
      headers: buildLlmHeaders(settings),
      body: JSON.stringify(buildSegmentationPayload(settings, request)),
    };
    if (request.signal) {
      init.signal = request.signal;
    }
    const response = await fetch(chatCompletionsUrl(settings.baseUrl), init);

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`MLLM 请求失败 HTTP ${response.status} · ${compact(detail)}`);
    }

    let json                                                         ;
    try {
      json = (await response.json())                                                           ;
    } catch {
      throw new Error("MLLM 响应不是合法 JSON");
    }

    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("MLLM 响应缺少 choices[0].message.content");
    return normalizeSegmentationContent(content, request.durationSeconds);
  }
}

const SEGMENT_SYSTEM_PROMPT =
  "你是 KINE//X 的运动视频分析引擎。只输出 JSON，不要输出 Markdown。" +
  "用户会按时间顺序给你若干张关键帧，每张都标有时间戳（秒）。" +
  "请根据动作变化切分完整动作单元，并给出元数据。";

function buildSegmentationPayload(settings             , request                          )         {
  const duration = request.durationSeconds.toFixed(2);
  const intro =
    "请输出 JSON：" +
    '{"summary":"...","globalTags":["..."],"segments":' +
    '[{"id":"seg-1","name":"...","actionLabel":"...","startSec":0,"endSec":2.4,' +
    '"confidence":0.82,"metadata":{"难度":"中等","核心受力部位":"核心/下肢",' +
    '"节奏感":"强"},"notes":"..."}]}。' +
    `视频文件：${request.fileName || "(无名)"}，总时长：${duration} 秒。` +
    `共 ${request.frames.length} 张关键帧；segments 必须按时间升序且 startSec/endSec 在 [0, ${duration}] 内。`;
  const content                                 = [{ type: "text", text: intro }];
  request.frames.forEach((frame, index) => {
    content.push({ type: "text", text: `第 ${index + 1} 张，时间 ${frame.timestampSec.toFixed(2)}s：` });
    content.push({ type: "image_url", image_url: { url: frame.dataUrl } });
  });
  return {
    model: settings.model,
    stream: false,
    response_format: { type: "json_object" },
    temperature: 0.2,
    max_tokens: 1200,
    messages: [
      { role: "system", content: SEGMENT_SYSTEM_PROMPT },
      { role: "user", content },
    ],
  };
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
