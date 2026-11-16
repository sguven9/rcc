import { describe, expect, it } from "vitest";
import bronco from "../aircraft/ft-bronco.json";
import tiny from "../aircraft/ft-tiny-trainer.json";
import vortex from "../aircraft/vt-simple-trainer.json";
import raptor from "../aircraft/ft-22-raptor.json";
import { parseAircraft } from "../src/core/schema";
import { downwashAngle, postStallMoment } from "../src/core/aerodynamics";
import {
  Simulation,
  calmEnvironment,
  initialState,
  neutralControls,
} from "../src/core/simulation";
import { launchState, launchTrim } from "../src/core/launch";

describe("post-stall pitching moment", () => {
  it("moves the centre of pressure aft and pitches the nose down", () => {
    const a = (40 * Math.PI) / 180;
    // x_cp = 0.25 + 0.25·√sin40° ≈ 0.45c: moment arm 0.2c behind c/4.
    expect(postStallMoment(1, a)).toBeCloseTo(
      -0.25 * Math.sqrt(Math.sin(a)),
      12,
    );
    expect(postStallMoment(1, a)).toBeLessThan(-0.19);
    expect(postStallMoment(-1, -a)).toBeCloseTo(-postStallMoment(1, a), 12);
    expect(Math.abs(postStallMoment(0, 0))).toBe(0);
  });
});

describe("wing downwash at the tail", () => {
  it("follows 2·CL/(π·AR) at a conventional tail and spares elevons and fins", () => {
    const a = parseAircraft(tiny);
    const wings = a.surfaces.filter((s) => s.kind === "wing");
    const area = wings.reduce((n, s) => n + s.spanM * s.chordM, 0);
    const aspect = a.reference.spanM ** 2 / area;
    const tail = a.surfaces.find((s) => s.kind === "horizontal-tail")!;
    expect(downwashAngle(a, tail, 0.5, 1)).toBeCloseTo(
      1 / (Math.PI * aspect),
      12,
    );
    expect(downwashAngle(a, tail, 0.5, 0.6)).toBeCloseTo(
      0.6 / (Math.PI * aspect),
      12,
    );
    expect(downwashAngle(a, wings[0], 0.5, 1)).toBe(0);
    const fin = a.surfaces.find((s) => s.kind === "vertical-tail")!;
    expect(downwashAngle(a, fin, 0.5, 1)).toBe(0);
    const wing = parseAircraft(raptor);
    for (const elevon of wing.surfaces.filter(
      (s) => s.kind === "horizontal-tail",
    ))
      expect(downwashAngle(wing, elevon, 0.5, 1)).toBe(0);
  });
  it("is reported on the tail and grows with wing lift", () => {
    const a = parseAircraft(tiny),
      sim = new Simulation(a);
    const at = (alphaDeg: number) =>
      sim
        .forces(initialState(a, 12, 50, alphaDeg), neutralControls())
        .surfaces.find((s) => s.kind === "horizontal-tail")!.downwashDeg;
    expect(at(6)).toBeGreaterThan(at(2));
    expect(at(2)).toBeGreaterThan(0);
  });
});

describe("power-off stall with a slowly raised elevator", () => {
  it.each([
    ["FT Bronco", bronco],
    ["Tiny Trainer", tiny],
    ["Simple Trainer", vortex],
  ] as const)("%s stalls, drops its nose and does not tumble", (_n, raw) => {
    const a = parseAircraft(raw),
      env = calmEnvironment();
    const trim = launchTrim(a, "airborne", env);
    const start = launchState(a, "airborne", env);
    start.position[2] = -150;
    const sim = new Simulation(a, env, start);
    let stalledAt = -1,
      noseDrop = false,
      maxAlpha = 0;
    for (let i = 0; i < 120 * 10; i++) {
      const ramp = Math.min(1, i / 720);
      sim.step({
        ...trim.controls,
        throttle: 0,
        pitch: trim.controls.pitch + (1 - trim.controls.pitch) * ramp,
      });
      const wing = sim.lastForces.surfaces.find((s) => s.kind === "wing")!;
      maxAlpha = Math.max(maxAlpha, Math.abs(wing.alphaDeg));
      if (stalledAt < 0 && wing.stalled) stalledAt = i;
      if (stalledAt >= 0 && i - stalledAt < 120 && sim.state.omega[1] < -0.2)
        noseDrop = true;
    }
    expect(stalledAt).toBeGreaterThan(0);
    expect(noseDrop).toBe(true);
    expect(maxAlpha).toBeLessThan(35);
    expect(sim.state.status).toBe("flying");
  });
});
