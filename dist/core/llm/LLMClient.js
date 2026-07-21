
















const DEFAULT_MAX_TOKENS = 320;
const DEFAULT_TEMPERATURE = 0.6;

export async function streamChat(
  settings             ,
  messages               ,
  onDelta                        ,
  options                = {},
)                  {
  assertLlmSettings(settings);
  const init              = {
    method: "POST",
    headers: buildLlmHeaders(settings),
    body: JSON.stringify({
      model: settings.model,
      messages,
      stream: true,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    }),
  };
  if (options.signal) {
    init.signal = options.signal;
  }
  const response = await fetch(chatCompletionsUrl(settings.baseUrl), init);

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} · ${text.slice(0, 120)}`);
  }
  const body = response.body;
  if (!body) throw new Error("Empty response body");

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") {
        return full;
      }
      try {
        const json = JSON.parse(data)

         ;
        const piece = json.choices?.[0]?.delta?.content;
        if (typeof piece === "string" && piece.length > 0) {
          full += piece;
          onDelta(piece);
        }
      } catch {
        // tolerate non-JSON keep-alive lines
      }
    }
  }
  return full;
}

export function chatCompletionsUrl(baseUrl        )         {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(normalized)) return normalized;
  return `${normalized}/chat/completions`;
}

export function buildLlmHeaders(settings             )                         {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${settings.apiKey}`,
  };
}

export function assertLlmSettings(settings             )       {
  if (!settings.baseUrl.trim() || !settings.apiKey.trim() || !settings.model.trim()) {
    throw new Error("请先在摄像头设置中填写 Base URL、API Key 和模型");
  }
  let url     ;
  try {
    url = new URL(chatCompletionsUrl(settings.baseUrl));
  } catch {
    throw new Error("Base URL 不是合法网址");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Base URL 仅支持 http/https");
  }
}
