#!/usr/bin/env python3
"""Solve the similarity transform mapping the LHM avatar space onto the KINE//X
stage space, then bake it into a KINEXGS1 binary.

Stage space (CoachClip/MeshClip): meters, right-hand, Y up, pelvis-centred in XZ.
Avatar space (LHM smplx_params / exported T_posed): extractor camera frame.

We align pelvis/head/neck/ankle joint trajectories (avatar T_posed joints vs
CoachClip skeleton joints) with a Kabsch fit over sampled frames:
    p_stage = s * R @ p_avatar + t
Baking rules (shader math is linear):
    T_posed' = H @ T_posed   with H = [[sR, t],[0,1]]  (top 3 rows premultiplied)
    trans'   = sR @ trans + t
    c_pts / q_cano / scale unchanged (uniform scale keeps quat extraction sane).

Usage:
  python3 solve_alignment.py --npz avatar_debug.npz --clip public/coach_clips/ugc_squat.json \
      --bin-in avatar_coach.bin --bin-out gs_avatar_coach.bin --report alignment.json
"""
import argparse
import json
import struct
import sys

import numpy as np

# SMPL-X 55-joint indices (LHM joints_name order) → CoachClip joint names.
# Pelvis excluded on purpose: the CoachClip pelvis Y is pinned (~0.844 constant)
# by the import backend, so it has no fitting variance and only biases Kabsch.
JOINT_PAIRS = [
    (12, "neck"),
    (15, "head"),
    (7, "lAnkle"),
    (8, "rAnkle"),
    (4, "lKnee"),
    (5, "rKnee"),
]


def load_clip_positions(path):
    raw = json.load(open(path))
    frames = raw["frames"]
    out = {}  # name -> [F_clip, 3]
    for _, name in JOINT_PAIRS:
        out[name] = np.array([f[name]["position"] for f in frames], dtype=np.float64)
    return out, len(frames)


def avatar_joint_positions(npz, joint_null_key_candidates=("joint_null", "joints_null", "joint_zero")):
    T = npz["T_posed"].astype(np.float64)  # [F,55,4,4]
    trans = npz["trans"].astype(np.float64)  # [F,3]
    joint_null = None
    for k in joint_null_key_candidates:
        if k in npz.files:
            joint_null = npz[k].astype(np.float64)
            break
    F = T.shape[0]
    if joint_null is not None:
        # posed joint j = G_j @ [J_j; 1]  (G = T_j @ [I | -J_j])
        # NOTE: LHM lbs() adds the root translation AFTER LBS, so the FK chain
        # alone is in a root-relative frame — the surface being rendered lives
        # at FK + trans. The joints must get the same trans to be comparable.
        J = np.concatenate([joint_null, np.ones((55, 1))], axis=1)  # [55,4]
        posed = np.einsum("fjik,jk->fji", T, J)[:, :, :3] + trans[:, None, :]
    else:
        # Fallback: translation column of G_j (exact for pelvis≈root, off for others)
        print("[align] WARN: joint_null missing, using G translation column", file=sys.stderr)
        posed = T[:, :, :3, 3] + trans[:, None, :]
    return posed, F  # [F,55,3]


def kabsch(P, Q):
    """Best-fit p_Q ≈ s * R @ p_P + t. P,Q: [K,3]. Returns s, R(3,3), t(3)."""
    Pc = P.mean(axis=0)
    Qc = Q.mean(axis=0)
    P0 = P - Pc
    Q0 = Q - Qc
    H = P0.T @ Q0
    U, S, Vt = np.linalg.svd(H)
    d = np.sign(np.linalg.det(Vt.T @ U.T))
    D = np.diag([1.0, 1.0, d])
    R = Vt.T @ D @ U.T
    s = (S * np.diag(D)).sum() / (P0**2).sum()
    t = Qc - s * R @ Pc
    return s, R, t


def solve(npz_path, clip_path):
    npz = np.load(npz_path)
    clip_pos, F_clip = load_clip_positions(clip_path)
    posed, F_av = avatar_joint_positions(npz)

    pairs_P, pairs_Q = [], []
    # Temporal mapping found by trajectory cross-correlation: the 470-frame
    # avatar sequence spans 2x the clip (meta fps=30 → 15.7s vs clip 7.867s);
    # the clip corresponds to avatar frames [0, 235) at 2:1, i.e. a(i) = 2*i.
    # (Head-Y correlation mse=0.0091, sign=-1 → avatar Y is down vs stage.)
    av_span = (F_av - 1) // 2  # 234 for F=470
    for i in range(0, F_clip, 4):
        a = int(round(i * av_span / (F_clip - 1)))
        for j, name in JOINT_PAIRS:
            pairs_P.append(posed[a, j])
            pairs_Q.append(clip_pos[name][i])
    P = np.array(pairs_P)
    Q = np.array(pairs_Q)
    s, R, t = kabsch(P, Q)
    residual = np.linalg.norm(s * (P @ R.T) + t - Q, axis=1)
    report = {
        "scale": float(s),
        "R": R.tolist(),
        "t": t.tolist(),
        "pairs": int(len(P)),
        "residual_mean_m": float(residual.mean()),
        "residual_p95_m": float(np.percentile(residual, 95)),
        "residual_max_m": float(residual.max()),
        "yaw_deg": float(np.degrees(np.arctan2(R[0, 2], R[2, 2]))),
    }
    return s, R, t, report


def bake(bin_in, bin_out, s, R, t, meta_extra, frame_end=None):
    buf = open(bin_in, "rb").read()
    if buf[:8] != b"KINEXGS1":
        raise SystemExit("bad magic")
    N, F, J, hlen = struct.unpack_from("<4I", buf, 8)
    off = 24
    meta = json.loads(buf[off : off + hlen].decode("utf-8"))
    off += hlen
    # Static per-gaussian section: (3+4+3+1+3+9)*N f32 + N*4 u8 + N*4*4 f32 + N u8
    static_floats = (3 + 4 + 3 + 1 + 3 + 9) * N
    static_bytes = buf[off : off + static_floats * 4]
    off += static_floats * 4
    lbs_bytes = buf[off : off + N * 4 + N * 4 * 4]
    off += N * 4 + N * 4 * 4
    constrain_bytes = buf[off : off + N]
    off += N
    # mat4s are stored column-major == row-major bytes of the transpose.
    A = np.frombuffer(buf, dtype=np.float32, count=F * J * 16, offset=off).reshape(F, J, 4, 4).copy()
    off += F * J * 16 * 4
    trans = np.frombuffer(buf, dtype=np.float32, count=F * 3, offset=off).reshape(F, 3).copy()

    # Trim to the span that temporally matches the coach clip (see solve()).
    end = frame_end if frame_end is not None else F
    A = A[:end]
    trans = trans[:end]
    F = end

    # M' = [[sR, 0],[0,1]] @ M  — the translation must NOT be baked into the
    # matrix (the shader adds trans AFTER LBS); it only goes into trans':
    #   p' = sR·M·c + (sR·trans + t) = sR·(M·c + trans) + t
    # In transpose space (A stores M^T per joint): M'^T = M^T @ [[sR^T,0],[0,1]].
    B = np.eye(4)
    B[:3, :3] = (s * R).T
    A_new = A @ B
    trans_new = (s * R) @ trans.T + t[:, None]
    trans_new = trans_new.T

    meta.update(meta_extra)
    mbytes = json.dumps(meta).encode("utf-8")
    with open(bin_out, "wb") as f:
        f.write(b"KINEXGS1")
        f.write(struct.pack("<4I", N, F, J, len(mbytes)))
        f.write(mbytes)
        f.write(static_bytes)
        f.write(lbs_bytes)
        f.write(constrain_bytes)
        f.write(A_new.astype(np.float32).tobytes())
        f.write(trans_new.astype(np.float32).tobytes())
    print(f"[align] baked {bin_out}: N={N} F={F} J={J}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--npz", required=True)
    ap.add_argument("--clip", required=True)
    ap.add_argument("--bin-in")
    ap.add_argument("--bin-out")
    ap.add_argument("--report", default="alignment_report.json")
    args = ap.parse_args()

    s, R, t, report = solve(args.npz, args.clip)
    print(json.dumps(report, indent=2))
    with open(args.report, "w") as f:
        json.dump(report, f, indent=2)
    if args.bin_in and args.bin_out:
        av_span = (np.load(args.npz)["T_posed"].shape[0] - 1) // 2
        bake(
            args.bin_in,
            args.bin_out,
            s,
            R,
            t,
            {"scale": report["scale"], "R": report["R"], "t": report["t"], "residual_mean_m": report["residual_mean_m"]},
            frame_end=av_span + 1,
        )


if __name__ == "__main__":
    main()
