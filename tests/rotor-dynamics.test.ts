/**
 * Dynamic propeller shaft speed (0.12.0): Ω as a state with motor, propeller
 * and friction torques, spin-up reaction, governor and integration checks.
 * Numbers in the titles follow the task checklist §5.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseAircraft, type Aircraft } from "../src/core/schema";
import {
  Simulation,
  calmEnvironment,
  initialState,
  neutralControls,
  type Controls,
} from "../src/core/simulation";
import {
  advanceRotorSpeed,
  availablePower,
  equilibriumRotorSpeed,
  frictionTorque,
  propellerTorque,
  rotorHalfStep,
  rotorModel,
  rotorTorques,
  type RotorInputs,
  type RotorModel,
} from "../src/core/rotor-dynamics";
import { powertrain } from "../src/core/powertrain";
import {
  createRecording,
  parseRecording,
  replayRecording,
} from "../src/core/experiment";
import { SIM_VERSION } from "../src/core/versions";
import { add, matVec, rotate, type Vec3 } from "../src/core/math";

/** A motorless copy of the Tiny Trainer (old recordings of gliders replay). */
const glider = () => {
  const a = load("ft-tiny-trainer");
  a.motors = [];
  return parseAircraft(a);
};
const load = (id: string) =>
  parseAircraft(JSON.parse(readFileSync(`aircraft/${id}.json`, "utf8")));
const cub = () => load("ft-simple-cub");
const model = (a: Aircraft = cub()) => rotorModel(a.motors[0])!;
const input = (
  a: Aircraft,
  command: number,
  speed: number,
  density = 1.225,
): RotorInputs => ({
  commandRpmRatio: powertrain(a, [command], undefined, density).rpmRatio[0],
  axialSpeedMps: speed,
  density,
  pitch: 1,
});
/** Integrate the shaft ODE alone with the simulator's update rule. */
function spin(
  m: RotorModel,
  w0: number,
  at: RotorInputs,
  t: number,
  dt = 1 / 120,
) {
  let w = w0;
  const trace: number[] = [];
  for (let i = 0; i < Math.round(t / dt); i++) {
    const k1 = rotorTorques(m, w, at);
    const mid = rotorHalfStep(m, w, k1.omegaDot, k1.jacobian, dt);
    const k2 = rotorTorques(m, mid, at);
    w = advanceRotorSpeed(m, w, mid, k2.omegaDot, k2.jacobian, dt);
    trace.push(w);
  }
  return trace;
}
/** Independent root of Q_m = Q_p + Q_f written from the documented formulas. */
function handRoot(m: RotorModel, at: RotorInputs) {
  const P = availablePower(m, at);
  const net = (w: number) =>
    P / Math.max(w, m.omegaMin) -
    propellerTorque(m, w, at) -
    frictionTorque(m, w);
  let lo = m.omegaMin,
    hi = m.omegaRedline * 0.97;
  for (let i = 0; i < 200; i++) {
    const c = (lo + hi) / 2;
    if (net(c) > 0) lo = c;
    else hi = c;
  }
  return lo;
}

describe("1. steady shaft speed", () => {
  it.each([
    [0.4, 0],
    [0.7, 8],
    [1, 15],
  ])(
    "converges to Q_motor = Q_prop + Q_f at command %s, %s m/s (<1 %)",
    (c, v) => {
      const a = cub(),
        m = model(a),
        at = input(a, c, v);
      const w = spin(m, 0.2 * m.omegaMax, at, 3).at(-1)!;
      expect(Math.abs(w / handRoot(m, at) - 1)).toBeLessThan(0.01);
      expect(Math.abs(w / equilibriumRotorSpeed(m, at) - 1)).toBeLessThan(0.01);
    },
  );
  it("reproduces the bench static thrust at rest (calibration)", () => {
    const a = cub(),
      m = model(a);
    for (const c of [0.5, 0.8, 1]) {
      const w = equilibriumRotorSpeed(m, input(a, c, 0));
      const thrust = m.at * 1.225 * w * w;
      const bench = powertrain(a, [c]).thrust[0];
      expect(Math.abs(thrust / bench - 1)).toBeLessThan(0.005);
    }
  });
});

describe("2. spin-up time constant", () => {
  it("rises exponentially with τ ≈ I_tot / (−∂Q_net/∂Ω)", () => {
    const a = cub(),
      m = model(a),
      from = input(a, 0.5, 0),
      to = input(a, 0.55, 0);
    const w0 = equilibriumRotorSpeed(m, from),
      w1 = equilibriumRotorSpeed(m, to);
    const tau = -1 / rotorTorques(m, w1, to).jacobian;
    const dt = 1 / 4000;
    const trace = spin(m, w0, to, 6 * tau, dt);
    const t63 = trace.findIndex((w) => w >= w0 + 0.632 * (w1 - w0)) * dt + dt;
    expect(Math.abs(t63 / tau - 1)).toBeLessThan(0.1);
  });
});

describe("3. dive overspeed", () => {
  it("raises Ω with airspeed and holds it at the redline", () => {
    const a = cub(),
      m = model(a);
    let previous = 0;
    for (const v of [0, 10, 20, 30]) {
      const w = equilibriumRotorSpeed(m, input(a, 1, v));
      expect(w).toBeGreaterThan(previous);
      previous = w;
    }
    // A steep dive drives the windmilling propeller past redline: clamped.
    const trace = spin(m, m.omegaMax, input(a, 1, 80), 2);
    expect(Math.max(...trace)).toBeLessThanOrEqual(m.omegaRedline);
    expect(trace.at(-1)).toBeCloseTo(m.omegaRedline, 6);
  });
});

describe("4. throttle cut", () => {
  it("coasts down to the windmilling speed instead of stopping", () => {
    const a = cub(),
      m = model(a),
      v = 14;
    const full = equilibriumRotorSpeed(m, input(a, 1, v));
    const cut = input(a, 0, v);
    const trace = spin(m, full, cut, 3);
    expect(trace[0]).toBeGreaterThan(0.9 * full);
    const windmill = equilibriumRotorSpeed(m, cut);
    expect(windmill).toBeGreaterThan(0.1 * m.omegaMax);
    expect(Math.abs(trace.at(-1)! / windmill - 1)).toBeLessThan(0.01);
    // The air drives the propeller: negative load torque.
    expect(propellerTorque(m, windmill, cut)).toBeLessThan(0);
  });
});

describe("5. altitude", () => {
  it("scales piston power with ρ/ρ0 and lowers thrust for both engine kinds", () => {
    for (const engine of ["piston", "electric"] as const) {
      const a = cub();
      a.motors[0].engine = engine;
      const m = model(a);
      const sea = input(a, 1, 0, 1.225),
        high = input(a, 1, 0, 1.0);
      const ratio = availablePower(m, high) / availablePower(m, sea);
      if (engine === "piston") expect(ratio).toBeCloseTo(1 / 1.225, 12);
      else expect(ratio).toBe(1);
      const thrust = (at: RotorInputs) => {
        const w = equilibriumRotorSpeed(m, at);
        return m.at * at.density * w * w;
      };
      expect(thrust(high)).toBeLessThan(thrust(sea));
      if (engine === "piston")
        expect(thrust(high) / thrust(sea)).toBeCloseTo(1 / 1.225, 2);
    }
  });
});

/** Cub airframe without aerodynamics, drag or damping (shaft + body only). */
function bareCub(density = 1e-9) {
  const a = cub();
  a.surfaces = [];
  a.fuselageDragAreaM2 = 0;
  delete a.bodyDragAreaM2;
  a.angularDamping = [0, 0, 0];
  delete a.battery;
  delete a.motors[0].performance;
  return { a, env: { ...calmEnvironment(), densityKgM3: density } };
}

describe("6. angular momentum of airframe + rotor", () => {
  it("is conserved within 1 % while the motor spins up in vacuum", () => {
    const { a, env } = bareCub();
    const s = initialState(a, 0, 500, 0);
    s.velocity = [0, 0, 0];
    s.rotorRadS = [0];
    const sim = new Simulation(a, env, s);
    const m = sim.rotorModels[0]!;
    const total = () =>
      rotate(
        sim.state.orientation,
        add(matVec(sim.properties.inertia, sim.state.omega), [
          m.inertia * sim.state.rotorRadS![0],
          0,
          0,
        ]),
      );
    const L0 = total();
    for (let i = 0; i < 120; i++)
      sim.step({ ...neutralControls(), throttle: 1 });
    // The rotor really spun up and the airframe counter-rotated.
    const H = m.inertia * sim.state.rotorRadS![0];
    expect(sim.state.rotorRadS![0]).toBeGreaterThan(0.3 * m.omegaMax);
    expect(sim.state.omega[0]).toBeLessThan(0);
    const drift = Math.hypot(...total().map((v, i) => v - L0[i]));
    expect(drift / H).toBeLessThan(0.01);
  });
});

describe("7. spin-up reaction sign", () => {
  it("rolls a CW airframe left during spin-up, with the reaction torque", () => {
    // No surfaces: slipstream and swirl loads would add their own roll.
    const { a } = bareCub();
    const s = initialState(a, 0, 100, 0);
    s.velocity = [0, 0, 0];
    s.motors = [1];
    s.rotorRadS = [0.3 * model(a).omegaMax];
    const sim = new Simulation(a, calmEnvironment(), s);
    const f = sim.forces(sim.state, { ...neutralControls(), throttle: 1 });
    const r = f.rotors[0];
    expect(r.qSpinUp).toBeGreaterThan(0); // accelerating
    // Shaft reaction −(Q_m − Q_f) = −(Q_p + I·Ω̇) about +x for CW: roll left.
    expect(f.torque[0]).toBeCloseTo(-(r.qProp + r.qSpinUp), 9);
    expect(f.torque[0]).toBeLessThan(-r.qProp); // spin-up adds to it
  });
});

describe("8. counter-rotating propellers", () => {
  it("cancel at equal Ω and become asymmetric when one stops", () => {
    // Twin-motor Bronco with opposite-handed propellers (formerly a quad).
    const a = load("ft-bronco");
    a.motors.forEach((m, i) =>
      Object.assign(m, {
        spin: i === 0 ? "ccw" : "cw",
        propInertiaKgM2: 3e-5,
        maxRpm: 7800,
        motorPowerW: 90,
      }),
    );
    const parsed = parseAircraft(a);
    const s = initialState(parsed, 0, 50, 0);
    s.velocity = [0, 0, 0];
    s.motors = [0.6, 0.6];
    s.omega = [0, -0.2, 0]; // pitch rate only: no roll damping or yaw-roll coupling
    const sim = new Simulation(parsed, calmEnvironment(), s);
    const w = 600;
    s.rotorRadS = [w, w];
    const even = sim.forces(s, { ...neutralControls(), throttle: 0.6 });
    expect(Math.abs(even.torque[0])).toBeLessThan(1e-9);
    expect(Math.hypot(...even.propellerGyro)).toBeLessThan(1e-12);
    s.rotorRadS = [w, 0];
    const odd = sim.forces(s, { ...neutralControls(), throttle: 0.6 });
    expect(Math.abs(odd.torque[0])).toBeGreaterThan(1e-3);
    expect(Math.hypot(...odd.propellerGyro)).toBeGreaterThan(1e-4);
  });
});

describe("9. constant-speed governor", () => {
  it("holds Ω within ±2 % of target through throttle changes", () => {
    const { a, env } = bareCub(1.225);
    a.motors[0].propGovernor = true;
    const parsed = a;
    const s = initialState(parsed, 15, 300, 0);
    s.motors = [0.9];
    const sim = new Simulation(parsed, env, s);
    const m = sim.rotorModels[0]!;
    const phases = [0.9, 1, 0.8];
    for (const throttle of phases) {
      for (let i = 0; i < 240; i++) {
        // Hold the airframe still at 15 m/s so only the shaft responds.
        sim.state.velocity = [15, 0, 0];
        sim.state.omega = [0, 0, 0];
        sim.state.orientation = [0, 0, 0, 1];
        sim.step({ ...neutralControls(), throttle });
      }
      expect(Math.abs(sim.state.rotorRadS![0] / m.omegaMax - 1)).toBeLessThan(
        0.02,
      );
    }
  });
});

describe("10. timestep convergence with dynamic shaft speed", () => {
  it("stays second order", () => {
    const a = cub();
    const run = (dt: number) => {
      const s = initialState(a, 12, 80, 2);
      s.motors = [0.3];
      const sim = new Simulation(a, calmEnvironment(), s);
      for (let i = 0; i < Math.round(3 / dt); i++)
        sim.step(
          { ...neutralControls(), throttle: 1, pitch: 0.2, yaw: 0.1 },
          dt,
        );
      return [...sim.state.position, sim.state.rotorRadS![0] / 1000];
    };
    const reference = run(1 / 960);
    const error = (dt: number) =>
      Math.hypot(...run(dt).map((v, i) => v - reference[i]));
    const ratio = error(1 / 120) / error(1 / 240);
    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThan(5.5);
  });
  it("cannot blow up for a very light propeller", () => {
    const a = cub();
    a.motors[0].propInertiaKgM2 = 1e-9;
    a.motors[0].motorInertiaKgM2 = 0;
    const m = model(parseAircraft(a));
    const trace = spin(m, 0, input(a, 1, 5), 1);
    expect(trace.every((w) => w >= 0 && w <= m.omegaRedline)).toBe(true);
    expect(
      Math.abs(trace.at(-1)! / equilibriumRotorSpeed(m, input(a, 1, 5)) - 1),
    ).toBeLessThan(0.01);
  });
});

describe("11. compatibility", () => {
  it("opens 0.11.0 recordings unchanged and rejects 0.12.0 features in them", () => {
    // A glider: propeller recordings from before 0.14.0 are rejected.
    const a = glider(),
      sim = new Simulation(a, calmEnvironment(), initialState(a, 12, 20, 0));
    const recording = createRecording(sim);
    for (let i = 0; i < 240; i++) {
      const c: Controls = { ...neutralControls(), throttle: 0.55, pitch: 0.1 };
      sim.step(c);
      recording.frames.push(c);
    }
    const old = {
      ...JSON.parse(JSON.stringify(recording)),
      simulationVersion: "0.11.0",
    };
    const parsed = parseRecording(old);
    expect(parsed.simulationVersion).toBe(SIM_VERSION);
    expect(replayRecording(parsed)).toEqual(sim.state);
    const withPower = structuredClone(old);
    withPower.initialState.rotorRadS = [];
    expect(() => parseRecording(withPower)).toThrow(/0\.12\.0/);
  });
  it("replays a dynamic-rotor recording exactly", () => {
    const a = cub(),
      sim = new Simulation(a, calmEnvironment(), initialState(a, 12, 60, 2));
    const recording = createRecording(sim);
    for (let i = 0; i < 360; i++) {
      const c: Controls = {
        ...neutralControls(),
        throttle: i < 120 ? 0.3 : i < 240 ? 1 : 0,
      };
      sim.step(c);
      recording.frames.push(c);
    }
    const parsed = parseRecording(JSON.parse(JSON.stringify(recording)));
    expect(replayRecording(parsed)).toEqual(sim.state);
  });
});

describe("rotor telemetry", () => {
  it("reports rpm, torques and shaft energy consistent with the model", () => {
    const a = cub(),
      s = initialState(a, 12, 60, 2);
    s.motors = [0.7];
    const sim = new Simulation(a, calmEnvironment(), s);
    const r = sim.lastForces.rotors.length
      ? sim.lastForces.rotors[0]
      : sim.forces(sim.state, { ...neutralControls(), throttle: 0.7 })
          .rotors[0];
    const m = sim.rotorModels[0]!;
    expect(r.rpm).toBeCloseTo((r.omegaRadS * 30) / Math.PI, 9);
    expect(r.qSpinUp).toBeCloseTo(r.qMotor - r.qProp - r.qFriction, 12);
    expect(r.energyJ).toBeCloseTo(0.5 * m.inertia * r.omegaRadS ** 2, 12);
  });
});
