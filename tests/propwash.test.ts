import { describe, expect, it } from "vitest";
import trainer from "../aircraft/vt-simple-trainer.json";
import { parseAircraft } from "../src/core/schema";
import {
  diskInducedVelocity,
  slipstreamAt,
  spanCoverage,
} from "../src/core/propwash";
import {
  Simulation,
  calmEnvironment,
  initialState,
} from "../src/core/simulation";
import { massProperties } from "../src/core/aircraft";

describe("actuator-disk slipstream", () => {
  it("satisfies momentum theory: T = 2ρA·v_i·(V + v_i)", () => {
    for (const [thrust, speed] of [
      [6, 0],
      [3, 9],
      [0.5, 20],
    ]) {
      const radius = 0.11,
        rho = 1.225,
        area = Math.PI * radius * radius;
      const vi = diskInducedVelocity(thrust, speed, rho, radius);
      expect(2 * rho * area * vi * (speed + vi)).toBeCloseTo(thrust, 10);
    }
    expect(diskInducedVelocity(0, 10, 1.225, 0.1)).toBe(0);
  });
  it("grows from v_i at the disk to 2 v_i downstream and contracts by continuity", () => {
    const vi = 4,
      R = 0.1;
    expect(slipstreamAt(0, vi, 0, R).increment).toBeCloseTo(vi, 12);
    const far = slipstreamAt(100, vi, 0, R);
    expect(far.increment).toBeCloseTo(2 * vi, 4);
    // Static far wake: R/√2.
    expect(far.radius).toBeCloseTo(R / Math.SQRT2, 4);
    // Mass flow is conserved at every station.
    for (const x of [0, 0.05, 0.2, 1]) {
      const s = slipstreamAt(x, vi, 8, R);
      expect(s.radius ** 2 * (8 + s.increment)).toBeCloseTo(
        R * R * (8 + vi),
        12,
      );
    }
  });
  it("covers only the span that crosses the slipstream circle", () => {
    // Centred 0.2 m slipstream on a 1 m surface: 20 % of the span, not 50 %.
    expect(spanCoverage(0, 0, 0.1, 1)).toBeCloseTo(0.2, 12);
    expect(spanCoverage(0, 0.06, 0.1, 1)).toBeCloseTo(0.16, 12);
    expect(spanCoverage(0.48, 0, 0.1, 1)).toBeCloseTo(0.12, 12);
    expect(spanCoverage(0, 0.1, 0.1, 1)).toBe(0);
    expect(spanCoverage(2, 0, 0.1, 1)).toBe(0);
    expect(spanCoverage(0, 0, 5, 1)).toBe(1);
  });
  it("adds no slipstream load when the motor is off", () => {
    const a = parseAircraft(trainer),
      sim = new Simulation(a);
    const s = initialState(a, 9, 50, 2);
    const off = sim.forces(s, { roll: 0, pitch: 0, yaw: 0, throttle: 0 });
    const noMotor = structuredClone(a);
    noMotor.motors[0].positionM = [-3, 0, 0];
    const clean = new Simulation(noMotor).forces(s, {
      roll: 0,
      pitch: 0,
      yaw: 0,
      throttle: 0,
    });
    expect(off.force[2]).toBeCloseTo(clean.force[2], 12);
  });
});

describe("thrust-line angles", () => {
  it("down-thrust tilts thrust down and pitches the nose down; right-thrust yaws right", () => {
    const base = parseAircraft(trainer);
    const run = (down: number, right: number) => {
      const a = structuredClone(base);
      a.motors[0].downThrustDeg = down;
      a.motors[0].rightThrustDeg = right;
      // Isolate the thrust line: remove surfaces and drag.
      a.surfaces = [];
      a.fuselageDragAreaM2 = 0;
      delete a.bodyDragAreaM2;
      a.motors[0].positionM = [0.25, 0, massProperties(a).cg[2]];
      const s = initialState(a, 0, 50, 0);
      s.motors = [1];
      return new Simulation(a, calmEnvironment()).forces(s, {
        roll: 0,
        pitch: 0,
        yaw: 0,
        throttle: 1,
      });
    };
    const straight = run(0, 0),
      down = run(3, 0),
      right = run(0, 3);
    expect(straight.torque[1]).toBeCloseTo(0, 12);
    expect(down.force[2]).toBeGreaterThan(0);
    expect(down.torque[1]).toBeLessThan(0);
    expect(right.force[1]).toBeGreaterThan(0);
    expect(right.torque[2]).toBeGreaterThan(0);
    expect(Math.hypot(...down.force)).toBeCloseTo(
      Math.hypot(...straight.force),
      10,
    );
  });
});
