"""Runtime configuration for the import backend.

All paths can be overridden by env var with the same name. Defaults match the
artifacts found on the development host.
"""
from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def _env_path(name: str, default: Path) -> Path:
    raw = os.environ.get(name)
    return Path(raw).expanduser() if raw else default


# SAM 3D Body checkpoint + MHR asset (used at app startup).
SAM_CHECKPOINT = _env_path(
    "SAM_CHECKPOINT",
    Path("~/.cache/modelscope/hub/models/facebook/sam-3d-body-dinov3/model.ckpt").expanduser(),
)
SAM_MHR_PATH = _env_path(
    "SAM_MHR_PATH",
    Path("~/.cache/modelscope/hub/models/facebook/sam-3d-body-dinov3/assets/mhr_model.pt").expanduser(),
)

# MHR→SMPLX barycentric mapping + the SMPLX neutral asset (used by mesh bake).
MHR2SMPLX_MAPPING = _env_path(
    "MHR2SMPLX_MAPPING",
    Path("/mnt/data/home/zhangjinkai/sam_3d_smpl_workspace/MHR/tools/mhr_smpl_conversion/assets/mhr2smplx_mapping.npz"),
)
SMPLX_NEUTRAL = _env_path(
    "SMPLX_NEUTRAL",
    Path("/mnt/data/home/zhangjinkai/sam/smpl_models/smplx/SMPLX_NEUTRAL.npz"),
)

# Where finished job artifacts land. The frontend (:5173 static server) serves
# this directory directly via relative URLs like
# "public/coach_clips/jobs/<id>/coach.json".
PUBLIC_JOBS_DIR = _env_path("PUBLIC_JOBS_DIR", REPO_ROOT / "public" / "coach_clips" / "jobs")

# Allowed CORS origin for the frontend.
FRONTEND_ORIGIN = os.environ.get("FRONTEND_ORIGIN", "http://localhost:5173")

# Pipeline knobs.
DEFAULT_TARGET_FPS = int(os.environ.get("DEFAULT_TARGET_FPS", "15"))
DEFAULT_THUMBNAIL_COUNT = int(os.environ.get("DEFAULT_THUMBNAIL_COUNT", "18"))


def relative_to_repo(path: Path) -> str:
    """Return a forward-slash POSIX path relative to the repo root.

    The frontend fetches via `:5173/<rel>` so the same string the static
    server expects is what we want to put in the response.
    """
    return path.resolve().relative_to(REPO_ROOT).as_posix()
