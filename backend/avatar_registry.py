"""Atomically persisted manifests for reusable avatar identities and motions."""
from __future__ import annotations

import json
import os
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any


_TERMINAL_BINDING_STATUSES = {"ready", "error", "cancelled"}
_CANCELLABLE_BINDING_STATUSES = {"queued", "running"}


class AvatarRegistry:
    """Filesystem source of truth for Avatar Vault records.

    ``root`` contains the three manifest directories.  The registry deliberately
    has no process-global state, which makes a temporary root suitable for tests
    and lets application startup reconstruct all records from disk.
    """

    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self.identities_dir = self.root / "avatar-identities"
        self.motions_dir = self.root / "motions"
        self.bindings_dir = self.root / "avatar-bindings"
        self._lock = threading.RLock()

    def list_identities(self, *, include_deleted: bool = False) -> list[dict[str, Any]]:
        """Return identities ordered newest first, excluding tombstones by default."""
        with self._lock:
            records = self._read_records(self.identities_dir, "*/record.json")
            if not include_deleted:
                records = [record for record in records if record.get("deletedAt") is None]
            return sorted(records, key=lambda record: _timestamp(record.get("createdAt")), reverse=True)

    def create_identity(self, name: str, **fields: Any) -> dict[str, Any]:
        """Create a queued identity manifest with a stable ``av-`` identifier."""
        with self._lock:
            avatar_id = _new_id("av-")
            record = {
                "avatarId": avatar_id,
                "name": name,
                "status": "queued",
                "progress": 0,
                "createdAt": time.time(),
            }
            record.update(fields)
            record["avatarId"] = avatar_id
            self._write_json(self._identity_path(avatar_id), record)
            return record

    def update_identity(self, avatar_id: str, **changes: Any) -> dict[str, Any]:
        """Persist a partial update to an existing identity manifest."""
        with self._lock:
            record = self._load_required(self._identity_path(avatar_id), "identity", avatar_id)
            record.update(changes)
            record["avatarId"] = avatar_id
            self._write_json(self._identity_path(avatar_id), record)
            return record

    def soft_delete_identity(self, avatar_id: str) -> dict[str, Any]:
        """Tombstone an identity and cancel only bindings not already terminal."""
        with self._lock:
            record = self._load_required(self._identity_path(avatar_id), "identity", avatar_id)
            if record.get("deletedAt") is None:
                record["deletedAt"] = time.time()
                self._write_json(self._identity_path(avatar_id), record)

            for binding in self._read_records(self.bindings_dir, "*.json"):
                if binding.get("avatarId") != avatar_id:
                    continue
                if binding.get("status") not in _CANCELLABLE_BINDING_STATUSES:
                    continue
                binding["status"] = "cancelled"
                binding["finishedAt"] = time.time()
                binding.setdefault("error", "identity deleted")
                binding_id = _required_id(binding, "bindingId", "binding-")
                self._write_json(self._binding_path(binding_id), binding)
            return record

    def upsert_motion(self, motion_id: str | None = None, **fields: Any) -> dict[str, Any]:
        """Create or update a reusable motion manifest.

        Callers may supply a deterministic source identifier; it is normalized
        to the required ``motion-`` prefix.  Omitting it generates a UUID-backed
        stable identifier.
        """
        with self._lock:
            canonical_id = _motion_id(motion_id) if motion_id else _new_id("motion-")
            path = self._motion_path(canonical_id)
            if path.exists():
                record = self._load_required(path, "motion", canonical_id)
            else:
                record = {
                    "motionId": canonical_id,
                    "status": "queued",
                    "progress": 0,
                    "createdAt": time.time(),
                }
            record.update(fields)
            record["motionId"] = canonical_id
            self._write_json(path, record)
            return record

    def create_binding(self, avatar_id: str, motion_id: str) -> dict[str, Any]:
        """Create or return the sole binding for an identity-motion pair."""
        with self._lock:
            identity = self._load_required(self._identity_path(avatar_id), "identity", avatar_id)
            if identity.get("deletedAt") is not None:
                raise ValueError(f"identity '{avatar_id}' is deleted")
            motion = self._load_required(self._motion_path(motion_id), "motion", motion_id)

            for binding in self._read_records(self.bindings_dir, "*.json"):
                if binding.get("avatarId") == avatar_id and binding.get("motionId") == motion_id:
                    return binding

            binding_id = _new_id("binding-")
            record = {
                "bindingId": binding_id,
                "avatarId": avatar_id,
                "motionId": motion_id,
                "status": "queued",
                "progress": 0,
                "createdAt": time.time(),
                "identityUrl": identity.get("identityUrl") or identity.get("avatarBinUrl"),
                "motionAssetUrl": motion.get("motionAssetUrl") or motion.get("motionUrl"),
            }
            self._write_json(self._binding_path(binding_id), record)
            return record

    def update_binding(self, binding_id: str, **changes: Any) -> dict[str, Any]:
        """Persist binding progress while preventing a cancelled binding revival."""
        with self._lock:
            record = self._load_required(self._binding_path(binding_id), "binding", binding_id)
            requested_status = changes.get("status")
            if record.get("status") == "cancelled" and requested_status not in (None, "cancelled"):
                return record
            record.update(changes)
            record["bindingId"] = binding_id
            if record.get("status") in _TERMINAL_BINDING_STATUSES and not record.get("finishedAt"):
                record["finishedAt"] = time.time()
            self._write_json(self._binding_path(binding_id), record)
            return record

    def list_bindings(
        self, *, avatar_id: str | None = None, motion_id: str | None = None
    ) -> list[dict[str, Any]]:
        """Return bindings, optionally narrowed by identity and/or motion."""
        with self._lock:
            records = self._read_records(self.bindings_dir, "*.json")
            if avatar_id is not None:
                records = [record for record in records if record.get("avatarId") == avatar_id]
            if motion_id is not None:
                records = [record for record in records if record.get("motionId") == motion_id]
            return sorted(records, key=lambda record: _timestamp(record.get("createdAt")), reverse=True)

    def _identity_path(self, avatar_id: str) -> Path:
        _require_prefixed_id(avatar_id, "av-")
        return self.identities_dir / avatar_id / "record.json"

    def _motion_path(self, motion_id: str) -> Path:
        _require_prefixed_id(motion_id, "motion-")
        return self.motions_dir / motion_id / "record.json"

    def _binding_path(self, binding_id: str) -> Path:
        _require_prefixed_id(binding_id, "binding-")
        return self.bindings_dir / f"{binding_id}.json"

    @staticmethod
    def _read_records(directory: Path, pattern: str) -> list[dict[str, Any]]:
        if not directory.is_dir():
            return []
        records: list[dict[str, Any]] = []
        for path in directory.glob(pattern):
            try:
                with path.open("r", encoding="utf-8") as handle:
                    record = json.load(handle)
            except (OSError, json.JSONDecodeError):
                continue
            if isinstance(record, dict):
                records.append(record)
        return records

    @staticmethod
    def _load_required(path: Path, kind: str, record_id: str) -> dict[str, Any]:
        try:
            with path.open("r", encoding="utf-8") as handle:
                record = json.load(handle)
        except FileNotFoundError as exc:
            raise KeyError(f"{kind} '{record_id}' does not exist") from exc
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(f"{kind} '{record_id}' has an invalid manifest") from exc
        if not isinstance(record, dict):
            raise ValueError(f"{kind} '{record_id}' has an invalid manifest")
        return record

    @staticmethod
    def _write_json(path: Path, record: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_name: str | None = None
        try:
            with tempfile.NamedTemporaryFile(
                "w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", delete=False
            ) as handle:
                temp_name = handle.name
                json.dump(record, handle, separators=(",", ":"), allow_nan=False)
                handle.flush()
                os.fsync(handle.fileno())
            Path(temp_name).replace(path)
        except Exception:
            if temp_name:
                Path(temp_name).unlink(missing_ok=True)
            raise


def _new_id(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex}"


def _motion_id(value: str) -> str:
    return value if value.startswith("motion-") else f"motion-{value}"


def _require_prefixed_id(value: str, prefix: str) -> None:
    if not isinstance(value, str) or not value.startswith(prefix) or not value[len(prefix) :]:
        raise ValueError(f"identifier must start with '{prefix}'")
    suffix = value[len(prefix) :]
    if not all(char.isascii() and (char.isalnum() or char in "_-") for char in suffix):
        raise ValueError("identifier contains unsafe characters")


def _required_id(record: dict[str, Any], key: str, prefix: str) -> str:
    value = record.get(key)
    _require_prefixed_id(value, prefix)
    return value


def _timestamp(value: Any) -> float:
    return float(value) if isinstance(value, (int, float)) else 0.0
