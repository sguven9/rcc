import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseAircraft } from "../src/core/schema";
import { thrustSpeedFactor } from "../src/core/powertrain";
import { Simulation, calmEnvironment } from "../src/core/simulation";
import { launchState, launchTrim } from "../src/core/launch";
import { euler } from "../src/core/math";

describe("propeller thrust versus airspeed and shaft speed", () => {
  it("unloads at a zero-thrust speed proportional to rpm", () => {
    expect(thrustSpeedFactor(0, 20, 1)).toBe(1);
    expect(thrustSpeedFactor(10, 20, 1)).toBeCloseTo(0.5, 12);
    // Half rpm: zero thrust at half the full-command pitch speed.
    expect(thrustSpeedFactor(10, 20, 0.5)).toBeCloseTo(0, 12);
    expect(thrustSpeedFactor(5, 20, 0.5)).toBeCloseTo(0.5, 12);
  });
  it("brakes above the zero-thrust speed with bounded drag that vanishes at idle", () => {
    expect(thrustSpeedFactor(15, 20, 0.5)).toBeCloseTo(-0.5, 12);
    expect(thrustSpeedFactor(15, 20, 0)).toBe(0);
    // Thrust ∝ r²·factor: drag r²·(V/(V0 r) − 1) → 0 as r → 0.
    for (const r of [0.2, 0.05, 0.01])
      expect(Math.abs(r * r * thrustSpeedFactor(15, 20, r))).toBeLessThan(r);
  });
});

describe("moderate throttle increase from cruise", () => {
  it.each([
    "ft-bronco",
    "ft-tiny-trainer",
    "vt-simple-trainer",
    "ft-simple-cub",
    "ef-apprentice-sts",
  ])("%s climbs at roughly constant speed instead of pitching over", (id) => {
    const a = parseAircraft(
      JSON.parse(readFileSync(`aircraft/${id}.json`, "utf8")),
    );
    // Longitudinal response only: propeller torque and P-factor turn a real
    // model left when power is added hands-off (tested below), so the 20 s
    // wings-level check uses the airframe without propeller side effects.
    a.motors.forEach((m) => delete m.spin);
    const env = calmEnvironment();
    const trim = launchTrim(a, "airborne", env);
    const start = launchState(a, "airborne", env);
    start.position[2] = -100;
    const sim = new Simulation(a, env, start);
    const speed = Math.hypot(...start.velocity);
    let maxPitch = 0;
    for (let i = 0; i < 120 * 20; i++) {
      sim.step({
        ...trim.controls,
        throttle: Math.min(1, trim.controls.throttle + 0.15),
      });
      const [roll, pitch] = euler(sim.state.orientation);
      expect(Math.abs(roll)).toBeLessThan(0.2);
      maxPitch = Math.max(maxPitch, (pitch * 180) / Math.PI);
    }
    expect(maxPitch).toBeLessThan(30);
    expect(-sim.state.velocity[2]).toBeGreaterThan(0.3);
    expect(
      Math.abs(Math.hypot(...sim.state.velocity) / speed - 1),
    ).toBeLessThan(0.15);
  });
});

describe("propeller side effects with power", () => {
  it.each(["ft-simple-cub", "ef-apprentice-sts", "vt-simple-trainer"])(
    "%s (CW propeller) turns gently left when power is added hands-off from trim",
    (id) => {
      const a = parseAircraft(
        JSON.parse(readFileSync(`aircraft/${id}.json`, "utf8")),
      );
      expect(a.motors[0].spin).toBe("cw");
      const env = calmEnvironment();
      const trim = launchTrim(a, "airborne", env);
      const start = launchState(a, "airborne", env);
      start.position[2] = -100;
      // Trimmed at cruise power: no turn without a power change.
      const steady = new Simulation(a, env, structuredClone(start));
      for (let i = 0; i < 120 * 4; i++) steady.step(trim.controls);
      expect(Math.abs(euler(steady.state.orientation)[0])).toBeLessThan(
        (2 * Math.PI) / 180,
      );
      // Pitch-up first yaws a CW propeller right (gyroscopic precession);
      // torque and P-factor then dominate, so judge the turn after 8 s.
      const sim = new Simulation(a, env, start);
      for (let i = 0; i < 120 * 8; i++)
        sim.step({
          ...trim.controls,
          throttle: Math.min(1, trim.controls.throttle + 0.15),
        });
      const [roll, , heading] = euler(sim.state.orientation);
      // More torque rolls left; the turn is gradual, not a snap.
      expect(roll).toBeLessThan(0);
      expect(heading).toBeLessThan(0);
      expect(roll).toBeGreaterThan((-45 * Math.PI) / 180);
    },
  );
});
