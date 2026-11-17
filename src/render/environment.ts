/**
 * Image-based lighting generated from the physical sky: the sky dome is
 * rendered into a cube and pre-filtered (PMREM) into specular reflections
 * and diffuse irradiance. Rebuilt only when the sun moves noticeably or the
 * quality changes, never per frame.
 */
import * as T from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";

export class SkyEnvironment {
  private pmrem: T.PMREMGenerator;
  private scene = new T.Scene();
  private sky = new Sky();
  private target?: T.WebGLRenderTarget;
  private lastSun = new T.Vector3(0, -2, 0);
  constructor(
    private renderer: T.WebGLRenderer,
    source: Sky,
  ) {
    this.pmrem = new T.PMREMGenerator(renderer);
    this.sky.scale.setScalar(10);
    this.sky.material.uniforms = T.UniformsUtils.clone(
      source.material.uniforms,
    );
    this.scene.add(this.sky);
  }
  /**
   * Rebuild if the sun moved by more than `thresholdRad` (or on `force`, e.g.
   * a new preset); `size` is the cube face resolution. Returns the texture.
   */
  update(
    source: Sky,
    sun: T.Vector3,
    thresholdRad = 0.01,
    force = false,
    size = 256,
  ) {
    if (!force && this.target && sun.angleTo(this.lastSun) < thresholdRad)
      return this.target.texture;
    this.lastSun.copy(sun);
    const from = source.material.uniforms,
      to = this.sky.material.uniforms;
    for (const key of Object.keys(from)) {
      const v = from[key].value;
      to[key].value = v instanceof T.Vector3 ? v.clone() : v;
    }
    // Clouds stay out of the reflections: they would print as fixed blotches.
    to.cloudCoverage.value = 0;
    to.showSunDisc.value = 0;
    this.target?.dispose();
    this.target = this.pmrem.fromScene(this.scene, 0, 0.1, 100, { size });
    return this.target.texture;
  }
  get texture() {
    return this.target?.texture ?? null;
  }
  dispose() {
    this.target?.dispose();
    this.pmrem.dispose();
    this.sky.geometry.dispose();
    this.sky.material.dispose();
  }
}
