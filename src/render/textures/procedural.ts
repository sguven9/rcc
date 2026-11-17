/**
 * Procedural surface textures, generated in the browser at start-up: no image
 * files, no third-party licences, no download size. Everything is tileable
 * (periodic noise) and deterministic for a seed. Pure byte arrays here; the
 * `toTexture` helper wraps them for three.js with mipmaps and anisotropy.
 *
 * Generators: concrete and asphalt micro-relief (normal + roughness), and
 * corrugated-sheet ribs (normal). Parameters are visual estimates.
 */
import * as T from "three";

/** Deterministic hash → [0, 1) for integer lattice points with a period. */
function lattice(x: number, y: number, period: number, seed: number) {
  const xi = ((x % period) + period) % period,
    yi = ((y % period) + period) % period;
  let h = (xi * 374761393 + yi * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Periodic value noise in [0, 1): tiles every `period` lattice cells. */
export function tileNoise(
  x: number,
  y: number,
  period: number,
  seed = 1,
): number {
  const x0 = Math.floor(x),
    y0 = Math.floor(y);
  const fx = x - x0,
    fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx),
    sy = fy * fy * (3 - 2 * fy);
  const a = lattice(x0, y0, period, seed),
    b = lattice(x0 + 1, y0, period, seed),
    c = lattice(x0, y0 + 1, period, seed),
    d = lattice(x0 + 1, y0 + 1, period, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Tileable fractal noise over a `size`² image (period = image). */
export function fbmImage(
  size: number,
  baseCells: number,
  octaves: number,
  seed = 1,
) {
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let amp = 0.5,
        sum = 0,
        norm = 0,
        cells = baseCells;
      for (let o = 0; o < octaves; o++) {
        sum +=
          amp *
          tileNoise((x / size) * cells, (y / size) * cells, cells, seed + o);
        norm += amp;
        amp *= 0.5;
        cells *= 2;
      }
      out[y * size + x] = sum / norm;
    }
  return out;
}

/** Height field (0–1) → tangent-space normal map bytes (RGBA, OpenGL +Y). */
export function heightToNormal(
  height: Float32Array,
  size: number,
  strength: number,
) {
  const out = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) =>
    height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength,
        dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      out[i] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round(((dy / len) * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      out[i + 3] = 255;
    }
  return out;
}

/** Scalar field (0–1) → greyscale RGBA bytes (roughness in the green channel). */
export function scalarBytes(values: Float32Array, lo = 0, hi = 1) {
  const out = new Uint8Array(values.length * 4);
  values.forEach((v, i) => {
    const g = Math.round(Math.min(1, Math.max(0, lo + (hi - lo) * v)) * 255);
    out.set([g, g, g, 255], i * 4);
  });
  return out;
}

export interface SurfaceDetail {
  size: number;
  normal: Uint8Array;
  roughness: Uint8Array;
}

/** Broom-finished concrete: fine pits and aggregate, slightly varied roughness. */
export function concreteDetail(size = 256, seed = 11): SurfaceDetail {
  const fine = fbmImage(size, 32, 3, seed),
    pits = fbmImage(size, 64, 2, seed + 7);
  const height = new Float32Array(size * size);
  for (let i = 0; i < height.length; i++)
    height[i] = fine[i] * 0.7 + (pits[i] > 0.72 ? -0.25 : 0);
  return {
    size,
    normal: heightToNormal(height, size, 2.2),
    roughness: scalarBytes(fbmImage(size, 8, 3, seed + 3), 0.78, 0.97),
  };
}

/** Asphalt: coarse chippings in a binder (rougher, stronger relief). */
export function asphaltDetail(size = 256, seed = 23): SurfaceDetail {
  const chips = fbmImage(size, 96, 2, seed);
  const height = new Float32Array(size * size);
  for (let i = 0; i < height.length; i++)
    height[i] = Math.max(0, chips[i] - 0.45) * 2;
  return {
    size,
    normal: heightToNormal(height, size, 3.4),
    roughness: scalarBytes(chips, 0.82, 0.98),
  };
}

/** Corrugated sheet: sinusoidal ribs across u (one period per texture). */
export function corrugatedNormal(size = 64, ribs = 1, depth = 1.6) {
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      height[y * size + x] =
        0.5 + 0.5 * Math.sin((2 * Math.PI * ribs * x) / size);
  return heightToNormal(height, size, depth);
}

/** Wrap RGBA bytes as a repeating, mipmapped, anisotropic texture. */
export function toTexture(
  bytes: Uint8Array,
  size: number,
  repeat = 1,
  colorSpace: T.ColorSpace = T.NoColorSpace,
) {
  const texture = new T.DataTexture(bytes, size, size, T.RGBAFormat);
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.generateMipmaps = true;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.magFilter = T.LinearFilter;
  texture.anisotropy = 8;
  texture.colorSpace = colorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Shared procedural detail maps (built once, on first use). */
let shared:
  | { concrete: SurfaceDetail; asphalt: SurfaceDetail; ribs: Uint8Array }
  | undefined;
export function proceduralLibrary() {
  return (shared ??= {
    concrete: concreteDetail(),
    asphalt: asphaltDetail(),
    ribs: corrugatedNormal(),
  });
}
