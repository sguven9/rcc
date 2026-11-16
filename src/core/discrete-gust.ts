/**
 * Discrete "1−cos" gusts on top of the mean wind and Dryden turbulence.
 *
 * Each gust has amplitude W_g, length t_g and a direction:
 *   w(τ) = (W_g/2)·(1 − cos(2π·τ/t_g)),  0 ≤ τ ≤ t_g,  0 otherwise,
 * so it starts and ends at zero with zero slope and peaks at W_g at τ = t_g/2
 * (the full-wave form of the certification discrete gust). Onsets follow a
 * Poisson process with the configured mean interval: waiting times are
 * exponential, drawn from a seeded PRNG, so a run with the same seed, timestep
 * and control frames (including manual triggers) is exactly reproducible.
 *
 * The gust is uniform over the airframe (no penetration delay along the
 * fuselage) and is evaluated at each integrator stage time, so its smooth
 * profile keeps the scheme second order.
 */
import { seededUniform } from "./atmosphere";
import { PHYSICS } from "./physics-config";
import { add, radians, scale, type Vec3 } from "./math";

export interface DiscreteGustSettings {
  /** Mean time between automatic gusts, s; 0 disables automatic gusts. */
  meanIntervalS: number;
  /** Gust peak W_g, m/s. */
  amplitudeMps: number;
}

export interface Gust {
  startS: number;
  durationS: number;
  /** Peak gust velocity W_g·d̂ in world north/east/down axes, m/s. */
  peak: Vec3;
}

/** 1−cos profile factor in [0, 1] at τ seconds into a gust of length t_g. */
export function oneMinusCosine(tauS: number, durationS: number) {
  if (!(durationS > 0) || !(tauS >= 0) || tauS > durationS) return 0;
  return 0.5 * (1 - Math.cos((2 * Math.PI * tauS) / durationS));
}

export class DiscreteGusts {
  private uniform: () => number;
  private nextOnsetS: number | undefined;
  active: Gust[] = [];
  constructor(seed: number) {
    // A separate stream from the Dryden generator, which uses the raw seed.
    this.uniform = seededUniform((seed ^ 0x5bd1e995) >>> 0);
  }
  /** Exponential waiting time with the given mean, s. */
  private wait(meanS: number) {
    return -Math.log(1 - this.uniform()) * meanS;
  }
  /** Start a gust at `timeS` with a seeded duration and direction. */
  trigger(timeS: number, amplitudeMps: number) {
    const g = PHYSICS.gust;
    const azimuth = 2 * Math.PI * this.uniform(),
      elevation = radians(g.maxElevationDeg) * (2 * this.uniform() - 1),
      durationS =
        g.durationMinS + (g.durationMaxS - g.durationMinS) * this.uniform();
    const direction: Vec3 = [
      Math.cos(elevation) * Math.cos(azimuth),
      Math.cos(elevation) * Math.sin(azimuth),
      -Math.sin(elevation),
    ];
    this.active.push({
      startS: timeS,
      durationS,
      peak: scale(direction, amplitudeMps),
    });
    if (this.active.length > g.maxActive) this.active.shift();
  }
  /**
   * Advance over [timeS, timeS + dt): drop finished gusts and start every
   * Poisson onset that falls inside the step (at its exact onset time).
   */
  advance(timeS: number, dt: number, settings?: DiscreteGustSettings) {
    this.active = this.active.filter((g) => timeS <= g.startS + g.durationS);
    if (!settings || !(settings.meanIntervalS > 0)) {
      this.nextOnsetS = undefined;
      return;
    }
    this.nextOnsetS ??= timeS + this.wait(settings.meanIntervalS);
    while (this.nextOnsetS < timeS + dt) {
      this.trigger(this.nextOnsetS, settings.amplitudeMps);
      this.nextOnsetS += this.wait(settings.meanIntervalS);
    }
  }
  /** Summed gust velocity at time t (world axes), m/s. */
  velocity(timeS: number): Vec3 {
    let v: Vec3 = [0, 0, 0];
    for (const g of this.active)
      v = add(v, scale(g.peak, oneMinusCosine(timeS - g.startS, g.durationS)));
    return v;
  }
}
