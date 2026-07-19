import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertReusableIdentity,
  buildSkinningMatrices,
  createSkinningScratch,
  parseAvatarIdentity,
  parseGaussianMotion,
  parseLegacyGaussianAsset,
  progressFrame,
} from "../dist/core/avatar/AvatarAssets.js";

const JOINTS = 55;
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

function jsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value));
}

function makeParents() {
  const parents = new Int16Array(JOINTS);
  parents[0] = -1;
  for (let joint = 1; joint < JOINTS; joint++) parents[joint] = joint - 1;
  return parents;
}

function makeIdentityBuffer({ count = 1, joints = JOINTS, parents = makeParents(), restJoints } = {}) {
  const meta = jsonBytes({ format: "KINEXGI1", name: "fixture" });
  const staticFloatCount = count * 23;
  const staticByteCount = staticFloatCount * 4 + count * 4 + count * 4 * 4 + count;
  const payloadBytes = staticByteCount + joints * 3 * 4 + joints * 2;
  const buffer = new ArrayBuffer(20 + meta.length + payloadBytes);
  const bytes = new Uint8Array(buffer);
  bytes.set(new TextEncoder().encode("KINEXGI1"), 0);
  const view = new DataView(buffer);
  view.setUint32(8, count, true);
  view.setUint32(12, joints, true);
  view.setUint32(16, meta.length, true);
  bytes.set(meta, 20);

  let offset = 20 + meta.length;
  const writeFloat = (value) => {
    view.setFloat32(offset, value, true);
    offset += 4;
  };
  for (let gaussian = 0; gaussian < count; gaussian++) {
    for (let index = 0; index < 23; index++) writeFloat(index + gaussian * 23 + 0.25);
  }
  for (let gaussian = 0; gaussian < count; gaussian++) {
    bytes.set([0, 1, 2, 3], offset);
    offset += 4;
  }
  for (let gaussian = 0; gaussian < count; gaussian++) {
    for (const weight of [1, 0, 0, 0]) writeFloat(weight);
  }
  for (let gaussian = 0; gaussian < count; gaussian++) bytes[offset++] = gaussian % 2;

  const jointsData = restJoints ?? new Float32Array(joints * 3);
  for (const value of jointsData) writeFloat(value);
  for (const parent of parents) {
    view.setInt16(offset, parent, true);
    offset += 2;
  }
  assert.equal(offset, buffer.byteLength);
  return buffer;
}

function makeMotionBuffer({
  frames = 1,
  joints = JOINTS,
  rotations,
  translations,
  stageTransform = { scale: 1, R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [0, 0, 0] },
} = {}) {
  const meta = jsonBytes({ format: "KINEXGM1", fps: 30, stageTransform });
  const buffer = new ArrayBuffer(20 + meta.length + frames * joints * 4 * 4 + frames * 3 * 4);
  const bytes = new Uint8Array(buffer);
  bytes.set(new TextEncoder().encode("KINEXGM1"), 0);
  const view = new DataView(buffer);
  view.setUint32(8, frames, true);
  view.setUint32(12, joints, true);
  view.setUint32(16, meta.length, true);
  bytes.set(meta, 20);

  let offset = 20 + meta.length;
  const sourceRotations = rotations ?? (() => {
    const values = new Float32Array(frames * joints * 4);
    for (let index = 3; index < values.length; index += 4) values[index] = 1;
    return values;
  })();
  const sourceTranslations = translations ?? new Float32Array(frames * 3);
  for (const value of sourceRotations) {
    view.setFloat32(offset, value, true);
    offset += 4;
  }
  for (const value of sourceTranslations) {
    view.setFloat32(offset, value, true);
    offset += 4;
  }
  assert.equal(offset, buffer.byteLength);
  return buffer;
}

function makeLegacyBuffer() {
  const count = 1;
  const frames = 2;
  const meta = jsonBytes({ format: "KINEXGS1", name: "legacy" });
  const staticBytes = count * 23 * 4 + count * 4 + count * 4 * 4 + count;
  const buffer = new ArrayBuffer(24 + meta.length + staticBytes + frames * JOINTS * 16 * 4 + frames * 3 * 4);
  const bytes = new Uint8Array(buffer);
  bytes.set(new TextEncoder().encode("KINEXGS1"), 0);
  const view = new DataView(buffer);
  view.setUint32(8, count, true);
  view.setUint32(12, frames, true);
  view.setUint32(16, JOINTS, true);
  view.setUint32(20, meta.length, true);
  bytes.set(meta, 24);
  let offset = 24 + meta.length;
  for (let index = 0; index < count * 23; index++, offset += 4) view.setFloat32(offset, index + 0.5, true);
  bytes.set([0, 1, 2, 3], offset);
  offset += 4;
  for (const weight of [1, 0, 0, 0]) {
    view.setFloat32(offset, weight, true);
    offset += 4;
  }
  bytes[offset++] = 0;
  for (let frame = 0; frame < frames; frame++) {
    for (let joint = 0; joint < JOINTS; joint++) {
      for (let column = 0; column < 4; column++) {
        for (let row = 0; row < 4; row++) {
          view.setFloat32(offset, row === column ? 1 : 0, true);
          offset += 4;
        }
      }
    }
  }
  for (const value of [0, 0, 0, 4, 5, 6]) {
    view.setFloat32(offset, value, true);
    offset += 4;
  }
  assert.equal(offset, buffer.byteLength);
  return buffer;
}

function assertClose(actual, expected, tolerance = 1e-5) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index++) {
    assert.ok(Math.abs(actual[index] - expected[index]) <= tolerance, `index ${index}: ${actual[index]} != ${expected[index]}`);
  }
}

test("split identity and motion parsers preserve headers and typed-array lengths", () => {
  const identity = parseAvatarIdentity(makeIdentityBuffer({ count: 2 }));
  assert.equal(identity.count, 2);
  assert.equal(identity.jointCount, JOINTS);
  assert.equal(identity.centers.length, 6);
  assert.equal(identity.blendRot.length, 18);
  assert.equal(identity.lbsIndex.length, 8);
  assert.equal(identity.restJoints.length, JOINTS * 3);
  assert.equal(identity.parents.length, JOINTS);

  const motion = parseGaussianMotion(makeMotionBuffer({ frames: 2 }));
  assert.equal(motion.frameCount, 2);
  assert.equal(motion.jointCount, JOINTS);
  assert.equal(motion.localRotations.length, 2 * JOINTS * 4);
  assert.equal(motion.translations.length, 6);
});

test("split parsers reject truncated or trailing payloads", () => {
  const identity = makeIdentityBuffer();
  assert.throws(() => parseAvatarIdentity(identity.slice(0, -1)), /truncated|length/i);
  const motion = makeMotionBuffer();
  const trailing = new Uint8Array(motion.byteLength + 1);
  trailing.set(new Uint8Array(motion));
  assert.throws(() => parseGaussianMotion(trailing.buffer), /length|trailing|unexpected/i);
});

test("motion parser normalizes finite non-unit quaternions", () => {
  const rotations = new Float32Array(JOINTS * 4);
  for (let index = 0; index < rotations.length; index += 4) rotations[index + 3] = 2;
  const motion = parseGaussianMotion(makeMotionBuffer({ rotations }));
  assertClose(motion.localRotations.subarray(0, 4), [0, 0, 0, 1]);
});

test("motion parser rejects a zero quaternion even after a non-unit quaternion", () => {
  const rotations = new Float32Array(JOINTS * 4);
  for (let index = 0; index < rotations.length; index += 4) rotations[index + 3] = 1;
  rotations[3] = 2;
  rotations[7] = 0;
  assert.throws(() => parseGaussianMotion(makeMotionBuffer({ rotations })), /quaternion|norm/i);
});

test("identity local rotations produce identity skinning matrices", () => {
  const rest = new Float32Array(JOINTS * 3);
  for (let joint = 0; joint < JOINTS; joint++) rest[joint * 3] = joint * 0.1;
  const identity = parseAvatarIdentity(makeIdentityBuffer({ restJoints: rest }));
  const motion = parseGaussianMotion(makeMotionBuffer());
  const target = new Float32Array(JOINTS * 16);
  const result = buildSkinningMatrices(identity, motion, 0, target);
  assert.equal(result, target);
  const expected = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let joint = 0; joint < JOINTS; joint++) assertClose(target.subarray(joint * 16, joint * 16 + 16), expected);
});

test("child local rotation rotates descendants around the child rest joint", () => {
  const rest = new Float32Array(JOINTS * 3);
  for (let joint = 1; joint < JOINTS; joint++) rest[joint * 3] = joint;
  const rotations = new Float32Array(JOINTS * 4);
  for (let joint = 0; joint < JOINTS; joint++) rotations[joint * 4 + 3] = 1;
  rotations.set([0, 0, Math.SQRT1_2, Math.SQRT1_2], 4);
  const identity = parseAvatarIdentity(makeIdentityBuffer({ restJoints: rest }));
  const motion = parseGaussianMotion(makeMotionBuffer({ rotations }));
  const target = buildSkinningMatrices(identity, motion, 0, new Float32Array(JOINTS * 16));
  const child = target.subarray(16, 32);
  assertClose(child, [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 1, -1, 0, 1]);
  const grandchild = target.subarray(32, 48);
  const x = grandchild[0] * 2 + grandchild[12];
  const y = grandchild[1] * 2 + grandchild[13];
  assertClose([x, y], [1, 1]);
});

test("stage rotation and scale affect bones while transformed root translation is exposed once", () => {
  const stageTransform = {
    scale: 2,
    R: [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    t: [10, 20, 30],
  };
  const identity = parseAvatarIdentity(makeIdentityBuffer());
  const motion = parseGaussianMotion(makeMotionBuffer({
    translations: new Float32Array([1, 2, 3]),
    stageTransform,
  }));
  const target = buildSkinningMatrices(identity, motion, 0, new Float32Array(JOINTS * 16));
  assertClose(target.subarray(0, 16), [0, 2, 0, 0, -2, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1]);
  assertClose(motion.stageTranslations, [6, 22, 36]);
});

test("identity parser rejects cyclic parent hierarchies", () => {
  const parents = makeParents();
  parents[1] = 2;
  parents[2] = 1;
  assert.throws(() => parseAvatarIdentity(makeIdentityBuffer({ parents })), /cycle|hierarchy|parent/i);
});

test("progress selects the expected reusable-motion frame", () => {
  assert.equal(progressFrame(0, 2), 0);
  assert.equal(progressFrame(0.499, 2), 0);
  assert.equal(progressFrame(0.5, 2), 1);
  assert.equal(progressFrame(1, 2), 1);
});

test("legacy KINEXGS1 combined assets remain playable", () => {
  const legacy = parseLegacyGaussianAsset(makeLegacyBuffer());
  assert.equal(legacy.identity.count, 1);
  assert.equal(legacy.frames, 2);
  assert.equal(legacy.tPosed.length, 2 * JOINTS * 16);
  assertClose(legacy.trans.subarray(3), [4, 5, 6]);
});

test("legacy combined identities are marked non-reusable and rejected for split motion", () => {
  const splitIdentity = parseAvatarIdentity(makeIdentityBuffer());
  assert.equal(splitIdentity.reusableMotion, true);
  assert.doesNotThrow(() => assertReusableIdentity(splitIdentity));

  const legacyIdentity = parseLegacyGaussianAsset(makeLegacyBuffer()).identity;
  assert.equal(legacyIdentity.reusableMotion, false);
  assert.throws(
    () => assertReusableIdentity(legacyIdentity),
    /legacy.*cannot.*reusable motion|split identity/i,
  );
});

test("FK accepts caller-owned scratch buffers for repeated frames", () => {
  const identity = parseAvatarIdentity(makeIdentityBuffer());
  const motion = parseGaussianMotion(makeMotionBuffer({ frames: 2 }));
  const scratch = createSkinningScratch();
  const world = scratch.world;
  const matrix = scratch.matrix;
  const target = new Float32Array(JOINTS * 16);

  buildSkinningMatrices(identity, motion, 0, target, scratch);
  buildSkinningMatrices(identity, motion, 1, target, scratch);

  assert.equal(scratch.world, world);
  assert.equal(scratch.matrix, matrix);
});

test("browser parsers consume identity and motion emitted by backend/avatar_assets.py", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kinex-avatar-assets-"));
  try {
    const legacyPath = path.join(root, "legacy.bin");
    const identityPath = path.join(root, "identity.bin");
    const motionPath = path.join(root, "motion.bin");
    await writeFile(legacyPath, new Uint8Array(makeLegacyBuffer()));
    const script = [
      "import sys",
      "import numpy as np",
      "from backend.avatar_assets import split_legacy_asset",
      "joints = np.arange(55 * 3, dtype=np.float32).reshape(55, 3) / 100",
      "parents = np.array([-1] + list(range(54)), dtype=np.int16)",
      "split_legacy_asset(sys.argv[1], sys.argv[2], sys.argv[3], joints, parents)",
    ].join("\n");
    execFileSync("python3", ["-c", script, legacyPath, identityPath, motionPath], {
      cwd: REPO_ROOT,
      stdio: "pipe",
    });

    const identityBytes = await readFile(identityPath);
    const identity = parseAvatarIdentity(
      identityBytes.buffer.slice(identityBytes.byteOffset, identityBytes.byteOffset + identityBytes.byteLength),
    );
    assert.equal(identity.reusableMotion, true);
    assertClose(identity.centers, [0.5, 1.5, 2.5]);
    assertClose(identity.quats, [3.5, 4.5, 5.5, 6.5]);
    assertClose(identity.restJoints.subarray(0, 6), [0, 0.01, 0.02, 0.03, 0.04, 0.05]);
    assert.deepEqual(Array.from(identity.parents.subarray(0, 4)), [-1, 0, 1, 2]);

    const motionBytes = await readFile(motionPath);
    const motion = parseGaussianMotion(
      motionBytes.buffer.slice(motionBytes.byteOffset, motionBytes.byteOffset + motionBytes.byteLength),
    );
    assert.equal(motion.frameCount, 2);
    assertClose(motion.localRotations.subarray(0, 4), [0, 0, 0, 1]);
    assertClose(motion.translations.subarray(3), [4, 5, 6]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
