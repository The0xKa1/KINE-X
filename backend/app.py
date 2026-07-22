"""FastAPI service: video upload → SMPLX mesh + CoachClip + frame thumbs."""
from __future__ import annotations

import asyncio
import hashlib
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
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import avatar, avatar_motion, avatar_video, config, pipeline
from .avatar_registry import AvatarRegistry

logger = logging.getLogger("kinex.backend")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

VALID_MOTIONS = {"squat", "hinge", "flow", "bounce", "throw"}
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
IMAGE_SUFFIXES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
_ACTIVE_IDENTITY_STATUSES = {"queued", "running"}
_IDENTITY_RECOVERY_ERROR = (
    "Avatar import could not resume after restart because its source photo or "
    "motion settings are missing. Delete this identity and upload a replacement photo."
)

# Avatar job registry (jobId → record). Done/error records are also persisted
# as <AVATAR_JOBS_DIR>/<jobId>.json so they survive a restart.
_AVATAR_JOBS: dict[str, dict] = {}
# The LHM export peaks at ~19.6 GiB VRAM — serialize avatar jobs so two
# concurrent exports cannot OOM the GPU. Queued jobs stay status="queued".
_AVATAR_EXPORT_LOCK = threading.Lock()
_SCHEDULED_AVATAR_IDENTITIES: set[str] = set()
_SCHEDULED_AVATAR_IDENTITIES_LOCK = threading.Lock()
_SCHEDULED_AVATAR_MOTIONS: set[str] = set()
_SCHEDULED_AVATAR_MOTIONS_LOCK = threading.Lock()
_AVATAR_VIDEO_EXPORT_LOCK = threading.Lock()
_SCHEDULED_AVATAR_VIDEO_EXPORTS: set[str] = set()
_SCHEDULED_AVATAR_VIDEO_EXPORTS_LOCK = threading.Lock()
_AVATAR_REGISTRY = AvatarRegistry(config.AVATAR_REGISTRY_ROOT)
_VERSIONED_ASSET_FIELDS = (
    "identityUrl",
    "motionAssetUrl",
    "previewUrl",
    "avatarBinUrl",
    "videoUrl",
)


class AvatarRenameRequest(BaseModel):
    name: str


class AvatarBindingRequest(BaseModel):
    avatarId: str
    motionId: Optional[str] = None
    jobId: Optional[str] = None


class AvatarVideoExportRequest(BaseModel):
    avatarId: str
    motionId: str
    width: int = 1920
    height: int = 1080
    background: str = "#0e0f13"


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
    loop = asyncio.get_running_loop()
    recovered = _recover_motion_bindings(
        lambda function, *args: loop.run_in_executor(None, function, *args)
    )
    if recovered:
        logger.info("recovered %d unfinished avatar motion job(s)", recovered)
    recovered_identities = _recover_avatar_identities(
        lambda function, *args: loop.run_in_executor(None, function, *args)
    )
    if recovered_identities:
        logger.info("recovered %d unfinished avatar identity job(s)", recovered_identities)
    recovered_video_exports = _recover_avatar_video_exports(
        lambda function, *args: loop.run_in_executor(None, function, *args)
    )
    if recovered_video_exports:
        logger.info("recovered %d unfinished avatar video export(s)", recovered_video_exports)
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
        record = {
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
        }
        # Optional public source-video segment: jobs gain the field simply by
        # having a segment.mp4 on disk (no migration for older jobs).
        segment_mp4 = job_dir / "segment.mp4"
        if segment_mp4.exists():
            record["sourceVideoUrl"] = config.relative_to_repo(segment_mp4)
        jobs.append(record)
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
    public_records = [_with_asset_versions(record) for record in records.values()]
    return sorted(public_records, key=lambda r: r.get("createdAt") or 0.0)


def _with_asset_versions(record: dict) -> dict:
    """Return a public record whose replaceable assets carry cache versions.

    Manifests keep stable query-free paths. At the HTTP boundary we derive a
    version from the current file stat, so historical records need no migration
    and an atomic rebake immediately changes both the browser URL and the
    frontend's in-memory avatar cache key.
    """
    public = dict(record)
    for field in _VERSIONED_ASSET_FIELDS:
        value = public.get(field)
        if isinstance(value, str):
            public[field] = _version_asset_url(value)
    return public


def _version_asset_url(url: str) -> str:
    parsed = urlsplit(url)
    if parsed.scheme or parsed.netloc or not parsed.path or parsed.path.startswith("/"):
        return url
    relative = Path(parsed.path)
    if any(part in {"", ".", ".."} for part in relative.parts):
        return url
    candidates = (
        (config.REPO_ROOT, config.REPO_ROOT / relative),
        (_AVATAR_REGISTRY.root, _AVATAR_REGISTRY.root / relative),
    )
    asset_path: Path | None = None
    for root, candidate in candidates:
        try:
            resolved = candidate.resolve()
            resolved.relative_to(root.resolve())
        except (OSError, ValueError):
            continue
        if resolved.is_file():
            asset_path = resolved
            break
    if asset_path is None:
        return url
    try:
        stat = asset_path.stat()
    except OSError:
        return url
    version = f"{stat.st_mtime_ns:x}-{stat.st_size:x}"
    query = [(key, value) for key, value in parse_qsl(parsed.query, keep_blank_values=True) if key != "v"]
    query.append(("v", version))
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), parsed.fragment))


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


def _require_active_identity(avatar_id: str) -> dict:
    try:
        record = _find_identity(avatar_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
    if record is None:
        raise HTTPException(
            status_code=404, detail={"error": f"identity '{avatar_id}' does not exist"}
        )
    if record.get("deletedAt") is not None:
        raise HTTPException(
            status_code=409, detail={"error": f"identity '{avatar_id}' is deleted"}
        )
    return record


def _motion_record(motion_id: str) -> dict:
    path = _AVATAR_REGISTRY._motion_path(motion_id)
    try:
        with path.open("r", encoding="utf-8") as handle:
            record = json.load(handle)
    except FileNotFoundError as exc:
        raise KeyError(f"motion '{motion_id}' does not exist") from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"motion '{motion_id}' has an invalid manifest") from exc
    if not isinstance(record, dict):
        raise ValueError(f"motion '{motion_id}' has an invalid manifest")
    return record


def _asset_url(path: Path) -> str:
    try:
        return config.relative_to_repo(path)
    except ValueError:
        # Tests and explicit out-of-repo registry overrides still get a stable,
        # non-source URL rooted at the configured Avatar Vault directory.
        return path.resolve().relative_to(_AVATAR_REGISTRY.root.resolve()).as_posix()


def _completed_video_job(job_id: str) -> tuple[Path, dict]:
    """Resolve a completed imported-video job without allowing path escape."""
    if not job_id or pipeline.safe_name(job_id) != job_id:
        raise ValueError("jobId contains unsafe characters")
    jobs_root = config.PUBLIC_JOBS_DIR.resolve()
    job_dir = (jobs_root / job_id).resolve()
    try:
        job_dir.relative_to(jobs_root)
    except ValueError as exc:
        raise ValueError("jobId escapes the jobs directory") from exc

    mesh_meta = job_dir / "mesh.meta.json"
    coach_clip = job_dir / "coach.json"
    segment_video = job_dir / "segment.mp4"
    if not job_dir.is_dir() or not mesh_meta.is_file() or not coach_clip.is_file():
        raise FileNotFoundError(f"completed video job '{job_id}' does not exist")
    if not segment_video.is_file():
        raise FileNotFoundError(
            f"video job '{job_id}' has no source segment and cannot build an avatar motion"
        )
    try:
        with mesh_meta.open("r", encoding="utf-8") as handle:
            metadata = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"video job '{job_id}' has invalid metadata") from exc
    if not isinstance(metadata, dict):
        raise ValueError(f"video job '{job_id}' has invalid metadata")
    return job_dir, metadata


def _motion_fields_for_job(job_id: str, job_dir: Path, metadata: dict) -> dict:
    def public_url(path: Path) -> str:
        try:
            return config.relative_to_repo(path)
        except ValueError:
            return path.as_posix()

    return {
        "jobId": job_id,
        "name": str(metadata.get("name") or job_id),
        "coachClipUrl": public_url(job_dir / "coach.json"),
        "meshClipMetaUrl": public_url(job_dir / "mesh.meta.json"),
        "sourceVideoUrl": public_url(job_dir / "segment.mp4"),
        "durationSeconds": float(metadata.get("durationSeconds") or 0.0),
        "fps": float(metadata.get("fps") or config.DEFAULT_TARGET_FPS),
    }


def _sync_binding_status(binding: dict) -> dict:
    motion = _motion_record(binding["motionId"])
    if binding.get("status") in {"ready", "error", "cancelled"}:
        return binding
    if motion.get("status") == "ready":
        identity = _require_active_identity(binding["avatarId"])
        return _AVATAR_REGISTRY.update_binding(
            binding["bindingId"],
            status="ready",
            progress=100,
            identityUrl=identity.get("identityUrl") or identity.get("avatarBinUrl"),
            motionAssetUrl=motion.get("motionAssetUrl") or motion.get("motionUrl"),
            error=None,
        )
    if motion.get("status") == "error":
        return _AVATAR_REGISTRY.update_binding(
            binding["bindingId"],
            status="error",
            error=motion.get("error") or "motion preparation failed",
        )
    return binding


def _run_motion_binding_job(
    avatar_id: str,
    motion_id: str,
    binding_id: str,
    source_video: Path,
    coach_clip: Path,
    motion_path: Path,
    fps: float,
) -> None:
    """Background LHM worker; ordinary SAM import has already completed."""
    def progress(current: int, total: int, note: str) -> None:
        pct = max(0, min(99, round(current * 100 / total))) if total else 0
        _AVATAR_REGISTRY.upsert_motion(motion_id, progress=pct, progressNote=note)
        _AVATAR_REGISTRY.update_binding(binding_id, progress=pct, progressNote=note)
        logger.info("[%s] motion %d%% %s", motion_id, pct, note)

    try:
        started_at = time.time()
        _AVATAR_REGISTRY.upsert_motion(
            motion_id, status="running", progress=0, startedAt=started_at, error=None
        )
        _AVATAR_REGISTRY.update_binding(
            binding_id, status="running", progress=0, startedAt=started_at, error=None
        )
        metadata = avatar_motion.prepare_motion_asset(
            source_video,
            coach_clip,
            motion_path,
            fps=fps,
            progress=progress,
        )
        if not motion_path.is_file():
            raise RuntimeError("motion pack returned without publishing motion.bin")
        motion_url = _asset_url(motion_path)
        finished_at = time.time()
        _AVATAR_REGISTRY.upsert_motion(
            motion_id,
            status="ready",
            progress=100,
            motionAssetUrl=motion_url,
            frameCount=metadata.get("frames"),
            fps=metadata.get("fps"),
            stageTransform=metadata.get("stageTransform"),
            error=None,
            finishedAt=finished_at,
        )
        identity = _find_identity(avatar_id)
        _AVATAR_REGISTRY.update_binding(
            binding_id,
            status="ready",
            progress=100,
            identityUrl=(identity or {}).get("identityUrl")
            or (identity or {}).get("avatarBinUrl"),
            motionAssetUrl=motion_url,
            error=None,
            finishedAt=finished_at,
        )
        logger.info("[%s] reusable motion ready: %s", motion_id, motion_url)
    except Exception as exc:  # noqa: BLE001
        finished_at = time.time()
        message = str(exc) or repr(exc)
        _AVATAR_REGISTRY.upsert_motion(
            motion_id,
            status="error",
            error=message,
            finishedAt=finished_at,
        )
        _AVATAR_REGISTRY.update_binding(
            binding_id,
            status="error",
            error=message,
            finishedAt=finished_at,
        )
        logger.exception("[%s] avatar motion preparation failed", motion_id)
    finally:
        _remove_private_source(Path(source_video))


def _submit_motion_job(
    submit,
    avatar_id: str,
    motion_id: str,
    binding_id: str,
    source_video: Path,
    coach_clip: Path,
    motion_path: Path,
    fps: float,
) -> bool:
    """Submit at most one in-process worker for a reusable motion."""
    with _SCHEDULED_AVATAR_MOTIONS_LOCK:
        if motion_id in _SCHEDULED_AVATAR_MOTIONS:
            return False
        _SCHEDULED_AVATAR_MOTIONS.add(motion_id)

    # A previous worker can publish ready between the caller's manifest read
    # and this claim. Do not launch a redundant extraction from that stale
    # snapshot; the queued binding will be promoted by _sync_binding_status.
    try:
        if _motion_record(motion_id).get("status") == "ready":
            _remove_private_source(source_video)
            with _SCHEDULED_AVATAR_MOTIONS_LOCK:
                _SCHEDULED_AVATAR_MOTIONS.discard(motion_id)
            return False
    except (KeyError, ValueError):
        pass

    def run() -> None:
        try:
            _run_motion_binding_job(
                avatar_id,
                motion_id,
                binding_id,
                source_video,
                coach_clip,
                motion_path,
                fps,
            )
        finally:
            with _SCHEDULED_AVATAR_MOTIONS_LOCK:
                _SCHEDULED_AVATAR_MOTIONS.discard(motion_id)

    try:
        submit(run)
    except Exception:
        with _SCHEDULED_AVATAR_MOTIONS_LOCK:
            _SCHEDULED_AVATAR_MOTIONS.discard(motion_id)
        raise
    return True


def _remove_private_source(source_path: Path | None) -> None:
    if source_path is None:
        return
    source_path = Path(source_path)
    # Only ever delete inside the private jobs root. Callers that reuse the
    # binding worker with a public asset (e.g. a job's segment.mp4) must not
    # lose that asset to cleanup.
    try:
        source_path.resolve().relative_to(config.AVATAR_PRIVATE_JOBS_DIR.resolve())
    except (OSError, ValueError):
        logger.warning("skip source cleanup outside private root: %s", source_path)
        return
    source_path.unlink(missing_ok=True)
    try:
        source_path.parent.rmdir()
    except OSError:
        pass


def _remove_private_job(job_id: str | None, source_path: Path | None) -> None:
    _remove_private_source(source_path)
    if not isinstance(job_id, str) or pipeline.safe_name(job_id) != job_id:
        return
    job_dir = (config.AVATAR_PRIVATE_JOBS_DIR / job_id).resolve()
    try:
        job_dir.relative_to(config.AVATAR_PRIVATE_JOBS_DIR.resolve())
        job_dir.rmdir()
    except (OSError, ValueError):
        pass


def _recover_motion_bindings(submit) -> int:
    """Resume durable queued/running motion jobs after a process restart."""
    recovered = 0
    scheduled_motions: set[str] = set()
    bindings = sorted(
        _AVATAR_REGISTRY.list_bindings(),
        key=lambda record: float(record.get("createdAt") or 0),
    )
    for binding in bindings:
        if binding.get("status") not in {"queued", "running"}:
            continue
        motion_id = binding.get("motionId")
        if not isinstance(motion_id, str) or motion_id in scheduled_motions:
            continue
        try:
            motion = _motion_record(motion_id)
        except (KeyError, ValueError):
            continue
        motion_status = motion.get("status")
        job_id = motion.get("jobId")
        source_video = (
            pipeline.find_persisted_source(job_id)
            if isinstance(job_id, str)
            else None
        )
        if motion_status in {"ready", "error"}:
            _sync_binding_status(binding)
            _remove_private_job(job_id, source_video)
            recovered += 1
            continue
        if motion_status not in {"queued", "running"}:
            continue
        if source_video is None:
            message = "private source video missing during startup recovery"
            _AVATAR_REGISTRY.upsert_motion(
                motion_id, status="error", error=message, finishedAt=time.time()
            )
            _AVATAR_REGISTRY.update_binding(
                binding["bindingId"], status="error", error=message
            )
            continue
        coach_clip = config.PUBLIC_JOBS_DIR / job_id / "coach.json"
        motion_path = _AVATAR_REGISTRY.motions_dir / motion_id / "motion.bin"
        submitted = _submit_motion_job(
            submit,
            binding["avatarId"],
            motion_id,
            binding["bindingId"],
            source_video,
            coach_clip,
            motion_path,
            float(motion.get("fps") or config.DEFAULT_TARGET_FPS),
        )
        scheduled_motions.add(motion_id)
        if submitted:
            recovered += 1
    return recovered


def _ready_avatar_video_assets(avatar_id: str, motion_id: str) -> tuple[dict, dict, Path, Path]:
    identity = _require_active_identity(avatar_id)
    if identity.get("status") != "ready":
        raise ValueError(f"identity '{avatar_id}' is not ready")
    motion = _motion_record(motion_id)
    if motion.get("status") != "ready":
        raise ValueError(f"motion '{motion_id}' is not ready")
    identity_path = _AVATAR_REGISTRY.identities_dir / avatar_id / "identity.bin"
    motion_path = _AVATAR_REGISTRY.motions_dir / motion_id / "motion.bin"
    if not identity_path.is_file():
        raise FileNotFoundError(f"identity '{avatar_id}' has no identity.bin")
    if not motion_path.is_file():
        raise FileNotFoundError(f"motion '{motion_id}' has no motion.bin")
    return identity, motion, identity_path, motion_path


def _avatar_video_request_key(
    avatar_id: str,
    motion_id: str,
    identity_path: Path,
    motion_path: Path,
    *,
    width: int,
    height: int,
    background: str,
) -> tuple[str, str]:
    identity_stat = identity_path.stat()
    motion_stat = motion_path.stat()
    source_signature = hashlib.sha256(
        (
            f"{identity_stat.st_mtime_ns}:{identity_stat.st_size}:"
            f"{motion_stat.st_mtime_ns}:{motion_stat.st_size}"
        ).encode("ascii")
    ).hexdigest()
    request_payload = json.dumps(
        {
            "avatarId": avatar_id,
            "motionId": motion_id,
            "sourceSignature": source_signature,
            "width": width,
            "height": height,
            "background": background.lower(),
            "renderer": "ewa-gl-v1",
        },
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(request_payload.encode("utf-8")).hexdigest(), source_signature


def _run_avatar_video_export(
    export_id: str,
    identity_path: Path,
    motion_path: Path,
    output_path: Path,
) -> None:
    record = _AVATAR_REGISTRY.update_video_export(
        export_id,
        expected_statuses={"queued"},
        status="running",
        progress=0,
        progressNote="waiting for GPU renderer",
        startedAt=time.time(),
        error=None,
    )
    if record.get("status") != "running":
        return

    last_percent = -1

    def progress(current: int, total: int, note: str) -> None:
        nonlocal last_percent
        percent = max(0, min(99, round(current * 100 / total))) if total else 0
        if percent < last_percent + 2 and percent != 99:
            return
        last_percent = percent
        _AVATAR_REGISTRY.update_video_export(
            export_id,
            expected_statuses={"running"},
            progress=percent,
            progressNote=note,
        )

    try:
        with _AVATAR_VIDEO_EXPORT_LOCK:
            current = _AVATAR_REGISTRY.get_video_export(export_id)
            if current.get("status") != "running":
                return
            metadata = avatar_video.render_avatar_video(
                identity_path,
                motion_path,
                output_path,
                width=int(current["width"]),
                height=int(current["height"]),
                background=str(current["background"]),
                max_frames=config.AVATAR_VIDEO_MAX_FRAMES,
                progress=progress,
            )
        finished_at = time.time()
        published = _AVATAR_REGISTRY.update_video_export(
            export_id,
            expected_statuses={"running"},
            status="ready",
            progress=100,
            progressNote="ready",
            videoUrl=_asset_url(output_path),
            error=None,
            finishedAt=finished_at,
            **metadata,
        )
        if published.get("status") != "ready":
            output_path.unlink(missing_ok=True)
            return
        logger.info("[%s] avatar video ready: %s", export_id, published["videoUrl"])
    except Exception as exc:  # noqa: BLE001
        output_path.unlink(missing_ok=True)
        message = str(exc) or repr(exc)
        _AVATAR_REGISTRY.update_video_export(
            export_id,
            expected_statuses={"queued", "running"},
            status="error",
            error=message,
            progressNote="render failed",
            finishedAt=time.time(),
        )
        logger.exception("[%s] avatar video export failed", export_id)


def _submit_avatar_video_export(
    submit,
    export_id: str,
    identity_path: Path,
    motion_path: Path,
    output_path: Path,
) -> bool:
    with _SCHEDULED_AVATAR_VIDEO_EXPORTS_LOCK:
        if export_id in _SCHEDULED_AVATAR_VIDEO_EXPORTS:
            return False
        _SCHEDULED_AVATAR_VIDEO_EXPORTS.add(export_id)

    def run() -> None:
        try:
            _run_avatar_video_export(export_id, identity_path, motion_path, output_path)
        finally:
            with _SCHEDULED_AVATAR_VIDEO_EXPORTS_LOCK:
                _SCHEDULED_AVATAR_VIDEO_EXPORTS.discard(export_id)

    try:
        submit(run)
    except Exception:
        with _SCHEDULED_AVATAR_VIDEO_EXPORTS_LOCK:
            _SCHEDULED_AVATAR_VIDEO_EXPORTS.discard(export_id)
        raise
    return True


def _recover_avatar_video_exports(submit) -> int:
    recovered = 0
    for record in _AVATAR_REGISTRY.list_video_exports():
        if record.get("status") not in {"queued", "running"}:
            continue
        export_id = record.get("exportId")
        avatar_id = record.get("avatarId")
        motion_id = record.get("motionId")
        if not all(isinstance(value, str) for value in (export_id, avatar_id, motion_id)):
            continue
        try:
            _, _, identity_path, motion_path = _ready_avatar_video_assets(avatar_id, motion_id)
            _AVATAR_REGISTRY.update_video_export(
                export_id,
                status="queued",
                progress=0,
                progressNote="recovered after restart",
                error=None,
                finishedAt=None,
            )
            output_path = _AVATAR_REGISTRY._video_export_path(export_id).parent / "avatar.mp4"
            if _submit_avatar_video_export(
                submit, export_id, identity_path, motion_path, output_path
            ):
                recovered += 1
        except Exception as exc:  # noqa: BLE001
            _AVATAR_REGISTRY.update_video_export(
                export_id,
                status="error",
                error=str(exc) or repr(exc),
                finishedAt=time.time(),
            )
    return recovered


def _resolve_identity_source(record: dict) -> Path | None:
    """Resolve a persisted source photo without allowing escape from its identity."""
    avatar_id = record.get("avatarId")
    source_name = record.get("sourcePhoto")
    if not isinstance(avatar_id, str) or not isinstance(source_name, str) or not source_name:
        return None
    try:
        identity_dir = _AVATAR_REGISTRY._identity_path(avatar_id).parent.resolve()
        source_path = (identity_dir / source_name).resolve()
        source_path.relative_to(identity_dir)
    except (OSError, ValueError):
        return None
    return source_path if source_path.is_file() else None


def _fail_identity_recovery(avatar_id: str) -> None:
    _AVATAR_REGISTRY.update_identity_if_active(
        avatar_id,
        expected_statuses=_ACTIVE_IDENTITY_STATUSES,
        status="error",
        error=_IDENTITY_RECOVERY_ERROR,
        finishedAt=time.time(),
    )


def _submit_avatar_job(submit, avatar_id: str, photo_path: Path, motion_params: str) -> bool:
    """Submit at most one in-process future for an identity."""
    with _SCHEDULED_AVATAR_IDENTITIES_LOCK:
        if avatar_id in _SCHEDULED_AVATAR_IDENTITIES:
            return False
        _SCHEDULED_AVATAR_IDENTITIES.add(avatar_id)
    try:
        submit(_run_avatar_job, avatar_id, photo_path, motion_params)
    except Exception:
        with _SCHEDULED_AVATAR_IDENTITIES_LOCK:
            _SCHEDULED_AVATAR_IDENTITIES.discard(avatar_id)
        raise
    return True


def _recover_avatar_identities(submit) -> int:
    """Resume durable queued/running identity jobs after a process restart."""
    recovered = 0
    identities = sorted(
        _AVATAR_REGISTRY.list_identities(include_deleted=True),
        key=lambda record: float(record.get("createdAt") or 0),
    )
    for identity in identities:
        if identity.get("deletedAt") is not None:
            continue
        if identity.get("status") not in _ACTIVE_IDENTITY_STATUSES:
            continue
        avatar_id = identity.get("avatarId")
        motion_params = identity.get("motionParams")
        source_path = _resolve_identity_source(identity)
        if (
            not isinstance(avatar_id, str)
            or not isinstance(motion_params, str)
            or not motion_params.strip()
            or source_path is None
        ):
            if isinstance(avatar_id, str):
                _fail_identity_recovery(avatar_id)
            continue
        try:
            avatar.motion_params_dir(motion_params)
        except (FileNotFoundError, ValueError):
            _fail_identity_recovery(avatar_id)
            continue
        claimed = _AVATAR_REGISTRY.update_identity_if_active(
            avatar_id,
            expected_statuses=_ACTIVE_IDENTITY_STATUSES,
            status="running",
            startedAt=time.time(),
            error=None,
        )
        if claimed is None:
            continue
        try:
            scheduled = _submit_avatar_job(
                submit, avatar_id, source_path, motion_params
            )
        except Exception:  # noqa: BLE001
            _fail_identity_recovery(avatar_id)
            logger.exception("[%s] failed to resubmit avatar identity", avatar_id)
            continue
        if not scheduled:
            continue
        recovered += 1
    return recovered


def _run_avatar_job(avatar_id: str, photo_path: Path, motion_params: str) -> None:
    """Worker-thread entry for serialized, identity-only LHM reconstruction."""
    with _AVATAR_EXPORT_LOCK:
        record = _AVATAR_REGISTRY.update_identity_if_active(
            avatar_id,
            expected_statuses=_ACTIVE_IDENTITY_STATUSES,
            status="running",
            startedAt=time.time(),
        )
        if record is None:
            with _SCHEDULED_AVATAR_IDENTITIES_LOCK:
                _SCHEDULED_AVATAR_IDENTITIES.discard(avatar_id)
            return

        def progress(stage: str, current: int, total: int, note: str) -> None:
            if total > 0:
                pct = max(0, min(100, round(current * 100 / total)))
                record["progress"] = max(int(record.get("progress") or 0), pct)
                _AVATAR_REGISTRY.update_identity_if_active(
                    avatar_id,
                    expected_statuses=_ACTIVE_IDENTITY_STATUSES,
                    progress=record["progress"],
                )
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
            published = _AVATAR_REGISTRY.update_identity_if_active(
                avatar_id,
                expected_statuses=_ACTIVE_IDENTITY_STATUSES,
                status="ready",
                progress=100,
                identityUrl=result["identityUrl"],
                previewUrl=result["previewUrl"],
                alignment=result.get("alignment"),
                error=None,
                finishedAt=time.time(),
            )
            if published is None:
                logger.info("[%s] identity deleted before publish; discarding completion", avatar_id)
                return
            logger.info("[%s] avatar identity ready: %s", avatar_id, result["identityUrl"])
        except Exception as exc:  # noqa: BLE001
            _AVATAR_REGISTRY.update_identity_if_active(
                avatar_id,
                expected_statuses=_ACTIVE_IDENTITY_STATUSES,
                status="error",
                error=str(exc) or repr(exc),
                finishedAt=time.time(),
            )
            logger.exception("[%s] avatar identity pipeline failed", avatar_id)
        finally:
            with _SCHEDULED_AVATAR_IDENTITIES_LOCK:
                _SCHEDULED_AVATAR_IDENTITIES.discard(avatar_id)


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

    resolved_motion_params = motion_params or "test_video"
    try:
        avatar.motion_params_dir(resolved_motion_params)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=400, detail={"error": str(exc), "stage": "input"}
        ) from exc

    requested_name = (name or Path(photo.filename or "avatar").stem).strip()
    if not requested_name:
        requested_name = "Avatar"
    source_name = f"source-photo{IMAGE_SUFFIXES[content_type]}"
    record = _AVATAR_REGISTRY.create_identity(
        requested_name,
        identityUrl=None,
        previewUrl=None,
        sourcePhoto=source_name,
        motionParams=resolved_motion_params,
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
        resolved_motion_params,
        config.avatar_export_stub(),
    )
    loop = asyncio.get_running_loop()
    _submit_avatar_job(
        lambda function, *args: loop.run_in_executor(None, function, *args),
        avatar_id,
        photo_path,
        resolved_motion_params,
    )
    return JSONResponse(record, status_code=202)


@app.get("/avatars")
def list_avatars() -> list[dict]:
    return [_with_asset_versions(record) for record in _AVATAR_REGISTRY.list_identities()]


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
        return _with_asset_versions(_AVATAR_REGISTRY.update_identity(avatar_id, name=name))
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


@app.get("/avatar-bindings")
def list_avatar_bindings(
    avatarId: Optional[str] = None,
    motionId: Optional[str] = None,
) -> list[dict]:
    try:
        records = _AVATAR_REGISTRY.list_bindings(
            avatar_id=avatarId, motion_id=motionId
        )
        return [_with_asset_versions(_sync_binding_status(record)) for record in records]
    except KeyError as exc:
        raise HTTPException(status_code=404, detail={"error": str(exc)}) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc


@app.post("/avatar-bindings")
async def create_avatar_binding(request: AvatarBindingRequest) -> dict:
    _require_active_identity(request.avatarId)
    motion_id = request.motionId.strip() if request.motionId else None
    job_id = request.jobId.strip() if request.jobId else None
    if bool(motion_id) == bool(job_id):
        raise HTTPException(
            status_code=400,
            detail={"error": "provide exactly one of motionId or jobId"},
        )
    try:
        if motion_id:
            binding = _AVATAR_REGISTRY.create_binding(request.avatarId, motion_id)
            if binding.get("status") == "cancelled":
                raise ValueError("binding is cancelled")
            if binding.get("status") == "error":
                binding = _AVATAR_REGISTRY.update_binding(
                    binding["bindingId"], status="queued", progress=0, error=None
                )
            return _with_asset_versions(_sync_binding_status(binding))

        assert job_id is not None
        job_dir, metadata = _completed_video_job(job_id)
        canonical_motion_id = f"motion-{job_id}"
        try:
            motion = _motion_record(canonical_motion_id)
            motion = _AVATAR_REGISTRY.upsert_motion(
                canonical_motion_id,
                **_motion_fields_for_job(job_id, job_dir, metadata),
            )
        except KeyError:
            motion = _AVATAR_REGISTRY.upsert_motion(
                job_id,
                status="queued",
                progress=0,
                motionAssetUrl=None,
                error=None,
                **_motion_fields_for_job(job_id, job_dir, metadata),
            )

        binding = _AVATAR_REGISTRY.create_binding(
            request.avatarId, motion["motionId"]
        )
        if binding.get("status") == "cancelled":
            raise ValueError("binding is cancelled")
        if motion.get("status") == "ready":
            if binding.get("status") == "error":
                binding = _AVATAR_REGISTRY.update_binding(
                    binding["bindingId"], status="queued", progress=0, error=None
                )
            return _with_asset_versions(_sync_binding_status(binding))

        if motion.get("status") in {"error", "cancelled"}:
            motion = _AVATAR_REGISTRY.upsert_motion(
                motion["motionId"],
                status="queued",
                progress=0,
                motionAssetUrl=None,
                error=None,
                finishedAt=None,
            )
        if binding.get("status") == "error":
            binding = _AVATAR_REGISTRY.update_binding(
                binding["bindingId"],
                status="queued",
                progress=0,
                error=None,
                finishedAt=None,
            )

        source_video = pipeline.persist_source_video(job_dir / "segment.mp4", job_id)
        motion_path = (
            _AVATAR_REGISTRY.motions_dir / motion["motionId"] / "motion.bin"
        )
        loop = asyncio.get_running_loop()
        _submit_motion_job(
            lambda function: loop.run_in_executor(None, function),
            request.avatarId,
            motion["motionId"],
            binding["bindingId"],
            source_video,
            job_dir / "coach.json",
            motion_path,
            float(motion.get("fps") or config.DEFAULT_TARGET_FPS),
        )
        return _with_asset_versions(binding)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail={"error": str(exc)}) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail={"error": str(exc)}) from exc
    except ValueError as exc:
        status = 409 if any(
            marker in str(exc).lower() for marker in ("deleted", "cancelled")
        ) else 400
        raise HTTPException(status_code=status, detail={"error": str(exc)}) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("failed to create avatar binding")
        raise HTTPException(status_code=500, detail={"error": str(exc)}) from exc


@app.get("/avatar-video-exports")
def list_avatar_video_exports(
    avatarId: Optional[str] = None,
    motionId: Optional[str] = None,
) -> list[dict]:
    try:
        records = _AVATAR_REGISTRY.list_video_exports(
            avatar_id=avatarId, motion_id=motionId
        )
        return [_with_asset_versions(record) for record in records]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc


@app.get("/avatar-video-exports/{export_id}")
def get_avatar_video_export(export_id: str) -> dict:
    try:
        return _with_asset_versions(_AVATAR_REGISTRY.get_video_export(export_id))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail={"error": str(exc)}) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc


@app.post("/avatar-video-exports", status_code=202)
async def create_avatar_video_export(request: AvatarVideoExportRequest) -> dict:
    avatar_id = request.avatarId.strip()
    motion_id = request.motionId.strip()
    try:
        avatar_video.validate_dimensions(request.width, request.height)
        avatar_video.parse_background(request.background)
        _, _, identity_path, motion_path = _ready_avatar_video_assets(
            avatar_id, motion_id
        )
        request_key, source_signature = _avatar_video_request_key(
            avatar_id,
            motion_id,
            identity_path,
            motion_path,
            width=request.width,
            height=request.height,
            background=request.background,
        )
        record = _AVATAR_REGISTRY.create_video_export(
            avatar_id,
            motion_id,
            request_key,
            width=request.width,
            height=request.height,
            background=request.background.lower(),
            sourceSignature=source_signature,
            renderer="ewa-gl-v1",
            videoUrl=None,
            error=None,
        )
        export_id = record["exportId"]
        output_path = _AVATAR_REGISTRY._video_export_path(export_id).parent / "avatar.mp4"
        if record.get("status") == "ready" and output_path.is_file():
            return _with_asset_versions(record)
        if record.get("status") in {"ready", "error"}:
            record = _AVATAR_REGISTRY.update_video_export(
                export_id,
                status="queued",
                progress=0,
                progressNote="queued",
                videoUrl=None,
                error=None,
                finishedAt=None,
            )
        loop = asyncio.get_running_loop()
        _submit_avatar_video_export(
            lambda function: loop.run_in_executor(None, function),
            export_id,
            identity_path,
            motion_path,
            output_path,
        )
        return _with_asset_versions(record)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail={"error": str(exc)}) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail={"error": str(exc)}) from exc
    except ValueError as exc:
        status = 409 if any(
            marker in str(exc).lower()
            for marker in ("not ready", "deleted", "cancelled")
        ) else 400
        raise HTTPException(status_code=status, detail={"error": str(exc)}) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("failed to create avatar video export")
        raise HTTPException(status_code=500, detail={"error": str(exc)}) from exc


@app.post("/import/video")
async def import_video(
    file: UploadFile = File(...),
    motion: Optional[str] = Form("squat"),
    targetFps: Optional[int] = Form(None),
    name: Optional[str] = Form(None),
    startSec: Optional[float] = Form(None),
    endSec: Optional[float] = Form(None),
    avatarId: Optional[str] = Form(None),
):
    if app.state.estimator is None:
        raise HTTPException(status_code=503, detail={"error": "SAM model unavailable", "stage": "startup"})
    if motion and motion not in VALID_MOTIONS:
        raise HTTPException(status_code=400, detail={"error": f"unsupported motion '{motion}'", "stage": "input"})
    if startSec is not None and startSec < 0:
        raise HTTPException(status_code=400, detail={"error": "startSec must be >= 0", "stage": "input"})
    if startSec is not None and endSec is not None and endSec <= startSec:
        raise HTTPException(status_code=400, detail={"error": "endSec must be > startSec", "stage": "input"})
    selected_identity = None
    if avatarId and avatarId.strip():
        avatarId = avatarId.strip()
        selected_identity = _require_active_identity(avatarId)

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
            if selected_identity is not None:
                motion = _AVATAR_REGISTRY.upsert_motion(
                    job_id,
                    status="queued",
                    progress=0,
                    jobId=job_id,
                    name=result.get("name"),
                    coachClipUrl=result.get("coachClipUrl"),
                    meshClipMetaUrl=result.get("meshClipMetaUrl"),
                    sourceVideoUrl=result.get("sourceVideoUrl"),
                    durationSeconds=result.get("durationSeconds"),
                    motionAssetUrl=None,
                    error=None,
                )
                try:
                    binding = _AVATAR_REGISTRY.create_binding(
                        selected_identity["avatarId"], motion["motionId"]
                    )
                except ValueError as exc:
                    if "deleted" not in str(exc).lower():
                        raise
                    message = "selected identity became unavailable during import"
                    _AVATAR_REGISTRY.upsert_motion(
                        motion["motionId"],
                        status="cancelled",
                        error=message,
                        finishedAt=time.time(),
                    )
                    result.update(
                        {
                            "motionId": motion["motionId"],
                            "bindingStatus": "cancelled",
                            "bindingError": message,
                        }
                    )
                    logger.info("[%s] %s", job_id, message)
                else:
                    motion_path = (
                        _AVATAR_REGISTRY.motions_dir / motion["motionId"] / "motion.bin"
                    )
                    coach_path = config.PUBLIC_JOBS_DIR / job_id / "coach.json"
                    # The coach clip, timeline thumbnails and browser video are
                    # all derived from this already-sliced segment.  LHM must
                    # consume the same temporal interval; copying upload_path
                    # here would silently animate the full original video when
                    # startSec/endSec selected only a portion of it.
                    segment_path = config.PUBLIC_JOBS_DIR / job_id / "segment.mp4"
                    try:
                        source_video = pipeline.persist_source_video(segment_path, job_id)
                    except Exception as exc:  # noqa: BLE001
                        message = str(exc) or repr(exc)
                        _AVATAR_REGISTRY.upsert_motion(
                            motion["motionId"],
                            status="error",
                            error=message,
                            finishedAt=time.time(),
                        )
                        binding = _AVATAR_REGISTRY.update_binding(
                            binding["bindingId"], status="error", error=message
                        )
                        logger.exception("[%s] failed to persist private avatar source", job_id)
                    else:
                        _submit_motion_job(
                            lambda function: loop.run_in_executor(None, function),
                            selected_identity["avatarId"],
                            motion["motionId"],
                            binding["bindingId"],
                            source_video,
                            coach_path,
                            motion_path,
                            float(result.get("fps") or targetFps or config.DEFAULT_TARGET_FPS),
                        )
                    result.update(
                        {
                            "motionId": motion["motionId"],
                            "bindingId": binding["bindingId"],
                            "bindingStatus": binding["status"],
                        }
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


# --- Static frontend, mounted last so every API route above wins -------------
# Serving the KINE-X root through Starlette gives the frontend HTTP Range
# support: `python -m http.server` has none, and without Range the coach
# videos are non-seekable — timeline scrubbing could never move the video.
_FRONTEND_ROOT = Path(__file__).resolve().parent.parent
app.mount("/", StaticFiles(directory=_FRONTEND_ROOT, html=True), name="frontend")
