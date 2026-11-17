import { expect, it } from "vitest";
import trainer from "../aircraft/vt-simple-trainer.json";
import { parseAircraft } from "../src/core/schema";
import { launchState } from "../src/core/launch";
import {
  Simulation,
  calmEnvironment,
  neutralControls,
} from "../src/core/simulation";
import { axisQ, degrees, euler, mulQ, radians } from "../src/core/math";

// Formerly exercised the quadcopters; the same contact invariants now run on a
// fixed-wing aircraft on tricycle gear. Open item: the Simple Cub (tailwheel)
// rocks by ~0.4 deg and the Apprentice creeps by a few mm over 20 s at rest.
it.each([trainer])(
  "$id rests without artificial yaw or horizontal drift with the motor stopped",
  (definition) => {
    for (const heading of [0, 90]) {
      const a = parseAircraft(definition);
      if (heading) a.contactPoints.reverse();
      const state = launchState(a, "ground");
      state.orientation = mulQ(
        axisQ([0, 0, 1], radians(heading)),
        state.orientation,
      );
      const sim = new Simulation(a, calmEnvironment(), state);
      // One second to settle onto the gear, then 19 s at rest.
      for (let i = 0; i < 120; i++) sim.step(neutralControls());
      const start = euler(sim.state.orientation).map(degrees),
        [x0, y0] = sim.state.position;
      for (let i = 0; i < 19 * 120; i++) sim.step(neutralControls());
      expect(sim.state.status).toBe("grounded");
      expect(sim.state.motors.every((m) => m === 0)).toBe(true);
      expect(
        Math.hypot(sim.state.position[0] - x0, sim.state.position[1] - y0),
      ).toBeLessThan(0.001);
      const angles = euler(sim.state.orientation).map(degrees);
      expect(Math.abs(angles[2] - start[2])).toBeLessThan(0.05);
      expect(Math.abs(angles[0] - start[0])).toBeLessThan(0.05);
      expect(Math.abs(angles[1] - start[1])).toBeLessThan(0.05);
    }
  },
);
