declare module "three" {
  export class Quaternion {
    x: number;
    y: number;
    z: number;
    w: number;
    constructor(x?: number, y?: number, z?: number, w?: number);
    set(x: number, y: number, z: number, w: number): this;
    copy(source: Quaternion): this;
    clone(): Quaternion;
    normalize(): this;
    slerp(target: Quaternion, alpha: number): this;
    setFromUnitVectors(from: Vector3, to: Vector3): this;
    toArray(): [number, number, number, number];
  }

  export class Vector3 {
    x: number;
    y: number;
    z: number;
    constructor(x?: number, y?: number, z?: number);
    set(x: number, y: number, z: number): this;
    copy(v: Vector3): this;
    clone(): Vector3;
    sub(v: Vector3): this;
    subVectors(a: Vector3, b: Vector3): this;
    addVectors(a: Vector3, b: Vector3): this;
    multiplyScalar(s: number): this;
    lerp(v: Vector3, alpha: number): this;
    normalize(): this;
    length(): number;
    dot(v: Vector3): number;
  }

  export class Object3D {
    position: Vector3;
    quaternion: Quaternion;
    scale: Vector3;
    visible: boolean;
    children: Object3D[];
    add(...objects: Object3D[]): this;
    remove(...objects: Object3D[]): this;
    lookAt(target: Vector3): void;
    lookAt(x: number, y: number, z: number): void;
    updateMatrixWorld(force?: boolean): void;
  }

  export class Group extends Object3D {}

  export class Scene extends Object3D {
    background: Color | null;
  }

  export class Color {
    constructor(value?: number | string | Color);
    set(value: number | string | Color): this;
    setHex(value: number): this;
    copy(source: Color): this;
    clone(): Color;
    multiplyScalar(s: number): this;
  }

  export class PerspectiveCamera extends Object3D {
    fov: number;
    aspect: number;
    near: number;
    far: number;
    constructor(fov?: number, aspect?: number, near?: number, far?: number);
    updateProjectionMatrix(): void;
  }

  export interface WebGLRendererParameters {
    canvas?: HTMLCanvasElement;
    antialias?: boolean;
    alpha?: boolean;
    powerPreference?: "high-performance" | "low-power" | "default";
  }

  export class WebGLRenderer {
    domElement: HTMLCanvasElement;
    constructor(params?: WebGLRendererParameters);
    setPixelRatio(value: number): void;
    setSize(width: number, height: number, updateStyle?: boolean): void;
    setClearColor(color: number | string | Color, alpha?: number): void;
    render(scene: Scene, camera: PerspectiveCamera): void;
    dispose(): void;
  }

  export class AmbientLight extends Object3D {
    constructor(color?: number | string, intensity?: number);
    intensity: number;
  }

  export class DirectionalLight extends Object3D {
    constructor(color?: number | string, intensity?: number);
    intensity: number;
    target: Object3D;
  }

  export const DynamicDrawUsage: number;
  export const DoubleSide: number;

  export class BufferAttribute {
    constructor(array: ArrayLike<number>, itemSize: number, normalized?: boolean);
    needsUpdate: boolean;
    setUsage(usage: number): this;
  }

  export class BufferGeometry {
    setAttribute(name: string, attribute: BufferAttribute): this;
    getAttribute(name: string): BufferAttribute;
    setIndex(index: BufferAttribute | null): this;
    computeVertexNormals(): void;
    computeBoundingSphere(): void;
    dispose(): void;
  }

  export class CylinderGeometry extends BufferGeometry {
    constructor(
      radiusTop?: number,
      radiusBottom?: number,
      height?: number,
      radialSegments?: number,
      heightSegments?: number,
      openEnded?: boolean,
    );
  }

  export class SphereGeometry extends BufferGeometry {
    constructor(radius?: number, widthSegments?: number, heightSegments?: number);
  }

  export class Material {
    color: Color;
    transparent: boolean;
    opacity: number;
    dispose(): void;
  }

  export class MeshBasicMaterial extends Material {
    constructor(params?: { color?: number | string; transparent?: boolean; opacity?: number; wireframe?: boolean });
  }

  export class MeshStandardMaterial extends Material {
    roughness: number;
    metalness: number;
    constructor(params?: {
      color?: number | string;
      transparent?: boolean;
      opacity?: number;
      roughness?: number;
      metalness?: number;
      emissive?: number | string;
      side?: number;
      wireframe?: boolean;
    });
  }

  export class Mesh<G extends BufferGeometry = BufferGeometry, M extends Material | Material[] = Material> extends Object3D {
    geometry: G;
    material: M;
    constructor(geometry?: G, material?: M);
  }

  export class GridHelper extends Object3D {
    constructor(size?: number, divisions?: number, color1?: number | string, color2?: number | string);
    material: Material;
  }
}
