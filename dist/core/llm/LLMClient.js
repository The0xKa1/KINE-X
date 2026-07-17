import { API_BASE_URL } from "../../config.js";

                              
                                        
                  
 

                         
                       
                     
                       
 

const DEFAULT_MAX_TOKENS = 320;
const DEFAULT_TEMPERATURE = 0.6;

export async function streamChat(
  messages               ,
  onDelta                        ,
  options                = {},
)                  {
  const init              = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    }),
  };
  if (options.signal) {
    init.signal = options.signal;
  }
  const response = await fetch(`${API_BASE_URL}/api/chat-stream`, init);

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
