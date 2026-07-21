import assert from "node:assert/strict";
import test from "node:test";

import {
  AVATAR_PREVIEW_POSES,
  createAvatarPreviewPose,
} from "../dist/core/avatar/AvatarPreviewPoses.js";

const JOINT_COUNT = 55;

test("preview pose catalog exposes distinct selectable presets", () => {
  assert.deepEqual(
    AVATAR_PREVIEW_POSES.map((pose) => pose.id),
    ["relaxed", "akimbo", "victory", "rest"],
  );
  assert.equal(new Set(AVATAR_PREVIEW_POSES.map((pose) => pose.label)).size, AVATAR_PREVIEW_POSES.length);
});

test("preview poses are normalized single-frame reusable motions", () => {
  for (const pose of AVATAR_PREVIEW_POSES) {
    const motion = createAvatarPreviewPose(pose.id);
    assert.equal(motion.frameCount, 1);
    assert.equal(motion.jointCount, JOINT_COUNT);
    assert.equal(motion.localRotations.length, JOINT_COUNT * 4);
    assert.deepEqual(Array.from(motion.stageLinear), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    for (let joint = 0; joint < JOINT_COUNT; joint++) {
      const offset = joint * 4;
      const length = Math.hypot(
        motion.localRotations[offset],
        motion.localRotations[offset + 1],
        motion.localRotations[offset + 2],
        motion.localRotations[offset + 3],
      );
      assert.ok(Math.abs(length - 1) < 1e-6, `${pose.id} joint ${joint} must be normalized`);
    }
  }
});

test("akimbo bends both shoulders and elbows while rest remains identity", () => {
  const akimbo = createAvatarPreviewPose("akimbo").localRotations;
  const rest = createAvatarPreviewPose("rest").localRotations;
  for (const joint of [16, 17, 18, 19]) {
    assert.notEqual(akimbo[joint * 4 + 3], 1);
  }
  for (let joint = 0; joint < JOINT_COUNT; joint++) {
    assert.deepEqual(Array.from(rest.subarray(joint * 4, joint * 4 + 4)), [0, 0, 0, 1]);
  }
});
