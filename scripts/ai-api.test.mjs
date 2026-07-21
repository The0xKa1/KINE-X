import assert from "node:assert/strict";
import test from "node:test";

import { streamChat } from "../dist/core/llm/LLMClient.js";
import { VideoSegmentationClient } from "../dist/core/mllm/VideoSegmentationClient.js";

const settings = {
  baseUrl: "https://provider.example/v1/",
  apiKey: "test-key",
  model: "vision-model",
};

test("streamChat calls the configured OpenAI-compatible endpoint", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let requestUrl = "";
  let requestInit;
  globalThis.fetch = async (url, init) => {
    requestUrl = String(url);
    requestInit = init;
    const sse = 'data: {"choices":[{"delta":{"content":"动作"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"稳定"}}]}\n\n' +
      "data: [DONE]\n\n";
    return new Response(sse, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  };

  const deltas = [];
  const output = await streamChat(
    settings,
    [{ role: "user", content: "分析这次训练" }],
    (delta) => deltas.push(delta),
  );

  assert.equal(requestUrl, "https://provider.example/v1/chat/completions");
  assert.equal(requestInit.headers.Authorization, "Bearer test-key");
  const payload = JSON.parse(requestInit.body);
  assert.equal(payload.model, "vision-model");
  assert.equal(payload.stream, true);
  assert.equal(output, "动作稳定");
  assert.deepEqual(deltas, ["动作", "稳定"]);
});

test("VideoSegmentationClient sends timestamped images directly to the configured MLLM", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let requestUrl = "";
  let requestInit;
  globalThis.fetch = async (url, init) => {
    requestUrl = String(url);
    requestInit = init;
    const content = JSON.stringify({
      summary: "单次深蹲",
      globalTags: ["深蹲"],
      segments: [
        {
          id: "seg-1",
          name: "下蹲与起身",
          actionLabel: "深蹲",
          startSec: 0,
          endSec: 2.5,
          confidence: 0.9,
          metadata: { 难度: "中等" },
          notes: "动作完整",
        },
      ],
    });
    return Response.json({ choices: [{ message: { content } }] });
  };

  const result = await new VideoSegmentationClient().segmentVideo(settings, {
    fileName: "squat.mp4",
    durationSeconds: 3,
    frames: [{ timestampSec: 1.5, dataUrl: "data:image/jpeg;base64,AAAA" }],
  });

  assert.equal(requestUrl, "https://provider.example/v1/chat/completions");
  assert.equal(requestInit.headers.Authorization, "Bearer test-key");
  const payload = JSON.parse(requestInit.body);
  assert.equal(payload.model, "vision-model");
  assert.equal(payload.stream, false);
  assert.equal(payload.response_format.type, "json_object");
  assert.equal(payload.messages[1].content[2].type, "image_url");
  assert.equal(result.segments[0].actionLabel, "深蹲");
  assert.equal(result.segments[0].endSec, 2.5);
});

test("AI clients reject incomplete user configuration before fetching", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    throw new Error("fetch should not run");
  };

  await assert.rejects(
    () => streamChat({ ...settings, apiKey: "" }, [], () => {}),
    /Base URL、API Key 和模型/,
  );
  await assert.rejects(
    () => new VideoSegmentationClient().segmentVideo({ ...settings, model: "" }, {
      durationSeconds: 1,
      frames: [{ timestampSec: 0, dataUrl: "data:image/jpeg;base64,AAAA" }],
    }),
    /Base URL、API Key 和模型/,
  );
});
