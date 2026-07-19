#!/usr/bin/env python3
"""Safely register the committed KINEXGS1 demo as reusable vault assets.

The legacy source is read-only input.  The migration writes a split KINEXGI1
identity, a KINEXGM1 motion, and their filesystem registry manifests.  Existing
compatible outputs are retained, so the command is safe to run repeatedly.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import struct
import sys
import tempfile
from pathlib import Path
from typing import Any

import numpy as np


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.avatar_assets import (  # noqa: E402
    IDENTITY_MAGIC,
    JOINT_COUNT,
    LEGACY_MAGIC,
    MOTION_MAGIC,
    split_legacy_asset,
)


SMPLX_55_PARENTS = (
    -1, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 12, 13, 14,
    16, 17, 18, 19, 15, 15, 15, 20, 25, 26, 20, 28, 29, 20, 31, 32,
    20, 34, 35, 20, 37, 38, 21, 40, 41, 21, 43, 44, 21, 46, 47, 21,
    49, 50, 21, 52, 53,
)
ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
JOINT_KEYS = ("joint_null", "joints_null", "joint_zero")
STATIC_FLOATS_PER_GAUSSIAN = 23


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Split a legacy KINEXGS1 demo into reusable Avatar Vault assets.",
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=REPO_ROOT / "public/coach_clips/gs_avatar_coach.bin",
        help="read-only KINEXGS1 source (default: committed demo)",
    )
    parser.add_argument(
        "--debug-npz",
        type=Path,
        help="LHM debug NPZ containing joint_null; auto-detected when omitted",
    )
    parser.add_argument(
        "--registry-root",
        type=Path,
        default=REPO_ROOT / "public/coach_clips",
        help="root containing avatar-identities/ and motions/",
    )
    parser.add_argument("--avatar-id", default="av-legacy-demo")
    parser.add_argument("--motion-id", default="motion-legacy-squat")
    parser.add_argument("--name", default="Legacy Coach")
    parser.add_argument(
        "--url-prefix",
        default="public/coach_clips",
        help="browser URL prefix written into manifests",
    )
    parser.add_argument("--preview", type=Path, help="optional JPG/PNG/WEBP preview to copy")
    parser.add_argument(
        "--replace",
        action="store_true",
        help="replace conflicting generated outputs; the legacy source is still protected",
    )
    parser.add_argument("--dry-run", action="store_true", help="validate without persistent writes")
    return parser.parse_args()


def require_id(value: str, prefix: str) -> str:
    if not value.startswith(prefix) or not ID_PATTERN.fullmatch(value):
        raise ValueError(f"identifier must start with {prefix!r} and contain only ASCII letters, digits, '_' or '-'")
    return value


def discover_debug_npz(source: Path, explicit: Path | None) -> Path:
    candidates: list[Path] = []
    if explicit is not None:
        candidates.append(explicit)
    env_value = os.environ.get("AVATAR_LEGACY_DEBUG_NPZ")
    if env_value:
        candidates.append(Path(env_value).expanduser())
    local_deploy_root = (
        REPO_ROOT.parent.parent if REPO_ROOT.parent.name == ".worktrees" else REPO_ROOT
    )
    candidates.extend(
        (
            source.with_name(f"{source.stem}_debug.npz"),
            source.with_suffix(".npz"),
            local_deploy_root / ".deploy-tmp/avatar-lab/avatar_squat_debug.npz",
            Path("/root/lhm_outputs/avatar_coach_debug.npz"),
            Path("/root/lhm_outputs/avatar_squat_debug.npz"),
        )
    )
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    checked = "\n  - ".join(str(path) for path in candidates)
    raise FileNotFoundError(
        "no compatible LHM debug NPZ was found; pass --debug-npz or set "
        f"AVATAR_LEGACY_DEBUG_NPZ. Checked:\n  - {checked}"
    )


def read_joint_null(path: Path) -> np.ndarray:
    with np.load(path, allow_pickle=False) as data:
        for key in JOINT_KEYS:
            if key in data.files:
                joints = np.asarray(data[key], dtype=np.float32)
                break
        else:
            raise ValueError(f"debug NPZ {path} is missing one of: {', '.join(JOINT_KEYS)}")
    if joints.shape != (JOINT_COUNT, 3) or not np.isfinite(joints).all():
        raise ValueError(f"debug NPZ joint positions must have shape ({JOINT_COUNT}, 3) and be finite")
    return joints


def same_path(first: Path, second: Path) -> bool:
    return first.resolve() == second.resolve()


def asset_counts(path: Path, magic: bytes) -> tuple[int, int]:
    raw = path.read_bytes()[:20]
    if len(raw) != 20 or raw[:8] != magic:
        raise ValueError(f"generated asset {path} does not start with {magic.decode()}")
    first, joints, _ = struct.unpack_from("<3I", raw, 8)
    return first, joints


def rotation_like(matrices: np.ndarray) -> bool:
    products = matrices @ np.swapaxes(matrices, -1, -2)
    determinants = np.linalg.det(matrices)
    return bool(
        np.allclose(products, np.eye(3), atol=1e-4)
        and np.allclose(determinants, 1, atol=1e-4)
    )


def prepare_split_source(source: Path, scratch: Path) -> tuple[Path, bool]:
    """Return a split-compatible source without modifying the legacy asset.

    ``backend/alignment.py`` baked the stage similarity into the committed
    KINEXGS1 matrices and translations while also recording it in metadata.
    Reusable assets apply that metadata at runtime, so this scratch copy removes
    the bake exactly once before ``split_legacy_asset`` derives local rotations.
    Older unbaked KINEXGS1 inputs pass through unchanged.
    """
    raw = source.read_bytes()
    if len(raw) < 24 or raw[:8] != LEGACY_MAGIC:
        raise ValueError(f"invalid or truncated {LEGACY_MAGIC.decode()} source")
    count, frames, joints, header_length = struct.unpack_from("<4I", raw, 8)
    header_end = 24 + header_length
    try:
        metadata = json.loads(raw[24:header_end].decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid legacy metadata: {exc}") from exc
    static_length = (
        count * STATIC_FLOATS_PER_GAUSSIAN * 4
        + count * 4
        + count * 4 * 4
        + count
    )
    matrix_offset = header_end + static_length
    matrix_length = frames * joints * 16 * 4
    expected_length = matrix_offset + matrix_length + frames * 3 * 4
    if len(raw) != expected_length:
        raise ValueError("legacy payload length does not match its header")
    matrices = np.frombuffer(
        raw, dtype="<f4", count=frames * joints * 16, offset=matrix_offset
    ).reshape(frames, joints, 4, 4)
    global_linear = matrices[:, :, :3, :3].transpose(0, 1, 3, 2)
    if rotation_like(global_linear):
        return source, False

    scale = metadata.get("scale")
    stage_rotation = np.asarray(metadata.get("R"), dtype=np.float64)
    stage_translation = np.asarray(metadata.get("t"), dtype=np.float64)
    if (
        not isinstance(scale, (int, float))
        or not np.isfinite(float(scale))
        or float(scale) <= 0
        or stage_rotation.shape != (3, 3)
        or stage_translation.shape != (3,)
        or not np.isfinite(stage_rotation).all()
        or not np.isfinite(stage_translation).all()
        or not rotation_like(stage_rotation[None, None, :, :])
    ):
        raise ValueError(
            "legacy joint matrices are not rotations and metadata lacks a valid baked stage transform"
        )

    similarity = float(scale) * stage_rotation
    inverse_similarity = np.linalg.inv(similarity)
    unbaked = matrices.astype(np.float64, copy=True)
    bake_matrix = np.eye(4, dtype=np.float64)
    bake_matrix[:3, :3] = similarity.T
    unbaked = unbaked @ np.linalg.inv(bake_matrix)
    unbaked_global = unbaked[:, :, :3, :3].transpose(0, 1, 3, 2)
    if not rotation_like(unbaked_global):
        raise ValueError("failed to remove the baked stage similarity from legacy rotations")

    translations = np.frombuffer(
        raw,
        dtype="<f4",
        count=frames * 3,
        offset=matrix_offset + matrix_length,
    ).reshape(frames, 3)
    unbaked_translations = (
        inverse_similarity @ (translations.astype(np.float64) - stage_translation).T
    ).T
    normalized = scratch / "legacy-unbaked.bin"
    normalized.write_bytes(
        raw[:matrix_offset]
        + unbaked.astype("<f4").tobytes()
        + unbaked_translations.astype("<f4").tobytes()
    )
    return normalized, True


def atomic_publish_bytes(source: Path, target: Path, *, replace: bool) -> str:
    existed = target.exists()
    if target.is_symlink():
        raise ValueError(f"refusing to publish through symlink output: {target}")
    payload = source.read_bytes()
    if target.exists():
        if not target.is_file():
            raise ValueError(f"output exists but is not a regular file: {target}")
        if target.read_bytes() == payload:
            return "unchanged"
        if not replace:
            raise FileExistsError(f"generated output differs: {target}; inspect it or rerun with --replace")
    target.parent.mkdir(parents=True, exist_ok=True)
    temp_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile("wb", dir=target.parent, prefix=f".{target.name}.", delete=False) as handle:
            temp_name = handle.name
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        Path(temp_name).replace(target)
        temp_name = None
    finally:
        if temp_name:
            Path(temp_name).unlink(missing_ok=True)
    return "replaced" if existed else "created"


def compatible_manifest(existing: Any, expected: dict[str, Any], immutable: tuple[str, ...]) -> bool:
    return isinstance(existing, dict) and all(existing.get(key) == expected.get(key) for key in immutable)


def publish_manifest(
    target: Path,
    expected: dict[str, Any],
    *,
    immutable: tuple[str, ...],
    replace: bool,
) -> str:
    existed = target.exists()
    if target.is_symlink():
        raise ValueError(f"refusing to publish through symlink manifest: {target}")
    if target.exists():
        try:
            existing = json.loads(target.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            if not replace:
                raise ValueError(f"existing manifest is invalid: {target}: {exc}") from exc
        else:
            if compatible_manifest(existing, expected, immutable):
                return "unchanged"
            if not replace:
                raise FileExistsError(f"existing manifest conflicts: {target}; inspect it or rerun with --replace")
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(expected, separators=(",", ":"), allow_nan=False).encode("utf-8")
    with tempfile.NamedTemporaryFile("wb", dir=target.parent, prefix=f".{target.name}.", delete=False) as handle:
        temp = Path(handle.name)
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())
    try:
        temp.replace(target)
    finally:
        temp.unlink(missing_ok=True)
    return "replaced" if existed else "created"


def migrate(args: argparse.Namespace) -> None:
    source = args.source.expanduser().resolve()
    registry_root = args.registry_root.expanduser().resolve()
    avatar_id = require_id(args.avatar_id, "av-")
    motion_id = require_id(args.motion_id, "motion-")
    if not source.is_file():
        raise FileNotFoundError(source)
    if source.read_bytes()[:8] != LEGACY_MAGIC:
        raise ValueError(f"legacy source must start with {LEGACY_MAGIC.decode()}: {source}")

    debug_npz = discover_debug_npz(source, args.debug_npz)
    joint_null = read_joint_null(debug_npz)
    identity_path = registry_root / "avatar-identities" / avatar_id / "identity.bin"
    motion_path = registry_root / "motions" / motion_id / "motion.bin"
    for output in (identity_path, motion_path):
        if same_path(source, output):
            raise ValueError(f"refusing to use the legacy source as a generated output: {output}")

    with tempfile.TemporaryDirectory(prefix="kinex-legacy-migration-") as tmp:
        scratch = Path(tmp)
        split_identity = scratch / "identity.bin"
        split_motion = scratch / "motion.bin"
        split_source, unbaked_stage = prepare_split_source(source, scratch)
        identity_meta, motion_meta = split_legacy_asset(
            split_source,
            split_identity,
            split_motion,
            joint_null,
            SMPLX_55_PARENTS,
        )
        gaussian_count, identity_joints = asset_counts(split_identity, IDENTITY_MAGIC)
        frame_count, motion_joints = asset_counts(split_motion, MOTION_MAGIC)

        timestamp = source.stat().st_mtime
        prefix = args.url_prefix.strip("/")
        identity_url = f"{prefix}/avatar-identities/{avatar_id}/identity.bin"
        motion_url = f"{prefix}/motions/{motion_id}/motion.bin"
        identity_record: dict[str, Any] = {
            "avatarId": avatar_id,
            "name": args.name.strip() or "Legacy Coach",
            "status": "ready",
            "progress": 100,
            "createdAt": timestamp,
            "finishedAt": timestamp,
            "identityUrl": identity_url,
            "format": IDENTITY_MAGIC.decode(),
            "gaussianCount": gaussian_count,
            "jointCount": identity_joints,
            "migration": "legacy-split",
        }
        motion_record: dict[str, Any] = {
            "motionId": motion_id,
            "name": "Legacy Squat",
            "status": "ready",
            "progress": 100,
            "createdAt": timestamp,
            "finishedAt": timestamp,
            "motionAssetUrl": motion_url,
            "format": MOTION_MAGIC.decode(),
            "frameCount": frame_count,
            "jointCount": motion_joints,
            "fps": motion_meta.get("fps", identity_meta.get("fps", 30)),
            "stageTransform": motion_meta["stageTransform"],
            "coachClipUrl": "public/coach_clips/ugc_squat.json",
            "meshClipMetaUrl": "public/coach_clips/ugc_squat.mesh.meta.json",
            "migration": "legacy-split",
        }

        preview_source = args.preview.expanduser().resolve() if args.preview else None
        preview_target: Path | None = None
        if preview_source is not None:
            if not preview_source.is_file() or preview_source.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
                raise ValueError("--preview must be an existing JPG, PNG, or WEBP file")
            suffix = ".jpg" if preview_source.suffix.lower() == ".jpeg" else preview_source.suffix.lower()
            preview_target = identity_path.parent / f"preview{suffix}"
            if same_path(source, preview_target):
                raise ValueError("refusing to use the legacy source as preview output")
            identity_record["previewUrl"] = f"{prefix}/avatar-identities/{avatar_id}/{preview_target.name}"

        print(f"source: {source} ({LEGACY_MAGIC.decode()}, preserved)")
        print(f"debug NPZ: {debug_npz}")
        if unbaked_stage:
            print("stage transform: removed from scratch matrices/translations; source remains unchanged")
        print(f"identity: {gaussian_count} gaussians, {identity_joints} joints -> {identity_path}")
        print(f"motion: {frame_count} frames, {motion_joints} joints -> {motion_path}")
        if args.dry_run:
            print("DRY RUN: validation passed; no registry files written")
            return

        results = [
            (identity_path, atomic_publish_bytes(split_identity, identity_path, replace=args.replace)),
            (motion_path, atomic_publish_bytes(split_motion, motion_path, replace=args.replace)),
        ]
        if preview_source is not None and preview_target is not None:
            staged_preview = scratch / preview_target.name
            shutil.copyfile(preview_source, staged_preview)
            results.append((preview_target, atomic_publish_bytes(staged_preview, preview_target, replace=args.replace)))
        results.extend(
            (
                (
                    identity_path.parent / "record.json",
                    publish_manifest(
                        identity_path.parent / "record.json",
                        identity_record,
                        immutable=("avatarId", "identityUrl", "format", "gaussianCount", "jointCount", "migration"),
                        replace=args.replace,
                    ),
                ),
                (
                    motion_path.parent / "record.json",
                    publish_manifest(
                        motion_path.parent / "record.json",
                        motion_record,
                        immutable=("motionId", "motionAssetUrl", "format", "frameCount", "jointCount", "migration"),
                        replace=args.replace,
                    ),
                ),
            )
        )
        for path, status in results:
            print(f"{status}: {path}")


def main() -> int:
    try:
        migrate(parse_args())
    except (FileNotFoundError, FileExistsError, OSError, ValueError) as exc:
        print(f"migration failed: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
