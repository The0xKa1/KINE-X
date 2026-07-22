"""GPU EGL renderer for reusable KINE//X identity × motion video exports.

OpenGL imports stay inside :func:`render_avatar_video` so the ordinary backend
and its unit tests do not require the optional render runtime. Production uses
the same EWA Gaussian splat, top-4 LBS, FK, and far-to-near blend contract as
``src/core/avatar/GaussianAvatar.ts``.
"""
from __future__ import annotations

import json
import math
import os
import shutil
import struct
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np

from .avatar_assets import JOINT_COUNT, unpack_motion_asset


ProgressCallback = Callable[[int, int, str], None]
DATA_STRIDE = 9
DATA_TEXTURE_WIDTH = 1024
SOFTWARE_RENDERER_MARKERS = ("llvmpipe", "softpipe", "software rasterizer", "swrast")


@dataclass(frozen=True)
class IdentityAsset:
    count: int
    centers: np.ndarray
    quaternions: np.ndarray
    scales: np.ndarray
    opacities: np.ndarray
    colors: np.ndarray
    blend_rotations: np.ndarray
    lbs_indices: np.ndarray
    lbs_weights: np.ndarray
    constrained: np.ndarray
    rest_joints: np.ndarray
    parents: np.ndarray
    hierarchy: tuple[int, ...]


@dataclass(frozen=True)
class MotionAsset:
    frames: int
    fps: float
    rotations: np.ndarray
    stage_translations: np.ndarray
    stage_linear: np.ndarray


def render_avatar_video(
    identity_path: str | Path,
    motion_path: str | Path,
    output_path: str | Path,
    *,
    width: int = 1920,
    height: int = 1080,
    background: str = "#0e0f13",
    max_frames: int = 1800,
    progress: ProgressCallback | None = None,
) -> dict:
    """Render one KINEXGI1 × KINEXGM1 pair into an atomically-published MP4."""
    validate_dimensions(width, height)
    background_rgb = parse_background(background)
    identity = _load_identity(Path(identity_path))
    motion = _load_motion(Path(motion_path))
    if motion.frames > max_frames:
        raise ValueError(
            f"motion has {motion.frames} frames; avatar video exports allow at most {max_frames}"
        )
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg is required for avatar video export")

    emit = progress or (lambda _current, _total, _note: None)
    emit(0, motion.frames, "preparing skinning matrices")
    bones_by_frame = np.empty((motion.frames, JOINT_COUNT, 4, 4), dtype=np.float32)
    visible = identity.opacities >= 0.01
    bounds_min = np.full(3, np.inf, dtype=np.float32)
    bounds_max = np.full(3, -np.inf, dtype=np.float32)
    sample_step = max(1, motion.frames // 20)
    for frame in range(motion.frames):
        bones = _skinning_matrices(identity, motion, frame)
        bones_by_frame[frame] = bones
        if frame % sample_step == 0 or frame == motion.frames - 1:
            points = _posed_centers(identity, bones, motion.stage_translations[frame])[visible]
            bounds_min = np.minimum(bounds_min, points.min(axis=0))
            bounds_max = np.maximum(bounds_max, points.max(axis=0))

    camera = _auto_camera(bounds_min, bounds_max, width / height)
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            suffix=".mp4", prefix=f".{output.stem}.", dir=output.parent, delete=False
        ) as handle:
            temporary_name = handle.name
        metadata = _render_gl(
            identity,
            motion,
            bones_by_frame,
            Path(temporary_name),
            ffmpeg=ffmpeg,
            width=width,
            height=height,
            background_rgb=background_rgb,
            camera=camera,
            progress=emit,
        )
        Path(temporary_name).replace(output)
        temporary_name = None
    finally:
        if temporary_name:
            Path(temporary_name).unlink(missing_ok=True)

    return {
        **metadata,
        "frameCount": motion.frames,
        "fps": motion.fps,
        "durationSeconds": motion.frames / motion.fps,
        "width": width,
        "height": height,
        "background": background.lower(),
        "bytes": output.stat().st_size,
    }


def parse_background(value: str) -> tuple[float, float, float]:
    if not isinstance(value, str) or len(value) != 7 or not value.startswith("#"):
        raise ValueError("background must be a #RRGGBB colour")
    try:
        channels = tuple(int(value[index : index + 2], 16) / 255 for index in (1, 3, 5))
    except ValueError as exc:
        raise ValueError("background must be a #RRGGBB colour") from exc
    return channels


def validate_dimensions(width: int, height: int) -> None:
    for name, value in (("width", width), ("height", height)):
        if isinstance(value, bool) or not isinstance(value, int) or value < 256 or value > 3840:
            raise ValueError(f"{name} must be an integer between 256 and 3840")
        if value % 2:
            raise ValueError(f"{name} must be even for H.264 export")
    if width * height > 3840 * 2160:
        raise ValueError("export resolution must not exceed 3840x2160 pixels")


def _load_identity(path: Path) -> IdentityAsset:
    raw = path.read_bytes()
    if len(raw) < 20 or raw[:8] != b"KINEXGI1":
        raise ValueError("invalid KINEXGI1 identity asset")
    count, joints, header_length = struct.unpack_from("<3I", raw, 8)
    if count < 1 or count > 65536 or joints != JOINT_COUNT:
        raise ValueError("invalid KINEXGI1 dimensions")
    cursor = 20 + header_length
    if cursor > len(raw):
        raise ValueError("truncated KINEXGI1 metadata")
    try:
        metadata = json.loads(raw[20:cursor])
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("invalid KINEXGI1 metadata") from exc
    if not isinstance(metadata, dict):
        raise ValueError("KINEXGI1 metadata must be an object")

    def read(dtype: str, size: int) -> np.ndarray:
        nonlocal cursor
        byte_count = np.dtype(dtype).itemsize * size
        end = cursor + byte_count
        if end > len(raw):
            raise ValueError("truncated KINEXGI1 payload")
        value = np.frombuffer(raw, dtype=dtype, count=size, offset=cursor).copy()
        cursor = end
        return value

    centers = read("<f4", count * 3).reshape(count, 3)
    quaternions = read("<f4", count * 4).reshape(count, 4)
    scales = read("<f4", count * 3).reshape(count, 3)
    opacities = read("<f4", count)
    colors = read("<f4", count * 3).reshape(count, 3)
    blend_rotations = read("<f4", count * 9).reshape(count, 3, 3)
    lbs_indices = read("u1", count * 4).reshape(count, 4)
    lbs_weights = read("<f4", count * 4).reshape(count, 4)
    constrained = read("u1", count)
    rest_joints = read("<f4", joints * 3).reshape(joints, 3)
    parents = read("<i2", joints)
    if cursor != len(raw):
        raise ValueError("unexpected KINEXGI1 payload length")
    for name, value in (
        ("centers", centers), ("quaternions", quaternions), ("scales", scales),
        ("opacities", opacities), ("colors", colors),
        ("blend rotations", blend_rotations), ("LBS weights", lbs_weights),
        ("rest joints", rest_joints),
    ):
        if not np.isfinite(value).all():
            raise ValueError(f"identity {name} contain non-finite values")
    if np.any(lbs_indices >= joints) or np.any(constrained > 1):
        raise ValueError("identity skinning data are invalid")
    return IdentityAsset(
        count=count,
        centers=centers,
        quaternions=quaternions,
        scales=scales,
        opacities=opacities,
        colors=colors,
        blend_rotations=blend_rotations,
        lbs_indices=lbs_indices,
        lbs_weights=lbs_weights,
        constrained=constrained,
        rest_joints=rest_joints,
        parents=parents,
        hierarchy=_hierarchy_order(parents),
    )


def _load_motion(path: Path) -> MotionAsset:
    metadata, rotations, translations = unpack_motion_asset(path)
    stage = metadata.get("stageTransform", {})
    if not isinstance(stage, dict):
        raise ValueError("motion stageTransform must be an object")
    scale = float(stage.get("scale", 1.0))
    rotation = np.asarray(stage.get("R", np.eye(3)), dtype=np.float32)
    offset = np.asarray(stage.get("t", [0, 0, 0]), dtype=np.float32)
    if not math.isfinite(scale) or scale <= 0 or rotation.shape != (3, 3) or offset.shape != (3,):
        raise ValueError("motion stageTransform is invalid")
    if not np.isfinite(rotation).all() or not np.isfinite(offset).all():
        raise ValueError("motion stageTransform contains non-finite values")
    fps = float(metadata.get("fps", 15))
    if not math.isfinite(fps) or fps <= 0:
        raise ValueError("motion fps must be positive")
    norms = np.linalg.norm(rotations, axis=2, keepdims=True)
    if np.any(norms <= 1e-12):
        raise ValueError("motion contains a degenerate quaternion")
    rotations = rotations / norms
    linear = scale * rotation
    return MotionAsset(
        frames=int(rotations.shape[0]),
        fps=fps,
        rotations=rotations.astype(np.float32, copy=False),
        stage_translations=(translations @ linear.T + offset).astype(np.float32),
        stage_linear=linear,
    )


def _hierarchy_order(parents: np.ndarray) -> tuple[int, ...]:
    state = np.zeros(len(parents), dtype=np.uint8)
    order: list[int] = []

    def visit(joint: int) -> None:
        if state[joint] == 2:
            return
        if state[joint] == 1:
            raise ValueError("identity parent hierarchy contains a cycle")
        parent = int(parents[joint])
        if parent < -1 or parent >= len(parents) or parent == joint:
            raise ValueError(f"invalid parent {parent} for joint {joint}")
        state[joint] = 1
        if parent >= 0:
            visit(parent)
        state[joint] = 2
        order.append(joint)

    for joint in range(len(parents)):
        visit(joint)
    return tuple(order)


def _quaternion_matrix(quaternion: np.ndarray) -> np.ndarray:
    x, y, z, w = map(float, quaternion)
    x2, y2, z2 = 2 * x, 2 * y, 2 * z
    xx, xy, xz = x * x2, x * y2, x * z2
    yy, yz, zz = y * y2, y * z2, z * z2
    wx, wy, wz = w * x2, w * y2, w * z2
    return np.asarray(
        [
            [1 - (yy + zz), xy - wz, xz + wy],
            [xy + wz, 1 - (xx + zz), yz - wx],
            [xz - wy, yz + wx, 1 - (xx + yy)],
        ],
        dtype=np.float32,
    )


def _skinning_matrices(identity: IdentityAsset, motion: MotionAsset, frame: int) -> np.ndarray:
    world = np.zeros((JOINT_COUNT, 4, 4), dtype=np.float32)
    for joint in identity.hierarchy:
        parent = int(identity.parents[joint])
        local = np.eye(4, dtype=np.float32)
        local[:3, :3] = _quaternion_matrix(motion.rotations[frame, joint])
        local[:3, 3] = identity.rest_joints[joint] - (
            identity.rest_joints[parent] if parent >= 0 else 0
        )
        world[joint] = world[parent] @ local if parent >= 0 else local
    result = np.zeros_like(world)
    for joint in range(JOINT_COUNT):
        rotation = world[joint, :3, :3]
        translation = world[joint, :3, 3] - rotation @ identity.rest_joints[joint]
        result[joint, :3, :3] = motion.stage_linear @ rotation
        result[joint, :3, 3] = motion.stage_linear @ translation
        result[joint, 3, 3] = 1
    return result


def _posed_centers(identity: IdentityAsset, bones: np.ndarray, translation: np.ndarray) -> np.ndarray:
    homogeneous = np.concatenate(
        [identity.centers, np.ones((identity.count, 1), dtype=np.float32)], axis=1
    )
    result = np.zeros_like(identity.centers)
    for influence in range(4):
        matrices = bones[identity.lbs_indices[:, influence]]
        transformed = np.einsum("nij,nj->ni", matrices, homogeneous, optimize=True)[:, :3]
        result += transformed * identity.lbs_weights[:, influence, None]
    return result + translation


def _auto_camera(bounds_min: np.ndarray, bounds_max: np.ndarray, aspect: float) -> dict:
    center = (bounds_min + bounds_max) * 0.5
    extent = bounds_max - bounds_min
    fov_y = math.radians(38)
    fov_x = 2 * math.atan(math.tan(fov_y / 2) * aspect)
    distance = max(
        extent[1] / (2 * math.tan(fov_y / 2)),
        extent[0] / (2 * math.tan(fov_x / 2)),
    ) * 0.88
    distance += max(0.1, extent[2] * 0.15)
    eye = center + np.asarray([0, extent[1] * 0.025, distance], dtype=np.float32)
    forward = center - eye
    forward /= np.linalg.norm(forward)
    return {
        "eye": eye,
        "target": center,
        "forward": forward,
        "view": _look_at(eye, center),
        "projection": _perspective(fov_y, aspect, 0.05, max(100, distance + 20)),
    }


def _look_at(eye: np.ndarray, target: np.ndarray) -> np.ndarray:
    forward = target - eye
    forward /= np.linalg.norm(forward)
    side = np.cross(forward, np.asarray([0, 1, 0], dtype=np.float32))
    side /= np.linalg.norm(side)
    up = np.cross(side, forward)
    result = np.eye(4, dtype=np.float32)
    result[0, :3], result[1, :3], result[2, :3] = side, up, -forward
    result[:3, 3] = -result[:3, :3] @ eye
    return result


def _perspective(fov_y: float, aspect: float, near: float, far: float) -> np.ndarray:
    factor = 1 / math.tan(fov_y / 2)
    return np.asarray(
        [
            [factor / aspect, 0, 0, 0],
            [0, factor, 0, 0],
            [0, 0, (far + near) / (near - far), 2 * far * near / (near - far)],
            [0, 0, -1, 0],
        ],
        dtype=np.float32,
    )


VERTEX_SHADER = r"""#version 410 core
uniform sampler2D uData; uniform sampler2D uBones; uniform vec3 uTrans;
uniform vec2 uViewport; uniform int uDataTexWidth; uniform mat4 uView; uniform mat4 uProjection;
layout(location=0) in vec3 position; layout(location=1) in float sortedIndex;
out vec4 vColor; out vec2 vQuad;
vec4 dataTexel(int i){return texelFetch(uData,ivec2(i%uDataTexWidth,i/uDataTexWidth),0);}
mat4 boneMatrix(int j){return mat4(texelFetch(uBones,ivec2(0,j),0),texelFetch(uBones,ivec2(1,j),0),texelFetch(uBones,ivec2(2,j),0),texelFetch(uBones,ivec2(3,j),0));}
vec4 quatMul(vec4 a,vec4 b){return vec4(a.x*b.x-a.y*b.y-a.z*b.z-a.w*b.w,a.x*b.y+a.y*b.x+a.z*b.w-a.w*b.z,a.x*b.z-a.y*b.w+a.z*b.x+a.w*b.y,a.x*b.w+a.y*b.z-a.z*b.y+a.w*b.x);}
vec4 quatFromMat3(mat3 m){float m00=m[0][0],m01=m[1][0],m02=m[2][0],m10=m[0][1],m11=m[1][1],m12=m[2][1],m20=m[0][2],m21=m[1][2],m22=m[2][2],tr=m00+m11+m22;vec4 q;if(tr>0.){float s=sqrt(max(tr+1.,1e-8))*2.;q=vec4(.25*s,(m21-m12)/s,(m02-m20)/s,(m10-m01)/s);}else if(m00>m11&&m00>m22){float s=sqrt(max(1.+m00-m11-m22,1e-8))*2.;q=vec4((m21-m12)/s,.25*s,(m01+m10)/s,(m02+m20)/s);}else if(m11>m22){float s=sqrt(max(1.+m11-m00-m22,1e-8))*2.;q=vec4((m02-m20)/s,(m01+m10)/s,.25*s,(m12+m21)/s);}else{float s=sqrt(max(1.+m22-m00-m11,1e-8))*2.;q=vec4((m10-m01)/s,(m02+m20)/s,(m12+m21)/s,.25*s);}return normalize(q);}
mat3 mat3FromQuat(vec4 q){float w=q.x,x=q.y,y=q.z,z=q.w,x2=x+x,y2=y+y,z2=z+z,xx=x*x2,xy=x*y2,xz=x*z2,yy=y*y2,yz=y*z2,zz=z*z2,wx=w*x2,wy=w*y2,wz=w*z2;return mat3(1.-(yy+zz),xy+wz,xz-wy,xy-wz,1.-(xx+zz),yz+wx,xz+wy,yz-wx,1.-(xx+yy));}
void main(){int g=int(sortedIndex+.5),base=g*9;vec4 dc=dataTexel(base),dq=dataTexel(base+1),ds=dataTexel(base+2),color=dataTexel(base+3),a0=dataTexel(base+4),a1=dataTexel(base+5),a2=dataTexel(base+6),li=dataTexel(base+7),lw=dataTexel(base+8);mat4 M=lw.x*boneMatrix(int(li.x+.5))+lw.y*boneMatrix(int(li.y+.5))+lw.z*boneMatrix(int(li.z+.5))+lw.w*boneMatrix(int(li.w+.5));vec3 posed=(M*vec4(dc.xyz,1)).xyz+uTrans;mat3 br=mat3(a0.x,a1.x,a2.x,a0.y,a1.y,a2.y,a0.z,a1.z,a2.z),rigid=mat3(M)*br;vec4 qr=ds.w>.5?vec4(1,0,0,0):quatFromMat3(rigid);mat3 rot=mat3FromQuat(quatMul(qr,dq));vec4 cam=uView*vec4(posed,1),clip=uProjection*cam;float lim=1.2*clip.w;if(clip.w<=0.||cam.z>-.1||clip.x<-lim||clip.x>lim||clip.y<-lim||clip.y>lim){gl_Position=vec4(0,0,2,1);vColor=vec4(0);vQuad=vec2(0);return;}mat3 V=mat3(rot[0]*ds.x,rot[1]*ds.y,rot[2]*ds.z),cov=V*transpose(V),vr=mat3(uView),cv=vr*cov*transpose(vr);vec2 focal=.5*uViewport*vec2(uProjection[0][0],uProjection[1][1]);float z2=cam.z*cam.z;vec3 j0=vec3(focal.x/cam.z,0,-focal.x*cam.x/z2),j1=vec3(0,focal.y/cam.z,-focal.y*cam.y/z2);float a=dot(j0,cv*j0)+.3,b=dot(j0,cv*j1),c=dot(j1,cv*j1)+.3,mid=.5*(a+c),rad=length(vec2(.5*(a-c),b)),l1=mid+rad,l2=max(mid-rad,.1);vec2 ax1=vec2(b,l1-a);ax1=dot(ax1,ax1)<1e-12?vec2(1,0):normalize(ax1);vec2 ax2=vec2(ax1.y,-ax1.x),off=(position.x*sqrt(l1)*ax1+position.y*sqrt(l2)*ax2)*3.,ndc=off/uViewport*2.;vQuad=position.xy;vColor=vec4(color.rgb,dc.w);gl_Position=vec4(clip.xy+ndc*clip.w,clip.z,clip.w);}
"""

FRAGMENT_SHADER = r"""#version 410 core
in vec4 vColor; in vec2 vQuad; out vec4 fragColor;
void main(){float r2=dot(vQuad,vQuad);if(r2>1.)discard;float a=vColor.a*exp(-4.5*r2);if(a<.0039)discard;fragColor=vec4(vColor.rgb*a,a);}
"""


def _render_gl(
    identity: IdentityAsset,
    motion: MotionAsset,
    bones_by_frame: np.ndarray,
    output: Path,
    *,
    ffmpeg: str,
    width: int,
    height: int,
    background_rgb: tuple[float, float, float],
    camera: dict,
    progress: ProgressCallback,
) -> dict:
    os.environ.setdefault("PYOPENGL_PLATFORM", "egl")
    try:
        from OpenGL import GL
        from pyrender.platforms.egl import EGLPlatform
    except ImportError as exc:
        raise RuntimeError(
            "avatar video export requires pyrender and PyOpenGL>=3.1.10"
        ) from exc

    platform = EGLPlatform(width, height)
    process: subprocess.Popen | None = None
    try:
        platform.init_context()
        platform.make_current()
        vendor = _gl_string(GL, GL.GL_VENDOR)
        renderer = _gl_string(GL, GL.GL_RENDERER)
        version = _gl_string(GL, GL.GL_VERSION)
        lowered = renderer.lower()
        if any(marker in lowered for marker in SOFTWARE_RENDERER_MARKERS):
            raise RuntimeError(f"software OpenGL renderer is not allowed: {renderer}")

        program = _create_program(GL)
        GL.glUseProgram(program)
        _uniform_int(GL, program, "uData", 0)
        _uniform_int(GL, program, "uBones", 1)
        _uniform_int(GL, program, "uDataTexWidth", DATA_TEXTURE_WIDTH)
        GL.glUniform2f(GL.glGetUniformLocation(program, "uViewport"), width, height)
        GL.glUniformMatrix4fv(
            GL.glGetUniformLocation(program, "uView"), 1, GL.GL_FALSE, camera["view"].T
        )
        GL.glUniformMatrix4fv(
            GL.glGetUniformLocation(program, "uProjection"),
            1,
            GL.GL_FALSE,
            camera["projection"].T,
        )
        data_texture = _upload_data_texture(GL, identity)
        bone_texture = _upload_float_texture(
            GL, 1, 4, JOINT_COUNT, np.zeros((JOINT_COUNT, 4, 4), dtype=np.float32)
        )
        vao, sorted_buffer = _create_geometry(GL, identity.count)
        _create_framebuffer(GL, width, height)

        process = subprocess.Popen(
            [
                ffmpeg, "-hide_banner", "-loglevel", "warning", "-y",
                "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{width}x{height}",
                "-r", f"{motion.fps:g}", "-i", "-", "-an", "-c:v", "libx264",
                "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p",
                "-movflags", "+faststart", str(output),
            ],
            stdin=subprocess.PIPE,
        )
        if process.stdin is None:
            raise RuntimeError("failed to open ffmpeg input pipe")

        GL.glViewport(0, 0, width, height)
        GL.glEnable(GL.GL_DEPTH_TEST)
        GL.glDepthMask(GL.GL_FALSE)
        GL.glEnable(GL.GL_BLEND)
        GL.glBlendFunc(GL.GL_ONE, GL.GL_ONE_MINUS_SRC_ALPHA)
        GL.glDisable(GL.GL_CULL_FACE)
        GL.glPixelStorei(GL.GL_PACK_ALIGNMENT, 1)
        GL.glBindVertexArray(vao)
        eye = camera["eye"]
        forward = camera["forward"]
        for frame in range(motion.frames):
            bones = bones_by_frame[frame]
            centers = _posed_centers(identity, bones, motion.stage_translations[frame])
            depth = (centers - eye) @ forward
            order = np.argsort(-depth, kind="stable").astype(np.float32)
            GL.glBindBuffer(GL.GL_ARRAY_BUFFER, sorted_buffer)
            GL.glBufferSubData(GL.GL_ARRAY_BUFFER, 0, order.nbytes, order)
            GL.glActiveTexture(GL.GL_TEXTURE1)
            GL.glBindTexture(GL.GL_TEXTURE_2D, bone_texture)
            bone_texels = np.ascontiguousarray(bones.transpose(0, 2, 1))
            GL.glTexSubImage2D(
                GL.GL_TEXTURE_2D, 0, 0, 0, 4, JOINT_COUNT,
                GL.GL_RGBA, GL.GL_FLOAT, bone_texels,
            )
            GL.glUniform3f(
                GL.glGetUniformLocation(program, "uTrans"),
                *map(float, motion.stage_translations[frame]),
            )
            GL.glClearColor(*background_rgb, 1)
            GL.glClear(GL.GL_COLOR_BUFFER_BIT | GL.GL_DEPTH_BUFFER_BIT)
            GL.glDrawElementsInstanced(
                GL.GL_TRIANGLES, 6, GL.GL_UNSIGNED_SHORT, None, identity.count
            )
            pixels = GL.glReadPixels(0, 0, width, height, GL.GL_RGB, GL.GL_UNSIGNED_BYTE)
            image = np.frombuffer(pixels, dtype=np.uint8).reshape(height, width, 3)[::-1]
            process.stdin.write(image.tobytes())
            progress(frame + 1, motion.frames, "rendering Gaussian avatar")
        process.stdin.close()
        if process.wait() != 0:
            raise RuntimeError("ffmpeg failed while encoding avatar video")
        process = None
        if not output.is_file() or output.stat().st_size == 0:
            raise RuntimeError("avatar video renderer produced no output")
        _ = data_texture
        return {"glVendor": vendor, "glRenderer": renderer, "glVersion": version}
    finally:
        if process is not None:
            if process.stdin:
                process.stdin.close()
            process.terminate()
            process.wait(timeout=10)
        platform.delete_context()


def _gl_string(GL, name: int) -> str:
    value = GL.glGetString(name)
    return value.decode("utf-8", "replace") if value else "unknown"


def _generate(GL, function) -> int:
    output = np.zeros(1, dtype=np.uint32)
    function(1, output)
    return int(output[0])


def _compile_shader(GL, kind: int, source: str) -> int:
    shader = GL.glCreateShader(kind)
    GL.glShaderSource(shader, source)
    GL.glCompileShader(shader)
    if not GL.glGetShaderiv(shader, GL.GL_COMPILE_STATUS):
        raise RuntimeError(GL.glGetShaderInfoLog(shader).decode("utf-8", "replace"))
    return shader


def _create_program(GL) -> int:
    vertex = _compile_shader(GL, GL.GL_VERTEX_SHADER, VERTEX_SHADER)
    fragment = _compile_shader(GL, GL.GL_FRAGMENT_SHADER, FRAGMENT_SHADER)
    program = GL.glCreateProgram()
    GL.glAttachShader(program, vertex)
    GL.glAttachShader(program, fragment)
    GL.glLinkProgram(program)
    if not GL.glGetProgramiv(program, GL.GL_LINK_STATUS):
        raise RuntimeError(GL.glGetProgramInfoLog(program).decode("utf-8", "replace"))
    GL.glDeleteShader(vertex)
    GL.glDeleteShader(fragment)
    return program


def _uniform_int(GL, program: int, name: str, value: int) -> None:
    GL.glUniform1i(GL.glGetUniformLocation(program, name), value)


def _upload_float_texture(GL, unit: int, width: int, height: int, pixels: np.ndarray) -> int:
    texture = _generate(GL, GL.glGenTextures)
    GL.glActiveTexture(GL.GL_TEXTURE0 + unit)
    GL.glBindTexture(GL.GL_TEXTURE_2D, texture)
    GL.glTexParameteri(GL.GL_TEXTURE_2D, GL.GL_TEXTURE_MIN_FILTER, GL.GL_NEAREST)
    GL.glTexParameteri(GL.GL_TEXTURE_2D, GL.GL_TEXTURE_MAG_FILTER, GL.GL_NEAREST)
    GL.glTexParameteri(GL.GL_TEXTURE_2D, GL.GL_TEXTURE_WRAP_S, GL.GL_CLAMP_TO_EDGE)
    GL.glTexParameteri(GL.GL_TEXTURE_2D, GL.GL_TEXTURE_WRAP_T, GL.GL_CLAMP_TO_EDGE)
    GL.glTexImage2D(
        GL.GL_TEXTURE_2D, 0, GL.GL_RGBA32F, width, height, 0,
        GL.GL_RGBA, GL.GL_FLOAT, np.ascontiguousarray(pixels),
    )
    return texture


def _upload_data_texture(GL, identity: IdentityAsset) -> int:
    height = math.ceil(identity.count * DATA_STRIDE / DATA_TEXTURE_WIDTH)
    texels = np.zeros((height, DATA_TEXTURE_WIDTH, 4), dtype=np.float32)
    flat = texels.reshape(-1, 4)
    for gaussian in range(identity.count):
        base = gaussian * DATA_STRIDE
        flat[base] = [*identity.centers[gaussian], identity.opacities[gaussian]]
        flat[base + 1] = identity.quaternions[gaussian]
        flat[base + 2] = [
            *identity.scales[gaussian], float(identity.constrained[gaussian] > 0)
        ]
        flat[base + 3, :3] = identity.colors[gaussian]
        flat[base + 4, :3] = identity.blend_rotations[gaussian, 0]
        flat[base + 5, :3] = identity.blend_rotations[gaussian, 1]
        flat[base + 6, :3] = identity.blend_rotations[gaussian, 2]
        flat[base + 7] = identity.lbs_indices[gaussian]
        flat[base + 8] = identity.lbs_weights[gaussian]
    return _upload_float_texture(GL, 0, DATA_TEXTURE_WIDTH, height, texels)


def _create_geometry(GL, count: int) -> tuple[int, int]:
    vao = _generate(GL, GL.glGenVertexArrays)
    GL.glBindVertexArray(vao)
    quad = np.asarray([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], dtype=np.float32)
    quad_buffer = _generate(GL, GL.glGenBuffers)
    GL.glBindBuffer(GL.GL_ARRAY_BUFFER, quad_buffer)
    GL.glBufferData(GL.GL_ARRAY_BUFFER, quad.nbytes, quad, GL.GL_STATIC_DRAW)
    GL.glEnableVertexAttribArray(0)
    GL.glVertexAttribPointer(0, 3, GL.GL_FLOAT, GL.GL_FALSE, 0, None)
    sorted_buffer = _generate(GL, GL.glGenBuffers)
    GL.glBindBuffer(GL.GL_ARRAY_BUFFER, sorted_buffer)
    GL.glBufferData(GL.GL_ARRAY_BUFFER, count * 4, None, GL.GL_STREAM_DRAW)
    GL.glEnableVertexAttribArray(1)
    GL.glVertexAttribPointer(1, 1, GL.GL_FLOAT, GL.GL_FALSE, 0, None)
    GL.glVertexAttribDivisor(1, 1)
    indices = np.asarray([0, 1, 2, 0, 2, 3], dtype=np.uint16)
    index_buffer = _generate(GL, GL.glGenBuffers)
    GL.glBindBuffer(GL.GL_ELEMENT_ARRAY_BUFFER, index_buffer)
    GL.glBufferData(GL.GL_ELEMENT_ARRAY_BUFFER, indices.nbytes, indices, GL.GL_STATIC_DRAW)
    return vao, sorted_buffer


def _create_framebuffer(GL, width: int, height: int) -> None:
    framebuffer = _generate(GL, GL.glGenFramebuffers)
    GL.glBindFramebuffer(GL.GL_FRAMEBUFFER, framebuffer)
    color = _generate(GL, GL.glGenTextures)
    GL.glBindTexture(GL.GL_TEXTURE_2D, color)
    GL.glTexImage2D(
        GL.GL_TEXTURE_2D, 0, GL.GL_RGB8, width, height, 0,
        GL.GL_RGB, GL.GL_UNSIGNED_BYTE, None,
    )
    GL.glFramebufferTexture2D(
        GL.GL_FRAMEBUFFER, GL.GL_COLOR_ATTACHMENT0, GL.GL_TEXTURE_2D, color, 0
    )
    depth = _generate(GL, GL.glGenRenderbuffers)
    GL.glBindRenderbuffer(GL.GL_RENDERBUFFER, depth)
    GL.glRenderbufferStorage(GL.GL_RENDERBUFFER, GL.GL_DEPTH_COMPONENT24, width, height)
    GL.glFramebufferRenderbuffer(
        GL.GL_FRAMEBUFFER, GL.GL_DEPTH_ATTACHMENT, GL.GL_RENDERBUFFER, depth
    )
    if GL.glCheckFramebufferStatus(GL.GL_FRAMEBUFFER) != GL.GL_FRAMEBUFFER_COMPLETE:
        raise RuntimeError("OpenGL framebuffer is incomplete")
