import { THREE } from "../three-compat.js?v=0.1.5";



























const STRIDE_PER_FRAME = (vertexCount        ) => vertexCount * 3;

export async function loadMeshClip(metaUrl        )                    {
  const metaResp = await fetch(metaUrl, { cache: "no-cache" });
  if (!metaResp.ok) {
    throw new Error(`Mesh meta fetch failed ${metaResp.status}: ${metaUrl}`);
  }
  const meta = (await metaResp.json())                ;
  const base = new URL(metaUrl, window.location.href);
  const vertexUrl = new URL(meta.vertexBin, base).toString();
  const faceUrl = new URL(meta.faceBin, base).toString();

  const [vertexBuf, faceBuf] = await Promise.all([
    fetchArrayBuffer(vertexUrl, meta.vertexBytes),
    fetchArrayBuffer(faceUrl, meta.faceBytes),
  ]);

  const expectedVertexFloats = meta.frameCount * meta.vertexCount * 3;
  if (vertexBuf.byteLength !== expectedVertexFloats * 4) {
    throw new Error(
      `Mesh vertex bin size mismatch: got ${vertexBuf.byteLength}, expected ${expectedVertexFloats * 4}`,
    );
  }
  const expectedFaceInts = meta.faceCount * 3;
  const faceItemBytes = meta.faceDtype === "uint32" ? 4 : 2;
  if (faceBuf.byteLength !== expectedFaceInts * faceItemBytes) {
    throw new Error(
      `Mesh face bin size mismatch: got ${faceBuf.byteLength}, expected ${expectedFaceInts * faceItemBytes}`,
    );
  }

  const vertices = new Float32Array(vertexBuf);
  const faces = meta.faceDtype === "uint32" ? new Uint32Array(faceBuf) : new Uint16Array(faceBuf);
  return { meta, vertices, faces };
}

async function fetchArrayBuffer(url        , expectedBytes        )                       {
  const resp = await fetch(url, { cache: "no-cache" });
  if (!resp.ok) {
    throw new Error(`Mesh bin fetch failed ${resp.status}: ${url}`);
  }
  const buf = await resp.arrayBuffer();
  if (expectedBytes > 0 && buf.byteLength !== expectedBytes) {
    console.warn(`[mesh-clip] ${url} size ${buf.byteLength} ≠ meta ${expectedBytes}`);
  }
  return buf;
}

export function sampleFrameIndex(clip          , progress        )         {
  // Clamp like sampleClip: upstream wraps the preview loop, so 1 means
  // "session finished" and must hold the last frame.
  const clamped = Math.max(0, Math.min(1, progress));
  const idx = Math.floor(clamped * clip.meta.frameCount);
  return idx >= clip.meta.frameCount ? clip.meta.frameCount - 1 : idx;
}

export function copyFrameVerticesInto(
  clip          ,
  frameIndex        ,
  destination              ,
)       {
  const stride = STRIDE_PER_FRAME(clip.meta.vertexCount);
  const start = frameIndex * stride;
  destination.set(clip.vertices.subarray(start, start + stride));
}

export function buildMeshPrimitive(clip          )




  {
  const positions = new Float32Array(clip.meta.vertexCount * 3);
  copyFrameVerticesInto(clip, 0, positions);

  const geometry = new THREE.BufferGeometry();
  const positionAttr = new THREE.BufferAttribute(positions, 3);
  positionAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttr);
  geometry.setIndex(new THREE.BufferAttribute(clip.faces, 1));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0xb4b8c4,
    roughness: 0.65,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  return { mesh, positions, geometry, material };
}
