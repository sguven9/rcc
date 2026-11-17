/**
 * Fixed-wing flight controller in ACRO (gyro rate) mode, as used by the
 * reference aircraft (iNav/Betaflight-style OSD shows "ACRO"). Sticks command
 * body rates; a gyro loop drives the aileron, elevator and rudder channels.
 * With the sticks centred the commanded rate is zero and the attitude is
 * held, so adding power accelerates the aircraft instead of pitching it up.
 * The controller never reads throttle, airspeed changes or trim targets; it
 * only reacts to measured rotation, like the real hardware.
 *
 * Loop per axis: u = ff + kp·e + I, İ = ki·e + ka·A, Ȧ = e − leak·|stick|·A,
 * where e is the rate error, ff the rate feedforward (the command that holds
 * the requested rate against the airframe's own damping) and A the
 * accumulated attitude error (Betaflight's "absolute control"): it removes
 * the attitude drift a plain PI rate loop leaves under a steadily growing
 * disturbance, such as the speed-stability pitch moment while the aircraft
 * accelerates. A leaks away while the stick is deflected, so a commanded
 * manoeuvre is not "caught up" after the stick returns to centre. Yaw has no
 * attitude term (heading hold would fight coordinated turns).
 *
 * Gains come from the aircraft's own control power and rate damping,
 * measured once from the force model at the reference speed and scaled with
 * airspeed (authority ∝ V², damping ∝ V; TPA-style). For a rate plant
 * q̇ = authority·u the roll/pitch loop is s³ + authority(kp s² + ki s + ka):
 * the gains place a triple pole at `bandwidth` (kp = 3ω/authority,
 * ki = 3ω²/authority, ka = ω³/authority); yaw is PI with a double pole
 * (kp = 2ω/authority, ki = ω²/authority). MANUAL mode (no gyro) leaves the
 * bare-airframe response untouched.
 */
import { clamp, type Vec3 } from "./math";

export const FLIGHT_CONTROLLER = {
  /** Full-stick rate commands, deg/s (roll, pitch, yaw). */
  ratesDegS: [220, 160, 90] as Vec3,
  /** Closed-loop pole per axis, rad/s (tuning estimate). */
  bandwidth: [14, 15, 6] as Vec3,
  /**
   * Fraction of the damping-based feedforward applied (estimate: the probe
   * damping misses sideslip and cross-coupling, which help a commanded roll,
   * so full feedforward overshoots).
   */
  feedforward: 0.5,
  /** Attitude-error leak per unit stick deflection, 1/s. */
  attitudeLeak: 20,
  /** Below this airspeed the gain stops rising (taxi, launch), m/s. */
  minSpeedMps: 5,
};

export interface ControlPower {
  /** Angular acceleration per unit channel command at `referenceSpeed`, rad/s². */
  perCommand: Vec3;
  /** Aerodynamic rate damping at `referenceSpeed`, 1/s. */
  damping: Vec3;
  referenceSpeed: number;
}

export interface AcroState {
  /** Integrator, channel units (initialise to the trim commands). */
  integral: Vec3;
  /** Accumulated attitude error, rad. */
  attitude: Vec3;
}

/**
 * One controller step: returns the channel commands and the next state.
 * Integration stops while an output saturates or on the ground.
 */
export function acroStep(
  sticks: Vec3,
  omega: Vec3,
  airspeed: number,
  state: AcroState,
  power: ControlPower,
  dt: number,
  grounded: boolean,
): { channels: Vec3; state: AcroState } {
  const c = FLIGHT_CONTROLLER;
  const ratio = Math.max(airspeed, c.minSpeedMps) / power.referenceSpeed;
  const channels: Vec3 = [0, 0, 0],
    integral: Vec3 = [...state.integral],
    attitude: Vec3 = [...state.attitude];
  for (let i = 0; i < 3; i++) {
    const authority = Math.abs(power.perCommand[i]) * ratio * ratio;
    if (!(authority > 1e-6)) {
      // No surface on this axis: pass the stick through.
      channels[i] = clamp(sticks[i], -1, 1);
      continue;
    }
    const w = c.bandwidth[i],
      sign = Math.sign(power.perCommand[i]),
      hold = i < 2;
    const kp = ((hold ? 3 * w : 2 * w) / authority) * sign,
      ki = ((hold ? 3 * w * w : w * w) / authority) * sign,
      ka = hold ? ((w * w * w) / authority) * sign : 0;
    const command = sticks[i] * ((c.ratesDegS[i] * Math.PI) / 180);
    const feedforward =
      ((c.feedforward * command * power.damping[i] * ratio) / authority) * sign;
    const error = command - omega[i];
    const raw = feedforward + state.integral[i] + kp * error;
    channels[i] = clamp(raw, -1, 1);
    const saturated =
      raw !== channels[i] && Math.sign(error * sign) === Math.sign(raw);
    if (grounded) {
      attitude[i] = 0;
      continue;
    }
    if (saturated) continue;
    integral[i] = clamp(
      state.integral[i] + (ki * error + ka * state.attitude[i]) * dt,
      -1,
      1,
    );
    attitude[i] = hold
      ? (state.attitude[i] + error * dt) /
        (1 + c.attitudeLeak * Math.abs(sticks[i]) * dt)
      : 0;
  }
  return { channels, state: { integral, attitude } };
}
