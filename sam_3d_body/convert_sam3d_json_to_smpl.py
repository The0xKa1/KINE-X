# Copyright (c) Meta Platforms, Inc. and affiliates.
import argparse
import json
import os
import pickle
import sys
from pathlib import Path

import numpy as np


def load_sam3d_people(json_path, include_vertices=True, person_id=None):
    with open(json_path, "r") as f:
        data = json.load(f)

    sam3d_outputs = []
    frame_refs = []
    required = ["mhr_model_params", "shape_params", "expr_params", "pred_cam_t"]
    if include_vertices:
        required.append("pred_vertices")

    for frame in data["frames"]:
        for person in frame.get("people", []):
            if person_id is not None and person.get("person_id") != person_id:
                continue
            missing = [key for key in required if person.get(key) is None]
            if missing:
                raise ValueError(
                    "Missing fields for frame "
                    f"{frame.get('frame_index')} person {person.get('person_id')}: "
                    + ", ".join(missing)
                )
            output = {
                "mhr_model_params": np.asarray(
                    person["mhr_model_params"], dtype=np.float32
                ),
                "shape_params": np.asarray(person["shape_params"], dtype=np.float32),
                "expr_params": np.asarray(person["expr_params"], dtype=np.float32),
                "pred_cam_t": np.asarray(person["pred_cam_t"], dtype=np.float32),
            }
            if include_vertices:
                output["pred_vertices"] = np.asarray(
                    person["pred_vertices"], dtype=np.float32
                )
            sam3d_outputs.append(output)
            frame_refs.append(
                {
                    "frame_index": frame.get("frame_index"),
                    "time_sec": frame.get("time_sec"),
                    "person_id": person.get("person_id"),
                }
            )

    if not sam3d_outputs:
        raise ValueError("No SAM3D person records found in input JSON.")

    return data, sam3d_outputs, frame_refs


def add_conversion_tool_to_path(mhr_repo):
    tool_dir = Path(mhr_repo).expanduser().resolve() / "tools" / "mhr_smpl_conversion"
    if not tool_dir.is_dir():
        raise FileNotFoundError(f"Missing MHR conversion tool directory: {tool_dir}")
    sys.path.insert(0, str(tool_dir))
    os.chdir(tool_dir)
    return tool_dir


def convert_smpl_npz_to_pickle_if_needed(model_path):
    model_path = Path(model_path).expanduser().resolve()
    if model_path.suffix.lower() != ".npz":
        return str(model_path)

    converted_path = model_path.with_name(model_path.stem + "_generated_from_npz.pkl")
    if not converted_path.exists():
        model_data = dict(np.load(model_path, allow_pickle=True))
        with open(converted_path, "wb") as f:
            pickle.dump(model_data, f)
    return str(converted_path)


def build_smpl_model(args):
    import smplx

    if args.smplx_model:
        return smplx.SMPLX(
            model_path=str(Path(args.smplx_model).expanduser().resolve()),
            gender=args.gender,
            use_pca=False,
            flat_hand_mean=True,
        )
    if args.smpl_model:
        return smplx.SMPL(
            model_path=convert_smpl_npz_to_pickle_if_needed(args.smpl_model),
            gender=args.gender,
        )
    raise ValueError("Pass either --smpl_model or --smplx_model.")


def numpy_result_parameters(result_parameters):
    if result_parameters is None:
        return {}
    converted = {}
    for key, value in result_parameters.items():
        if hasattr(value, "detach"):
            value = value.detach().cpu().numpy()
        converted[f"smpl_{key}"] = np.asarray(value)
    return converted


def convert_with_reconstructed_mhr_vertices(converter, sam3d_outputs, args):
    import torch

    mhr_parameters = {
        "lbs_model_params": converter._to_tensor(
            np.stack([item["mhr_model_params"] for item in sam3d_outputs], axis=0)
        ),
        "identity_coeffs": converter._to_tensor(
            np.stack([item["shape_params"] for item in sam3d_outputs], axis=0)
        ),
        "face_expr_coeffs": converter._to_tensor(
            np.stack([item["expr_params"] for item in sam3d_outputs], axis=0)
        ),
    }
    pred_cam_t = converter._to_tensor(
        np.stack([item["pred_cam_t"] for item in sam3d_outputs], axis=0)
    )

    with torch.no_grad():
        _, mhr_vertices = converter._mhr_para2mesh(mhr_parameters, return_mesh=False)
    mhr_vertices = converter._to_tensor(mhr_vertices)
    mhr_vertices[..., [1, 2]] *= -1
    mhr_vertices += 100.0 * pred_cam_t[:, None, :]

    return converter.convert_mhr2smpl(
        mhr_vertices=mhr_vertices,
        single_identity=False,
        is_tracking=False,
        return_smpl_meshes=args.export_meshes,
        return_smpl_parameters=True,
        return_smpl_vertices=True,
        return_fitting_errors=True,
        batch_size=args.batch_size,
    )


def main(args):
    include_vertices = not args.reconstruct_mhr_vertices
    source_data, sam3d_outputs, frame_refs = load_sam3d_people(
        args.sam3d_json,
        include_vertices=include_vertices,
        person_id=args.person_id,
    )

    add_conversion_tool_to_path(args.mhr_repo)

    from conversion import Conversion
    from mhr.mhr import MHR

    smpl_model = build_smpl_model(args)
    mhr_model = MHR.from_files(lod=args.mhr_lod)
    converter = Conversion(
        mhr_model=mhr_model,
        smpl_model=smpl_model,
        method=args.method,
        batch_size=args.batch_size,
    )

    if args.reconstruct_mhr_vertices:
        result = convert_with_reconstructed_mhr_vertices(converter, sam3d_outputs, args)
    else:
        result = converter.convert_sam3d_output_to_smpl(
            sam3d_outputs=sam3d_outputs,
            return_smpl_meshes=args.export_meshes,
            return_smpl_parameters=True,
            return_smpl_vertices=True,
            return_fitting_errors=True,
            batch_size=args.batch_size,
        )

    output_path = Path(args.output).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    payload = {
        "frame_index": np.asarray([ref["frame_index"] for ref in frame_refs]),
        "time_sec": np.asarray([ref["time_sec"] for ref in frame_refs], dtype=np.float32),
        "person_id": np.asarray([ref["person_id"] for ref in frame_refs]),
        "fps": np.asarray(source_data.get("fps", 0), dtype=np.float32),
        "input_fps": np.asarray(source_data.get("input_fps", 0), dtype=np.float32),
        "frame_stride": np.asarray(source_data.get("frame_stride", 1), dtype=np.int32),
        "smpl_vertices": np.asarray(result.result_vertices)
        if result.result_vertices is not None
        else np.empty((0,)),
        "fitting_errors": np.asarray(result.result_errors)
        if result.result_errors is not None
        else np.empty((0,)),
    }
    payload.update(numpy_result_parameters(result.result_parameters))
    np.savez_compressed(output_path, **payload)

    if args.export_meshes:
        mesh_dir = output_path.with_suffix("")
        mesh_dir.mkdir(parents=True, exist_ok=True)
        for idx, mesh in enumerate(result.result_meshes or []):
            ref = frame_refs[idx]
            mesh.export(
                mesh_dir
                / f"frame_{int(ref['frame_index']):06d}_person_{int(ref['person_id']):02d}.ply"
            )

    print(f"Loaded {len(sam3d_outputs)} SAM3D person records.")
    print(f"Saved SMPL conversion results to: {output_path}")
    if result.result_errors is not None:
        print(
            "Fitting error mean/max: "
            f"{float(np.mean(result.result_errors)):.6f} / "
            f"{float(np.max(result.result_errors)):.6f}"
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Convert demo_video.py SAM3D/MHR JSON to SMPL or SMPLX outputs.",
    )
    parser.add_argument("--sam3d_json", required=True, help="JSON from demo_video.py")
    parser.add_argument(
        "--output",
        required=True,
        help="Output .npz path for SMPL/SMPLX parameters, vertices, and metadata",
    )
    parser.add_argument(
        "--mhr_repo",
        default=os.environ.get("MHR_REPO", ""),
        help="Path to facebookresearch/MHR repo, or set MHR_REPO",
    )
    parser.add_argument("--smpl_model", default="", help="Path to official SMPL model")
    parser.add_argument(
        "--smplx_model", default="", help="Path to official SMPLX model"
    )
    parser.add_argument("--gender", default="neutral", help="SMPL/SMPLX gender")
    parser.add_argument(
        "--method",
        default="pytorch",
        choices=["pytorch", "pymomentum"],
        help="Official converter backend",
    )
    parser.add_argument("--batch_size", default=256, type=int)
    parser.add_argument("--mhr_lod", default=1, type=int)
    parser.add_argument(
        "--person_id",
        default=None,
        type=int,
        help="Only convert this per-frame person id. Default converts all records.",
    )
    parser.add_argument(
        "--reconstruct_mhr_vertices",
        action="store_true",
        help=(
            "Do not require pred_vertices in JSON; reconstruct MHR vertices from "
            "mhr_model_params, shape_params, and expr_params inside the converter."
        ),
    )
    parser.add_argument(
        "--export_meshes",
        action="store_true",
        help="Also export per-record SMPL/SMPLX .ply meshes next to the .npz.",
    )
    parsed = parser.parse_args()

    if not parsed.mhr_repo:
        raise ValueError("Pass --mhr_repo or set MHR_REPO.")
    if bool(parsed.smpl_model) == bool(parsed.smplx_model):
        raise ValueError("Pass exactly one of --smpl_model or --smplx_model.")

    main(parsed)
