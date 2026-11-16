/**
 * Verification of propeller side effects (gyroscopic moment, P-factor,
 * reaction torque, slipstream) and the discrete "1−cos" gust model.
 * Numbers in the describe titles follow the task checklist §6.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { parseAircraft, type Aircraft } from "../src/core/schema";
import {
  Simulation,
  calmEnvironment,
  initialState,
  neutralControls,
  type Controls,
  type Environment,
} from "../src/core/simulation";
import {
  gyroscopicMoment,
  pFactorFadeSpeed,
  pFactorOffset,
  propellerMoments,
  propellerSpinAxis,
} from "../src/core/propeller-effects";
import { DiscreteGusts, oneMinusCosine } from "../src/core/discrete-gust";
import { diskInducedVelocity } from "../src/core/propwash";
import { powertrain } from "../src/core/powertrain";
import {
  createRecording,
  parseRecording,
  replayRecording,
} from "../src/core/experiment";
import { SIM_VERSION } from "../src/core/versions";
import { PHYSICS } from "../src/core/physics-config";
import { radians, type Vec3 } from "../src/core/math";

const load = (id: string) =>
  parseAircraft(JSON.parse(readFileSync(`aircraft/${id}.json`, "utf8")));
const cub = () => load("ft-simple-cub");
const isZero = (v: Vec3) => v.every((x) => x === 0);
type Motor = Aircraft["motors"][number];
const motor = (changes: Partial<Motor> = {}): Motor => ({
  ...cub().motors[0],
  ...changes,
});

describe("1. no shaft speed, no propeller moments", () => {
  it("gives exactly zero gyroscopic and P-factor moments at zero rpm", () => {
    const m = motor();
    const at = propellerMoments(m, {
      thrustAxis: [1, 0, 0],
      rotor: false,
      omegaBody: [0.7, -1.3, 0.4],
      rpmRatio: 0,
      thrustN: 0,
      localFlow: [10, 2, 3],
    });
    expect(isZero(at.gyro)).toBe(true);
    expect(isZero(at.pFactor)).toBe(true);
    // Through the simulation: motors off, rates and angle of attack present.
    const a = cub(),
      s = initialState(a, 12, 100, 10);
    s.omega = [0.5, -0.8, 0.3];
    const f = new Simulation(a, calmEnvironment(), s).forces(
      s,
      neutralControls(),
    );
    expect(isZero(f.propellerGyro)).toBe(true);
    expect(isZero(f.pFactor)).toBe(true);
  });
});

describe("2. gyroscopic moment", () => {
  it("matches the hand-computed −ω × (I_p·Ω·ŝ) within 1 %", () => {
    const I = 1.2e-4,
      rpm = 9000,
      ratio = 0.8;
    const omega: Vec3 = [0.3, -1.2, 0.5];
    // Tilted thrust line (2° down, 1.5° right), CW from behind: ŝ = ê.
    const d = radians(2),
      r = radians(1.5);
    const e: Vec3 = [
      Math.cos(d) * Math.cos(r),
      Math.cos(d) * Math.sin(r),
      Math.sin(d),
    ];
    const W = ((rpm * 2 * Math.PI) / 60) * ratio,
      h = e.map((x) => I * W * x);
    // −ω × H written out component by component.
    const expected = [
      -(omega[1] * h[2] - omega[2] * h[1]),
      -(omega[2] * h[0] - omega[0] * h[2]),
      -(omega[0] * h[1] - omega[1] * h[0]),
    ];
    const got = propellerMoments(
      motor({ propInertiaKgM2: I, maxRpm: rpm, spin: "cw" }),
      {
        thrustAxis: e,
        rotor: false,
        omegaBody: omega,
        rpmRatio: ratio,
        thrustN: 0,
      },
    ).gyro;
    const norm = Math.hypot(...expected);
    expect(
      Math.hypot(...got.map((v, i) => v - expected[i])) / norm,
    ).toBeLessThan(0.01);
    // And inside the simulation, with Ω from the powertrain's rpm ratio.
    const a = cub(),
      m = a.motors[0],
      s = initialState(a, 12, 100, 0);
    s.omega = omega;
    s.motors = [0.7];
    const sim = new Simulation(a, calmEnvironment(), s);
    const f = sim.forces(s, { ...neutralControls(), throttle: 0.7 });
    const n = powertrain(a, s.motors, undefined, 1.225).rpmRatio[0];
    const H = m.propInertiaKgM2! * ((m.maxRpm! * Math.PI) / 30) * n;
    const hand: Vec3 = [0, -omega[2] * H, omega[1] * H]; // ŝ = x̂, no tilt
    expect(
      Math.hypot(...f.propellerGyro.map((v, i) => v - hand[i])) /
        Math.hypot(...hand),
    ).toBeLessThan(0.01);
  });
});

describe("3. gyroscopic precession sign", () => {
  const gyro = (spin: "cw" | "ccw", omega: Vec3) =>
    propellerMoments(
      motor({ spin, propInertiaKgM2: 1e-4, maxRpm: 9000, pFactor: 0 }),
      {
        thrustAxis: [1, 0, 0],
        rotor: false,
        omegaBody: omega,
        rpmRatio: 1,
        thrustN: 5,
      },
    ).gyro;
  it("CW (from the cockpit) + pitch-up yaws right; yaw right pitches down", () => {
    expect(gyro("cw", [0, 1, 0])[2]).toBeGreaterThan(0);
    expect(gyro("cw", [0, -1, 0])[2]).toBeLessThan(0);
    expect(gyro("cw", [0, 0, 1])[1]).toBeLessThan(0);
    // Reversing the propeller reverses the reaction.
    expect(gyro("ccw", [0, 1, 0])[2]).toBeLessThan(0);
    // Rolling about the shaft produces no precession.
    expect(isZero(gyro("cw", [1, 0, 0]).map(Math.abs) as Vec3)).toBe(true);
  });
  it("uses the rotor convention (CW seen from above) for multirotors", () => {
    expect(propellerSpinAxis([0, 0, -1], "cw", true)).toEqual([-0, -0, 1]);
    expect(propellerSpinAxis([1, 0, 0], "cw", false)).toEqual([1, 0, 0]);
    expect(propellerSpinAxis([1, 0, 0], undefined, false)).toBeNull();
  });
});

describe("4. P-factor", () => {
  const yawAt = (alphaDeg: number, speed = 12, thrust = 6) => {
    const a = radians(alphaDeg);
    return propellerMoments(
      motor({ spin: "cw", pFactor: 0.3, propInertiaKgM2: 0, maxRpm: 8400 }),
      {
        thrustAxis: [1, 0, 0],
        rotor: false,
        omegaBody: [0, 0, 0],
        rpmRatio: 1,
        thrustN: thrust,
        localFlow: [speed * Math.cos(a), 0, speed * Math.sin(a)],
      },
    ).pFactor;
  };
  it("is zero at α_p = 0 and grows one way (yaw left for CW) with α_p", () => {
    expect(isZero(yawAt(0).map(Math.abs) as Vec3)).toBe(true);
    let previous = 0;
    for (const alpha of [2, 5, 10, 15, 20, 30]) {
      const m = yawAt(alpha);
      expect(m[2]).toBeLessThan(previous);
      // A pitch-plane angle only yaws; no roll and no pitch.
      expect(Math.abs(m[0]) + Math.abs(m[1])).toBeLessThan(1e-12);
      previous = m[2];
    }
  });
  it("matches |Δ| = k_p·sin α_p·R and M = T·Δ at cruise speed", () => {
    const R = motor().propDiameterM / 2,
      alpha = radians(10);
    const offset = pFactorOffset(
      [12 * Math.cos(alpha), 0, 12 * Math.sin(alpha)],
      [1, 0, 0],
      [1, 0, 0],
      0.3,
      R,
      pFactorFadeSpeed((8400 * Math.PI) / 30, R),
    );
    expect(Math.hypot(...offset)).toBeCloseTo(0.3 * Math.sin(alpha) * R, 12);
    expect(offset[1]).toBeGreaterThan(0); // descending (right) blade side
    expect(yawAt(10)[2]).toBeCloseTo(-6 * Math.hypot(...offset), 12);
  });
  it("stays finite and vanishes at zero thrust and at rest", () => {
    expect(isZero(yawAt(15, 12, 0).map(Math.abs) as Vec3)).toBe(true);
    const still = yawAt(90, 0);
    expect(still.every(Number.isFinite)).toBe(true);
    expect(isZero(still.map(Math.abs) as Vec3)).toBe(true);
    // Low speed: proportional to cross-flow, never singular.
    expect(Math.abs(yawAt(90, 0.01)[2])).toBeLessThan(1e-3);
  });
  it("is part of the simulated yaw moment of a parameterised preset", () => {
    const a = cub(),
      s = initialState(a, 12, 100, 12);
    s.motors = [1];
    const f = new Simulation(a, calmEnvironment(), s).forces(s, {
      ...neutralControls(),
      throttle: 1,
    });
    expect(f.pFactor[2]).toBeLessThan(0);
  });
});

describe("reaction torque (existing, verified)", () => {
  it("is −Q·ê: a CW fixed-wing propeller rolls the aircraft left", () => {
    const a = cub(),
      s = initialState(a, 0, 100, 0);
    s.velocity = [0, 0, 0];
    s.motors = [1];
    const sim = new Simulation(a, calmEnvironment(), s);
    const f = sim.forces(s, { ...neutralControls(), throttle: 1 });
    const T = powertrain(a, s.motors, undefined, 1.225).thrust[0];
    // No surfaces carry load at zero airspeed; only the reaction torque rolls.
    expect(f.torque[0]).toBeCloseTo(-T * a.motors[0].torquePerThrustM, 9);
  });
});

describe("5. slipstream momentum theory", () => {
  it("gives v_i = √(T/(2ρA_p)) at V = 0 and is safe at T ≤ 0", () => {
    const T = 7,
      rho = 1.225,
      R = 0.1143;
    expect(diskInducedVelocity(T, 0, rho, R)).toBeCloseTo(
      Math.sqrt(T / (2 * rho * Math.PI * R * R)),
      12,
    );
    expect(diskInducedVelocity(0, 0, rho, R)).toBe(0);
    expect(diskInducedVelocity(-3, 10, rho, R)).toBe(0);
    expect(diskInducedVelocity(Number.NaN, 0, rho, R)).toBe(0);
    // v_i = −V/2 + √((V/2)² + T/(2ρA)) in forward flight.
    expect(diskInducedVelocity(T, 12, rho, R)).toBeCloseTo(
      -6 + Math.sqrt(36 + T / (2 * rho * Math.PI * R * R)),
      12,
    );
  });
  it("gives elevator authority at zero airspeed only with power", () => {
    const a = cub();
    const pitchAuthority = (throttle: number) => {
      const s = initialState(a, 0, 100, 0);
      s.velocity = [0, 0, 0];
      s.motors = [throttle];
      const sim = new Simulation(a, calmEnvironment(), s);
      const c: Controls = { ...neutralControls(), throttle };
      return (
        sim.forces(s, { ...c, pitch: 1 }).torque[1] - sim.forces(s, c).torque[1]
      );
    };
    expect(pitchAuthority(0)).toBe(0);
    expect(pitchAuthority(1)).toBeGreaterThan(0.01);
    expect(Number.isFinite(pitchAuthority(1))).toBe(true);
  });
});

describe("6. discrete 1−cos gust", () => {
  it("is zero at both ends and W_g in the middle", () => {
    expect(oneMinusCosine(0, 2)).toBe(0);
    expect(oneMinusCosine(2, 2)).toBe(0);
    expect(oneMinusCosine(1, 2)).toBe(1);
    expect(oneMinusCosine(-0.1, 2)).toBe(0);
    expect(oneMinusCosine(2.1, 2)).toBe(0);
    const g = new DiscreteGusts(5);
    g.trigger(3, 4);
    const gust = g.active[0];
    expect(Math.hypot(...g.velocity(3))).toBe(0);
    expect(Math.hypot(...g.velocity(3 + gust.durationS / 2))).toBeCloseTo(
      4,
      12,
    );
    expect(Math.hypot(...g.velocity(3 + gust.durationS))).toBeLessThan(1e-12);
    expect(gust.durationS).toBeGreaterThanOrEqual(PHYSICS.gust.durationMinS);
    expect(gust.durationS).toBeLessThanOrEqual(PHYSICS.gust.durationMaxS);
  });
  const history = (seed: number) => {
    const g = new DiscreteGusts(seed),
      out: Vec3[] = [];
    for (let i = 0; i < 120 * 120; i++) {
      g.advance(i / 120, 1 / 120, { meanIntervalS: 10, amplitudeMps: 3 });
      out.push(g.velocity(i / 120));
    }
    return out;
  };
  it("repeats exactly for the same seed and differs for another", () => {
    expect(history(11)).toEqual(history(11));
    expect(history(11)).not.toEqual(history(12));
  });
  it("triggers as a Poisson process with the configured mean interval", () => {
    const g = new DiscreteGusts(3);
    let count = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 120 * 2000; i++) {
      g.advance(i / 120, 1 / 120, { meanIntervalS: 10, amplitudeMps: 3 });
      for (const gust of g.active)
        if (!seen.has(gust.startS)) {
          seen.add(gust.startS);
          count++;
        }
    }
    // 2000 s / 10 s = 200 expected; Poisson σ ≈ 14.
    expect(count).toBeGreaterThan(160);
    expect(count).toBeLessThan(240);
  });
  it("reaches the aircraft and the minimap through airVelocity", () => {
    const a = cub(),
      env: Environment = calmEnvironment();
    const sim = new Simulation(a, env, initialState(a, 12, 100, 0));
    sim.step({ ...neutralControls(), gust: true });
    const gust = sim.gusts.active[0];
    expect(gust).toBeDefined();
    const mid = { ...sim.state, time: gust.startS + gust.durationS / 2 };
    expect(Math.hypot(...sim.airVelocity(mid))).toBeCloseTo(
      PHYSICS.gust.amplitudeMps,
      12,
    );
  });
  it("replays a recording with automatic and manual gusts exactly", () => {
    const a = cub(),
      env: Environment = {
        ...calmEnvironment(),
        seed: 9,
        discreteGusts: { meanIntervalS: 2, amplitudeMps: 5 },
      };
    const sim = new Simulation(a, env, initialState(a, 12, 100, 0));
    const recording = createRecording(sim);
    for (let i = 0; i < 600; i++) {
      const c: Controls = {
        ...neutralControls(),
        throttle: 0.6,
        ...(i === 100 ? { gust: true } : {}),
      };
      sim.step(c);
      recording.frames.push(c);
    }
    const parsed = parseRecording(JSON.parse(JSON.stringify(recording)));
    expect(replayRecording(parsed)).toEqual(sim.state);
  });
});

describe("7. timestep convergence with propeller effects and a gust", () => {
  it("stays second order", () => {
    const a = cub();
    const run = (dt: number) => {
      const s = initialState(a, 12, 80, 2);
      s.motors = [0.6];
      const sim = new Simulation(a, calmEnvironment(), s);
      for (let i = 0; i < Math.round(3 / dt); i++)
        sim.step(
          {
            ...neutralControls(),
            throttle: 0.9,
            pitch: 0.2,
            yaw: 0.1,
            ...(i === 0 ? { gust: true } : {}),
          },
          dt,
        );
      return sim.state.position;
    };
    const reference = run(1 / 960);
    const error = (dt: number) =>
      Math.hypot(...run(dt).map((v, i) => v - reference[i]));
    const ratio = error(1 / 120) / error(1 / 240);
    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThan(5.5);
  });
});

describe("8. aircraft without propeller parameters are unchanged", () => {
  const presets = readdirSync("aircraft").map((f) => f.replace(/\.json$/, ""));
  it.each(presets)("%s: absent parameters equal explicit zeros", (id) => {
    const strip = (a: Aircraft, zero: boolean) => {
      for (const m of a.motors) {
        delete m.propInertiaKgM2;
        delete m.maxRpm;
        delete m.pFactor;
        if (zero)
          Object.assign(m, { propInertiaKgM2: 0, pFactor: 0, maxRpm: 0 });
      }
      return a;
    };
    const run = (a: Aircraft) => {
      const s = initialState(a, 12, 60, 3);
      s.omega = [0.4, -0.6, 0.3];
      const sim = new Simulation(a, calmEnvironment(), s);
      for (let i = 0; i < 240; i++)
        sim.step({ roll: 0.2, pitch: -0.1, yaw: 0.3, throttle: 0.8 });
      expect(isZero(sim.lastForces.propellerGyro.map(Math.abs) as Vec3)).toBe(
        true,
      );
      expect(isZero(sim.lastForces.pFactor.map(Math.abs) as Vec3)).toBe(true);
      return sim.state;
    };
    expect(run(strip(load(id), false))).toEqual(run(strip(load(id), true)));
  });
  it("opens 0.10.0 recordings unchanged and rejects newer features in them", () => {
    const a = load("quad-x-450"),
      sim = new Simulation(a, calmEnvironment(), initialState(a, 0, 20, 0));
    const recording = createRecording(sim);
    for (let i = 0; i < 240; i++) {
      const c = { ...neutralControls(), throttle: 0.55, roll: 0.1 };
      sim.step(c);
      recording.frames.push(c);
    }
    const old = {
      ...JSON.parse(JSON.stringify(recording)),
      simulationVersion: "0.10.0",
    };
    const parsed = parseRecording(old);
    expect(parsed.simulationVersion).toBe(SIM_VERSION);
    expect(replayRecording(parsed)).toEqual(sim.state);
    expect(() =>
      parseRecording({
        ...old,
        environment: {
          ...old.environment,
          discreteGusts: { meanIntervalS: 5, amplitudeMps: 2 },
        },
      }),
    ).toThrow(/features added/);
    expect(() =>
      parseRecording({ ...old, frames: [{ ...old.frames[0], gust: true }] }),
    ).toThrow(/features added/);
  });
});

describe("rotor gyroscopic coupling", () => {
  it("cancels for counter-rotating rotors at equal speed", () => {
    const cw = gyroscopicMoment(
      [0.5, 0.2, 0],
      1e-4,
      800,
      propellerSpinAxis([0, 0, -1], "cw", true)!,
    );
    const ccw = gyroscopicMoment(
      [0.5, 0.2, 0],
      1e-4,
      800,
      propellerSpinAxis([0, 0, -1], "ccw", true)!,
    );
    cw.forEach((v, i) => expect(v + ccw[i]).toBeCloseTo(0, 15));
  });
});
