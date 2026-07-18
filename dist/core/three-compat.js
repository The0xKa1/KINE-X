import {
  AmbientLight as ThreeAmbientLight,
  BufferAttribute as ThreeBufferAttribute,
  BufferGeometry as ThreeBufferGeometry,
  Color as ThreeColor,
  CustomBlending as ThreeCustomBlending,
  CylinderGeometry as ThreeCylinderGeometry,
  DataTexture as ThreeDataTexture,
  DirectionalLight as ThreeDirectionalLight,
  DoubleSide as ThreeDoubleSide,
  DynamicDrawUsage as ThreeDynamicDrawUsage,
  FloatType as ThreeFloatType,
  GridHelper as ThreeGridHelper,
  Group as ThreeGroup,
  InstancedBufferAttribute as ThreeInstancedBufferAttribute,
  InstancedBufferGeometry as ThreeInstancedBufferGeometry,
  Material as ThreeMaterial,
  Mesh as ThreeMesh,
  MeshBasicMaterial as ThreeMeshBasicMaterial,
  MeshStandardMaterial as ThreeMeshStandardMaterial,
  NearestFilter as ThreeNearestFilter,
  NormalBlending as ThreeNormalBlending,
  Object3D as ThreeObject3D,
  OneFactor as ThreeOneFactor,
  OneMinusSrcAlphaFactor as ThreeOneMinusSrcAlphaFactor,
  PerspectiveCamera as ThreePerspectiveCamera,
  Quaternion as ThreeQuaternion,
  RGBAFormat as ThreeRGBAFormat,
  Scene as ThreeScene,
  ShaderMaterial as ThreeShaderMaterial,
  SphereGeometry as ThreeSphereGeometry,
  Vector2 as ThreeVector2,
  Vector3 as ThreeVector3,
  WebGLRenderer as ThreeWebGLRenderer,
} from "three";
                                                          

export const THREE = {
  AmbientLight: ThreeAmbientLight,
  BufferAttribute: ThreeBufferAttribute,
  BufferGeometry: ThreeBufferGeometry,
  Color: ThreeColor,
  CustomBlending: ThreeCustomBlending,
  CylinderGeometry: ThreeCylinderGeometry,
  DataTexture: ThreeDataTexture,
  DirectionalLight: ThreeDirectionalLight,
  DoubleSide: ThreeDoubleSide,
  DynamicDrawUsage: ThreeDynamicDrawUsage,
  FloatType: ThreeFloatType,
  GridHelper: ThreeGridHelper,
  Group: ThreeGroup,
  InstancedBufferAttribute: ThreeInstancedBufferAttribute,
  InstancedBufferGeometry: ThreeInstancedBufferGeometry,
  Material: ThreeMaterial,
  Mesh: ThreeMesh,
  MeshBasicMaterial: ThreeMeshBasicMaterial,
  MeshStandardMaterial: ThreeMeshStandardMaterial,
  NearestFilter: ThreeNearestFilter,
  NormalBlending: ThreeNormalBlending,
  Object3D: ThreeObject3D,
  OneFactor: ThreeOneFactor,
  OneMinusSrcAlphaFactor: ThreeOneMinusSrcAlphaFactor,
  PerspectiveCamera: ThreePerspectiveCamera,
  Quaternion: ThreeQuaternion,
  RGBAFormat: ThreeRGBAFormat,
  Scene: ThreeScene,
  ShaderMaterial: ThreeShaderMaterial,
  SphereGeometry: ThreeSphereGeometry,
  Vector2: ThreeVector2,
  Vector3: ThreeVector3,
  WebGLRenderer: ThreeWebGLRenderer,
};

                                         
                                                                     
                                                               

export function quaternionFromTuple(tuple                 , target = new THREE.Quaternion())                   {
  return target.set(tuple[0], tuple[1], tuple[2], tuple[3]).normalize();
}

export function quaternionFromAxisAmount(axis                          , amount        )                  {
  const [x, y, z] = axis;
  const length = Math.hypot(x, y, z) || 1;
  const half = amount / 2;
  const scale = Math.sin(half) / length;
  return [x * scale, y * scale, z * scale, Math.cos(half)];
}
