/**
 * RC transmitter setup wizard logic (input/calibration.ts): centre and noise,
 * endpoints, normalization with an off-centre rest point, automatic channel
 * detection with fake gamepad samples, stick modes, switches, the first-run
 * flag, recalibration on a different device and the throttle safety check.
 */
import { describe, expect, it } from "vitest";
import {
  CHANNEL_PROMPTS,
  MODE_LAYOUT,
  RangeTracker,
  buildCalibration,
  centerStats,
  checkPrompt,
  detectAxis,
  detectSwitch,
  needsRecalibration,
  parseSetupState,
  promptText,
  reversedFor,
  shouldOpenWizard,
  suggestDeadzone,
  switchOn,
  throttleSafe,
} from "../src/input/calibration";
import {
  mapGamepad,
  normalizeAxis,
  validProfile,
  type Channel,
} from "../src/input/controls";

/** A Mode-2 transmitter: aileron axis 0, elevator 1 (up = −1), throttle 2 (up = −1), rudder 3. */
const AXES: Record<Channel, number> = {
  roll: 0,
  pitch: 1,
  throttle: 2,
  yaw: 3,
};
const STICK: Record<string, number> = {
  "throttle:up": -1,
  "throttle:down": 1,
  "roll:left": -1,
  "roll:right": 1,
  "pitch:up": -1,
  "pitch:down": 1,
  "yaw:left": -1,
  "yaw:right": 1,
};

/** Run the eight prompts against simulated stick moves (as the wizard does). */
function runPrompts(axisFor = AXES, stick = STICK) {
  const assigned: Parameters<typeof checkPrompt>[2] = {};
  for (const p of CHANNEL_PROMPTS) {
    const baseline = [0, 0, p.channel === "throttle" && !p.first ? -1 : 1, 0];
    const current = [...baseline];
    current[axisFor[p.channel]] = stick[`${p.channel}:${p.move}`];
    const found = detectAxis(baseline, current, 0.5);
    expect(found).not.toBeNull();
    const result = checkPrompt(p, found!, assigned);
    expect(result.ok).toBe(true);
    if (result.ok && p.first)
      assigned[p.channel] = { axis: result.axis, sign: result.sign };
  }
  return assigned as Required<typeof assigned>;
}

describe("centre, noise and deadzone", () => {
  it("averages each axis and reports its peak-to-peak noise", () => {
    const s = centerStats([
      [0.02, -0.5, 1],
      [0.04, -0.5, 1],
      [0.0, -0.5, 1],
    ]);
    expect(s.center[0]).toBeCloseTo(0.02, 12);
    expect(s.noise[0]).toBeCloseTo(0.04, 12);
    expect(s.center[1]).toBe(-0.5);
    expect(s.noise[2]).toBe(0);
  });
  it("suggests a deadzone of three times the noise, between 2 % and 15 %", () => {
    expect(suggestDeadzone(0)).toBe(0.02);
    expect(suggestDeadzone(0.02)).toBeCloseTo(0.06, 12);
    expect(suggestDeadzone(0.5)).toBe(0.15);
    expect(suggestDeadzone(0.02, 0.5)).toBeCloseTo(0.12, 12);
  });
});

describe("endpoints and normalization", () => {
  it("tracks min/max and reports which axes travelled", () => {
    const r = new RangeTracker();
    for (const a of [
      [-0.9, 0, 0.1],
      [0.95, 0.3, 0.1],
    ])
      r.add(a);
    expect(r.min[0]).toBe(-0.9);
    expect(r.max[0]).toBe(0.95);
    expect(r.moved()).toEqual([0]);
  });
  it("maps an off-centre rest point to 0 and both ends to ±1 (piecewise)", () => {
    const b = {
      axis: 0,
      min: -0.8,
      center: 0.1,
      max: 0.9,
      reversed: false,
      deadzone: 0,
      expo: 0,
    };
    expect(normalizeAxis(0.1, b)).toBe(0);
    expect(normalizeAxis(0.9, b)).toBe(1);
    expect(normalizeAxis(-0.8, b)).toBe(-1);
    // Half-way on each side: (0.5 − 0.1)/(0.9 − 0.1) and (−0.35 − 0.1)/0.9.
    expect(normalizeAxis(0.5, b)).toBeCloseTo(0.5, 12);
    expect(normalizeAxis(-0.35, b)).toBeCloseTo(-0.5, 12);
    expect(normalizeAxis(2, b)).toBe(1); // clamped
    expect(normalizeAxis(0.9, { ...b, reversed: true })).toBe(-1);
    // Throttle uses the full span: (raw − min)/(max − min).
    expect(normalizeAxis(0.05, b, true)).toBeCloseTo(0.5, 12);
    expect(normalizeAxis(0.9, { ...b, reversed: true }, true)).toBe(0);
  });
});

describe("automatic channel detection (fake gamepad samples)", () => {
  it("finds the axis that moved most, ignoring small drift", () => {
    expect(detectAxis([0, 0, 1, 0], [0.1, 0, 1, 0.9])).toEqual({
      axis: 3,
      delta: 0.9,
    });
    expect(detectAxis([0, 0, 1, 0], [0.2, -0.1, 1, 0.3])).toBeNull();
    expect(detectAxis([0, 0], [1, 0.9], 0.5, [0])).toEqual({
      axis: 1,
      delta: 0.9,
    });
  });
  it("maps all four channels and sets the reversals from the movement", () => {
    const assigned = runPrompts();
    expect(
      Object.fromEntries(Object.entries(assigned).map(([c, v]) => [c, v.axis])),
    ).toEqual(AXES);
    // Throttle up gives −1 raw → reversed; aileron/rudder left give −1 → normal;
    // elevator up (nose down) gives −1 → normal.
    expect(reversedFor("throttle", assigned.throttle.sign)).toBe(true);
    expect(reversedFor("roll", assigned.roll.sign)).toBe(false);
    expect(reversedFor("pitch", assigned.pitch.sign)).toBe(false);
    expect(reversedFor("yaw", assigned.yaw.sign)).toBe(false);
  });
  it("reverses an aileron that reads +1 when pushed left", () => {
    const assigned = runPrompts(AXES, {
      ...STICK,
      "roll:left": 1,
      "roll:right": -1,
    });
    expect(reversedFor("roll", assigned.roll.sign)).toBe(true);
  });
  it("warns when an axis is reused or the second move is wrong", () => {
    const assigned = { throttle: { axis: 2, sign: -1 as const } };
    const reuse = checkPrompt(
      CHANNEL_PROMPTS[2],
      { axis: 2, delta: -1 },
      assigned,
    );
    expect(reuse.ok).toBe(false);
    if (!reuse.ok) expect(reuse.error).toMatch(/already used for the throttle/);
    const otherAxis = checkPrompt(
      CHANNEL_PROMPTS[1],
      { axis: 0, delta: 1 },
      assigned,
    );
    expect(otherAxis.ok).toBe(false);
    if (!otherAxis.ok) expect(otherAxis.error).toMatch(/different axis/);
    const sameWay = checkPrompt(
      CHANNEL_PROMPTS[1],
      { axis: 2, delta: -1 },
      assigned,
    );
    expect(sameWay.ok).toBe(false);
  });
  it("builds a versioned calibration that reads the sticks correctly", () => {
    const range = new RangeTracker();
    range.add([-1, -1, -1, -1]);
    range.add([1, 1, 1, 1]);
    const cal = buildCalibration({
      deviceId: "fake-tx",
      mode: 2,
      centers: [0.02, -0.01, 0, 0],
      noise: [0.01, 0.01, 0.01, 0.01],
      range,
      assigned: runPrompts(),
    });
    expect(cal.version).toBe(2);
    expect(validProfile(cal)).toBe(true);
    expect(cal.bindings.throttle.deadzone).toBe(0);
    // 3 × noise over the shorter half-travel (1 − 0.02), rounded to 0.1 %.
    expect(cal.bindings.roll.deadzone).toBe(
      Math.round((0.03 / 0.98) * 1000) / 1000,
    );
    const read = (axes: number[]) => mapGamepad(axes, cal);
    // Throttle stick up (raw −1) is full power; down is idle.
    expect(read([0.02, -0.01, -1, 0]).throttle).toBe(1);
    expect(read([0.02, -0.01, 1, 0]).throttle).toBe(0);
    // Aileron right, elevator pulled back (raw +1) = nose up, rudder right.
    const c = read([1, 1, 1, 1]);
    expect(c.roll).toBe(1);
    expect(c.pitch).toBe(1);
    expect(c.yaw).toBe(1);
    expect(read([0.02, -0.01, 1, 0]).roll).toBe(0);
  });
});

describe("stick modes", () => {
  it("names the stick that carries each channel", () => {
    expect(MODE_LAYOUT[2].throttle).toBe("left");
    expect(MODE_LAYOUT[1].throttle).toBe("right");
    expect(promptText(CHANNEL_PROMPTS[0], 2)).toMatch(/left stick fully up/);
    expect(promptText(CHANNEL_PROMPTS[0], 1)).toMatch(/right stick fully up/);
    expect(promptText(CHANNEL_PROMPTS[2], 2)).toMatch(
      /right stick fully left \(aileron\)/,
    );
    for (const mode of [1, 2, 3, 4] as const) {
      const sides = Object.values(MODE_LAYOUT[mode]);
      expect(sides.filter((s) => s === "left")).toHaveLength(2);
    }
  });
});

describe("switches", () => {
  it("detects a button or a spare axis and reads its position", () => {
    const before = { axes: [0, 0, 1, 0, -1], buttons: [0, 0] };
    const button = detectSwitch(
      before,
      { ...before, buttons: [0, 1] },
      [0, 1, 2, 3],
    )!;
    expect(button).toMatchObject({ kind: "button", index: 1 });
    expect(
      switchOn(button, { axes: [], buttons: [{ value: 0 }, { value: 1 }] }),
    ).toBe(true);
    expect(
      switchOn(button, { axes: [], buttons: [{ value: 0 }, { value: 0 }] }),
    ).toBe(false);
    const axis = detectSwitch(
      before,
      { ...before, axes: [0, 0, 1, 0, 1] },
      [0, 1, 2, 3],
    )!;
    expect(axis).toMatchObject({ kind: "axis", index: 4, threshold: 0 });
    expect(switchOn(axis, { axes: [0, 0, 0, 0, 0.9], buttons: [] })).toBe(true);
    expect(switchOn(axis, { axes: [0, 0, 0, 0, -0.9], buttons: [] })).toBe(
      false,
    );
    // Stick axes are never taken for a switch.
    expect(
      detectSwitch(before, { ...before, axes: [1, 0, 1, 0, -1] }, [0, 1, 2, 3]),
    ).toBeNull();
  });
});

describe("first-run flag, recalibration and throttle safety", () => {
  it("opens on the first visit or without a saved calibration, not after skip or save", () => {
    expect(shouldOpenWizard(null, false)).toBe(true);
    expect(shouldOpenWizard(null, true)).toBe(false);
    expect(shouldOpenWizard({ completed: false, skipped: true }, false)).toBe(
      false,
    );
    expect(shouldOpenWizard({ completed: true, skipped: false }, true)).toBe(
      false,
    );
  });
  it("parses stored state defensively", () => {
    expect(parseSetupState(null)).toBeNull();
    expect(parseSetupState("{bad")).toBeNull();
    expect(
      parseSetupState(
        '{"completed":true,"deviceId":"a","firstFlightPending":true}',
      ),
    ).toEqual({
      completed: true,
      skipped: false,
      deviceId: "a",
      firstFlightPending: true,
    });
  });
  it("suggests recalibration only for a different device than the calibrated one", () => {
    const state = { completed: true, skipped: false, deviceId: "radio-A" };
    expect(needsRecalibration(state, "radio-A")).toBe(false);
    expect(needsRecalibration(state, "radio-B")).toBe(true);
    expect(needsRecalibration(null, "radio-B")).toBe(false);
    expect(needsRecalibration(state, undefined)).toBe(false);
  });
  it("lets a flight start only with the throttle at idle", () => {
    expect(throttleSafe(0)).toBe(true);
    expect(throttleSafe(0.05)).toBe(true);
    expect(throttleSafe(0.06)).toBe(false);
    expect(throttleSafe(Number.NaN)).toBe(false);
  });
  it("still accepts version-1 profiles and rejects malformed switches", () => {
    const range = new RangeTracker();
    range.add([-1, -1, -1, -1]);
    range.add([1, 1, 1, 1]);
    const cal = buildCalibration({
      deviceId: "x",
      mode: 2,
      centers: [0, 0, 0, 0],
      noise: [0, 0, 0, 0],
      range,
      assigned: runPrompts(),
    });
    expect(validProfile({ ...cal, version: 1 })).toBe(true);
    expect(validProfile({ ...cal, mode: 5 })).toBe(false);
    expect(
      validProfile({ ...cal, switches: { arm: { kind: "lever", index: 0 } } }),
    ).toBe(false);
  });
});
