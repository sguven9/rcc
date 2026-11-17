import { describe, expect, it } from "vitest";
import {
  interpolate,
  slerp,
  snapshot,
  StateInterpolator,
} from "../src/render/interpolation";
import { FlightClock } from "../src/app/flight-clock";
import { bundledAircraft } from "../src/app/bundled-aircraft";
import { FIXED_DT, Simulation, calmEnvironment } from "../src/core/simulation";
import { launchState, launchTrim } from "../src/core/launch";
import type { Quat } from "../src/core/math";

const axisAngle = (axis: [number, number, number], angle: number): Quat => {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
};
const angleBetween = (a: Quat, b: Quat) =>
  2 * Math.acos(Math.min(1, Math.abs(a.reduce((s, v, i) => s + v * b[i], 0))));

describe("quaternion slerp", () => {
  it("returns the endpoints and the true midpoint", () => {
    const a = axisAngle([0, 0, 1], 0),
      b = axisAngle([0, 0, 1], 1.2);
    expect(angleBetween(slerp(a, b, 0), a)).toBeLessThan(1e-7);
    expect(angleBetween(slerp(a, b, 1), b)).toBeLessThan(1e-7);
    expect(
      angleBetween(slerp(a, b, 0.5), axisAngle([0, 0, 1], 0.6)),
    ).toBeLessThan(1e-7);
  });
  it("takes the short way when the quaternions have opposite signs", () => {
    const a = axisAngle([1, 0, 0], 0.2),
      b = axisAngle([1, 0, 0], 0.4).map((v) => -v) as Quat;
    expect(
      angleBetween(slerp(a, b, 0.5), axisAngle([1, 0, 0], 0.3)),
    ).toBeLessThan(1e-7);
  });
  it("stays unit length, including nearly identical inputs", () => {
    const a = axisAngle([0, 1, 0], 0.5),
      b = axisAngle([0, 1, 0], 0.5000001);
    for (const t of [0, 0.25, 0.5, 0.9, 1])
      expect(Math.hypot(...slerp(a, b, t))).toBeCloseTo(1, 12);
  });
});

describe("snapshot interpolation", () => {
  const prev = {
      position: [0, 0, -10] as [number, number, number],
      orientation: axisAngle([0, 0, 1], 0),
      surfaceCommands: [0, 0.2],
      time: 1,
    },
    cur = {
      position: [1, 2, -12] as [number, number, number],
      orientation: axisAngle([0, 0, 1], 0.1),
      surfaceCommands: [0.4, 0.2],
      time: 1 + FIXED_DT,
    };
  it("blends position, attitude, surfaces and time linearly in alpha", () => {
    const v = interpolate(prev, cur, 0.25);
    expect(v.position).toEqual([0.25, 0.5, -10.5]);
    expect(v.surfaceCommands![0]).toBeCloseTo(0.1, 12);
    expect(v.time).toBeCloseTo(1 + FIXED_DT / 4, 12);
    expect(
      angleBetween(v.orientation, axisAngle([0, 0, 1], 0.025)),
    ).toBeLessThan(1e-7);
  });
  it("clamps alpha and treats a non-finite alpha as the current step", () => {
    expect(interpolate(prev, cur, -3).position).toEqual(prev.position);
    expect(interpolate(prev, cur, 7).position).toEqual(cur.position);
    expect(interpolate(prev, cur, NaN).position).toEqual(cur.position);
  });
  it("uses the current surfaces when the surface count changed", () => {
    const v = interpolate({ ...prev, surfaceCommands: [1] }, cur, 0.5);
    expect(v.surfaceCommands).toEqual(cur.surfaceCommands);
  });
  it("copies: changing the source afterwards does not move the snapshot", () => {
    const state = {
      ...cur,
      position: [...cur.position] as typeof cur.position,
    };
    const s = snapshot(state);
    state.position[0] = 999;
    expect(s.position[0]).toBe(1);
  });
});

describe("state interpolator", () => {
  const at = (x: number, time: number) => ({
    position: [x, 0, -50] as [number, number, number],
    orientation: [0, 0, 0, 1] as Quat,
    time,
  });
  it("draws the fallback state until two steps exist", () => {
    const i = new StateInterpolator();
    expect(i.sample(0.5, at(3, 0)).position[0]).toBe(3);
    i.push(at(0, 0));
    expect(i.sample(0.5, at(3, 0)).position[0]).toBe(0);
    i.push(at(1, FIXED_DT));
    expect(i.sample(0.5, at(3, 0)).position[0]).toBeCloseTo(0.5, 12);
  });
  it("does not blend across a teleport and forgets history on reset", () => {
    const i = new StateInterpolator(25);
    i.push(at(0, 0));
    i.push(at(100, FIXED_DT));
    expect(i.sample(0.3, at(0, 0)).position[0]).toBe(100);
    i.reset();
    expect(i.sample(0.3, at(7, 0)).position[0]).toBe(7);
  });
  it("never writes to the simulation state (deep-frozen input)", () => {
    const freeze = <T>(o: T): T => {
      Object.values(o as object).forEach((v) => {
        if (v && typeof v === "object") freeze(v);
      });
      return Object.freeze(o);
    };
    const i = new StateInterpolator();
    const a = freeze({ ...at(0, 0), surfaceCommands: [0.1] }),
      b = freeze({ ...at(1, FIXED_DT), surfaceCommands: [0.3] });
    expect(() => {
      i.push(a);
      i.push(b);
      const v = i.sample(0.5, b);
      v.position[0] = 42;
      v.surfaceCommands![0] = 42;
    }).not.toThrow();
    expect(b.position[0]).toBe(1);
    expect(b.surfaceCommands[0]).toBe(0.3);
  });
});

describe("fixed physics step with a variable display rate", () => {
  const aircraft = bundledAircraft[0];
  const run = (frameMs: (frame: number) => number, frames: number) => {
    const environment = calmEnvironment();
    const sim = new Simulation(
      aircraft,
      environment,
      launchState(aircraft, "airborne", environment),
    );
    const trim = launchTrim(aircraft, "airborne", environment).controls;
    const clock = new FlightClock();
    const interp = new StateInterpolator();
    clock.reset(0);
    interp.push(sim.state);
    let now = 0,
      lastTime = -Infinity,
      lastX = -Infinity;
    for (let f = 0; f < frames; f++) {
      now += frameMs(f);
      const { steps } = clock.advance(now);
      for (let s = 0; s < steps; s++) {
        sim.step(trim, FIXED_DT);
        interp.push(sim.state);
      }
      const view = interp.sample(clock.alpha, sim.state);
      // Drawn time lags the simulation by under one step and never runs backwards.
      expect(view.time).toBeLessThanOrEqual(sim.state.time + 1e-12);
      expect(sim.state.time - view.time).toBeLessThanOrEqual(FIXED_DT + 1e-12);
      expect(view.time).toBeGreaterThanOrEqual(lastTime - 1e-12);
      lastTime = view.time;
      // Level flight north: the drawn position advances monotonically too.
      const forward = Math.hypot(view.position[0], view.position[1]);
      expect(forward).toBeGreaterThanOrEqual(lastX - 1e-9);
      lastX = forward;
    }
    return sim.state;
  };
  it("presents smooth motion at irregular frame times", () => {
    run((f) => [7, 16.7, 9, 33, 12.5, 4][f % 6], 240);
  });
  it("leaves the physics result independent of rendering", () => {
    const smooth = run(() => 1000 / 60, 180),
      jittery = run((f) => (f % 2 ? 1000 / 40 : 1000 / 120), 180);
    // Same elapsed time, same steps: physics is untouched by interpolation.
    expect(jittery.time).toBeCloseTo(smooth.time, 9);
    expect(jittery.position).toEqual(smooth.position);
  });
});
