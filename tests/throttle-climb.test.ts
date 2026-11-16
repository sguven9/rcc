/**
 * Throttle and pitch (task §7 tests 1–2). With the elevator fixed, a
 * statically stable aircraft holds its trim airspeed; extra thrust becomes a
 * climb angle γ ≈ asin(ΔT/W), not a pitching moment. These tests pin that
 * physics so a real thrust-moment bug would show as an immediate pitch jump.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseAircraft, type Aircraft } from "../src/core/schema";
import { Simulation, calmEnvironment, GRAVITY } from "../src/core/simulation";
import { findTrim } from "../src/core/trim";
import { euler } from "../src/core/math";

const ids = [
  "ft-simple-cub",
  "ef-apprentice-sts",
  "vt-simple-trainer",
  "ft-explorer",
  "ft-spitfire",
  "ft-bronco",
  "ef-night-radian",
];
const load = (id: string) =>
  parseAircraft(JSON.parse(readFileSync(`aircraft/${id}.json`, "utf8")));
/** Longitudinal only: no propeller side effects (they add a slow left turn). */
function symmetric(a: Aircraft) {
  for (const m of a.motors) {
    delete m.spin;
    delete m.motorPowerW;
    delete m.motorInertiaKgM2;
    delete m.redlineRpm;
    delete m.engine;
  }
  return a;
}

describe("1. throttle step from trimmed level flight", () => {
  it.each(ids)(
    "%s: no pitch jump, airspeed held, climb ≈ asin(ΔT/W)",
    (id) => {
      const a = symmetric(load(id));
      const trim = findTrim(a, a.reference.trimSpeedMps ?? 12);
      const sim = new Simulation(a, calmEnvironment(), {
        ...trim.state,
        position: [0, 0, -300],
      });
      const weight = sim.properties.mass * GRAVITY,
        v0 = Math.hypot(...trim.state.velocity);
      const throttle = Math.min(1, trim.controls.throttle + 0.1);
      // Thrust change at the trim state (steady shaft speed at each command).
      const thrust = (t: number) => {
        const s = structuredClone(trim.state);
        s.motors.fill(t);
        delete s.rotorRadS;
        return sim.forces(s, { ...trim.controls, throttle: t }).thrust[0];
      };
      const expected = Math.asin(
        (thrust(throttle) - thrust(trim.controls.throttle)) / weight,
      );
      const pitch0 = euler(sim.state.orientation)[1];
      let early = 0,
        speed = 0,
        climb = 0,
        n = 0;
      for (let i = 1; i <= 120 * 40; i++) {
        sim.step({ ...trim.controls, throttle });
        if (i === 60) early = euler(sim.state.orientation)[1] - pitch0;
        if (i > 120 * 10) {
          const v = sim.state.velocity;
          speed += Math.hypot(...v);
          climb += Math.atan2(-v[2], Math.hypot(v[0], v[1]));
          n++;
        }
      }
      // No significant immediate pitching moment: < 1° in the first 0.5 s.
      expect(Math.abs(early)).toBeLessThan((1 * Math.PI) / 180);
      // Speed stability: mean airspeed within 5 % of trim.
      expect(Math.abs(speed / n / v0 - 1)).toBeLessThan(0.05);
      // Excess thrust goes into climb angle (phugoid-averaged).
      expect(Math.abs(climb / n - expected)).toBeLessThan(
        Math.max(0.35 * expected, (1.5 * Math.PI) / 180),
      );
      expect(sim.state.status).toBe("flying");
    },
    60_000,
  );
  it.each(ids)(
    "%s: level acceleration needs only modest forward stick",
    (id) => {
      const a = symmetric(load(id));
      const v = a.reference.trimSpeedMps ?? 12;
      const slow = findTrim(a, v),
        fast = findTrim(a, v * 1.2);
      expect(fast.converged).toBe(true);
      // Faster level flight: more throttle, elevator moved by < 25 % travel.
      expect(fast.controls.throttle).toBeGreaterThan(slow.controls.throttle);
      expect(Math.abs(fast.controls.pitch - slow.controls.pitch)).toBeLessThan(
        0.25,
      );
    },
  );
});

describe("2. zero and full throttle", () => {
  it.each(ids)(
    "%s: glides down without power, never gains more energy than thrust work",
    (id) => {
      const a = load(id);
      const trim = findTrim(a, a.reference.trimSpeedMps ?? 12);
      for (const throttle of [0, 1]) {
        const sim = new Simulation(a, calmEnvironment(), {
          ...trim.state,
          position: [0, 0, -300],
        });
        const m = sim.properties.mass;
        const energy = () =>
          0.5 * m * sim.state.velocity.reduce((n, x) => n + x * x, 0) -
          m * GRAVITY * sim.state.position[2];
        const e0 = energy();
        let work = 0;
        for (let i = 0; i < 120 * 8; i++) {
          sim.step({ ...trim.controls, throttle });
          const f = sim.lastForces;
          work += Math.max(0, f.thrust[0]) * f.airspeed * (1 / 120);
        }
        const gained = energy() - e0;
        if (throttle === 0) expect(gained).toBeLessThan(0);
        // Drag only removes energy: the gain cannot exceed the propulsive work.
        else expect(gained).toBeLessThanOrEqual(work * 1.02);
        expect(sim.state.status).toBe("flying");
      }
    },
    60_000,
  );
});
