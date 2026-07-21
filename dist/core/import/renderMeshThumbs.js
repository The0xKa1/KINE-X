import { THREE } from "../three-compat.js?v=0.1.1";
import { copyFrameVerticesInto,               } from "./MeshClip.js?v=0.1.1";

/**
 * Renders `count` evenly-spaced poses of a MeshClip into small data-URL
 * thumbnails via a throwaway offscreen renderer. Self-healing fallback for
 * when the baked frame JPGs are unavailable (e.g. the frames directory was
 * a machine-local symlink that did not survive migration).
 */
export function renderMeshThumbnails(clip          , count        , width = 128, height = 72)           {
  if (count <= 0) return [];
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  let renderer                                          ;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  } catch (err) {
    console.warn("[mesh-thumbs] WebGL unavailable:", err);
    return [];
  }
  renderer.setSize(width, height, false);
  renderer.setClearColor(0xf7f1e5, 1); // --paper

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
  camera.position.set(0, 0.95, 2.8);
  camera.lookAt(0, 0.9, 0);
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 0.55);
  key.position.set(1.5, 3, 2);
  scene.add(key);
  scene.add(key.target);

  const positions = new Float32Array(clip.meta.vertexCount * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(clip.faces, 1));
  const material = new THREE.MeshStandardMaterial({
    color: 0x111111,
    roughness: 0.7,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  scene.add(new THREE.Mesh(geometry, material));

  const total = clip.meta.frameCount;
  const denom = Math.max(1, count - 1);
  const thumbs           = [];
  for (let i = 0; i < count; i += 1) {
    const idx = Math.min(total - 1, Math.round((i / denom) * (total - 1)));
    copyFrameVerticesInto(clip, idx, positions);
    geometry.getAttribute("position").needsUpdate = true;
    geometry.computeVertexNormals();
    renderer.render(scene, camera);
    thumbs.push(canvas.toDataURL("image/jpeg", 0.72));
  }

  geometry.dispose();
  material.dispose();
  renderer.dispose();
  return thumbs;
}
