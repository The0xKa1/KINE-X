# KINE//X Import Backend

FastAPI service that turns an uploaded short video into a KINE//X seed
(`coach.json` + `mesh.{bin,faces.bin,meta.json}` + frame jpgs) using SAM 3D Body
inference and the existing MHR→SMPLX baker.

## Pipeline

```
mp4/webm
  → ffmpeg (target fps, default 15)
  → frames/frame_%05d.jpg
  → SAM3DBodyEstimator.process_one_image per frame
  → raw_outputs/frame_*.npz
  → smpl_data.npz (stacked)
  → mesh.{bin, faces.bin, meta.json}   (SMPLX, 10475 verts, barycentric resample)
  → coach.json                          (17-joint skeleton, project conventions)
```

All artifacts land under `<repo>/public/coach_clips/jobs/<jobId>/`, which the
frontend's `:5173` static server already serves — the response is a JSON
manifest with relative URLs the browser can fetch directly. The job tree is
git-ignored.

## One-time prep

The service needs SAM 3D Body + MHR + SMPLX assets on disk and a Python env
with `torch + sam_3d_body` already installed. The dev host has these wired up:

| Variable             | Default                                                                              |
|----------------------|--------------------------------------------------------------------------------------|
| `SAM_CHECKPOINT`     | `~/.cache/modelscope/hub/models/facebook/sam-3d-body-dinov3/model.ckpt`              |
| `SAM_MHR_PATH`       | `~/.cache/modelscope/hub/models/facebook/sam-3d-body-dinov3/assets/mhr_model.pt`     |
| `MHR2SMPLX_MAPPING`  | `/mnt/data/home/zhangjinkai/sam_3d_smpl_workspace/MHR/tools/mhr_smpl_conversion/assets/mhr2smplx_mapping.npz` |
| `SMPLX_NEUTRAL`      | `/mnt/data/home/zhangjinkai/sam/smpl_models/smplx/SMPLX_NEUTRAL.npz`                 |
| `DINOV3_REPO`        | `/mnt/data/home/zhangjinkai/sam/output/dinov3` (local clone — bypasses `torch.hub` download from GitHub) |
| `PUBLIC_JOBS_DIR`    | `<repo>/public/coach_clips/jobs`                                                     |
| `DEFAULT_TARGET_FPS` | `15`                                                                                 |

Override any of them with same-named env vars.

Avatar Vault adds the following path and timeout settings. The defaults match
the AutoDL development host; override them when the LHM checkout or persistent
asset root lives elsewhere.

| Variable | Default / purpose |
|---|---|
| `LHM_PYTHON` | `/root/autodl-tmp/envs/lhm/bin/python` |
| `LHM_EXPORT_SCRIPT` | LHM photo-to-3DGS exporter |
| `LHM_MOTION_SCRIPT` | LHM `video2motion.py` entrypoint |
| `LHM_MOTION_MODEL_PATH` | LHM human-model assets |
| `LHM_WORKDIR` | `/root/autodl-tmp/LHM` |
| `AVATAR_REGISTRY_ROOT` | `<repo>/public/coach_clips` |
| `AVATAR_IDENTITIES_DIR` | `<registry>/avatar-identities` |
| `AVATAR_MOTIONS_DIR` | `<registry>/motions` |
| `AVATAR_BINDINGS_DIR` | `<registry>/avatar-bindings` |
| `AVATAR_PRIVATE_JOBS_DIR` | `~/.local/share/kinex/avatar-jobs`; uploaded source videos stay outside the static web root |
| `AVATAR_MAX_PHOTO_BYTES` | `10485760` |
| `AVATAR_EXPORT_TIMEOUT_SEC` | `1200` |
| `AVATAR_ALIGN_TIMEOUT_SEC` | `180` |
| `LHM_MOTION_TIMEOUT_SEC` | `1800` |
| `AVATAR_EXPORT_STUB` | set to `1` only for explicit smoke tests |
| `AVATAR_STUB_BIN` / `AVATAR_STUB_NPZ` | baked legacy bin and rig-debug pair used in stub mode |

Install the Python deps **once** inside the conda env that already has
`torch + cv2 + sam_3d_body`. On the dev host this is the `HabitatGs` env:

```bash
/mnt/data/home/zhangjinkai/conda_envs/HabitatGs/bin/pip install \
    --index-url https://pypi.tuna.tsinghua.edu.cn/simple \
    -r backend/requirements.txt
```

(`requirements.txt` only lists `fastapi / uvicorn[standard] / python-multipart`
— everything else is inherited from the conda env.)

## Launch

The SAM 3D Body source isn't pip-installable on this host; add it via
`PYTHONPATH` together with the repo root so `backend.app` is importable:

```bash
# from <repo>
DINOV3_REPO=/mnt/data/home/zhangjinkai/sam/output/dinov3 \
PYTHONPATH=/mnt/data/home/zhangjinkai/sam/output/sam-3d-body:$(pwd) \
/mnt/data/home/zhangjinkai/conda_envs/HabitatGs/bin/python -m uvicorn \
    backend.app:app --host 0.0.0.0 --port 8765
```

Cold start loads the SAM checkpoint (~15 s) and stays warm; subsequent
`POST /import/video` calls take ~30–60 s end-to-end (depending on frame count).

> **Port note:** `:8000` is occupied by another tenant on this host, so the
> default is `:8765`. If you change it, also forward the matching port and
> tell the frontend (see "Frontend wiring" below).

### Frontend wiring

The browser's `BACKEND_URL` defaults to `${page-origin-host}:8765`. To override
(for example when port-forwarding `18765:localhost:8765`), append a one-shot
query string — it's cached to `localStorage` afterward:

```
http://<frontend-host>:<frontend-port>/?backend=http://localhost:18765
```

Clear it via DevTools → Application → Local Storage → remove `kinex.backendUrl`.

CORS is permissive for any `http(s)://localhost(:port)` or `http(s)://127.0.0.1(:port)`.

## Endpoints

### `GET /healthz`

```json
{"ok": true, "device": "cuda", "loadedAt": 1779550294.7}
```

### `POST /import/video`

Multipart form:

| Field       | Required | Notes                                                                  |
|-------------|----------|------------------------------------------------------------------------|
| `file`      | yes      | The video upload                                                        |
| `motion`    | no       | One of `squat / hinge / flow / bounce / throw` (default `squat`)        |
| `targetFps` | no       | Override the ffmpeg extraction fps (default 15)                         |
| `name`      | no       | Display name for the seed; defaults to the upload filename stem        |
| `startSec` / `endSec` | no | Optional source-video slice in seconds                              |
| `avatarId`  | no       | Ready reusable identity; schedules a background identity×motion binding |

Synchronous response (200):

```json
{
  "jobId": "20260523-232442-5d9b21",
  "coachClipUrl": "public/coach_clips/jobs/20260523-232442-5d9b21/coach.json",
  "meshClipMetaUrl": "public/coach_clips/jobs/20260523-232442-5d9b21/mesh.meta.json",
  "framesDir": "public/coach_clips/jobs/20260523-232442-5d9b21/frames",
  "framePattern": "frame_{i:05}.jpg",
  "frameCount": 118,
  "thumbnailCount": 18,
  "durationSeconds": 7.87,
  "fps": 15,
  "name": "Basic_single_leg_squat",
  "motion": "squat",
  "elapsedSeconds": 33.1
}
```

Errors: `{"detail": {"error": "...", "stage": "extract|infer|pack|bake|coach"}}` with 4xx/5xx.

### Avatar Vault

Photo reconstruction now creates a reusable **identity**, not a seed-specific
combined asset. Records and binaries are filesystem-backed and survive process
restarts.

- `GET /avatars` — active identities, newest first.
- `POST /avatars` — multipart `photo` (required), `name`, and legacy
  `motionParams`; returns an identity record with HTTP 202. Poll `GET /avatars`
  until `status` is `ready` or `error`.
- `PATCH /avatars/{avatarId}` — JSON `{ "name": "..." }`.
- `DELETE /avatars/{avatarId}` — soft-deletes the identity, removes its private
  source photo, and cancels only queued/running bindings. Ready bindings and
  their immutable training assets remain playable.
- `POST /import/avatar` — compatibility alias for `POST /avatars`. It still
  accepts `seedId`, but deliberately ignores it and returns an identity record.

Example 202 response:

```json
{
  "avatarId": "av-0123...",
  "name": "Kai",
  "status": "queued",
  "progress": 0,
  "identityUrl": null,
  "previewUrl": null,
  "createdAt": 178...
}
```

The finished identity is `KINEXGI1`: static Gaussian attributes, the 55-joint
rest rig, and hierarchy. Motion is a separate `KINEXGM1` asset containing local
joint quaternions, root translations, and a stage-space similarity transform.
The browser combines one identity with one motion at runtime. Historical
`KINEXGS1` combined assets remain readable for built-in compatibility only.

Ready API records add `?v=<mtime_ns-size>` to local `identityUrl`,
`motionAssetUrl`, `previewUrl`, and legacy `avatarBinUrl` values. This version is
derived from the current file and changes when an asset is atomically replaced,
so a stable binding can publish a corrected rebake without serving stale browser
bytes. Registry manifests remain canonical and query-free; versioning is applied
only at the HTTP response boundary. Absolute external URLs are left unchanged.

### Avatar bindings

- `GET /avatar-bindings?avatarId=&motionId=` — list all bindings or filter by
  either stable id.
- `POST /avatar-bindings` — JSON accepts exactly one source:
  `{ "avatarId": "av-...", "motionId": "motion-..." }` reuses an existing
  motion, while `{ "avatarId": "av-...", "jobId": "2026..." }` creates the
  deterministic `motion-<jobId>` from a completed import's `segment.mp4` and
  starts LHM in the background. Repeated requests are idempotent and do not
  start a second worker for the same motion.

`POST /import/video` accepts an optional `avatarId`. The ordinary CoachClip and
MeshClip response is still produced synchronously first. When an identity was
selected, the same response also carries `motionId`, `bindingId`, and
`bindingStatus`; private source-video persistence and LHM motion preparation
continue in the background. Without `avatarId`, the legacy response shape is
unchanged; the browser can later use that response's `jobId` with
`POST /avatar-bindings`.

Registry layout:

```text
public/coach_clips/
  avatar-identities/<avatarId>/{record.json,identity.bin,preview.png}
  motions/<motionId>/{record.json,motion.bin}
  avatar-bindings/<bindingId>.json
~/.local/share/kinex/avatar-jobs/<jobId>/.avatar-source.<ext>
```

The private source-video root must never be placed under `public/`; the static
frontend server exposes everything below the repository root.

### `GET /import/jobs`

Lists persisted video-import jobs for ordinary CoachClip/MeshClip hydration.
Avatar Vault state comes from `/avatars` and `/avatar-bindings`; the legacy
`kind:"avatar"` job shape is compatibility data only.

## Legacy avatar migration

`scripts/migrate-legacy-avatar.py` splits the committed combined demo into one
reusable identity and motion. It validates the entire conversion in a temporary
directory on dry run, publishes manifests and binaries atomically, and never
modifies or deletes the source `KINEXGS1` file.

```bash
python3 scripts/migrate-legacy-avatar.py --dry-run
python3 scripts/migrate-legacy-avatar.py
```

Use `--debug-npz` when `joint_null` cannot be auto-discovered. Re-running the
same migration is idempotent; conflicting outputs require the explicit
`--replace` flag, while the legacy source remains protected.

## Quick smoke test

```bash
# from the same host that's running uvicorn
curl --noproxy '*' -F file=@/mnt/data/home/zhangjinkai/sam/Basic_single_leg_squat.webm \
     -F motion=squat \
     http://127.0.0.1:8765/import/video | jq

# then verify the artifacts are reachable via the static server
curl -s http://127.0.0.1:5173/public/coach_clips/jobs/<jobId>/mesh.meta.json
```

A successful run takes ~33 s on a single RTX-class GPU for a 118-frame clip.

On 2026-07-19 the remote acceptance run also verified the reusable path: a
stub photo identity reached `ready`; a 1.5 s / 8-frame video returned the
ordinary import response in 4.47 s with a queued binding; the real LHM motion
job then reached `ready`; HTTP assets began with `KINEXGI1` and `KINEXGM1`.
After soft-deleting that temporary identity, the ready binding and imported
training seed remained playable. The service was restored to normal CUDA mode
after the smoke test.
