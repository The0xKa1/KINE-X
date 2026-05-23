export interface LlmSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

interface StreamOptions {
  signal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
}

const DEFAULT_MAX_TOKENS = 320;
const DEFAULT_TEMPERATURE = 0.6;

export async function streamChat(
  settings: LlmSettings,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  options: StreamOptions = {},
): Promise<string> {
  if (!settings.baseUrl || !settings.apiKey || !settings.model) {
    throw new Error("LLM settings incomplete");
  }
  const url = `${settings.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const init: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
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
  const response = await fetch(url, init);

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
        const json = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
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
