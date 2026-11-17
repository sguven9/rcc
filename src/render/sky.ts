/**
 * Physical sky: three.js's Preetham analytic daylight model (Rayleigh + Mie
 * single scattering, sun disc and halo, procedural cloud layer) driven by the
 * sun direction for the chosen time of day. The same sky feeds the image-based
 * lighting (environment.ts), so paint and ground reflect a matching sky.
 *
 * Colour ramps for the sunlight and the haze are estimates (render-config).
 */
import * as T from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { RENDER_CONFIG } from "./render-config";
import { daylight } from "./solar";

const RAD = Math.PI / 180;

export class SkySystem {
  readonly mesh: Sky;
  private cloudTime = 0;
  constructor(private far = RENDER_CONFIG.camera.far) {
    this.mesh = new Sky();
    this.mesh.name = "physical-sky";
    // A cube whose corners stay inside the far plane: half size · √3 < far.
    this.mesh.scale.setScalar((far * 0.95) / Math.sqrt(3));
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
    const u = this.mesh.material.uniforms;
    u.turbidity.value = RENDER_CONFIG.sky.turbidity;
    u.rayleigh.value = RENDER_CONFIG.sky.rayleigh;
    u.mieCoefficient.value = RENDER_CONFIG.sky.mieCoefficient;
    u.mieDirectionalG.value = RENDER_CONFIG.sky.mieDirectionalG;
    this.setClouds(true);
  }
  /** Scene-space unit vector toward the sun. */
  setSun(direction: T.Vector3) {
    this.mesh.material.uniforms.sunPosition.value.copy(direction);
  }
  setClouds(on: boolean) {
    const u = this.mesh.material.uniforms;
    u.cloudCoverage.value = on ? RENDER_CONFIG.clouds.coverage : 0;
    u.cloudDensity.value = on ? RENDER_CONFIG.clouds.opacity : 0;
    u.cloudElevation.value = 0.55;
  }
  /**
   * Clouds drift downwind: the shader advects along its +x/+z diagonal, so the
   * dome is turned to put that diagonal along the wind (scene x/z, m/s).
   */
  update(camera: T.Camera, dt: number, wind: [number, number]) {
    this.mesh.position.copy(camera.position);
    const speed = Math.hypot(wind[0], wind[1]);
    this.cloudTime += dt * (0.4 + speed * RENDER_CONFIG.clouds.windFactor);
    this.mesh.material.uniforms.time.value = this.cloudTime;
    if (speed > 0.2)
      this.mesh.rotation.y = -Math.atan2(wind[1], wind[0]) + Math.PI / 4;
  }
}

/** Direct sunlight colour by elevation (warmer and dimmer toward the horizon). */
export function sunColor(elevation: number, out = new T.Color()) {
  const deg = elevation / RAD;
  const warm = new T.Color("#ff9a52"),
    noon = new T.Color("#fff3e0");
  const t = T.MathUtils.smoothstep(deg, 2, 35);
  return out.copy(warm).lerp(noon, t);
}

/** Haze / fog colour by sun elevation: day blue-grey, sunset amber, night. */
export function hazeColor(elevation: number, out = new T.Color()) {
  const deg = elevation / RAD;
  const night = new T.Color("#141a26"),
    dusk = new T.Color("#d9a67e"),
    day = new T.Color("#bfcdd6");
  const toDusk = daylight(elevation, RENDER_CONFIG.sun.twilightDeg);
  out.copy(night).lerp(dusk, toDusk);
  return out.lerp(day, T.MathUtils.smoothstep(deg, 4, 28));
}

/** Tone-mapping exposure by sun elevation (brighter at dusk, estimate). */
export function exposureFor(elevation: number) {
  const t = T.MathUtils.smoothstep(elevation / RAD, 0, 30);
  return T.MathUtils.lerp(
    RENDER_CONFIG.exposure.low,
    RENDER_CONFIG.exposure.noon,
    t,
  );
}
