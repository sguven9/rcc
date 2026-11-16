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
  /**
   * Propeller side effects (gyroscopic moment, P-factor). Aircraft-specific
   * values (I_p, maximum rpm, k_p) live on each motor and default to zero.
   */
  propeller: {
    /**
     * P-factor uses sin α_p = |v_⊥| / max(|v_p|, v_fade) with
     * v_fade = max(this, tipSpeedFraction·Ω·R). Below v_fade the offset
     * grows linearly with the cross-flow instead (no singularity at rest), m/s.
     */
    pFactorFadeSpeedMps: 3,
    /**
     * Blade-element theory makes the thrust asymmetry scale with the in-plane
     * advance ratio μ = v_⊥/(Ω·R). Tying v_fade to 10 % of the tip speed keeps
     * sin α_p at cruise and gives μ-scaling at taxi and launch speeds.
     */
    pFactorTipSpeedFraction: 0.1,
  },
  /**
   * Dynamic shaft speed (motors with `motorPowerW`). Engineering estimates,
   * not measurements; see docs/physics-engine.md#dynamic-shaft-speed-0120.
   */
  rotor: {
    /** Motor torque is P/max(Ω, minSpeedFraction·Ω_max): finite at standstill. */
    minSpeedFraction: 0.05,
    /** Redline when `redlineRpm` is absent: this multiple of `maxRpm`. */
    defaultRedlineFactor: 1.3,
    /** The limiter fades motor torque to zero over this fraction below redline. */
    limiterBandFraction: 0.03,
    /** Torque reaches zero at J_max = this·J0 (thrust is zero at J0). */
    torqueZeroAdvanceFactor: 1.2,
    /**
     * Bearing/drag friction Q_f = c0·Ω/(Ω+Ω_s) + c1·Ω, sized as fractions of
     * the shaft power at Ω_max: c0 = f0·P/Ω_max, c1 = f1·P/Ω_max².
     */
    coulombFrictionFraction: 0.01,
    viscousFrictionFraction: 0.02,
    /** Ω_s: Coulomb friction ramps in over this fraction of Ω_max (no sign jump at 0). */
    frictionSmoothingFraction: 0.02,
    /** Above dt·|∂Ω̇/∂Ω| = this, the update switches to the L-stable form. */
    stiffLimit: 2,
    governor: {
      /** Constant-speed target as a fraction of `maxRpm`. */
      targetFraction: 1,
      /** Pitch factor g = g_i + Kp·e, g_i' = Ki·e, e = (Ω − Ω_t)/Ω_t. */
      proportional: 1.5,
      integral: 6,
      minPitch: 0.4,
      maxPitch: 1.8,
    },
  },
  /**
   * Slipstream swirl (dynamic-rotor motors). Angular-momentum flux through the
   * disk: Q = ṁ·ω_s·r_eff² with ṁ = ρ·A_p·(V + v_i), so
   * ω_s = k·Q/(ρ·A_p·(V + v_i)·r_eff²), r_eff = radiusFraction·R.
   */
  swirl: {
    enabled: true,
    coefficient: 0.5,
    radiusFraction: 0.7,
    /** Floor on the disk through-flow V + v_i in the swirl estimate, m/s. */
    minInducedMps: 0.5,
    /** Swirl side speed is capped at this fraction of the axial speed V + v_i. */
    maxSideFraction: 0.3,
  },
  /**
   * Discrete "1−cos" gusts, w(t) = (W_g/2)·(1 − cos(2π·t/t_g)) for
   * 0 ≤ t ≤ t_g, triggered by a seeded Poisson process. The environment sets
   * the mean interval and W_g; duration and direction are drawn per gust.
   */
  gust: {
    /** Defaults used by the UI and the manual trigger. */
    meanIntervalS: 20,
    amplitudeMps: 3,
    /** Gust length t_g drawn uniformly in this range, s. */
    durationMinS: 1,
    durationMaxS: 3,
    /** Direction elevation drawn uniformly within ±this angle, degrees. */
    maxElevationDeg: 20,
    /** Gusts overlapping at once, oldest dropped beyond this. */
    maxActive: 4,
  },
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
