---
title: Avatar Vault implementation plan
form: design
topic: [implementation, avatar]
updated: 2026-07-19
status: active
tags: [avatar-vault, 3dgs, plan]
---

# Avatar Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a server-backed avatar gallery and let any imported action optionally drive a reusable, rotatable 3DGS identity in the training bay.

**Architecture:** Split the legacy `KINEXGS1` payload into an identity file (`KINEXGI1`: static gaussians, rest joints, parents) and a motion file (`KINEXGM1`: local Quaternion rotations, translation, stage transform). Persist identity, motion, and binding manifests on the filesystem; combine identity and motion in the browser with 55-joint forward kinematics before the existing shader LBS path.

**Tech Stack:** Vanilla TypeScript ES modules, Three.js r160, FastAPI, Python stdlib + NumPy, LHM `video2motion.py`, Node built-in test runner, Python `unittest`.

## Global Constraints

- Units remain meters and coordinates remain right-handed: Y up, X right, Z out of screen.
- Rotations are transported as Quaternion `[x, y, z, w]`; no Euler values enter source or assets.
- High-frequency animation state stays inside the render runtime; UI never reads `MotionFrameBuffer`.
- Ordinary motion import succeeds independently of optional avatar preparation.
- Server filesystem manifests are the source of truth; no database, authentication, or browser-authoritative registry is introduced.
- Deletion is conservative: hide the identity, delete the source photo, cancel unfinished bindings, and retain identity data referenced by ready bindings.
- Legacy `KINEXGS1` remains playable during migration.
- Every implementation task ends with its targeted tests and `npm run check` where frontend source changes.

---

## File map

- `backend/avatar_assets.py`: binary identity/motion codecs, legacy split, Quaternion packing, stage-alignment helpers.
- `backend/avatar_registry.py`: atomic JSON manifest store for identities, motions, and bindings.
- `backend/avatar_motion.py`: LHM video-to-SMPL-X subprocess and `KINEXGM1` creation.
- `backend/app.py`: HTTP endpoints and background orchestration.
- `backend/avatar.py`: identity-only completion path after LHM reconstruction.
- `backend/config.py`: registry roots and LHM motion extractor settings.
- `backend/test_avatar_assets.py`, `backend/test_avatar_registry.py`, `backend/test_avatar_api.py`, `backend/test_avatar_binding.py`: deterministic backend tests.
- `src/core/avatar/AvatarAssets.ts`: pure browser parsers and forward kinematics.
- `src/core/avatar/GaussianAvatar.ts`: identity/motion runtime and legacy adapter.
- `src/core/avatar/AvatarRegistryClient.ts`: typed API client and polling.
- `src/core/avatar/AvatarBindingController.ts`: pending-binding hydration independent of page DOM.
- `src/components/pages/AvatarVaultPage.ts`: dedicated server-backed gallery and 3D preview.
- `src/components/pages/CreatePage.ts`, `src/core/import/ImportFlow.ts`: optional identity picker and avatarId upload field.
- `src/core/Router.ts`, `src/bootstrap/dom.ts`, `src/main.ts`, `index.html`: fifth route and lifecycle wiring.
- `src/styles/avatar-vault.css`, `src/styles/create.css`, `src/styles.css`: gallery and picker styling.
- `scripts/avatar-assets.test.mjs`: Node parser/FK regression tests.
- `scripts/avatar-registry-client.test.mjs`, `scripts/avatar-binding-controller.test.mjs`: API and progressive-unlock tests.

### Task 1: Binary asset codecs

**Files:**
- Create: `backend/avatar_assets.py`
- Create: `backend/test_avatar_assets.py`

**Interfaces:**
- Produces: `split_legacy_asset(source, identity_path, motion_path, joint_null, parents) -> tuple[dict, dict]`
- Produces: `pack_motion_jsons(paths, output_path, *, fps, stage_transform) -> dict`
- Produces: `axis_angle_to_quaternion(rotvec) -> np.ndarray`

- [ ] **Step 1: Write failing codec tests**

Create fixtures entirely in a temporary directory. Assert that splitting a two-gaussian/two-frame `KINEXGS1` fixture produces `KINEXGI1` and `KINEXGM1`, preserves all static arrays, converts local axis-angle identity rotations to `[0,0,0,1]`, and rejects truncated payloads.

- [ ] **Step 2: Run the tests and confirm failure**

Run: `python3 -m unittest backend.test_avatar_assets -v`

Expected: FAIL because `backend.avatar_assets` does not exist.

- [ ] **Step 3: Implement exact binary layouts**

Use eight-byte magic headers and little-endian fields:

```text
KINEXGI1 | u32 N | u32 J | u32 headerLen | JSON |
static gaussian arrays | jointNull J*3 f32 | parents J*i16

KINEXGM1 | u32 F | u32 J | u32 headerLen | JSON |
localRotations F*J*4 f32 xyzw | trans F*3 f32
```

Validate `1 <= N <= 65536`, `J == 55`, `F >= 1`, exact array lengths, finite floats, parent indices, and normalized Quaternions. Write through a temporary sibling and `Path.replace()` so a crash cannot publish a partial asset.

- [ ] **Step 4: Run codec tests**

Run: `python3 -m unittest backend.test_avatar_assets -v`

Expected: all codec tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/avatar_assets.py backend/test_avatar_assets.py
git commit -m "feat(avatar): add reusable identity and motion codecs"
```

### Task 2: Filesystem avatar registry

**Files:**
- Create: `backend/avatar_registry.py`
- Create: `backend/test_avatar_registry.py`
- Modify: `backend/config.py`

**Interfaces:**
- Produces: `AvatarRegistry(root: Path)` with `list_identities`, `create_identity`, `update_identity`, `soft_delete_identity`, `upsert_motion`, `create_binding`, `update_binding`, and `list_bindings`.
- Records use `avatarId`, `motionId`, `bindingId`, `status`, `progress`, `createdAt`, `finishedAt`, URL fields, and optional `deletedAt`/`error`.

- [ ] **Step 1: Write registry tests**

Cover newest-first active identities, rename persistence after constructing a second registry instance, idempotent `(avatarId,motionId)` bindings, soft delete hiding identities, cancellation of queued/running bindings, preservation of ready bindings, and rejection of bindings to deleted identities.

- [ ] **Step 2: Confirm tests fail**

Run: `python3 -m unittest backend.test_avatar_registry -v`

Expected: FAIL because `AvatarRegistry` is undefined.

- [ ] **Step 3: Implement atomic manifest persistence**

Store identity records under `AVATAR_IDENTITIES_DIR/<avatarId>/record.json`, motion records under `AVATAR_MOTIONS_DIR/<motionId>/record.json`, and bindings under `AVATAR_BINDINGS_DIR/<bindingId>.json`. Guard mutations with one `threading.RLock`; write JSON using temporary files plus replace. Generate stable prefixes `av-`, `motion-`, and `binding-`.

- [ ] **Step 4: Run registry tests**

Run: `python3 -m unittest backend.test_avatar_registry -v`

Expected: all registry tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/avatar_registry.py backend/test_avatar_registry.py backend/config.py
git commit -m "feat(avatar): persist identities motions and bindings"
```

### Task 3: Identity API and identity-only generation

**Files:**
- Modify: `backend/avatar.py`
- Modify: `backend/app.py`
- Modify: `backend/requirements.txt`
- Create: `backend/test_avatar_api.py`

**Interfaces:**
- Produces HTTP: `GET/POST /avatars`, `PATCH/DELETE /avatars/{avatarId}`.
- Preserves `POST /import/avatar` as a compatibility alias that returns the new identity record.

- [ ] **Step 1: Add API tests with a temporary registry and stub exporter**

Use FastAPI `TestClient` with `AVATAR_EXPORT_STUB=1`; assert upload returns 202, list returns queued/running/ready records, PATCH trims and persists a name, DELETE returns a tombstoned record, invalid MIME returns 400, and deleted identities disappear from the default list.

- [ ] **Step 2: Confirm API tests fail**

Run: `python3 -m unittest backend.test_avatar_api -v`

Expected: new routes return 404.

- [ ] **Step 3: Change the LHM completion path**

Keep the current export and alignment validation, then call `split_legacy_asset()` with `joint_null` from the exporter NPZ and SMPL-X parent indices supplied by the exporter metadata. Publish `identity.bin` and a copied preview image inside the identity directory. Do not attach the identity to `ugc-squat`.

- [ ] **Step 4: Implement routes and cancellation guards**

Before a worker publishes ready state, reload the identity record and exit if `deletedAt` is set. PATCH accepts `{ "name": "..." }`. DELETE soft-deletes, removes the source photo, and marks unfinished bindings cancelled.

- [ ] **Step 5: Run API and backend tests**

Run: `python3 -m unittest backend.test_avatar_assets backend.test_avatar_registry backend.test_avatar_api -v`

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/avatar.py backend/app.py backend/requirements.txt backend/test_avatar_api.py
git commit -m "feat(avatar): expose server backed identity API"
```

### Task 4: Motion extraction and binding orchestration

**Files:**
- Create: `backend/avatar_motion.py`
- Modify: `backend/app.py`
- Modify: `backend/pipeline.py`
- Modify: `backend/config.py`
- Create: `backend/test_avatar_binding.py`

**Interfaces:**
- `POST /import/video` accepts optional multipart `avatarId`.
- Successful response adds `motionId`, `bindingId`, and `bindingStatus` when selected.
- Produces HTTP: `GET /avatar-bindings`, `POST /avatar-bindings`.

- [ ] **Step 1: Write orchestration tests**

Stub the ordinary SAM pipeline and LHM subprocess. Assert no avatar selection preserves the current response; a selected identity returns the ordinary result immediately plus a queued binding; repeated binding requests return the same binding; motion failure marks only the binding error; and deleted identities return 409.

- [ ] **Step 2: Confirm tests fail**

Run: `python3 -m unittest backend.test_avatar_binding -v`

Expected: `avatarId` is ignored and binding routes return 404.

- [ ] **Step 3: Implement the LHM motion adapter**

Persist the selected source video inside the job directory. Invoke `/root/autodl-tmp/LHM/engine/pose_estimation/video2motion.py` through configurable `LHM_PYTHON`, `LHM_MOTION_SCRIPT`, and `LHM_MOTION_MODEL_PATH`. Pack its per-frame axis-angle JSON into local xyzw Quaternions with `pack_motion_jsons()`. Compute one stage similarity transform against the generated CoachClip and store it in motion metadata.

- [ ] **Step 4: Run avatar preparation in the background**

After the ordinary pipeline response is complete, enqueue motion extraction through an executor. Persist progress in the motion and binding records. Publish ready only after the motion asset has been atomically written. Delete the persisted source video after success or terminal error.

- [ ] **Step 5: Run binding tests**

Run: `python3 -m unittest backend.test_avatar_binding -v`

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/avatar_motion.py backend/app.py backend/pipeline.py backend/config.py backend/test_avatar_binding.py
git commit -m "feat(avatar): prepare reusable motion bindings"
```

### Task 5: Browser asset parser and 55-joint FK runtime

**Files:**
- Create: `src/core/avatar/AvatarAssets.ts`
- Modify: `src/core/avatar/GaussianAvatar.ts`
- Create: `scripts/avatar-assets.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `parseAvatarIdentity(buffer)`, `parseGaussianMotion(buffer)`, and `buildSkinningMatrices(identity, motion, frameIndex, target)`.
- Produces: `GaussianAvatar.loadIdentity(url)`, `GaussianMotion.load(url)`, `avatar.setMotion(motion)`, and `avatar.setProgress(progress)`.

- [ ] **Step 1: Write Node parser/FK tests**

Generate minimal in-memory identity and motion buffers. Assert headers and lengths, identity Quaternion pose producing identity matrices, a 90-degree child-joint Quaternion rotating the child translation correctly, progress selecting the expected frame, malformed parents failing, and legacy `KINEXGS1` parsing remaining supported.

- [ ] **Step 2: Confirm tests fail**

Run: `npm run build && node --test scripts/avatar-assets.test.mjs`

Expected: FAIL because `AvatarAssets.js` does not exist.

- [ ] **Step 3: Implement pure parsers and FK**

Use typed arrays without copying when aligned. Normalize input Quaternions, compose local transforms from rest-joint offsets, accumulate parent-to-child world transforms, then multiply by inverse rest translations to produce the same 55 column-major matrices consumed by the bone texture. Apply motion stage transform and translation exactly once.

- [ ] **Step 4: Refactor GaussianAvatar without changing shader contracts**

Static textures come from `AvatarIdentity`; `setProgress()` calls FK only when the selected frame changes and updates the existing bone texture/trans uniform. `GaussianAvatar.load()` remains the legacy combined-asset adapter.

- [ ] **Step 5: Run runtime tests and guardrails**

Run: `npm run test:avatar && npm run check`

Expected: Node tests PASS; guardrails PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/avatar/AvatarAssets.ts src/core/avatar/GaussianAvatar.ts scripts/avatar-assets.test.mjs package.json dist/
git commit -m "feat(avatar): combine reusable identities and motions in browser"
```

### Task 6: Avatar Vault page

**Files:**
- Create: `src/core/avatar/AvatarRegistryClient.ts`
- Create: `src/components/pages/AvatarVaultPage.ts`
- Create: `src/styles/avatar-vault.css`
- Modify: `src/styles.css`
- Modify: `src/core/Router.ts`
- Modify: `src/bootstrap/dom.ts`
- Modify: `src/main.ts`
- Modify: `index.html`
- Create: `scripts/avatar-registry-client.test.mjs`

**Interfaces:**
- Adds route `#/avatars` with `PageName "avatars"`.
- `AvatarRegistryClient` exposes list/upload/rename/remove and polls only while non-terminal records exist.

- [ ] **Step 1: Add deterministic client tests**

Mock `fetch` and verify URL/method/body contracts, newest-first response preservation, polling stop on all-terminal state, and surfaced HTTP error messages.

- [ ] **Step 2: Implement page and lifecycle**

Render empty/loading/offline/building/error/ready cards, upload input, retry, rename, conservative-delete confirmation, and metadata. Mount one preview avatar at a time; dispose previous WebGL resources on selection and `leave()`.

- [ ] **Step 3: Register route and rail item**

Add `#page-avatars`, a Rail button, `DomRefs.pageAvatars`, Router parsing, and `main.ts` navigation. Preserve single-DOM navigation so camera, MediaPipe, and WebSocket survive.

- [ ] **Step 4: Run tests and guardrails**

Run: `npm run test:avatar && npm run check`

Expected: tests and guardrails PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/avatar/AvatarRegistryClient.ts src/components/pages/AvatarVaultPage.ts src/styles/avatar-vault.css src/styles.css src/core/Router.ts src/bootstrap/dom.ts src/main.ts index.html dist/
git commit -m "feat(avatar): add server backed avatar vault page"
```

### Task 7: Optional avatar selection and progressive unlock

**Files:**
- Modify: `src/components/pages/CreatePage.ts`
- Modify: `src/core/import/ImportFlow.ts`
- Create: `src/core/avatar/AvatarBindingController.ts`
- Modify: `src/main.ts`
- Modify: `src/data/exercises.ts`
- Modify: `src/styles/create.css`
- Create: `scripts/avatar-binding-controller.test.mjs`

**Interfaces:**
- `ImportApplyPayload` adds optional `motionId`, `bindingId`, `identityUrl`, and `motionAssetUrl`.
- Imported `ExerciseConfig` stores optional binding metadata while preserving legacy `avatarUrl`.

- [ ] **Step 1: Add flow tests**

Mock the avatar list and video import response. Assert default “不使用分身”, selected `avatarId` in multipart, immediate `onApply` after ordinary motion response, background binding polling, avatar mode hidden while pending, ready URLs unlocking the mode, and binding error leaving coach/mesh modes usable.

- [ ] **Step 2: Implement the optional picker**

Load active ready identities when the video tab initializes. Render zero-or-one selection with “不使用分身” as default. Disable only unavailable identity cards; never block ordinary parsing because the avatar API is offline.

- [ ] **Step 3: Implement progressive hydration**

Persist binding metadata on imported exercises, poll pending bindings after import and on app boot through `AvatarBindingController`, load identity plus motion when ready, and call `syncAvatarModeButton()`. Display binding progress in the avatar-mode loading surface without emitting per-frame EventBus traffic.

- [ ] **Step 4: Run frontend verification**

Run: `npm run test:avatar && npm run check`

Expected: all tests and guardrails PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/pages/CreatePage.ts src/core/import/ImportFlow.ts src/main.ts src/data/exercises.ts src/styles/create.css dist/
git commit -m "feat(avatar): select reusable identities during motion import"
```

### Task 8: Migration, server smoke, browser acceptance, and docs

**Files:**
- Create: `scripts/migrate-legacy-avatar.py`
- Modify: `backend/README.md`
- Modify: `docs/curren.md`
- Modify: `docs/project_index.md`
- Modify: `docs/handoff.md`

**Interfaces:**
- Migration converts the committed legacy demo using its debug NPZ when available and never deletes the source `KINEXGS1`.

- [ ] **Step 1: Run the complete local suite**

Run:

```bash
python3 -m unittest backend.test_avatar_assets backend.test_avatar_registry backend.test_avatar_api backend.test_avatar_binding -v
npm run test:avatar
npm run check
```

Expected: all backend tests PASS, Node tests PASS, guardrails PASS.

- [ ] **Step 2: Deploy code to AutoDL without deleting generated jobs**

Build locally and rsync only explicit source/build/backend paths. Keep `public/coach_clips/jobs` excluded. Restart `/root/start_all.sh` once and verify `/healthz`, `/avatars`, and `/avatar-bindings` return 200.

- [ ] **Step 3: Run stub identity and binding smoke**

With `AVATAR_EXPORT_STUB=1`, upload one photo, wait for identity ready, import a short action with its `avatarId`, verify ordinary seed response arrives first, then wait for binding ready and validate both binary headers over HTTP.

- [ ] **Step 4: Browser acceptance**

Through the SSH tunnel verify: avatar rail route, server-persisted gallery after reload, orbit preview, optional creation picker, ordinary training entry before binding completion, automatic avatar-mode unlock, real-time rotation/zoom/playback, export action, and conservative deletion preserving the existing training result.

- [ ] **Step 5: Update factual documentation**

Document only verified endpoint shapes, asset formats, runtime flow, environment variables, and observed smoke results. Remove the stale claim that avatars attach directly to `ugc-squat`.

- [ ] **Step 6: Final verification and commit**

Run the complete suite again, check `git diff --check`, and commit only intended files:

```bash
git add scripts/migrate-legacy-avatar.py backend/README.md docs/curren.md docs/project_index.md docs/handoff.md
git commit -m "docs: hand off reusable avatar vault workflow"
```
