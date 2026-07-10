"""FastAPI service: video upload → SMPLX mesh + CoachClip + frame thumbs."""
from __future__ import annotations

import json
import logging
import shutil
import tempfile
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import config, pipeline

logger = logging.getLogger("kinex.backend")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

VALID_MOTIONS = {"squat", "hinge", "flow", "bounce", "throw"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Eagerly load the SAM model once so HTTP requests are fast."""
    logger.info("loading SAM 3D Body checkpoint from %s", config.SAM_CHECKPOINT)
    try:
        import torch  # noqa: F401  (imports torch for the side effect of CUDA init)
        from sam_3d_body import SAM3DBodyEstimator, load_sam_3d_body

        device = "cuda" if _cuda_available() else "cpu"
        model, model_cfg = load_sam_3d_body(
            str(config.SAM_CHECKPOINT),
            device=device,
            mhr_path=str(config.SAM_MHR_PATH),
        )
        estimator = SAM3DBodyEstimator(sam_3d_body_model=model, model_cfg=model_cfg)
        app.state.estimator = estimator
        app.state.estimator_device = device
        app.state.estimator_loaded_at = time.time()
        logger.info("SAM 3D Body ready on %s", device)
    except Exception:  # noqa: BLE001
        logger.exception("failed to load SAM 3D Body model — /import/video will return 503")
        app.state.estimator = None
        app.state.estimator_device = None
        app.state.estimator_loaded_at = None
    yield
    app.state.estimator = None


def _cuda_available() -> bool:
    try:
        import torch

        return bool(torch.cuda.is_available())
    except Exception:  # noqa: BLE001
        return False


app = FastAPI(title="KINE//X import service", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/healthz")
def healthz() -> dict:
    return {
        "ok": app.state.estimator is not None,
        "device": getattr(app.state, "estimator_device", None),
        "loadedAt": getattr(app.state, "estimator_loaded_at", None),
    }


@app.get("/import/jobs")
def list_import_jobs() -> JSONResponse:
    """List previously-completed import jobs so the frontend can re-hydrate
    its seed carousel after a refresh.

    A "complete" job is a directory under PUBLIC_JOBS_DIR that contains both
    `mesh.meta.json` and `coach.json`. Partial jobs (e.g. SAM inference
    crashed mid-run) are silently skipped.

    Response shape mirrors POST /import/video so the frontend can reuse the
    same loadCoachClip / loadMeshClip / addSeed path.
    """
    jobs: list[dict] = []
    jobs_root = config.PUBLIC_JOBS_DIR
    if not jobs_root.exists():
        return JSONResponse({"jobs": jobs})

    for job_dir in sorted(jobs_root.iterdir()):
        if not job_dir.is_dir():
            continue
        mesh_meta = job_dir / "mesh.meta.json"
        coach_json = job_dir / "coach.json"
        if not (mesh_meta.exists() and coach_json.exists()):
            continue
        try:
            with mesh_meta.open("r", encoding="utf-8") as fh:
                meta = json.load(fh)
        except (OSError, json.JSONDecodeError):
            continue
        frames_dir = job_dir / "frames"
        frame_count = int(meta.get("frameCount") or 0)
        if frame_count <= 0 and frames_dir.is_dir():
            frame_count = sum(1 for _ in frames_dir.glob("frame_*.jpg"))
        if frame_count <= 0:
            continue
        jobs.append({
            "jobId": job_dir.name,
            "coachClipUrl": config.relative_to_repo(coach_json),
            "meshClipMetaUrl": config.relative_to_repo(mesh_meta),
            "framesDir": config.relative_to_repo(frames_dir),
            "framePattern": "frame_{i:05}.jpg",
            "frameCount": frame_count,
            "thumbnailCount": min(config.DEFAULT_THUMBNAIL_COUNT, frame_count),
            "durationSeconds": float(meta.get("durationSeconds") or 0.0),
            "fps": int(meta.get("fps") or config.DEFAULT_TARGET_FPS),
            "name": str(meta.get("name") or job_dir.name),
            "motion": str(meta.get("motion") or "squat"),
        })
    return JSONResponse({"jobs": jobs})


@app.post("/import/video")
async def import_video(
    file: UploadFile = File(...),
    motion: Optional[str] = Form("squat"),
    targetFps: Optional[int] = Form(None),
    name: Optional[str] = Form(None),
    startSec: Optional[float] = Form(None),
    endSec: Optional[float] = Form(None),
):
    if app.state.estimator is None:
        raise HTTPException(status_code=503, detail={"error": "SAM model unavailable", "stage": "startup"})
    if motion and motion not in VALID_MOTIONS:
        raise HTTPException(status_code=400, detail={"error": f"unsupported motion '{motion}'", "stage": "input"})
    if startSec is not None and startSec < 0:
        raise HTTPException(status_code=400, detail={"error": "startSec must be >= 0", "stage": "input"})
    if startSec is not None and endSec is not None and endSec <= startSec:
        raise HTTPException(status_code=400, detail={"error": "endSec must be > startSec", "stage": "input"})

    job_id = f"{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
    suffix = Path(file.filename or "upload.mp4").suffix or ".mp4"

    with tempfile.TemporaryDirectory(prefix="kinex-upload-") as tmpdir:
        upload_path = Path(tmpdir) / f"input{suffix}"
        with upload_path.open("wb") as fh:
            shutil.copyfileobj(file.file, fh)
        if upload_path.stat().st_size == 0:
            raise HTTPException(status_code=400, detail={"error": "empty upload", "stage": "input"})

        range_note = ""
        if startSec is not None or endSec is not None:
            range_note = f" slice=[{startSec},{endSec}]"
        logger.info("[%s] received %s (%.1f KB) motion=%s%s",
                    job_id, file.filename, upload_path.stat().st_size / 1024, motion, range_note)
        t0 = time.time()
        try:
            result = pipeline.run_pipeline(
                video_path=upload_path,
                job_id=job_id,
                estimator=app.state.estimator,
                motion=motion or "squat",
                target_fps=targetFps,
                name=name or Path(file.filename or "imported").stem,
                start_sec=startSec,
                end_sec=endSec,
                progress=lambda stage, cur, total, note: logger.info(
                    "[%s] %-7s %d/%d %s", job_id, stage, cur, total, note
                ),
            )
        except FileNotFoundError as exc:
            pipeline.cleanup_job(job_id)
            raise HTTPException(status_code=500, detail={"error": str(exc), "stage": "assets"}) from exc
        except Exception as exc:  # noqa: BLE001
            pipeline.cleanup_job(job_id)
            logger.exception("[%s] pipeline failed", job_id)
            stage = guess_failure_stage(exc)
            raise HTTPException(status_code=500, detail={"error": str(exc), "stage": stage}) from exc

    elapsed = time.time() - t0
    logger.info("[%s] done in %.1fs", job_id, elapsed)
    result["elapsedSeconds"] = round(elapsed, 2)
    return JSONResponse(result)


def guess_failure_stage(exc: Exception) -> str:
    text = str(exc).lower()
    if "ffmpeg" in text or "no frames" in text:
        return "extract"
    if "sam" in text or "estimator" in text:
        return "infer"
    if "pack" in text or "smpl_data" in text:
        return "pack"
    if "mhr" in text or "smplx" in text or "mesh" in text:
        return "bake"
    if "keypoints" in text or "coach" in text:
        return "coach"
    return "pipeline"
