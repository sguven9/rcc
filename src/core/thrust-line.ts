import type { Aircraft } from "./schema";
import { calmEnvironment, Simulation } from "./simulation";
import { findTrim } from "./trim";

/**
 * Pitching moment change (N·m) from full power at the trimmed cruise state,
 * for a trial down-thrust angle applied to every fixed-wing motor.
 */
export function powerPitchMoment(a: Aircraft, downThrustDeg: number) {
  const trial = structuredClone(a);
  for (const m of trial.motors) m.downThrustDeg = downThrustDeg;
  const speed = a.reference.trimSpeedMps ?? 12;
  const trim = findTrim(trial, speed, calmEnvironment());
  const sim = new Simulation(trial);
  const full = structuredClone(trim.state);
  full.motors = full.motors.map(() => 1);
  return (
    sim.forces(full, { ...trim.controls, throttle: 1 }).torque[1] -
    sim.forces(trim.state, trim.controls).torque[1]
  );
}

/**
 * The builder's power test: the down-thrust angle (degrees, 0.1° steps) for
 * which full power leaves the pitching moment at the cruise trim unchanged.
 * Sign-agnostic, so a pusher behind the CG is handled. Returns 0 when no
 * angle in [−5°, 8°] balances it. Up-thrust solutions are clamped to 0: the
 * thrust line then runs through the CG and full power pitches slightly down.
 */
export function solveDownThrust(a: Aircraft) {
  let lo = -5,
    hi = 8;
  const f = (d: number) => powerPitchMoment(a, d);
  const flo = f(lo);
  if (flo * f(hi) >= 0) return 0;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) * flo > 0) lo = mid;
    else hi = mid;
  }
  return Math.max(0, Math.round(((lo + hi) / 2) * 10) / 10);
}
