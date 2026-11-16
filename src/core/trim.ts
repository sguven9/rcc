import { findVtolHoverTrim } from "./vtol-trim";
import { vtolMotorIndices } from "./vtol";
import type { Aircraft } from "./schema";
import { surfaceCommand } from "./surface-control";
import {
  Simulation,
  initialState,
  calmEnvironment,
  type Controls,
  GRAVITY,
} from "./simulation";
import { meanWindAt } from "./atmosphere";
import {
  add,
  rotate,
  invert,
  matVec,
  clamp,
  radians,
  mulQ,
  axisQ,
  type Vec3,
  type Mat3,
} from "./math";
/** Fixed-wing trim states are built at this height above the field. */
export const TRIM_HEIGHT_M = 18;
/**
 * Solve steady wings-level flight: pitch, elevator and throttle, plus aileron
 * and rudder trim for asymmetric propeller torque. Not an autopilot or a
 * fidelity guarantee.
 */
export function findTrim(
  a: Aircraft,
  speed = a.reference.trimSpeedMps ?? 12,
  environment = calmEnvironment(),
  flightPathDeg = 0,
  vtolMode: "hover" | "cruise" = "hover",
) {
  // Trim the mean flow: a random turbulence sample is not an operating point.
  if (environment.turbulence)
    environment = { ...environment, turbulence: undefined };
  if (a.vtol && vtolMode === "hover") return findVtolHoverTrim(a, environment);
  const sim = new Simulation(a, environment);
  const prepareCruise = (s: ReturnType<typeof initialState>) => {
    if (s.vtol) {
      s.vtol.phase = "cruise";
      s.vtol.requestedMode = "cruise";
      s.vtol.commonTiltDeg = 90;
      s.vtol.tiltDeg = [90, 90];
      s.motors[vtolMotorIndices(a)[2]] = 0;
    }
  };
  if (a.vehicleType === "multirotor") {
    let lo = 0,
      hi = 1;
    const trial = initialState(a, 0, 3, 0);
    for (let n = 0; n < 45; n++) {
      const mid = (lo + hi) / 2;
      trial.motors.fill(mid);
      const f = sim.forces(trial, { roll: 0, pitch: 0, yaw: 0, throttle: mid });
      if (-f.force[2] < sim.properties.mass * GRAVITY) lo = mid;
      else hi = mid;
    }
    const throttle = (lo + hi) / 2,
      controls = { roll: 0, pitch: 0, yaw: 0, throttle: clamp(throttle, 0, 1) },
      state = initialState(a, 0, 3, 0);
    state.motors.fill(controls.throttle);
    const f = sim.forces(state, controls),
      residual: [number, number, number] = [
        f.force[2] + sim.properties.mass * GRAVITY,
        f.torque[0],
        f.torque[1],
      ];
    return {
      controls,
      state,
      converged: throttle < 1 && Math.hypot(...residual) < 0.01,
      residual,
      pitchDeg: 0,
    };
  }
  const flightPath = radians(flightPathDeg);
  // Steady flight moves with the air mass: the requested speed is airspeed
  // along local +X, and the ground velocity adds the mean wind at trim height.
  // A crosswind therefore produces drift, never a trimmed sideslip.
  const velocity: Vec3 = add(
    [speed * Math.cos(flightPath), 0, -speed * Math.sin(flightPath)],
    meanWindAt(environment.windMps, TRIM_HEIGHT_M, environment.windProfile),
  );
  // Lateral trim [aileron, rudder, sideslip rad], solved below for propeller
  // torque. Zero for symmetric aircraft.
  const lateral: Vec3 = [0, 0, 0];
  // Sideslip β turns the nose left of the flight path (heading −β), so the
  // ground track and flight-path angle stay as requested.
  // A sideslip trim makes a side force; a small bank tilts the lift to cancel
  // it, so the trimmed flight is straight as well as moment-free.
  let bank = 0;
  const withSideslip = (s: ReturnType<typeof initialState>, beta: number) => {
    if (bank) s.orientation = mulQ(s.orientation, axisQ([1, 0, 0], bank));
    if (beta) s.orientation = mulQ(axisQ([0, 0, 1], -beta), s.orientation);
    return s;
  };
  const loads = (x: Vec3, lat: Vec3 = lateral) => {
    const s = withSideslip(initialState(a, speed, TRIM_HEIGHT_M, x[0]), lat[2]);
    s.velocity = [...velocity];
    s.motors.fill(x[2]);
    prepareCruise(s);
    return {
      s,
      f: sim.forces(s, {
        roll: lat[0],
        pitch: x[1],
        yaw: lat[1],
        throttle: x[2],
      }),
    };
  };
  const residual = (x: Vec3): Vec3 => {
    const { s, f } = loads(x);
    const world = rotate(s.orientation, f.force);
    return [world[0], world[2] + sim.properties.mass * GRAVITY, f.torque[1]];
  };
  let x: Vec3 = [3 + flightPathDeg, 0.1, 0.5];
  const solveLongitudinal = () => {
    for (let n = 0; n < 25; n++) {
      const r = residual(x);
      if (Math.hypot(...r) < 1e-5) break;
      const jac: Mat3 = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ];
      for (let j = 0; j < 3; j++) {
        const y = [...x] as Vec3;
        y[j] += 0.0001;
        const v = residual(y);
        for (let i = 0; i < 3; i++) jac[i][j] = (v[i] - r[i]) / 0.0001;
      }
      try {
        const dx = matVec(invert(jac), r);
        x = [
          clamp(x[0] - dx[0], -10 + flightPathDeg, 15 + flightPathDeg),
          clamp(x[1] - dx[1], -1, 1),
          clamp(x[2] - dx[2], 0, 1),
        ];
      } catch {
        break;
      }
    }
  };
  solveLongitudinal();
  // A propeller's reaction torque, P-factor and slipstream make a real model
  // roll and yaw. Modellers cancel that at cruise with aileron and rudder trim;
  // solve the same offsets (least squares over the channels that have
  // authority) so wings-level, zero-sideslip flight is balanced. Symmetric
  // aircraft skip this and keep exactly zero lateral trim.
  // A rudder-only (or aileron-only) model balances the roll and yaw moments
  // with a small sideslip instead; that sideslip is then the third unknown.
  if (!a.vtol) {
    const lateralResidual = (lat: Vec3) => {
      const { f } = loads(x, lat);
      return [f.torque[0], f.torque[2]] as [number, number];
    };
    const h = 0.0001;
    const column = (j: number, r: [number, number]) => {
      const y: Vec3 = [...lateral];
      y[j] += h;
      const v = lateralResidual(y);
      return [(v[0] - r[0]) / h, (v[1] - r[1]) / h] as [number, number];
    };
    let unknowns: number[] | undefined;
    const sideForce = () => {
      const { s, f } = loads(x);
      return rotate(s.orientation, f.force)[1];
    };
    for (let pass = 0; pass < 12; pass++) {
      if (lateral[2]) {
        // Bank so the lift's horizontal part balances the side force.
        bank = clamp(
          bank - sideForce() / (sim.properties.mass * GRAVITY),
          -radians(15),
          radians(15),
        );
        solveLongitudinal();
      }
      const r = lateralResidual(lateral);
      if (
        Math.hypot(...r) < 1e-6 &&
        (!lateral[2] || Math.abs(sideForce()) < 1e-6)
      )
        break;
      if (!unknowns) {
        const controls = [0, 1].filter(
          (j) => Math.hypot(...column(j, r)) > 1e-6,
        );
        unknowns = controls.length === 2 ? controls : [...controls, 2];
      }
      const [c0, c1] = unknowns.map((j) => column(j, r));
      if (!c1) break;
      // Newton step on the 2×2 system J·Δ = r.
      const det = c0[0] * c1[1] - c1[0] * c0[1];
      if (Math.abs(det) < 1e-12) break;
      const delta = [
        (r[0] * c1[1] - c1[0] * r[1]) / det,
        (c0[0] * r[1] - r[0] * c0[1]) / det,
      ];
      unknowns.forEach((j, k) => {
        const limit = j === 2 ? radians(15) : 0.5;
        lateral[j] = clamp(lateral[j] - delta[k], -limit, limit);
      });
      solveLongitudinal();
    }
  }
  const controls: Controls = {
    roll: lateral[0],
    pitch: x[1],
    yaw: lateral[1],
    throttle: x[2],
  };
  const state = withSideslip(
    initialState(a, speed, TRIM_HEIGHT_M, x[0]),
    lateral[2],
  );
  state.velocity = [...velocity];
  state.motors.fill(x[2]);
  prepareCruise(state);
  if (a.vtol)
    controls.vtol = { mode: "cruise", assistance: a.vtol.defaultAssistance };
  state.surfaceCommands = a.surfaces.map((s) =>
    s.control ? surfaceCommand(s.control, controls) : 0,
  );
  return {
    controls,
    state,
    converged: Math.hypot(...residual(x)) < 0.01,
    residual: residual(x),
    pitchDeg: x[0],
    sideslipDeg: (lateral[2] * 180) / Math.PI,
    bankDeg: (bank * 180) / Math.PI,
  };
}
