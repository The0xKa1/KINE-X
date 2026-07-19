import assert from "node:assert/strict";
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
