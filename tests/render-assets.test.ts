import { afterEach, describe, expect, it, vi } from "vitest";
import * as T from "three";
import {
  asphaltDetail,
  concreteDetail,
  corrugatedNormal,
  fbmImage,
  heightToNormal,
  tileNoise,
  toTexture,
} from "../src/render/textures/procedural";
import { bleedAlpha } from "../src/render/textures/alpha-bleed";
import {
  finishOf,
  propellerDiscs,
  upgradeAircraftMaterials,
} from "../src/render/materials";
import { SunShadows } from "../src/render/shadows";
import { QUALITY_PRESETS, RENDER_CONFIG } from "../src/render/render-config";
import { surfaceTexture } from "../src/view/terrain-material";

afterEach(() => vi.restoreAllMocks());

const decode = (bytes: Uint8Array, i: number) =>
  [0, 1, 2].map((k) => (bytes[i * 4 + k] / 255) * 2 - 1);

describe("procedural textures", () => {
  it("noise tiles seamlessly at its period", () => {
    for (const [x, y] of [
      [0.3, 0.7],
      [2.5, 3.25],
      [7.9, 0.1],
    ]) {
      expect(tileNoise(x + 8, y, 8, 3)).toBeCloseTo(tileNoise(x, y, 8, 3), 12);
      expect(tileNoise(x, y + 8, 8, 3)).toBeCloseTo(tileNoise(x, y, 8, 3), 12);
    }
  });
  it("is deterministic for a seed and differs between seeds", () => {
    const a = fbmImage(32, 4, 3, 5),
      b = fbmImage(32, 4, 3, 5),
      c = fbmImage(32, 4, 3, 6);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it("wraps across the image edge without a seam", () => {
    const size = 64,
      img = fbmImage(size, 8, 3, 2);
    // Edge-to-edge differences are no larger than ordinary neighbour steps.
    let edge = 0,
      inner = 0;
    for (let y = 0; y < size; y++) {
      edge = Math.max(edge, Math.abs(img[y * size + size - 1] - img[y * size]));
      inner = Math.max(inner, Math.abs(img[y * size + 1] - img[y * size]));
    }
    expect(edge).toBeLessThanOrEqual(inner * 1.5 + 1e-6);
  });
  it("normal maps are unit length and point out of the surface", () => {
    for (const detail of [concreteDetail(64, 1), asphaltDetail(64, 2)])
      for (let i = 0; i < 64 * 64; i += 37) {
        const n = decode(detail.normal, i);
        expect(Math.hypot(...n)).toBeCloseTo(1, 1);
        expect(n[2]).toBeGreaterThan(0.2);
      }
    const flat = heightToNormal(new Float32Array(16), 4, 3);
    expect(decode(flat, 5).map((v) => Math.round(v * 100) / 100)).toEqual([
      0, 0, 1,
    ]);
  });
  it("corrugated ribs tilt the normal across u only", () => {
    const ribs = corrugatedNormal(64, 1, 1.6);
    // Rising flank (x = 0) and falling flank (x = 32) tilt opposite ways;
    // crest (x = 16) faces straight out; no tilt along v anywhere.
    const rising = decode(ribs, 64 * 10 + 0),
      crest = decode(ribs, 64 * 10 + 16),
      falling = decode(ribs, 64 * 10 + 32);
    expect(Math.sign(rising[0])).toBe(-Math.sign(falling[0]));
    expect(Math.abs(rising[0])).toBeGreaterThan(0.05);
    expect(Math.abs(crest[0])).toBeLessThan(0.01);
    for (const n of [rising, crest, falling])
      expect(Math.abs(n[1])).toBeLessThan(0.01);
  });
  it("roughness stays in the plausible concrete/asphalt range", () => {
    for (const [detail, lo, hi] of [
      [concreteDetail(32, 4), 0.78, 0.97],
      [asphaltDetail(32, 4), 0.82, 0.98],
    ] as const)
      for (let i = 0; i < 32 * 32; i++) {
        const g = detail.roughness[i * 4 + 1] / 255;
        expect(g).toBeGreaterThanOrEqual(lo - 0.005);
        expect(g).toBeLessThanOrEqual(hi + 0.005);
      }
  });
  it("wraps bytes as a repeating, mipmapped, linear texture", () => {
    const t = toTexture(concreteDetail(16, 1).normal, 16, 4);
    expect(t.wrapS).toBe(T.RepeatWrapping);
    expect(t.repeat.x).toBe(4);
    expect(t.generateMipmaps).toBe(true);
    expect(t.colorSpace).toBe(T.NoColorSpace);
  });
});

describe("alpha bleeding for cutout foliage", () => {
  it("fills transparent texels with neighbouring opaque colour", () => {
    // 4×1: green opaque, then three transparent white texels.
    const data = new Uint8ClampedArray([
      20, 160, 40, 255, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0,
    ]);
    bleedAlpha(data, 4, 1, 8);
    for (let i = 1; i < 4; i++) {
      expect([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]).toEqual([
        20, 160, 40,
      ]);
      expect(data[i * 4 + 3]).toBe(0); // alpha is untouched
    }
  });
  it("uses the mean opaque colour beyond the bleed radius", () => {
    const w = 32,
      data = new Uint8ClampedArray(w * 4).fill(255);
    for (let i = 0; i < w; i++) data[i * 4 + 3] = 0;
    data.set([0, 100, 0, 255], 0);
    data.set([0, 200, 0, 255], 4);
    bleedAlpha(data, w, 1, 2);
    expect([data[(w - 1) * 4], data[(w - 1) * 4 + 1]]).toEqual([0, 150]);
  });
  it("leaves a fully transparent image unchanged", () => {
    const data = new Uint8ClampedArray([9, 9, 9, 0, 8, 8, 8, 0]);
    bleedAlpha(data, 2, 1);
    expect([...data]).toEqual([9, 9, 9, 0, 8, 8, 8, 0]);
  });
});

describe("asset loading errors", () => {
  it("a missing scenery texture warns and keeps a usable texture", () => {
    vi.spyOn(T.TextureLoader.prototype, "load").mockImplementation(function (
      this: T.TextureLoader,
      _url,
      _onLoad,
      _onProgress,
      onError,
    ) {
      onError?.(new Error("404"));
      return new T.Texture();
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onLoad = vi.fn();
    const texture = surfaceTexture("missing/none.jpg", true, onLoad);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("missing/none.jpg"),
    );
    expect(onLoad).not.toHaveBeenCalled();
    expect(texture.wrapS).toBe(T.RepeatWrapping);
    expect(texture.colorSpace).toBe(T.SRGBColorSpace);
  });
});

describe("aircraft materials", () => {
  const std = (p: T.MeshStandardMaterialParameters) =>
    new T.MeshStandardMaterial(p);
  it("classifies glass, paint and matte finishes", () => {
    expect(finishOf(std({ transparent: true, opacity: 0.4 }))).toBe("glass");
    expect(finishOf(std({ metalness: 0.6, roughness: 0.9 }))).toBe("paint");
    expect(finishOf(std({ roughness: 0.4 }))).toBe("paint");
    expect(finishOf(std({ roughness: 0.9 }))).toBe("matte");
  });
  it("upgrades each shared material once and keeps colours", () => {
    const paint = std({ color: "#c43", roughness: 0.4 }),
      canopy = std({ transparent: true, opacity: 0.5 }),
      foam = std({ color: "#eee", roughness: 0.9 });
    const root = new T.Group();
    for (const m of [paint, paint, canopy, foam])
      root.add(new T.Mesh(new T.BoxGeometry(), m));
    expect(upgradeAircraftMaterials(root)).toBe(3);
    const mats = root.children.map(
      (c) => (c as T.Mesh).material as T.MeshPhysicalMaterial,
    );
    expect(mats[0]).toBe(mats[1]);
    expect(mats.every((m) => m instanceof T.MeshPhysicalMaterial)).toBe(true);
    expect(mats[0].color.getHexString()).toBe(paint.color.getHexString());
    expect(mats[0].clearcoat).toBe(RENDER_CONFIG.materials.paintClearcoat);
    expect(mats[2].opacity).toBe(RENDER_CONFIG.materials.glassOpacity);
    expect(mats[2].depthWrite).toBe(false);
    expect(mats[3].clearcoat).toBe(0);
    // Wear is a distinct shader variant; repeated upgrades are no-ops.
    expect(mats[0].customProgramCacheKey()).toContain("wear+panel");
    expect(mats[3].customProgramCacheKey()).toMatch(/wear$/);
    expect(upgradeAircraftMaterials(root)).toBe(0);
  });
  it("propeller discs appear with speed and hide the blades", () => {
    const parent = new T.Group(),
      prop = new T.Group();
    const blade = new T.Mesh(new T.BoxGeometry()),
      spinner = new T.Mesh(new T.BoxGeometry());
    spinner.name = "spinner";
    prop.add(blade, spinner);
    prop.position.set(0.3, 0, 0);
    parent.add(prop);
    const discs = propellerDiscs([prop], [0.25]);
    const disc = discs.discs[0];
    expect(disc.parent).toBe(parent);
    expect(disc.position.x).toBe(0.3);
    discs.update([0]);
    expect(disc.visible).toBe(false);
    expect(blade.visible).toBe(true);
    discs.update([1]);
    expect(disc.visible).toBe(true);
    expect((disc.material as T.MeshStandardMaterial).opacity).toBeCloseTo(0.42);
    expect(blade.visible).toBe(false);
    expect(spinner.visible).toBe(true);
    discs.dispose();
    expect(disc.parent).toBe(null);
  });
});

describe("cascaded shadows on materials with custom shaders", () => {
  const fakeShader = () =>
    ({
      uniforms: {},
      vertexShader: "#include <common>\nvoid main(){}",
      fragmentShader:
        "#include <common>\n#include <lights_fragment_begin>\nvoid main(){}",
      defines: {},
    }) as unknown as T.WebGLProgramParametersWithUniforms;
  it("keeps the material's own hook and wraps it once per quality switch", () => {
    const scene = new T.Scene(),
      camera = new T.PerspectiveCamera();
    const material = new T.MeshStandardMaterial();
    const own = vi.fn();
    material.onBeforeCompile = own;
    const sun = new T.Vector3(0.3, 0.8, 0.2);
    const first = new SunShadows(scene, camera, QUALITY_PRESETS.medium, sun);
    first.prepareMaterial(material);
    first.prepareMaterial(material); // idempotent within one preset
    first.dispose();
    // Switching preset: the new cascades must not stack on the old wrapper.
    const second = new SunShadows(scene, camera, QUALITY_PRESETS.high, sun);
    second.prepareMaterial(material);
    material.onBeforeCompile(fakeShader(), {} as T.WebGLRenderer);
    expect(own).toHaveBeenCalledTimes(1);
    second.dispose();
  });
  it("leaves unlit materials alone", () => {
    const s = new SunShadows(
      new T.Scene(),
      new T.PerspectiveCamera(),
      QUALITY_PRESETS.low,
      new T.Vector3(0, 1, 0),
    );
    const basic = new T.MeshBasicMaterial();
    const hook = basic.onBeforeCompile;
    s.prepareMaterial(basic);
    expect(basic.onBeforeCompile).toBe(hook);
    s.dispose();
  });
});
