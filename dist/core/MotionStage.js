import { WORLD_SPACE } from "./coordinates.js?v=0.1.10";



import { ThreeResourceTracker } from "./ThreeResourceTracker.js?v=0.1.10";
import { THREE,                                           } from "./three-compat.js?v=0.1.10";
import { bones } from "./motion/skeleton.js?v=0.1.10";
import { StageInteractions } from "./motion/StageInteractions.js?v=0.1.10";
import {
  buildMeshPrimitive,
  copyFrameVerticesInto,
  sampleFrameIndex,

} from "./import/MeshClip.js?v=0.1.10";















void WORLD_SPACE;

// Target the rough centre of mass of the seed skeleton.
const TARGET_Y = 0.95;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

const VIEW_OFFSETS                                    = {
  front: new THREE.Vector3(0, 0.45, 2.6),
  side: new THREE.Vector3(2.6, 0.45, 0),
  top: new THREE.Vector3(0, 3.2, 0.6),
};

const MODE_STYLE                                                                                                                          = {
  coach: { boneColor: 0x111111, jointColor: 0x222222, boneRadius: 0.028, jointRadius: 0.04, opacity: 1 },
  mesh: { boneColor: 0x444444, jointColor: 0x555555, boneRadius: 0.05, jointRadius: 0.06, opacity: 0.65 },
  stress: { boneColor: 0x111111, jointColor: 0x222222, boneRadius: 0.03, jointRadius: 0.045, opacity: 1 },
  // Rig stays hidden in avatar mode; the style only keeps the record total.
  avatar: { boneColor: 0x111111, jointColor: 0x222222, boneRadius: 0.028, jointRadius: 0.04, opacity: 1 },
};

const STRESS_JOINTS_BY_METRIC                              = {
  knee: ["lKnee", "rKnee"],
  hip: ["lHip", "rHip"],
  spine: ["spine", "chest"],
  ankle: ["lAnkle", "rAnkle"],
  shoulder: ["lShoulder", "rShoulder"],
  wrist: ["lWrist", "rWrist"],
};
const STRESS_COLOR = 0xff5500;
























export class MotionStage {
          canvas                   ;
          loadingOverlay             ;
          frameBuffer                   ;
          bus          ;
          resources                      ;
          cameraOverlay                      ;
          isCameraActive               ;
          interactions                   ;
          mode            ;
          view            ;
          stress         ;
          running = false;
          lastUiEmit = 0;
          lastSequence = -1;
          cameraState = { yawOffset: 0, pitchOffset: 0, zoom: 1 };
  /** Damped camera base — lerps toward VIEW_OFFSETS[view] for fly transitions. */
          displayBase                = VIEW_OFFSETS.front.clone();
          lastTickMs = 0;
          stressScratch = new THREE.Color(STRESS_COLOR);

          renderer                                           ;
          scene                                   ;
          camera                                               ;
          skeletonGroup                                   ;
  /** Set when the WebGL context can't be created — stage degrades gracefully. */
          webglFailed = false;
          boneMeshes                           = {};
          jointMeshes                                        = {};
          skeletonRotations                    ;
          smplxHandle                         = null;
          avatarHandle                        = null;
          lastAvatarFrame = -1;

  constructor(options              ) {
    this.canvas = options.canvas;
    this.loadingOverlay = options.loadingOverlay;
    this.frameBuffer = options.frameBuffer;
    this.bus = options.bus;
    this.cameraOverlay = options.cameraOverlay;
    this.isCameraActive = options.isCameraActive;
    this.mode = options.mode;
    this.view = options.view;
    this.stress = options.stress;
    this.resources = new ThreeResourceTracker();
    this.interactions = new StageInteractions(options.canvas, this.cameraState);
    this.skeletonRotations = Array.from({ length: 24 }, () => new THREE.Quaternion());

    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    } catch (error) {
      console.warn("[MotionStage] WebGL unavailable — 3D stage disabled", error);
      this.webglFailed = true;
    }
    if (this.webglFailed) {
      // Degrade instead of freezing the whole app: camera bay, scoring UI and
      // boot sequence keep working; only the 3D stage is offline.
      this.loadingOverlay.innerHTML =
        "<strong>当前浏览器不支持 WebGL</strong><span>3D 舞台不可用，其余功能不受影响</span>";
      this.loadingOverlay.classList.remove("is-hidden");
      return;
    }
    this.renderer.setClearColor(0xffffff, 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);

    const ambient = new THREE.AmbientLight(0xffffff, 0.85);
    const key = new THREE.DirectionalLight(0xffffff, 0.6);
    key.position.set(1.5, 3, 2);
    this.scene.add(ambient);
    this.scene.add(key);
    this.scene.add(key.target);

    const grid = new THREE.GridHelper(4, 16, 0xcccccc, 0xeeeeee);
    this.scene.add(grid);

    this.skeletonGroup = new THREE.Group();
    this.scene.add(this.skeletonGroup);
    this.buildSkeletonMeshes();
  }

  async preload()                {
    if (this.webglFailed) return; // keep the fallback message on screen
    this.loadingOverlay.classList.remove("is-hidden");
    await new Promise((resolve) => window.setTimeout(resolve, 220));
    this.loadingOverlay.classList.add("is-hidden");
  }

  start()       {
    if (this.running) return;
    this.running = true;
    this.resize();
    requestAnimationFrame((now) => this.tick(now));
  }

  stop()       {
    this.running = false;
  }

  resize()       {
    if (this.webglFailed) return;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.avatarHandle) {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.avatarHandle.setViewport(size.x, size.y);
    }
    if (this.cameraOverlay) this.cameraOverlay.resize();
  }

  setMode(mode            )       {
    this.mode = mode;
    this.applyModeStyle();
  }

  setView(view            )       {
    this.view = view;
    this.interactions.resetCameraOffsets();
  }

  setStress(enabled         )       {
    this.stress = enabled;
  }

  setMeshClip(clip          )       {
    if (this.webglFailed) return;
    this.clearMeshClip();
    const { mesh, geometry, material, positions } = buildMeshPrimitive(clip);
    const wireMaterial = new THREE.MeshBasicMaterial({
      color: 0x111111,
      wireframe: true,
      transparent: true,
      opacity: 0.22,
    });
    const wireMesh = new THREE.Mesh(geometry, wireMaterial);
    wireMesh.visible = false;
    this.scene.add(mesh);
    this.scene.add(wireMesh);
    this.smplxHandle = {
      clip,
      mesh,
      wireMesh,
      wireMaterial,
      geometry,
      material,
      positions,
      lastFrameIndex: -1,
    };
    this.applyModeStyle();
  }

  clearMeshClip()       {
    if (this.webglFailed) return;
    if (!this.smplxHandle) return;
    this.scene.remove(this.smplxHandle.mesh);
    this.scene.remove(this.smplxHandle.wireMesh);
    this.smplxHandle.geometry.dispose();
    this.smplxHandle.material.dispose();
    this.smplxHandle.wireMaterial.dispose();
    this.smplxHandle = null;
    this.applyModeStyle();
  }

  /** Attach (or swap/clear with null) the live 3DGS avatar layer.
   *  Does not dispose replaced avatars — main.ts caches them per seed. */
  setAvatar(avatar                       )       {
    if (this.webglFailed) return;
    if (this.avatarHandle) {
      this.scene.remove(this.avatarHandle.object3d);
      this.avatarHandle = null;
    }
    if (avatar) {
      this.avatarHandle = avatar;
      this.scene.add(avatar.object3d);
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      avatar.setViewport(size.x, size.y);
      this.lastAvatarFrame = -1;
    }
  }

  resetForSeed()       {
    if (this.webglFailed) return;
    this.resources.disposeSceneResources();
    this.scene.remove(this.skeletonGroup);
    this.boneMeshes = {};
    this.jointMeshes = {};
    this.skeletonGroup = new THREE.Group();
    this.scene.add(this.skeletonGroup);
    this.resources.createSceneResources();
    this.buildSkeletonMeshes();
    this.lastSequence = -1;
    if (this.smplxHandle) this.smplxHandle.lastFrameIndex = -1;
    this.loadingOverlay.classList.remove("is-hidden");
    window.setTimeout(() => this.loadingOverlay.classList.add("is-hidden"), 420);
  }

          tick(now        )       {
    if (!this.running) return;
    const frame = this.frameBuffer.readLatest();
    const dtMs = this.lastTickMs > 0 ? now - this.lastTickMs : 16;
    this.lastTickMs = now;
    if (!this.webglFailed) {
      this.updateCamera(now, Math.min(dtMs, 50) / 1000);
      this.updateSkeleton(frame, now);
      this.updateSmplxMesh(frame);
      this.updateAvatar(frame);
      this.renderer.render(this.scene, this.camera);
    }

    if (this.cameraOverlay && this.isCameraActive()) {
      this.cameraOverlay.render(frame, now);
    } else if (this.cameraOverlay && !this.isCameraActive()) {
      this.cameraOverlay.clear();
    }

    const sequence = this.frameBuffer.getSequence();
    if (frame && sequence !== this.lastSequence) {
      this.consumeRotations(frame);
      this.lastSequence = sequence;
    }

    if (frame && now - this.lastUiEmit > 120) {
      this.lastUiEmit = now;
      this.bus.emit("score:update", {
        score: frame.score,
        combo: frame.combo,
        metrics: frame.metrics,
        riskLabel: frame.riskLabel,
        frame: frame.frame,
        progress: frame.progress,
      });
    }

    requestAnimationFrame((next) => this.tick(next));
  }

          consumeRotations(frame              )       {
    frame.localRotations.forEach((target, index) => {
      const bone = this.skeletonRotations[index];
      if (bone) {
        bone.slerp(target, 0.4);
      }
    });
  }

          buildSkeletonMeshes()       {
    const dir = new THREE.Vector3(0, 0, 0);
    void dir;
    bones.forEach(([a, b]) => {
      const geometry = this.resources.trackGeometry(new THREE.CylinderGeometry(0.028, 0.028, 1, 12, 1));
      const material = this.resources.trackMaterial(new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5, metalness: 0.1 }));
      const mesh = new THREE.Mesh(geometry, material);
      this.skeletonGroup.add(mesh);
      this.boneMeshes[`${a}->${b}`] = {
        mesh,
        material,
        quaternion: new THREE.Quaternion(),
        smoothed: new THREE.Quaternion(),
      };
    });

    const jointNames              = [
      "pelvis",
      "spine",
      "chest",
      "neck",
      "head",
      "lShoulder",
      "rShoulder",
      "lElbow",
      "rElbow",
      "lWrist",
      "rWrist",
      "lHip",
      "rHip",
      "lKnee",
      "rKnee",
      "lAnkle",
      "rAnkle",
    ];
    jointNames.forEach((name) => {
      const radius = name === "head" ? 0.1 : 0.04;
      const geometry = this.resources.trackGeometry(new THREE.SphereGeometry(radius, 16, 16));
      const material = this.resources.trackMaterial(new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.1 }));
      const mesh = new THREE.Mesh(geometry, material);
      this.skeletonGroup.add(mesh);
      this.jointMeshes[name] = { mesh, material };
    });

    this.applyModeStyle();
  }

          applyModeStyle()       {
    const style = MODE_STYLE[this.mode];
    Object.values(this.boneMeshes).forEach((b) => {
      b.material.color.set(style.boneColor);
      b.material.transparent = style.opacity < 1;
      b.material.opacity = style.opacity;
    });
    (Object.entries(this.jointMeshes)                                 ).forEach(([name, joint]) => {
      void name;
      if (!joint) return;
      joint.material.color.set(style.jointColor);
      joint.material.transparent = style.opacity < 1;
      joint.material.opacity = style.opacity;
    });
  }

          updateCamera(now        , dt        )       {
    // Damped base position: view switches fly instead of snapping.
    this.displayBase.lerp(VIEW_OFFSETS[this.view], 1 - Math.exp(-dt * 7));
    const base = this.displayBase;
    // Gentle idle sway after 3s without pointer input; any input kills it.
    const idleMs = now - this.interactions.lastInputAt;
    const idleYaw = idleMs > 3000 ? Math.sin(now * 0.00045) * 0.05 : 0;
    const yaw = this.cameraState.yawOffset + idleYaw;
    const pitch = this.cameraState.pitchOffset;
    const zoom = this.cameraState.zoom;
    const distance = base.length() / zoom;
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const x = (base.x * cosYaw - base.z * sinYaw) / base.length() * distance;
    const z = (base.x * sinYaw + base.z * cosYaw) / base.length() * distance;
    const y = base.y + pitch * 1.2;
    this.camera.position.set(x, TARGET_Y + y, z);
    this.camera.lookAt(0, TARGET_Y, 0);
  }

          updateSkeleton(frame                     , now        )       {
    if (!frame) {
      this.skeletonGroup.visible = false;
      return;
    }
    const withMesh = this.smplxHandle !== null;
    // mesh mode shows the bone rig together with the wireframe envelope.
    // avatar mode hides the rig entirely — the 3DGS figure carries the stage.
    this.skeletonGroup.visible = this.mode === "avatar" ? false : !withMesh || this.mode === "mesh";
    if (this.mode === "avatar" || (withMesh && this.mode !== "mesh")) return;

    const seed = frame.seedJoints;
    const pelvisX = seed.pelvis.position[0];
    const pelvisZ = seed.pelvis.position[2];
    const offsetX = -pelvisX; // recentre skeleton on its own pelvis along X
    // In mesh mode the rig shares the stage with the SMPL-X envelope — pull
    // joints toward the pelvis axis (X/Z only) so the rig floats clearly
    // inside the wireframe instead of tangling with the skin surface.
    const contract = this.mode === "mesh" ? 0.72 : 1;

    // Update joints first so bones can read positions back.
    const jointPos                                            = {};
    (Object.keys(this.jointMeshes)               ).forEach((name) => {
      const handle = this.jointMeshes[name];
      const joint = seed[name];
      if (!handle || !joint) return;
      const p = joint.position;
      const x = pelvisX + (p[0] - pelvisX) * contract + offsetX;
      const z = pelvisZ + (p[2] - pelvisZ) * contract;
      handle.mesh.position.set(x, p[1], z);
      jointPos[name] = handle.mesh.position;
    });

    const worst = this.stress || this.mode === "stress" ? worstMetric(frame) : null;
    const stressJoints = worst && worst.risk !== "good" ? STRESS_JOINTS_BY_METRIC[worst.id] ?? [] : [];
    const stressSet = new Set(stressJoints);
    // Low-frequency pulse makes stressed joints read at a glance (no glow).
    const pulse = 0.72 + 0.28 * Math.sin(now * 0.012);
    const stressColor = this.stressScratch.setHex(STRESS_COLOR).multiplyScalar(pulse);
    const baseJointColor = MODE_STYLE[this.mode].jointColor;
    (Object.entries(this.jointMeshes)                                 ).forEach(([name, joint]) => {
      if (!joint) return;
      joint.material.color.set(stressSet.has(name) ? stressColor : baseJointColor);
    });

    const baseBoneColor = MODE_STYLE[this.mode].boneColor;
    const dirTmp = new THREE.Vector3();
    bones.forEach(([a, b]) => {
      const handle = this.boneMeshes[`${a}->${b}`];
      if (!handle) return;
      const pa = jointPos[a];
      const pb = jointPos[b];
      if (!pa || !pb) return;
      dirTmp.subVectors(pb, pa);
      const length = dirTmp.length();
      if (length < 1e-5) {
        handle.mesh.visible = false;
        return;
      }
      handle.mesh.visible = true;
      handle.mesh.position.set((pa.x + pb.x) * 0.5, (pa.y + pb.y) * 0.5, (pa.z + pb.z) * 0.5);
      dirTmp.normalize();
      handle.quaternion.setFromUnitVectors(Y_AXIS, dirTmp);
      handle.smoothed.slerp(handle.quaternion, 0.5);
      handle.mesh.quaternion.copy(handle.smoothed);
      handle.mesh.scale.set(1, length, 1);
      handle.material.color.set(stressSet.has(a) || stressSet.has(b) ? stressColor : baseBoneColor);
    });
  }

          updateSmplxMesh(frame                     )       {
    const handle = this.smplxHandle;
    if (!handle) return;
    if (!frame) {
      handle.mesh.visible = false;
      handle.wireMesh.visible = false;
      return;
    }
    // Solid envelope in coach/stress mode; wireframe blueprint in mesh mode.
    // In avatar mode a loaded 3DGS avatar takes over the stage; while it is
    // still streaming in (or failed) the solid envelope stays as placeholder.
    const avatarActive = this.mode === "avatar" && this.avatarHandle !== null;
    handle.mesh.visible = this.mode !== "mesh" && !avatarActive;
    handle.wireMesh.visible = this.mode === "mesh";
    const idx = sampleFrameIndex(handle.clip, frame.progress);
    if (idx === handle.lastFrameIndex) return;
    handle.lastFrameIndex = idx;
    copyFrameVerticesInto(handle.clip, idx, handle.positions);
    const attr = handle.geometry.getAttribute("position")                                              ;
    attr.needsUpdate = true;
    handle.geometry.computeVertexNormals();
    handle.geometry.computeBoundingSphere();
  }

          updateAvatar(frame                     )       {
    const avatar = this.avatarHandle;
    if (!avatar) return;
    // The avatar only owns the stage in avatar mode; every other mode hides it.
    if (!frame || this.mode !== "avatar") {
      avatar.object3d.visible = false;
      return;
    }
    avatar.object3d.visible = true;
    // Clamp (not wrap) so the avatar holds the final frame at session end,
    // in line with the skeleton/mesh/video layers.
    const clamped = Math.max(0, Math.min(1, frame.progress));
    const idx = Math.min(avatar.frameCount - 1, Math.floor(clamped * avatar.frameCount));
    if (idx !== this.lastAvatarFrame) {
      this.lastAvatarFrame = idx;
      avatar.setFrame(idx);
    }
    avatar.update(this.camera);
  }
}

function worstMetric(frame              )                                         {
  let worst                                         = null;
  for (const m of frame.metrics) {
    if (!worst || m.score < worst.score) worst = m;
  }
  return worst;
}
