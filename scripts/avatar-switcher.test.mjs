import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildAvatarBindingRequest } from "../dist/components/gameui/AvatarSwitcher.js";

const importFlowUrl = new URL("../src/core/import/ImportFlow.ts", import.meta.url);
const mainUrl = new URL("../src/main.ts", import.meta.url);

test("avatar switcher reuses a motion when present and lazily binds an imported job otherwise", () => {
  assert.deepEqual(
    buildAvatarBindingRequest(
      { seedId: "imported-job", motionId: "motion-job", jobId: "job" },
      "av-rei",
    ),
    { avatarId: "av-rei", motionId: "motion-job" },
  );
  assert.deepEqual(
    buildAvatarBindingRequest({ seedId: "imported-job", jobId: "job" }, "av-rei"),
    { avatarId: "av-rei", jobId: "job" },
  );
  assert.throws(
    () => buildAvatarBindingRequest({ seedId: "builtin" }, "av-rei"),
    /缺少可绑定的视频来源/,
  );
});

test("an immediately applied import keeps its backend job and source video", async () => {
  const [importFlow, main] = await Promise.all([
    readFile(importFlowUrl, "utf8"),
    readFile(mainUrl, "utf8"),
  ]);

  assert.match(importFlow, /sourceVideoUrl:\s*meta\.sourceVideoUrl/);
  assert.match(main, /jobId:\s*id/);
  assert.match(main, /coachVideo:\s*sourceVideoUrl\s*\?/);
  assert.match(main, /exercise\?\.motionId\s*\|\|\s*exercise\?\.jobId/);
});
