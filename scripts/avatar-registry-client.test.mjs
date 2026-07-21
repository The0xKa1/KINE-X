import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { AvatarRegistryClient, AvatarRegistryHttpError } from "../dist/core/avatar/AvatarRegistryClient.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("list preserves the server's newest-first record order", async () => {
  const records = [
    { avatarId: "av-new", name: "New", status: "ready", progress: 100, createdAt: 20 },
    { avatarId: "av-old", name: "Old", status: "error", progress: 71, createdAt: 10 },
  ];
  const calls = [];
  const client = new AvatarRegistryClient("http://backend.test/", {
    fetch: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(records);
    },
  });

  const result = await client.list();

  assert.deepEqual(result, records);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://backend.test/avatars");
  assert.equal(calls[0].init?.method, "GET");
});

test("upload sends the selected photo and trimmed name as multipart form data", async () => {
  const calls = [];
  const client = new AvatarRegistryClient("http://backend.test", {
    fetch: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ avatarId: "av-1", name: "Kai", status: "queued", progress: 0, createdAt: 1 }, 202);
    },
  });
  const photo = new File(["pixels"], "kai.png", { type: "image/png" });

  await client.upload(photo, "  Kai  ");

  assert.equal(calls[0].url, "http://backend.test/avatars");
  assert.equal(calls[0].init.method, "POST");
  assert.ok(calls[0].init.body instanceof FormData);
  assert.equal(calls[0].init.body.get("photo"), photo);
  assert.equal(calls[0].init.body.get("name"), "Kai");
  assert.equal(calls[0].init.headers, undefined);
});

test("rename and remove use the avatar resource contract", async () => {
  const calls = [];
  const client = new AvatarRegistryClient("http://backend.test", {
    fetch: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ avatarId: "av/a b", name: "Reframed", status: "ready", progress: 100, createdAt: 1 });
    },
  });

  await client.rename("av/a b", "  Reframed  ");
  await client.remove("av/a b");

  assert.equal(calls[0].url, "http://backend.test/avatars/av%2Fa%20b");
  assert.equal(calls[0].init.method, "PATCH");
  assert.equal(calls[0].init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), { name: "Reframed" });
  assert.equal(calls[1].url, "http://backend.test/avatars/av%2Fa%20b");
  assert.equal(calls[1].init.method, "DELETE");
});

test("watch polls only while a queued or running record exists", async () => {
  const batches = [
    [{ avatarId: "av-1", name: "Kai", status: "running", progress: 42, createdAt: 1 }],
    [{ avatarId: "av-1", name: "Kai", status: "ready", progress: 100, createdAt: 1 }],
  ];
  const scheduled = [];
  const updates = [];
  const client = new AvatarRegistryClient("http://backend.test", {
    fetch: async () => jsonResponse(batches.shift()),
    schedule: (callback, delayMs) => {
      scheduled.push({ callback, delayMs });
      return scheduled.length;
    },
    cancelSchedule: () => {},
    pollIntervalMs: 2750,
  });

  const stop = client.watch((records) => updates.push(records));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(updates.length, 1);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delayMs, 2750);

  scheduled[0].callback();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(updates.length, 2);
  assert.equal(scheduled.length, 1, "all-terminal results must stop polling");
  stop();
});

test("HTTP errors surface backend detail messages", async () => {
  const client = new AvatarRegistryClient("http://backend.test", {
    fetch: async () => jsonResponse({ detail: { error: "photo exceeds 20MB", stage: "input" } }, 400),
  });

  await assert.rejects(
    () => client.upload(new File(["x"], "x.png", { type: "image/png" }), "X"),
    (error) => {
      assert.ok(error instanceof AvatarRegistryHttpError);
      assert.equal(error.status, 400);
      assert.equal(error.message, "photo exceeds 20MB");
      return true;
    },
  );
});

test("network failures are labeled as offline errors", async () => {
  const client = new AvatarRegistryClient("http://backend.test", {
    fetch: async () => {
      throw new TypeError("fetch failed");
    },
  });

  await assert.rejects(
    () => client.list(),
    (error) => {
      assert.equal(error.name, "AvatarRegistryOfflineError");
      assert.equal(error.message, "无法连接分身服务");
      return true;
    },
  );
});

test("watch retries transient list failures with bounded backoff until records are terminal", async () => {
  const responses = [
    () => jsonResponse([{ avatarId: "av-1", name: "Kai", status: "running", progress: 42, createdAt: 1 }]),
    () => { throw new TypeError("temporary network loss"); },
    () => { throw new TypeError("temporary network loss"); },
    () => jsonResponse([{ avatarId: "av-1", name: "Kai", status: "ready", progress: 100, createdAt: 1 }]),
  ];
  const queue = [];
  const delays = [];
  const updates = [];
  const errors = [];
  const client = new AvatarRegistryClient("http://backend.test", {
    fetch: async () => responses.shift()(),
    schedule: (callback, delayMs) => {
      delays.push(delayMs);
      queue.push(callback);
      return delays.length;
    },
    cancelSchedule: () => {},
    pollIntervalMs: 100,
    maxPollIntervalMs: 150,
  });

  const stop = client.watch(
    (records) => updates.push(records),
    (error) => errors.push(error),
  );
  await flushAsync();
  queue.shift()();
  await flushAsync();
  queue.shift()();
  await flushAsync();
  queue.shift()();
  await flushAsync();

  assert.deepEqual(delays, [100, 100, 150]);
  assert.equal(errors.length, 2);
  assert.equal(updates.length, 2);
  assert.equal(queue.length, 0, "terminal records stop retry polling");
  stop();
});

test("stopping watch prevents a queued callback from issuing another request", async () => {
  const queued = [];
  let fetchCount = 0;
  const client = new AvatarRegistryClient("http://backend.test", {
    fetch: async () => {
      fetchCount += 1;
      return jsonResponse([{ avatarId: "av-1", name: "Kai", status: "running", progress: 42, createdAt: 1 }]);
    },
    schedule: (callback) => {
      queued.push(callback);
      return queued.length;
    },
    cancelSchedule: () => {},
  });

  const stop = client.watch(() => {});
  await flushAsync();
  const staleCallback = queued.shift();
  stop();
  staleCallback();
  await flushAsync();

  assert.equal(fetchCount, 1);
});

test("generation guard invalidates stale completions across leave and re-enter", async () => {
  const module = await import("../dist/core/avatar/AvatarRegistryClient.js");
  const guard = new module.AsyncGenerationGuard();

  const first = guard.enter();
  guard.leave();
  const second = guard.enter();

  assert.equal(guard.isCurrent(first), false);
  assert.equal(guard.isCurrent(second), true);
  guard.leave();
  assert.equal(guard.isCurrent(second), false);
});

test("rename drafts preserve unsaved value and focus metadata across server refreshes", async () => {
  const module = await import("../dist/core/avatar/AvatarRegistryClient.js");
  const drafts = new module.AvatarRenameDraftStore();
  drafts.begin("av-1", "Server name");
  drafts.capture("av-1", "Unsaved draft", true, 3, 8);

  assert.deepEqual(drafts.read("av-1", "Refreshed server name"), {
    value: "Unsaved draft",
    focused: true,
    selectionStart: 3,
    selectionEnd: 8,
  });

  drafts.finish("av-1");
  assert.deepEqual(drafts.read("av-1", "Refreshed server name"), {
    value: "Refreshed server name",
    focused: false,
    selectionStart: null,
    selectionEnd: null,
  });
});

function flushAsync() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("preview state author styles preserve the hidden contract", async () => {
  const css = await readFile(new URL("../src/styles/avatar-vault.css", import.meta.url), "utf8");

  assert.match(
    css,
    /\.avatar-preview-state\[hidden\]\s*\{[^}]*display\s*:\s*none\s*;/s,
    "the page-local display rule must not override hidden preview overlays",
  );
});

test("preview canvas cannot feed intrinsic dimensions back into the grid row", async () => {
  const css = await readFile(new URL("../src/styles/avatar-vault.css", import.meta.url), "utf8");
  const stage = cssRuleBody(css, ".avatar-preview-stage");
  const canvas = cssRuleBody(css, "#avatarPreviewCanvas");

  assert.match(
    css,
    /\.avatar-preview-panel\s*\{[^}]*grid-template-rows\s*:\s*auto\s+minmax\(280px,\s*1fr\)\s+auto\s*;/s,
  );
  assert.match(stage, /position\s*:\s*relative\s*;/);
  assert.match(stage, /min-height\s*:\s*0\s*;/);
  assert.match(stage, /overflow\s*:\s*hidden\s*;/);
  assert.match(canvas, /position\s*:\s*absolute\s*;/);
  assert.match(canvas, /inset\s*:\s*0\s*;/);
  assert.match(canvas, /width\s*:\s*100%\s*;/);
  assert.match(canvas, /height\s*:\s*100%\s*;/);
  assert.match(canvas, /min-height\s*:\s*0\s*;/);
});

test("desktop vault keeps document height bounded and delegates scrolling to the archive list", async () => {
  const css = await readFile(new URL("../src/styles/avatar-vault.css", import.meta.url), "utf8");
  const shell = cssRuleBody(css, 'body[data-route="avatars"] .app-shell');
  const workspace = cssRuleBody(css, 'body[data-route="avatars"] .workspace');
  const list = cssRuleBody(css, ".avatar-vault-list");

  assert.match(shell, /height\s*:\s*100vh\s*;/);
  assert.match(workspace, /min-height\s*:\s*0\s*;/);
  assert.match(list, /overflow\s*:\s*auto\s*;/);
});

function cssRuleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "s"));
  assert.ok(match, `missing CSS rule ${selector}`);
  return match[1];
}
