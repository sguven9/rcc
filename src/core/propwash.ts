/**
 * Propeller slipstream over lifting surfaces from axial momentum
 * (actuator-disk) theory. Pure functions; SI units.
 *
 * - Induced velocity at the disk: v_i = −V/2 + √((V/2)² + T/(2ρA)).
 * - Axial increment a distance x behind the disk (potential-flow actuator
 *   disk): w(x) = v_i · (1 + x / √(x² + R²)), from v_i at the disk to 2·v_i
 *   in the far wake.
 * - Slipstream radius by continuity: R(x) = R · √((V + v_i) / (V + w(x))).
 * - A surface sees the slipstream over the part of its span that crosses
 *   that circle; the surface's mean dynamic pressure is the span-weighted
 *   average of slipstream and free-stream values.
 *
 * Swirl, viscous mixing, blade-count and fuselage blockage are not modeled.
 * See B. W. McCormick, Aerodynamics, Aeronautics, and Flight Mechanics,
 * propeller momentum theory.
 */

/** Disk induced velocity (m/s) for thrust T (N) at axial inflow V ≥ 0. */
export function diskInducedVelocity(
  thrustN: number,
  axialSpeedMps: number,
  densityKgM3: number,
  radiusM: number,
) {
  if (!(thrustN > 0) || !(radiusM > 0) || !(densityKgM3 > 0)) return 0;
  const half = Math.max(0, axialSpeedMps) / 2,
    area = Math.PI * radiusM * radiusM;
  return -half + Math.sqrt(half * half + thrustN / (2 * densityKgM3 * area));
}

/** Axial velocity increment and slipstream radius at distance x ≥ 0 behind the disk. */
export function slipstreamAt(
  distanceM: number,
  inducedMps: number,
  axialSpeedMps: number,
  radiusM: number,
) {
  const x = Math.max(0, distanceM),
    v = Math.max(0, axialSpeedMps);
  const increment = inducedMps * (1 + x / Math.hypot(x, radiusM));
  const radius =
    increment > 0
      ? radiusM * Math.sqrt((v + inducedMps) / Math.max(v + increment, 1e-9))
      : radiusM;
  return { increment, radius };
}

/**
 * Fraction of a straight surface's span inside a circular slipstream.
 * `spanOffsetM` is the slipstream centre along the span from the surface
 * centre; `normalOffsetM` is its distance from the surface plane.
 */
export function spanCoverage(
  spanOffsetM: number,
  normalOffsetM: number,
  slipstreamRadiusM: number,
  spanM: number,
) {
  if (!(spanM > 0) || Math.abs(normalOffsetM) >= slipstreamRadiusM) return 0;
  const half = Math.sqrt(slipstreamRadiusM ** 2 - normalOffsetM ** 2);
  const lo = Math.max(spanOffsetM - half, -spanM / 2),
    hi = Math.min(spanOffsetM + half, spanM / 2);
  return Math.max(0, hi - lo) / spanM;
}
