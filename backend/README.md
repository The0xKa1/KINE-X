# HoloMotion Import Backend

FastAPI service that turns an uploaded short video into a HoloMotion seed
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

Clear it via DevTools → Application → Local Storage → remove `holomotion.backendUrl`.

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
