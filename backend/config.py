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

# --- Avatar (photo → 3DGS digital double) import ---
# The LHM exporter runs as a subprocess in its own conda env.
LHM_PYTHON = _env_path("LHM_PYTHON", Path("/root/autodl-tmp/envs/lhm/bin/python"))
LHM_EXPORT_SCRIPT = _env_path("LHM_EXPORT_SCRIPT", Path("/root/autodl-tmp/LHM/export_avatar_kinex.py"))
LHM_MOTION_SCRIPT = _env_path(
    "LHM_MOTION_SCRIPT",
    Path("/root/autodl-tmp/LHM/engine/pose_estimation/video2motion.py"),
)
LHM_MOTION_MODEL_PATH = _env_path(
    "LHM_MOTION_MODEL_PATH",
    Path("/root/autodl-tmp/LHM/pretrained_models/human_model_files"),
)
LHM_WORKDIR = _env_path("LHM_WORKDIR", Path("/root/autodl-tmp/LHM"))
# A motionParams form value `<name>` maps to <AVATAR_MOTION_ROOT>/<name>/smplx_params.
AVATAR_MOTION_ROOT = _env_path(
    "AVATAR_MOTION_ROOT", Path("/root/autodl-tmp/LHM/train_data/custom_motion")
)
# CoachClip the exported avatar is aligned onto (defines the stage space).
AVATAR_ALIGN_CLIP = _env_path(
    "AVATAR_ALIGN_CLIP", REPO_ROOT / "public" / "coach_clips" / "ugc_squat.json"
)
# Finished avatar artifacts: <AVATAR_JOBS_DIR>/<jobId>.bin + <jobId>.json meta.
# Must stay under PUBLIC_JOBS_DIR — the frontend rsync excludes coach_clips/jobs,
# anything outside that subtree gets wiped on the next frontend sync.
AVATAR_JOBS_DIR = _env_path("AVATAR_JOBS_DIR", PUBLIC_JOBS_DIR / "avatar")
# Avatar Vault manifests and binary assets are siblings under the static
# coach-clip root so frontend URLs can be served without a separate store.
AVATAR_REGISTRY_ROOT = _env_path("AVATAR_REGISTRY_ROOT", REPO_ROOT / "public" / "coach_clips")
AVATAR_IDENTITIES_DIR = _env_path("AVATAR_IDENTITIES_DIR", AVATAR_REGISTRY_ROOT / "avatar-identities")
AVATAR_MOTIONS_DIR = _env_path("AVATAR_MOTIONS_DIR", AVATAR_REGISTRY_ROOT / "motions")
AVATAR_BINDINGS_DIR = _env_path("AVATAR_BINDINGS_DIR", AVATAR_REGISTRY_ROOT / "avatar-bindings")
# Uploaded videos selected for LHM motion preparation must never live under
# PUBLIC_JOBS_DIR because the development static server exposes every file
# there, including dotfiles. This user-private root survives process restarts.
AVATAR_PRIVATE_JOBS_DIR = _env_path(
    "AVATAR_PRIVATE_JOBS_DIR",
    Path("~/.local/share/kinex/avatar-jobs").expanduser(),
)
AVATAR_MAX_PHOTO_BYTES = int(os.environ.get("AVATAR_MAX_PHOTO_BYTES", str(10 * 1024 * 1024)))
AVATAR_EXPORT_TIMEOUT_SEC = int(os.environ.get("AVATAR_EXPORT_TIMEOUT_SEC", "1200"))
AVATAR_ALIGN_TIMEOUT_SEC = int(os.environ.get("AVATAR_ALIGN_TIMEOUT_SEC", "180"))
LHM_MOTION_TIMEOUT_SEC = int(os.environ.get("LHM_MOTION_TIMEOUT_SEC", "1800"))
# Stub mode (AVATAR_EXPORT_STUB=1): skip the GPU export, reuse a baked bin+npz pair.
AVATAR_STUB_BIN = _env_path("AVATAR_STUB_BIN", Path("/root/lhm_outputs/avatar_squat.bin"))
AVATAR_STUB_NPZ = _env_path("AVATAR_STUB_NPZ", Path("/root/lhm_outputs/avatar_coach_debug.npz"))


def avatar_export_stub() -> bool:
    return os.environ.get("AVATAR_EXPORT_STUB", "") == "1"


def relative_to_repo(path: Path) -> str:
    """Return a forward-slash POSIX path relative to the repo root.

    The frontend fetches via `:5173/<rel>` so the same string the static
    server expects is what we want to put in the response.
    """
    return path.resolve().relative_to(REPO_ROOT).as_posix()
