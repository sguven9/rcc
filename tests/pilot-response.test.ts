/** Transmitter stick expo (task test 3): out = (1 − e)·x + e·x³. */
import { describe, expect, it } from "vitest";
import {
  applyExpo,
  DEFAULT_EXPO,
  ExpoSchema,
  expo,
} from "../src/core/pilot-response";

describe("expo", () => {
  it("keeps the end points and the centre for every expo", () => {
    for (const e of [0, 0.2, 0.3, 0.5, 1]) {
      expect(expo(1, e)).toBeCloseTo(1, 12);
      expect(expo(-1, e)).toBeCloseTo(-1, 12);
      expect(expo(0, e)).toBe(0);
    }
  });
  it("is linear at e = 0 and softer around centre as e grows", () => {
    for (const x of [-0.8, -0.3, 0.25, 0.6])
      expect(expo(x, 0)).toBeCloseTo(x, 12);
    expect(Math.abs(expo(0.3, 0.3))).toBeLessThan(0.3);
    expect(Math.abs(expo(0.3, 0.6))).toBeLessThan(Math.abs(expo(0.3, 0.3)));
    expect(expo(0.5, 0.3)).toBeCloseTo(0.7 * 0.5 + 0.3 * 0.125, 12);
  });
  it("is monotonic and odd", () => {
    let previous = -Infinity;
    for (let x = -1; x <= 1; x += 0.01) {
      const y = expo(x, 0.7);
      expect(y).toBeGreaterThanOrEqual(previous);
      expect(expo(-x, 0.7)).toBeCloseTo(-y, 12);
      previous = y;
    }
  });
  it("clamps and sanitises input", () => {
    expect(expo(3, 0.3)).toBe(1);
    expect(expo(Number.NaN, 0.3)).toBe(0);
  });
  it("shapes all channels; throttle about mid-stick and linear by default", () => {
    const shaped = applyExpo(
      { roll: 0.5, pitch: -0.5, yaw: 0.2, throttle: 0.25 },
      DEFAULT_EXPO,
    );
    expect(shaped.roll).toBeCloseTo(expo(0.5, 0.3), 12);
    expect(shaped.pitch).toBeCloseTo(expo(-0.5, 0.3), 12);
    expect(shaped.yaw).toBeCloseTo(expo(0.2, 0.2), 12);
    expect(shaped.throttle).toBe(0.25);
    const throttle = applyExpo(
      { roll: 0, pitch: 0, yaw: 0, throttle: 0.25 },
      { ...DEFAULT_EXPO, throttle: 0.5 },
    ).throttle;
    expect(throttle).toBeCloseTo((expo(-0.5, 0.5) + 1) / 2, 12);
    for (const t of [0, 0.5, 1])
      expect(
        applyExpo(
          { roll: 0, pitch: 0, yaw: 0, throttle: t },
          { ...DEFAULT_EXPO, throttle: 0.8 },
        ).throttle,
      ).toBeCloseTo(t, 12);
  });
  it("has sensible validated defaults", () => {
    expect(ExpoSchema.parse(DEFAULT_EXPO)).toEqual({
      roll: 0.3,
      pitch: 0.3,
      yaw: 0.2,
      throttle: 0,
    });
    expect(() => ExpoSchema.parse({ ...DEFAULT_EXPO, roll: 1.5 })).toThrow();
  });
});
