/**
 * Full-throttle nose-up (task §2): pitch-moment sign checks for each moment
 * item, the ACRO gyro controller, and per-preset regressions for the throttle
 * step in trimmed flight, the ground roll and the throttle cut.
 *
 * Sign convention: body X forward, Y right, Z down; a positive pitch torque
 * (about +Y) raises the nose.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseAircraft, type Aircraft } from "../src/core/schema";
import {
  Simulation,
  calmEnvironment,
  initialState,
  type Controls,
  type State,
} from "../src/core/simulation";
import { findTrim } from "../src/core/trim";
import { launchState, launchTrim } from "../src/core/launch";
import { euler, radians } from "../src/core/math";
import { acroStep, type ControlPower } from "../src/core/flight-controller";

const load = (id: string) =>
  parseAircraft(JSON.parse(readFileSync(`aircraft/${id}.json`, "utf8")));
const DEG = 180 / Math.PI;
const neutral: Controls = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };

/** Plain steady thrust: no rotor dynamics or propeller side effects. */
function steadyThrust(a: Aircraft) {
  for (const m of a.motors) {
    delete m.spin;
    delete m.motorPowerW;
    delete m.motorInertiaKgM2;
    delete m.redlineRpm;
    delete m.engine;
    delete m.propInertiaKgM2;
    delete m.maxRpm;
    delete m.pFactor;
  }
  return a;
}

const cruise = (a: Aircraft, motor = 0): State => {
  const s = initialState(a, a.reference.trimSpeedMps ?? 12, 200, 0);
  s.motors = s.motors.map(() => motor);
  return s;
};

describe("pitch-moment items: sign convention", () => {
  const base = load("ft-tiny-trainer");

  it("thrust line below the CG pitches the nose up, above it down", () => {
    for (const offset of [0.05, -0.05]) {
      const a = steadyThrust(structuredClone(base));
      a.surfaces = [];
      const cg = new Simulation(a).properties.cg;
      for (const m of a.motors) {
        m.positionM = [m.positionM[0], m.positionM[1], cg[2] + offset];
        m.downThrustDeg = 0;
      }
      const sim = new Simulation(a);
      const s0 = cruise(a, 0),
        s1 = cruise(a, 1);
      const on = sim.forces(s1, { ...neutral, throttle: 1 }),
        off = sim.forces(s0, neutral);
      const moment = on.torque[1] - off.torque[1];
      // r × F about +Y = r_z·F_x for a thrust along +X.
      expect(Math.sign(moment)).toBe(Math.sign(offset));
      expect(moment).toBeCloseTo(offset * on.thrust[0], 3);
    }
  });

  it("down-thrust on a tractor motor pitches the nose down", () => {
    const a = steadyThrust(structuredClone(base));
    a.surfaces = [];
    const cg = new Simulation(a).properties.cg;
    for (const m of a.motors) {
      m.positionM = [m.positionM[0], m.positionM[1], cg[2]];
      m.downThrustDeg = 4;
    }
    const sim = new Simulation(a);
    const on = sim.forces(cruise(a, 1), { ...neutral, throttle: 1 }),
      off = sim.forces(cruise(a, 0), neutral);
    expect(a.motors[0].positionM[0]).toBeGreaterThan(cg[0]);
    expect(on.torque[1] - off.torque[1]).toBeLessThan(0);
  });

  it("up elevator raises the nose", () => {
    const sim = new Simulation(base);
    const s = cruise(base);
    const up = sim.forces(s, { ...neutral, pitch: 0.5 }).torque[1],
      down = sim.forces(s, { ...neutral, pitch: -0.5 }).torque[1];
    expect(up).toBeGreaterThan(0);
    expect(down).toBeLessThan(up);
  });

  it("slipstream adds elevator authority without changing its sign", () => {
    const a = steadyThrust(structuredClone(base));
    const sim = new Simulation(a);
    const authority = (motor: number) => {
      const s = initialState(a, 3, 200, 0);
      s.motors = s.motors.map(() => motor);
      const c = { ...neutral, throttle: motor };
      return (
        sim.forces(s, { ...c, pitch: 1 }).torque[1] -
        sim.forces(s, { ...c, pitch: 0 }).torque[1]
      );
    };
    expect(authority(0)).toBeGreaterThan(0);
    expect(authority(1)).toBeGreaterThan(authority(0));
  });

  it("wing and tail are statically stable: more angle of attack pitches down", () => {
    const sim = new Simulation(base);
    const s = cruise(base);
    const v = s.velocity[0];
    const higher = { ...s, velocity: [v, 0, v * Math.tan(radians(3))] };
    expect(sim.forces(higher as State, neutral).torque[1]).toBeLessThan(
      sim.forces(s, neutral).torque[1],
    );
  });

  it("a nose-up pitch rate is damped", () => {
    const sim = new Simulation(base);
    const s = cruise(base);
    const rotating = { ...s, omega: [0, 0.5, 0] };
    expect(sim.forces(rotating as State, neutral).torque[1]).toBeLessThan(
      sim.forces(s, neutral).torque[1],
    );
  });

  it("propeller gyroscopic and P-factor moments have no pitch part in straight flight", () => {
    const a = load("ft-spitfire");
    const sim = new Simulation(a);
    const s = cruise(a, 1);
    const f = sim.forces(s, { ...neutral, throttle: 1 });
    expect(Math.abs(f.propellerGyro[1])).toBeLessThan(1e-9);
    expect(Math.abs(f.pFactor[1])).toBeLessThan(1e-9);
  });
});

describe("ACRO controller (gyro rate loop)", () => {
  const power: ControlPower = {
    perCommand: [100, 50, -20],
    damping: [10, 5, 2],
    referenceSpeed: 12,
  };
  const zero = { integral: [0.1, -0.2, 0] as const, attitude: [0, 0, 0] };
  it("centred sticks and no rotation hold the trim channels", () => {
    const out = acroStep(
      [0, 0, 0],
      [0, 0, 0],
      12,
      { integral: [0.1, -0.2, 0.05], attitude: [0, 0, 0] },
      power,
      1 / 120,
      false,
    );
    expect(out.channels).toEqual([0.1, -0.2, 0.05]);
  });
  it("opposes a measured nose-up rate with down elevator", () => {
    const out = acroStep(
      [0, 0, 0],
      [0, 0.2, 0],
      12,
      { integral: [0, 0, 0], attitude: [0, 0, 0] },
      power,
      1 / 120,
      false,
    );
    expect(out.channels[1]).toBeLessThan(0);
  });
  it("follows the sign of the measured control power (reversed yaw)", () => {
    const out = acroStep(
      [0, 0, 0],
      [0, 0, 0.2],
      12,
      { integral: [0, 0, 0], attitude: [0, 0, 0] },
      power,
      1 / 120,
      false,
    );
    expect(out.channels[2]).toBeGreaterThan(0);
  });
  it("freezes the integrators on the ground and passes sticks on axes without authority", () => {
    const out = acroStep(
      [0.3, 0, 0],
      [0, 0.5, 0],
      12,
      { integral: [...zero.integral], attitude: [0, 0.1, 0] },
      { ...power, perCommand: [0, 50, -20] },
      1 / 120,
      true,
    );
    expect(out.channels[0]).toBe(0.3);
    expect(out.state.integral[1]).toBe(-0.2);
    expect(out.state.attitude[1]).toBe(0);
  });
  it("does not wind up while the output saturates", () => {
    const out = acroStep(
      [0, 1, 0],
      [0, 0, 0],
      5,
      { integral: [0, 0.9, 0], attitude: [0, 0, 0] },
      power,
      1 / 120,
      false,
    );
    expect(out.channels[1]).toBe(1);
    expect(out.state.integral[1]).toBe(0.9);
  });
});

/** Fixed-wing presets (propeller, conventional or flying wing). */
const presets = [
  "ft-simple-cub",
  "ef-apprentice-sts",
  "vt-simple-trainer",
  "ft-explorer",
  "ft-tiny-trainer",
  "ft-spitfire",
  "ft-bronco",
  "ft-bronco-conventional",
  "ef-night-radian",
  "ft-22-raptor",
  "ft-mighty-mini-arrow",
];

/** 3 s in ACRO with centred sticks from trimmed level flight. */
function acroStep3s(id: string, throttle: number) {
  const a = load(id);
  const trim = findTrim(a, a.reference.trimSpeedMps ?? 12);
  const sim = new Simulation(a, calmEnvironment(), {
    ...structuredClone(trim.state),
    position: [0, 0, -300],
    fcIntegral: [trim.controls.roll, trim.controls.pitch, trim.controls.yaw],
  });
  const pitch0 = euler(sim.state.orientation)[1],
    v0 = Math.hypot(...sim.state.velocity);
  let maxPitch = 0,
    maxRate = 0;
  for (let i = 1; i <= 360; i++) {
    sim.step({ roll: 0, pitch: 0, yaw: 0, throttle, fcMode: "acro" });
    maxPitch = Math.max(
      maxPitch,
      Math.abs(euler(sim.state.orientation)[1] - pitch0) * DEG,
    );
    maxRate = Math.max(maxRate, Math.abs(sim.state.omega[1]) * DEG);
  }
  return {
    maxPitch,
    maxRate,
    speedGain: Math.hypot(...sim.state.velocity) - v0,
    status: sim.state.status,
  };
}

describe("throttle step in trimmed flight (ACRO, sticks centred)", () => {
  it.each(presets.flatMap((id) => [0.8, 1].map((t) => [id, t] as const)))(
    "%s → %s throttle: speed rises, nose moves < 3° and < 5°/s in 3 s",
    (id, throttle) => {
      const r = acroStep3s(id, throttle);
      expect(r.speedGain).toBeGreaterThan(2);
      expect(r.maxPitch).toBeLessThan(3);
      expect(r.maxRate).toBeLessThan(5);
      expect(r.status).toBe("flying");
    },
    60_000,
  );
  it.each(presets.filter((id) => id !== "ft-22-raptor"))(
    "%s: throttle cut does not drop the nose (< 3° in 3 s)",
    (id) => {
      expect(acroStep3s(id, 0).maxPitch).toBeLessThan(3);
    },
    60_000,
  );
  it("ft-22-raptor: throttle cut holds the nose until the elevator runs out at the stall", () => {
    // The flying wing needs nearly full up elevon to hold level flight at
    // ~7.5 m/s; once it saturates the stall break lowers the nose (physics,
    // documented in docs/physics-engine.md).
    expect(acroStep3s("ft-22-raptor", 0).maxPitch).toBeLessThan(10);
  });
});

describe("full-throttle ground roll: the nose rises only with elevator", () => {
  const wheeled = presets.filter((id) =>
    load(id).contactPoints.some((p) => p.kind === "wheel"),
  );
  it.each(
    wheeled.flatMap((id) => (["acro", "manual"] as const).map((m) => [id, m])),
  )(
    "%s (%s): no nose rise while the wheels are on the ground",
    (id, mode) => {
      const a = load(id);
      const trim = launchTrim(a, "ground");
      const s = launchState(a, "ground");
      if (mode === "acro")
        s.fcIntegral = [
          trim.controls.roll,
          trim.controls.pitch,
          trim.controls.yaw,
        ];
      const sim = new Simulation(a, calmEnvironment(), s);
      const pitch0 = euler(sim.state.orientation)[1];
      const c: Controls =
        mode === "acro"
          ? { roll: 0, pitch: 0, yaw: 0, throttle: 1, fcMode: "acro" }
          : { ...trim.controls, throttle: 1 };
      let rise = 0;
      for (let i = 1; i <= 120 * 6; i++) {
        sim.step(c);
        if (sim.state.status !== "grounded") break;
        rise = Math.max(rise, (euler(sim.state.orientation)[1] - pitch0) * DEG);
      }
      expect(rise).toBeLessThan(2);
    },
    60_000,
  );
  it("up elevator does rotate the aircraft on the takeoff roll", () => {
    const a = load("ef-apprentice-sts");
    const sim = new Simulation(a, calmEnvironment(), launchState(a, "ground"));
    const pitch0 = euler(sim.state.orientation)[1];
    for (let i = 1; i <= 120 * 6; i++)
      sim.step({ roll: 0, pitch: i > 120 * 3 ? 0.6 : 0, yaw: 0, throttle: 1 });
    expect((euler(sim.state.orientation)[1] - pitch0) * DEG).toBeGreaterThan(5);
    expect(sim.state.status).toBe("flying");
  });
});

describe("ACRO recordings replay exactly", () => {
  it("stores the controller state and mode so a replay matches the flight", async () => {
    const { createRecording, parseRecording, replayRecording } =
      await import("../src/core/experiment");
    const a = load("ft-tiny-trainer");
    const trim = findTrim(a, a.reference.trimSpeedMps ?? 12);
    const sim = new Simulation(a, calmEnvironment(), {
      ...structuredClone(trim.state),
      position: [0, 0, -100],
      fcIntegral: [trim.controls.roll, trim.controls.pitch, trim.controls.yaw],
      fcAttitude: [0, 0, 0],
    });
    const recording = createRecording(sim);
    for (let i = 0; i < 240; i++) {
      const c: Controls = {
        roll: i < 60 ? 0.4 : 0,
        pitch: i > 120 && i < 160 ? 0.3 : 0,
        yaw: 0,
        throttle: 0.9,
        fcMode: "acro",
      };
      sim.step(c);
      recording.frames.push({ ...c });
    }
    const parsed = parseRecording(JSON.parse(JSON.stringify(recording)));
    expect(replayRecording(parsed)).toEqual(sim.state);
  });
});
