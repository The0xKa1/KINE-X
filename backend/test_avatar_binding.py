"""Regression tests for reusable motion extraction and avatar bindings."""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
import threading
import time
import types
import unittest
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest import mock
from urllib.parse import parse_qs, urlsplit

import numpy as np  # Keep NumPy resident across the temporary pipeline import stub.
from fastapi.testclient import TestClient

pipeline_stub = types.ModuleType("backend.pipeline")
pipeline_stub.safe_name = lambda value: str(value).strip().replace("/", "-")
pipeline_stub.run_pipeline = lambda **_kwargs: {}
with mock.patch.dict(sys.modules, {"backend.pipeline": pipeline_stub}):
    from backend import app as app_module
from backend.avatar_registry import AvatarRegistry
from backend.avatar_assets import unpack_motion_asset


class AvatarBindingApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.jobs_root = self.root / "jobs"
        self.private_jobs_root = self.root / "private-jobs"
        self.registry = AvatarRegistry(self.root)
        self.pipeline_calls: list[dict] = []
        self.persist_calls: list[tuple[Path, str]] = []
        self.motion_started = threading.Event()
        self.motion_release = threading.Event()
        self.motion_finished = threading.Event()
        self.motion_error: Exception | None = None
        self.motion_calls = 0
        self.block_sam_pipeline = False
        self.sam_started = threading.Event()
        self.sam_release = threading.Event()

        def run_pipeline(**kwargs) -> dict:
            self.pipeline_calls.append(kwargs)
            if self.block_sam_pipeline:
                self.sam_started.set()
                if not self.sam_release.wait(timeout=5):
                    raise TimeoutError("test SAM pipeline was not released")
            job_dir = self.jobs_root / kwargs["job_id"]
            job_dir.mkdir(parents=True, exist_ok=True)
            (job_dir / "coach.json").write_text(
                json.dumps(
                    {
                        "fps": 15,
                        "frames": [
                            {"pelvis": {"position": [0.0, 0.8, 0.0]}},
                            {"pelvis": {"position": [0.1, 0.8, -0.2]}},
                        ],
                    }
                ),
                encoding="utf-8",
            )
            # Deliberately differs from the multipart upload bytes.  The motion
            # worker must receive this sliced artifact, not the full upload.
            (job_dir / "segment.mp4").write_bytes(b"cropped-segment-bytes")
            (job_dir / "mesh.meta.json").write_text(
                json.dumps(
                    {
                        "frameCount": 2,
                        "durationSeconds": 2 / 15,
                        "fps": 15,
                        "name": "test",
                        "motion": "squat",
                    }
                ),
                encoding="utf-8",
            )
            return {
                "jobId": kwargs["job_id"],
                "coachClipUrl": "public/coach_clips/jobs/test/coach.json",
                "meshClipMetaUrl": "public/coach_clips/jobs/test/mesh.meta.json",
                "framesDir": "public/coach_clips/jobs/test/frames",
                "framePattern": "frame_{i:05}.jpg",
                "frameCount": 2,
                "thumbnailCount": 2,
                "durationSeconds": 2 / 15,
                "fps": 15,
                "name": "test",
                "motion": "squat",
                "sourceVideoUrl": f"public/coach_clips/jobs/{kwargs['job_id']}/segment.mp4",
            }

        def persist_source(video_path: Path, job_id: str) -> Path:
            self.persist_calls.append((Path(video_path), job_id))
            target = self.private_jobs_root / job_id / ".avatar-source.mp4"
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(video_path, target)
            return target

        def cleanup_job(job_id: str) -> None:
            shutil.rmtree(self.jobs_root / job_id, ignore_errors=True)

        def prepare_motion_asset(
            source_video: Path,
            coach_clip: Path,
            output_path: Path,
            *,
            fps: float,
            progress=None,
        ) -> dict:
            self.motion_calls += 1
            self.motion_started.set()
            if progress:
                progress(1, 2, "LHM motion")
            if not self.motion_release.wait(timeout=5):
                raise TimeoutError("test motion extractor was not released")
            try:
                if self.motion_error:
                    raise self.motion_error
                output_path.parent.mkdir(parents=True, exist_ok=True)
                output_path.write_bytes(b"KINEXGM1-test")
                if progress:
                    progress(2, 2, "packed motion")
                return {
                    "format": "KINEXGM1",
                    "frames": 2,
                    "fps": fps,
                    "stageTransform": {
                        "scale": 1,
                        "R": [[1, 0, 0], [0, -1, 0], [0, 0, -1]],
                        "t": [0, 0, 0],
                    },
                }
            finally:
                self.motion_finished.set()

        @asynccontextmanager
        async def no_lifespan(_app):
            yield

        self.patches = [
            mock.patch.object(app_module, "_AVATAR_REGISTRY", self.registry),
            mock.patch.object(app_module.config, "PUBLIC_JOBS_DIR", self.jobs_root),
            mock.patch.object(
                app_module.config,
                "AVATAR_PRIVATE_JOBS_DIR",
                self.private_jobs_root,
                create=True,
            ),
            mock.patch.object(app_module.pipeline, "run_pipeline", side_effect=run_pipeline),
            mock.patch.object(
                app_module.pipeline,
                "cleanup_job",
                side_effect=cleanup_job,
                create=True,
            ),
            mock.patch.object(
                app_module.pipeline,
                "persist_source_video",
                side_effect=persist_source,
                create=True,
            ),
            mock.patch.object(
                app_module.pipeline,
                "find_persisted_source",
                side_effect=lambda job_id: next(
                    iter((self.private_jobs_root / job_id).glob(".avatar-source.*")),
                    None,
                ),
                create=True,
            ),
            mock.patch.object(
                app_module,
                "avatar_motion",
                SimpleNamespace(prepare_motion_asset=prepare_motion_asset),
                create=True,
            ),
            mock.patch.object(app_module.app.router, "lifespan_context", no_lifespan),
        ]
        for patcher in self.patches:
            patcher.start()
        with app_module._SCHEDULED_AVATAR_MOTIONS_LOCK:
            app_module._SCHEDULED_AVATAR_MOTIONS.clear()
        app_module.app.state.estimator = object()
        self.client_context = TestClient(app_module.app)
        self.client = self.client_context.__enter__()

    def tearDown(self) -> None:
        self.motion_release.set()
        self.sam_release.set()
        self.client_context.__exit__(None, None, None)
        with app_module._SCHEDULED_AVATAR_MOTIONS_LOCK:
            app_module._SCHEDULED_AVATAR_MOTIONS.clear()
        for patcher in reversed(self.patches):
            patcher.stop()
        self.tmp.cleanup()

    def _ready_identity(self, name: str = "Ada") -> dict:
        return self.registry.create_identity(
            name,
            status="ready",
            progress=100,
            identityUrl=f"avatar-identities/{name.lower()}/identity.bin",
        )

    def _import(
        self,
        avatar_id: str | None = None,
        *,
        start_sec: float | None = None,
        end_sec: float | None = None,
    ):
        data = {"name": "test", "motion": "squat"}
        if avatar_id is not None:
            data["avatarId"] = avatar_id
        if start_sec is not None:
            data["startSec"] = str(start_sec)
        if end_sec is not None:
            data["endSec"] = str(end_sec)
        return self.client.post(
            "/import/video",
            files={"file": ("motion.mp4", b"video-bytes", "video/mp4")},
            data=data,
        )

    def _wait_binding(self, binding_id: str, expected: str) -> dict:
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            response = self.client.get("/avatar-bindings")
            if response.status_code == 200:
                current = next(
                    (item for item in response.json() if item["bindingId"] == binding_id),
                    None,
                )
                if current and current["status"] == expected:
                    return current
            time.sleep(0.01)
        self.fail(f"binding {binding_id} did not reach {expected}")

    def test_import_without_avatar_preserves_the_ordinary_response(self) -> None:
        response = self._import()

        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["name"], "test")
        self.assertNotIn("motionId", result)
        self.assertNotIn("bindingId", result)
        self.assertNotIn("bindingStatus", result)
        self.assertEqual(len(self.pipeline_calls), 1)
        self.assertEqual(self.persist_calls, [])
        self.assertFalse(self.motion_started.is_set())

    def test_selected_identity_returns_ordinary_result_with_queued_binding_immediately(self) -> None:
        identity = self._ready_identity()

        response = self._import(identity["avatarId"], start_sec=4, end_sec=14)

        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["name"], "test")
        self.assertTrue(result["motionId"].startswith("motion-"))
        self.assertTrue(result["bindingId"].startswith("binding-"))
        self.assertEqual(result["bindingStatus"], "queued")
        self.assertTrue(self.motion_started.wait(timeout=2))
        source = self.private_jobs_root / result["jobId"] / ".avatar-source.mp4"
        self.assertTrue(source.is_file())
        self.assertEqual(source.read_bytes(), b"cropped-segment-bytes")
        self.assertEqual(
            self.persist_calls,
            [(self.jobs_root / result["jobId"] / "segment.mp4", result["jobId"])],
        )
        self.assertEqual(self.pipeline_calls[0]["start_sec"], 4)
        self.assertEqual(self.pipeline_calls[0]["end_sec"], 14)
        self.assertFalse(
            (self.jobs_root / result["jobId"] / ".avatar-source.mp4").exists()
        )

        self.motion_release.set()
        ready = self._wait_binding(result["bindingId"], "ready")
        self.assertEqual(ready["motionId"], result["motionId"])
        motion_url = urlsplit(ready["motionAssetUrl"])
        self.assertTrue(motion_url.path.endswith("/motion.bin"))
        self.assertIn("v", parse_qs(motion_url.query))
        self.assertFalse(source.exists())

    def test_completed_import_can_apply_an_avatar_after_upload(self) -> None:
        identity = self._ready_identity("Rei")
        imported = self._import()
        self.assertEqual(imported.status_code, 200)
        job_id = imported.json()["jobId"]

        first = self.client.post(
            "/avatar-bindings",
            json={"avatarId": identity["avatarId"], "jobId": job_id},
        )
        second = self.client.post(
            "/avatar-bindings",
            json={"avatarId": identity["avatarId"], "jobId": job_id},
        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json()["bindingId"], second.json()["bindingId"])
        self.assertEqual(first.json()["motionId"], f"motion-{job_id}")
        self.assertEqual(first.json()["status"], "queued")
        self.assertTrue(self.motion_started.wait(timeout=2))
        self.assertEqual(self.motion_calls, 1)
        self.assertEqual(len(self.pipeline_calls), 1)
        source = self.private_jobs_root / job_id / ".avatar-source.mp4"
        self.assertEqual(source.read_bytes(), b"cropped-segment-bytes")

        self.motion_release.set()
        ready = self._wait_binding(first.json()["bindingId"], "ready")
        self.assertEqual(ready["avatarId"], identity["avatarId"])
        self.assertFalse(source.exists())

    def test_post_import_binding_requires_exactly_one_source(self) -> None:
        identity = self._ready_identity()
        missing = self.client.post(
            "/avatar-bindings", json={"avatarId": identity["avatarId"]}
        )
        both = self.client.post(
            "/avatar-bindings",
            json={
                "avatarId": identity["avatarId"],
                "motionId": "motion-manual",
                "jobId": "job-manual",
            },
        )

        self.assertEqual(missing.status_code, 400)
        self.assertEqual(both.status_code, 400)

    def test_post_import_binding_rejects_unknown_video_job(self) -> None:
        identity = self._ready_identity()
        response = self.client.post(
            "/avatar-bindings",
            json={"avatarId": identity["avatarId"], "jobId": "missing-job"},
        )

        self.assertEqual(response.status_code, 404)
        self.assertIn("does not exist", response.json()["detail"]["error"])

    def test_repeated_binding_requests_return_the_same_binding(self) -> None:
        identity = self._ready_identity()
        motion = self.registry.upsert_motion(
            "manual",
            status="ready",
            progress=100,
            motionAssetUrl="motions/motion-manual/motion.bin",
        )
        request = {"avatarId": identity["avatarId"], "motionId": motion["motionId"]}

        first = self.client.post("/avatar-bindings", json=request)
        second = self.client.post("/avatar-bindings", json=request)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json()["bindingId"], second.json()["bindingId"])
        self.assertEqual(first.json()["status"], "ready")
        self.assertEqual(len(self.client.get("/avatar-bindings").json()), 1)

    def test_ready_binding_motion_version_changes_after_atomic_rebake(self) -> None:
        identity = self._ready_identity()
        motion = self.registry.upsert_motion(
            "manual",
            status="ready",
            progress=100,
            motionAssetUrl="motions/motion-manual/motion.bin",
        )
        motion_path = self.root / "motions" / "motion-manual" / "motion.bin"
        motion_path.write_bytes(b"motion-v1")
        binding = self.registry.create_binding(identity["avatarId"], motion["motionId"])
        self.registry.update_binding(binding["bindingId"], status="ready", progress=100)

        first = self.client.get("/avatar-bindings").json()[0]["motionAssetUrl"]
        motion_path.write_bytes(b"motion-version-two")
        second = self.client.get("/avatar-bindings").json()[0]["motionAssetUrl"]

        self.assertEqual(urlsplit(first).path, urlsplit(second).path)
        self.assertNotEqual(first, second)

    def test_background_publish_keeps_the_imports_selected_identity(self) -> None:
        selected = self._ready_identity("Ada")
        response = self._import(selected["avatarId"])
        result = response.json()
        self.assertTrue(self.motion_started.wait(timeout=2))
        other = self._ready_identity("Grace")
        second = self.client.post(
            "/avatar-bindings",
            json={"avatarId": other["avatarId"], "motionId": result["motionId"]},
        )
        self.assertEqual(second.status_code, 200)

        self.motion_release.set()
        ready = self._wait_binding(result["bindingId"], "ready")

        self.assertEqual(
            ready["identityUrl"], "avatar-identities/ada/identity.bin"
        )

    def test_motion_failure_marks_binding_error_without_invalidating_video_import(self) -> None:
        identity = self._ready_identity()
        self.motion_error = RuntimeError("LHM failed")

        response = self._import(identity["avatarId"])

        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["name"], "test")
        self.assertTrue((self.jobs_root / result["jobId"] / "coach.json").is_file())
        self.assertTrue(self.motion_started.wait(timeout=2))
        source = self.private_jobs_root / result["jobId"] / ".avatar-source.mp4"
        self.motion_release.set()
        failed = self._wait_binding(result["bindingId"], "error")
        self.assertIn("LHM failed", failed["error"])
        self.assertTrue((self.jobs_root / result["jobId"] / "coach.json").is_file())
        self.assertFalse(source.exists())

    def test_deleted_identity_is_rejected_before_the_ordinary_pipeline_runs(self) -> None:
        identity = self._ready_identity()
        self.registry.soft_delete_identity(identity["avatarId"])

        response = self._import(identity["avatarId"])

        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.pipeline_calls, [])

    def test_identity_deleted_while_sam_runs_preserves_ordinary_import(self) -> None:
        identity = self._ready_identity()
        self.block_sam_pipeline = True
        outcome: dict[str, object] = {}

        def request_import() -> None:
            try:
                outcome["response"] = self._import(identity["avatarId"])
            except Exception as exc:  # pragma: no cover - captured for assertion
                outcome["error"] = exc

        request_thread = threading.Thread(target=request_import)
        request_thread.start()
        self.assertTrue(self.sam_started.wait(timeout=2))
        self.registry.soft_delete_identity(identity["avatarId"])
        self.sam_release.set()
        request_thread.join(timeout=3)

        self.assertFalse(request_thread.is_alive())
        self.assertNotIn("error", outcome)
        response = outcome["response"]
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["bindingStatus"], "cancelled")
        self.assertNotIn("bindingId", result)
        self.assertTrue(result["motionId"].startswith("motion-"))
        self.assertTrue((self.jobs_root / result["jobId"] / "coach.json").is_file())
        self.assertEqual(self.registry.list_bindings(), [])

    def test_startup_recovery_resumes_persisted_queued_binding_and_cleans_source(self) -> None:
        identity = self._ready_identity()
        job_id = "recover-job"
        motion = self.registry.upsert_motion(
            job_id,
            status="queued",
            progress=0,
            jobId=job_id,
            coachClipUrl=f"public/coach_clips/jobs/{job_id}/coach.json",
            fps=15,
        )
        binding = self.registry.create_binding(identity["avatarId"], motion["motionId"])
        coach_path = self.jobs_root / job_id / "coach.json"
        coach_path.parent.mkdir(parents=True)
        coach_path.write_text(
            json.dumps({"frames": [{"pelvis": {"position": [0, 0, 0]}}]}),
            encoding="utf-8",
        )
        source = self.private_jobs_root / job_id / ".avatar-source.mp4"
        source.parent.mkdir(parents=True)
        source.write_bytes(b"video")
        self.motion_release.set()

        self.assertTrue(hasattr(app_module, "_recover_motion_bindings"))
        recovered = app_module._recover_motion_bindings(
            lambda function, *args: function(*args)
        )

        self.assertEqual(recovered, 1)
        ready = self.registry.list_bindings()[0]
        self.assertEqual(ready["bindingId"], binding["bindingId"])
        self.assertEqual(ready["status"], "ready")
        self.assertFalse(source.exists())

    def test_startup_reconciliation_repairs_terminal_motion_mismatches(self) -> None:
        identity = self._ready_identity()
        expected: dict[str, str] = {}
        sources: list[Path] = []
        for suffix, motion_status in (("ready", "ready"), ("error", "error")):
            job_id = f"terminal-{suffix}"
            fields = {
                "status": motion_status,
                "progress": 100 if motion_status == "ready" else 40,
                "jobId": job_id,
                "fps": 15,
            }
            if motion_status == "ready":
                fields["motionAssetUrl"] = f"motions/motion-{job_id}/motion.bin"
            else:
                fields["error"] = "LHM crashed after manifest update"
            motion = self.registry.upsert_motion(job_id, **fields)
            binding = self.registry.create_binding(
                identity["avatarId"], motion["motionId"]
            )
            self.registry.update_binding(binding["bindingId"], status="running")
            expected[binding["bindingId"]] = motion_status
            source = self.private_jobs_root / job_id / ".avatar-source.mp4"
            source.parent.mkdir(parents=True)
            source.write_bytes(b"leftover")
            sources.append(source)
        submitted: list[object] = []

        reconciled = app_module._recover_motion_bindings(
            lambda function, *args: submitted.append((function, args))
        )

        records = {
            record["bindingId"]: record for record in self.registry.list_bindings()
        }
        self.assertEqual(reconciled, 2)
        self.assertEqual(submitted, [])
        for binding_id, status in expected.items():
            self.assertEqual(records[binding_id]["status"], status)
            if status == "ready":
                self.assertTrue(
                    urlsplit(records[binding_id]["motionAssetUrl"]).path.endswith("/motion.bin")
                )
            else:
                self.assertIn("LHM crashed", records[binding_id]["error"])
        for source in sources:
            self.assertFalse(source.exists())
            self.assertFalse(source.parent.exists())

    def test_startup_reconciliation_removes_empty_private_job_directory(self) -> None:
        identity = self._ready_identity()
        job_id = "terminal-empty"
        motion = self.registry.upsert_motion(
            job_id,
            status="ready",
            progress=100,
            jobId=job_id,
            fps=15,
            motionAssetUrl=f"motions/motion-{job_id}/motion.bin",
        )
        binding = self.registry.create_binding(identity["avatarId"], motion["motionId"])
        self.registry.update_binding(binding["bindingId"], status="running")
        private_job_dir = self.private_jobs_root / job_id
        private_job_dir.mkdir(parents=True)

        reconciled = app_module._recover_motion_bindings(
            lambda function, *args: self.fail("terminal motion must not be submitted")
        )

        self.assertEqual(reconciled, 1)
        self.assertEqual(self.registry.list_bindings()[0]["status"], "ready")
        self.assertFalse(private_job_dir.exists())


class AvatarMotionAdapterTests(unittest.TestCase):
    @staticmethod
    def _module():
        try:
            from backend import avatar_motion
        except ImportError as exc:
            raise AssertionError("backend.avatar_motion must exist") from exc
        return avatar_motion

    def test_stage_transform_preserves_meter_scale_for_uncorrelated_root_motion(self) -> None:
        avatar_motion = self._module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lhm_translations = (
                [0.0, 0.8, 0.0],
                [0.9, 1.0, 0.5],
                [1.8, 1.2, 1.0],
            )
            lhm_frames = []
            for index, translation in enumerate(lhm_translations):
                path = root / f"{index:05}.json"
                path.write_text(json.dumps({"trans": translation}), encoding="utf-8")
                lhm_frames.append(path)
            coach_path = root / "coach.json"
            coach_path.write_text(
                json.dumps(
                    {
                        "frames": [
                            {"pelvis": {"position": [0.0000, 0.0010, 0.0000]}},
                            {"pelvis": {"position": [0.0008, 0.0009, -0.0002]}},
                            {"pelvis": {"position": [0.0010, 0.0012, -0.0001]}},
                        ]
                    }
                ),
                encoding="utf-8",
            )

            transform = avatar_motion.compute_stage_transform(lhm_frames, coach_path)

            self.assertEqual(transform["scale"], 1.0)
            self.assertEqual(transform["scalePolicy"], "fixed-meter-contract")
            converted = np.asarray(lhm_translations) @ np.asarray(transform["R"]).T
            transformed = transform["scale"] * converted + np.asarray(transform["t"])
            np.testing.assert_allclose(
                np.ptp(transformed, axis=0), np.ptp(converted, axis=0)
            )
            self.assertGreater(float(np.max(np.ptp(transformed, axis=0))), 1.0)

    def test_stage_transform_pins_camera_axes_and_aligns_root_translation(self) -> None:
        avatar_motion = self._module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lhm_frames = []
            for index, translation in enumerate(([1, 2, 3], [2, 4, 5])):
                path = root / f"{index:05}.json"
                path.write_text(json.dumps({"trans": translation}), encoding="utf-8")
                lhm_frames.append(path)
            coach_path = root / "coach.json"
            coach_path.write_text(
                json.dumps(
                    {
                        "frames": [
                            {"pelvis": {"position": [12, 16, 24]}},
                            {"pelvis": {"position": [14, 12, 20]}},
                        ]
                    }
                ),
                encoding="utf-8",
            )

            transform = avatar_motion.compute_stage_transform(lhm_frames, coach_path)

            self.assertEqual(transform["scale"], 1.0)
            self.assertEqual(
                transform["R"], [[1.0, 0.0, 0.0], [0.0, -1.0, 0.0], [0.0, 0.0, -1.0]]
            )
            for actual, expected in zip(transform["t"], [11.5, 17, 26]):
                self.assertAlmostEqual(actual, expected)
            self.assertAlmostEqual(transform["rootResidualMeanM"], 1.5)
            self.assertEqual(transform["translationFit"], "coordinate-median-root-offset")

    def test_prepare_motion_invokes_lhm_normalizes_split_json_and_atomically_packs(self) -> None:
        avatar_motion = self._module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.mp4"
            source.write_bytes(b"video")
            coach_path = root / "coach.json"
            coach_path.write_text(
                json.dumps(
                    {
                        "frames": [
                            {"pelvis": {"position": [0, 0, 0]}},
                            {"pelvis": {"position": [1, -2, -2]}},
                        ]
                    }
                ),
                encoding="utf-8",
            )
            output = root / "motion" / "motion.bin"
            python = root / "python"
            script = root / "video2motion.py"
            model = root / "human_model_files"
            workdir = root / "LHM"
            workdir.mkdir()
            calls: list[list[str]] = []

            def run_lhm(command, **kwargs):
                calls.append(command)
                output_root = Path(command[command.index("--output_path") + 1])
                params = output_root / source.stem / "smplx_params"
                params.mkdir(parents=True)
                for index, trans in enumerate(([0, 0, 0], [1, 2, 2]), start=1):
                    frame = {
                        "root_pose": [0, 0, 0],
                        "body_pose": [[0, 0, 0]] * 21,
                        "jaw_pose": [0, 0, 0],
                        "leye_pose": [0, 0, 0],
                        "reye_pose": [0, 0, 0],
                        "lhand_pose": [[0, 0, 0]] * 15,
                        "rhand_pose": [[0, 0, 0]] * 15,
                        "trans": trans,
                    }
                    (params / f"{index:05}.json").write_text(
                        json.dumps(frame), encoding="utf-8"
                    )
                return SimpleNamespace(returncode=0, stdout="ok", stderr="")

            with mock.patch.object(avatar_motion.config, "LHM_PYTHON", python), \
                 mock.patch.object(avatar_motion.config, "LHM_MOTION_SCRIPT", script), \
                 mock.patch.object(avatar_motion.config, "LHM_MOTION_MODEL_PATH", model), \
                 mock.patch.object(avatar_motion.config, "LHM_WORKDIR", workdir), \
                 mock.patch.object(avatar_motion.subprocess, "run", side_effect=run_lhm):
                meta = avatar_motion.prepare_motion_asset(
                    source, coach_path, output, fps=15
                )

            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0][0:2], [str(python), str(script)])
            self.assertIn("--video_path", calls[0])
            self.assertIn("--output_path", calls[0])
            self.assertEqual(
                calls[0][calls[0].index("--model_path") + 1], str(model)
            )
            self.assertTrue(output.is_file())
            self.assertEqual(output.read_bytes()[:8], b"KINEXGM1")
            self.assertEqual(meta["frames"], 2)
            self.assertEqual(meta["fps"], 15)
            stage_transform = meta["stageTransform"]
            self.assertEqual(stage_transform["scale"], 1.0)
            source_roots = np.asarray(([0, 0, 0], [1, 2, 2]), dtype=np.float64)
            transformed_roots = (
                source_roots @ np.asarray(stage_transform["R"]).T
            ) * stage_transform["scale"] + np.asarray(stage_transform["t"])
            np.testing.assert_allclose(
                np.ptp(transformed_roots, axis=0), [1.0, 2.0, 2.0]
            )

    def test_prepare_motion_resamples_lhm_frames_to_coach_clip_length(self) -> None:
        avatar_motion = self._module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.mp4"
            source.write_bytes(b"video")
            coach_path = root / "coach.json"
            coach_path.write_text(
                json.dumps(
                    {
                        "frames": [
                            {"pelvis": {"position": [0, 0, 0]}},
                            {"pelvis": {"position": [3, 0, 0]}},
                        ]
                    }
                ),
                encoding="utf-8",
            )
            output = root / "motion" / "motion.bin"

            def run_lhm(command, **kwargs):
                output_root = Path(command[command.index("--output_path") + 1])
                params = output_root / source.stem / "smplx_params"
                params.mkdir(parents=True)
                for index in range(4):
                    frame = {
                        "poses": [[0, 0, 0]] * 55,
                        "trans": [float(index), 0, 0],
                    }
                    (params / f"{index:05}.json").write_text(
                        json.dumps(frame), encoding="utf-8"
                    )
                return SimpleNamespace(returncode=0, stdout="ok", stderr="")

            with mock.patch.object(avatar_motion.config, "LHM_PYTHON", root / "python"), \
                 mock.patch.object(avatar_motion.config, "LHM_MOTION_SCRIPT", root / "video2motion.py"), \
                 mock.patch.object(avatar_motion.config, "LHM_MOTION_MODEL_PATH", root / "model"), \
                 mock.patch.object(avatar_motion.config, "LHM_WORKDIR", root), \
                 mock.patch.object(avatar_motion.subprocess, "run", side_effect=run_lhm):
                meta = avatar_motion.prepare_motion_asset(
                    source, coach_path, output, fps=15
                )

            self.assertEqual(meta["frames"], 2)
            _, rotations, trans = unpack_motion_asset(output)
            self.assertEqual(rotations.shape, (2, 55, 4))
            np.testing.assert_allclose(trans[:, 0], [0.0, 3.0], atol=1e-6)

    def test_prepare_motion_removes_lhm_duplicated_full_video_pass(self) -> None:
        avatar_motion = self._module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.mp4"
            source.write_bytes(b"video")
            coach_path = root / "coach.json"
            coach_path.write_text(
                json.dumps(
                    {
                        "frames": [
                            {"pelvis": {"position": [float(index), 0, 0]}}
                            for index in range(4)
                        ]
                    }
                ),
                encoding="utf-8",
            )
            output = root / "motion" / "motion.bin"
            progress_notes: list[str] = []

            def run_lhm(command, **kwargs):
                output_root = Path(command[command.index("--output_path") + 1])
                params = output_root / source.stem / "smplx_params"
                params.mkdir(parents=True)
                # Mirrors the affected upstream load_video(): the complete
                # sequence is appended twice, not each frame duplicated.
                for index, translation in enumerate((0.0, 10.0, 0.0, 10.0)):
                    frame = {
                        "poses": [[0, 0, 0]] * 55,
                        "trans": [translation, 0, 0],
                    }
                    (params / f"{index:05}.json").write_text(
                        json.dumps(frame), encoding="utf-8"
                    )
                return SimpleNamespace(returncode=0, stdout="ok", stderr="")

            with mock.patch.object(avatar_motion.config, "LHM_PYTHON", root / "python"), \
                 mock.patch.object(avatar_motion.config, "LHM_MOTION_SCRIPT", root / "video2motion.py"), \
                 mock.patch.object(avatar_motion.config, "LHM_MOTION_MODEL_PATH", root / "model"), \
                 mock.patch.object(avatar_motion.config, "LHM_WORKDIR", root), \
                 mock.patch.object(avatar_motion.subprocess, "run", side_effect=run_lhm):
                avatar_motion.prepare_motion_asset(
                    source,
                    coach_path,
                    output,
                    fps=15,
                    progress=lambda _current, _total, note: progress_notes.append(note),
                )

            _, _, trans = unpack_motion_asset(output)
            np.testing.assert_allclose(
                trans[:, 0], [0.0, 10.0 / 3.0, 20.0 / 3.0, 10.0], atol=1e-6
            )
            self.assertTrue(
                any("removed duplicated full-video pass" in note for note in progress_notes)
            )

    def test_prepare_motion_decodes_subprocess_output_independent_of_locale(self) -> None:
        avatar_motion = self._module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.mp4"
            source.write_bytes(b"video")
            coach_path = root / "coach.json"
            coach_path.write_text(
                json.dumps({"frames": [{"pelvis": {"position": [0, 0, 0]}}]}),
                encoding="utf-8",
            )
            script = root / "failing_lhm.py"
            script.write_text(
                "import os, sys\n"
                "os.write(2, b'LHM stderr: \\xe2\\x98\\x83 invalid=\\xff\\n')\n"
                "sys.exit(7)\n",
                encoding="ascii",
            )
            output = root / "motion" / "motion.bin"
            real_run = avatar_motion.subprocess.run

            with mock.patch.object(avatar_motion.config, "LHM_PYTHON", Path(sys.executable)), \
                 mock.patch.object(avatar_motion.config, "LHM_MOTION_SCRIPT", script), \
                 mock.patch.object(avatar_motion.config, "LHM_MOTION_MODEL_PATH", root), \
                 mock.patch.object(avatar_motion.config, "LHM_WORKDIR", root), \
                 mock.patch.object(avatar_motion.subprocess, "run", wraps=real_run) as run:
                try:
                    with self.assertRaisesRegex(
                        RuntimeError, "LHM stderr: ☃ invalid=�"
                    ):
                        avatar_motion.prepare_motion_asset(
                            source, coach_path, output, fps=15
                        )
                except UnicodeDecodeError as exc:
                    self.fail(f"subprocess output used locale/strict decoding: {exc}")

            kwargs = run.call_args.kwargs
            self.assertEqual(kwargs["encoding"], "utf-8")
            self.assertEqual(kwargs["errors"], "replace")
            self.assertTrue(kwargs["capture_output"])


if __name__ == "__main__":
    unittest.main()
