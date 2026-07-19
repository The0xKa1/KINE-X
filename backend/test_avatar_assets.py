"""Regression tests for reusable Avatar Vault binary assets."""
from __future__ import annotations

import json
import struct
import tempfile
import unittest
from pathlib import Path

import numpy as np

from backend.avatar_assets import (
    axis_angle_to_quaternion,
    pack_motion_jsons,
    split_legacy_asset,
)


JOINTS = 55


def _legacy_fixture(path: Path) -> bytes:
    """Write a tiny, valid KINEXGS1 asset and return its static section."""
    count, frames = 2, 2
    meta = {"name": "two-gaussian fixture", "fps": 30}
    header = json.dumps(meta, separators=(",", ":")).encode("utf-8")

    static_floats = np.arange(count * 23, dtype=np.float32) / 10
    lbs_index = np.array([0, 1, 2, 3, 4, 5, 6, 7], dtype=np.uint8)
    lbs_weight = np.tile(np.array([1, 0, 0, 0], dtype=np.float32), count)
    constrain = np.array([0, 1], dtype=np.uint8)
    static = b"".join(
        (static_floats.tobytes(), lbs_index.tobytes(), lbs_weight.tobytes(), constrain.tobytes())
    )
    matrices = np.tile(np.eye(4, dtype=np.float32), (frames, JOINTS, 1, 1))
    trans = np.array([[0, 0, 0], [1, 2, 3]], dtype=np.float32)
    path.write_bytes(
        b"KINEXGS1"
        + struct.pack("<4I", count, frames, JOINTS, len(header))
        + header
        + static
        + matrices.tobytes()
        + trans.tobytes()
    )
    return static


def _read_split(path: Path, magic: bytes) -> tuple[tuple[int, int], dict, bytes]:
    raw = path.read_bytes()
    if raw[:8] != magic:
        raise AssertionError(f"expected {magic!r}, got {raw[:8]!r}")
    first, joints, header_len = struct.unpack_from("<3I", raw, 8)
    start = 20
    meta = json.loads(raw[start : start + header_len])
    return (first, joints), meta, raw[start + header_len :]


class AvatarAssetCodecTests(unittest.TestCase):
    def test_split_legacy_asset_preserves_static_data_and_uses_local_identity_rotations(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "legacy.bin"
            expected_static = _legacy_fixture(source)
            identity_path = root / "identity.bin"
            motion_path = root / "motion.bin"
            joint_null = np.arange(JOINTS * 3, dtype=np.float32).reshape(JOINTS, 3) / 100
            parents = np.array([-1] + list(range(JOINTS - 1)), dtype=np.int16)

            identity_meta, motion_meta = split_legacy_asset(
                source, identity_path, motion_path, joint_null, parents
            )

            (count, joints), parsed_identity_meta, identity_payload = _read_split(
                identity_path, b"KINEXGI1"
            )
            self.assertEqual((count, joints), (2, JOINTS))
            self.assertEqual(parsed_identity_meta, identity_meta)
            self.assertEqual(identity_payload[: len(expected_static)], expected_static)
            np.testing.assert_array_equal(
                np.frombuffer(identity_payload[len(expected_static) : -JOINTS * 2], dtype="<f4"),
                joint_null.ravel(),
            )
            np.testing.assert_array_equal(
                np.frombuffer(identity_payload[-JOINTS * 2 :], dtype="<i2"), parents
            )

            (frames, motion_joints), parsed_motion_meta, motion_payload = _read_split(
                motion_path, b"KINEXGM1"
            )
            self.assertEqual((frames, motion_joints), (2, JOINTS))
            self.assertEqual(parsed_motion_meta, motion_meta)
            rotations = np.frombuffer(motion_payload[: frames * JOINTS * 4 * 4], dtype="<f4").reshape(
                frames, JOINTS, 4
            )
            np.testing.assert_allclose(
                rotations,
                np.broadcast_to(np.array([0, 0, 0, 1], dtype=np.float32), rotations.shape),
            )
            np.testing.assert_array_equal(
                np.frombuffer(motion_payload[frames * JOINTS * 4 * 4 :], dtype="<f4").reshape(frames, 3),
                [[0, 0, 0], [1, 2, 3]],
            )

    def test_split_legacy_asset_rejects_truncated_payload(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "legacy.bin"
            _legacy_fixture(source)
            source.write_bytes(source.read_bytes()[:-1])
            joint_null = np.zeros((JOINTS, 3), dtype=np.float32)
            parents = np.array([-1] + list(range(JOINTS - 1)), dtype=np.int16)

            with self.assertRaisesRegex(ValueError, "truncated"):
                split_legacy_asset(source, root / "identity.bin", root / "motion.bin", joint_null, parents)

    def test_pack_motion_jsons_converts_axis_angle_to_xyzw_and_records_stage_transform(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            frame_path = root / "frame-000.json"
            poses = np.zeros((JOINTS, 3), dtype=float)
            poses[1] = [0, 0, np.pi / 2]
            frame_path.write_text(json.dumps({"poses": poses.tolist(), "trans": [1, 2, 3]}))
            output = root / "motion.bin"
            transform = {"scale": 1.25, "R": [[1, 0, 0], [0, 1, 0], [0, 0, 1]], "t": [0, 1, 0]}

            meta = pack_motion_jsons([frame_path], output, fps=24, stage_transform=transform)

            (frames, joints), parsed_meta, payload = _read_split(output, b"KINEXGM1")
            self.assertEqual((frames, joints), (1, JOINTS))
            self.assertEqual(parsed_meta, meta)
            self.assertEqual(meta["fps"], 24)
            self.assertEqual(meta["stageTransform"], transform)
            rotations = np.frombuffer(payload[: JOINTS * 4 * 4], dtype="<f4").reshape(JOINTS, 4)
            np.testing.assert_allclose(rotations[0], [0, 0, 0, 1])
            np.testing.assert_allclose(rotations[1], [0, 0, np.sqrt(0.5), np.sqrt(0.5)], rtol=1e-6)
            np.testing.assert_allclose(np.frombuffer(payload[JOINTS * 4 * 4 :], dtype="<f4"), [1, 2, 3])

    def test_axis_angle_to_quaternion_returns_identity_for_zero_rotation(self) -> None:
        np.testing.assert_array_equal(
            axis_angle_to_quaternion(np.zeros(3, dtype=np.float32)), np.array([0, 0, 0, 1], dtype=np.float32)
        )


if __name__ == "__main__":
    unittest.main()
