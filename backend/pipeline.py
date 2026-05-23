"""End-to-end orchestration: video → (ffmpeg) frames → SAM inference → pack → bake → coach."""
from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path
from typing import Callable

from . import bake, coach, config, infer, pack


SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def safe_name(raw: str) -> str:
    cleaned = SAFE_NAME_RE.sub("_", raw).strip("._-")
    return cleaned or "imported"


def extract_frames(video_path: Path, frames_dir: Path, target_fps: int) -> int:
    """Run ffmpeg, write `frame_%05d.jpg` to frames_dir. Returns frame count."""
    frames_dir.mkdir(parents=True, exist_ok=True)
    # Clear any pre-existing frames so the count is accurate.
    for p in frames_dir.glob("frame_*.jpg"):
        p.unlink()
    cmd = [
        "ffmpeg",
        "-y",
        "-i", str(video_path),
        "-vf", f"fps={target_fps}",
        "-q:v", "3",
        str(frames_dir / "frame_%05d.jpg"),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {result.stderr[-2000:]}")
    written = sorted(frames_dir.glob("frame_*.jpg"))
    if not written:
        raise RuntimeError("ffmpeg produced no frames — is the file a valid video?")
    return len(written)


def run_pipeline(
    video_path: Path,
    job_id: str,
    estimator,
    *,
    motion: str = "squat",
    target_fps: int | None = None,
    name: str | None = None,
    progress: Callable[[str, int, int, str], None] | None = None,
) -> dict:
    """Returns a 10-field dict matching the HTTP response contract."""
    video_path = Path(video_path).resolve()
    if not video_path.exists():
        raise FileNotFoundError(video_path)

    fps = target_fps or config.DEFAULT_TARGET_FPS
    clip_name = safe_name(name or video_path.stem)
    job_dir = (config.PUBLIC_JOBS_DIR / job_id).resolve()
    job_dir.mkdir(parents=True, exist_ok=True)
    frames_dir = job_dir / "frames"
    raw_dir = job_dir / "raw_outputs"
    smpl_npz = job_dir / "smpl_data.npz"
    mesh_meta = job_dir / "mesh.meta.json"
    coach_json = job_dir / "coach.json"

    def emit(stage: str, current: int, total: int, note: str = "") -> None:
        if progress:
            progress(stage, current, total, note)

    emit("extract", 0, 1, "ffmpeg")
    frame_count = extract_frames(video_path, frames_dir, fps)
    emit("extract", 1, 1, f"{frame_count} frames")

    def infer_cb(current: int, total: int, note: str) -> None:
        emit("infer", current, total, note)

    infer.infer_frames(frames_dir, raw_dir, estimator, progress=infer_cb)
    emit("pack", 0, 1, "stacking npz")
    pack.pack(raw_dir, smpl_npz, fps=fps)
    emit("pack", 1, 1, smpl_npz.name)

    emit("bake", 0, 1, "mesh bake")
    mesh_meta_info = bake.run(
        npz=smpl_npz,
        out_meta=mesh_meta,
        ckpt=config.SAM_CHECKPOINT,
        mapping=config.MHR2SMPLX_MAPPING,
        smplx=config.SMPLX_NEUTRAL,
        motion=motion,
        seed_id=job_id,
        name=clip_name,
    )
    emit("bake", 1, 1, f"{mesh_meta_info['vertexCount']} verts × {mesh_meta_info['frameCount']} frames")

    emit("coach", 0, 1, "coach.json")
    coach_info = coach.run(
        npz=smpl_npz,
        out_json=coach_json,
        motion=motion,
        seed_id=job_id,
        name=clip_name,
    )
    emit("coach", 1, 1, f"{coach_info['frameCount']} frames")

    return {
        "jobId": job_id,
        "coachClipUrl": config.relative_to_repo(coach_json),
        "meshClipMetaUrl": config.relative_to_repo(mesh_meta),
        "framesDir": config.relative_to_repo(frames_dir),
        "framePattern": "frame_{i:05}.jpg",
        "frameCount": frame_count,
        "thumbnailCount": min(config.DEFAULT_THUMBNAIL_COUNT, frame_count),
        "durationSeconds": coach_info["durationSeconds"],
        "fps": coach_info["fps"],
        "name": clip_name,
        "motion": motion,
    }


def cleanup_job(job_id: str) -> None:
    """Best-effort deletion of a job directory (used when pipeline fails midway)."""
    job_dir = config.PUBLIC_JOBS_DIR / job_id
    if job_dir.exists():
        shutil.rmtree(job_dir, ignore_errors=True)
