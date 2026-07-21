"""Validated, atomically-written codecs for reusable KINE//X avatar assets."""
from __future__ import annotations

import json
import math
import os
import struct
import tempfile
from pathlib import Path
from typing import Any, Iterable

import numpy as np


LEGACY_MAGIC = b"KINEXGS1"
IDENTITY_MAGIC = b"KINEXGI1"
MOTION_MAGIC = b"KINEXGM1"
JOINT_COUNT = 55
MAX_GAUSSIANS = 65536
_STATIC_FLOATS_PER_GAUSSIAN = 23


def axis_angle_to_quaternion(rotvec: Any) -> np.ndarray:
    """Convert one axis-angle vector to a normalized xyzw Quaternion."""
    vector = np.asarray(rotvec, dtype=np.float64)
    if vector.shape != (3,) or not np.isfinite(vector).all():
        raise ValueError("axis-angle rotation must contain exactly three finite floats")
    angle = float(np.linalg.norm(vector))
    if angle < 1e-12:
        return np.array([0, 0, 0, 1], dtype=np.float32)
    result = np.empty(4, dtype=np.float64)
    result[:3] = vector * (math.sin(angle / 2) / angle)
    result[3] = math.cos(angle / 2)
    return _normalise_quaternion(result)


def split_legacy_asset(
    source: str | Path,
    identity_path: str | Path,
    motion_path: str | Path,
    joint_null: Any,
    parents: Any,
    *,
    stage_transform_baked: bool = False,
) -> tuple[dict, dict]:
    """Split a legacy KINEXGS1 asset into static identity and local motion files.

    alignment.py writes the stage similarity into legacy joint matrices and
    root translations.  Reusable motion stores that similarity separately, so
    callers that own an aligned asset must opt in to removing the bake before
    local rotations are derived.
    """
    raw = Path(source).read_bytes()
    count, frames, meta, static, matrices, trans = _read_legacy(raw)
    joints = JOINT_COUNT
    rest_joints = _float_array(joint_null, (joints, 3), "joint_null")
    parent_array = _parent_array(parents)

    stage_transform = _legacy_stage_transform(meta)
    global_rotations = matrices[:, :, :3, :3].transpose(0, 1, 3, 2)
    if stage_transform_baked:
        global_rotations, trans = _unbake_stage_similarity(
            global_rotations, trans, stage_transform
        )
    _validate_rotation_matrices(global_rotations)
    local_rotations = np.empty((frames, joints, 4), dtype=np.float32)
    for frame in range(frames):
        for joint in range(joints):
            parent = int(parent_array[joint])
            local = global_rotations[frame, joint]
            if parent >= 0:
                local = global_rotations[frame, parent].T @ local
            local_rotations[frame, joint] = _matrix_to_quaternion(local)
    _validate_quaternions(local_rotations)

    identity_meta = dict(meta)
    identity_meta.update({"format": IDENTITY_MAGIC.decode(), "jointCount": joints})
    motion_meta = dict(meta)
    motion_meta.update(
        {"format": MOTION_MAGIC.decode(), "jointCount": joints, "frames": frames}
    )
    motion_meta["stageTransform"] = stage_transform

    identity_payload = static + rest_joints.astype("<f4", copy=False).tobytes() + parent_array.astype("<i2", copy=False).tobytes()
    motion_payload = local_rotations.astype("<f4", copy=False).tobytes() + trans.astype("<f4", copy=False).tobytes()
    _write_asset(identity_path, IDENTITY_MAGIC, (count, joints), identity_meta, identity_payload)
    _write_asset(motion_path, MOTION_MAGIC, (frames, joints), motion_meta, motion_payload)
    return identity_meta, motion_meta


def resample_motion_frames(
    rotations: Any,
    translations: Any,
    target_count: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Time-linearly resample a quaternion motion to ``target_count`` frames.

    Rotations are (frames, joints, 4) xyzw quaternions interpolated with slerp
    (hemisphere-aligned, nlerp fallback for nearly identical keys); root
    translations are (frames, 3) and interpolated linearly.  Source and target
    sequences share the same normalized time span [0, 1].
    """
    quats = np.asarray(rotations, dtype=np.float64)
    trans = np.asarray(translations, dtype=np.float64)
    if quats.ndim != 3 or quats.shape[2] != 4 or quats.shape[0] < 1:
        raise ValueError("rotations must have shape (frames, joints, 4)")
    if trans.shape != (quats.shape[0], 3):
        raise ValueError("translations must have shape (frames, 3)")
    if isinstance(target_count, bool) or not isinstance(target_count, int) or target_count < 1:
        raise ValueError("target_count must be a positive integer")
    _require_finite(quats, "rotations")
    _require_finite(trans, "translations")
    source_count = quats.shape[0]
    if source_count == target_count:
        return (
            quats.astype(np.float32),
            trans.astype(np.float32),
        )
    if source_count == 1:
        return (
            np.repeat(quats.astype(np.float32), target_count, axis=0),
            np.repeat(trans.astype(np.float32), target_count, axis=0),
        )

    position = np.linspace(0.0, source_count - 1.0, target_count)
    lower = np.minimum(position.astype(np.int64), source_count - 2)
    upper = lower + 1
    alpha = (position - lower).astype(np.float64)[:, None, None]

    q0 = quats[lower]
    q1 = quats[upper]
    dots = np.sum(q0 * q1, axis=-1, keepdims=True)
    q1 = np.where(dots < 0.0, -q1, q1)
    dots = np.abs(dots)
    # Slerp, falling back to normalized lerp when the keys nearly coincide.
    small = dots > 1.0 - 1e-9
    safe_dots = np.clip(np.where(small, 0.0, dots), -1.0, 1.0)
    omega = np.arccos(safe_dots)
    sin_omega = np.sin(omega)
    weight0 = np.where(small, 1.0 - alpha, np.sin((1.0 - alpha) * omega) / sin_omega)
    weight1 = np.where(small, alpha, np.sin(alpha * omega) / sin_omega)
    blended = weight0 * q0 + weight1 * q1
    norms = np.linalg.norm(blended, axis=-1, keepdims=True)
    if not np.all(norms > 1e-12):
        raise ValueError("quaternion interpolation produced a degenerate result")
    resampled_rotations = (blended / norms).astype(np.float32)
    alpha_trans = alpha[:, :, 0]
    resampled_trans = (
        (1.0 - alpha_trans) * trans[lower] + alpha_trans * trans[upper]
    ).astype(np.float32)
    return resampled_rotations, resampled_trans


def write_motion_asset(
    output_path: str | Path,
    meta: dict,
    rotations: Any,
    translations: Any,
) -> dict:
    """Atomically write a KINEXGM1 motion file from xyzw quaternion arrays."""
    quats = np.asarray(rotations, dtype=np.float32)
    trans = np.asarray(translations, dtype=np.float32)
    if quats.ndim != 3 or quats.shape[0] < 1 or quats.shape[1] != JOINT_COUNT or quats.shape[2] != 4:
        raise ValueError(f"rotations must have shape (frames, {JOINT_COUNT}, 4)")
    if trans.shape != (quats.shape[0], 3):
        raise ValueError("translations must have shape (frames, 3)")
    _validate_quaternions(quats)
    _require_finite(trans, "translations")
    if not isinstance(meta, dict):
        raise ValueError("meta must be a JSON object")
    merged = dict(meta)
    merged.update(
        {
            "format": MOTION_MAGIC.decode(),
            "frames": int(quats.shape[0]),
            "jointCount": JOINT_COUNT,
        }
    )
    payload = quats.astype("<f4", copy=False).tobytes() + trans.astype("<f4", copy=False).tobytes()
    _write_asset(output_path, MOTION_MAGIC, (int(quats.shape[0]), JOINT_COUNT), merged, payload)
    return merged


def unpack_motion_asset(source: str | Path) -> tuple[dict, np.ndarray, np.ndarray]:
    """Read a KINEXGM1 motion file into (metadata, xyzw rotations, translations)."""
    raw = Path(source).read_bytes()
    if len(raw) < 20:
        raise ValueError("truncated KINEXGM1 header")
    if raw[:8] != MOTION_MAGIC:
        raise ValueError("invalid KINEXGM1 magic")
    frames, joints, header_length = struct.unpack_from("<3I", raw, 8)
    if frames < 1:
        raise ValueError("motion frame count must be at least one")
    if joints != JOINT_COUNT:
        raise ValueError(f"joint count must be exactly {JOINT_COUNT}")
    header_end = 20 + header_length
    if len(raw) < header_end:
        raise ValueError("truncated KINEXGM1 metadata")
    meta = _json_object(raw[20:header_end], "KINEXGM1 metadata")
    rotation_length = frames * joints * 4 * 4
    trans_length = frames * 3 * 4
    expected_length = header_end + rotation_length + trans_length
    if len(raw) != expected_length:
        raise ValueError("unexpected KINEXGM1 payload length")
    rotations = np.frombuffer(raw, dtype="<f4", count=frames * joints * 4, offset=header_end).reshape(frames, joints, 4)
    trans = np.frombuffer(raw, dtype="<f4", count=frames * 3, offset=header_end + rotation_length).reshape(frames, 3)
    _require_finite(rotations, "motion local rotations")
    _require_finite(trans, "motion translations")
    return meta, rotations.copy(), trans.copy()


def pack_motion_jsons(
    paths: Iterable[str | Path],
    output_path: str | Path,
    *,
    fps: float,
    stage_transform: dict,
    target_frames: int | None = None,
) -> dict:
    """Pack LHM per-frame axis-angle JSON into a reusable KINEXGM1 motion file.

    When ``target_frames`` is given (the CoachClip frame count), the packed
    sequence is time-linearly resampled to that length so the asset duration
    matches the clip it was extracted from.
    """
    frame_paths = [Path(path) for path in paths]
    if not frame_paths:
        raise ValueError("motion requires at least one frame JSON")
    if not isinstance(fps, (int, float)) or not math.isfinite(float(fps)) or float(fps) <= 0:
        raise ValueError("fps must be a positive finite number")
    if not isinstance(stage_transform, dict):
        raise ValueError("stage_transform must be a JSON object")
    _validate_json_floats(stage_transform, "stage_transform")

    rotations: list[np.ndarray] = []
    translations: list[np.ndarray] = []
    for path in frame_paths:
        try:
            frame = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(f"invalid motion JSON {path}: {exc}") from exc
        if not isinstance(frame, dict):
            raise ValueError(f"motion JSON {path} must contain an object")
        axis_angles = _extract_axis_angles(frame, path)
        rotations.append(np.stack([axis_angle_to_quaternion(value) for value in axis_angles]))
        translations.append(_extract_translation(frame, path))

    local_rotations = np.stack(rotations).astype(np.float32, copy=False)
    trans = np.stack(translations).astype(np.float32, copy=False)
    if target_frames is not None:
        local_rotations, trans = resample_motion_frames(local_rotations, trans, target_frames)
    _validate_quaternions(local_rotations)
    _require_finite(trans, "translations")
    frame_count = int(local_rotations.shape[0])
    meta = {
        "format": MOTION_MAGIC.decode(),
        "frames": frame_count,
        "jointCount": JOINT_COUNT,
        "fps": fps,
        "stageTransform": stage_transform,
    }
    payload = local_rotations.astype("<f4", copy=False).tobytes() + trans.astype("<f4", copy=False).tobytes()
    _write_asset(output_path, MOTION_MAGIC, (frame_count, JOINT_COUNT), meta, payload)
    return meta


def _read_legacy(raw: bytes) -> tuple[int, int, dict, bytes, np.ndarray, np.ndarray]:
    if len(raw) < 24:
        raise ValueError("truncated KINEXGS1 header")
    if raw[:8] != LEGACY_MAGIC:
        raise ValueError("invalid KINEXGS1 magic")
    count, frames, joints, header_length = struct.unpack_from("<4I", raw, 8)
    _validate_counts(count, frames, joints)
    header_end = 24 + header_length
    if len(raw) < header_end:
        raise ValueError("truncated KINEXGS1 metadata")
    meta = _json_object(raw[24:header_end], "KINEXGS1 metadata")
    static_length = count * _STATIC_FLOATS_PER_GAUSSIAN * 4 + count * 4 + count * 4 * 4 + count
    matrix_length = frames * joints * 16 * 4
    trans_length = frames * 3 * 4
    expected_length = header_end + static_length + matrix_length + trans_length
    if len(raw) < expected_length:
        raise ValueError("truncated KINEXGS1 payload")
    if len(raw) != expected_length:
        raise ValueError("unexpected KINEXGS1 payload length")
    static_end = header_end + static_length
    static = raw[header_end:static_end]
    _require_finite(np.frombuffer(static, dtype="<f4", count=count * _STATIC_FLOATS_PER_GAUSSIAN), "static gaussian floats")
    lbs_start = count * _STATIC_FLOATS_PER_GAUSSIAN * 4
    lbs_indices = np.frombuffer(static, dtype=np.uint8, count=count * 4, offset=lbs_start)
    if np.any(lbs_indices >= joints):
        raise ValueError("LBS joint index is outside the joint hierarchy")
    weights_start = lbs_start + count * 4
    _require_finite(np.frombuffer(static, dtype="<f4", count=count * 4, offset=weights_start), "LBS weights")
    constrain = np.frombuffer(static, dtype=np.uint8, count=count, offset=weights_start + count * 4 * 4)
    if np.any(constrain > 1):
        raise ValueError("constrain values must be 0 or 1")
    matrices = np.frombuffer(raw, dtype="<f4", count=frames * joints * 16, offset=static_end).reshape(frames, joints, 4, 4)
    trans = np.frombuffer(raw, dtype="<f4", count=frames * 3, offset=static_end + matrix_length).reshape(frames, 3)
    _require_finite(matrices, "posed joint matrices")
    _require_finite(trans, "root translations")
    return count, frames, meta, static, matrices, trans


def _write_asset(
    output_path: str | Path,
    magic: bytes,
    counts: tuple[int, int],
    meta: dict,
    payload: bytes,
) -> None:
    first, joints = counts
    if len(magic) != 8:
        raise ValueError("asset magic must be exactly eight bytes")
    if first < 1 or joints != JOINT_COUNT:
        raise ValueError("invalid asset counts")
    _validate_json_floats(meta, "metadata")
    try:
        header = json.dumps(meta, separators=(",", ":"), allow_nan=False).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise ValueError(f"metadata must be JSON serializable: {exc}") from exc
    target = Path(output_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temp_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile("wb", dir=target.parent, prefix=f".{target.name}.", delete=False) as handle:
            temp_name = handle.name
            handle.write(magic)
            handle.write(struct.pack("<3I", first, joints, len(header)))
            handle.write(header)
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        Path(temp_name).replace(target)
    except Exception:
        if temp_name:
            Path(temp_name).unlink(missing_ok=True)
        raise


def _validate_counts(count: int, frames: int, joints: int) -> None:
    if not 1 <= count <= MAX_GAUSSIANS:
        raise ValueError(f"gaussian count must be between 1 and {MAX_GAUSSIANS}")
    if frames < 1:
        raise ValueError("frame count must be at least one")
    if joints != JOINT_COUNT:
        raise ValueError(f"joint count must be exactly {JOINT_COUNT}")


def _float_array(value: Any, shape: tuple[int, ...], name: str) -> np.ndarray:
    result = np.asarray(value, dtype=np.float32)
    if result.shape != shape:
        raise ValueError(f"{name} must have shape {shape}")
    _require_finite(result, name)
    return result


def _parent_array(value: Any) -> np.ndarray:
    raw = np.asarray(value)
    if raw.shape != (JOINT_COUNT,):
        raise ValueError(f"parents must have shape ({JOINT_COUNT},)")
    if not np.issubdtype(raw.dtype, np.integer):
        raise ValueError("parents must contain integer indices")
    parents = raw.astype(np.int16, copy=False)
    for joint, parent in enumerate(parents):
        if parent < -1 or parent >= JOINT_COUNT or parent == joint:
            raise ValueError("invalid parent index")
    for joint in range(JOINT_COUNT):
        seen: set[int] = set()
        parent = int(parents[joint])
        while parent >= 0:
            if parent in seen:
                raise ValueError("parent hierarchy contains a cycle")
            seen.add(parent)
            parent = int(parents[parent])
    return parents


def _extract_axis_angles(frame: dict, path: Path) -> np.ndarray:
    direct_keys = ("poses", "pose", "axis_angle", "rotvec", "full_pose")
    for key in direct_keys:
        if key in frame:
            return _float_array(frame[key], (JOINT_COUNT, 3), f"{path}:{key}")
    smplx_keys = (
        "global_orient",
        "body_pose",
        "left_hand_pose",
        "right_hand_pose",
        "jaw_pose",
        "leye_pose",
        "reye_pose",
    )
    if all(key in frame for key in smplx_keys):
        joined = np.concatenate([np.asarray(frame[key], dtype=np.float32).reshape(-1) for key in smplx_keys])
        return _float_array(joined, (JOINT_COUNT, 3), f"{path}:SMPL-X poses")
    raise ValueError(f"motion JSON {path} is missing 55 local axis-angle rotations")


def _legacy_stage_transform(meta: dict) -> dict:
    """Normalize alignment.py's legacy top-level transform into motion metadata."""
    existing = meta.get("stageTransform")
    stage_transform = dict(existing) if isinstance(existing, dict) else {}
    stage_transform["scale"] = meta.get("scale", stage_transform.get("scale", 1))
    stage_transform["R"] = meta.get(
        "R", stage_transform.get("R", [[1, 0, 0], [0, 1, 0], [0, 0, 1]])
    )
    stage_transform["t"] = meta.get("t", stage_transform.get("t", [0, 0, 0]))
    _validate_json_floats(stage_transform, "legacy stage transform")
    return stage_transform


def _unbake_stage_similarity(
    global_rotations: np.ndarray,
    translations: np.ndarray,
    stage_transform: dict,
) -> tuple[np.ndarray, np.ndarray]:
    """Remove alignment.py's stage bake while keeping metadata authoritative."""
    scale = stage_transform.get("scale")
    if (
        isinstance(scale, bool)
        or not isinstance(scale, (int, float))
        or not math.isfinite(float(scale))
        or float(scale) <= 0
    ):
        raise ValueError("legacy stage transform scale must be a positive finite number")
    stage_rotation = _float_array(stage_transform.get("R"), (3, 3), "legacy stage transform R")
    stage_translation = _float_array(stage_transform.get("t"), (3,), "legacy stage transform t")
    _validate_rotation_matrices(stage_rotation[None, None, :, :])

    inverse_similarity = np.linalg.inv(float(scale) * stage_rotation.astype(np.float64))
    unbaked_rotations = inverse_similarity @ global_rotations.astype(np.float64)
    unbaked_translations = (
        inverse_similarity
        @ (translations.astype(np.float64) - stage_translation.astype(np.float64)).T
    ).T
    return unbaked_rotations, unbaked_translations


def _extract_translation(frame: dict, path: Path) -> np.ndarray:
    for key in ("trans", "transl", "translation"):
        if key in frame:
            return _float_array(frame[key], (3,), f"{path}:{key}")
    raise ValueError(f"motion JSON {path} is missing root translation")


def _matrix_to_quaternion(matrix: np.ndarray) -> np.ndarray:
    m = matrix.astype(np.float64, copy=False)
    trace = float(np.trace(m))
    if trace > 0:
        scale = math.sqrt(trace + 1.0) * 2
        quaternion = np.array([(m[2, 1] - m[1, 2]) / scale, (m[0, 2] - m[2, 0]) / scale, (m[1, 0] - m[0, 1]) / scale, 0.25 * scale])
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        scale = math.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        quaternion = np.array([0.25 * scale, (m[0, 1] + m[1, 0]) / scale, (m[0, 2] + m[2, 0]) / scale, (m[2, 1] - m[1, 2]) / scale])
    elif m[1, 1] > m[2, 2]:
        scale = math.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        quaternion = np.array([(m[0, 1] + m[1, 0]) / scale, 0.25 * scale, (m[1, 2] + m[2, 1]) / scale, (m[0, 2] - m[2, 0]) / scale])
    else:
        scale = math.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        quaternion = np.array([(m[0, 2] + m[2, 0]) / scale, (m[1, 2] + m[2, 1]) / scale, 0.25 * scale, (m[1, 0] - m[0, 1]) / scale])
    return _normalise_quaternion(quaternion)


def _normalise_quaternion(quaternion: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(quaternion))
    if not math.isfinite(norm) or norm < 1e-8:
        raise ValueError("quaternion must have a non-zero finite norm")
    return (quaternion / norm).astype(np.float32)


def _validate_rotation_matrices(matrices: np.ndarray) -> None:
    identity = np.eye(3)
    products = matrices @ np.swapaxes(matrices, -1, -2)
    determinants = np.linalg.det(matrices)
    if not np.allclose(products, identity, atol=1e-4) or not np.allclose(determinants, 1, atol=1e-4):
        raise ValueError("posed joint rotations must be orthonormal")


def _validate_quaternions(quaternions: np.ndarray) -> None:
    _require_finite(quaternions, "quaternions")
    norms = np.linalg.norm(quaternions, axis=-1)
    if not np.allclose(norms, 1, atol=1e-5):
        raise ValueError("quaternions must be normalized")


def _require_finite(values: np.ndarray, name: str) -> None:
    if not np.isfinite(values).all():
        raise ValueError(f"{name} must contain only finite floats")


def _json_object(raw: bytes, name: str) -> dict:
    try:
        result = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid {name}: {exc}") from exc
    if not isinstance(result, dict):
        raise ValueError(f"{name} must be a JSON object")
    return result


def _validate_json_floats(value: Any, name: str) -> None:
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f"{name} must contain finite floats")
    if isinstance(value, dict):
        for child in value.values():
            _validate_json_floats(child, name)
    elif isinstance(value, (list, tuple)):
        for child in value:
            _validate_json_floats(child, name)
