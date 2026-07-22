import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildAvatarBindingRequest } from "../dist/components/gameui/AvatarSwitcher.js";
import {
  buildAvatarVideoExportRequest,
  resolveAvatarVideoUrl,
} from "../dist/core/avatar/AvatarVideoExportClient.js";

const importFlowUrl = new URL("../src/core/import/ImportFlow.ts", import.meta.url);
const mainUrl = new URL("../src/main.ts", import.meta.url);
const switcherCssUrl = new URL("../src/styles/avatar-switcher.css", import.meta.url);

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

test("avatar video export uses the current reusable identity and motion", () => {
  assert.deepEqual(buildAvatarVideoExportRequest("av-rei", "motion-dance"), {
    avatarId: "av-rei",
    motionId: "motion-dance",
    width: 1920,
    height: 1080,
    background: "#0e0f13",
  });
  assert.equal(
    resolveAvatarVideoUrl("https://kinex.example/api/", "public/coach_clips/avatar.mp4?v=1"),
    "https://kinex.example/api/public/coach_clips/avatar.mp4?v=1",
  );
});

test("avatar list shows at most three rows before scrolling internally", async () => {
  const css = await readFile(switcherCssUrl, "utf8");
  assert.match(css, /max-height:\s*calc\(var\(--avatar-switcher-row-height\) \* 3\)/);
  assert.match(css, /\.avatar-switcher-list\s*\{[^}]*overflow-y:\s*auto/s);
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
