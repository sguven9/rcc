import { describe, expect, it } from "vitest";
import { bundledAircraft } from "../src/app/bundled-aircraft";
import { buildAircraft, disposeAircraft } from "../src/view/model";
import { drawnArea } from "../src/view/detailed-airframe";
import {
  Simulation,
  calmEnvironment,
  initialState,
} from "../src/core/simulation";

const detailed = bundledAircraft.filter((a) => a.visual);

describe("detailed generic airframes", () => {
  it("covers the generated catalog aircraft", () => {
    expect(detailed.map((a) => a.id).sort()).toEqual([
      "ef-apprentice-sts",
      "ef-night-radian",
      "ft-explorer",
      "ft-mighty-mini-arrow",
      "ft-simple-cub",
      "ft-spitfire",
    ]);
  });
  it.each(detailed.map((a) => [a.id, a] as const))(
    "%s draws the aerodynamic planform area on each side",
    (_id, a) => {
      for (const kind of ["wing", "horizontal-tail", "vertical-tail"]) {
        const surfaces = a.surfaces.filter((s) => s.kind === kind);
        const drawn = surfaces.reduce((n, s) => n + drawnArea(a, s), 0);
        const aero = surfaces.reduce((n, s) => n + s.spanM * s.chordM, 0);
        expect(drawn / aero).toBeCloseTo(1, 2);
      }
    },
  );
  it.each(detailed.map((a) => [a.id, a] as const))(
    "%s builds without a DOM and animates every control surface",
    (_id, a) => {
      const visual = buildAircraft(a);
      const controlled = a.surfaces.filter((s) => s.control).map((s) => s.id);
      expect(visual.controls.map((c) => c.surfaceId).sort()).toEqual(
        [...controlled].sort(),
      );
      for (const c of visual.controls)
        expect(c.hingeAxis!.y).toBeGreaterThan(0.9);
      expect(visual.propellers).toHaveLength(a.motors.length);
      disposeAircraft(visual.group);
    },
  );
  it.each(detailed.map((a) => [a.id, a] as const))(
    "%s: livery and visual detail never change the physics",
    (_id, a) => {
      const plain = structuredClone(a);
      delete plain.visual;
      delete plain.livery;
      const s = initialState(a, 12, 30, 4);
      s.motors = s.motors.map(() => 0.6);
      const c = { roll: 0.2, pitch: -0.1, yaw: 0.1, throttle: 0.6 };
      expect(new Simulation(a, calmEnvironment()).forces(s, c)).toEqual(
        new Simulation(plain, calmEnvironment()).forces(s, c),
      );
    },
  );
});
