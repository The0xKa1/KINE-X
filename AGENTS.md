# AGENTS.md

This file provides guidance to coding agents (Codex, Claude Code, Kimi, etc.) when working with this repository.

KINE//X is a hackathon prototype: import a short sports clip → reconstruct it into a 3D coach (CoachClip skeleton + SMPL-X mesh) → score the user's live camera pose against it in the browser → LLM post-session feedback.

## Commands

- `npm run build` — strip TS types from `src/**/*.ts` into `dist/**/*.js`. Uses Node's built-in `node:module` `stripTypeScriptTypes` (no `tsc`, no bundler). See `scripts/build.mjs`.
- `npm run dev` — build, then serve the repo root with `python3 -m http.server 5173`. Open `http://localhost:5173`.
- `npm run check` — build, then run `scripts/guardrails.mjs`. This is the project's only test gate; **run it before declaring any change done**.
- `npm run server:install` / `npm run server` — LLM proxy on :8766 (needs `.env`, see `.env.example`).
- Type-checking is advisory only: `npx tsc --noEmit` currently reports ~11 known diagnostics (`noUncheckedIndexedAccess` strictness in a handful of files). Not wired into the gate.

There is no test runner, linter, or formatter. The guardrail script is the source of truth.

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

These rules trace back to `docs/Constraint.md` (in Chinese) — the hard contract for the prototype.

## Architecture

Vanilla TypeScript SPA. No framework, no bundler, zero `package.json` dependencies. Rendering is **real Three.js** (WebGL): `src/core/three-compat.ts` is a facade that re-exports the THREE pieces the app uses as a single `THREE` object; `MotionStage` renders a cylinder-bone / sphere-joint skeleton plus an optional SMPL-X `MeshClip` (10 475 vertices, baked by the import backend) on the same canvas.

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

- **`src/core/Router.ts` + `src/components/pages/`** — hash-router SPA: `#/` library, `#/train/:seedId` train bay, `#/report/:sessionId?` report, `#/create` import wizard. Pages are containers in one DOM toggled via `hidden` + `enter/leave` lifecycle — no reloads, so MediaPipe assets, the WebSocket and the camera stream survive navigation. `TrainPage.leave()` stops the stage RAF + playback; `enter()` resumes.
- **`src/core/RealtimeStream.ts`** — playback clock + `FRAME_STREAM` packet factory. Only produces frames for exercises that have a `clip` — the built-in `squat` seed (`public/coach_clips/single_leg_squat.json`) plus anything imported through the backend. The retired clip-less seeds were removed; their metric weights live on as `MOTION_METRIC_TEMPLATES` in `src/data/exercises.ts` for imported clips.
- **`src/core/frameBuffer.ts` — `MotionFrameBuffer`**: holds *only* the latest `RuntimeFrame`. This is the state-isolation seam that keeps 30–60 fps frame data out of any reactive system. UI reads via `readLatest()` from inside RAF (`MotionStage` only); never via event subscriptions.
- **`src/hooks/useWebSocket.ts`** — real WebSocket client (`connect` / `disconnect` / `reconnect` with 1s→30s backoff, PING/PONG heartbeat 15s/8s). Incoming `FRAME_STREAM` packets enter the same `consumePacket → pushPacket` path as local frames, so a live backend blends in transparently. Default URL `ws://localhost:8000/motion`, override with `?ws=`.
- **`src/core/SessionGate.ts`** — session lifecycle `idle → countdown(3s) → active → finished`. Live scoring (`applyLiveScore`) only runs in `active`. The countdown starts from the start button or a held OK hand gesture (`OkGestureDetector`, 0.6s hold); `SessionStartOverlay` renders the gate UI. Reaching `progress >= 1` in `active` auto-opens the results screen.
- **`src/core/EventBus.ts`** — typed pub/sub for low-frequency UI events only: `score:update`, `pipeline:update`, `seed:update`, `camera:update`, `camera:error`, `session:state`, `session:gesture`, `calibration:ready`. Never put per-frame data on the bus.
- **`src/main.ts`** — composition root. Boot runs through `BootSequence` (full-screen overlay whose checks light up on real milestones: clip/mesh hydration, MediaPipe probe, stream standby; click or 9s failsafe skips), then the `Router` enters the initial route (default `#/`). Also resolves `BACKEND_URL` (:8765 import backend; `?backend=` override persisted to localStorage), hydrates built-in clips + default SMPL-X mesh + imported jobs, and self-heals timeline thumbnails (`healTimelineThumbnails` re-renders them from the in-memory mesh clip when the baked JPGs 404).
- **`src/core/scoring/SessionArchive.ts`** — localStorage history of finished sessions (`kinex.sessions.v1`, newest first, max 20). Written by `ResultsScreen.open()`; consumed by the report page and library stats.
- **`src/config.ts`** — `API_BASE_URL` for the LLM proxy (:8766; `?api=` override persisted to localStorage).
- **`src/components/`** — `layout/` (`AppShell`) and `gameui/` (overlay widgets). UI subscribes to bus events; it never reads from `MotionFrameBuffer`.

### Coordinate & rotation contract

- Units are **meters** everywhere (`Vec3Meters`).
- Right-hand coordinate system: Y up, X right, Z out of screen (`WORLD_SPACE` in `src/core/coordinates.ts`).
- Rotations transit as `QuaternionTuple` (`[x, y, z, w]`) on the wire and are converted to real THREE quaternions inside `MotionFrameBuffer.toRuntimeFrame`. Smoothing uses `slerp` in `MotionStage.consumeRotations` (`alpha = 0.4`).
- The evaluator camera `<video>` is CSS-mirrored (`scaleX(-1)`); the motion-coach `<canvas>` is not. The 2D skeleton贴合层 inside the camera bay is drawn by `CameraOverlay` on a Canvas 2D overlay.

## Backend services (separate processes, optional for the frontend demo)

- `backend/` :8765 — SAM 3D Body video import (FastAPI + GPU). `POST /import/video` (multipart; optional `startSec` / `endSec` slicing, `motion`, `targetFps`, `name`), `GET /import/jobs`, `GET /healthz`. Artifacts land in `public/coach_clips/jobs/<jobId>/` and are served by the frontend's own static server. Heavy deps (torch, sam-3d-body, ffmpeg) are **not** in `backend/requirements.txt` — see `backend/README.md`.
- `server/` :8766 — LLM proxy (FastAPI + httpx). `POST /api/segment` (MLLM video segmentation from sampled frames), `POST /api/chat-stream` (OpenAI-compatible SSE passthrough), `GET /api/health`. API credentials live server-side in `.env`; the browser never holds an LLM key (persona is selectable in the camera settings drawer).

## Legacy / dead code (do not resurrect without a reason)

- `src/bootstrap/MockStream.ts`, `src/mock/mockFrameSource.ts` — the pre-CoachClip mock path; unreferenced since `RealtimeStream` took over frame production.
- `src/core/import/landmarksToPose.ts`, `src/core/import/postProcess.ts` — the old in-browser import pipeline (heavy BlazePose in the tab), replaced by the SAM3D backend import. `VideoSeeker` is still used — for MLLM frame sampling and segment thumbnails.
- `assets/smpl-lite-rig.gltf` — a 392-byte stub referenced by nothing; `MotionStage.preload()` is now just loading-overlay pacing.

## When extending the prototype

- Adding a page: create it under `src/components/pages/`, register it in the `Router` in `main.ts`, add its container to `index.html`, and put its styles in a new `src/styles/<page>.css` (imported at the end of `styles.css`).
- Adding a new UI surface inside a page: put it under `src/components/gameui/` and subscribe to bus events. Never read from `MotionFrameBuffer` outside `MotionStage`.
- Adding a new exercise seed: extend `src/data/exercises.ts`; attach a clip via `COACH_CLIP_MANIFEST` in `src/core/import/loadCoachClip.ts`, or generate one through the import drawer (backend import).
- Wiring a real frame backend: serve `FRAME_STREAM` packets over WebSocket and point the app at it with `?ws=`. The packet shape in README "运动数据契约" is the contract; the frontend side is already done.
- LLM / AI coach work: `src/core/llm/` (`LLMClient`, `buildPrompt`, `renderMarkdown`) talks to `server/main.py`; MLLM video segmentation lives in `src/core/mllm/`.
- Touching anything render-loop adjacent: re-run `npm run check` and verify no new `Euler` / `useState` / `ref(` slipped in, and that any new rotation work goes through quaternions.

## Docs map

- `docs/Constraint.md` — hard engineering & data-flow contract (Chinese).
- `docs/goal.md` — product / demo goals.
- `docs/curren.md` — current factual state of the system.
- `docs/project_index.md` — module-by-module index and collaboration boundaries.
- `README.md` — overview, quickstart, `FRAME_STREAM` data contract.
