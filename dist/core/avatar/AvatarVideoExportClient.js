

























const EXPORT_STATUSES                      = new Set([
  "queued",
  "running",
  "ready",
  "error",
  "cancelled",
]);

export function buildAvatarVideoExportRequest(
  avatarId        ,
  motionId        ,
)                           {
  return {
    avatarId,
    motionId,
    width: 1920,
    height: 1080,
    background: "#0e0f13",
  };
}

export function resolveAvatarVideoUrl(backendUrl        , videoUrl        )         {
  return new URL(videoUrl, `${backendUrl.replace(/\/$/, "")}/`).toString();
}

export class AvatarVideoExportClient {
                   backendUrl        ;

  constructor(backendUrl        ) {
    this.backendUrl = backendUrl.replace(/\/$/, "");
  }

  async create(request                          )                                   {
    const response = await fetch(`${this.backendUrl}/avatar-video-exports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    return this.readRecord(response, "创建分身视频失败");
  }

  async get(exportId        )                                   {
    const response = await fetch(
      `${this.backendUrl}/avatar-video-exports/${encodeURIComponent(exportId)}`,
      { method: "GET" },
    );
    return this.readRecord(response, "读取导出进度失败");
  }

          async readRecord(
    response          ,
    fallback        ,
  )                                   {
    const payload = (await response.json().catch(() => null))           ;
    if (!response.ok) throw new Error(readError(payload, `${fallback}（HTTP ${response.status}）`));
    return parseRecord(payload);
  }
}

function parseRecord(payload         )                          {
  if (!payload || typeof payload !== "object") throw new Error("分身视频响应格式无效");
  const record = payload                           ;
  const exportId = typeof record.exportId === "string" ? record.exportId : "";
  const avatarId = typeof record.avatarId === "string" ? record.avatarId : "";
  const motionId = typeof record.motionId === "string" ? record.motionId : "";
  const status = typeof record.status === "string" && EXPORT_STATUSES.has(record.status)
    ? (record.status                           )
    : null;
  if (!exportId || !avatarId || !motionId || !status) {
    throw new Error("分身视频响应缺少必要字段");
  }
  return {
    exportId,
    avatarId,
    motionId,
    status,
    progress: typeof record.progress === "number" ? record.progress : status === "ready" ? 100 : 0,
    progressNote: typeof record.progressNote === "string" ? record.progressNote : undefined,
    videoUrl: typeof record.videoUrl === "string" ? record.videoUrl : undefined,
    error: typeof record.error === "string" ? record.error : undefined,
  };
}

function readError(payload         , fallback        )         {
  if (!payload || typeof payload !== "object" || !("detail" in payload)) return fallback;
  const detail = (payload                       ).detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && "error" in detail) {
    return String((detail                      ).error);
  }
  return fallback;
}
