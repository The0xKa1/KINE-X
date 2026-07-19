"""FastAPI service: video upload → SMPLX mesh + CoachClip + frame thumbs."""
from __future__ import annotations

import asyncio
import json
import logging
import shutil
import tempfile
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import avatar, config, pipeline
from .avatar_registry import AvatarRegistry

logger = logging.getLogger("kinex.backend")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

VALID_MOTIONS = {"squat", "hinge", "flow", "bounce", "throw"}
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
IMAGE_SUFFIXES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}

# Avatar job registry (jobId → record). Done/error records are also persisted
# as <AVATAR_JOBS_DIR>/<jobId>.json so they survive a restart.
_AVATAR_JOBS: dict[str, dict] = {}
# The LHM export peaks at ~19.6 GiB VRAM — serialize avatar jobs so two
# concurrent exports cannot OOM the GPU. Queued jobs stay status="queued".
_AVATAR_EXPORT_LOCK = threading.Lock()
_AVATAR_REGISTRY = AvatarRegistry(config.AVATAR_REGISTRY_ROOT)


class AvatarRenameRequest(BaseModel):
    name: str


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
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
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
        return JSONResponse({"jobs": jobs + _list_avatar_jobs()})

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
            "kind": "video",
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
    jobs.extend(_list_avatar_jobs())
    return JSONResponse({"jobs": jobs})


def _list_avatar_jobs() -> list[dict]:
    """Avatar job records: persisted metas on disk, overlaid with the live
    in-memory registry (which is fresher for queued/running jobs)."""
    records: dict[str, dict] = {}
    avatar_dir = config.AVATAR_JOBS_DIR
    if avatar_dir.is_dir():
        for meta_path in sorted(avatar_dir.glob("*.json")):
            try:
                with meta_path.open("r", encoding="utf-8") as fh:
                    meta = json.load(fh)
            except (OSError, json.JSONDecodeError):
                continue
            job_id = meta.get("jobId")
            if not job_id:
                continue
            # A "done" record without its bin is a partial — skip it.
            if meta.get("status") == "done" and not (avatar_dir / f"{job_id}.bin").exists():
                continue
            records[job_id] = meta
    records.update(_AVATAR_JOBS)
    return sorted(records.values(), key=lambda r: r.get("createdAt") or 0.0)


def _persist_avatar_meta(record: dict) -> None:
    """Best-effort write of <AVATAR_JOBS_DIR>/<jobId>.json for restart recovery."""
    try:
        config.AVATAR_JOBS_DIR.mkdir(parents=True, exist_ok=True)
        meta_path = config.AVATAR_JOBS_DIR / f"{record['jobId']}.json"
        with meta_path.open("w", encoding="utf-8") as fh:
            json.dump(record, fh, indent=2)
    except OSError:
        logger.warning("[%s] failed to persist avatar meta", record.get("jobId"))


def _find_identity(avatar_id: str) -> dict | None:
    return next(
        (
            record
            for record in _AVATAR_REGISTRY.list_identities(include_deleted=True)
            if record.get("avatarId") == avatar_id
        ),
        None,
    )


def _run_avatar_job(avatar_id: str, photo_path: Path, motion_params: str) -> None:
    """Worker-thread entry for serialized, identity-only LHM reconstruction."""
    with _AVATAR_EXPORT_LOCK:
        record = _find_identity(avatar_id)
        if record is None or record.get("deletedAt") is not None:
            return
        record = _AVATAR_REGISTRY.update_identity(
            avatar_id, status="running", startedAt=time.time()
        )

        def progress(stage: str, current: int, total: int, note: str) -> None:
            if total > 0:
                pct = max(0, min(100, round(current * 100 / total)))
                current_record = _find_identity(avatar_id)
                if current_record is not None and current_record.get("deletedAt") is None:
                    record["progress"] = max(int(current_record.get("progress") or 0), pct)
                    _AVATAR_REGISTRY.update_identity(avatar_id, progress=record["progress"])
            logger.info("[%s] %-7s %s%% %s", avatar_id, stage, record["progress"], note)

        try:
            result = avatar.run_avatar_pipeline(
                photo_path,
                avatar_id,
                name=record["name"],
                motion_params=motion_params,
                identity_dir=_AVATAR_REGISTRY.identities_dir / avatar_id,
                progress=progress,
            )
            current_record = _find_identity(avatar_id)
            if current_record is None or current_record.get("deletedAt") is not None:
                logger.info("[%s] identity deleted before publish; discarding completion", avatar_id)
                return
            _AVATAR_REGISTRY.update_identity(
                avatar_id,
                status="ready",
                progress=100,
                identityUrl=result["identityUrl"],
                previewUrl=result["previewUrl"],
                alignment=result.get("alignment"),
                error=None,
                finishedAt=time.time(),
            )
            logger.info("[%s] avatar identity ready: %s", avatar_id, result["identityUrl"])
        except Exception as exc:  # noqa: BLE001
            current_record = _find_identity(avatar_id)
            if current_record is not None and current_record.get("deletedAt") is None:
                _AVATAR_REGISTRY.update_identity(
                    avatar_id,
                    status="error",
                    error=str(exc) or repr(exc),
                    finishedAt=time.time(),
                )
            logger.exception("[%s] avatar identity pipeline failed", avatar_id)


async def _queue_avatar_identity(
    photo: UploadFile,
    name: str | None,
    motion_params: str | None,
) -> JSONResponse:
    content_type = (photo.content_type or "").lower()
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail={"error": f"unsupported photo type '{content_type or 'unknown'}'", "stage": "input"},
        )
    data = await photo.read(config.AVATAR_MAX_PHOTO_BYTES + 1)
    if not data:
        raise HTTPException(status_code=400, detail={"error": "empty upload", "stage": "input"})
    if len(data) > config.AVATAR_MAX_PHOTO_BYTES:
        while await photo.read(1 << 20):
            pass
        raise HTTPException(
            status_code=400,
            detail={"error": f"photo exceeds {config.AVATAR_MAX_PHOTO_BYTES // (1024 * 1024)}MB", "stage": "input"},
        )

    requested_name = (name or Path(photo.filename or "avatar").stem).strip()
    if not requested_name:
        requested_name = "Avatar"
    source_name = f"source-photo{IMAGE_SUFFIXES[content_type]}"
    record = _AVATAR_REGISTRY.create_identity(
        requested_name,
        identityUrl=None,
        previewUrl=None,
        sourcePhoto=source_name,
        error=None,
    )
    avatar_id = record["avatarId"]
    photo_path = _AVATAR_REGISTRY.identities_dir / avatar_id / source_name
    try:
        photo_path.write_bytes(data)
    except OSError as exc:
        _AVATAR_REGISTRY.update_identity(
            avatar_id, status="error", error=str(exc), finishedAt=time.time()
        )
        raise HTTPException(
            status_code=500, detail={"error": "failed to store photo", "stage": "input"}
        ) from exc

    logger.info(
        "[%s] queued avatar identity '%s' (%.1f KB) motionParams=%s stub=%s",
        avatar_id,
        record["name"],
        len(data) / 1024,
        motion_params or "test_video",
        config.avatar_export_stub(),
    )
    loop = asyncio.get_running_loop()
    loop.run_in_executor(
        None, _run_avatar_job, avatar_id, photo_path, motion_params or "test_video"
    )
    return JSONResponse(record, status_code=202)


@app.get("/avatars")
def list_avatars() -> list[dict]:
    return _AVATAR_REGISTRY.list_identities()


@app.post("/avatars", status_code=202)
async def create_avatar(
    photo: UploadFile = File(...),
    name: Optional[str] = Form(None),
    motionParams: Optional[str] = Form("test_video"),
):
    return await _queue_avatar_identity(photo, name, motionParams)


@app.post("/import/avatar", status_code=202)
async def import_avatar(
    photo: UploadFile = File(...),
    name: Optional[str] = Form(None),
    seedId: Optional[str] = Form("ugc-squat"),
    motionParams: Optional[str] = Form("test_video"),
):
    """Compatibility alias. ``seedId`` is accepted but deliberately ignored."""
    _ = seedId
    return await _queue_avatar_identity(photo, name, motionParams)


@app.patch("/avatars/{avatar_id}")
def rename_avatar(avatar_id: str, request: AvatarRenameRequest) -> dict:
    name = request.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail={"error": "name must not be empty"})
    try:
        return _AVATAR_REGISTRY.update_identity(avatar_id, name=name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail={"error": str(exc)}) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc


@app.delete("/avatars/{avatar_id}")
def delete_avatar(avatar_id: str) -> dict:
    try:
        record = _AVATAR_REGISTRY.soft_delete_identity(avatar_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail={"error": str(exc)}) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    source_name = record.get("sourcePhoto")
    if isinstance(source_name, str) and Path(source_name).name == source_name:
        (_AVATAR_REGISTRY.identities_dir / avatar_id / source_name).unlink(missing_ok=True)
    return record


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
            # Run the blocking GPU pipeline in a worker thread so the event
            # loop stays responsive (/healthz, /import/jobs, other requests).
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(
                None,
                lambda: pipeline.run_pipeline(
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
