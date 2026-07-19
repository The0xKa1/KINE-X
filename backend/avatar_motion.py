"""LHM video-motion extraction and deterministic KINE//X stage adaptation.

The available LHM motion output contains SMPL-X rotations and a camera-space
root translation, but no landmark set shared with the SAM CoachClip.  The
adapter therefore pins the known camera-to-stage axis conversion and fits only
one positive scale plus translation against the two root trajectories.  The
recorded residual quantifies the remaining alignment risk; limb-level drift
cannot be solved until both pipelines expose shared 3D landmarks.
"""
from __future__ import annotations

import json
import math
import subprocess
import tempfile
from pathlib import Path
from typing import Callable, Iterable

import numpy as np

from . import config
from .avatar_assets import pack_motion_jsons


CAMERA_TO_STAGE = np.diag([1.0, -1.0, -1.0])


def compute_stage_transform(frame_paths: Iterable[Path], coach_clip: Path) -> dict:
    """Fit ``stage = scale * CAMERA_TO_STAGE @ camera + t`` on root motion."""
    paths = [Path(path) for path in frame_paths]
    if not paths:
        raise ValueError("motion requires at least one LHM frame")
    camera_roots = np.stack([_translation_from_json(path) for path in paths])
    converted = camera_roots @ CAMERA_TO_STAGE.T
    coach_roots = _coach_pelvis_positions(Path(coach_clip))
    target = _resample_trajectory(coach_roots, len(paths))

    source_center = converted.mean(axis=0)
    target_center = target.mean(axis=0)
    source_zero = converted - source_center
    target_zero = target - target_center
    denominator = float(np.sum(source_zero * source_zero))
    if denominator < 1e-12:
        scale = 1.0
    else:
        scale = float(np.sum(source_zero * target_zero) / denominator)
        if not math.isfinite(scale) or scale <= 1e-8:
            raise ValueError("LHM and CoachClip root trajectories have no positive scale fit")
    translation = target_center - scale * source_center
    fitted = scale * converted + translation
    residual = np.linalg.norm(fitted - target, axis=1)
    return {
        "scale": scale,
        "R": CAMERA_TO_STAGE.tolist(),
        "t": translation.tolist(),
        "rootResidualMeanM": float(residual.mean()),
        "rootResidualMaxM": float(residual.max()),
        "fit": "camera-axes-plus-root-similarity-v1",
    }


def prepare_motion_asset(
    source_video: Path,
    coach_clip: Path,
    output_path: Path,
    *,
    fps: float,
    progress: Callable[[int, int, str], None] | None = None,
) -> dict:
    """Run LHM, normalize its split SMPL-X JSON, then atomically pack motion."""
    source_video = Path(source_video).resolve()
    coach_clip = Path(coach_clip).resolve()
    output_path = Path(output_path).resolve()
    if not source_video.is_file():
        raise FileNotFoundError(source_video)
    if not coach_clip.is_file():
        raise FileNotFoundError(coach_clip)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    def emit(current: int, total: int, note: str) -> None:
        if progress:
            progress(current, total, note)

    emit(0, 3, "starting LHM motion extraction")
    with tempfile.TemporaryDirectory(prefix=".lhm-motion-", dir=output_path.parent) as tmp:
        work = Path(tmp)
        lhm_output = work / "lhm-output"
        command = [
            str(config.LHM_PYTHON),
            str(config.LHM_MOTION_SCRIPT),
            "--video_path",
            str(source_video),
            "--output_path",
            str(lhm_output),
            "--model_path",
            str(config.LHM_MOTION_MODEL_PATH),
        ]
        completed = subprocess.run(
            command,
            cwd=config.LHM_WORKDIR,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=config.LHM_MOTION_TIMEOUT_SEC,
        )
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout or "unknown error")[-2000:]
            raise RuntimeError(f"LHM video2motion failed: {detail}")
        frame_paths = sorted(lhm_output.glob("**/smplx_params/*.json"))
        if not frame_paths:
            raise RuntimeError("LHM video2motion produced no SMPL-X frame JSON")
        emit(1, 3, f"LHM extracted {len(frame_paths)} frames")

        stage_transform = compute_stage_transform(frame_paths, coach_clip)
        normalized_dir = work / "normalized"
        normalized_dir.mkdir()
        normalized_paths = [
            _normalize_lhm_frame(path, normalized_dir / f"{index:05}.json")
            for index, path in enumerate(frame_paths, start=1)
        ]
        emit(2, 3, "packing local xyzw quaternions")
        meta = pack_motion_jsons(
            normalized_paths,
            output_path,
            fps=fps,
            stage_transform=stage_transform,
        )
        emit(3, 3, "motion asset ready")
        return meta


def _translation_from_json(path: Path) -> np.ndarray:
    frame = _json_frame(path)
    for key in ("trans", "transl", "translation"):
        if key in frame:
            value = np.asarray(frame[key], dtype=np.float64)
            if value.shape == (3,) and np.isfinite(value).all():
                return value
            raise ValueError(f"{path}:{key} must contain three finite floats")
    raise ValueError(f"{path} is missing root translation")


def _coach_pelvis_positions(path: Path) -> np.ndarray:
    raw = _json_frame(path)
    frames = raw.get("frames")
    if not isinstance(frames, list) or not frames:
        raise ValueError("CoachClip must contain at least one frame")
    values = []
    for index, frame in enumerate(frames):
        try:
            position = frame["pelvis"]["position"]
        except (KeyError, TypeError) as exc:
            raise ValueError(f"CoachClip frame {index} is missing pelvis.position") from exc
        value = np.asarray(position, dtype=np.float64)
        if value.shape != (3,) or not np.isfinite(value).all():
            raise ValueError(f"CoachClip frame {index} pelvis.position is invalid")
        values.append(value)
    return np.stack(values)


def _resample_trajectory(values: np.ndarray, count: int) -> np.ndarray:
    if len(values) == count:
        return values
    if len(values) == 1:
        return np.repeat(values, count, axis=0)
    source_t = np.linspace(0.0, 1.0, len(values))
    target_t = np.linspace(0.0, 1.0, count)
    return np.stack(
        [np.interp(target_t, source_t, values[:, axis]) for axis in range(3)], axis=1
    )


def _normalize_lhm_frame(source: Path, target: Path) -> Path:
    frame = _json_frame(source)
    if "poses" in frame:
        poses = np.asarray(frame["poses"], dtype=np.float64)
    else:
        aliases = (
            (("root_pose", "global_orient"), 1),
            (("body_pose",), 21),
            (("jaw_pose",), 1),
            (("leye_pose",), 1),
            (("reye_pose",), 1),
            (("lhand_pose", "left_hand_pose"), 15),
            (("rhand_pose", "right_hand_pose"), 15),
        )
        groups = []
        for names, expected in aliases:
            value = next((frame[name] for name in names if name in frame), None)
            if value is None:
                raise ValueError(f"{source} is missing {names[0]}")
            group = np.asarray(value, dtype=np.float64).reshape(-1, 3)
            if group.shape != (expected, 3) or not np.isfinite(group).all():
                raise ValueError(f"{source}:{names[0]} has an invalid shape")
            groups.append(group)
        poses = np.concatenate(groups, axis=0)
    if poses.shape != (55, 3) or not np.isfinite(poses).all():
        raise ValueError(f"{source} must contain 55 finite axis-angle rotations")
    translation = _translation_from_json(source)
    target.write_text(
        json.dumps(
            {"poses": poses.tolist(), "trans": translation.tolist()},
            separators=(",", ":"),
            allow_nan=False,
        ),
        encoding="utf-8",
    )
    return target


def _json_frame(path: Path) -> dict:
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid JSON {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value
