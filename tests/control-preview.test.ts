import { expect, it } from "vitest";
import { ControlPreview } from "../src/core/control-preview";
import { parseAircraft } from "../src/core/schema";
import {
  applyExpo,
  DEFAULT_EXPO,
  PilotResponseSchema,
} from "../src/core/pilot-response";
const NO_EXPO = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
void applyExpo;
void DEFAULT_EXPO;
void PilotResponseSchema;
void NO_EXPO;
import {
  Simulation,
  initialState,
  neutralControls,
} from "../src/core/simulation";
import raptor from "../aircraft/ft-22-raptor.json";
import bronco from "../aircraft/ft-bronco.json";
import trainer from "../aircraft/ft-tiny-trainer.json";
import quad from "../aircraft/quad-x-6s.json";

it.each([raptor, bronco, trainer])(
  "matches actual flight servo deflections on $id",
  (data) => {
    const a = parseAircraft(data),
      preview = new ControlPreview(a),
      sim = new Simulation(a, undefined, initialState(a, 12, 200));
    sim.state.surfaceCommands = a.surfaces.map(() => 0);
    for (let i = 0; i < 120; i++) {
      const raw = {
        roll: i < 50 ? 1 : -0.4,
        pitch: 0.3,
        yaw: -0.5,
        throttle: 1,
      };
      preview.step(raw, { roll: 0, pitch: 0, yaw: 0, throttle: 0 }, 0.18);
      sim.step(preview.controls);
      expect(preview.controls.throttle).toBe(0);
      expect(preview.deflections).toEqual(sim.state.surfaceCommands);
    }
  },
);
it("shows the actual mixed FT-22 travel and responds to linkage changes", () => {
  const a = parseAircraft(raptor),
    preview = new ControlPreview(a);
  for (let i = 0; i < 120; i++)
    preview.step(
      { ...neutralControls(), roll: 1 },
      { roll: 0, pitch: 0, yaw: 0, throttle: 0 },
    );
  const moving = a.surfaces
    .map((s, i) => (s.control ? i : -1))
    .filter((i) => i >= 0);
  const degrees = moving.map(
    (i) => preview.deflections[i] * preview.actuations[i].maxDeg,
  );
  for (const angle of degrees) expect(Math.abs(angle)).toBeCloseTo(40, 5);
  expect(degrees[0]).toBe(-degrees[1]);
  a.surfaces[moving[0]].control!.linkage!.surfaceArmM *= 2;
  const edited = new ControlPreview(a);
  for (let i = 0; i < 120; i++)
    edited.step(
      { ...neutralControls(), roll: 1 },
      { roll: 0, pitch: 0, yaw: 0, throttle: 0 },
    );
  expect(
    Math.abs(
      edited.deflections[moving[0]] * edited.actuations[moving[0]].maxDeg,
    ),
  ).toBeCloseTo(20);
});
it("expo softens the stick centre but keeps full travel and the included trim, while quads never spin motors", () => {
  const preview = new ControlPreview(parseAircraft(raptor));
  // Half stick: out = (1 − e)·x + e·x³ = 0.3875 at e = 0.3, then trim 0.7.
  preview.step({ ...neutralControls(), pitch: 0.5 }, DEFAULT_EXPO, 0.7);
  expect(preview.controls.pitch).toBeCloseTo(0.7 + 0.3 * 0.3875, 12);
  preview.reset();
  preview.step({ ...neutralControls(), pitch: 1 }, DEFAULT_EXPO, 0.7);
  expect(preview.controls.pitch).toBeCloseTo(1, 12);
  preview.reset();
  preview.step(neutralControls(), DEFAULT_EXPO, 0.7);
  expect(preview.controls.pitch).toBe(0.7);
  const drone = new ControlPreview(parseAircraft(quad));
  drone.step(
    { roll: 1, pitch: 1, yaw: 1, throttle: 1 },
    { roll: 0, pitch: 0, yaw: 0, throttle: 0 },
  );
  expect(drone.controls).toEqual({ roll: 1, pitch: 1, yaw: 1, throttle: 0 });
  expect(drone.deflections).toEqual([]);
});
