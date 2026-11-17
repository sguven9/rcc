import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backendMessage,
  chooseBackend,
  probeBackends,
  WEBGPU_RENDERING_READY,
} from "../src/render/backend";
import {
  DynamicResolution,
  detectQuality,
  isQualityLevel,
  lodLevel,
  pixelRatioFor,
} from "../src/render/quality";
import {
  QUALITY_LEVELS,
  QUALITY_PRESETS,
  RENDER_CONFIG,
} from "../src/render/render-config";
import {
  DEFAULT_RENDER_SETTINGS,
  parseRenderSettings,
  RenderEngine,
} from "../src/render/engine";

afterEach(() => vi.unstubAllGlobals());

describe("graphics backend fallback", () => {
  it("falls back to WebGL2 while the WebGPU path is not enabled", () => {
    expect(WEBGPU_RENDERING_READY).toBe(false);
    expect(chooseBackend({ webgpu: true, webgl2: true })).toBe("webgl2");
    expect(chooseBackend({ webgpu: false, webgl2: true })).toBe("webgl2");
  });
  it("selects WebGPU only when the port is ready and an adapter exists", () => {
    expect(chooseBackend({ webgpu: true, webgl2: true }, true)).toBe("webgpu");
    expect(chooseBackend({ webgpu: false, webgl2: true }, true)).toBe("webgl2");
  });
  it("reports 'none' with a readable reason when nothing can render", () => {
    const caps = { webgpu: false, webgl2: false };
    expect(chooseBackend(caps)).toBe("none");
    expect(backendMessage(caps)).toMatch(/WebGL2/);
    expect(backendMessage({ webgpu: false, webgl2: true })).toBe("");
  });
  it("probes without throwing when the browser APIs fail", async () => {
    vi.stubGlobal("document", {
      createElement: () => ({
        getContext: () => {
          throw new Error("blocked");
        },
      }),
    });
    vi.stubGlobal("navigator", {
      gpu: { requestAdapter: () => Promise.reject(new Error("no adapter")) },
    });
    await expect(probeBackends()).resolves.toEqual({
      webgpu: false,
      webgl2: false,
    });
  });
  it("treats a GPU without an adapter as no WebGPU", async () => {
    vi.stubGlobal("document", {
      createElement: () => ({ getContext: () => ({}) }),
    });
    vi.stubGlobal("navigator", {
      gpu: { requestAdapter: () => Promise.resolve(null) },
    });
    await expect(probeBackends()).resolves.toEqual({
      webgpu: false,
      webgl2: true,
    });
  });
  it("the engine refuses with the message instead of crashing later", () => {
    vi.stubGlobal("document", {
      createElement: () => ({ getContext: () => null }),
    });
    expect(() => new RenderEngine({} as HTMLElement)).toThrow(
      backendMessage({ webgpu: false, webgl2: false }),
    );
  });
});

describe("quality presets", () => {
  it("defines four ordered presets whose cost does not decrease", () => {
    expect(QUALITY_LEVELS).toEqual(["low", "medium", "high", "ultra"]);
    const p = QUALITY_LEVELS.map((l) => QUALITY_PRESETS[l]);
    for (let i = 1; i < p.length; i++) {
      expect(p[i].shadowCascades).toBeGreaterThanOrEqual(
        p[i - 1].shadowCascades,
      );
      expect(p[i].shadowMapSize).toBeGreaterThanOrEqual(p[i - 1].shadowMapSize);
      expect(p[i].shadowDistanceM).toBeGreaterThan(p[i - 1].shadowDistanceM);
      expect(p[i].grassDensity).toBeGreaterThanOrEqual(p[i - 1].grassDensity);
      expect(p[i].resolutionScale).toBeGreaterThanOrEqual(
        p[i - 1].resolutionScale,
      );
      expect(p[i].envMapSize).toBeGreaterThanOrEqual(p[i - 1].envMapSize);
    }
  });
  it.each(QUALITY_LEVELS)("%s preset is within the engine's limits", (l) => {
    const p = QUALITY_PRESETS[l];
    // three.js CSM casts no shadow with a single cascade.
    expect(p.shadowCascades).toBeGreaterThanOrEqual(2);
    expect(p.shadowCascades).toBeLessThanOrEqual(4);
    expect(Math.log2(p.shadowMapSize) % 1).toBe(0);
    expect(Math.log2(p.envMapSize) % 1).toBe(0);
    expect(p.grassDensity).toBeGreaterThan(0);
    expect(p.grassDensity).toBeLessThanOrEqual(1);
    // MSAA only accompanies SMAA: alpha-to-coverage foliage depends on it.
    expect(["none", "fxaa", "smaa"]).toContain(p.antialias);
  });
  it("picks a conservative preset from device hints", () => {
    const base = { cores: 8, maxTextureSize: 16384, mobile: false };
    expect(detectQuality({ ...base, renderer: "Google SwiftShader" })).toBe(
      "low",
    );
    expect(detectQuality({ ...base, maxTextureSize: 2048 })).toBe("low");
    expect(detectQuality({ ...base, mobile: true })).toBe("medium");
    expect(detectQuality({ ...base, cores: 4 })).toBe("medium");
    expect(detectQuality({ ...base, memoryGb: 4 })).toBe("medium");
    expect(detectQuality({ ...base, renderer: "Intel Iris Xe" })).toBe("high");
    expect(
      detectQuality({ ...base, renderer: "NVIDIA GeForce RTX 3060" }),
    ).toBe("ultra");
  });
  it("validates stored levels", () => {
    expect(isQualityLevel("high")).toBe(true);
    expect(isQualityLevel("auto")).toBe(false);
    expect(isQualityLevel(3)).toBe(false);
  });
});

describe("render settings (never part of a recording)", () => {
  it("falls back to defaults on missing or corrupt storage", () => {
    expect(parseRenderSettings(null)).toEqual(DEFAULT_RENDER_SETTINGS);
    expect(parseRenderSettings("{not json")).toEqual(DEFAULT_RENDER_SETTINGS);
    expect(parseRenderSettings("42")).toEqual(DEFAULT_RENDER_SETTINGS);
  });
  it("keeps valid values and rejects invalid ones field by field", () => {
    expect(
      parseRenderSettings(
        JSON.stringify({
          quality: "ultra",
          hour: 18.5,
          dynamicResolution: false,
          vignette: false,
        }),
      ),
    ).toEqual({
      quality: "ultra",
      hour: 18.5,
      dynamicResolution: false,
      vignette: false,
    });
    const bad = parseRenderSettings(
      JSON.stringify({ quality: "extreme", hour: 30 }),
    );
    expect(bad.quality).toBe("auto");
    expect(bad.hour).toBe(RENDER_CONFIG.site.defaultHour);
  });
});

describe("dynamic resolution", () => {
  const frames = (d: DynamicResolution, seconds: number, n: number) => {
    let changes = 0;
    for (let i = 0; i < n; i++) if (d.update(seconds)) changes++;
    return changes;
  };
  it("steps down after a sustained run of slow frames, not one spike", () => {
    const d = new DynamicResolution();
    d.update(0.2);
    expect(d.scale).toBe(1);
    frames(d, 1 / 30, RENDER_CONFIG.dynamicResolution.settleFrames);
    expect(d.scale).toBeCloseTo(1 - RENDER_CONFIG.dynamicResolution.step, 6);
  });
  it("never leaves its limits and recovers when frames are fast", () => {
    const d = new DynamicResolution();
    frames(d, 1 / 10, 5000);
    expect(d.scale).toBe(RENDER_CONFIG.dynamicResolution.min);
    frames(d, 1 / 200, 20000);
    expect(d.scale).toBe(RENDER_CONFIG.dynamicResolution.max);
  });
  it("holds steady inside the dead band and ignores invalid samples", () => {
    const d = new DynamicResolution();
    expect(frames(d, 1 / 60, 1000)).toBe(0);
    expect(d.update(NaN)).toBe(false);
    expect(d.update(-1)).toBe(false);
    d.scale = 0.7;
    d.reset();
    expect(d.scale).toBe(1);
  });
  it("bounds the drawing buffer by ratio and pixel count", () => {
    for (const level of QUALITY_LEVELS)
      for (const [w, h, dpr] of [
        [1366, 768, 1],
        [1920, 1080, 2],
        [3840, 2160, 2],
      ]) {
        const r = pixelRatioFor(w, h, dpr, level);
        expect(r).toBeLessThanOrEqual(RENDER_CONFIG.maxPixelRatio);
        expect(w * h * r * r).toBeLessThanOrEqual(RENDER_CONFIG.maxPixels + 1);
      }
    expect(pixelRatioFor(1366, 768, 1, "low")).toBe(0.75);
    expect(pixelRatioFor(1366, 768, 1, "high", 0.6)).toBeCloseTo(0.6);
  });
});

describe("level-of-detail switching", () => {
  const [near, far] = RENDER_CONFIG.lodDistancesM;
  it("switches at the configured distances", () => {
    expect(lodLevel(0)).toBe(0);
    expect(lodLevel(near - 0.01)).toBe(0);
    expect(lodLevel(near)).toBe(1);
    expect(lodLevel(far - 0.01)).toBe(1);
    expect(lodLevel(far)).toBe(2);
    expect(lodLevel(5000)).toBe(2);
  });
  it("is monotonic in distance and safe for invalid input", () => {
    let last = 0;
    for (let d = 0; d < 400; d += 0.5) {
      const l = lodLevel(d);
      expect(l).toBeGreaterThanOrEqual(last);
      last = l;
    }
    expect(lodLevel(NaN)).toBe(0);
    expect(lodLevel(10, [5, 8])).toBe(2);
  });
});
