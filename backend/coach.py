"""Export a HoloMotion CoachClip JSON from a stacked SAM 3D Body npz.

Mirrors sam_3d_body/export_coach_clip.py but exposes `run(...)` for use as a
library and parameterises paths + seed metadata.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np

MHR70 = {
    "nose": 0,
    "left_eye": 1,
    "right_eye": 2,
    "left_shoulder": 5,
    "right_shoulder": 6,
    "left_elbow": 7,
    "right_elbow": 8,
    "left_hip": 9,
    "right_hip": 10,
    "left_knee": 11,
    "right_knee": 12,
    "left_ankle": 13,
    "right_ankle": 14,
    "right_wrist": 41,
    "left_wrist": 62,
    "neck": 69,
}

PROJECT_JOINTS: Tuple[str, ...] = (
    "pelvis",
    "spine",
    "chest",
    "neck",
    "head",
    "lShoulder",
    "rShoulder",
    "lElbow",
    "rElbow",
    "lWrist",
    "rWrist",
    "lHip",
    "rHip",
    "lKnee",
    "rKnee",
    "lAnkle",
    "rAnkle",
)

IDENTITY_QUAT = [0.0, 0.0, 0.0, 1.0]


def _to_world(points: np.ndarray) -> np.ndarray:
    out = points.astype(np.float64).copy()
    out[..., 1] *= -1.0
    out[..., 2] *= -1.0
    return out


def _smooth_along_time(arr: np.ndarray, passes: int = 2) -> np.ndarray:
    if arr.shape[0] < 3:
        return arr.copy()
    out = arr.astype(np.float64).copy()
    for _ in range(passes):
        prev = out.copy()
        out[1:-1] = 0.25 * prev[:-2] + 0.5 * prev[1:-1] + 0.25 * prev[2:]
    return out


def _build_project_joints(kp_world: np.ndarray) -> Dict[str, np.ndarray]:
    n = kp_world.shape[0]
    lhip = kp_world[:, MHR70["left_hip"]]
    rhip = kp_world[:, MHR70["right_hip"]]
    lsh = kp_world[:, MHR70["left_shoulder"]]
    rsh = kp_world[:, MHR70["right_shoulder"]]
    leye = kp_world[:, MHR70["left_eye"]]
    reye = kp_world[:, MHR70["right_eye"]]
    neck = kp_world[:, MHR70["neck"]]

    pelvis = (lhip + rhip) * 0.5
    chest = (lsh + rsh) * 0.5
    spine = pelvis + (chest - pelvis) * 0.55
    eye_mid = (leye + reye) * 0.5
    head = eye_mid + (eye_mid - neck) * 0.45

    joints: Dict[str, np.ndarray] = {
        "pelvis": pelvis,
        "spine": spine,
        "chest": chest,
        "neck": neck,
        "head": head,
        "lShoulder": lsh,
        "rShoulder": rsh,
        "lElbow": kp_world[:, MHR70["left_elbow"]],
        "rElbow": kp_world[:, MHR70["right_elbow"]],
        "lWrist": kp_world[:, MHR70["left_wrist"]],
        "rWrist": kp_world[:, MHR70["right_wrist"]],
        "lHip": lhip,
        "rHip": rhip,
        "lKnee": kp_world[:, MHR70["left_knee"]],
        "rKnee": kp_world[:, MHR70["right_knee"]],
        "lAnkle": kp_world[:, MHR70["left_ankle"]],
        "rAnkle": kp_world[:, MHR70["right_ankle"]],
    }
    assert all(joints[k].shape == (n, 3) for k in joints)
    return joints


def _normalize_skeleton(
    joints: Dict[str, np.ndarray],
    target_pelvis_to_neck_m: float = 0.55,
    floor_offset_m: float = 0.04,
) -> Tuple[Dict[str, np.ndarray], float, np.ndarray]:
    pelvis = joints["pelvis"]
    neck = joints["neck"]
    torso_len = np.linalg.norm(neck - pelvis, axis=1)
    median_torso = float(np.nanmedian(torso_len))
    scale = target_pelvis_to_neck_m / max(median_torso, 1e-6)

    scaled = {k: v * scale for k, v in joints.items()}

    pelvis_xz_mean = scaled["pelvis"].mean(axis=0)
    pelvis_xz_mean[1] = 0.0
    centred = {k: v - pelvis_xz_mean for k, v in scaled.items()}

    foot_y = float(np.minimum(centred["lAnkle"][:, 1], centred["rAnkle"][:, 1]).min())
    y_shift = floor_offset_m - foot_y
    for k in centred:
        centred[k] = centred[k] + np.array([0.0, y_shift, 0.0])

    return centred, scale, pelvis_xz_mean


def _build_clip_frames(joints: Dict[str, np.ndarray]) -> List[Dict[str, object]]:
    n = next(iter(joints.values())).shape[0]
    out: List[Dict[str, object]] = []
    for i in range(n):
        pose: Dict[str, Dict[str, List[float]]] = {}
        for name in PROJECT_JOINTS:
            p = joints[name][i].tolist()
            pose[name] = {
                "position": [round(p[0], 6), round(p[1], 6), round(p[2], 6)],
                "rotation": list(IDENTITY_QUAT),
            }
        out.append(pose)
    return out


def run(
    npz: Path,
    out_json: Path,
    motion: str = "squat",
    seed_id: str = "imported",
    name: str = "Imported clip",
    target_torso: float = 0.55,
    floor_offset: float = 0.04,
    smooth_passes: int = 2,
) -> dict:
    npz = Path(npz)
    out_json = Path(out_json)

    with np.load(npz, allow_pickle=False) as d:
        keypoints = np.asarray(d["pred_keypoints_3d"], dtype=np.float32)
        fps = int(d["fps"]) if "fps" in d.files else 15
    if keypoints.ndim != 3 or keypoints.shape[1] < 70:
        raise RuntimeError(f"Unexpected pred_keypoints_3d shape: {keypoints.shape}")

    world = _to_world(keypoints)
    world = _smooth_along_time(world, passes=smooth_passes)
    joints = _build_project_joints(world)
    joints, applied_scale, pelvis_mean = _normalize_skeleton(
        joints, target_pelvis_to_neck_m=target_torso, floor_offset_m=floor_offset
    )

    frames = _build_clip_frames(joints)
    duration = round(len(frames) / fps, 3)

    clip = {
        "id": seed_id,
        "name": name,
        "fps": fps,
        "durationSeconds": duration,
        "frames": frames,
        "motion": motion,
        "capturedAt": 0,
        "thumbnails": [],
        "_meta": {
            "source": "sam-3d-body/mhr70",
            "appliedScale": round(applied_scale, 6),
            "pelvisXZMean": pelvis_mean.tolist(),
            "frameCount": len(frames),
            "format": "holomotion.coach_clip.v1",
            "unit": "meters",
            "handedness": "right-hand",
        },
    }

    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(clip, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return {
        "fps": fps,
        "frameCount": len(frames),
        "durationSeconds": duration,
        "name": name,
        "motion": motion,
        "scale": applied_scale,
    }
