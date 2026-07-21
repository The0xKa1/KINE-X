import {
  assertLlmSettings,
  buildLlmHeaders,
  chatCompletionsUrl,
  streamChat,
  type LlmSettings,
} from "./LLMClient.js";

export interface LlmProbeResult {
  latencyMs: number;
}

export async function probeMllmConnection(
  settings: LlmSettings,
  imageDataUrl: string,
  signal?: AbortSignal,
): Promise<LlmProbeResult> {
  assertLlmSettings(settings);
  const startedAt = Date.now();
  const init: RequestInit = {
    method: "POST",
    headers: buildLlmHeaders(settings),
    body: JSON.stringify({
      model: settings.model,
      stream: false,
      temperature: 0,
      max_tokens: 24,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "你是 API 连通性探针。只输出 JSON。",
        },
        {
          role: "user",
          content: [
            { type: "text", text: '确认能读取图片后，仅返回 {"status":"ok"}。' },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
  };
  if (signal) init.signal = signal;
  const response = await fetch(chatCompletionsUrl(settings.baseUrl), init);

  if (!response.ok) {
    throw new Error(await responseFailure("MLLM", response));
  }
  let payload: { choices?: Array<{ message?: { content?: unknown } }> };
  try {
    payload = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
  } catch {
    throw new Error("MLLM 返回内容不是合法 JSON");
  }
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("MLLM 响应缺少 choices[0].message.content");
  }
  return { latencyMs: Date.now() - startedAt };
}

export async function probeCoachConnection(
  settings: LlmSettings,
  signal?: AbortSignal,
): Promise<LlmProbeResult> {
  const startedAt = Date.now();
  const options: { signal?: AbortSignal; maxTokens: number; temperature: number } = {
    maxTokens: 8,
    temperature: 0,
  };
  if (signal) options.signal = signal;
  const output = await streamChat(
    settings,
    [{ role: "user", content: "这是连通性测试。请只回复 OK。" }],
    () => undefined,
    options,
  );
  if (!output.trim()) {
    throw new Error("赛后模型已连接，但未返回可解析的流式文本");
  }
  return { latencyMs: Date.now() - startedAt };
}

async function responseFailure(label: string, response: Response): Promise<string> {
  const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim();
  return `${label} HTTP ${response.status}${detail ? ` · ${detail.slice(0, 120)}` : ""}`;
}
