import { expect, it } from "vitest";
import { pixelRatioFor } from "../src/render/quality";
import { QUALITY_LEVELS, RENDER_CONFIG } from "../src/render/render-config";

// Updated with the 0.9.0 renderer: the drawing-buffer limit moved from
// view/render-budget.ts (a fixed 1.25× / 2.1 MP cap) to the quality presets
// in render/render-config.ts. The checks are the same for every preset.
it.each([
  [390, 844, 3],
  [1366, 912, 2],
  [1920, 1080, 2],
  [3840, 2160, 2],
])("bounds the drawing buffer on a %i × %i display", (width, height, dpr) => {
  for (const level of QUALITY_LEVELS) {
    const ratio = pixelRatioFor(width, height, dpr, level);
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThanOrEqual(dpr * 1.25);
    expect(ratio).toBeLessThanOrEqual(RENDER_CONFIG.maxPixelRatio);
    expect(width * height * ratio ** 2).toBeLessThanOrEqual(
      RENDER_CONFIG.maxPixels + 1,
    );
  }
});

it("does not supersample a standard-density laptop screen below Ultra", () => {
  expect(pixelRatioFor(1366, 768, 1, "medium")).toBe(1);
  expect(pixelRatioFor(1366, 768, 1, "high")).toBe(1);
});
