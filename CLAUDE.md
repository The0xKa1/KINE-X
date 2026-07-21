# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. `AGENTS.md` carries the same content for other coding agents; keep the two in sync.

KINE//X is a hackathon prototype: import a short sports clip → reconstruct it into a 3D coach (CoachClip skeleton + SMPL-X mesh) → score the user's live camera pose against it in the browser → LLM post-session feedback.

## Commands

- `npm run build` — strip TS types from `src/**/*.ts` into `dist/**/*.js`. Uses Node's built-in `node:module` `stripTypeScriptTypes` (no `tsc`, no bundler). See `scripts/build.mjs`.
- `npm run dev` — build, then serve the repo root with `python3 -m http.server 5173`. Open `http://localhost:5173`.
- `npm run check` — build, then run `scripts/guardrails.mjs`. **Run it before declaring any change done**.
- `npm run test:avatar` — avatar vault frontend tests (`node --test scripts/avatar-*.test.mjs`).
- `python3 -m unittest backend.test_avatar_assets backend.test_avatar_registry backend.test_avatar_api backend.test_avatar_binding` — avatar backend regression gate.
- `npm run test:ai` — direct OpenAI-compatible MLLM / post-session API client contract tests.
- `npm run test:session` — local workout archive deletion and history UI contract tests.
- Type-checking is advisory only: `npx tsc --noEmit` currently reports 8 known diagnostics (`noUncheckedIndexedAccess` strictness in a handful of files). Not wired into the gate.

No linter or formatter. The guardrail script plus the avatar test suites are the source of truth.

## Build pipeline quirks (important)

- The build only **strips types** — it does not transpile, bundle, or resolve. Each `src/foo/bar.ts` becomes `dist/foo/bar.js` with the same shape.
- Because of this, **all relative imports in `.ts` source must use the `.js` extension** (e.g. `import { EventBus } from "./core/EventBus.js"`). The path resolves at runtime in the browser against `dist/`.
- `index.html` loads `./dist/main.js` directly as `<script type="module">`. There is no dev server with HMR. After editing TS, re-run `npm run build` (or `npm run dev`).
- Runtime deps come from the `index.html` importmap, both fully local/offline: `three` → `./public/three/three.module.min.js` (r160), `@mediapipe/tasks-vision` → `./public/mediapipe/` bundle. Only Google Fonts still uses a CDN (system-font fallback offline).
- `tsconfig.json` has `"noEmit": true` — `tsc` is only for diagnostics, never for output.

## Guardrails (enforced by `scripts/guardrails.mjs`)

The guardrail script greps `src/**/*.{ts,css}` for required and forbidden patterns, then `node --check`s every file in `dist/`. Any change must keep these invariants:

Required patterns must appear somewhere in source:
- `unit: "meters"` and `handedness: "right-hand"` — see `src/core/coordinates.ts` `WORLD_SPACE`.
- `scaleX(-1)` — camera video must be horizontally mirrored (`src/styles/`, `WebCamManager`). The 3D coach canvas is **not** mirrored.
- `requestAnimationFrame` — render loop pull-driven from RAF, not pushed by data events.
- `.slerp(` — quaternion interpolation must be used for rotation smoothing.
- `disposeSceneResources(` — called on seed switch / scene rebuild to prevent leaks.
- `pushPacket(packet` — frame ingress goes through `MotionFrameBuffer.pushPacket`.

Forbidden anywhere in source:
- `Euler` — rotations are quaternions only, end to end. No Euler-angle transport.
- `useState`, `ref(` — high-frequency frame data must never go through React/Vue reactive state. The project is vanilla TS, so these would also signal an unwanted framework dep.

These rules are the hard contract for the prototype (the original `docs/Constraint.md` was retired in the docs cleanup — this section and the guardrail script are now the source of truth).

## Architecture

Vanilla TypeScript SPA. No framework, no bundler, zero `package.json` dependencies. Rendering is **real Three.js** (WebGL): `src/core/three-compat.ts` is a facade that re-exports the THREE pieces the app uses as a single `THREE` object; `MotionStage` renders a cylinder-bone / sphere-joint skeleton plus an optional SMPL-X `MeshClip` (10 475 vertices, baked by the import backend) on the same canvas. Avatars are **decoupled from motions**: a 3DGS identity (`KINEXGI1` — static gaussians + 55-joint rest skeleton + LBS weights, built once from a photo) combines with any motion (`KINEXGM1` — per-frame local quaternions + root translation, packed once per imported video) through an idempotent server-side binding. `src/core/avatar/GaussianAvatar.ts` loads identity and motion independently, runs 55-joint FK per displayed frame, and renders with per-gaussian LBS in the vertex shader + CPU depth sort. The avatar is a stage display mode (`MotionMode "avatar"`), unlocked per seed only when its binding is ready; legacy combined `KINEXGS1` bins stay readable for the built-in demo. Mode visibility: avatar mode = splats only, coach/stress = envelope, mesh = wireframe + rig.

Frame data flow:

```
RealtimeStream (self-driven RAF + CameraOverlay.onPose ticks, 30ms gate)
  → sampleClip(exercise.clip, progress)        // coach pose from CoachClip
  → applyLiveScore(packet, scorer)             // only while SessionGate is "active"
  → socket.consumePacket → MotionFrameBuffer.pushPacket   // sole ingress
  → MotionStage RAF tick → buffer.readLatest() → three.js render
  → EventBus "score:update" (throttled ~120ms) → UI widgets
```

Key boundaries:

- **`src/core/Router.ts` + `src/components/pages/`** — hash-router SPA: `#/` library, `#/train/:seedId` train bay, `#/report/:sessionId?` report, `#/create` import wizard, `#/avatars` avatar vault. Pages are containers in one DOM toggled via `hidden` + `enter/leave` lifecycle — no reloads, so MediaPipe assets, the WebSocket and the camera stream survive navigation. `TrainPage.leave()` stops the stage RAF + playback; `enter()` resumes.
- **`src/core/RealtimeStream.ts`** — playback clock + `FRAME_STREAM` packet factory. Only produces frames for exercises that have a `clip` — the built-in `squat` seed (`public/coach_clips/single_leg_squat.json`) plus anything imported through the backend. The retired clip-less seeds were removed; their metric weights live on as `MOTION_METRIC_TEMPLATES` in `src/data/exercises.ts` for imported clips.
- **`src/core/frameBuffer.ts` — `MotionFrameBuffer`**: holds *only* the latest `RuntimeFrame`. This is the state-isolation seam that keeps 30–60 fps frame data out of any reactive system. UI reads via `readLatest()` from inside RAF (`MotionStage` only); never via event subscriptions.
- **`src/hooks/useWebSocket.ts`** — real WebSocket client (`connect` / `disconnect` / `reconnect` with 1s→30s backoff, PING/PONG heartbeat 15s/8s). Incoming `FRAME_STREAM` packets enter the same `consumePacket → pushPacket` path as local frames, so a live backend blends in transparently. Default URL `ws://localhost:8000/motion`, override with `?ws=`.
- **`src/core/SessionGate.ts`** — session lifecycle `idle → countdown(3s) → active → finished`. Live scoring (`applyLiveScore`) only runs in `active`. The countdown starts from the start button or a held OK hand gesture (`OkGestureDetector`, 0.6s hold); `SessionStartOverlay` renders the gate UI. Reaching `progress >= 1` in `active` auto-opens the results screen.
- **`src/core/EventBus.ts`** — typed pub/sub for low-frequency UI events only: `score:update`, `pipeline:update`, `seed:update`, `camera:update`, `camera:error`, `session:state`, `session:gesture`, `calibration:ready`. Never put per-frame data on the bus.
- **`src/main.ts`** — composition root. Boot runs through `BootSequence` (full-screen overlay whose checks light up on real milestones: clip/mesh hydration, MediaPipe probe, stream standby; click or 9s failsafe skips), then the `Router` enters the initial route (default `#/`). Also resolves `BACKEND_URL` (:8765 import backend; `?backend=` override persisted to localStorage), hydrates built-in clips + default SMPL-X mesh + imported jobs (video jobs become new seeds, then `AvatarBindingController` discovers/restores bindings from server manifests; once hydration lands, the library re-renders if visible and a pending train deep link is repaired), and self-heals timeline thumbnails (`healTimelineThumbnails` re-renders them from the in-memory mesh clip when the baked JPGs 404).
- **`src/core/scoring/SessionArchive.ts`** — localStorage history of finished sessions (`kinex.sessions.v1`, newest first, max 20). Written by `ResultsScreen.open()`; consumed by the report page and library stats. Individual records can be removed from either the library history or the active report after confirmation.
- **`src/components/gameui/CameraSettings.ts`** — camera, MediaPipe, calibration, persona, and user-owned AI API settings. Base URL / API Key plus separate MLLM and coach model names are stored in browser localStorage; requests go directly to the configured OpenAI-compatible endpoint.
- **`src/components/`** — `layout/` (`AppShell`) and `gameui/` (overlay widgets). UI subscribes to bus events; it never reads from `MotionFrameBuffer`.

### Coordinate & rotation contract

- Units are **meters** everywhere (`Vec3Meters`).
- Right-hand coordinate system: Y up, X right, Z out of screen (`WORLD_SPACE` in `src/core/coordinates.ts`).
- Rotations transit as `QuaternionTuple` (`[x, y, z, w]`) on the wire and are converted to real THREE quaternions inside `MotionFrameBuffer.toRuntimeFrame`. Smoothing uses `slerp` in `MotionStage.consumeRotations` (`alpha = 0.4`).
- The evaluator camera `<video>` is CSS-mirrored (`scaleX(-1)`); the motion-coach `<canvas>` is not. The 2D skeleton贴合层 inside the camera bay is drawn by `CameraOverlay` on a Canvas 2D overlay.

## Backend services (separate processes, optional for the frontend demo)

- `backend/` :8765 — SAM 3D Body video import + Avatar Vault (FastAPI + GPU). `POST /import/video` (multipart; optional `startSec`/`endSec` slicing, `motion`, `targetFps`, `name`, `avatarId`; the job record carries `sourceVideoUrl` once `segment.mp4` exists), `GET /import/jobs`, `GET|POST /avatars`, `PATCH|DELETE /avatars/{avatarId}`, `GET|POST /avatar-bindings`, `GET /healthz`. Video artifacts land in `public/coach_clips/jobs/<jobId>/`; the vault registry lives under `public/coach_clips/{avatar-identities,motions,avatar-bindings}/`; private LHM source videos live in `~/.local/share/kinex/avatar-jobs/` — never under the static root. Heavy deps (torch, sam-3d-body, LHM, ffmpeg) are **not** in `backend/requirements.txt` — see `backend/README.md`.
- AI API calls are browser-direct and user-owned. `VideoSegmentationClient` sends sampled frames to the configured MLLM, while `LLMClient` streams post-session analysis from the separately configured coach model. Providers must expose a CORS-enabled OpenAI-compatible `/chat/completions` endpoint.

## Legacy / dead code (do not resurrect without a reason)

- `src/bootstrap/MockStream.ts`, `src/mock/mockFrameSource.ts` — the pre-CoachClip mock path; unreferenced since `RealtimeStream` took over frame production.
- `src/core/import/landmarksToPose.ts`, `src/core/import/postProcess.ts` — the old in-browser import pipeline (heavy BlazePose in the tab), replaced by the SAM3D backend import. `VideoSeeker` is still used — for MLLM frame sampling and segment thumbnails.
- `assets/smpl-lite-rig.gltf` — a 392-byte stub referenced by nothing; `MotionStage.preload()` is now just loading-overlay pacing.

## When extending the prototype

- Adding a page: create it under `src/components/pages/`, register it in the `Router` in `main.ts`, add its container to `index.html`, and put its styles in a new `src/styles/<page>.css` (imported at the end of `styles.css`).
- Adding a new UI surface inside a page: put it under `src/components/gameui/` and subscribe to bus events. Never read from `MotionFrameBuffer` outside `MotionStage`.
- Adding a new exercise seed: extend `src/data/exercises.ts`; attach a clip via `COACH_CLIP_MANIFEST` in `src/core/import/loadCoachClip.ts`, or generate one through the import drawer (backend import).
- `#/create` is the video import wizard (`ImportFlow` → `POST /import/video`) with an optional single READY-identity picker before analysis. Photo → identity lives on its own page `#/avatars` (`AvatarVaultPage` → `POST /avatars`); the old `#/create` photo branch and the `AvatarImportFlow` jobId flow are retired — `POST /import/avatar` survives only as a compatibility alias.
- Wiring a real frame backend: serve `FRAME_STREAM` packets over WebSocket and point the app at it with `?ws=`. The packet shape in README "运动数据契约" is the contract; the frontend side is already done.
- LLM / AI coach work: `src/core/llm/` (`LLMClient`, `buildPrompt`, `renderMarkdown`) talks directly to the user-configured OpenAI-compatible endpoint; MLLM video segmentation lives in `src/core/mllm/` and shares the Base URL / API Key while using its own model field.
- Touching anything render-loop adjacent: re-run `npm run check` and verify no new `Euler` / `useState` / `ref(` slipped in, and that any new rotation work goes through quaternions.

## Docs map

- `docs/curren.md` — current factual state of the system.
- `docs/handoff.md` — reproducible stop point, traps, and next steps.
- `docs/project_index.md` — module-by-module index and collaboration boundaries.
- `docs/server-workflow.md` — AutoDL server operations workflow.
- `README.md` — overview, quickstart, `FRAME_STREAM` data contract.
