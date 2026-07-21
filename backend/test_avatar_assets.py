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
    resample_motion_frames,
    split_legacy_asset,
    unpack_motion_asset,
    write_motion_asset,
)


JOINTS = 55


def _legacy_fixture(
    path: Path,
    *,
    meta: dict | None = None,
    matrices: np.ndarray | None = None,
    trans: np.ndarray | None = None,
) -> bytes:
    """Write a tiny, valid KINEXGS1 asset and return its static section."""
    count, frames = 2, 2
    meta = meta or {"name": "two-gaussian fixture", "fps": 30}
    header = json.dumps(meta, separators=(",", ":")).encode("utf-8")

    static_floats = np.arange(count * 23, dtype=np.float32) / 10
    lbs_index = np.array([0, 1, 2, 3, 4, 5, 6, 7], dtype=np.uint8)
    lbs_weight = np.tile(np.array([1, 0, 0, 0], dtype=np.float32), count)
    constrain = np.array([0, 1], dtype=np.uint8)
    static = b"".join(
        (static_floats.tobytes(), lbs_index.tobytes(), lbs_weight.tobytes(), constrain.tobytes())
    )
    matrices = matrices if matrices is not None else np.tile(np.eye(4, dtype=np.float32), (frames, JOINTS, 1, 1))
    trans = trans if trans is not None else np.array([[0, 0, 0], [1, 2, 3]], dtype=np.float32)
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
            self.assertEqual(
                motion_meta["stageTransform"],
                {"scale": 1, "R": [[1, 0, 0], [0, 1, 0], [0, 0, 1]], "t": [0, 0, 0]},
            )
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

    def test_split_legacy_asset_normalizes_alignment_and_derives_parent_relative_rotations(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "legacy.bin"
            parent_global = np.array(
                [[0, -1, 0], [1, 0, 0], [0, 0, 1]], dtype=np.float32
            )
            child_local = np.array(
                [[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=np.float32
            )
            stored_matrices = np.tile(np.eye(4, dtype=np.float32), (2, JOINTS, 1, 1))
            # Legacy matrices are column-major, so their Python view is transposed.
            stored_matrices[:, 0, :3, :3] = parent_global.T
            stored_matrices[:, 1, :3, :3] = (parent_global @ child_local).T
            stage_transform = {
                "scale": 1.25,
                "R": [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
                "t": [0.2, 1.1, -0.4],
            }
            _legacy_fixture(
                source,
                meta={"name": "aligned fixture", "fps": 30, **stage_transform},
                matrices=stored_matrices,
            )
            parents = np.array([-1] + list(range(JOINTS - 1)), dtype=np.int16)

            _, motion_meta = split_legacy_asset(
                source,
                root / "identity.bin",
                root / "motion.bin",
                np.zeros((JOINTS, 3), dtype=np.float32),
                parents,
            )

            self.assertEqual(motion_meta["stageTransform"], stage_transform)
            (_, _), _, payload = _read_split(root / "motion.bin", b"KINEXGM1")
            rotations = np.frombuffer(payload[: 2 * JOINTS * 4 * 4], dtype="<f4").reshape(2, JOINTS, 4)
            expected_parent = np.array([0, 0, np.sqrt(0.5), np.sqrt(0.5)], dtype=np.float32)
            expected_child = np.array([np.sqrt(0.5), 0, 0, np.sqrt(0.5)], dtype=np.float32)
            np.testing.assert_allclose(
                rotations[:, 0], np.broadcast_to(expected_parent, rotations[:, 0].shape), rtol=1e-6
            )
            np.testing.assert_allclose(
                rotations[:, 1], np.broadcast_to(expected_child, rotations[:, 1].shape), rtol=1e-6
            )

    def test_split_legacy_asset_unbakes_stage_similarity_exactly_once(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "aligned.bin"
            parent_global = np.array(
                [[0, -1, 0], [1, 0, 0], [0, 0, 1]], dtype=np.float32
            )
            child_local = np.array(
                [[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=np.float32
            )
            raw_matrices = np.tile(np.eye(4, dtype=np.float32), (2, JOINTS, 1, 1))
            raw_matrices[:, 0, :3, :3] = parent_global.T
            raw_matrices[:, 1, :3, :3] = (parent_global @ child_local).T
            raw_translations = np.array([[0.1, 0.2, 0.3], [1.0, 2.0, 3.0]], dtype=np.float32)
            stage_transform = {
                "scale": 1.6,
                "R": [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
                "t": [0.2, 1.1, -0.4],
            }
            similarity = stage_transform["scale"] * np.asarray(stage_transform["R"])
            bake_matrix = np.eye(4, dtype=np.float32)
            bake_matrix[:3, :3] = similarity.T
            aligned_matrices = raw_matrices @ bake_matrix
            aligned_translations = (
                similarity @ raw_translations.T + np.asarray(stage_transform["t"])[:, None]
            ).T.astype(np.float32)
            _legacy_fixture(
                source,
                meta={"name": "baked aligned fixture", "fps": 30, **stage_transform},
                matrices=aligned_matrices,
                trans=aligned_translations,
            )
            source_before = source.read_bytes()
            parents = np.array([-1] + list(range(JOINTS - 1)), dtype=np.int16)

            _, motion_meta = split_legacy_asset(
                source,
                root / "identity.bin",
                root / "motion.bin",
                np.zeros((JOINTS, 3), dtype=np.float32),
                parents,
                stage_transform_baked=True,
            )

            self.assertEqual(source.read_bytes(), source_before)
            self.assertEqual(motion_meta["stageTransform"], stage_transform)
            (frames, _), _, payload = _read_split(root / "motion.bin", b"KINEXGM1")
            rotations = np.frombuffer(
                payload[: frames * JOINTS * 4 * 4], dtype="<f4"
            ).reshape(frames, JOINTS, 4)
            np.testing.assert_allclose(np.linalg.norm(rotations, axis=-1), 1, atol=1e-6)
            np.testing.assert_allclose(
                rotations[:, 0],
                np.broadcast_to(
                    np.array([0, 0, np.sqrt(0.5), np.sqrt(0.5)], dtype=np.float32),
                    rotations[:, 0].shape,
                ),
                rtol=1e-6,
            )
            np.testing.assert_allclose(
                rotations[:, 1],
                np.broadcast_to(
                    np.array([np.sqrt(0.5), 0, 0, np.sqrt(0.5)], dtype=np.float32),
                    rotations[:, 1].shape,
                ),
                rtol=1e-6,
            )
            np.testing.assert_allclose(
                np.frombuffer(payload[frames * JOINTS * 4 * 4 :], dtype="<f4").reshape(frames, 3),
                raw_translations,
                atol=1e-6,
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

    def test_pack_motion_jsons_resamples_to_coach_frame_count(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            frame_paths = []
            poses = np.zeros((JOINTS, 3), dtype=float)
            poses[1] = [0, 0, np.pi / 2]
            for index, x in enumerate((0.0, 1.0, 2.0, 3.0)):
                path = root / f"frame-{index:03}.json"
                path.write_text(json.dumps({"poses": poses.tolist(), "trans": [x, 0, 0]}))
                frame_paths.append(path)
            output = root / "motion.bin"

            meta = pack_motion_jsons(
                frame_paths, output, fps=15, stage_transform={"scale": 1}, target_frames=2
            )

            self.assertEqual(meta["frames"], 2)
            (frames, joints), _, payload = _read_split(output, b"KINEXGM1")
            self.assertEqual((frames, joints), (2, JOINTS))
            trans = np.frombuffer(payload[2 * JOINTS * 4 * 4 :], dtype="<f4").reshape(2, 3)
            np.testing.assert_allclose(trans, [[0, 0, 0], [3, 0, 0]], rtol=1e-6)

    def test_resample_motion_frames_slerps_rotations_and_lerps_translations(self) -> None:
        rotations = np.zeros((2, JOINTS, 4), dtype=np.float32)
        rotations[:, :, 3] = 1.0
        half = np.sqrt(0.5)
        rotations[1, 0] = [0, 0, half, half]  # 90 degrees about z
        trans = np.array([[0, 0, 0], [2, 4, 6]], dtype=np.float32)

        resampled_rotations, resampled_trans = resample_motion_frames(rotations, trans, 3)

        self.assertEqual(resampled_rotations.shape, (3, JOINTS, 4))
        np.testing.assert_allclose(resampled_rotations[0, 0], [0, 0, 0, 1], atol=1e-6)
        np.testing.assert_allclose(
            resampled_rotations[1, 0],
            [0, 0, np.sin(np.pi / 8), np.cos(np.pi / 8)],
            atol=1e-6,
        )
        np.testing.assert_allclose(resampled_rotations[2, 0], [0, 0, half, half], atol=1e-6)
        np.testing.assert_allclose(resampled_trans, [[0, 0, 0], [1, 2, 3], [2, 4, 6]], atol=1e-6)

    def test_resample_motion_frames_aligns_quaternion_hemisphere(self) -> None:
        rotations = np.zeros((2, JOINTS, 4), dtype=np.float32)
        rotations[0, :, 3] = 1.0
        rotations[1, :, 3] = -1.0  # same rotation as identity, opposite hemisphere
        trans = np.zeros((2, 3), dtype=np.float32)

        resampled_rotations, _ = resample_motion_frames(rotations, trans, 3)

        np.testing.assert_allclose(np.abs(resampled_rotations[:, :, 3]), 1.0, atol=1e-6)

    def test_motion_asset_write_unpack_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output = root / "motion.bin"
            rotations = np.zeros((4, JOINTS, 4), dtype=np.float32)
            rotations[:, :, 3] = 1.0
            trans = np.arange(12, dtype=np.float32).reshape(4, 3)
            meta = {"fps": 15, "stageTransform": {"scale": 1.0, "t": [0, 1, 2]}}

            written = write_motion_asset(output, meta, rotations, trans)
            parsed_meta, parsed_rotations, parsed_trans = unpack_motion_asset(output)

            self.assertEqual(written["frames"], 4)
            self.assertEqual(parsed_meta, written)
            np.testing.assert_array_equal(parsed_rotations, rotations)
            np.testing.assert_array_equal(parsed_trans, trans)

            resampled_rotations, resampled_trans = resample_motion_frames(
                parsed_rotations, parsed_trans, 2
            )
            rewritten = write_motion_asset(output, parsed_meta, resampled_rotations, resampled_trans)
            reparsed_meta, _, reparsed_trans = unpack_motion_asset(output)
            self.assertEqual(rewritten["frames"], 2)
            self.assertEqual(reparsed_meta["frames"], 2)
            np.testing.assert_allclose(reparsed_trans, [trans[0], trans[3]], atol=1e-6)

    def test_axis_angle_to_quaternion_returns_identity_for_zero_rotation(self) -> None:
        np.testing.assert_array_equal(
            axis_angle_to_quaternion(np.zeros(3, dtype=np.float32)), np.array([0, 0, 0, 1], dtype=np.float32)
        )


if __name__ == "__main__":
    unittest.main()
