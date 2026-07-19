"""Regression tests for filesystem-backed Avatar Vault manifests."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from backend import avatar_registry
from backend.avatar_registry import AvatarRegistry


class AvatarRegistryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.registry = AvatarRegistry(self.root)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_lists_active_identities_newest_first(self) -> None:
        older = self.registry.create_identity("Ada", createdAt=10)
        newer = self.registry.create_identity("Grace", createdAt=20)

        identities = self.registry.list_identities()

        self.assertEqual([record["avatarId"] for record in identities], [newer["avatarId"], older["avatarId"]])
        self.assertTrue(older["avatarId"].startswith("av-"))
        self.assertEqual(identities[0]["status"], "queued")
        self.assertEqual(identities[0]["progress"], 0)

    def test_rename_persists_across_registry_instances(self) -> None:
        identity = self.registry.create_identity("Before")

        changed = AvatarRegistry(self.root).update_identity(identity["avatarId"], name="After")
        reloaded = AvatarRegistry(self.root).list_identities()

        self.assertEqual(changed["name"], "After")
        self.assertEqual(reloaded[0]["name"], "After")
        manifest = self.root / "avatar-identities" / identity["avatarId"] / "record.json"
        self.assertEqual(json.loads(manifest.read_text(encoding="utf-8"))["name"], "After")

    def test_conditional_identity_update_refuses_to_publish_deleted_record(self) -> None:
        identity = self.registry.create_identity("Ada")
        active = self.registry.update_identity_if_active(
            identity["avatarId"], status="running", progress=50
        )
        self.registry.soft_delete_identity(identity["avatarId"])

        refused = self.registry.update_identity_if_active(
            identity["avatarId"], status="ready", progress=100
        )
        persisted = self.registry.list_identities(include_deleted=True)[0]

        self.assertEqual(active["status"], "running")
        self.assertIsNone(refused)
        self.assertEqual(persisted["status"], "running")
        self.assertIsNotNone(persisted["deletedAt"])

    def test_conditional_identity_update_can_atomically_require_current_status(self) -> None:
        identity = self.registry.create_identity("Ada")

        claimed = self.registry.update_identity_if_active(
            identity["avatarId"],
            expected_statuses={"queued"},
            status="running",
        )
        duplicate = self.registry.update_identity_if_active(
            identity["avatarId"],
            expected_statuses={"queued"},
            status="running",
        )

        self.assertEqual(claimed["status"], "running")
        self.assertIsNone(duplicate)

    def test_atomic_manifest_publish_syncs_and_closes_parent_directory(self) -> None:
        with mock.patch.object(avatar_registry.os, "fsync", wraps=avatar_registry.os.fsync) as sync:
            with mock.patch.object(avatar_registry.os, "open", wraps=avatar_registry.os.open) as open_dir:
                with mock.patch.object(avatar_registry.os, "close", wraps=avatar_registry.os.close) as close_dir:
                    identity = self.registry.create_identity("Ada")

        manifest = self.root / "avatar-identities" / identity["avatarId"] / "record.json"
        self.assertTrue(manifest.is_file())
        self.assertIn(str(manifest.parent), [str(call.args[0]) for call in open_dir.call_args_list])
        self.assertEqual(sync.call_count, 2)
        self.assertEqual(close_dir.call_count, 1)

    def test_directory_sync_ignores_unsupported_platforms_and_closes_open_fd(self) -> None:
        with mock.patch.object(avatar_registry.os, "open", side_effect=OSError("unsupported")):
            avatar_registry._fsync_directory(self.root)

        with mock.patch.object(avatar_registry.os, "open", return_value=123):
            with mock.patch.object(avatar_registry.os, "fsync", side_effect=OSError("unsupported")):
                with mock.patch.object(avatar_registry.os, "close") as close_dir:
                    avatar_registry._fsync_directory(self.root)

        close_dir.assert_called_once_with(123)

    def test_binding_is_idempotent_per_identity_and_motion(self) -> None:
        identity = self.registry.create_identity("Ada", identityUrl="identities/ada/identity.bin")
        motion = self.registry.upsert_motion(name="Squat", motionAssetUrl="motions/squat/motion.bin")

        first = self.registry.create_binding(identity["avatarId"], motion["motionId"])
        second = AvatarRegistry(self.root).create_binding(identity["avatarId"], motion["motionId"])

        self.assertTrue(first["bindingId"].startswith("binding-"))
        self.assertTrue(motion["motionId"].startswith("motion-"))
        self.assertEqual(second["bindingId"], first["bindingId"])
        self.assertEqual(len(self.registry.list_bindings()), 1)
        self.assertEqual(first["identityUrl"], "identities/ada/identity.bin")
        self.assertEqual(first["motionAssetUrl"], "motions/squat/motion.bin")

    def test_soft_delete_hides_identity_and_cancels_unfinished_bindings(self) -> None:
        identity = self.registry.create_identity("Ada")
        motion = self.registry.upsert_motion(name="Squat")
        queued = self.registry.create_binding(identity["avatarId"], motion["motionId"])
        running = self.registry.create_binding(identity["avatarId"], self.registry.upsert_motion(name="Hinge")["motionId"])
        self.registry.update_binding(running["bindingId"], status="running", progress=40)

        deleted = self.registry.soft_delete_identity(identity["avatarId"])
        bindings = {record["bindingId"]: record for record in self.registry.list_bindings(avatar_id=identity["avatarId"])}

        self.assertNotIn(identity["avatarId"], [record["avatarId"] for record in self.registry.list_identities()])
        self.assertIsNotNone(deleted["deletedAt"])
        self.assertEqual(bindings[queued["bindingId"]]["status"], "cancelled")
        self.assertEqual(bindings[running["bindingId"]]["status"], "cancelled")
        self.assertIsNotNone(bindings[queued["bindingId"]]["finishedAt"])

    def test_soft_delete_preserves_ready_binding_and_prevents_stale_revival(self) -> None:
        identity = self.registry.create_identity("Ada")
        motion = self.registry.upsert_motion(name="Squat")
        binding = self.registry.create_binding(identity["avatarId"], motion["motionId"])
        ready = self.registry.update_binding(binding["bindingId"], status="ready", progress=100)

        self.registry.soft_delete_identity(identity["avatarId"])
        stale = self.registry.update_binding(binding["bindingId"], status="ready", progress=100)

        with self.assertRaisesRegex(ValueError, "deleted"):
            self.registry.create_binding(identity["avatarId"], motion["motionId"])
        self.assertEqual(ready["status"], "ready")
        self.assertEqual(stale["status"], "ready")
        self.assertEqual(self.registry.list_bindings()[0]["status"], "ready")

    def test_deleted_identity_cannot_create_new_binding(self) -> None:
        identity = self.registry.create_identity("Ada")
        motion = self.registry.upsert_motion(name="Squat")
        self.registry.soft_delete_identity(identity["avatarId"])

        with self.assertRaisesRegex(ValueError, "deleted"):
            self.registry.create_binding(identity["avatarId"], motion["motionId"])

    def test_all_manifest_ids_reject_bad_prefixes_and_path_traversal_in_paths_and_mutations(self) -> None:
        identity = self.registry.create_identity("Ada")
        motion = self.registry.upsert_motion(name="Squat")
        binding = self.registry.create_binding(identity["avatarId"], motion["motionId"])
        invalid_avatar_ids = ("wrong-id", "av-", "av-..", "av-../escape", "av-a/b")
        invalid_motion_ids = ("wrong-id", "motion-", "motion-..", "motion-../escape", "motion-a/b")
        invalid_binding_ids = ("wrong-id", "binding-", "binding-..", "binding-../escape", "binding-a/b")

        for avatar_id in invalid_avatar_ids:
            with self.subTest(kind="avatar path", avatar_id=avatar_id):
                with self.assertRaises(ValueError):
                    self.registry._identity_path(avatar_id)
            with self.subTest(kind="avatar mutation", avatar_id=avatar_id):
                with self.assertRaises(ValueError):
                    self.registry.update_identity(avatar_id, name="invalid")
            with self.subTest(kind="avatar binding", avatar_id=avatar_id):
                with self.assertRaises(ValueError):
                    self.registry.create_binding(avatar_id, motion["motionId"])

        for motion_id in invalid_motion_ids:
            with self.subTest(kind="motion path", motion_id=motion_id):
                with self.assertRaises(ValueError):
                    self.registry._motion_path(motion_id)
            with self.subTest(kind="motion binding", motion_id=motion_id):
                with self.assertRaises(ValueError):
                    self.registry.create_binding(identity["avatarId"], motion_id)

        for binding_id in invalid_binding_ids:
            with self.subTest(kind="binding path", binding_id=binding_id):
                with self.assertRaises(ValueError):
                    self.registry._binding_path(binding_id)
            with self.subTest(kind="binding mutation", binding_id=binding_id):
                with self.assertRaises(ValueError):
                    self.registry.update_binding(binding_id, status="ready")

        self.assertEqual(self.registry.update_binding(binding["bindingId"], progress=20)["progress"], 20)
        self.assertFalse((self.root / "escape").exists())


if __name__ == "__main__":
    unittest.main()
