"""Stack per-frame SAM 3D Body raw outputs into a single smpl_data.npz.

Mirrors sam/output/scripts/pack_smpl_like_data.py — same key list, same fps
field, but parameterised on directories so we can target per-job paths.
"""
from __future__ import annotations

from pathlib import Path
from typing import Sequence

import numpy as np

PACK_KEYS: tuple[str, ...] = (
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


def pack(raw_dir: Path, out_npz: Path, fps: int) -> Path:
    raw_dir = raw_dir.resolve()
    files: Sequence[Path] = sorted(raw_dir.glob("frame_*.npz"))
    if not files:
        raise FileNotFoundError(f"No frame_*.npz under {raw_dir}")

    stacks: dict[str, list[np.ndarray]] = {k: [] for k in PACK_KEYS}
    for npz_path in files:
        with np.load(npz_path, allow_pickle=False) as d:
            for key in PACK_KEYS:
                if key in d.files:
                    stacks[key].append(d[key])

    arrays = {k: np.stack(v) for k, v in stacks.items() if v}
    if "pred_vertices" not in arrays:
        raise RuntimeError("packed data missing pred_vertices — bake will fail")

    out_npz.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        out_npz,
        **arrays,
        fps=np.array(int(fps), dtype=np.int32),
        pose_format=np.array("mhr127/mhr70; not strict SMPL-X"),
        source_model=np.array("facebook/sam-3d-body-dinov3"),
    )
    return out_npz
