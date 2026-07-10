#!/usr/bin/env python3
"""Export a KINE//X CoachClip JSON from a stacked SAM 3D Body smpl_data.npz.

The NPZ is the per-video aggregate produced by sam/output/scripts/pack_smpl_like_data.py.
We map mhr70 keypoints to the 17-joint skeleton the frontend renders, convert MHR
camera coordinates to the project's right-hand Y-up meters, anchor the lowest foot
to the floor, and emit a JSON matching the CoachClip TypeScript interface.

Usage (HabitatGs env):

    python sam_3d_body/export_coach_clip.py \
        --input ../sam/output/smpl_data.npz \
        --output public/coach_clips/single_leg_squat.json \
        --name "Basic Single Leg Squat" \
        --motion squat
"""

import argparse
import json
import math
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


def to_world(points: np.ndarray) -> np.ndarray:
    """MHR camera (X right, Y down, Z toward camera) -> world (X right, Y up, Z toward viewer).

    Flipping Y and Z preserves right-handedness.
    """
    out = points.astype(np.float64).copy()
    out[..., 1] *= -1.0
    out[..., 2] *= -1.0
    return out


def smooth_along_time(arr: np.ndarray, passes: int = 2) -> np.ndarray:
    """Light triangular smoothing per joint/channel."""
    if arr.shape[0] < 3:
        return arr.copy()
    out = arr.astype(np.float64).copy()
    for _ in range(passes):
        prev = out.copy()
        out[1:-1] = 0.25 * prev[:-2] + 0.5 * prev[1:-1] + 0.25 * prev[2:]
    return out


def build_project_joints(kp_world: np.ndarray) -> Dict[str, np.ndarray]:
    """kp_world has shape (F, 70, 3). Returns dict[joint] -> (F, 3)."""
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
    head = eye_mid + (eye_mid - neck) * 0.45  # extend slightly above eyes

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


def normalize_skeleton(
    joints: Dict[str, np.ndarray],
    target_pelvis_to_neck_m: float = 0.55,
    floor_offset_m: float = 0.04,
) -> Tuple[Dict[str, np.ndarray], float, np.ndarray]:
    """Scale to canonical human size, anchor lowest foot to ~floor, recentre X/Z on pelvis trajectory."""
    pelvis = joints["pelvis"]
    neck = joints["neck"]
    torso_len = np.linalg.norm(neck - pelvis, axis=1)
    median_torso = float(np.nanmedian(torso_len))
    scale = target_pelvis_to_neck_m / max(median_torso, 1e-6)

    scaled = {k: v * scale for k, v in joints.items()}

    # Recentre X and Z around the mean pelvis position (keeps body in frame).
    pelvis_xz_mean = scaled["pelvis"].mean(axis=0)
    pelvis_xz_mean[1] = 0.0  # don't touch Y here
    centred = {k: v - pelvis_xz_mean for k, v in scaled.items()}

    # Anchor lowest foot to slightly above the floor across the whole sequence.
    foot_y = np.minimum(centred["lAnkle"][:, 1], centred["rAnkle"][:, 1]).min()
    y_shift = floor_offset_m - foot_y
    for k in centred:
        centred[k] = centred[k] + np.array([0.0, y_shift, 0.0])

    return centred, scale, pelvis_xz_mean


def build_clip_frames(joints: Dict[str, np.ndarray]) -> List[Dict[str, object]]:
    n = next(iter(joints.values())).shape[0]
    frames: List[Dict[str, object]] = []
    for i in range(n):
        pose: Dict[str, Dict[str, List[float]]] = {}
        for name in PROJECT_JOINTS:
            p = joints[name][i].tolist()
            pose[name] = {
                "position": [round(p[0], 6), round(p[1], 6), round(p[2], 6)],
                "rotation": list(IDENTITY_QUAT),
            }
        frames.append(pose)
    return frames


def build_thumbnails(count: int) -> List[str]:
    return [""] * count


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--input",
        type=Path,
        default=Path(__file__).resolve().parents[1].parent / "sam" / "output" / "smpl_data.npz",
        help="Stacked SAM 3D Body smpl_data.npz (frame-major).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "public" / "coach_clips" / "single_leg_squat.json",
        help="Destination CoachClip JSON.",
    )
    parser.add_argument("--seed-id", default="basic-single-leg-squat")
    parser.add_argument("--name", default="Basic Single Leg Squat")
    parser.add_argument(
        "--motion",
        default="squat",
        choices=("squat", "hinge", "flow", "bounce", "throw"),
        help="Project SeedMotion category.",
    )
    parser.add_argument(
        "--target-torso",
        type=float,
        default=0.55,
        help="Target pelvis-to-neck length in metres (default 0.55m).",
    )
    parser.add_argument(
        "--floor-offset",
        type=float,
        default=0.04,
        help="Lowest foot Y in metres after normalisation (default 0.04m).",
    )
    parser.add_argument("--smooth-passes", type=int, default=2)
    args = parser.parse_args()

    with np.load(args.input, allow_pickle=False) as npz:
        keypoints = np.asarray(npz["pred_keypoints_3d"], dtype=np.float32)  # (F, 70, 3)
        fps = int(npz["fps"]) if "fps" in npz.files else 15
    if keypoints.ndim != 3 or keypoints.shape[1] < 70:
        raise SystemExit(f"Unexpected pred_keypoints_3d shape: {keypoints.shape}")

    world_points = to_world(keypoints)
    world_points = smooth_along_time(world_points, passes=args.smooth_passes)
    joints = build_project_joints(world_points)
    joints, applied_scale, pelvis_mean = normalize_skeleton(
        joints,
        target_pelvis_to_neck_m=args.target_torso,
        floor_offset_m=args.floor_offset,
    )

    frames = build_clip_frames(joints)
    duration = round(len(frames) / fps, 3)

    clip = {
        "id": args.seed_id,
        "name": args.name,
        "fps": fps,
        "durationSeconds": duration,
        "frames": frames,
        "motion": args.motion,
        "capturedAt": 0,
        "thumbnails": build_thumbnails(len(frames)),
        "_meta": {
            "source": "sam-3d-body/mhr70",
            "appliedScale": round(applied_scale, 6),
            "pelvisXZMean": pelvis_mean.tolist(),
            "frameCount": len(frames),
            "format": "kinex.coach_clip.v1",
            "unit": "meters",
            "handedness": "right-hand",
        },
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(clip, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    size_kb = args.output.stat().st_size / 1024
    print(
        f"wrote {args.output} · {len(frames)} frames @ {fps}fps · "
        f"{duration:.2f}s · scale={applied_scale:.3f} · {size_kb:.1f} KB"
    )


if __name__ == "__main__":
    main()
