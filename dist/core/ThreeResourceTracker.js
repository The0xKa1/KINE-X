import { THREE } from "./three-compat.js?v=0.1.2";




export class ThreeResourceTracker {
          geometries                    = [];
          materials                    = [];

  trackGeometry                           (geometry   )    {
    this.geometries.push(geometry);
    return geometry;
  }

  trackMaterial                           (material   )    {
    this.materials.push(material);
    return material;
  }

  createSceneResources()       {
    // Reserved for future allocation hooks; presently a no-op since callers
    // build their own scene meshes and feed them through trackGeometry/Material.
  }

  disposeSceneResources()       {
    this.geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => material.dispose());
    this.geometries = [];
    this.materials = [];
  }
}
