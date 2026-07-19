const IDENTITY_MAGIC = "KINEXGI1";
const MOTION_MAGIC = "KINEXGM1";
const LEGACY_MAGIC = "KINEXGS1";
export const AVATAR_JOINT_COUNT = 55;
export const AVATAR_MAX_GAUSSIANS = 65536;

const STATIC_FLOATS_PER_GAUSSIAN = 23;
const MATRIX_FLOATS = 16;

export interface AvatarIdentity {
  meta: Record<string, unknown>;
  count: number;
  jointCount: number;
  centers: Float32Array;
  /** Canonical gaussian rotations use the legacy shader's wxyz order. */
  quats: Float32Array;
  scales: Float32Array;
  opacities: Float32Array;
  colors: Float32Array;
  blendRot: Float32Array;
  lbsIndex: Uint8Array;
  lbsWeight: Float32Array;
  constrain: Uint8Array;
  restJoints: Float32Array;
  parents: Int16Array;
  /** Parent-before-child traversal order validated by the parser. */
  hierarchyOrder: Uint8Array;
}

export interface GaussianMotionAsset {
  meta: Record<string, unknown>;
  frameCount: number;
  jointCount: number;
  /** Per-frame local rotations in xyzw order, normalized during parsing. */
  localRotations: Float32Array;
  /** Raw root translation from the motion extractor. */
  translations: Float32Array;
  /** Root translation after the stage similarity transform. */
  stageTranslations: Float32Array;
  /** Column-major 3x3 stage linear transform (scale times rotation). */
  stageLinear: Float32Array;
}

export interface LegacyGaussianAsset {
  identity: AvatarIdentity;
  frames: number;
  tPosed: Float32Array;
  trans: Float32Array;
}

interface BinaryCursor {
  buffer: ArrayBuffer;
  offset: number;
}

export function parseAvatarIdentity(buffer: ArrayBuffer): AvatarIdentity {
  const { first: count, joints, meta, cursor } = parseSplitHeader(buffer, IDENTITY_MAGIC);
  if (count < 1 || count > AVATAR_MAX_GAUSSIANS) {
    throw new Error(`[AvatarAssets] gaussian count ${count} outside 1..${AVATAR_MAX_GAUSSIANS}`);
  }
  requireJointCount(joints);

  const expectedBytes =
    cursor.offset +
    count * STATIC_FLOATS_PER_GAUSSIAN * 4 +
    count * 4 +
    count * 4 * 4 +
    count +
    joints * 3 * 4 +
    joints * 2;
  requireExactLength(buffer, expectedBytes, IDENTITY_MAGIC);

  const centers = readFloat32(cursor, count * 3);
  const quats = readFloat32(cursor, count * 4);
  const scales = readFloat32(cursor, count * 3);
  const opacities = readFloat32(cursor, count);
  const colors = readFloat32(cursor, count * 3);
  const blendRot = readFloat32(cursor, count * 9);
  const lbsIndex = readUint8(cursor, count * 4);
  const lbsWeight = readFloat32(cursor, count * 4);
  const constrain = readUint8(cursor, count);
  const restJoints = readFloat32(cursor, joints * 3);
  const parents = readInt16(cursor, joints);

  requireFinite(centers, "identity centers");
  requireFinite(quats, "identity canonical rotations");
  requireFinite(scales, "identity scales");
  requireFinite(opacities, "identity opacities");
  requireFinite(colors, "identity colors");
  requireFinite(blendRot, "identity blend rotations");
  requireFinite(lbsWeight, "identity LBS weights");
  requireFinite(restJoints, "identity rest joints");
  for (const joint of lbsIndex) {
    if (joint >= joints) throw new Error("[AvatarAssets] LBS joint index is outside the hierarchy");
  }
  for (const value of constrain) {
    if (value > 1) throw new Error("[AvatarAssets] constrain values must be 0 or 1");
  }

  return {
    meta,
    count,
    jointCount: joints,
    centers,
    quats,
    scales,
    opacities,
    colors,
    blendRot,
    lbsIndex,
    lbsWeight,
    constrain,
    restJoints,
    parents,
    hierarchyOrder: validateHierarchy(parents),
  };
}

export function parseGaussianMotion(buffer: ArrayBuffer): GaussianMotionAsset {
  const { first: frames, joints, meta, cursor } = parseSplitHeader(buffer, MOTION_MAGIC);
  if (frames < 1) throw new Error("[AvatarAssets] motion frame count must be at least one");
  requireJointCount(joints);
  const expectedBytes = cursor.offset + frames * joints * 4 * 4 + frames * 3 * 4;
  requireExactLength(buffer, expectedBytes, MOTION_MAGIC);

  const sourceRotations = readFloat32(cursor, frames * joints * 4);
  const translations = readFloat32(cursor, frames * 3);
  requireFinite(sourceRotations, "motion local rotations");
  requireFinite(translations, "motion translations");

  const localRotations = normalizeQuaternions(sourceRotations);
  const { linear, translation } = parseStageTransform(meta.stageTransform);
  const stageTranslations = new Float32Array(translations.length);
  for (let frame = 0; frame < frames; frame++) {
    const offset = frame * 3;
    const x = translations[offset]!;
    const y = translations[offset + 1]!;
    const z = translations[offset + 2]!;
    stageTranslations[offset] = linear[0]! * x + linear[3]! * y + linear[6]! * z + translation[0]!;
    stageTranslations[offset + 1] = linear[1]! * x + linear[4]! * y + linear[7]! * z + translation[1]!;
    stageTranslations[offset + 2] = linear[2]! * x + linear[5]! * y + linear[8]! * z + translation[2]!;
  }

  return {
    meta,
    frameCount: frames,
    jointCount: joints,
    localRotations,
    translations,
    stageTranslations,
    stageLinear: linear,
  };
}

/** Parse the historical combined identity-plus-motion asset without WebGL. */
export function parseLegacyGaussianAsset(buffer: ArrayBuffer): LegacyGaussianAsset {
  if (buffer.byteLength < 24) throw new Error("[AvatarAssets] truncated KINEXGS1 header");
  const magic = readMagic(buffer);
  if (magic !== LEGACY_MAGIC) throw new Error(`[AvatarAssets] bad magic "${magic}" (want ${LEGACY_MAGIC})`);
  const view = new DataView(buffer);
  const count = view.getUint32(8, true);
  const frames = view.getUint32(12, true);
  const joints = view.getUint32(16, true);
  const headerLength = view.getUint32(20, true);
  if (count < 1 || count > AVATAR_MAX_GAUSSIANS) {
    throw new Error(`[AvatarAssets] gaussian count ${count} outside 1..${AVATAR_MAX_GAUSSIANS}`);
  }
  if (frames < 1) throw new Error("[AvatarAssets] legacy frame count must be at least one");
  requireJointCount(joints);
  const payloadOffset = 24 + headerLength;
  if (payloadOffset > buffer.byteLength) throw new Error("[AvatarAssets] truncated KINEXGS1 metadata");
  const expectedBytes =
    payloadOffset +
    count * STATIC_FLOATS_PER_GAUSSIAN * 4 +
    count * 4 +
    count * 4 * 4 +
    count +
    frames * joints * MATRIX_FLOATS * 4 +
    frames * 3 * 4;
  requireExactLength(buffer, expectedBytes, LEGACY_MAGIC);

  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 24, headerLength)));
  } catch (error) {
    throw new Error(`[AvatarAssets] invalid KINEXGS1 metadata: ${String(error)}`);
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new Error("[AvatarAssets] KINEXGS1 metadata must be an object");
  }

  const cursor = { buffer, offset: payloadOffset };
  const centers = readFloat32(cursor, count * 3);
  const quats = readFloat32(cursor, count * 4);
  const scales = readFloat32(cursor, count * 3);
  const opacities = readFloat32(cursor, count);
  const colors = readFloat32(cursor, count * 3);
  const blendRot = readFloat32(cursor, count * 9);
  const lbsIndex = readUint8(cursor, count * 4);
  const lbsWeight = readFloat32(cursor, count * 4);
  const constrain = readUint8(cursor, count);
  const tPosed = readFloat32(cursor, frames * joints * MATRIX_FLOATS);
  const trans = readFloat32(cursor, frames * 3);
  requireFinite(centers, "legacy centers");
  requireFinite(quats, "legacy canonical rotations");
  requireFinite(scales, "legacy scales");
  requireFinite(opacities, "legacy opacities");
  requireFinite(colors, "legacy colors");
  requireFinite(blendRot, "legacy blend rotations");
  requireFinite(lbsWeight, "legacy LBS weights");
  requireFinite(tPosed, "legacy skinning matrices");
  requireFinite(trans, "legacy translations");
  for (const joint of lbsIndex) {
    if (joint >= joints) throw new Error("[AvatarAssets] legacy LBS joint index is outside the hierarchy");
  }
  for (const value of constrain) {
    if (value > 1) throw new Error("[AvatarAssets] legacy constrain values must be 0 or 1");
  }
  const parents = new Int16Array(joints);
  parents.fill(-1);
  const hierarchyOrder = new Uint8Array(joints);
  for (let joint = 0; joint < joints; joint++) hierarchyOrder[joint] = joint;
  return {
    identity: {
      meta: decoded as Record<string, unknown>,
      count,
      jointCount: joints,
      centers,
      quats,
      scales,
      opacities,
      colors,
      blendRot,
      lbsIndex,
      lbsWeight,
      constrain,
      restJoints: new Float32Array(joints * 3),
      parents,
      hierarchyOrder,
    },
    frames,
    tPosed,
    trans,
  };
}

/**
 * Build shader-ready column-major skinning matrices for one reusable-motion frame.
 * The stage's linear transform is baked into the matrices; its translated root
 * is exposed separately on the motion so the shader adds it exactly once.
 */
export function buildSkinningMatrices(
  identity: AvatarIdentity,
  motion: GaussianMotionAsset,
  frameIndex: number,
  target: Float32Array,
): Float32Array {
  if (identity.jointCount !== AVATAR_JOINT_COUNT || motion.jointCount !== AVATAR_JOINT_COUNT) {
    throw new Error(`[AvatarAssets] identity and motion must both use ${AVATAR_JOINT_COUNT} joints`);
  }
  if (target.length < AVATAR_JOINT_COUNT * MATRIX_FLOATS) {
    throw new Error(`[AvatarAssets] skinning target needs ${AVATAR_JOINT_COUNT * MATRIX_FLOATS} floats`);
  }
  const frame = clampFrame(frameIndex, motion.frameCount);
  const world = new Float32Array(AVATAR_JOINT_COUNT * MATRIX_FLOATS);
  const multiplyScratch = new Float32Array(MATRIX_FLOATS);
  const rotations = motion.localRotations;
  const rotationBase = frame * AVATAR_JOINT_COUNT * 4;

  for (const joint of identity.hierarchyOrder) {
    const parent = identity.parents[joint]!;
    const joint3 = joint * 3;
    const parent3 = parent * 3;
    const localX = identity.restJoints[joint3]! - (parent < 0 ? 0 : identity.restJoints[parent3]!);
    const localY = identity.restJoints[joint3 + 1]! - (parent < 0 ? 0 : identity.restJoints[parent3 + 1]!);
    const localZ = identity.restJoints[joint3 + 2]! - (parent < 0 ? 0 : identity.restJoints[parent3 + 2]!);
    const quaternion = rotationBase + joint * 4;
    writeLocalMatrix(
      world,
      joint * MATRIX_FLOATS,
      rotations[quaternion]!,
      rotations[quaternion + 1]!,
      rotations[quaternion + 2]!,
      rotations[quaternion + 3]!,
      localX,
      localY,
      localZ,
    );
    if (parent >= 0) {
      multiplyMatrices(
        world,
        parent * MATRIX_FLOATS,
        world,
        joint * MATRIX_FLOATS,
        world,
        joint * MATRIX_FLOATS,
        multiplyScratch,
      );
    }
  }

  const stage = motion.stageLinear;
  for (let joint = 0; joint < AVATAR_JOINT_COUNT; joint++) {
    const offset = joint * MATRIX_FLOATS;
    const j3 = joint * 3;
    const restX = identity.restJoints[j3]!;
    const restY = identity.restJoints[j3 + 1]!;
    const restZ = identity.restJoints[j3 + 2]!;
    const skinX = world[offset + 12]! - (world[offset]! * restX + world[offset + 4]! * restY + world[offset + 8]! * restZ);
    const skinY = world[offset + 13]! - (world[offset + 1]! * restX + world[offset + 5]! * restY + world[offset + 9]! * restZ);
    const skinZ = world[offset + 14]! - (world[offset + 2]! * restX + world[offset + 6]! * restY + world[offset + 10]! * restZ);

    for (let column = 0; column < 3; column++) {
      const columnOffset = offset + column * 4;
      const x = world[columnOffset]!;
      const y = world[columnOffset + 1]!;
      const z = world[columnOffset + 2]!;
      target[columnOffset] = stage[0]! * x + stage[3]! * y + stage[6]! * z;
      target[columnOffset + 1] = stage[1]! * x + stage[4]! * y + stage[7]! * z;
      target[columnOffset + 2] = stage[2]! * x + stage[5]! * y + stage[8]! * z;
      target[columnOffset + 3] = 0;
    }
    target[offset + 12] = stage[0]! * skinX + stage[3]! * skinY + stage[6]! * skinZ;
    target[offset + 13] = stage[1]! * skinX + stage[4]! * skinY + stage[7]! * skinZ;
    target[offset + 14] = stage[2]! * skinX + stage[5]! * skinY + stage[8]! * skinZ;
    target[offset + 15] = 1;
  }
  return target;
}

export function clampFrame(frameIndex: number, frameCount: number): number {
  if (!Number.isFinite(frameIndex)) throw new Error("[AvatarAssets] frame index must be finite");
  return Math.min(Math.max(Math.floor(frameIndex), 0), frameCount - 1);
}

export function progressFrame(progress: number, frameCount: number): number {
  if (!Number.isFinite(progress)) throw new Error("[AvatarAssets] progress must be finite");
  const clamped = Math.min(Math.max(progress, 0), 1);
  return Math.min(frameCount - 1, Math.floor(clamped * frameCount));
}

function parseSplitHeader(
  buffer: ArrayBuffer,
  expectedMagic: string,
): { first: number; joints: number; meta: Record<string, unknown>; cursor: BinaryCursor } {
  if (buffer.byteLength < 20) throw new Error(`[AvatarAssets] truncated ${expectedMagic} header`);
  const magic = readMagic(buffer);
  if (magic !== expectedMagic) throw new Error(`[AvatarAssets] bad magic "${magic}" (want ${expectedMagic})`);
  const view = new DataView(buffer);
  const first = view.getUint32(8, true);
  const joints = view.getUint32(12, true);
  const headerLength = view.getUint32(16, true);
  const payloadOffset = 20 + headerLength;
  if (payloadOffset > buffer.byteLength) throw new Error(`[AvatarAssets] truncated ${expectedMagic} metadata`);
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, headerLength)));
  } catch (error) {
    throw new Error(`[AvatarAssets] invalid ${expectedMagic} metadata: ${String(error)}`);
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new Error(`[AvatarAssets] ${expectedMagic} metadata must be an object`);
  }
  return {
    first,
    joints,
    meta: decoded as Record<string, unknown>,
    cursor: { buffer, offset: payloadOffset },
  };
}

function readMagic(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength));
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return value;
}

function readFloat32(cursor: BinaryCursor, length: number): Float32Array {
  const bytes = length * 4;
  requireAvailable(cursor, bytes);
  let value: Float32Array;
  if (cursor.offset % 4 === 0) {
    value = new Float32Array(cursor.buffer, cursor.offset, length);
  } else {
    value = new Float32Array(length);
    new Uint8Array(value.buffer).set(new Uint8Array(cursor.buffer, cursor.offset, bytes));
  }
  cursor.offset += bytes;
  return value;
}

function readInt16(cursor: BinaryCursor, length: number): Int16Array {
  const bytes = length * 2;
  requireAvailable(cursor, bytes);
  let value: Int16Array;
  if (cursor.offset % 2 === 0) {
    value = new Int16Array(cursor.buffer, cursor.offset, length);
  } else {
    value = new Int16Array(length);
    new Uint8Array(value.buffer).set(new Uint8Array(cursor.buffer, cursor.offset, bytes));
  }
  cursor.offset += bytes;
  return value;
}

function readUint8(cursor: BinaryCursor, length: number): Uint8Array {
  requireAvailable(cursor, length);
  const value = new Uint8Array(cursor.buffer, cursor.offset, length);
  cursor.offset += length;
  return value;
}

function requireAvailable(cursor: BinaryCursor, bytes: number): void {
  if (cursor.offset + bytes > cursor.buffer.byteLength) throw new Error("[AvatarAssets] truncated arrays");
}

function requireExactLength(buffer: ArrayBuffer, expected: number, magic: string): void {
  if (buffer.byteLength < expected) throw new Error(`[AvatarAssets] truncated ${magic} payload`);
  if (buffer.byteLength > expected) throw new Error(`[AvatarAssets] unexpected ${magic} payload length`);
}

function requireJointCount(joints: number): void {
  if (joints !== AVATAR_JOINT_COUNT) {
    throw new Error(`[AvatarAssets] joint count ${joints}, want ${AVATAR_JOINT_COUNT}`);
  }
}

function requireFinite(values: ArrayLike<number>, name: string): void {
  for (let index = 0; index < values.length; index++) {
    if (!Number.isFinite(values[index])) throw new Error(`[AvatarAssets] ${name} must contain finite values`);
  }
}

function normalizeQuaternions(source: Float32Array): Float32Array {
  let allUnit = true;
  for (let offset = 0; offset < source.length; offset += 4) {
    const norm = Math.hypot(source[offset]!, source[offset + 1]!, source[offset + 2]!, source[offset + 3]!);
    if (!Number.isFinite(norm) || norm < 1e-8) throw new Error("[AvatarAssets] quaternion must have a non-zero finite norm");
    if (Math.abs(norm - 1) > 1e-6) allUnit = false;
  }
  if (allUnit) return source;
  const normalized = new Float32Array(source.length);
  for (let offset = 0; offset < source.length; offset += 4) {
    const norm = Math.hypot(source[offset]!, source[offset + 1]!, source[offset + 2]!, source[offset + 3]!);
    normalized[offset] = source[offset]! / norm;
    normalized[offset + 1] = source[offset + 1]! / norm;
    normalized[offset + 2] = source[offset + 2]! / norm;
    normalized[offset + 3] = source[offset + 3]! / norm;
  }
  return normalized;
}

function parseStageTransform(value: unknown): { linear: Float32Array; translation: Float32Array } {
  const fallback = { scale: 1, R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [0, 0, 0] };
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
    throw new Error("[AvatarAssets] stage transform must be an object");
  }
  const source = value === undefined ? fallback : value as Record<string, unknown>;
  const scale = source.scale ?? 1;
  const rotation = source.R ?? fallback.R;
  const offset = source.t ?? fallback.t;
  if (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0) {
    throw new Error("[AvatarAssets] stage scale must be a positive finite number");
  }
  if (!Array.isArray(rotation) || rotation.length !== 3 || rotation.some((row) => !Array.isArray(row) || row.length !== 3)) {
    throw new Error("[AvatarAssets] stage rotation must be a 3x3 array");
  }
  if (!Array.isArray(offset) || offset.length !== 3) throw new Error("[AvatarAssets] stage translation must contain three values");
  const rowMajor = rotation.flat() as unknown[];
  requireFinite(rowMajor as number[], "stage rotation");
  requireFinite(offset as number[], "stage translation");
  const translation = new Float32Array(offset as number[]);
  const linear = new Float32Array(9);
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      linear[column * 3 + row] = scale * (rowMajor[row * 3 + column] as number);
    }
  }
  return { linear, translation };
}

function validateHierarchy(parents: Int16Array): Uint8Array {
  const state = new Uint8Array(parents.length);
  const order: number[] = [];
  const visit = (joint: number): void => {
    if (state[joint] === 2) return;
    if (state[joint] === 1) throw new Error("[AvatarAssets] parent hierarchy contains a cycle");
    state[joint] = 1;
    const parent = parents[joint]!;
    if (parent < -1 || parent >= parents.length || parent === joint) {
      throw new Error(`[AvatarAssets] invalid parent ${parent} for joint ${joint}`);
    }
    if (parent >= 0) visit(parent);
    state[joint] = 2;
    order.push(joint);
  };
  for (let joint = 0; joint < parents.length; joint++) visit(joint);
  return Uint8Array.from(order);
}

function writeLocalMatrix(
  target: Float32Array,
  offset: number,
  x: number,
  y: number,
  z: number,
  w: number,
  tx: number,
  ty: number,
  tz: number,
): void {
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  target[offset] = 1 - (yy + zz);
  target[offset + 1] = xy + wz;
  target[offset + 2] = xz - wy;
  target[offset + 3] = 0;
  target[offset + 4] = xy - wz;
  target[offset + 5] = 1 - (xx + zz);
  target[offset + 6] = yz + wx;
  target[offset + 7] = 0;
  target[offset + 8] = xz + wy;
  target[offset + 9] = yz - wx;
  target[offset + 10] = 1 - (xx + yy);
  target[offset + 11] = 0;
  target[offset + 12] = tx;
  target[offset + 13] = ty;
  target[offset + 14] = tz;
  target[offset + 15] = 1;
}

function multiplyMatrices(
  left: Float32Array,
  leftOffset: number,
  right: Float32Array,
  rightOffset: number,
  target: Float32Array,
  targetOffset: number,
  scratch: Float32Array,
): void {
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let value = 0;
      for (let inner = 0; inner < 4; inner++) {
        value += left[leftOffset + inner * 4 + row]! * right[rightOffset + column * 4 + inner]!;
      }
      scratch[column * 4 + row] = value;
    }
  }
  target.set(scratch, targetOffset);
}
