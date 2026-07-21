import { THREE,                    } from "../three-compat.js";
import {
  AVATAR_JOINT_COUNT,
  assertReusableIdentity,
  buildSkinningMatrices,
  createSkinningScratch,
  parseAvatarIdentity,
  parseGaussianMotion,
  parseLegacyGaussianAsset,
  progressFrame,



} from "./AvatarAssets.js";

/**
 * GaussianAvatar — frame-deformable 3DGS (3D Gaussian Splatting) digital human.
 *
 * Reproduces the LHM server-side deformation in the browser: every gaussian is
 * bound to fixed top-4 SMPL-X LBS weights, so one animation frame is pure linear
 * algebra — 55 joint matrices (mat4) plus one root translation. The vertex
 * shader does the LBS blend, rebuilds the per-gaussian rotation
 * (quaternion only, wxyz end to end) and projects the standard 3DGS 2D
 * covariance ellipse. Depth sorting runs on the CPU once per frame/camera move
 * and only rewrites the instance-order attribute.
 *
 * Binary asset format "KINEXGS1" (little endian):
 *   8 bytes magic, u32 N, u32 F, u32 J (=55), u32 headerLen,
 *   headerLen bytes UTF-8 JSON meta, then tightly packed arrays:
 *   c_pts N*3 f32 | q_cano N*4 f32 (wxyz) | scale N*3 f32 | opacity N f32 |
 *   rgb N*3 f32 | A_null_rot N*9 f32 (row-major 3x3) |
 *   lbs_idx N*4 u8 | lbs_w N*4 f32 | constrain N u8 |
 *   T_posed F*55*16 f32 (column-major mat4 per joint per frame) | trans F*3 f32.
 */

const JOINT_COUNT = AVATAR_JOINT_COUNT;
const MAT4_FLOATS = 16;
/** Texels per gaussian inside the static data texture. */
const DATA_STRIDE = 9;
const DATA_TEX_WIDTH = 1024;
/** Depth sort packs (depth16 << 16) | index16, so N is capped at 2^16. */









/** Anything with a world matrix works (THREE.Camera is structurally compatible). */




const VERTEX_SHADER = /* glsl */ `
uniform sampler2D uData;
uniform sampler2D uBones;
uniform vec3 uTrans;
uniform vec2 uViewport;
uniform int uDataTexWidth;

attribute float sortedIndex;

varying vec4 vColor;
varying vec2 vQuad;

vec4 dataTexel(int idx) {
  return texelFetch(uData, ivec2(idx % uDataTexWidth, idx / uDataTexWidth), 0);
}

mat4 boneMatrix(int joint) {
  // One mat4 per joint row: four column texels, column-major like the wire data.
  return mat4(
    texelFetch(uBones, ivec2(0, joint), 0),
    texelFetch(uBones, ivec2(1, joint), 0),
    texelFetch(uBones, ivec2(2, joint), 0),
    texelFetch(uBones, ivec2(3, joint), 0));
}

// All quaternions are wxyz: q.x is the scalar part.
vec4 quatMul(vec4 a, vec4 b) {
  return vec4(
    a.x * b.x - a.y * b.y - a.z * b.z - a.w * b.w,
    a.x * b.y + a.y * b.x + a.z * b.w - a.w * b.z,
    a.x * b.z - a.y * b.w + a.z * b.x + a.w * b.y,
    a.x * b.w + a.y * b.z - a.z * b.y + a.w * b.x);
}

// Shepperd's method; tolerant to the non-orthogonal matrices LBS blending
// produces (result is normalised by the caller contract as well).
vec4 quatFromMat3(mat3 m) {
  float m00 = m[0][0]; float m01 = m[1][0]; float m02 = m[2][0];
  float m10 = m[0][1]; float m11 = m[1][1]; float m12 = m[2][1];
  float m20 = m[0][2]; float m21 = m[1][2]; float m22 = m[2][2];
  float trace = m00 + m11 + m22;
  vec4 q;
  if (trace > 0.0) {
    float s = sqrt(max(trace + 1.0, 1e-8)) * 2.0;
    q = vec4(0.25 * s, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s);
  } else if (m00 > m11 && m00 > m22) {
    float s = sqrt(max(1.0 + m00 - m11 - m22, 1e-8)) * 2.0;
    q = vec4((m21 - m12) / s, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s);
  } else if (m11 > m22) {
    float s = sqrt(max(1.0 + m11 - m00 - m22, 1e-8)) * 2.0;
    q = vec4((m02 - m20) / s, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s);
  } else {
    float s = sqrt(max(1.0 + m22 - m00 - m11, 1e-8)) * 2.0;
    q = vec4((m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s);
  }
  return normalize(q);
}

mat3 mat3FromQuat(vec4 q) {
  float w = q.x; float x = q.y; float y = q.z; float z = q.w;
  float x2 = x + x; float y2 = y + y; float z2 = z + z;
  float xx = x * x2; float xy = x * y2; float xz = x * z2;
  float yy = y * y2; float yz = y * z2; float zz = z * z2;
  float wx = w * x2; float wy = w * y2; float wz = w * z2;
  return mat3(
    1.0 - (yy + zz), xy + wz, xz - wy,
    xy - wz, 1.0 - (xx + zz), yz + wx,
    xz + wy, yz - wx, 1.0 - (xx + yy));
}

void main() {
  int g = int(sortedIndex + 0.5);
  int base = g * ${DATA_STRIDE};
  vec4 dCenter = dataTexel(base);       // c_pts.xyz, opacity
  vec4 dQuat = dataTexel(base + 1);     // q_cano, wxyz
  vec4 dScale = dataTexel(base + 2);    // scale.xyz, constrain bit
  vec4 dColor = dataTexel(base + 3);    // rgb
  vec4 aRow0 = dataTexel(base + 4);     // A_null_rot rows
  vec4 aRow1 = dataTexel(base + 5);
  vec4 aRow2 = dataTexel(base + 6);
  vec4 lIdx = dataTexel(base + 7);      // top-4 joint indices (as floats)
  vec4 lWgt = dataTexel(base + 8);      // top-4 LBS weights

  // LBS matrix blend: M = sum_j w_j * T_posed[idx_j]
  mat4 M = lWgt.x * boneMatrix(int(lIdx.x + 0.5))
         + lWgt.y * boneMatrix(int(lIdx.y + 0.5))
         + lWgt.z * boneMatrix(int(lIdx.z + 0.5))
         + lWgt.w * boneMatrix(int(lIdx.w + 0.5));

  vec3 posed = (M * vec4(dCenter.xyz, 1.0)).xyz + uTrans;

  // Stored row-major; rebuild with columns so the rows survive intact.
  mat3 blendRot = mat3(
    aRow0.x, aRow1.x, aRow2.x,
    aRow0.y, aRow1.y, aRow2.y,
    aRow0.z, aRow1.z, aRow2.z);
  mat3 rigid = mat3(M) * blendRot;
  vec4 qRigid = dScale.w > 0.5 ? vec4(1.0, 0.0, 0.0, 0.0) : quatFromMat3(rigid);
  mat3 rot = mat3FromQuat(quatMul(qRigid, dQuat));

  vec4 cam = viewMatrix * vec4(posed, 1.0);
  vec4 clip = projectionMatrix * cam;

  // Cull behind the near plane and outside a 1.2x frustum margin.
  float limit = 1.2 * clip.w;
  if (clip.w <= 0.0 || cam.z > -0.1 || clip.x < -limit || clip.x > limit || clip.y < -limit || clip.y > limit) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    vColor = vec4(0.0);
    vQuad = vec2(0.0);
    return;
  }

  // 3D covariance: V = R * diag(scale); cov = V * V^T, then into view space.
  vec3 scale = dScale.xyz;
  mat3 V = mat3(rot[0] * scale.x, rot[1] * scale.y, rot[2] * scale.z);
  mat3 cov = V * transpose(V);
  mat3 viewRot = mat3(viewMatrix);
  mat3 covView = viewRot * cov * transpose(viewRot);

  // Perspective Jacobian (EWA splatting), focal lengths in pixels.
  vec2 focal = 0.5 * uViewport * vec2(projectionMatrix[0][0], projectionMatrix[1][1]);
  float tz2 = cam.z * cam.z;
  vec3 j0 = vec3(focal.x / cam.z, 0.0, -focal.x * cam.x / tz2);
  vec3 j1 = vec3(0.0, focal.y / cam.z, -focal.y * cam.y / tz2);
  float a = dot(j0, covView * j0) + 0.3; // 0.3px low-pass against aliasing
  float b = dot(j0, covView * j1);
  float c = dot(j1, covView * j1) + 0.3;

  // Eigen decomposition of the symmetric 2x2 covariance.
  float mid = 0.5 * (a + c);
  float radius = length(vec2(0.5 * (a - c), b));
  float lambda1 = mid + radius;
  float lambda2 = max(mid - radius, 0.1);
  vec2 axis1 = vec2(b, lambda1 - a);
  axis1 = dot(axis1, axis1) < 1e-12 ? vec2(1.0, 0.0) : normalize(axis1);
  vec2 axis2 = vec2(axis1.y, -axis1.x);

  // Quad spans +/-3 sigma along both eigen axes; offset in pixels -> NDC.
  vec2 offsetPx = (position.x * sqrt(lambda1) * axis1 + position.y * sqrt(lambda2) * axis2) * 3.0;
  vec2 offsetNdc = offsetPx / uViewport * 2.0;

  vQuad = position.xy;
  vColor = vec4(dColor.rgb, dCenter.w);
  gl_Position = vec4(clip.xy + offsetNdc * clip.w, clip.z, clip.w);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform float uPremultiply;

varying vec4 vColor;
varying vec2 vQuad;

void main() {
  float r2 = dot(vQuad, vQuad);
  if (r2 > 1.0) discard;
  // Quad edge sits at 3 sigma: alpha = opacity * exp(-(3r)^2 / 2).
  float alpha = vColor.a * exp(-4.5 * r2);
  if (alpha < 0.0039) discard;
  vec3 rgb = vColor.rgb * mix(1.0, alpha, uPremultiply);
  gl_FragColor = vec4(rgb, alpha);
}
`;

/** Fetchable reusable motion wrapper consumed by GaussianAvatar. */
export class GaussianMotion                                {
           meta                         ;
           frameCount        ;
           jointCount        ;
           localRotations              ;
           translations              ;
           stageTranslations              ;
           stageLinear              ;

  static async load(url        )                          {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`[GaussianMotion] fetch ${url} -> HTTP ${response.status}`);
    return GaussianMotion.parse(await response.arrayBuffer());
  }

  static parse(buffer             )                 {
    return new GaussianMotion(parseGaussianMotion(buffer));
  }

          constructor(asset                     ) {
    this.meta = asset.meta;
    this.frameCount = asset.frameCount;
    this.jointCount = asset.jointCount;
    this.localRotations = asset.localRotations;
    this.translations = asset.translations;
    this.stageTranslations = asset.stageTranslations;
    this.stageLinear = asset.stageLinear;
  }
}

export class GaussianAvatar {
  /** Mount point for any THREE.Scene. Assumes an identity transform (world-space data). */
           object3d                                 ;
           meta                         ;
           supportsReusableMotion         ;

                   identity                ;
                   geometry                                                    ;
                   material                                           ;
                   dataTexture                                        ;
                   boneTexture                                        ;
                   boneTexels              ;
                   sortedIndexAttribute                                                     ;
                   sortedIndices              ;
                   sortKeys             ;
                   depths              ;
                   transVec               ;
                   viewportVec                                    ;
                   fkScratch                  = createSkinningScratch();

          motion                        = null;
          legacyMotion                         ;
          frameCountValue        ;
  /** Extra vertical shift folded into uTrans; previews use it to ground the rest pose. */
          baseOffsetY = 0;

          frameIndex = -1;
          sortDirty = true;
          lastCamera                    = null;
                   lastSortCam = new Float64Array(6); // camera pos + forward
  /** Wall time of the most recent CPU depth sort, ms. */
  lastSortMs = 0;
          sortMsEma = 0;

  static async load(url        )                          {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`[GaussianAvatar] fetch ${url} -> HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    return GaussianAvatar.parse(buffer);
  }

  static async loadIdentity(url        )                          {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`[GaussianAvatar] fetch ${url} -> HTTP ${response.status}`);
    return GaussianAvatar.fromIdentity(parseAvatarIdentity(await response.arrayBuffer()));
  }

  static fromIdentity(identity                )                 {
    return new GaussianAvatar(identity, null);
  }

  /** Legacy combined-asset adapter retained for the committed demo and old jobs. */
  static parse(buffer             )                 {
    const legacy = parseLegacyGaussianAsset(buffer);
    return new GaussianAvatar(legacy.identity, legacy);
  }

          constructor(identity                , legacyMotion                         ) {
    this.identity = identity;
    this.legacyMotion = legacyMotion;
    this.frameCountValue = legacyMotion?.frames ?? 1;
    this.meta = identity.meta;
    this.supportsReusableMotion = identity.reusableMotion;

    const { count } = identity;

    // ---- static gaussian data texture (stride DATA_STRIDE texels per gaussian) ----
    const texHeight = Math.ceil((count * DATA_STRIDE) / DATA_TEX_WIDTH);
    const texels = new Float32Array(DATA_TEX_WIDTH * texHeight * 4);
    for (let g = 0; g < count; g++) {
      const t = g * DATA_STRIDE * 4;
      const c3 = g * 3;
      const q4 = g * 4;
      const a9 = g * 9;
      texels[t] = identity.centers[c3] ;
      texels[t + 1] = identity.centers[c3 + 1] ;
      texels[t + 2] = identity.centers[c3 + 2] ;
      texels[t + 3] = identity.opacities[g] ;
      texels[t + 4] = identity.quats[q4] ;
      texels[t + 5] = identity.quats[q4 + 1] ;
      texels[t + 6] = identity.quats[q4 + 2] ;
      texels[t + 7] = identity.quats[q4 + 3] ;
      texels[t + 8] = identity.scales[c3] ;
      texels[t + 9] = identity.scales[c3 + 1] ;
      texels[t + 10] = identity.scales[c3 + 2] ;
      texels[t + 11] = identity.constrain[g]  > 0 ? 1 : 0;
      texels[t + 12] = identity.colors[c3] ;
      texels[t + 13] = identity.colors[c3 + 1] ;
      texels[t + 14] = identity.colors[c3 + 2] ;
      // texels[t + 15] spare
      for (let r = 0; r < 9; r++) texels[t + 16 + r + Math.floor(r / 3)] = identity.blendRot[a9 + r] ;
      texels[t + 28] = identity.lbsIndex[q4] ;
      texels[t + 29] = identity.lbsIndex[q4 + 1] ;
      texels[t + 30] = identity.lbsIndex[q4 + 2] ;
      texels[t + 31] = identity.lbsIndex[q4 + 3] ;
      texels[t + 32] = identity.lbsWeight[q4] ;
      texels[t + 33] = identity.lbsWeight[q4 + 1] ;
      texels[t + 34] = identity.lbsWeight[q4 + 2] ;
      texels[t + 35] = identity.lbsWeight[q4 + 3] ;
    }
    this.dataTexture = new THREE.DataTexture(texels, DATA_TEX_WIDTH, texHeight, THREE.RGBAFormat, THREE.FloatType);
    this.dataTexture.magFilter = THREE.NearestFilter;
    this.dataTexture.minFilter = THREE.NearestFilter;
    this.dataTexture.needsUpdate = true;

    // ---- bone matrix texture: 4 columns x 55 joints, one RGBA texel per mat4 column ----
    this.boneTexels = new Float32Array(4 * JOINT_COUNT * 4);
    this.boneTexture = new THREE.DataTexture(this.boneTexels, 4, JOINT_COUNT, THREE.RGBAFormat, THREE.FloatType);
    this.boneTexture.magFilter = THREE.NearestFilter;
    this.boneTexture.minFilter = THREE.NearestFilter;

    // ---- instanced quad ----
    this.sortedIndices = new Float32Array(count);
    for (let g = 0; g < count; g++) this.sortedIndices[g] = g;
    this.sortKeys = new Uint32Array(count);
    this.depths = new Float32Array(count);

    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.instanceCount = count;
    const quadPositions = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
    this.geometry.setAttribute("position", new THREE.BufferAttribute(quadPositions, 3));
    this.geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
    this.sortedIndexAttribute = new THREE.InstancedBufferAttribute(this.sortedIndices, 1);
    this.sortedIndexAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("sortedIndex", this.sortedIndexAttribute);

    this.transVec = new THREE.Vector3();
    this.viewportVec = new THREE.Vector2(1, 1);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uData: { value: this.dataTexture },
        uBones: { value: this.boneTexture },
        uTrans: { value: this.transVec },
        uViewport: { value: this.viewportVec },
        uDataTexWidth: { value: DATA_TEX_WIDTH },
        uPremultiply: { value: 1 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      // Premultiplied-alpha "over": correct for stacked splats, no dark fringes.
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });

    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.frustumCulled = false; // instance positions live in textures, not attributes
    this.object3d = mesh;

    this.setFrame(0);
  }

  get frameCount()         {
    return this.frameCountValue;
  }

  get count()         {
    return this.identity.count;
  }

  /** Lowest opaque gaussian centre Y in the rest pose — the feet line. */
  get restGroundY()         {
    const { centers, opacities, count } = this.identity;
    let min = Infinity;
    for (let g = 0; g < count; g++) {
      if (opacities[g]  < 0.5) continue;
      const y = centers[g * 3 + 1] ;
      if (y < min) min = y;
    }
    if (min !== Infinity) return min;
    for (let g = 0; g < count; g++) {
      const y = centers[g * 3 + 1] ;
      if (y < min) min = y;
    }
    return min === Infinity ? 0 : min;
  }

  /** Fold a constant vertical shift into every frame's root translation. */
  setBaseOffsetY(offsetY        )       {
    if (!Number.isFinite(offsetY) || offsetY === this.baseOffsetY) return;
    this.baseOffsetY = offsetY;
    const current = this.frameIndex;
    this.frameIndex = -1;
    this.setFrame(Math.max(current, 0));
  }

  get currentFrameIndex()         {
    return this.frameIndex;
  }

  get currentTranslation()                                    {
    return [this.transVec.x, this.transVec.y, this.transVec.z];
  }

  /** Exponential moving average of the CPU depth sort, ms. */
  get sortTimeMs()         {
    return this.sortMsEma;
  }

  /** Replace the current animation while retaining the identity's static textures. */
  setMotion(motion                       )       {
    if (motion) assertReusableIdentity(this.identity);
    this.motion = motion;
    this.legacyMotion = null;
    this.frameCountValue = motion?.frameCount ?? 1;
    this.frameIndex = -1;
    this.setFrame(0);
  }

  setProgress(progress        )       {
    this.setFrame(progressFrame(progress, this.frameCountValue));
  }

  /** Upload frame i's 55 joint matrices to the bone texture and re-sort. */
  setFrame(index        )       {
    if (!Number.isFinite(index)) throw new Error("[GaussianAvatar] frame index must be finite");
    const clamped = Math.min(Math.max(Math.floor(index), 0), this.frameCountValue - 1);
    if (clamped === this.frameIndex) return;
    this.frameIndex = clamped;
    if (this.motion) {
      buildSkinningMatrices(this.identity, this.motion, clamped, this.boneTexels, this.fkScratch);
      const offset = clamped * 3;
      this.transVec.set(
        this.motion.stageTranslations[offset] ,
        this.motion.stageTranslations[offset + 1] ,
        this.motion.stageTranslations[offset + 2] ,
      );
    } else if (this.legacyMotion) {
      const jointFloats = JOINT_COUNT * MAT4_FLOATS;
      const start = clamped * jointFloats;
      this.boneTexels.set(this.legacyMotion.tPosed.subarray(start, start + jointFloats));
      const offset = clamped * 3;
      this.transVec.set(
        this.legacyMotion.trans[offset] ,
        this.legacyMotion.trans[offset + 1] ,
        this.legacyMotion.trans[offset + 2] ,
      );
    } else {
      writeIdentityMatrices(this.boneTexels);
      this.transVec.set(0, 0, 0);
    }
    if (this.baseOffsetY !== 0) this.transVec.y += this.baseOffsetY;
    this.boneTexture.needsUpdate = true;
    this.sortDirty = true;
    if (this.lastCamera) this.sortFor(this.lastCamera);
  }

  /** Viewport size in device pixels (drawing buffer), drives the splat projection. */
  setViewport(width        , height        )       {
    this.viewportVec.set(Math.max(1, width), Math.max(1, height));
  }

  /**
   * Per-RAF hook: re-runs the CPU depth sort when the frame changed or the
   * camera moved since the last sort. Cheap enough to call every frame.
   */
  update(camera            )       {
    this.lastCamera = camera;
    if (this.sortDirty || this.cameraMoved(camera)) this.sortFor(camera);
  }

  /**
   * Blend mode A/B: "premultiplied" (ONE, ONE_MINUS_SRC_ALPHA, default) or
   * "normal" (SRC_ALPHA, ONE_MINUS_SRC_ALPHA with straight colours).
   */
  setBlendMode(mode                            )       {
    if (mode === "normal") {
      this.material.blending = THREE.NormalBlending;
      this.material.uniforms.uPremultiply .value = 0;
    } else {
      this.material.blending = THREE.CustomBlending;
      this.material.blendSrc = THREE.OneFactor;
      this.material.blendDst = THREE.OneMinusSrcAlphaFactor;
      this.material.uniforms.uPremultiply .value = 1;
    }
    this.material.needsUpdate = true;
  }

  dispose()       {
    this.geometry.dispose();
    this.material.dispose();
    this.dataTexture.dispose();
    this.boneTexture.dispose();
  }

          cameraMoved(camera            )          {
    const e = camera.matrixWorld.elements;
    const prev = this.lastSortCam;
    const moved =
      Math.abs(e[12]  - prev[0] ) > 1e-5 ||
      Math.abs(e[13]  - prev[1] ) > 1e-5 ||
      Math.abs(e[14]  - prev[2] ) > 1e-5 ||
      Math.abs(-e[8]  - prev[3] ) > 1e-5 ||
      Math.abs(-e[9]  - prev[4] ) > 1e-5 ||
      Math.abs(-e[10]  - prev[5] ) > 1e-5;
    return moved;
  }

  /**
   * CPU depth sort: pose every gaussian centre with the same top-4 LBS math
   * the shader uses, project onto the camera forward axis, quantise to 16
   * bits, pack (depth << 16) | index and sort with a numeric Uint32 sort.
   * Only the instance-order attribute is rewritten afterwards.
   */
          sortFor(camera            )       {
    const started = performance.now();
    const e = camera.matrixWorld.elements;
    const cx = e[12] ;
    const cy = e[13] ;
    const cz = e[14] ;
    let dx = -e[8] ;
    let dy = -e[9] ;
    let dz = -e[10] ;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len;
    dy /= len;
    dz /= len;

    const { centers, lbsIndex, lbsWeight, count } = this.identity;
    const T = this.boneTexels;
    const tx = this.transVec.x;
    const ty = this.transVec.y;
    const tz = this.transVec.z;
    const depths = this.depths;

    let minDepth = Infinity;
    let maxDepth = -Infinity;
    for (let g = 0; g < count; g++) {
      const c3 = g * 3;
      const px = centers[c3] ;
      const py = centers[c3 + 1] ;
      const pz = centers[c3 + 2] ;
      const b4 = g * 4;
      let x = 0;
      let y = 0;
      let z = 0;
      for (let k = 0; k < 4; k++) {
        const w = lbsWeight[b4 + k] ;
        if (w === 0) continue;
        const jo = lbsIndex[b4 + k]  * MAT4_FLOATS;
        x += w * (T[jo]  * px + T[jo + 4]  * py + T[jo + 8]  * pz + T[jo + 12] );
        y += w * (T[jo + 1]  * px + T[jo + 5]  * py + T[jo + 9]  * pz + T[jo + 13] );
        z += w * (T[jo + 2]  * px + T[jo + 6]  * py + T[jo + 10]  * pz + T[jo + 14] );
      }
      x += tx;
      y += ty;
      z += tz;
      const depth = (x - cx) * dx + (y - cy) * dy + (z - cz) * dz;
      depths[g] = depth;
      if (depth < minDepth) minDepth = depth;
      if (depth > maxDepth) maxDepth = depth;
    }

    const range = Math.max(maxDepth - minDepth, 1e-6);
    const keys = this.sortKeys;
    for (let g = 0; g < count; g++) {
      const q = Math.min(65535, Math.max(0, Math.round(((depths[g]  - minDepth) / range) * 65535)));
      // Far-to-near: invert the depth so the ascending numeric sort draws back first.
      keys[g] = ((65535 - q) << 16) | g;
    }
    const ordered = keys.subarray(0, count);
    ordered.sort();

    const indices = this.sortedIndices;
    for (let i = 0; i < count; i++) indices[i] = ordered[i]  & 0xffff;
    this.sortedIndexAttribute.needsUpdate = true;

    this.sortDirty = false;
    const prev = this.lastSortCam;
    prev[0] = cx;
    prev[1] = cy;
    prev[2] = cz;
    prev[3] = dx;
    prev[4] = dy;
    prev[5] = dz;

    const elapsed = performance.now() - started;
    this.lastSortMs = elapsed;
    this.sortMsEma = this.sortMsEma === 0 ? elapsed : this.sortMsEma * 0.9 + elapsed * 0.1;
  }
}

function writeIdentityMatrices(target              )       {
  target.fill(0);
  for (let joint = 0; joint < JOINT_COUNT; joint++) {
    const offset = joint * MAT4_FLOATS;
    target[offset] = 1;
    target[offset + 5] = 1;
    target[offset + 10] = 1;
    target[offset + 15] = 1;
  }
}
