/**
 * Propeller side effects on the airframe, in body axes and SI units. Pure
 * functions; each motor is evaluated separately and the results are summed.
 *
 * Spin convention (unchanged from the existing reaction torque): a fixed-wing
 * "cw" propeller turns clockwise seen from behind (from the cockpit), so its
 * angular velocity points along the thrust axis. A multirotor or VTOL "cw"
 * rotor turns clockwise seen from above, so its angular velocity points
 * against the (upward) thrust axis.
 *
 * - Gyroscopic moment: H = I_p·Ω·ŝ, M_gyro = −ω × H (rigid body carrying a
 *   spinning rotor at constant rpm; the spin-up term I_p·dΩ/dt is folded into
 *   the reaction torque).
 * - P-factor: the blade whose tangential velocity adds to the cross-flow
 *   carries more thrust, so the thrust centre moves in the disk plane by
 *   Δ = k_p·R·(v_⊥ × ŝ)/max(|v_p|, v_fade), |Δ| = k_p·R·sin α_p, and
 *   M_p = Δ × T·ê. v_fade = max(3 m/s, 0.1·Ω·R): above it this is the
 *   sin α_p law; below it the shift follows the in-plane advance ratio
 *   v_⊥/(Ω·R), as blade-element theory gives at low forward speed.
 */
import { PHYSICS } from "./physics-config";
import { cross, dot, length, scale, sub, type Vec3 } from "./math";
import type { Aircraft } from "./schema";

type Motor = Aircraft["motors"][number];

/** Unit angular-velocity direction ŝ of a propeller with thrust axis ê. */
export function propellerSpinAxis(
  thrustAxis: Vec3,
  spin: Motor["spin"],
  rotor: boolean,
): Vec3 | null {
  if (!spin) return null;
  const sign = (spin === "cw" ? 1 : -1) * (rotor ? -1 : 1);
  return scale(thrustAxis, sign);
}

/** Shaft speed Ω (rad/s) from the motor's rpm ratio n/n_max; 0 without `maxRpm`. */
export function propellerSpeedRadS(motor: Motor, rpmRatio: number) {
  if (!motor.maxRpm || !(rpmRatio > 0)) return 0;
  return ((motor.maxRpm * 2 * Math.PI) / 60) * rpmRatio;
}

/** v_fade for the P-factor: the larger of the floor and a tip-speed fraction, m/s. */
export function pFactorFadeSpeed(spinRadS: number, radiusM: number) {
  const p = PHYSICS.propeller;
  return Math.max(
    p.pFactorFadeSpeedMps,
    p.pFactorTipSpeedFraction * spinRadS * radiusM,
  );
}

/** M_gyro = −ω × (I_p·Ω·ŝ), N·m. */
export function gyroscopicMoment(
  omegaBody: Vec3,
  inertiaKgM2: number,
  spinRadS: number,
  spinAxis: Vec3,
): Vec3 {
  const h = scale(spinAxis, inertiaKgM2 * spinRadS);
  return scale(cross(omegaBody, h), -1);
}

/**
 * P-factor thrust-centre offset in the disk plane, m. `localFlow` is the
 * propeller's velocity relative to the air in body axes (v + ω × r).
 */
export function pFactorOffset(
  localFlow: Vec3,
  thrustAxis: Vec3,
  spinAxis: Vec3,
  pFactor: number,
  radiusM: number,
  fadeSpeedMps: number = PHYSICS.propeller.pFactorFadeSpeedMps,
): Vec3 {
  if (!(pFactor > 0) || !(radiusM > 0)) return [0, 0, 0];
  const across = sub(localFlow, scale(thrustAxis, dot(localFlow, thrustAxis)));
  const reference = Math.max(length(localFlow), fadeSpeedMps);
  return scale(cross(across, spinAxis), (pFactor * radiusM) / reference);
}

/** Yawing/pitching moment of the shifted thrust, N·m. Negative thrust is ignored. */
export function pFactorMoment(offset: Vec3, thrustAxis: Vec3, thrustN: number) {
  return cross(offset, scale(thrustAxis, Math.max(0, thrustN)));
}

/** Combined gyroscopic and P-factor moment of one motor. */
export function propellerMoments(
  motor: Motor,
  options: {
    thrustAxis: Vec3;
    rotor: boolean;
    omegaBody: Vec3;
    rpmRatio: number;
    thrustN: number;
    localFlow?: Vec3;
  },
) {
  const zero: Vec3 = [0, 0, 0];
  const axis = propellerSpinAxis(options.thrustAxis, motor.spin, options.rotor);
  if (!axis) return { gyro: zero, pFactor: zero };
  const spin = propellerSpeedRadS(motor, options.rpmRatio);
  const gyro =
    motor.propInertiaKgM2 && spin > 0
      ? gyroscopicMoment(options.omegaBody, motor.propInertiaKgM2, spin, axis)
      : zero;
  const pFactor =
    motor.pFactor && options.localFlow && options.thrustN > 0
      ? pFactorMoment(
          pFactorOffset(
            options.localFlow,
            options.thrustAxis,
            axis,
            motor.pFactor,
            motor.propDiameterM / 2,
            pFactorFadeSpeed(spin, motor.propDiameterM / 2),
          ),
          options.thrustAxis,
          options.thrustN,
        )
      : zero;
  return { gyro, pFactor };
}
