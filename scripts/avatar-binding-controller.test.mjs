import assert from "node:assert/strict";
import test from "node:test";

import {
  AVATAR_BINDING_STORAGE_KEY,
  AvatarBindingController,
  appendSelectedAvatar,
  buildAvatarPickerChoices,
  hasPlayableAvatarAsset,
} from "../dist/core/avatar/AvatarBindingController.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function binding(overrides = {}) {
  return {
    seedId: "imported-job-1",
    bindingId: "binding-1",
    avatarId: "av-1",
    motionId: "motion-1",
    status: "queued",
    progress: 0,
    ...overrides,
  };
}

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    read(key) {
      return values.get(key);
    },
  };
}

function makeScheduler() {
  const pending = [];
  const cancelled = [];
  let nextHandle = 1;
  return {
    pending,
    cancelled,
    schedule(callback, delayMs) {
      const handle = nextHandle++;
      pending.push({ handle, callback, delayMs });
      return handle;
    },
    cancel(handle) {
      cancelled.push(handle);
      const index = pending.findIndex((entry) => entry.handle === handle);
      if (index >= 0) pending.splice(index, 1);
    },
    runNext() {
      const next = pending.shift();
      assert.ok(next, "expected a scheduled poll");
      next.callback();
      return next;
    },
  };
}

test("avatar picker defaults to no avatar and disables only unavailable identities", () => {
  const choices = buildAvatarPickerChoices([
    { avatarId: "av-ready", name: "Ready", status: "ready", progress: 100, createdAt: 3, identityUrl: "ready.bin" },
    { avatarId: "av-running", name: "Running", status: "running", progress: 42, createdAt: 2 },
    { avatarId: "av-error", name: "Error", status: "error", progress: 65, createdAt: 1, error: "failed" },
  ]);

  assert.deepEqual(choices.map(({ avatarId, label, disabled }) => ({ avatarId, label, disabled })), [
    { avatarId: null, label: "不使用分身", disabled: false },
    { avatarId: "av-ready", label: "Ready", disabled: false },
    { avatarId: "av-running", label: "Running", disabled: true },
    { avatarId: "av-error", label: "Error", disabled: true },
  ]);
});

test("multipart omits avatarId by default and includes exactly the selected identity", () => {
  const ordinary = new FormData();
  appendSelectedAvatar(ordinary, null);
  assert.equal(ordinary.has("avatarId"), false);

  const selected = new FormData();
  appendSelectedAvatar(selected, "  av-42  ");
  assert.deepEqual(selected.getAll("avatarId"), ["av-42"]);
});

test("playable avatar detection preserves legacy assets and waits for both reusable URLs", () => {
  assert.equal(hasPlayableAvatarAsset({ avatarUrl: "legacy.bin" }), true);
  assert.equal(hasPlayableAvatarAsset({ identityUrl: "identity.bin", motionAssetUrl: "motion.bin" }), true);
  assert.equal(hasPlayableAvatarAsset({ identityUrl: "identity.bin", avatarBindingStatus: "running" }), false);
  assert.equal(hasPlayableAvatarAsset({ avatarBindingStatus: "error", avatarBindingError: "LHM failed" }), false);
});

test("tracking persists pending metadata and deduplicates the background poll", () => {
  const storage = makeStorage();
  const scheduler = makeScheduler();
  const controller = new AvatarBindingController({
    backendUrl: "http://backend.test/",
    storage,
    fetch: async () => jsonResponse([]),
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancel,
  });

  controller.track(binding());
  controller.track(binding({ seedId: "imported-job-2", bindingId: "binding-2", motionId: "motion-2" }));

  const persisted = JSON.parse(storage.read(AVATAR_BINDING_STORAGE_KEY));
  assert.equal(persisted.version, 1);
  assert.equal(persisted.bindings.length, 2);
  assert.equal(scheduler.pending.length, 1, "all pending bindings share one poll timer");
  assert.equal(scheduler.pending[0].delayMs, 0);
});

test("a ready binding hydrates both reusable URLs once and stops polling", async () => {
  const storage = makeStorage();
  const scheduler = makeScheduler();
  const updates = [];
  const ready = [];
  const controller = new AvatarBindingController({
    backendUrl: "http://backend.test",
    storage,
    fetch: async (url, init) => {
      assert.equal(url, "http://backend.test/avatar-bindings");
      assert.equal(init.method, "GET");
      return jsonResponse([
        {
          bindingId: "binding-1",
          avatarId: "av-1",
          motionId: "motion-1",
          status: "ready",
          progress: 100,
          identityUrl: "avatar-identities/av-1/identity.bin",
          motionAssetUrl: "motions/motion-1/motion.bin",
        },
      ]);
    },
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancel,
    onUpdate: (record) => updates.push(record),
    onReady: (record) => ready.push(record),
  });
  controller.track(binding());

  scheduler.runNext();
  await flushAsync();

  assert.equal(ready.length, 1);
  assert.equal(ready[0].identityUrl, "avatar-identities/av-1/identity.bin");
  assert.equal(ready[0].motionAssetUrl, "motions/motion-1/motion.bin");
  assert.equal(controller.get("imported-job-1").status, "ready");
  assert.equal(updates.at(-1).status, "ready");
  assert.equal(scheduler.pending.length, 0);

  await controller.pollNow();
  assert.equal(ready.length, 1, "ready callback is idempotent across refreshes");
});

test("binding errors remain useful metadata without unlocking avatar mode", async () => {
  const scheduler = makeScheduler();
  const failed = [];
  const controller = new AvatarBindingController({
    backendUrl: "http://backend.test",
    storage: makeStorage(),
    fetch: async () => jsonResponse([
      {
        bindingId: "binding-1",
        avatarId: "av-1",
        motionId: "motion-1",
        status: "error",
        progress: 57,
        error: "LHM failed",
      },
    ]),
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancel,
    onTerminalError: (record) => failed.push(record),
  });
  controller.track(binding());

  scheduler.runNext();
  await flushAsync();

  const current = controller.get("imported-job-1");
  assert.equal(current.status, "error");
  assert.equal(current.error, "LHM failed");
  assert.equal(hasPlayableAvatarAsset({
    identityUrl: current.identityUrl,
    motionAssetUrl: current.motionAssetUrl,
    avatarBindingStatus: current.status,
  }), false);
  assert.equal(failed.length, 1);
  assert.equal(scheduler.pending.length, 0);
});

test("stale completion cannot replace a newer binding on the same seed", async () => {
  let resolveFetch;
  const response = new Promise((resolve) => { resolveFetch = resolve; });
  const controller = new AvatarBindingController({
    backendUrl: "http://backend.test",
    storage: makeStorage(),
    fetch: async () => response,
    schedule: () => 1,
    cancelSchedule: () => {},
  });
  controller.track(binding());
  const polling = controller.pollNow();
  controller.track(binding({ bindingId: "binding-new", avatarId: "av-new", motionId: "motion-new" }));

  resolveFetch(jsonResponse([
    {
      bindingId: "binding-1",
      avatarId: "av-1",
      motionId: "motion-1",
      status: "ready",
      progress: 100,
      identityUrl: "stale-identity.bin",
      motionAssetUrl: "stale-motion.bin",
    },
  ]));
  await polling;

  assert.equal(controller.get("imported-job-1").bindingId, "binding-new");
  assert.equal(controller.get("imported-job-1").identityUrl, undefined);
});

test("seed removal invalidates an in-flight binding response", async () => {
  let resolveFetch;
  const response = new Promise((resolve) => { resolveFetch = resolve; });
  const ready = [];
  const controller = new AvatarBindingController({
    backendUrl: "http://backend.test",
    storage: makeStorage(),
    fetch: async () => response,
    schedule: () => 1,
    cancelSchedule: () => {},
    onReady: (record) => ready.push(record),
  });
  controller.track(binding());
  const polling = controller.pollNow();
  controller.remove("imported-job-1");
  resolveFetch(jsonResponse([
    {
      bindingId: "binding-1",
      avatarId: "av-1",
      motionId: "motion-1",
      status: "ready",
      progress: 100,
      identityUrl: "identity.bin",
      motionAssetUrl: "motion.bin",
    },
  ]));
  await polling;

  assert.equal(controller.get("imported-job-1"), null);
  assert.equal(ready.length, 0);
});

test("boot discovery restores a server-only binding and keeps the original import choice", async () => {
  const ready = [];
  const controller = new AvatarBindingController({
    backendUrl: "http://backend.test",
    storage: makeStorage(),
    fetch: async () => jsonResponse([
      {
        bindingId: "binding-later",
        avatarId: "av-later",
        motionId: "motion-job-7",
        status: "ready",
        progress: 100,
        identityUrl: "later-identity.bin",
        motionAssetUrl: "motion-job-7.bin",
        createdAt: 200,
      },
      {
        bindingId: "binding-original",
        avatarId: "av-original",
        motionId: "motion-job-7",
        status: "ready",
        progress: 100,
        identityUrl: "original-identity.bin",
        motionAssetUrl: "motion-job-7.bin",
        createdAt: 100,
      },
    ]),
    schedule: () => 1,
    cancelSchedule: () => {},
    onReady: (record) => ready.push(record),
  });

  await controller.discover(new Map([["motion-job-7", "imported-job-7"]]));

  assert.equal(controller.get("imported-job-7").bindingId, "binding-original");
  assert.equal(controller.get("imported-job-7").avatarId, "av-original");
  assert.equal(ready.length, 1);
  assert.equal(ready[0].seedId, "imported-job-7");
});

test("boot discovery retries a transient offline failure without blocking ordinary seed state", async () => {
  const scheduler = makeScheduler();
  let attempts = 0;
  const controller = new AvatarBindingController({
    backendUrl: "http://backend.test",
    storage: makeStorage(),
    fetch: async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("offline");
      return jsonResponse([
        {
          bindingId: "binding-recovered",
          avatarId: "av-recovered",
          motionId: "motion-job-8",
          status: "ready",
          progress: 100,
          identityUrl: "recovered-identity.bin",
          motionAssetUrl: "motion-job-8.bin",
        },
      ]);
    },
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancel,
    pollIntervalMs: 100,
  });

  await controller.discover(new Map([["motion-job-8", "imported-job-8"]]));
  assert.equal(controller.get("imported-job-8"), null);
  assert.equal(scheduler.pending[0].delayMs, 100);

  scheduler.runNext();
  await flushAsync();
  assert.equal(controller.get("imported-job-8").status, "ready");
  assert.equal(scheduler.pending.length, 0);
});

test("boot migration accepts legacy arrays and replays ready hydration", () => {
  const storage = makeStorage({
    [AVATAR_BINDING_STORAGE_KEY]: JSON.stringify([
      {
        exerciseId: "imported-old",
        bindingId: "binding-old",
        avatarId: "av-old",
        motionId: "motion-old",
        status: "ready",
        progress: 100,
        identityUrl: "old-identity.bin",
        motionAssetUrl: "old-motion.bin",
      },
      { broken: true },
    ]),
  });
  const ready = [];
  const controller = new AvatarBindingController({
    backendUrl: "http://backend.test",
    storage,
    fetch: async () => jsonResponse([]),
    schedule: () => 1,
    cancelSchedule: () => {},
    onReady: (record) => ready.push(record),
  });

  controller.resume();

  assert.equal(controller.list().length, 1);
  assert.equal(controller.get("imported-old").seedId, "imported-old");
  assert.equal(ready.length, 1);
  const persisted = JSON.parse(storage.read(AVATAR_BINDING_STORAGE_KEY));
  assert.equal(persisted.version, 1);
  assert.equal(persisted.bindings.length, 1);
});

test("a blocked localStorage getter cannot prevent app startup", () => {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      get localStorage() {
        throw new DOMException("blocked", "SecurityError");
      },
      setTimeout,
      clearTimeout,
    },
  });
  try {
    assert.doesNotThrow(() => new AvatarBindingController({
      backendUrl: "http://backend.test",
      fetch: async () => jsonResponse([]),
    }));
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
});

test("offline binding polls retry with bounded backoff and retain ordinary metadata", async () => {
  const scheduler = makeScheduler();
  const errors = [];
  const controller = new AvatarBindingController({
    backendUrl: "http://backend.test",
    storage: makeStorage(),
    fetch: async () => { throw new TypeError("offline"); },
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancel,
    pollIntervalMs: 100,
    maxPollIntervalMs: 150,
    onNetworkError: (error) => errors.push(error),
  });
  controller.track(binding());

  scheduler.runNext();
  await flushAsync();
  assert.equal(scheduler.pending[0].delayMs, 100);
  scheduler.runNext();
  await flushAsync();
  assert.equal(scheduler.pending[0].delayMs, 150);
  assert.equal(errors.length, 2);
  assert.equal(controller.get("imported-job-1").status, "queued");
});

function flushAsync() {
  return new Promise((resolve) => setImmediate(resolve));
}
