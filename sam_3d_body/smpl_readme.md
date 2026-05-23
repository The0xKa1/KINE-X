# demo_video.py to SMPL/SMPLX

This note documents the local workflow for:

1. Running `demo_video.py` on a video.
2. Saving SAM 3D Body / MHR outputs.
3. Converting those outputs to SMPL or SMPLX with the official MHR conversion tool.
4. Optionally exporting a frontend mesh clip for direct mesh playback.

## Key Point

SAM 3D Body does not directly output native SMPL parameters. It outputs MHR data:

- `pred_vertices`
- `faces`
- `pred_cam_t`
- `mhr_model_params`
- `shape_params`
- `scale_params`
- `expr_params`
- keypoints and camera metadata

To get SMPL/SMPLX parameters, use the official MHR conversion optimizer:

https://github.com/facebookresearch/MHR/tree/main/tools/mhr_smpl_conversion

Do not rename MHR pose or shape fields as SMPL fields.

## Files Added Locally

- `demo_video.py`
  - Saves richer SAM3D/MHR JSON when `--save_pose_json` is enabled.
  - Use `--include_vertices_in_pose_json` if you want mesh playback or the most direct conversion path.

- `convert_sam3d_json_to_smpl.py`
  - Converts the SAM3D/MHR JSON to SMPL or SMPLX `.npz`.
  - Calls the official MHR `mhr_smpl_conversion` code.

- `export_sam3d_mesh_clip.py`
  - Converts the SAM3D/MHR JSON to a frontend-friendly mesh clip:
    `verticesByFrame + faces + fps`.
  - This is for playback only. It does not create SMPL parameters.

## Dependencies

You need the SAM 3D Body environment for `demo_video.py`.

For SMPL/SMPLX conversion, you also need:

- The official MHR repository.
- Python packages required by the MHR conversion tool:
  - `smplx`
  - `trimesh`
  - `scikit-learn`
  - `tqdm`
- Official SMPL or SMPLX model files.

Official model downloads:

- SMPL: https://smpl.is.tue.mpg.de/
- SMPLX: https://smpl-x.is.tue.mpg.de/

The SMPL model file is commonly named something like:

```text
basicModel_neutral_lbs_10_207_0_v1.0.0.pkl
```

You can rename it for clarity:

```bash
mv basicModel_neutral_lbs_10_207_0_v1.0.0.pkl SMPL_NEUTRAL.pkl
```

## Step 1: Export SAM3D/MHR JSON from Video

Run `demo_video.py` with pose JSON enabled:

```bash
cd /mnt/nas/share/home/zmz/code/jsy/sam-3d-body

python demo_video.py \
  --video_path /path/to/input.mp4 \
  --output_video output/input_sam3d_body.mp4 \
  --checkpoint_path /path/to/sam-3d-body/model.ckpt \
  --mhr_path /path/to/sam-3d-body/assets/mhr_model.pt \
  --save_pose_json \
  --include_vertices_in_pose_json \
  --pose_json_path output/sam3d_for_smpl.json
```

For a quick smoke test:

```bash
python demo_video.py \
  --video_path /path/to/input.mp4 \
  --output_video output/input_sam3d_body_smoke.mp4 \
  --checkpoint_path /path/to/sam-3d-body/model.ckpt \
  --mhr_path /path/to/sam-3d-body/assets/mhr_model.pt \
  --save_pose_json \
  --include_vertices_in_pose_json \
  --pose_json_path output/sam3d_for_smpl_smoke.json \
  --frame_stride 5 \
  --max_frames 20
```

The output JSON contains:

- Top-level metadata:
  - `fps`
  - `input_fps`
  - `frame_stride`
  - `source_representation: "MHR"`
  - `keypoint_format: "mhr70"`
  - `faces`
- Per-frame people:
  - `pred_vertices`
  - `pred_cam_t`
  - `camera_intrinsics`
  - `focal_length`
  - `pred_keypoints_2d`
  - `pred_keypoints_3d`
  - `pred_joint_coords`
  - `pred_global_rots`
  - `global_rot`
  - `body_pose_params`
  - `hand_pose_params`
  - `shape_params`
  - `scale_params`
  - `expr_params`
  - `mhr_model_params`

`--include_vertices_in_pose_json` makes the JSON large. Use it for conversion and mesh playback. For lightweight keypoint-only exports, omit it.

## Step 2: Convert SAM3D/MHR JSON to SMPLX

Use this if your target application supports SMPLX:

```bash
python convert_sam3d_json_to_smpl.py \
  --sam3d_json output/sam3d_for_smpl.json \
  --output output/smplx_results.npz \
  --mhr_repo /path/to/MHR \
  --smplx_model /path/to/SMPLX_NEUTRAL.npz \
  --method pytorch \
  --batch_size 64
```

The script writes:

```text
output/smplx_results.npz
```

This `.npz` includes:

- `frame_index`
- `time_sec`
- `person_id`
- `fps`
- `input_fps`
- `frame_stride`
- `smpl_vertices`
- `fitting_errors`
- `smpl_<parameter_name>` fields returned by the official converter

Example inspection:

```bash
python - <<'PY'
import numpy as np

data = np.load("output/smplx_results.npz")
print(data.files)
for key in data.files:
    print(key, data[key].shape, data[key].dtype)
PY
```

## Step 3: Convert SAM3D/MHR JSON to SMPL

Use this if your target application requires classic SMPL:

```bash
python convert_sam3d_json_to_smpl.py \
  --sam3d_json output/sam3d_for_smpl.json \
  --output output/smpl_results.npz \
  --mhr_repo /path/to/MHR \
  --smpl_model /path/to/SMPL_NEUTRAL.pkl \
  --method pytorch \
  --batch_size 64
```

If your official SMPL file is `.npz`, the script will create a local pickle copy next to it when needed.

## Optional: Export SMPL/SMPLX Meshes

Add `--export_meshes` to write `.ply` files next to the `.npz`:

```bash
python convert_sam3d_json_to_smpl.py \
  --sam3d_json output/sam3d_for_smpl.json \
  --output output/smplx_results.npz \
  --mhr_repo /path/to/MHR \
  --smplx_model /path/to/SMPLX_NEUTRAL.npz \
  --export_meshes
```

Meshes are written under:

```text
output/smplx_results/
```

## Optional: Convert Without Saved pred_vertices

If the JSON was created without `--include_vertices_in_pose_json`, you can still try conversion from MHR parameters:

```bash
python convert_sam3d_json_to_smpl.py \
  --sam3d_json output/sam3d_for_smpl_no_vertices.json \
  --output output/smplx_results.npz \
  --mhr_repo /path/to/MHR \
  --smplx_model /path/to/SMPLX_NEUTRAL.npz \
  --reconstruct_mhr_vertices
```

This path requires a complete MHR environment because it reconstructs MHR vertices from:

- `mhr_model_params`
- `shape_params`
- `expr_params`
- `pred_cam_t`

For reliability, prefer exporting `pred_vertices` in Step 1.

## Optional: Frontend Mesh Playback

If you only want the reconstructed SAM3D mesh to move in a frontend, you do not need SMPL conversion.

Export a mesh clip:

```bash
python export_sam3d_mesh_clip.py \
  --sam3d_json output/sam3d_for_smpl.json \
  --output output/mesh_clip.json
```

The clip structure is:

```json
{
  "type": "sam3d_body_mesh_clip",
  "fps": 30,
  "faces": [[0, 1, 2]],
  "tracks": [
    {
      "person_id": 0,
      "frameIndices": [0, 1, 2],
      "timeSec": [0.0, 0.033, 0.066],
      "verticesByFrame": [
        [[0.0, 0.0, 0.0]]
      ],
      "camTByFrame": [
        [0.0, 0.0, 2.0]
      ]
    }
  ]
}
```

If you want to bake `pred_cam_t` into the vertices:

```bash
python export_sam3d_mesh_clip.py \
  --sam3d_json output/sam3d_for_smpl.json \
  --output output/mesh_clip_worldish.json \
  --apply_cam_t
```

Frontend usage:

- Create a `BufferGeometry`.
- Use `faces` as the index buffer.
- On each frame, replace the position buffer with `tracks[i].verticesByFrame[t]`.
- If `verticesHaveCamTApplied` is false, apply `camTByFrame[t]` as object translation.

## Practical Recommendations

- Start with a short clip:
  - `--max_frames 20`
  - `--frame_stride 5`
- Use `--include_vertices_in_pose_json` for the first version.
- Convert one person first if the video has multiple detections:

```bash
python convert_sam3d_json_to_smpl.py \
  --sam3d_json output/sam3d_for_smpl.json \
  --output output/smplx_person0.npz \
  --mhr_repo /path/to/MHR \
  --smplx_model /path/to/SMPLX_NEUTRAL.npz \
  --person_id 0
```

- Check `fitting_errors` after conversion. Large errors mean the SMPL/SMPLX fit is not matching the SAM3D/MHR mesh well.

## Common Problems

### `ModuleNotFoundError: No module named 'smplx'`

Install the conversion dependencies in the environment used to run `convert_sam3d_json_to_smpl.py`.

### `ModuleNotFoundError: No module named 'mhr'`

Run inside a working MHR environment, or make sure the MHR repo/package is importable. The script needs both:

- `--mhr_repo /path/to/MHR`
- an environment where `from mhr.mhr import MHR` works

### `Missing fields ... pred_vertices`

Either:

- Re-run `demo_video.py` with `--include_vertices_in_pose_json`, or
- Add `--reconstruct_mhr_vertices` to the conversion command.

### JSON Is Too Large

`pred_vertices` is large: one frame contains thousands of vertices per person. For long videos, start with `--frame_stride` or `--max_frames`, or consider storing vertices in `.npz` in a future export path.

