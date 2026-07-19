"""Regression tests for filesystem-backed Avatar Vault manifests."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

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

        self.assertEqual(ready["status"], "ready")
        self.assertEqual(stale["status"], "ready")
        self.assertEqual(self.registry.list_bindings()[0]["status"], "ready")

    def test_deleted_identity_cannot_create_new_binding(self) -> None:
        identity = self.registry.create_identity("Ada")
        motion = self.registry.upsert_motion(name="Squat")
        self.registry.soft_delete_identity(identity["avatarId"])

        with self.assertRaisesRegex(ValueError, "deleted"):
            self.registry.create_binding(identity["avatarId"], motion["motionId"])


if __name__ == "__main__":
    unittest.main()
