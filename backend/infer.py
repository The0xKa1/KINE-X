"""Run SAM 3D Body inference over a directory of frame JPGs.

Each frame becomes one `raw_outputs/frame_XXXXX.npz` with the same key list
that pack.py / bake.py / coach.py read.
"""
from __future__ import annotations

from pathlib import Path
from typing import Callable

import cv2
import numpy as np

# 11 keys baked into the rest of the pipeline.
SAVE_FIELDS: tuple[str, ...] = (
    "pred_joint_coords",
    "pred_keypoints_3d",
    "pred_global_rots",
    "pred_vertices",
    "pred_cam_t",
    "mhr_model_params",
    "body_pose_params",
    "hand_pose_params",
    "shape_params",
    "scale_params",
    "global_rot",
)


def _save_raw_npz(target: Path, person: dict) -> None:
    payload: dict[str, np.ndarray] = {}
    for key in SAVE_FIELDS:
        value = person.get(key)
        if value is None:
            continue
        arr = np.asarray(value)
        if arr.dtype.kind in ("U", "O"):
            continue
        payload[key] = arr
    if not payload:
        raise RuntimeError(f"empty SAM output for {target.name}")
    target.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(target, **payload)


def infer_frames(
    frames_dir: Path,
    raw_dir: Path,
    estimator,
    progress: Callable[[int, int, str], None] | None = None,
) -> int:
    """Iterate jpg files under `frames_dir`, run SAM, write raw_outputs/frame_*.npz.

    Returns the number of frames written. Frames where the model returns no
    person are filled by repeating the previous frame's output (so frame index
    alignment with ffmpeg's extraction is preserved).
    """
    frames_dir = Path(frames_dir).resolve()
    raw_dir = Path(raw_dir).resolve()
    raw_dir.mkdir(parents=True, exist_ok=True)

    images = sorted(frames_dir.glob("*.jpg"))
    if not images:
        raise FileNotFoundError(f"No frames under {frames_dir}")

    last_person: dict | None = None
    written = 0
    for index, image_path in enumerate(images):
        target = raw_dir / f"{image_path.stem}.npz"
        if target.exists():
            with np.load(target, allow_pickle=False) as data:
                last_person = {k: data[k] for k in data.files}
            written += 1
            if progress:
                progress(index + 1, len(images), "cached")
            continue

        img = cv2.imread(str(image_path))
        if img is None:
            raise RuntimeError(f"cv2 failed to read {image_path}")
        h, w = img.shape[:2]
        bbox = np.array([[0, 0, w, h]], dtype=np.float32)
        outputs = estimator.process_one_image(str(image_path), bboxes=bbox, inference_type="body")
        if outputs:
            person = outputs[0]
        elif last_person is not None:
            person = last_person
        else:
            raise RuntimeError(f"SAM produced no person and no prior frame to reuse: {image_path}")

        _save_raw_npz(target, person)
        last_person = person
        written += 1
        if progress:
            progress(index + 1, len(images), "infer")

    return written
