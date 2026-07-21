import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SessionArchive } from "../dist/core/scoring/SessionArchive.js";

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

function session(id, score) {
  return {
    id,
    exerciseId: "squat",
    exerciseName: "单腿深蹲",
    finishedAt: score,
    score,
    beat: 0,
    bestCombo: 0,
    perfectFrames: 0,
    avgDelta: 0,
    riskHits: 0,
    medalName: "测试勋章",
    summary: {},
  };
}

test("SessionArchive removes exactly one saved workout and preserves order", (t) => {
  const originalStorage = globalThis.localStorage;
  t.after(() => {
    globalThis.localStorage = originalStorage;
  });
  const storage = makeStorage();
  globalThis.localStorage = storage;
  const archive = new SessionArchive();

  archive.add(session("first", 70));
  archive.add(session("second", 90));
  archive.add(session("third", 80));

  assert.equal(archive.remove("second"), true);
  assert.deepEqual(archive.list().map(({ id }) => id), ["third", "first"]);
  assert.equal(archive.get("second"), null);
  assert.equal(archive.latest()?.id, "third");
});

test("SessionArchive reports missing records and failed writes without claiming deletion", (t) => {
  const originalStorage = globalThis.localStorage;
  t.after(() => {
    globalThis.localStorage = originalStorage;
  });
  const saved = JSON.stringify([session("kept", 88)]);
  globalThis.localStorage = {
    getItem: () => saved,
    setItem: () => {
      throw new Error("storage disabled");
    },
  };
  const archive = new SessionArchive();

  assert.equal(archive.remove("missing"), false);
  assert.equal(archive.remove("kept"), false);
  assert.equal(archive.get("kept")?.score, 88);
});

test("workout history surfaces provide confirmed per-record deletion", () => {
  const librarySource = readFileSync(new URL("../src/components/pages/LibraryPage.ts", import.meta.url), "utf8");
  const reportSource = readFileSync(new URL("../src/components/pages/ReportPage.ts", import.meta.url), "utf8");

  assert.match(librarySource, /data-delete-session/);
  assert.match(librarySource, /window\.confirm/);
  assert.doesNotMatch(librarySource, /archive\.list\(\)\.slice\(0, 6\)/);
  assert.match(reportSource, /data-delete-report/);
  assert.match(reportSource, /archive\.remove\(session\.id\)/);
});
