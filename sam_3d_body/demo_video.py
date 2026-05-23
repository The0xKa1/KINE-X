# Copyright (c) Meta Platforms, Inc. and affiliates.
import argparse
import json
import os
import sys
from pathlib import Path

try:
    import pyrootutils

    root = pyrootutils.setup_root(
        search_from=__file__,
        indicator=[".git", "pyproject.toml", ".sl"],
        pythonpath=True,
        dotenv=True,
    )
except ModuleNotFoundError:
    root = Path(__file__).resolve().parent
    sys.path.insert(0, str(root))


def build_estimator(args, device):
    from sam_3d_body import load_sam_3d_body, SAM3DBodyEstimator

    mhr_path = args.mhr_path or os.environ.get("SAM3D_MHR_PATH", "")
    detector_path = args.detector_path or os.environ.get("SAM3D_DETECTOR_PATH", "")
    segmentor_path = args.segmentor_path or os.environ.get("SAM3D_SEGMENTOR_PATH", "")
    fov_path = args.fov_path or os.environ.get("SAM3D_FOV_PATH", "")

    model, model_cfg = load_sam_3d_body(
        args.checkpoint_path, device=device, mhr_path=mhr_path
    )

    human_detector, human_segmentor, fov_estimator = None, None, None
    if args.detector_name:
        from tools.build_detector import HumanDetector

        human_detector = HumanDetector(
            name=args.detector_name, device=device, path=detector_path
        )

    if (
        args.segmentor_name == "sam2" and len(segmentor_path)
    ) or args.segmentor_name != "sam2":
        from tools.build_sam import HumanSegmentor

        human_segmentor = HumanSegmentor(
            name=args.segmentor_name, device=device, path=segmentor_path
        )

    if args.fov_name:
        from tools.build_fov_estimator import FOVEstimator

        fov_estimator = FOVEstimator(name=args.fov_name, device=device, path=fov_path)

    return SAM3DBodyEstimator(
        sam_3d_body_model=model,
        model_cfg=model_cfg,
        human_detector=human_detector,
        human_segmentor=human_segmentor,
        fov_estimator=fov_estimator,
    )


def make_empty_visualization(frame):
    import numpy as np

    blank = np.ones_like(frame) * 255
    return np.concatenate([frame, frame.copy(), blank, blank.copy()], axis=1)


def output_path_for_video(input_video, output_video):
    if output_video:
        return output_video

    input_path = Path(input_video)
    output_dir = Path("./output") / input_path.stem
    output_dir.mkdir(parents=True, exist_ok=True)
    return str(output_dir / f"{input_path.stem}_sam3d_body.mp4")


def to_jsonable(value):
    import numpy as np

    if value is None:
        return None
    value = np.asarray(value)
    if value.ndim == 0:
        return value.item()
    return value.tolist()


def camera_intrinsics_from_focal(focal_length, width, height):
    import numpy as np

    focal = float(np.asarray(focal_length).reshape(-1)[0])
    return [
        [focal, 0.0, width / 2.0],
        [0.0, focal, height / 2.0],
        [0.0, 0.0, 1.0],
    ]


def to_jsonable_pose(outputs, image_width, image_height, include_vertices=False):
    frame_outputs = []
    for person_id, person_output in enumerate(outputs):
        record = {
            "person_id": person_id,
            "bbox": to_jsonable(person_output.get("bbox")),
            "focal_length": to_jsonable(person_output.get("focal_length")),
            "camera_intrinsics": camera_intrinsics_from_focal(
                person_output["focal_length"], image_width, image_height
            ),
            "pred_cam_t": to_jsonable(person_output.get("pred_cam_t")),
            "pred_keypoints_2d": to_jsonable(person_output.get("pred_keypoints_2d")),
            "pred_keypoints_3d": to_jsonable(person_output.get("pred_keypoints_3d")),
            "pred_joint_coords": to_jsonable(person_output.get("pred_joint_coords")),
            "pred_global_rots": to_jsonable(person_output.get("pred_global_rots")),
            "global_rot": to_jsonable(person_output.get("global_rot")),
            "body_pose_params": to_jsonable(person_output.get("body_pose_params")),
            "hand_pose_params": to_jsonable(person_output.get("hand_pose_params")),
            "shape_params": to_jsonable(person_output.get("shape_params")),
            "scale_params": to_jsonable(person_output.get("scale_params")),
            "expr_params": to_jsonable(person_output.get("expr_params")),
            "mhr_model_params": to_jsonable(person_output.get("mhr_model_params")),
        }
        if include_vertices:
            record["pred_vertices"] = to_jsonable(person_output.get("pred_vertices"))
        frame_outputs.append(record)
    return frame_outputs


def open_video_writer(path, fps, frame_size, codec):
    import cv2

    fourcc = cv2.VideoWriter_fourcc(*codec)
    writer = cv2.VideoWriter(path, fourcc, fps, frame_size)
    if not writer.isOpened():
        raise RuntimeError(f"Failed to open video writer: {path}")
    return writer


def main(args):
    import cv2
    import numpy as np
    import torch
    from tools.vis_utils import visualize_sample_together
    from tqdm import tqdm

    output_video = output_path_for_video(args.video_path, args.output_video)
    os.makedirs(os.path.dirname(output_video) or ".", exist_ok=True)

    cap = cv2.VideoCapture(args.video_path)
    if not cap.isOpened():
        raise FileNotFoundError(f"Failed to open input video: {args.video_path}")

    input_fps = cap.get(cv2.CAP_PROP_FPS)
    if input_fps <= 0:
        input_fps = args.fallback_fps
    output_fps = input_fps / args.frame_stride
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    total_inference_frames = None
    if total_frames > 0:
        total_inference_frames = (total_frames + args.frame_stride - 1) // args.frame_stride
    if args.max_frames > 0:
        total_inference_frames = (
            min(total_inference_frames, args.max_frames)
            if total_inference_frames is not None
            else args.max_frames
        )

    device = torch.device("cuda") if torch.cuda.is_available() else torch.device("cpu")
    estimator = build_estimator(args, device)

    pose_records = []
    writer = None
    processed_frames = 0
    pbar = tqdm(total=total_inference_frames, desc="Inference frames", unit="frame")

    try:
        frame_idx = 0
        while True:
            ok, frame_bgr = cap.read()
            if not ok:
                break

            should_process = frame_idx % args.frame_stride == 0
            if not should_process:
                frame_idx += 1
                continue

            frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            outputs = estimator.process_one_image(
                frame_rgb,
                bbox_thr=args.bbox_thresh,
                use_mask=args.use_mask,
                inference_type=args.inference_type,
            )

            if outputs:
                rendered = visualize_sample_together(
                    frame_bgr, outputs, estimator.faces
                ).astype(np.uint8)
            else:
                rendered = make_empty_visualization(frame_bgr).astype(np.uint8)

            if writer is None:
                height, width = rendered.shape[:2]
                writer = open_video_writer(
                    output_video, output_fps, (width, height), args.output_codec
                )
            writer.write(rendered)

            if args.save_pose_json:
                pose_records.append(
                    {
                        "frame_index": frame_idx,
                        "time_sec": frame_idx / input_fps,
                        "people": to_jsonable_pose(
                            outputs,
                            image_width=frame_bgr.shape[1],
                            image_height=frame_bgr.shape[0],
                            include_vertices=args.include_vertices_in_pose_json,
                        ),
                    }
                )

            processed_frames += 1
            pbar.set_postfix(frame=frame_idx, people=len(outputs))
            pbar.update(1)
            if args.max_frames > 0 and processed_frames >= args.max_frames:
                break

            frame_idx += 1
    finally:
        pbar.close()
        cap.release()
        if writer is not None:
            writer.release()

    if writer is None:
        raise RuntimeError("No frames were processed from the input video.")

    if args.save_pose_json:
        pose_json = args.pose_json_path
        if not pose_json:
            pose_json = str(Path(output_video).with_suffix(".json"))
        os.makedirs(os.path.dirname(pose_json) or ".", exist_ok=True)
        with open(pose_json, "w") as f:
            json.dump(
                {
                    "video_path": args.video_path,
                    "output_video": output_video,
                    "fps": output_fps,
                    "input_fps": input_fps,
                    "frame_stride": args.frame_stride,
                    "source_representation": "MHR",
                    "smpl_note": (
                        "These are SAM 3D Body / MHR predictions, not native SMPL "
                        "pose or beta parameters. Use them as observations or "
                        "initialization for a separate SMPL fitting/conversion step."
                    ),
                    "keypoint_format": "mhr70",
                    "contains_vertices": args.include_vertices_in_pose_json,
                    "faces": (
                        to_jsonable(estimator.faces)
                        if args.include_vertices_in_pose_json
                        else None
                    ),
                    "frames": pose_records,
                },
                f,
            )

    print(f"Saved video visualization to: {output_video}")
    if args.save_pose_json:
        print(f"Saved pose results to: {pose_json}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="SAM 3D Body Demo - Video Human Pose and Mesh Recovery",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
                Examples:
                python demo_video.py \\
                    --video_path ./input.mp4 \\
                    --output_video ./output/input_sam3d_body.mp4 \\
                    --checkpoint_path ./checkpoints/sam-3d-body-dinov3/model.ckpt \\
                    --mhr_path ./checkpoints/sam-3d-body-dinov3/assets/mhr_model.pt

                Environment Variables:
                SAM3D_MHR_PATH: Path to MHR asset
                SAM3D_DETECTOR_PATH: Path to human detection model folder
                SAM3D_SEGMENTOR_PATH: Path to human segmentation model folder
                SAM3D_FOV_PATH: Path to fov estimation model folder
                """,
    )
    parser.add_argument(
        "--video_path",
        required=True,
        type=str,
        help="Path to input video",
    )
    parser.add_argument(
        "--output_video",
        default="",
        type=str,
        help="Path to output visualization video (default: ./output/<video_name>/<video_name>_sam3d_body.mp4)",
    )
    parser.add_argument(
        "--checkpoint_path",
        required=True,
        type=str,
        help="Path to SAM 3D Body model checkpoint",
    )
    parser.add_argument(
        "--detector_name",
        default="vitdet",
        type=str,
        help="Human detection model for demo (Default `vitdet`, add your favorite detector if needed).",
    )
    parser.add_argument(
        "--segmentor_name",
        default="sam2",
        type=str,
        help="Human segmentation model for demo (Default `sam2`, add your favorite segmentor if needed).",
    )
    parser.add_argument(
        "--fov_name",
        default="moge2",
        type=str,
        help="FOV estimation model for demo (Default `moge2`, add your favorite fov estimator if needed).",
    )
    parser.add_argument(
        "--detector_path",
        default="",
        type=str,
        help="Path to human detection model folder (or set SAM3D_DETECTOR_PATH)",
    )
    parser.add_argument(
        "--segmentor_path",
        default="",
        type=str,
        help="Path to human segmentation model folder (or set SAM3D_SEGMENTOR_PATH)",
    )
    parser.add_argument(
        "--fov_path",
        default="",
        type=str,
        help="Path to fov estimation model folder (or set SAM3D_FOV_PATH)",
    )
    parser.add_argument(
        "--mhr_path",
        default="",
        type=str,
        help="Path to MoHR/assets folder (or set SAM3D_MHR_PATH)",
    )
    parser.add_argument(
        "--bbox_thresh",
        default=0.8,
        type=float,
        help="Bounding box detection threshold",
    )
    parser.add_argument(
        "--use_mask",
        action="store_true",
        default=False,
        help="Use mask-conditioned prediction (segmentation mask is automatically generated from bbox)",
    )
    parser.add_argument(
        "--inference_type",
        default="full",
        choices=["full", "body"],
        help="Inference type used by SAM3DBodyEstimator",
    )
    parser.add_argument(
        "--frame_stride",
        default=1,
        type=int,
        help="Run inference every N frames and write only processed frames",
    )
    parser.add_argument(
        "--max_frames",
        default=-1,
        type=int,
        help="Maximum number of processed frames, useful for smoke tests",
    )
    parser.add_argument(
        "--fallback_fps",
        default=30.0,
        type=float,
        help="FPS to use when the input video does not report one",
    )
    parser.add_argument(
        "--output_codec",
        default="mp4v",
        type=str,
        help="FourCC codec for OpenCV VideoWriter",
    )
    parser.add_argument(
        "--save_pose_json",
        action="store_true",
        default=False,
        help="Save per-frame pose estimates to JSON",
    )
    parser.add_argument(
        "--pose_json_path",
        default="",
        type=str,
        help="Path to pose JSON output (default: same as output video with .json suffix)",
    )
    parser.add_argument(
        "--include_vertices_in_pose_json",
        action="store_true",
        default=False,
        help=(
            "Include per-person MHR mesh vertices and top-level faces in pose JSON. "
            "This is useful for mesh fitting/export but creates very large files."
        ),
    )
    args = parser.parse_args()

    if args.frame_stride < 1:
        raise ValueError("--frame_stride must be >= 1")

    main(args)
