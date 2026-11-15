/**
 * Near-ground atmosphere and ground-proximity models. Pure functions and a
 * seeded turbulence generator; no DOM or rendering imports.
 *
 * - Logarithmic neutral-stability wind profile (wind gradient near the ground).
 * - MIL-F-8785C low-altitude Dryden turbulence, discrete first-order form.
 * - McCormick wing-in-ground-effect induced-drag factor.
 * - Cheeseman–Bennett rotor thrust increase in ground effect.
 *
 * These are textbook engineering models, not calibrated to a measured site or
 * aircraft. See docs/atmosphere-and-ground-effect.md for equations and limits.
 */
import { clamp, type Vec3 } from "./math";

export const FEET = 0.3048;
/** MIL-F-8785C ties low-altitude intensity to the mean wind at 20 ft. */
export const W20_HEIGHT_M = 20 * FEET;

export interface WindProfile {
  /** Height at which `Environment.windMps` is specified, metres. */
  referenceHeightM: number;
  /** Aerodynamic roughness length z0, metres (open grass ≈ 0.03 m). */
  roughnessLengthM: number;
}
export const defaultWindProfile = (): WindProfile => ({
  referenceHeightM: 10,
  roughnessLengthM: 0.03,
});

/**
 * Ratio of mean horizontal wind at `heightM` to the reference wind,
 * U(h)/U(href) = ln(h/z0)/ln(href/z0). Zero at or below z0.
 */
export function shearFactor(heightM: number, profile: WindProfile): number {
  const z0 = profile.roughnessLengthM;
  if (!(heightM > z0)) return 0;
  return Math.log(heightM / z0) / Math.log(profile.referenceHeightM / z0);
}

/** Mean wind at a world position, with the horizontal component sheared. */
export function meanWindAt(
  windMps: Vec3,
  heightM: number,
  profile?: WindProfile,
): Vec3 {
  if (!profile) return windMps;
  const k = shearFactor(heightM, profile);
  return [windMps[0] * k, windMps[1] * k, windMps[2]];
}

/** Horizontal mean-wind speed at 20 ft, the Dryden low-altitude input. */
export function windAt20Ft(windMps: Vec3, profile?: WindProfile): number {
  const horizontal = Math.hypot(windMps[0], windMps[1]);
  return profile ? horizontal * shearFactor(W20_HEIGHT_M, profile) : horizontal;
}

/**
 * MIL-F-8785C low-altitude (below 1000 ft) intensities and scale lengths,
 * converted to SI. Height is clamped to the specification's 10–1000 ft range.
 */
export function drydenParameters(heightM: number, w20Mps: number) {
  const h = clamp(heightM / FEET, 10, 1000);
  const base = 0.177 + 0.000823 * h;
  const sigmaW = 0.1 * w20Mps,
    sigmaUV = sigmaW / base ** 0.4;
  const lengthUV = (h / base ** 1.2) * FEET,
    lengthW = h * FEET;
  return {
    sigma: [sigmaUV, sigmaUV, sigmaW] as Vec3,
    scaleLength: [lengthUV, lengthUV, lengthW] as Vec3,
  };
}

/** Small deterministic PRNG (mulberry32) with Box–Muller normal samples. */
function normalSource(seed: number) {
  let a = (seed ^ 0x9e3779b9) >>> 0;
  let spare: number | undefined;
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => {
    if (spare !== undefined) {
      const s = spare;
      spare = undefined;
      return s;
    }
    const u = Math.max(uniform(), 1e-12),
      v = uniform();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
}

/**
 * Seeded Dryden gust generator. Each component follows the MIL-F-8785C discrete
 * first-order recursion x ← a·x + σ·√(1−a²)·η with a = exp(−V·dt/L), whose
 * stationary variance is exactly σ². Turbulence axes follow the mean wind:
 * u along the horizontal wind, v to its right, w down. The gust is uniform over
 * the airframe; angular (gust-gradient) terms are not modeled.
 */
export class DrydenTurbulence {
  private normal: () => number;
  private axes: Vec3 = [0, 0, 0];
  /** Current gust velocity in world north/east/down axes, m/s. */
  gust: Vec3 = [0, 0, 0];
  constructor(seed: number) {
    this.normal = normalSource(seed);
  }
  /** Draw the starting gust from the stationary distribution. */
  initialize(heightM: number, windMps: Vec3, profile?: WindProfile) {
    const { sigma } = drydenParameters(heightM, windAt20Ft(windMps, profile));
    this.axes = sigma.map((s) => s * this.normal()) as Vec3;
    this.gust = this.toWorld(windMps);
  }
  advance(
    dt: number,
    airspeedMps: number,
    heightM: number,
    windMps: Vec3,
    profile?: WindProfile,
  ): Vec3 {
    const { sigma, scaleLength } = drydenParameters(
      heightM,
      windAt20Ft(windMps, profile),
    );
    const v = Math.max(airspeedMps, 1);
    this.axes = this.axes.map((x, i) => {
      const a = Math.exp((-v * dt) / scaleLength[i]);
      return a * x + sigma[i] * Math.sqrt(1 - a * a) * this.normal();
    }) as Vec3;
    this.gust = this.toWorld(windMps);
    return this.gust;
  }
  private toWorld(windMps: Vec3): Vec3 {
    const heading = Math.atan2(windMps[1], windMps[0]),
      c = Math.cos(heading),
      s = Math.sin(heading);
    const [u, v, w] = this.axes;
    return [u * c - v * s, u * s + v * c, w];
  }
}

/**
 * McCormick's induced-drag factor φ = (16h/b)²/(1+(16h/b)²) for a lifting
 * surface of span b at height h above a flat ground plane. Between h/b = 1 and
 * 2 the residual (1−φ < 0.4%) is blended smoothly to exactly 1, so free-air
 * loads are unchanged above two spans.
 */
export function wingGroundEffect(heightM: number, spanM: number): number {
  if (!(spanM > 0)) return 1;
  const ratio = Math.max(0, heightM) / spanM;
  if (ratio >= 2) return 1;
  const x = 16 * ratio,
    phi = (x * x) / (1 + x * x);
  const t = clamp(ratio - 1, 0, 1),
    fade = t * t * (3 - 2 * t);
  return phi + (1 - phi) * fade;
}

/**
 * Lift-slope ratio in ground effect from lifting-line theory: the finite-wing
 * slope a = a0/(1 + a0/(πAe)) becomes a0/(1 + φ·a0/(πAe)). Returns 1 when the
 * supplied slope is not consistent with the aspect ratio and efficiency.
 */
export function groundEffectLiftRatio(
  liftSlope: number,
  aspectRatio: number,
  efficiency: number,
  phi: number,
): number {
  const k = Math.PI * aspectRatio * efficiency;
  if (!(k > 0) || !(liftSlope > 0) || liftSlope >= k) return 1;
  const a0 = liftSlope / (1 - liftSlope / k);
  return a0 / (1 + (phi * a0) / k) / liftSlope;
}

/** Below z/R = 0.5 the Cheeseman–Bennett expression is outside its basis. */
export const ROTOR_GROUND_EFFECT_MIN_HEIGHT_RATIO = 0.5;
/**
 * Cheeseman–Bennett hover thrust ratio T_IGE/T_OGE = 1/(1 − (R/4z)²) at equal
 * power, where z is the distance from the rotor disk to the ground along its
 * axis. Clamped at z/R = 0.5 (ratio 4/3). The small residual between z/R = 2
 * and 4 (below 1.6%) is blended smoothly to exactly 1.
 */
export function rotorGroundEffect(axisDistanceM: number, radiusM: number) {
  if (!(radiusM > 0) || !(axisDistanceM > 0)) return 1;
  const ratio = axisDistanceM / radiusM;
  if (ratio >= 4) return 1;
  const z = Math.max(ratio, ROTOR_GROUND_EFFECT_MIN_HEIGHT_RATIO);
  const gain = 1 / (1 - 1 / (16 * z * z)) - 1;
  const t = clamp((ratio - 2) / 2, 0, 1),
    fade = t * t * (3 - 2 * t);
  return 1 + gain * (1 - fade);
}
