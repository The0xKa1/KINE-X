"""Bake stacked SAM 3D Body MHR vertices into a KINE//X mesh clip.

Mirrors sam_3d_body/bake_smplx_mesh_clip.py but exposes `run(...)` for use as
a library and parameterises all paths.

Outputs (next to out_meta):
- <stem>.bin       float32 vertices, (frames * smplx_v * 3) LE
- <stem>.faces.bin uint32 face indices LE
- <stem>.meta.json header with fps/frame/vertex/face counts
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Tuple

import numpy as np
import torch


def _load_mhr_faces(ckpt_path: Path) -> np.ndarray:
    sd = torch.load(str(ckpt_path), map_location="cpu", weights_only=False)
    if "head_pose.faces" not in sd:
        raise RuntimeError(f"head_pose.faces not found in {ckpt_path}")
    return sd["head_pose.faces"].cpu().numpy().astype(np.int64)


def _load_smplx_faces(smplx_npz: Path) -> np.ndarray:
    with np.load(smplx_npz, allow_pickle=True) as d:
        f = d["f"]
    return np.asarray(f, dtype=np.int64)


def _load_mhr2smplx_mapping(mapping_npz: Path) -> Tuple[np.ndarray, np.ndarray]:
    with np.load(mapping_npz, allow_pickle=False) as d:
        triangle_ids = np.asarray(d["triangle_ids"], dtype=np.int64)
        baryc = np.asarray(d["baryc_coords"], dtype=np.float64)
    return triangle_ids, baryc


def _to_world(verts: np.ndarray) -> np.ndarray:
    """MHR (X right, Y down, Z toward camera) -> world (X right, Y up, Z toward viewer)."""
    out = verts.astype(np.float64).copy()
    out[..., 1] *= -1.0
    out[..., 2] *= -1.0
    return out


def _barycentric_resample(
    mhr_verts: np.ndarray, mhr_faces: np.ndarray, tri_ids: np.ndarray, baryc: np.ndarray
) -> np.ndarray:
    tri = mhr_faces[tri_ids]  # (V_smplx, 3) MHR vertex indices
    selected = mhr_verts[:, tri, :]  # (F, V_smplx, 3 corners, 3 xyz)
    bary = baryc[None, :, :, None]  # (1, V_smplx, 3, 1)
    smplx_verts = (selected * bary).sum(axis=2)
    return smplx_verts.astype(np.float32)


def _normalize_anchor(verts: np.ndarray, floor_offset_m: float = 0.04) -> np.ndarray:
    """Recentre XZ on the mean per-frame centroid and lift so the lowest vertex sits at floor_offset."""
    if verts.size == 0:
        return verts
    centroid_xz = verts.reshape(-1, 3).mean(axis=0)
    centroid_xz[1] = 0.0
    out = verts - centroid_xz
    floor_y = float(out[..., 1].min())
    out[..., 1] += floor_offset_m - floor_y
    return out.astype(np.float32)


def run(
    npz: Path,
    out_meta: Path,
    ckpt: Path,
    mapping: Path,
    smplx: Path,
    motion: str = "squat",
    seed_id: str = "imported",
    name: str = "Imported clip",
    floor_offset: float = 0.04,
) -> dict:
    npz = Path(npz)
    out_meta = Path(out_meta)

    with np.load(npz, allow_pickle=False) as d:
        mhr_verts = np.asarray(d["pred_vertices"], dtype=np.float32)
        fps = int(d["fps"]) if "fps" in d.files else 15

    mhr_faces = _load_mhr_faces(ckpt)
    tri_ids, baryc = _load_mhr2smplx_mapping(mapping)
    smplx_faces = _load_smplx_faces(smplx)

    mhr_world = _to_world(mhr_verts)
    smplx_world = _barycentric_resample(mhr_world, mhr_faces, tri_ids, baryc)
    smplx_world = _normalize_anchor(smplx_world, floor_offset_m=floor_offset)

    bin_path = out_meta.with_suffix("").with_suffix(".bin")
    faces_path = out_meta.with_suffix("").with_suffix(".faces.bin")
    out_meta.parent.mkdir(parents=True, exist_ok=True)

    smplx_world.astype("<f4").tofile(bin_path)
    smplx_faces.astype("<u4").tofile(faces_path)

    meta = {
        "id": seed_id,
        "name": name,
        "motion": motion,
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
    out_meta.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return meta
