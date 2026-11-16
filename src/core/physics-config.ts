/**
 * Physical constants and numerical parameters for the flight engine, in SI
 * units (m, kg, s, N, rad unless a name says otherwise). Values here are the
 * single source for the simulation, ground contact and their tests.
 */
export const PHYSICS = {
  /** Fixed integration step; the browser accumulates real time into these. */
  fixedDt: 1 / 120,
  /** Largest step `Simulation.step` accepts (catch-up bursts are refused). */
  maxDt: 1 / 30,
  /** Standard gravity, m/s². */
  gravity: 9.80665,
  /** Sea-level standard air density, kg/m³. */
  seaLevelDensity: 1.225,
  /**
   * Isothermal density scale height for the optional height lapse above the
   * field, ρ(h) = ρ_field·e^(−h/H). The field density already includes its
   * elevation from the standard atmosphere.
   */
  densityScaleHeightM: 8500,
  /**
   * Explicit-drag stability bound: body drag may remove at most this fraction
   * of the matching air-relative velocity component in one step, so a very
   * light, draggy body cannot reverse its velocity numerically.
   */
  maxDragVelocityFractionPerStep: 0.9,
  contact: {
    /** Sequential-impulse iterations per step. */
    iterations: 8,
    /** Allowed penetration before position projection, m. */
    slopM: 0.0005,
    /** Fraction of the penetration beyond the slop removed per step. */
    projection: 0.8,
    /** A contact counts as touching within this distance above ground, m. */
    touchToleranceM: 0.001,
    /** Wheel/skid sink speed that counts as a crash, m/s. */
    crashSinkMps: 4,
    /** Airframe (body point) sink speed and ground speed that crash, m/s. */
    bodyCrashSinkMps: 2.2,
    bodyCrashSpeedMps: 3,
    /** Tangential speed above which sliding friction uses μ_k, m/s. */
    slipSpeedMps: 0.05,
    /** At rest below these speeds a grounded, unpowered aircraft is snapped still. */
    restSpeedMps: 0.002,
    restRateRadS: 0.002,
  },
  /**
   * Coulomb friction. A contact pair uses μ = √(μ_contact·μ_surface)
   * (geometric-mean combination); kinetic friction is kineticRatio·μ_static.
   * The values reproduce the earlier rubber-tyre sliding coefficients
   * (asphalt 0.65, grass 0.50, dirt 0.55).
   */
  friction: {
    kineticRatio: 0.8,
    contact: { tyre: 0.8, skid: 0.45 },
    surface: { asphalt: 0.528, grass: 0.3125, dirt: 0.378 },
    /** Rolling-resistance coefficients C_rr for free-rolling tyres. */
    rolling: { asphalt: 0.025, grass: 0.09, dirt: 0.055 },
  },
} as const;

export type GroundSurface = keyof typeof PHYSICS.friction.surface;

/** Static and kinetic sliding coefficients for a contact on a surface. */
export function slidingFriction(
  contact: keyof typeof PHYSICS.friction.contact,
  surface: GroundSurface,
) {
  const staticMu = Math.sqrt(
    PHYSICS.friction.contact[contact] * PHYSICS.friction.surface[surface],
  );
  return {
    static: staticMu,
    kinetic: staticMu * PHYSICS.friction.kineticRatio,
  };
}
