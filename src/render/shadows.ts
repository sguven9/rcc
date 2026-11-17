/**
 * Cascaded shadow maps for the sun (three.js CSM). CSM installs its shading
 * through `material.onBeforeCompile`; the field's custom terrain, grass and
 * runway shaders use the same hook, so `prepareMaterial` chains the two
 * instead of replacing the existing one.
 */
import * as T from "three";
import { CSM } from "three/examples/jsm/csm/CSM.js";
import type { QualityPreset } from "./render-config";

const LIT = (m: T.Material) =>
  m instanceof T.MeshStandardMaterial ||
  m instanceof T.MeshLambertMaterial ||
  m instanceof T.MeshPhongMaterial;

/** The material's own compile hook, before any cascaded-shadow wrapping. */
const baseHooks = new WeakMap<T.Material, T.Material["onBeforeCompile"]>();

export class SunShadows {
  csm: CSM;
  private prepared = new WeakSet<T.Material>();
  constructor(
    scene: T.Scene,
    camera: T.PerspectiveCamera,
    preset: QualityPreset,
    direction: T.Vector3,
  ) {
    this.csm = new CSM({
      camera,
      parent: scene,
      cascades: preset.shadowCascades,
      maxFar: preset.shadowDistanceM,
      mode: "practical",
      shadowMapSize: preset.shadowMapSize,
      // Depth bias in normalized units of the 2000 m light range: 1e-5 ≈ 2 cm.
      shadowBias: -0.00001,
      lightDirection: direction.clone().negate().normalize(),
      lightIntensity: 3,
      lightMargin: 120,
    });
    this.csm.fade = true;
    for (const light of this.csm.lights) {
      light.shadow.normalBias = 0.02;
      light.castShadow = true;
    }
  }
  /** Enable cascaded shadows on every lit material below `root`. */
  prepare(root: T.Object3D) {
    root.traverse((o) => {
      const mesh = o as T.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material])
        this.prepareMaterial(m);
    });
  }
  prepareMaterial(material: T.Material) {
    if (!LIT(material) || this.prepared.has(material)) return;
    this.prepared.add(material);
    // A new preset rebuilds the cascades: wrap the original hook, not the
    // previous cascade wrapper (its uniforms belong to a disposed CSM).
    if (!baseHooks.has(material))
      baseHooks.set(material, material.onBeforeCompile);
    // Re-preparing: drop the cached programs and uniforms so the material
    // compiles afresh against the new cascades (it stays usable).
    else material.dispose();
    const previous = baseHooks.get(material)!;
    material.onBeforeCompile = previous;
    this.csm.setupMaterial(material);
    const cascades = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      cascades.call(material, shader, renderer);
      previous.call(material, shader, renderer);
    };
    material.needsUpdate = true;
  }
  set(direction: T.Vector3, color: T.Color, intensity: number) {
    this.csm.lightDirection.copy(direction).negate().normalize();
    for (const light of this.csm.lights) {
      light.color.copy(color);
      light.intensity = intensity;
    }
  }
  setVisible(on: boolean) {
    for (const light of this.csm.lights) light.visible = on;
  }
  update() {
    this.csm.updateFrustums();
    this.csm.update();
  }
  dispose() {
    this.csm.remove();
    this.csm.dispose();
  }
}
