/**
 * Dynamic propeller shaft speed Ω (rad/s), one state per motor. Pure
 * functions; SI units. Active only for motors that define `motorPowerW` (with
 * `spin`, `propInertiaKgM2` and `maxRpm`); every other motor keeps the
 * quasi-static rpm law of `powertrain`.
 *
 *   I_tot·dΩ/dt = Q_motor(c, Ω) − Q_prop(Ω, V, ρ) − Q_friction(Ω)
 *
 * Propeller (linear advance-ratio laws, n = Ω/2π, pitch factor g = 1 unless
 * governed):
 *   T = C_t0·g·ρ·n²·D⁴·(1 − J/(g·J0))  ⇔  T = A_t·ρ·Ω·(g·Ω − Ω_max·V/V0)
 *   Q = C_q0·g·ρ·n²·D⁵·(1 − J/(g·J_max)) ⇔ Q = A_q·ρ·Ω·(g·Ω − Ω_max·V/(k·V0))
 * with A_t = T_max/(ρ_ref·Ω_max²), J0 = V0/(n_max·D) and J_max = k·J0. The
 * thrust law is exactly the existing `thrustSpeedFactor` law with
 * r = Ω/Ω_max, so thrust is computed once, by the existing code.
 *
 * Calibration: A_q follows from `motorPowerW` at the static full-command
 * point, P = (A_q·ρ_ref·Ω_max² + Q_f(Ω_max))·Ω_max. The power available at a
 * command c is the shaft power that holds the quasi-static rpm Ω_c of
 * `powertrain` at rest, so the static thrust curve is unchanged.
 *
 * Motor: Q_m = P(c)·η(ρ)/max(Ω, Ω_min), faded to zero just below redline.
 * η = 1 for electric motors, ρ/ρ_ref for piston engines.
 */
import { PHYSICS } from "./physics-config";
import { clamp } from "./math";
import type { Aircraft } from "./schema";

type Motor = Aircraft["motors"][number];

export interface RotorModel {
  /** I_p + I_motor, kg·m². */
  inertia: number;
  omegaMax: number;
  omegaRedline: number;
  omegaMin: number;
  /** Rated shaft power at Ω_max and the reference density, W. */
  powerW: number;
  referenceDensity: number;
  /** Torque and thrust constants: Q = A_q·ρ·Ω·(gΩ − ...), T = A_t·ρ·Ω·(gΩ − ...). */
  aq: number;
  at: number;
  zeroThrustSpeed: number;
  torqueZeroFactor: number;
  c0: number;
  c1: number;
  omegaSmooth: number;
  piston: boolean;
  governed: boolean;
}

const rpmToRadS = (rpm: number) => (rpm * 2 * Math.PI) / 60;

/** Friction torque Q_f = c0·Ω/(Ω+Ω_s) + c1·Ω (zero at rest, no sign jump). */
export function frictionTorque(model: RotorModel, omega: number) {
  const w = Math.max(0, omega);
  return (model.c0 * w) / (w + model.omegaSmooth) + model.c1 * w;
}

export function rotorModel(m: Motor): RotorModel | null {
  if (!m.motorPowerW || !m.propInertiaKgM2 || !m.maxRpm || !m.spin) return null;
  const c = PHYSICS.rotor;
  const omegaMax = rpmToRadS(m.maxRpm),
    powerW = m.motorPowerW,
    referenceDensity = m.performance?.referenceDensityKgM3 ?? 1.225;
  const partial: RotorModel = {
    inertia: m.propInertiaKgM2 + (m.motorInertiaKgM2 ?? 0),
    omegaMax,
    omegaRedline: rpmToRadS(m.redlineRpm ?? m.maxRpm * c.defaultRedlineFactor),
    omegaMin: c.minSpeedFraction * omegaMax,
    powerW,
    referenceDensity,
    aq: 0,
    at: m.maxThrustN / (referenceDensity * omegaMax * omegaMax),
    zeroThrustSpeed: m.zeroThrustSpeedMps,
    torqueZeroFactor: c.torqueZeroAdvanceFactor,
    c0: (c.coulombFrictionFraction * powerW) / omegaMax,
    c1: (c.viscousFrictionFraction * powerW) / (omegaMax * omegaMax),
    omegaSmooth: c.frictionSmoothingFraction * omegaMax,
    piston: m.engine === "piston",
    governed: !!m.propGovernor,
  };
  partial.aq =
    (powerW / omegaMax - frictionTorque(partial, omegaMax)) /
    (referenceDensity * omegaMax * omegaMax);
  return partial;
}

export interface RotorInputs {
  /** Quasi-static rpm ratio n/n_max of the command (from `powertrain`). */
  commandRpmRatio: number;
  /** Axial inflow speed V ≥ 0 at the disk, m/s. */
  axialSpeedMps: number;
  density: number;
  /** Pitch factor g (1 for fixed pitch). */
  pitch: number;
}

/** Shaft power available at the command, W. */
export function availablePower(model: RotorModel, input: RotorInputs) {
  const wc = model.omegaMax * Math.max(0, input.commandRpmRatio);
  const power =
    (model.aq * model.referenceDensity * wc * wc + frictionTorque(model, wc)) *
    wc;
  return model.piston
    ? (power * input.density) / model.referenceDensity
    : power;
}

/** Propeller load torque, N·m (negative when windmilling). */
export function propellerTorque(
  model: RotorModel,
  omega: number,
  input: RotorInputs,
) {
  const unloaded =
    (model.omegaMax * Math.max(0, input.axialSpeedMps)) /
    (model.torqueZeroFactor * model.zeroThrustSpeed);
  return model.aq * input.density * omega * (input.pitch * omega - unloaded);
}

/** All torques, Ω̇ and ∂Ω̇/∂Ω at one shaft speed. */
export function rotorTorques(
  model: RotorModel,
  omega: number,
  input: RotorInputs,
) {
  const w = Math.max(0, omega);
  const power = availablePower(model, input),
    band = PHYSICS.rotor.limiterBandFraction * model.omegaRedline;
  const limiter = clamp((model.omegaRedline - w) / band, 0, 1);
  const lever = Math.max(w, model.omegaMin);
  const qMotor = (power / lever) * limiter;
  const qProp = propellerTorque(model, w, input);
  const qFriction = frictionTorque(model, w);
  const qNet = qMotor - qProp - qFriction;
  // Analytical slope of each torque with Ω.
  const dMotor =
    (w > model.omegaMin ? (-power / (w * w)) * limiter : 0) +
    (limiter > 0 && limiter < 1 ? -(power / lever) / band : 0);
  const unloaded =
    (model.omegaMax * Math.max(0, input.axialSpeedMps)) /
    (model.torqueZeroFactor * model.zeroThrustSpeed);
  const dProp = model.aq * input.density * (2 * input.pitch * w - unloaded);
  const dFriction =
    (model.c0 * model.omegaSmooth) / (w + model.omegaSmooth) ** 2 + model.c1;
  return {
    qMotor,
    qProp,
    qFriction,
    qNet,
    omegaDot: qNet / model.inertia,
    jacobian: (dMotor - dProp - dFriction) / model.inertia,
  };
}

/**
 * Steady shaft speed where Q_motor = Q_prop + Q_friction, by bisection on
 * [0, Ω_redline]. Returns the highest root (the windmilling branch when the
 * motor is off in a fast airflow, zero when nothing drives the propeller).
 */
export function equilibriumRotorSpeed(model: RotorModel, input: RotorInputs) {
  const net = (w: number) => rotorTorques(model, w, input).qNet;
  if (net(model.omegaRedline) >= 0) return model.omegaRedline;
  // Find a point with positive net torque, scanning down from redline.
  let lo = -1;
  for (let k = 1; k <= 200; k++) {
    const w = (model.omegaRedline * (200 - k)) / 200;
    if (w > 0 && net(w) > 0) {
      lo = w;
      break;
    }
  }
  if (lo < 0) return 0;
  let hi = model.omegaRedline;
  for (let n = 0; n < 80; n++) {
    const mid = (lo + hi) / 2;
    if (net(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Constant-speed governor: pitch factor from its integral state and Ω. */
export function governorPitch(
  model: RotorModel,
  integral: number,
  omega: number,
) {
  if (!model.governed) return 1;
  const g = PHYSICS.rotor.governor,
    target = g.targetFraction * model.omegaMax;
  const error = (omega - target) / target;
  return clamp(integral + g.proportional * error, g.minPitch, g.maxPitch);
}

/** Governor integral rate, with anti-windup at the pitch stops. */
export function governorRate(
  model: RotorModel,
  integral: number,
  omega: number,
) {
  if (!model.governed) return 0;
  const g = PHYSICS.rotor.governor,
    target = g.targetFraction * model.omegaMax;
  const error = (omega - target) / target;
  const pitch = integral + g.proportional * error;
  if ((pitch >= g.maxPitch && error > 0) || (pitch <= g.minPitch && error < 0))
    return 0;
  return g.integral * error;
}

/**
 * One linearly implicit midpoint update of Ω (second order; A-stable). `f`
 * and `jacobian` come from the midpoint stage, `omegaMid` is the stage value.
 * When the rotor is faster than the step resolves (dt·|J| above the stiff
 * limit) the L-stable form is used so the update cannot ring. Positive slopes
 * (unstable windmill branch) are treated explicitly.
 */
export function advanceRotorSpeed(
  model: RotorModel,
  omega: number,
  omegaMid: number,
  f: number,
  jacobian: number,
  dt: number,
) {
  const j = Math.min(0, jacobian);
  const stiff = -j * dt > PHYSICS.rotor.stiffLimit;
  const next =
    omega +
    (dt * (f + j * (omega - omegaMid))) / (1 - j * dt * (stiff ? 1 : 0.5));
  return clamp(Number.isFinite(next) ? next : omega, 0, model.omegaRedline);
}

/** Linearly implicit half step for the midpoint stage value of Ω. */
export function rotorHalfStep(
  model: RotorModel,
  omega: number,
  f: number,
  jacobian: number,
  dt: number,
) {
  const j = Math.min(0, jacobian);
  const next = omega + ((dt / 2) * f) / (1 - (j * dt) / 2);
  return clamp(Number.isFinite(next) ? next : omega, 0, model.omegaRedline);
}
