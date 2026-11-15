import { describe, it, expect } from "vitest";
import trainer from "./fixtures/generic-trainer.json";
import quad from "../aircraft/quad-x-450.json";
import { parseAircraft } from "../src/core/schema";
import { massProperties } from "../src/core/aircraft";
import {
  DrydenTurbulence,
  FEET,
  defaultWindProfile,
  drydenParameters,
  groundEffectLiftRatio,
  meanWindAt,
  rotorGroundEffect,
  shearFactor,
  wingGroundEffect,
} from "../src/core/atmosphere";
import {
  Simulation,
  calmEnvironment,
  initialState,
  neutralControls,
  type Environment,
} from "../src/core/simulation";
import {
  createRecording,
  parseRecording,
  replayRecording,
} from "../src/core/experiment";
import { findTrim } from "../src/core/trim";

describe("logarithmic wind gradient", () => {
  const profile = defaultWindProfile();
  it("equals the reference wind at the reference height and vanishes at z0", () => {
    expect(shearFactor(profile.referenceHeightM, profile)).toBeCloseTo(1, 12);
    expect(shearFactor(profile.roughnessLengthM, profile)).toBe(0);
    expect(shearFactor(-1, profile)).toBe(0);
  });
  it("increases monotonically with height and leaves vertical wind alone", () => {
    const heights = [0.1, 0.5, 1, 2, 5, 10, 30, 100];
    const k = heights.map((h) => shearFactor(h, profile));
    for (let i = 1; i < k.length; i++) expect(k[i]).toBeGreaterThan(k[i - 1]);
    // ln(1/0.03)/ln(10/0.03) ≈ 0.6036 for open grass.
    expect(shearFactor(1, profile)).toBeCloseTo(0.6036, 4);
    expect(meanWindAt([4, -3, 0.5], 1, profile)).toEqual([
      4 * k[2],
      -3 * k[2],
      0.5,
    ]);
    expect(meanWindAt([4, -3, 0.5], 1)).toEqual([4, -3, 0.5]);
  });
});

describe("MIL-F-8785C low-altitude Dryden turbulence", () => {
  it("matches the specification's continuity at 1000 ft", () => {
    const p = drydenParameters(1000 * FEET, 10);
    // At 1000 ft, 0.177 + 0.000823 h = 1: all intensities and scales coincide.
    expect(p.sigma[0]).toBeCloseTo(1, 10);
    expect(p.sigma[2]).toBeCloseTo(1, 10);
    expect(p.scaleLength[0]).toBeCloseTo(1000 * FEET, 8);
    expect(p.scaleLength[2]).toBeCloseTo(1000 * FEET, 8);
  });
  it("uses the documented low-altitude relations and clamps below 10 ft", () => {
    const h = 50,
      base = 0.177 + 0.000823 * h,
      p = drydenParameters(h * FEET, 8);
    expect(p.sigma[2]).toBeCloseTo(0.8, 12);
    expect(p.sigma[0]).toBeCloseTo(0.8 / base ** 0.4, 12);
    expect(p.scaleLength[0]).toBeCloseTo((h / base ** 1.2) * FEET, 10);
    expect(p.scaleLength[2]).toBeCloseTo(h * FEET, 12);
    expect(drydenParameters(0, 8)).toEqual(drydenParameters(10 * FEET, 8));
  });
  it("reproduces the target variance and correlation length", () => {
    const wind: [number, number, number] = [6, 0, 0],
      height = 30,
      v = 15,
      dt = 1 / 120;
    const { sigma, scaleLength } = drydenParameters(height, 6);
    const t = new DrydenTurbulence(7);
    t.initialize(height, wind);
    const n = 400_000,
      lag = Math.round(scaleLength[2] / v / dt);
    const w: number[] = [];
    let sumU = 0,
      sumW = 0;
    for (let i = 0; i < n; i++) {
      const g = t.advance(dt, v, height, wind);
      sumU += g[0] * g[0];
      sumW += g[2] * g[2];
      w.push(g[2]);
    }
    expect(Math.sqrt(sumU / n) / sigma[0]).toBeGreaterThan(0.9);
    expect(Math.sqrt(sumU / n) / sigma[0]).toBeLessThan(1.1);
    expect(Math.sqrt(sumW / n) / sigma[2]).toBeGreaterThan(0.95);
    expect(Math.sqrt(sumW / n) / sigma[2]).toBeLessThan(1.05);
    let c = 0;
    for (let i = lag; i < n; i++) c += w[i] * w[i - lag];
    // One scale length of travel: correlation exp(-1) for a first-order process.
    expect(c / (n - lag) / (sumW / n)).toBeCloseTo(Math.exp(-1), 1);
  });
  it("is calm without mean wind and aligns u with the wind direction", () => {
    const calm = new DrydenTurbulence(1);
    calm.initialize(20, [0, 0, 0]);
    for (let i = 0; i < 100; i++)
      expect(Math.hypot(...calm.advance(1 / 120, 12, 20, [0, 0, 0]))).toBe(0);
    const east = new DrydenTurbulence(3),
      north = new DrydenTurbulence(3);
    east.initialize(20, [0, 5, 0]);
    north.initialize(20, [5, 0, 0]);
    const e = east.advance(1 / 120, 12, 20, [0, 5, 0]),
      nn = north.advance(1 / 120, 12, 20, [5, 0, 0]);
    expect(e[1]).toBeCloseTo(nn[0], 12);
    expect(e[0]).toBeCloseTo(-nn[1], 12);
    expect(e[2]).toBeCloseTo(nn[2], 12);
  });
});

describe("ground effect", () => {
  it("follows McCormick's factor and is exactly free-air above two spans", () => {
    expect(wingGroundEffect(0, 1)).toBe(0);
    expect(wingGroundEffect(0.1, 1)).toBeCloseTo(2.56 / 3.56, 12);
    expect(wingGroundEffect(2, 1)).toBe(1);
    expect(wingGroundEffect(50, 1)).toBe(1);
    let previous = -1;
    for (let h = 0; h <= 2.5; h += 0.01) {
      const phi = wingGroundEffect(h, 1);
      expect(phi).toBeGreaterThanOrEqual(previous - 1e-12);
      expect(phi).toBeLessThanOrEqual(1);
      previous = phi;
    }
  });
  it("raises the lift slope toward the section value, not beyond", () => {
    const a = 4.6,
      ar = 6,
      e = 0.9,
      k = Math.PI * ar * e,
      a0 = a / (1 - a / k);
    expect(groundEffectLiftRatio(a, ar, e, 1)).toBeCloseTo(1, 12);
    expect(groundEffectLiftRatio(a, ar, e, 0)).toBeCloseTo(a0 / a, 12);
    const near = groundEffectLiftRatio(a, ar, e, wingGroundEffect(0.1, 1));
    // h/b = 0.1 (φ ≈ 0.72): about 8% more lift slope for this AR 6 wing.
    expect(near).toBeGreaterThan(1.07);
    expect(near).toBeLessThan(a0 / a);
    expect(groundEffectLiftRatio(20, ar, e, 0.5)).toBe(1);
  });
  it("follows Cheeseman–Bennett near a rotor and fades out by four radii", () => {
    expect(rotorGroundEffect(0.1, 0.1)).toBeCloseTo(1 / (1 - 1 / 16), 12);
    expect(rotorGroundEffect(0.01, 0.1)).toBeCloseTo(4 / 3, 12);
    expect(rotorGroundEffect(0.4, 0.1)).toBe(1);
    expect(rotorGroundEffect(0, 0.1)).toBe(1);
  });
  it("lowers induced drag and raises lift for a wing close to the ground", () => {
    const a = parseAircraft(trainer);
    a.motors = [];
    a.fuselageDragAreaM2 = 0;
    a.angularDamping = [0, 0, 0];
    const wing = a.surfaces.find((s) => s.kind === "wing")!;
    a.surfaces = [
      {
        ...wing,
        positionM: massProperties(a).cg,
        rollDeg: 0,
        control: undefined,
        polar: undefined,
        reynoldsPolars: undefined,
      },
    ];
    const sim = new Simulation(a);
    const load = (height: number) =>
      sim.forces(initialState(a, 12, height, 4), neutralControls()).surfaces[0];
    const high = load(50),
      low = load(0.08 * wing.spanM);
    expect(high.groundEffect).toBe(1);
    expect(low.groundEffect).toBeLessThan(0.7);
    expect(-low.force[2]).toBeGreaterThan(-high.force[2]);
    const dragRatio = (f: typeof low) => -f.force[0] / -f.force[2];
    expect(dragRatio(low)).toBeLessThan(dragRatio(high));
  });
  it("gives a hovering quad more thrust close to the ground", () => {
    const a = parseAircraft(quad);
    const sim = new Simulation(a);
    const at = (height: number) => {
      const s = initialState(a, 0, height, 0);
      s.motors = s.motors.map(() => 0.5);
      return -sim.forces(s, neutralControls()).force[2];
    };
    const radius = a.motors[0].propDiameterM / 2;
    expect(at(0.6 * radius)).toBeGreaterThan(at(10) * 1.05);
    expect(at(10)).toBeCloseTo(at(20), 10);
    const yaw = (height: number) => {
      const st = initialState(a, 0, height, 0);
      st.motors = st.motors.map((_, i) => (i % 2 ? 0.4 : 0.6));
      return sim.forces(st, neutralControls()).torque[2];
    };
    expect(yaw(0.6 * radius)).toBeCloseTo(yaw(10), 10);
  });
});

describe("replay with near-ground atmosphere", () => {
  it("replays Dryden turbulence and wind gradient exactly", () => {
    const a = parseAircraft(trainer);
    const env: Environment = {
      ...calmEnvironment(),
      windMps: [-5, 2, 0],
      seed: 11,
      turbulence: "dryden",
      windProfile: defaultWindProfile(),
    };
    const sim = new Simulation(a, env, initialState(a, 12, 15));
    const recording = createRecording(sim);
    for (let i = 0; i < 360; i++) {
      const c = { ...neutralControls(), throttle: 0.6, roll: (i % 60) / 120 };
      recording.frames.push(c);
      sim.step(c);
    }
    const copy = parseRecording(JSON.parse(JSON.stringify(recording)));
    expect(replayRecording(copy)).toEqual(sim.state);
    const calm = new Simulation(
      a,
      { ...env, turbulence: undefined },
      initialState(a, 12, 15),
    );
    for (const c of recording.frames) calm.step(c);
    expect(calm.state.position).not.toEqual(sim.state.position);
  });
  it("trims the mean flow rather than a random turbulence sample", () => {
    const a = parseAircraft(trainer);
    const env: Environment = { ...calmEnvironment(), windMps: [-4, 0, 0] };
    const plain = findTrim(a, 12, env),
      turbulent = findTrim(a, 12, { ...env, turbulence: "dryden", seed: 99 });
    expect(turbulent.converged).toBe(plain.converged);
    expect(turbulent.controls).toEqual(plain.controls);
  });
  it("rejects an invalid recorded wind profile", () => {
    const a = parseAircraft(trainer);
    const r = createRecording(
      new Simulation(a, {
        ...calmEnvironment(),
        windProfile: { referenceHeightM: 2, roughnessLengthM: 3 },
      }),
    );
    expect(() => parseRecording(JSON.parse(JSON.stringify(r)))).toThrow();
  });
});
