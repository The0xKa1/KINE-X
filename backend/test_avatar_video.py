"""API and validation tests for independent avatar video exports."""
from __future__ import annotations

import sys
import tempfile
import time
import types
import unittest
from contextlib import asynccontextmanager
from pathlib import Path
from unittest import mock

import numpy as np  # Keep NumPy loaded while the pipeline module is stubbed.
from fastapi.testclient import TestClient

pipeline_stub = types.ModuleType("backend.pipeline")
pipeline_stub.safe_name = lambda value: str(value).strip().replace("/", "-")
pipeline_stub.run_pipeline = lambda **_kwargs: {}
with mock.patch.dict(sys.modules, {"backend.pipeline": pipeline_stub}):
    from backend import app as app_module
from backend import avatar_video
from backend.avatar_registry import AvatarRegistry


class AvatarVideoValidationTests(unittest.TestCase):
    def test_resolution_and_background_validation(self) -> None:
        avatar_video.validate_dimensions(1920, 1080)
        self.assertEqual(
            avatar_video.parse_background("#0e0f13"),
            (14 / 255, 15 / 255, 19 / 255),
        )
        for width, height in ((255, 1080), (1921, 1080), (4000, 1080), (3840, 3840)):
            with self.assertRaises(ValueError):
                avatar_video.validate_dimensions(width, height)
        for colour in ("black", "#fff", "#xyzxyz"):
            with self.assertRaises(ValueError):
                avatar_video.parse_background(colour)


class AvatarVideoApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.registry = AvatarRegistry(self.root)
        self.render_calls: list[dict] = []

        def render(identity_path, motion_path, output_path, **kwargs) -> dict:
            self.render_calls.append(
                {
                    "identity": Path(identity_path),
                    "motion": Path(motion_path),
                    "output": Path(output_path),
                    **kwargs,
                }
            )
            kwargs["progress"](1, 2, "rendering")
            kwargs["progress"](2, 2, "rendering")
            Path(output_path).write_bytes(b"rendered-mp4")
            return {
                "frameCount": 2,
                "fps": 15,
                "durationSeconds": 2 / 15,
                "width": kwargs["width"],
                "height": kwargs["height"],
                "background": kwargs["background"],
                "bytes": 12,
                "glVendor": "NVIDIA Corporation",
                "glRenderer": "test GPU",
                "glVersion": "4.1",
            }

        @asynccontextmanager
        async def no_lifespan(_app):
            yield

        self.patches = [
            mock.patch.object(app_module, "_AVATAR_REGISTRY", self.registry),
            mock.patch.object(app_module.avatar_video, "render_avatar_video", side_effect=render),
            mock.patch.object(app_module.app.router, "lifespan_context", no_lifespan),
        ]
        for patcher in self.patches:
            patcher.start()
        with app_module._SCHEDULED_AVATAR_VIDEO_EXPORTS_LOCK:
            app_module._SCHEDULED_AVATAR_VIDEO_EXPORTS.clear()
        self.client_context = TestClient(app_module.app)
        self.client = self.client_context.__enter__()

    def tearDown(self) -> None:
        self.client_context.__exit__(None, None, None)
        with app_module._SCHEDULED_AVATAR_VIDEO_EXPORTS_LOCK:
            app_module._SCHEDULED_AVATAR_VIDEO_EXPORTS.clear()
        for patcher in reversed(self.patches):
            patcher.stop()
        self.tmp.cleanup()

    def _identity_and_motion(self, *, ready: bool = True) -> tuple[dict, dict]:
        status = "ready" if ready else "running"
        identity = self.registry.create_identity("Ada", status=status, progress=100 if ready else 50)
        motion = self.registry.upsert_motion(status=status, progress=100 if ready else 50)
        identity_path = self.registry.identities_dir / identity["avatarId"] / "identity.bin"
        motion_path = self.registry.motions_dir / motion["motionId"] / "motion.bin"
        identity_path.write_bytes(b"KINEXGI1-test")
        motion_path.write_bytes(b"KINEXGM1-test")
        return identity, motion

    def _wait_ready(self, export_id: str) -> dict:
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            response = self.client.get(f"/avatar-video-exports/{export_id}")
            if response.status_code == 200 and response.json()["status"] == "ready":
                return response.json()
            time.sleep(0.01)
        self.fail(f"video export {export_id} did not become ready")

    def test_create_poll_list_and_idempotent_reuse(self) -> None:
        identity, motion = self._identity_and_motion()
        payload = {
            "avatarId": identity["avatarId"],
            "motionId": motion["motionId"],
            "width": 1280,
            "height": 720,
            "background": "#112233",
        }

        response = self.client.post("/avatar-video-exports", json=payload)
        self.assertEqual(response.status_code, 202)
        export_id = response.json()["exportId"]
        ready = self._wait_ready(export_id)
        repeated = self.client.post("/avatar-video-exports", json=payload)
        listed = self.client.get(
            "/avatar-video-exports",
            params={"avatarId": identity["avatarId"], "motionId": motion["motionId"]},
        )

        self.assertEqual(repeated.status_code, 202)
        self.assertEqual(repeated.json()["exportId"], export_id)
        self.assertEqual(len(self.render_calls), 1)
        self.assertEqual(len(listed.json()), 1)
        self.assertEqual(ready["width"], 1280)
        self.assertEqual(ready["height"], 720)
        self.assertEqual(ready["glVendor"], "NVIDIA Corporation")
        self.assertIn("avatar.mp4", ready["videoUrl"])
        self.assertTrue(
            (self.registry.video_exports_dir / export_id / "avatar.mp4").is_file()
        )

    def test_replaced_source_asset_creates_a_fresh_export(self) -> None:
        identity, motion = self._identity_and_motion()
        payload = {"avatarId": identity["avatarId"], "motionId": motion["motionId"]}
        first = self.client.post("/avatar-video-exports", json=payload).json()
        self._wait_ready(first["exportId"])
        identity_path = self.registry.identities_dir / identity["avatarId"] / "identity.bin"
        identity_path.write_bytes(b"KINEXGI1-replaced-asset")

        second = self.client.post("/avatar-video-exports", json=payload).json()
        self._wait_ready(second["exportId"])

        self.assertNotEqual(second["exportId"], first["exportId"])
        self.assertEqual(len(self.render_calls), 2)

    def test_rejects_unready_assets_and_invalid_render_options(self) -> None:
        identity, motion = self._identity_and_motion(ready=False)
        unready = self.client.post(
            "/avatar-video-exports",
            json={"avatarId": identity["avatarId"], "motionId": motion["motionId"]},
        )
        invalid = self.client.post(
            "/avatar-video-exports",
            json={
                "avatarId": identity["avatarId"],
                "motionId": motion["motionId"],
                "width": 1279,
                "background": "transparent",
            },
        )

        self.assertEqual(unready.status_code, 409)
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(self.render_calls, [])


if __name__ == "__main__":
    unittest.main()
