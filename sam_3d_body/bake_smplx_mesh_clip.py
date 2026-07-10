#!/usr/bin/env python3
"""Bake SAM 3D Body MHR mesh sequence into an SMPLX-topology mesh clip
using the official mhr2smplx barycentric mapping.

This implements the same vertex resampling that
MHR/tools/mhr_smpl_conversion/conversion.py::_apply_barycentric_mapping does
for the 'mhr2smpl' direction, but skips the optional Adam fitting on top —
we only need the per-frame SMPLX vertex positions for browser playback.

Outputs (next to --out-meta):
  - <stem>.bin       float32 vertices, (frames * smplx_v * 3)
  - <stem>.faces.bin uint32 face indices, (smplx_f * 3)
  - <stem>.meta.json header with fps/frame count/vertex count/face count + clip metadata
"""

import argparse
import json
from pathlib import Path

import numpy as np
import torch


def load_mhr_faces(ckpt_path: Path) -> np.ndarray:
    sd = torch.load(str(ckpt_path), map_location="cpu", weights_only=False)
    if "head_pose.faces" not in sd:
        raise SystemExit(f"head_pose.faces not in {ckpt_path}")
    return sd["head_pose.faces"].cpu().numpy().astype(np.int64)


def load_smplx_faces(smplx_npz: Path) -> np.ndarray:
    with np.load(smplx_npz, allow_pickle=True) as d:
        f = d["f"]
    return np.asarray(f, dtype=np.int64)


def load_mhr2smplx_mapping(mapping_npz: Path):
    with np.load(mapping_npz, allow_pickle=False) as d:
        triangle_ids = np.asarray(d["triangle_ids"], dtype=np.int64)
        baryc = np.asarray(d["baryc_coords"], dtype=np.float64)
    return triangle_ids, baryc


def to_world(verts: np.ndarray) -> np.ndarray:
    """MHR (X right, Y down, Z toward camera) -> world (X right, Y up, Z toward viewer)."""
    out = verts.astype(np.float64).copy()
    out[..., 1] *= -1.0
    out[..., 2] *= -1.0
    return out


def barycentric_resample(mhr_verts: np.ndarray, mhr_faces: np.ndarray, tri_ids: np.ndarray, baryc: np.ndarray) -> np.ndarray:
    """mhr_verts: (F, V_mhr, 3); mhr_faces: (F_mhr, 3); tri_ids: (V_smplx,); baryc: (V_smplx, 3).
    Returns (F, V_smplx, 3) float32.
    """
    tri = mhr_faces[tri_ids]  # (V_smplx, 3) MHR vertex indices
    # gather: (F, V_smplx, 3, 3) where last two dims are (triangle corner, xyz)
    selected = mhr_verts[:, tri, :]
    bary = baryc[None, :, :, None]  # (1, V_smplx, 3, 1)
    smplx_verts = (selected * bary).sum(axis=2)
    return smplx_verts.astype(np.float32)


def normalize_anchor(verts: np.ndarray, floor_offset_m: float = 0.04) -> np.ndarray:
    """Shift entire sequence so the lowest vertex lands at floor_offset_m
    and recentre X/Z on the per-frame mean. Y is shifted globally so the
    motion's vertical span is preserved.
    """
    out = verts.copy()
    # Per-frame mean of X,Z to subtract; keep Y as-is.
    mean_xz = out.mean(axis=1)  # (F, 3)
    mean_xz[:, 1] = 0.0
    out = out - mean_xz[:, None, :]
    # Global Y shift so the minimum across the whole clip is at floor_offset_m.
    y_min = out[..., 1].min()
    out[..., 1] += (floor_offset_m - y_min)
    return out


def main():
    parser = argparse.ArgumentParser()
    repo_root = Path(__file__).resolve().parents[1]
    parser.add_argument(
        "--npz",
        type=Path,
        default=repo_root.parent / "sam" / "output" / "smpl_data.npz",
    )
    parser.add_argument(
        "--ckpt",
        type=Path,
        default=Path("/home/zhangjinkai/.cache/modelscope/hub/models/facebook/sam-3d-body-dinov3/model.ckpt"),
        help="SAM 3D Body model.ckpt (used to read MHR faces).",
    )
    parser.add_argument(
        "--mapping",
        type=Path,
        default=repo_root.parent / "sam_3d_smpl_workspace" / "MHR" / "tools" / "mhr_smpl_conversion" / "assets" / "mhr2smplx_mapping.npz",
    )
    parser.add_argument(
        "--smplx",
        type=Path,
        default=repo_root.parent / "sam" / "smpl_models" / "smplx" / "SMPLX_NEUTRAL.npz",
    )
    parser.add_argument(
        "--out-meta",
        type=Path,
        default=repo_root / "public" / "coach_clips" / "single_leg_squat.mesh.meta.json",
    )
    parser.add_argument("--seed-id", default="basic-single-leg-squat")
    parser.add_argument("--name", default="Basic Single Leg Squat")
    parser.add_argument("--motion", default="squat", choices=("squat", "hinge", "flow", "bounce", "throw"))
    parser.add_argument("--floor-offset", type=float, default=0.04)
    args = parser.parse_args()

    with np.load(args.npz, allow_pickle=False) as d:
        mhr_verts = np.asarray(d["pred_vertices"], dtype=np.float32)  # (F, 18439, 3)
        fps = int(d["fps"]) if "fps" in d.files else 15

    print(f"loaded {mhr_verts.shape[0]} frames of MHR mesh ({mhr_verts.shape[1]} verts)")
    mhr_faces = load_mhr_faces(args.ckpt)
    print(f"loaded MHR faces: {mhr_faces.shape}")
    tri_ids, baryc = load_mhr2smplx_mapping(args.mapping)
    print(f"loaded mapping: tri_ids={tri_ids.shape}, baryc={baryc.shape}")
    smplx_faces = load_smplx_faces(args.smplx)
    print(f"loaded SMPLX faces: {smplx_faces.shape}")

    # Coord convert and resample.
    mhr_world = to_world(mhr_verts)
    smplx_world = barycentric_resample(mhr_world, mhr_faces, tri_ids, baryc)
    smplx_world = normalize_anchor(smplx_world, floor_offset_m=args.floor_offset)
    print(f"smplx mesh sequence: shape={smplx_world.shape} dtype={smplx_world.dtype}")

    bin_path = args.out_meta.with_suffix("").with_suffix(".bin")
    faces_path = args.out_meta.with_suffix("").with_suffix(".faces.bin")
    args.out_meta.parent.mkdir(parents=True, exist_ok=True)

    # Write little-endian float32 verts
    smplx_world.astype("<f4").tofile(bin_path)
    # Use uint32 indices to be safe (SMPLX has 10475 verts which fits in uint16, but uint32 is web-friendly)
    smplx_faces.astype("<u4").tofile(faces_path)

    meta = {
        "id": args.seed_id,
        "name": args.name,
        "motion": args.motion,
        "fps": fps,
        "durationSeconds": round(smplx_world.shape[0] / fps, 3),
        "frameCount": int(smplx_world.shape[0]),
        "vertexCount": int(smplx_world.shape[1]),
        "faceCount": int(smplx_faces.shape[0]),
        "vertexBytes": int(bin_path.stat().st_size),
        "faceBytes": int(faces_path.stat().st_size),
        "vertexBin": bin_path.name,
        "faceBin": faces_path.name,
        "vertexDtype": "float32",
        "faceDtype": "uint32",
        "source": "sam-3d-body + mhr2smplx barycentric",
        "format": "kinex.mesh_clip.v1",
        "unit": "meters",
        "handedness": "right-hand",
    }
    args.out_meta.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(
        f"wrote {bin_path.name} ({bin_path.stat().st_size/1024/1024:.1f} MB), "
        f"{faces_path.name} ({faces_path.stat().st_size/1024:.1f} KB), "
        f"{args.out_meta.name}"
    )


if __name__ == "__main__":
    main()
