"""End-to-end orchestration: video → (ffmpeg) frames → SAM inference → pack → bake → coach."""
from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Callable

from . import bake, coach, config, infer, pack


SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def safe_name(raw: str) -> str:
    cleaned = SAFE_NAME_RE.sub("_", raw).strip("._-")
    return cleaned or "imported"


def extract_frames(
    video_path: Path,
    frames_dir: Path,
    target_fps: int,
    *,
    start_sec: float | None = None,
    end_sec: float | None = None,
) -> int:
    """Run ffmpeg, write `frame_%05d.jpg` to frames_dir. Returns frame count.

    When start_sec/end_sec are provided, ffmpeg uses input-side seeking
    (`-ss` before `-i`) plus an output `-to` so the slice is keyframe-fast
    and frame-accurate. Both bounds are in seconds, relative to the source.
    """
    frames_dir.mkdir(parents=True, exist_ok=True)
    # Clear any pre-existing frames so the count is accurate.
    for p in frames_dir.glob("frame_*.jpg"):
        p.unlink()
    cmd: list[str] = ["ffmpeg", "-y"]
    if start_sec is not None and start_sec > 0:
        cmd += ["-ss", f"{start_sec:.3f}"]
    cmd += ["-i", str(video_path)]
    if end_sec is not None and (start_sec is None or end_sec > start_sec):
        # -to with input-side -ss is interpreted as duration from the seek
        # point in modern ffmpeg, so pass the duration explicitly.
        duration = end_sec - (start_sec or 0.0)
        cmd += ["-t", f"{duration:.3f}"]
    cmd += [
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


def export_segment(
    video_path: Path,
    out_path: Path,
    *,
    start_sec: float | None = None,
    end_sec: float | None = None,
) -> Path:
    """Re-encode the (optionally sliced) source as a public `segment.mp4`.

    H.264/yuv420p with audio stripped at CRF 23 — a ~10s clip costs almost
    nothing and plays in every browser. Uses the same input-side seeking
    semantics as extract_frames, so the segment matches the extracted frames.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cmd: list[str] = ["ffmpeg", "-y"]
    if start_sec is not None and start_sec > 0:
        cmd += ["-ss", f"{start_sec:.3f}"]
    cmd += ["-i", str(video_path)]
    if end_sec is not None and (start_sec is None or end_sec > start_sec):
        duration = end_sec - (start_sec or 0.0)
        cmd += ["-t", f"{duration:.3f}"]
    cmd += [
        "-an",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        # yuv420p requires even dimensions; a no-op for already-even sources.
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-movflags", "+faststart",
        str(out_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg segment export failed: {result.stderr[-2000:]}")
    return out_path


def run_pipeline(
    video_path: Path,
    job_id: str,
    estimator,
    *,
    motion: str = "squat",
    target_fps: int | None = None,
    name: str | None = None,
    start_sec: float | None = None,
    end_sec: float | None = None,
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

    range_note = ""
    if start_sec is not None or end_sec is not None:
        s = start_sec if start_sec is not None else 0.0
        e = end_sec if end_sec is not None else float("inf")
        range_note = f" [{s:.2f}s, {e:.2f}s]"
    emit("extract", 0, 1, f"ffmpeg{range_note}")
    frame_count = extract_frames(
        video_path, frames_dir, fps, start_sec=start_sec, end_sec=end_sec
    )
    emit("extract", 1, 1, f"{frame_count} frames{range_note}")

    emit("segment", 0, 1, "ffmpeg segment.mp4")
    segment_mp4 = export_segment(
        video_path, job_dir / "segment.mp4", start_sec=start_sec, end_sec=end_sec
    )
    emit("segment", 1, 1, segment_mp4.name)

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
        "sourceVideoUrl": config.relative_to_repo(segment_mp4),
    }


def cleanup_job(job_id: str) -> None:
    """Best-effort deletion of a job directory (used when pipeline fails midway)."""
    job_dir = config.PUBLIC_JOBS_DIR / job_id
    if job_dir.exists():
        shutil.rmtree(job_dir, ignore_errors=True)


def persist_source_video(video_path: Path, job_id: str) -> Path:
    """Atomically keep a private, short-lived copy for avatar motion extraction.

    The filename is deliberately omitted from every public response/manifest.
    The background binding worker removes it on both success and terminal error.
    """
    video_path = Path(video_path).resolve()
    if not video_path.is_file():
        raise FileNotFoundError(video_path)
    if safe_name(job_id) != job_id:
        raise ValueError("unsafe job id")
    suffix = video_path.suffix.lower()
    if not re.fullmatch(r"\.[a-z0-9]{1,8}", suffix):
        suffix = ".mp4"
    job_dir = (config.AVATAR_PRIVATE_JOBS_DIR / job_id).resolve()
    job_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        job_dir.chmod(0o700)
    except OSError:
        pass
    target = job_dir / f".avatar-source{suffix}"
    temp_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "wb", dir=job_dir, prefix=".avatar-source.", delete=False
        ) as handle:
            temp_name = handle.name
            with video_path.open("rb") as source:
                shutil.copyfileobj(source, handle)
            handle.flush()
        Path(temp_name).replace(target)
        try:
            target.chmod(0o600)
        except OSError:
            pass
        temp_name = None
        return target
    except Exception:
        if temp_name:
            Path(temp_name).unlink(missing_ok=True)
        raise


def find_persisted_source(job_id: str) -> Path | None:
    """Locate the one private source retained for an unfinished motion job."""
    if safe_name(job_id) != job_id:
        raise ValueError("unsafe job id")
    job_dir = (config.AVATAR_PRIVATE_JOBS_DIR / job_id).resolve()
    if not job_dir.is_dir():
        return None
    return next(iter(sorted(job_dir.glob(".avatar-source.*"))), None)
