"""HTTP and pipeline regression tests for server-backed avatar identities."""
from __future__ import annotations

import asyncio
import tempfile
import threading
import time
import types
import unittest
from contextlib import asynccontextmanager
from pathlib import Path
from unittest import mock
from urllib.parse import parse_qs, urlsplit
import sys

import numpy as np
from fastapi.testclient import TestClient

pipeline_stub = types.ModuleType("backend.pipeline")
pipeline_stub.safe_name = lambda value: str(value).strip().replace("/", "-")
pipeline_stub.run_pipeline = lambda **_kwargs: {}
with mock.patch.dict(sys.modules, {"backend.pipeline": pipeline_stub}):
    from backend import app as app_module
    from backend import avatar
from backend.avatar_registry import AvatarRegistry


EXPECTED_SMPLX_55_PARENTS = [
    -1, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 12, 13, 14,
    16, 17, 18, 19, 15, 15, 15, 20, 25, 26, 20, 28, 29, 20, 31, 32,
    20, 34, 35, 20, 37, 38, 21, 40, 41, 21, 43, 44, 21, 46, 47, 21,
    49, 50, 21, 52, 53,
]


class AvatarApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.registry = AvatarRegistry(self.root)
        self.motion_dir = self.root / "motion" / "smplx_params"
        self.motion_dir.mkdir(parents=True)
        self.started = threading.Event()
        self.release = threading.Event()
        self.export_finished = threading.Event()

        def exporter(photo_path: Path, avatar_id: str, **kwargs) -> dict:
            photo_data = Path(photo_path).read_bytes()
            self.started.set()
            if not self.release.wait(timeout=5):
                raise TimeoutError("test exporter was not released")
            identity_dir = Path(kwargs["identity_dir"])
            identity_path = identity_dir / "identity.bin"
            preview_path = identity_dir / "preview.png"
            identity_path.write_bytes(b"KINEXGI1-test")
            preview_path.write_bytes(photo_data)
            self.export_finished.set()
            return {
                "avatarId": avatar_id,
                "identityUrl": f"avatar-identities/{avatar_id}/identity.bin",
                "previewUrl": f"avatar-identities/{avatar_id}/preview.png",
                "alignment": {"scale": 1},
            }

        self.registry_patch = mock.patch.object(
            app_module, "_AVATAR_REGISTRY", self.registry, create=True
        )
        self.export_patch = mock.patch.object(app_module.avatar, "run_avatar_pipeline", side_effect=exporter)
        self.motion_patch = mock.patch.object(
            app_module.avatar, "motion_params_dir", return_value=self.motion_dir
        )
        self.env_patch = mock.patch.dict("os.environ", {"AVATAR_EXPORT_STUB": "1"})

        @asynccontextmanager
        async def no_lifespan(_app):
            yield

        self.lifespan_patch = mock.patch.object(
            app_module.app.router, "lifespan_context", no_lifespan
        )
        self.registry_patch.start()
        self.export_patch.start()
        self.motion_params_mock = self.motion_patch.start()
        self.env_patch.start()
        self.lifespan_patch.start()
        self.client_context = TestClient(app_module.app)
        self.client = self.client_context.__enter__()

    def tearDown(self) -> None:
        self.release.set()
        self.client_context.__exit__(None, None, None)
        self.lifespan_patch.stop()
        self.env_patch.stop()
        self.motion_patch.stop()
        self.export_patch.stop()
        self.registry_patch.stop()
        self.tmp.cleanup()

    def _wait_for_status(self, avatar_id: str, expected: str) -> dict:
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            records = self.client.get("/avatars").json()
            current = next(record for record in records if record["avatarId"] == avatar_id)
            if current["status"] == expected:
                return current
            time.sleep(0.01)
        self.fail(f"identity {avatar_id} did not reach {expected}")

    def test_upload_and_list_expose_queued_running_and_ready_identity_states(self) -> None:
        queued = self.registry.create_identity("Queued")
        ready = self.registry.create_identity("Ready", status="ready", progress=100)

        response = self.client.post(
            "/avatars",
            files={"photo": ("ada.png", b"png-bytes", "image/png")},
            data={"name": "  Ada  ", "motionParams": "test_video"},
        )

        self.assertEqual(response.status_code, 202)
        created = response.json()
        self.assertTrue(created["avatarId"].startswith("av-"))
        self.assertEqual(created["name"], "Ada")
        self.assertEqual(created["motionParams"], "test_video")
        self.assertNotIn("seedId", created)
        self.assertTrue(self.started.wait(timeout=2))
        running = self._wait_for_status(created["avatarId"], "running")
        statuses = {record["avatarId"]: record["status"] for record in self.client.get("/avatars").json()}
        self.assertEqual(statuses[queued["avatarId"]], "queued")
        self.assertEqual(statuses[ready["avatarId"]], "ready")
        self.assertEqual(running["progress"], 0)

        self.release.set()
        finished = self._wait_for_status(created["avatarId"], "ready")
        self.assertEqual(finished["progress"], 100)
        identity_url = urlsplit(finished["identityUrl"])
        preview_url = urlsplit(finished["previewUrl"])
        self.assertTrue(identity_url.path.endswith("/identity.bin"))
        self.assertTrue(preview_url.path.endswith("/preview.png"))
        self.assertIn("v", parse_qs(identity_url.query))
        self.assertIn("v", parse_qs(preview_url.query))

    def test_ready_identity_asset_versions_change_when_files_are_replaced(self) -> None:
        identity = self.registry.create_identity(
            "Ada",
            status="ready",
            progress=100,
            identityUrl="avatar-identities/ada/identity.bin",
            previewUrl="avatar-identities/ada/preview.png",
        )
        identity_dir = self.root / "avatar-identities" / "ada"
        identity_dir.mkdir(parents=True)
        identity_path = identity_dir / "identity.bin"
        preview_path = identity_dir / "preview.png"
        identity_path.write_bytes(b"identity-v1")
        preview_path.write_bytes(b"preview-v1")

        first = next(
            record for record in self.client.get("/avatars").json()
            if record["avatarId"] == identity["avatarId"]
        )
        first_identity = first["identityUrl"]
        first_preview = first["previewUrl"]

        identity_path.write_bytes(b"identity-version-two")
        preview_path.write_bytes(b"preview-version-two")
        second = next(
            record for record in self.client.get("/avatars").json()
            if record["avatarId"] == identity["avatarId"]
        )

        self.assertEqual(urlsplit(first_identity).path, urlsplit(second["identityUrl"]).path)
        self.assertEqual(urlsplit(first_preview).path, urlsplit(second["previewUrl"]).path)
        self.assertNotEqual(first_identity, second["identityUrl"])
        self.assertNotEqual(first_preview, second["previewUrl"])

    def test_legacy_import_alias_returns_identity_without_attaching_seed(self) -> None:
        response = self.client.post(
            "/import/avatar",
            files={"photo": ("legacy.jpg", b"jpg-bytes", "image/jpeg")},
            data={"name": "Legacy", "seedId": "ugc-squat", "motionParams": "test_video"},
        )

        self.assertEqual(response.status_code, 202)
        self.assertIn("avatarId", response.json())
        self.assertNotIn("jobId", response.json())
        self.assertNotIn("seedId", response.json())

    def test_patch_trims_and_persists_name(self) -> None:
        identity = self.registry.create_identity("Before")

        response = self.client.patch(
            f"/avatars/{identity['avatarId']}", json={"name": "  After  "}
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["name"], "After")
        self.assertEqual(
            AvatarRegistry(self.root).list_identities()[0]["name"], "After"
        )

    def test_delete_tombstones_hides_identity_removes_source_and_cancels_binding(self) -> None:
        identity = self.registry.create_identity("Ada", sourcePhoto="source-photo.png")
        identity_dir = self.root / "avatar-identities" / identity["avatarId"]
        source = identity_dir / "source-photo.png"
        source.write_bytes(b"photo")
        motion = self.registry.upsert_motion(name="Squat")
        binding = self.registry.create_binding(identity["avatarId"], motion["motionId"])

        response = self.client.delete(f"/avatars/{identity['avatarId']}")

        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.json()["deletedAt"])
        self.assertFalse(source.exists())
        self.assertEqual(self.client.get("/avatars").json(), [])
        persisted = self.registry.list_bindings(avatar_id=identity["avatarId"])
        self.assertEqual(persisted[0]["bindingId"], binding["bindingId"])
        self.assertEqual(persisted[0]["status"], "cancelled")

    def test_upload_rejects_invalid_image_mime(self) -> None:
        response = self.client.post(
            "/avatars", files={"photo": ("notes.txt", b"nope", "text/plain")}
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"]["stage"], "input")

    def test_both_upload_routes_reject_invalid_motion_pack_before_creating_identity(self) -> None:
        self.motion_params_mock.side_effect = FileNotFoundError("missing motion pack")

        for route in ("/avatars", "/import/avatar"):
            with self.subTest(route=route):
                response = self.client.post(
                    route,
                    files={"photo": ("ada.png", b"png-bytes", "image/png")},
                    data={"motionParams": "missing-pack"},
                )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["detail"]["stage"], "input")

        self.assertEqual(self.registry.list_identities(include_deleted=True), [])
        self.assertFalse(self.started.is_set())

    def test_delete_during_export_cannot_publish_stale_ready_state(self) -> None:
        created = self.client.post(
            "/avatars", files={"photo": ("ada.png", b"png-bytes", "image/png")}
        ).json()
        self.assertTrue(self.started.wait(timeout=2))
        self._wait_for_status(created["avatarId"], "running")

        deleted = self.client.delete(f"/avatars/{created['avatarId']}").json()
        self.release.set()
        self.assertTrue(self.export_finished.wait(timeout=2))
        self.assertTrue(app_module._AVATAR_EXPORT_LOCK.acquire(timeout=2))
        app_module._AVATAR_EXPORT_LOCK.release()

        persisted = next(
            record
            for record in self.registry.list_identities(include_deleted=True)
            if record["avatarId"] == created["avatarId"]
        )
        self.assertEqual(persisted["deletedAt"], deleted["deletedAt"])
        self.assertNotEqual(persisted["status"], "ready")

    def test_delete_at_ready_publish_interleaving_is_atomic(self) -> None:
        publish_entered = threading.Event()
        publish_release = threading.Event()
        original_publish = self.registry.update_identity_if_active

        def controlled_publish(avatar_id: str, **changes):
            if changes.get("status") != "ready":
                return original_publish(avatar_id, **changes)
            publish_entered.set()
            if not publish_release.wait(timeout=3):
                raise TimeoutError("test conditional publish was not released")
            return original_publish(avatar_id, **changes)

        with mock.patch.object(
            self.registry, "update_identity_if_active", side_effect=controlled_publish
        ):
            created = self.client.post(
                "/avatars", files={"photo": ("ada.png", b"png-bytes", "image/png")}
            ).json()
            self.assertTrue(self.started.wait(timeout=2))
            self.release.set()
            self.assertTrue(self.export_finished.wait(timeout=2))
            self.assertTrue(publish_entered.wait(timeout=2))

            deleted = self.client.delete(f"/avatars/{created['avatarId']}").json()
            publish_release.set()
            self.assertTrue(app_module._AVATAR_EXPORT_LOCK.acquire(timeout=2))
            app_module._AVATAR_EXPORT_LOCK.release()

        persisted = next(
            record
            for record in self.registry.list_identities(include_deleted=True)
            if record["avatarId"] == created["avatarId"]
        )
        self.assertEqual(persisted["deletedAt"], deleted["deletedAt"])
        self.assertNotEqual(persisted["status"], "ready")

    def test_startup_recovery_resumes_persisted_queued_and_running_identities(self) -> None:
        identities: list[dict] = []
        for status in ("queued", "running"):
            record = self.registry.create_identity(
                status.title(),
                status=status,
                sourcePhoto="source-photo.png",
                motionParams="test_video",
            )
            source = self.registry.identities_dir / record["avatarId"] / "source-photo.png"
            source.write_bytes(f"{status}-photo".encode())
            identities.append(record)
        self.release.set()

        recovered = app_module._recover_avatar_identities(
            lambda function, *args: function(*args)
        )

        persisted = {
            record["avatarId"]: record for record in self.registry.list_identities()
        }
        self.assertEqual(recovered, 2)
        for original in identities:
            with self.subTest(status=original["status"]):
                current = persisted[original["avatarId"]]
                self.assertEqual(current["status"], "ready")
                self.assertEqual(current["progress"], 100)
                self.assertTrue(urlsplit(current["identityUrl"]).path.endswith("/identity.bin"))

    def test_startup_recovery_is_idempotent_while_recovered_job_is_pending(self) -> None:
        identity = self.registry.create_identity(
            "Ada",
            sourcePhoto="source-photo.png",
            motionParams="test_video",
        )
        source = self.registry.identities_dir / identity["avatarId"] / "source-photo.png"
        source.write_bytes(b"photo")
        submissions: list[tuple[object, tuple[object, ...]]] = []

        first = app_module._recover_avatar_identities(
            lambda function, *args: submissions.append((function, args))
        )
        second = app_module._recover_avatar_identities(
            lambda function, *args: submissions.append((function, args))
        )

        self.assertEqual(first, 1)
        self.assertEqual(second, 0)
        self.assertEqual(len(submissions), 1)
        self.release.set()
        function, args = submissions[0]
        function(*args)

    def test_startup_recovery_marks_missing_or_unsafe_inputs_terminal(self) -> None:
        missing_source = self.registry.create_identity(
            "Missing source",
            sourcePhoto="source-photo.png",
            motionParams="test_video",
        )
        missing_metadata = self.registry.create_identity(
            "Legacy",
            sourcePhoto="source-photo.png",
        )
        legacy_source = (
            self.registry.identities_dir
            / missing_metadata["avatarId"]
            / "source-photo.png"
        )
        legacy_source.write_bytes(b"legacy")
        unsafe_source = self.registry.create_identity(
            "Unsafe",
            sourcePhoto="../outside.png",
            motionParams="test_video",
        )
        outside = self.registry.identities_dir / "outside.png"
        outside.parent.mkdir(parents=True, exist_ok=True)
        outside.write_bytes(b"must-not-read")

        recovered = app_module._recover_avatar_identities(
            lambda *_args: self.fail("invalid recovery inputs must not be submitted")
        )

        persisted = {
            record["avatarId"]: record for record in self.registry.list_identities()
        }
        self.assertEqual(recovered, 0)
        for identity in (missing_source, missing_metadata, unsafe_source):
            with self.subTest(avatar_id=identity["avatarId"]):
                current = persisted[identity["avatarId"]]
                self.assertEqual(current["status"], "error")
                self.assertIn("replacement photo", current["error"])
                self.assertIsNotNone(current["finishedAt"])
        self.assertEqual(outside.read_bytes(), b"must-not-read")

    def test_startup_recovery_ignores_deleted_and_terminal_identities(self) -> None:
        deleted = self.registry.create_identity(
            "Deleted",
            sourcePhoto="source-photo.png",
            motionParams="test_video",
        )
        deleted_source = self.registry.identities_dir / deleted["avatarId"] / "source-photo.png"
        deleted_source.write_bytes(b"deleted")
        self.registry.soft_delete_identity(deleted["avatarId"])
        for status in ("ready", "error"):
            identity = self.registry.create_identity(
                status.title(),
                status=status,
                sourcePhoto="source-photo.png",
                motionParams="test_video",
            )
            source = self.registry.identities_dir / identity["avatarId"] / "source-photo.png"
            source.write_bytes(status.encode())

        recovered = app_module._recover_avatar_identities(
            lambda *_args: self.fail("deleted and terminal identities must not be submitted")
        )

        self.assertEqual(recovered, 0)
        persisted = self.registry.list_identities(include_deleted=True)
        self.assertEqual(
            {record["status"] for record in persisted}, {"queued", "ready", "error"}
        )

    def test_lifespan_resubmits_identity_recovery_through_executor(self) -> None:
        torch_stub = types.ModuleType("torch")
        sam_stub = types.ModuleType("sam_3d_body")
        sam_stub.load_sam_3d_body = lambda *_args, **_kwargs: (object(), object())
        sam_stub.SAM3DBodyEstimator = lambda **_kwargs: object()
        worker_ran = threading.Event()

        def recover(submit) -> int:
            submit(worker_ran.set)
            return 1

        async def enter_lifespan() -> None:
            async with app_module.lifespan(app_module.app):
                await asyncio.sleep(0)

        with mock.patch.dict(
            sys.modules, {"torch": torch_stub, "sam_3d_body": sam_stub}
        ), mock.patch.object(
            app_module, "_recover_motion_bindings", return_value=0
        ), mock.patch.object(
            app_module, "_recover_avatar_identities", side_effect=recover
        ) as recovery:
            asyncio.run(enter_lifespan())

        recovery.assert_called_once()
        self.assertTrue(worker_ran.wait(timeout=2))


class AvatarPipelineTests(unittest.TestCase):
    def test_canonical_smplx_parent_hierarchy_is_exact(self) -> None:
        self.assertEqual(list(avatar.SMPLX_55_PARENTS), EXPECTED_SMPLX_55_PARENTS)

    def test_pipeline_splits_aligned_asset_with_joint_null_and_publishes_preview(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            photo = root / "photo.png"
            raw_bin = root / "stub.bin"
            debug_npz = root / "stub.npz"
            identity_dir = root / "avatar-identities" / "av-test"
            motion_dir = root / "motion" / "smplx_params"
            photo.write_bytes(b"photo-preview")
            raw_bin.write_bytes(b"legacy")
            motion_dir.mkdir(parents=True)
            joint_null = np.arange(55 * 3, dtype=np.float32).reshape(55, 3)
            np.savez(debug_npz, joint_null=joint_null)

            def align(_debug, source, target, _report):
                Path(target).write_bytes(Path(source).read_bytes())
                return {"scale": 1}

            def split(
                source,
                identity_path,
                motion_path,
                actual_joints,
                parents,
                *,
                stage_transform_baked,
            ):
                self.assertEqual(Path(source).read_bytes(), b"legacy")
                np.testing.assert_array_equal(actual_joints, joint_null)
                self.assertEqual(list(parents), EXPECTED_SMPLX_55_PARENTS)
                self.assertIs(stage_transform_baked, True)
                Path(identity_path).parent.mkdir(parents=True, exist_ok=True)
                Path(identity_path).write_bytes(b"identity")
                Path(motion_path).write_bytes(b"motion")
                return ({"format": "KINEXGI1"}, {"format": "KINEXGM1"})

            with mock.patch.object(avatar.config, "AVATAR_STUB_BIN", raw_bin), \
                 mock.patch.object(avatar.config, "AVATAR_STUB_NPZ", debug_npz), \
                 mock.patch.object(avatar, "motion_params_dir", return_value=motion_dir), \
                 mock.patch.object(avatar, "_run_alignment", side_effect=align), \
                 mock.patch.object(avatar, "split_legacy_asset", side_effect=split), \
                 mock.patch.object(avatar.config, "relative_to_repo", side_effect=lambda path: Path(path).name), \
                 mock.patch.dict("os.environ", {"AVATAR_EXPORT_STUB": "1"}):
                result = avatar.run_avatar_pipeline(
                    photo,
                    "av-test",
                    name="Ada",
                    motion_params="test_video",
                    identity_dir=identity_dir,
                )

            self.assertEqual((identity_dir / "identity.bin").read_bytes(), b"identity")
            self.assertEqual((identity_dir / "preview.png").read_bytes(), b"photo-preview")
            self.assertEqual(result["identityUrl"], "identity.bin")
            self.assertEqual(result["previewUrl"], "preview.png")


if __name__ == "__main__":
    unittest.main()
