import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { streamChat } from "../dist/core/llm/LLMClient.js";
import {
  probeCoachConnection,
  probeMllmConnection,
} from "../dist/core/llm/LlmConnectionProbe.js";
import {
  buildDiagnosisMessages,
  buildFollowupMessages,
  FOLLOWUP_MAX_HISTORY_CHARS,
  FOLLOWUP_MAX_QUESTION_CHARS,
  FOLLOWUP_MAX_ROUNDS,
  limitFollowupHistory,
} from "../dist/core/llm/buildPrompt.js";
import { VideoSegmentationClient } from "../dist/core/mllm/VideoSegmentationClient.js";

const settings = {
  baseUrl: "https://provider.example/v1/",
  apiKey: "test-key",
  model: "vision-model",
};

const exercise = {
  id: "squat",
  name: "单腿深蹲",
  discipline: "strength",
  motion: "squat",
  durationSeconds: 8,
};

const session = {
  frames: 180,
  durationSeconds: 7.9,
  avgScore: 76.4,
  worstFrameScore: 48.2,
  worstPhase: "peak",
  phaseAvgScores: { intro: 89.2, mid: 77.6, peak: 61.3, outro: 82.1 },
  joints: [{
    id: "knee",
    name: "右膝",
    avgScore: 64.2,
    worstScore: 41.8,
    worstAngleDeltaDeg: 18.6,
    worstDistanceDeltaCm: 7.4,
    worstAtProgress: 0.68,
    riskHits: 3,
  }],
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

test("connection test probes the real multimodal and streaming contracts", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const requests = [];
  globalThis.fetch = async (url, init) => {
    const payload = JSON.parse(init.body);
    requests.push({ url: String(url), init, payload });
    if (payload.stream) {
      return new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    return Response.json({ choices: [{ message: { content: '{"status":"ok"}' } }] });
  };

  const [mllm, coach] = await Promise.all([
    probeMllmConnection(settings, "data:image/png;base64,AAAA"),
    probeCoachConnection({ ...settings, model: "coach-model" }),
  ]);

  assert.ok(mllm.latencyMs >= 0);
  assert.ok(coach.latencyMs >= 0);
  assert.equal(requests.length, 2);
  const mllmRequest = requests.find((request) => request.payload.stream === false);
  const coachRequest = requests.find((request) => request.payload.stream === true);
  assert.equal(mllmRequest.url, "https://provider.example/v1/chat/completions");
  assert.equal(mllmRequest.payload.response_format.type, "json_object");
  assert.equal(mllmRequest.payload.messages[1].content[1].type, "image_url");
  assert.equal(coachRequest.payload.model, "coach-model");
  assert.equal(coachRequest.payload.max_tokens, 8);
});

test("coach connection test rejects an empty or incompatible stream", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => new Response("data: [DONE]\n\n", { status: 200 });

  await assert.rejects(
    () => probeCoachConnection(settings),
    /未返回可解析的流式文本/,
  );
});

test("follow-up chat uses a dedicated grounded prompt instead of the diagnosis format", () => {
  const diagnosis = buildDiagnosisMessages(exercise, session, "biomech");
  const followup = buildFollowupMessages(
    exercise,
    session,
    "biomech",
    "右膝在底点偏差 18.6°。",
    [],
    "为什么会内扣？",
  );

  assert.match(diagnosis[0].content, /仅输出诊断正文，120 字以内/);
  assert.doesNotMatch(followup[0].content, /仅输出诊断正文/);
  assert.match(followup[0].content, /明确区分可测量事实与生物力学推断/);
  assert.match(followup[0].content, /不作疾病或损伤诊断/);
  assert.match(followup[1].content, /"worstAngleDeltaDeg":18\.6/);
  assert.equal(followup[2].role, "assistant");
  assert.match(followup[2].content, /首轮诊断/);
  assert.deepEqual(followup.at(-1), { role: "user", content: "为什么会内扣？" });
});

test("follow-up history keeps only recent complete rounds within the character budget", () => {
  const history = [];
  for (let index = 1; index <= 7; index += 1) {
    history.push({ role: "user", content: `问题 ${index}` });
    history.push({ role: "assistant", content: `回答 ${index}` });
  }
  const limited = limitFollowupHistory(history);
  assert.equal(limited.length, FOLLOWUP_MAX_ROUNDS * 2);
  assert.equal(limited[0].content, "问题 4");
  assert.equal(limited.at(-1).content, "回答 7");

  const oversized = limitFollowupHistory([
    { role: "user", content: "问".repeat(FOLLOWUP_MAX_HISTORY_CHARS) },
    { role: "assistant", content: "答".repeat(FOLLOWUP_MAX_HISTORY_CHARS) },
  ]);
  assert.ok(oversized.reduce((sum, message) => sum + message.content.length, 0) <= FOLLOWUP_MAX_HISTORY_CHARS);

  const messages = buildFollowupMessages(
    exercise,
    session,
    "biomech",
    "",
    history,
    "新".repeat(FOLLOWUP_MAX_QUESTION_CHARS + 80),
  );
  assert.equal(messages.at(-1).content.length, FOLLOWUP_MAX_QUESTION_CHARS);
});

test("AI settings entry covers both models and targets the AI section", () => {
  const createSource = readFileSync(new URL("../src/components/pages/CreatePage.ts", import.meta.url), "utf8");
  const settingsSource = readFileSync(new URL("../src/components/gameui/CameraSettings.ts", import.meta.url), "utf8");
  const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles/create.css", import.meta.url), "utf8");

  assert.match(createSource, /MLLM \+ POST-MATCH/);
  assert.match(createSource, /配置 AI API/);
  assert.doesNotMatch(createSource, /设置 MLLM API/);
  assert.match(settingsSource, /openAiSettings\(\)/);
  assert.match(settingsSource, /aiApiSection\.scrollIntoView/);
  assert.match(mainSource, /cameraSettings\.openAiSettings\(\)/);
  assert.match(html, /id="aiApiSettingsSection"/);
  assert.match(html, /id="llmTest"/);
  assert.match(html, /赛后分析模型/);
  assert.match(settingsSource, /probeMllmConnection/);
  assert.match(settingsSource, /probeCoachConnection/);
  assert.match(settingsSource, /VERIFIED · MLLM/);
  assert.match(readFileSync(new URL("../src/components/pages/ReportPage.ts", import.meta.url), "utf8"), /buildFollowupMessages/);
  assert.match(css, /\.create-api-settings/);
  assert.match(css, /width: auto/);
});
