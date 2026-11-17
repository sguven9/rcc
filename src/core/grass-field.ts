/**
 * Natural grass blades for the flying site: seeded clump placement on the
 * grass zones, wind sway and distance fade. Pure functions so placement,
 * sway direction and LOD can be tested; view/grass.ts mirrors `swayOffset`
 * and `bladeFade` in its vertex shader.
 *
 * Visual model only (estimate): grass is short by the runway, taller and
 * denser away from it; blades lean downwind with a flutter whose rate grows
 * with wind speed; beyond the LOD radius only the ground texture remains.
 */
import { surfaceAt, type Scenery } from "./scenery";

export const GRASS = {
  /** Clump grid spacing before jitter, m (≈1 clump per 0.8 m²). */
  spacingM: 0.8,
  /** Square tiles used for culling, m. */
  tileM: 16,
  /** Blades fade (shrink) to nothing between these camera distances, m. */
  fadeStartM: 35,
  fadeEndM: 55,
  /** Clump height near the runway edge and far from it, m. */
  shortM: 0.07,
  tallM: 0.34,
  /** Distance from the runway edge over which height and density grow, m. */
  growM: [2, 28] as [number, number],
  /** Lean of the blade tip per m/s of wind, as a fraction of its height. */
  leanPerMps: 0.045,
  maxWindMps: 15,
};

export interface GrassClump {
  x: number;
  z: number;
  yaw: number;
  height: number;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seeded clumps on the site's grass zones (never on paved areas). `limit`
 * bounds the area searched, for tests and small views.
 */
export function grassClumps(
  profile: Scenery,
  seed = 7,
  limit?: { x: [number, number]; z: [number, number] },
): GrassClump[] {
  const zones = profile.surfaceZones?.grass ?? [];
  const runwayHalf = (profile.runway?.width ?? 7) / 2;
  const rand = random(seed);
  const out: GrassClump[] = [];
  const seen = new Set<string>();
  for (const zone of zones) {
    const reach = Math.hypot(zone.width, zone.depth) / 2;
    let x0 = zone.x - reach,
      x1 = zone.x + reach,
      z0 = zone.z - reach,
      z1 = zone.z + reach;
    if (limit) {
      x0 = Math.max(x0, limit.x[0]);
      x1 = Math.min(x1, limit.x[1]);
      z0 = Math.max(z0, limit.z[0]);
      z1 = Math.min(z1, limit.z[1]);
    }
    const s = GRASS.spacingM;
    for (let gx = Math.ceil(x0 / s); gx * s <= x1; gx++)
      for (let gz = Math.ceil(z0 / s); gz * s <= z1; gz++) {
        const key = `${gx},${gz}`;
        if (seen.has(key)) continue;
        const x = (gx + rand() - 0.5) * s,
          z = (gz + rand() - 0.5) * s;
        if (surfaceAt(profile, x, z) !== "grass") continue;
        seen.add(key);
        const fromRunway = Math.abs(z) - runwayHalf;
        const grow = smoothstep(GRASS.growM[0], GRASS.growM[1], fromRunway);
        // Sparser near the runway, dense in the outer grass.
        if (rand() > 0.35 + 0.65 * grow) continue;
        out.push({
          x,
          z,
          yaw: rand() * Math.PI * 2,
          height:
            (GRASS.shortM + (GRASS.tallM - GRASS.shortM) * grow) *
            (0.75 + 0.5 * rand()),
        });
      }
  }
  return out;
}

/**
 * Horizontal displacement of a blade point (scene x, z), m: it leans
 * downwind (the direction the air moves) with a flutter; `heightFraction` is
 * the point's height along the blade (0 root, 1 tip), `bladeHeight` in m.
 */
export function swayOffset(
  windX: number,
  windZ: number,
  timeS: number,
  phase: number,
  heightFraction: number,
  bladeHeight: number,
): [number, number] {
  const speed = Math.hypot(windX, windZ);
  if (speed < 0.01) return [0, 0];
  const flutter = 0.6 + 0.4 * Math.sin(timeS * (1.5 + 0.15 * speed) + phase);
  const amount =
    GRASS.leanPerMps *
    Math.min(speed, GRASS.maxWindMps) *
    heightFraction *
    heightFraction *
    bladeHeight *
    flutter;
  return [(windX / speed) * amount, (windZ / speed) * amount];
}

/** Blade scale for LOD: 1 near the camera, 0 at and beyond the fade end. */
export function bladeFade(distanceM: number) {
  return 1 - smoothstep(GRASS.fadeStartM, GRASS.fadeEndM, distanceM);
}
