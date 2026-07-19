"""Photo → 3DGS avatar pipeline: LHM export (subprocess) → stage alignment → KINEXGS1 bin.

Mirrors pipeline.py's contract: a blocking `run_avatar_pipeline` that app.py
executes via run_in_executor, with progress callbacks and artifacts landing
under config.AVATAR_JOBS_DIR (<PUBLIC_JOBS_DIR>/avatar).
"""
from __future__ import annotations

import json
import re
import select
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Callable

import numpy as np

from . import config
from .avatar_assets import split_legacy_asset
from .pipeline import safe_name

# The exporter prints "== stage N: ... ==" markers on stdout; map them to the
# job progress contract (align=90, done=100 are emitted by this module).
STAGE_PROGRESS = {1: 20, 2: 45, 3: 60, 4: 80, 5: 82, 6: 85, 7: 87, 8: 88}
STAGE_RE = re.compile(r"== stage (\d+)")
ALIGN_PROGRESS = 90
ERROR_TAIL_CHARS = 500
SMPLX_55_PARENTS = (
    -1, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 12, 13, 14,
    16, 17, 18, 19, 15, 15, 15, 20, 25, 26, 20, 28, 29, 20, 31, 32,
    20, 34, 35, 20, 37, 38, 21, 40, 41, 21, 43, 44, 21, 46, 47, 21,
    49, 50, 21, 52, 53,
)

ProgressCb = Callable[[str, int, int, str], None]


def motion_params_dir(name: str) -> Path:
    """Resolve a motionParams form value to an existing smplx_params directory."""
    candidate = config.AVATAR_MOTION_ROOT / safe_name(name) / "smplx_params"
    if not candidate.is_dir():
        raise FileNotFoundError(f"motionParams '{name}' not found: {candidate}")
    return candidate


def _tail(text: str, limit: int = ERROR_TAIL_CHARS) -> str:
    return text[-limit:] if len(text) > limit else text


def _read_stderr_tail(err_fh) -> str:
    err_fh.flush()
    err_fh.seek(0)
    return _tail(err_fh.read())


def _run_export(
    photo_path: Path,
    motion_dir: Path,
    raw_bin: Path,
    debug_npz: Path,
    viz_path: Path,
    progress: ProgressCb,
) -> None:
    """Run the LHM exporter as a subprocess, streaming stdout for stage progress.

    stderr goes to a scratch file so a failure can report its tail without
    risking a pipe deadlock while stdout is being drained.
    """
    # -u: unbuffered stdout, so "== stage N ==" markers reach us in real time
    # (a piped child otherwise block-buffers and progress only moves at exit).
    cmd = [
        str(config.LHM_PYTHON),
        "-u",
        str(config.LHM_EXPORT_SCRIPT),
        "--image", str(photo_path),
        "--motion-dir", str(motion_dir),
        "--out", str(raw_bin),
        "--npz", str(debug_npz),
        "--viz", str(viz_path),
    ]
    deadline = time.monotonic() + config.AVATAR_EXPORT_TIMEOUT_SEC
    with tempfile.TemporaryFile(mode="w+t") as err_fh:
        proc = subprocess.Popen(
            cmd,
            cwd=str(config.LHM_WORKDIR),
            stdout=subprocess.PIPE,
            stderr=err_fh,
            text=True,
        )
        assert proc.stdout is not None
        while True:
            if proc.poll() is not None:
                for line in proc.stdout:  # drain whatever is left
                    _handle_export_line(line, progress)
                break
            ready, _, _ = select.select([proc.stdout], [], [], 1.0)
            if ready:
                line = proc.stdout.readline()
                if line:
                    _handle_export_line(line, progress)
            if time.monotonic() > deadline:
                proc.kill()
                proc.wait()
                raise TimeoutError(
                    f"LHM export exceeded {config.AVATAR_EXPORT_TIMEOUT_SEC}s: "
                    f"{_read_stderr_tail(err_fh)}"
                )
        if proc.returncode != 0:
            raise RuntimeError(
                f"LHM export failed (rc={proc.returncode}): {_read_stderr_tail(err_fh)}"
            )
    if not raw_bin.exists() or not debug_npz.exists():
        raise RuntimeError("LHM export finished but bin/npz artifact is missing")


def _handle_export_line(line: str, progress: ProgressCb) -> None:
    match = STAGE_RE.search(line)
    if not match:
        return
    pct = STAGE_PROGRESS.get(int(match.group(1)))
    if pct is not None:
        progress("export", pct, 100, line.strip())


def _run_alignment(debug_npz: Path, raw_bin: Path, final_bin: Path, report_path: Path) -> dict:
    """Bake the stage-space similarity transform into the final bin (base env, numpy only)."""
    script = Path(__file__).resolve().parent / "alignment.py"
    cmd = [
        sys.executable,
        str(script),
        "--npz", str(debug_npz),
        "--clip", str(config.AVATAR_ALIGN_CLIP),
        "--bin-in", str(raw_bin),
        "--bin-out", str(final_bin),
        "--report", str(report_path),
    ]
    result = subprocess.run(
        cmd, capture_output=True, text=True, timeout=config.AVATAR_ALIGN_TIMEOUT_SEC
    )
    if result.returncode != 0:
        raise RuntimeError(f"alignment failed (rc={result.returncode}): {_tail(result.stderr)}")
    with report_path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def run_avatar_pipeline(
    photo_path: Path,
    avatar_id: str,
    *,
    name: str,
    motion_params: str,
    identity_dir: Path | None = None,
    progress: ProgressCb | None = None,
) -> dict:
    """Build and publish one reusable identity without attaching a motion seed."""
    photo_path = Path(photo_path).resolve()
    if not photo_path.exists():
        raise FileNotFoundError(photo_path)
    motion_dir = motion_params_dir(motion_params)
    identity_dir = Path(identity_dir or (config.AVATAR_IDENTITIES_DIR / avatar_id))

    def emit(stage: str, current: int, total: int, note: str = "") -> None:
        if progress:
            progress(stage, current, total, note)

    identity_dir.mkdir(parents=True, exist_ok=True)
    workdir = Path(tempfile.mkdtemp(prefix=f"kinex-avatar-{avatar_id}-"))
    try:
        raw_bin = workdir / "avatar_raw.bin"
        debug_npz = workdir / "avatar_debug.npz"
        viz_path = workdir / "avatar_viz.png"
        report_path = workdir / "alignment_report.json"
        aligned_bin = workdir / "avatar_aligned.bin"
        discarded_motion = workdir / "motion.bin"
        identity_path = identity_dir / "identity.bin"

        if config.avatar_export_stub():
            emit("export", 20, 100, "stub: reusing baked bin+npz")
            shutil.copyfile(config.AVATAR_STUB_BIN, raw_bin)
            shutil.copyfile(config.AVATAR_STUB_NPZ, debug_npz)
            emit("export", 80, 100, "stub export done")
        else:
            _run_export(photo_path, motion_dir, raw_bin, debug_npz, viz_path, emit)

        emit("align", ALIGN_PROGRESS, 100, "solve_alignment")
        alignment = _run_alignment(debug_npz, raw_bin, aligned_bin, report_path)
        try:
            with np.load(debug_npz, allow_pickle=False) as exporter_meta:
                joint_null = np.asarray(exporter_meta["joint_null"], dtype=np.float32)
        except KeyError as exc:
            raise ValueError("LHM exporter metadata is missing joint_null") from exc
        split_legacy_asset(
            aligned_bin,
            identity_path,
            discarded_motion,
            joint_null,
            SMPLX_55_PARENTS,
            stage_transform_baked=True,
        )

        preview_source = viz_path if viz_path.is_file() else photo_path
        preview_suffix = preview_source.suffix.lower()
        if preview_suffix not in {".jpg", ".jpeg", ".png", ".webp"}:
            preview_suffix = ".jpg"
        if preview_suffix == ".jpeg":
            preview_suffix = ".jpg"
        preview_path = identity_dir / f"preview{preview_suffix}"
        shutil.copyfile(preview_source, preview_path)
        emit("done", 100, 100, identity_path.name)

        return {
            "avatarId": avatar_id,
            "name": name,
            "identityUrl": config.relative_to_repo(identity_path),
            "previewUrl": config.relative_to_repo(preview_path),
            "alignment": alignment,
        }
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
