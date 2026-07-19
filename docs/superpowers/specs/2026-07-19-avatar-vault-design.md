---
title: Avatar Vault and reusable 3DGS identity design
form: design
topic: [product, architecture, avatar]
updated: 2026-07-19
status: active
tags: [avatar-vault, 3dgs, motion]
---

# Avatar Vault and reusable 3DGS identity design

## Goal

Add a server-backed avatar management page and decouple a person's 3DGS identity from motion. A user creates an identity once, previews it in a dedicated gallery, and may optionally select it while importing any action video. The ordinary CoachClip and mesh become available as soon as motion import completes; avatar playback unlocks later without blocking the training flow.

## Product decisions

- Add a fifth SPA route, `#/avatars`, and a matching rail entry.
- The server is the source of truth. Browser storage is not authoritative.
- The avatar gallery supports upload, progress, retry, rename, orbit preview, zoom, and conservative deletion.
- Avatar selection in the video creation flow is optional and limited to zero or one identity.
- The ordinary motion seed is usable before avatar preparation finishes.
- A failed avatar binding never invalidates a successful motion import.
- The primary result is a rotatable real-time 3DGS avatar in the training bay. Video export remains an explicit later action through the existing canvas recorder.

## Asset boundaries

### AvatarIdentity

An identity contains only canonical appearance and skinning data:

- canonical gaussian position, rotation, scale, opacity, and color;
- canonical skeleton metadata and top-four LBS weights;
- a stable stage transform and preview metadata;
- no per-motion frame matrices.

The binary format uses the `KINEXGSI1` header. The initial implementation may derive an identity file from an existing `KINEXGS1` file by retaining the static gaussian section and omitting the motion section.

### MotionAsset

A motion contains only reusable animation data:

- duration, frame rate, and frame count;
- per-frame 55-joint SMPL-X matrices;
- root translation and stage-space transform;
- references to the corresponding CoachClip and MeshClip.

The binary format uses the `KINEXGSM1` header. A motion is produced once per imported video and can drive any compatible identity.

### AvatarBinding

A binding records a user choice and readiness state:

```ts
interface AvatarBinding {
  bindingId: string;
  avatarId: string;
  motionId: string;
  status: "queued" | "running" | "ready" | "error" | "cancelled";
  progress: number;
  error?: string;
  createdAt: number;
  finishedAt?: number;
}
```

The binding does not duplicate gaussian or motion data. It validates compatibility and exposes the two URLs the runtime must combine.

## Server persistence

Use filesystem JSON manifests, consistent with the current prototype and its existing `/import/jobs` persistence. No database or authentication is introduced.

```text
public/coach_clips/avatar-identities/<avatarId>/
  identity.bin
  preview.jpg
  record.json

public/coach_clips/motions/<motionId>/
  motion.bin
  record.json

public/coach_clips/avatar-bindings/<bindingId>.json
```

The API exposes:

- `GET /avatars` — active identities, newest first;
- `POST /avatars` — upload a photo and enqueue identity generation;
- `PATCH /avatars/{avatarId}` — rename an identity;
- `DELETE /avatars/{avatarId}` — soft-delete it and cancel unfinished bindings;
- `GET /avatar-bindings` — query binding status, optionally by motion or avatar;
- `POST /avatar-bindings` — create or return the existing binding for an avatar-motion pair;
- the video import response gains a stable `motionId` and `motionAssetUrl` when motion packing succeeds.

Identity generation remains serialized behind the existing GPU lock. Binding creation is idempotent on `(avatarId, motionId)`.

## Conservative deletion

Deleting an identity removes it from the selectable gallery and deletes its uploaded source photo. Completed bindings remain playable. Because the runtime combines identity and motion without duplicating them, the identity binary is retained while any completed binding references it. It becomes eligible for garbage collection only after its final completed binding is removed. Pending bindings are marked cancelled and must not publish a ready result afterward.

## Frontend architecture

### AvatarVaultPage

`AvatarVaultPage` owns page-level rendering only. It consumes an `AvatarRegistryClient` and contains:

- `AvatarGallery` for identity cards and job status;
- a `GaussianAvatarPreview` that reuses the production renderer;
- upload, retry, rename, and delete controls;
- explicit empty, loading, offline, error, building, and ready states.

The page polls while any identity is queued or running and stops polling when all records are terminal or the page leaves.

### Creation flow

The video branch of `CreatePage` receives an optional avatar picker. `ImportFlow` carries only the selected `avatarId`; it remains responsible for motion import. After motion import succeeds:

1. the new exercise is added immediately;
2. if an avatar was selected, the frontend creates an `AvatarBinding`;
3. the training route opens without waiting;
4. binding status is polled in the background;
5. the training bay unlocks avatar mode when the binding becomes ready.

The existing photo branch moves to the dedicated avatar page. A compatibility link may navigate from Create to `#/avatars`.

### Runtime

Refactor `GaussianAvatar` into independently loadable identity and motion inputs:

```ts
const avatar = await GaussianAvatar.loadIdentity(identityUrl);
const motion = await GaussianMotion.load(motionUrl);
avatar.setMotion(motion);
avatar.setProgress(progress);
avatar.update(camera);
```

The shader continues to perform LBS and the CPU continues depth sorting. The frame clock remains driven by `RealtimeStream`; no high-frequency data enters UI state or EventBus.

Legacy `KINEXGS1` remains readable during migration. The committed `gs_avatar_coach.bin` is exposed as one migrated identity plus one squat motion, without changing the existing demo behavior.

## Recovery and errors

- Reloading reconstructs identities, motions, and bindings from server manifests.
- Avatar-list failure shows an explicit retry state; it does not invent local records.
- Identity generation error preserves the record and allows retry.
- Motion import success plus binding failure leaves the ordinary exercise usable.
- A deleted identity cannot be selected for new bindings.
- Unknown or incompatible binary headers fail before allocating WebGL buffers.
- A stale completion callback cannot revive a cancelled or deleted record.
- WebGL failure keeps metadata and management actions available while disabling the 3D preview.

## Verification

- Backend unit tests cover manifest parsing, newest-first ordering, idempotent bindings, conservative deletion, cancellation, and restart hydration.
- Binary parser tests cover identity/motion headers, counts, truncation, and legacy compatibility.
- Frontend tests use the project's guardrail gate plus deterministic mock API fixtures.
- Browser acceptance covers gallery empty/loading/ready/error states, orbit preview, optional avatar selection, progressive training entry, automatic avatar unlock, reload recovery, and conservative deletion.
- `npm run check` must pass before completion.

## Non-goals

- User accounts, authentication, quotas, and cross-tenant isolation.
- Cloud object storage or a database.
- Applying multiple identities to one motion simultaneously.
- Automatically rendering MP4 during import.
- Editing a reconstructed identity's body, clothing, or appearance.
