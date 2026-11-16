/** Runway rectangle in local field metres; +X is the take-off direction. */
export interface RunwayLayout {
  /** Centre along local +X, metres. */
  x: number;
  length: number;
  width: number;
  material: "asphalt" | "concrete" | "natural";
}
/** Axis-aligned local area kept free of generated trees, rocks and grass. */
export type ClearArea = [
  xMin: number,
  zMin: number,
  xMax: number,
  zMax: number,
];
export interface Scenery {
  name: string;
  description: string;
  temperatureC: number;
  elevationM: number;
  surface: "asphalt" | "grass" | "dirt";
  ground: string;
  strip: string;
  ridge: string;
  fog: string;
  sun: [number, number, number];
  sunColor: string;
  sunIntensity: number;
  treeCount: number;
  ridgeHeight: number;
  seed: number;
  /** Defaults to the club's 170 × 7 m strip. */
  runway?: RunwayLayout;
  /**
   * True bearing of local +X, degrees. Local axes stay runway-aligned so launch,
   * wind and placement keep their meaning; displays add this to headings.
   */
  headingOffsetDeg?: number;
  /** Ploughed or dry soil texture independent of the runway surface. */
  dryGround?: boolean;
  /** Built site layout; omitted sites use the generic club equipment. */
  site?: "manisa";
  clearAreas?: ClearArea[];
  /** Field stones only within this local Z band (e.g. beyond a boundary fence). */
  rockBandZ?: [number, number];
  /** Straight roads kept clear: [x, z, direction from +X toward +Z (deg), half-width]. */
  clearStrips?: [number, number, number, number][];
  /** Explicit tree positions [x, z, height] placed before random groves. */
  plantedTrees?: [number, number, number][];
  /** WGS84 reference for documentation; local coordinates remain metres. */
  location?: { latitude: number; longitude: number };
  /**
   * Ground materials for wheel friction (0.13.0): paved areas first, then
   * grass; everything else is bare soil (dirt).
   */
  surfaceZones?: { paved: ZoneRect[]; grass: ZoneRect[] };
}
/** Rotated rectangle in local metres (x along the runway, z = sim east axis). */
export interface ZoneRect {
  x: number;
  z: number;
  width: number;
  depth: number;
  /** Rotation like the site footprints: u → (cos, −sin), degrees. */
  yawDeg: number;
}
export function inZone(r: ZoneRect, x: number, z: number) {
  const a = (r.yawDeg * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  const dx = x - r.x,
    dz = z - r.z;
  return (
    Math.abs(dx * c - dz * s) <= r.width / 2 &&
    Math.abs(dx * s + dz * c) <= r.depth / 2
  );
}
/** Ground material at local (x, z): paved, grass or dirt. */
export function surfaceAt(
  profile: Scenery,
  x: number,
  z: number,
): "asphalt" | "grass" | "dirt" {
  const zones = profile.surfaceZones;
  if (!zones) return profile.surface;
  if (zones.paved.some((r) => inZone(r, x, z))) return "asphalt";
  if (zones.grass.some((r) => inZone(r, x, z))) return "grass";
  return "dirt";
}
export const defaultRunway: RunwayLayout = {
  x: 48,
  length: 170,
  width: 7,
  material: "asphalt",
};
export const runwayOf = (profile: Scenery): RunwayLayout =>
  profile.runway ??
  (profile.surface === "asphalt"
    ? defaultRunway
    : { ...defaultRunway, material: "natural" });
export const isDryGround = (profile: Scenery) =>
  profile.dryGround ?? profile.surface === "dirt";
/** True where generated trees, rocks or grass would cover a built surface. */
export function isClearArea(profile: Scenery, x: number, z: number) {
  for (const [x0, z0, x1, z1] of profile.clearAreas ?? [])
    if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return true;
  for (const [px, pz, angle, half] of profile.clearStrips ?? []) {
    const a = (angle * Math.PI) / 180;
    if (Math.abs(-(x - px) * Math.sin(a) + (z - pz) * Math.cos(a)) < half)
      return true;
  }
  return false;
}

/**
 * The only flying site is Manisa (other fields were removed in 0.13.0).
 * Field elevation affects pressure/density; local coordinates remain metres AGL.
 */
export const sceneries = {
  manisa: {
    name: "Manisa",
    description: "Concrete runway 10/28, ploughed Gediz plain, warm afternoon",
    temperatureC: 24,
    elevationM: 24,
    surface: "asphalt" as const,
    ground: "#a48d70",
    strip: "#a99579",
    ridge: "#8f8a74",
    fog: "#cdd2cc",
    sun: [-30, 52, 40] as [number, number, number],
    sunColor: "#fff0d8",
    sunIntensity: 3.4,
    treeCount: 70,
    ridgeHeight: 1,
    seed: 177,
    runway: { x: -1, length: 400, width: 16, material: "concrete" as const },
    headingOffsetDeg: 103,
    dryGround: true,
    rockBandZ: [90, 150] as [number, number],
    site: "manisa" as const,
    clearAreas: [
      [-30, -175, 175, -36],
      [-210, -10, 210, 10],
    ] as ClearArea[],
    clearStrips: [[150.8, -163.5, 29.9, 12]] as [
      number,
      number,
      number,
      number,
    ][],
    plantedTrees: [
      [43, -86, 6],
      ...Array.from({ length: 14 }, (_, i): [number, number, number] => [
        95 + i * 13 * 0.867 + 8 * 0.498,
        -195 + i * 13 * 0.498 - 8 * 0.867,
        8 + ((i * 37) % 5),
      ]),
    ],
    location: { latitude: 38.70171, longitude: 27.45461 },
    // Same footprints as view/manisa-site.ts (concrete is treated as paved).
    surfaceZones: {
      paved: [
        { x: -1, z: 0, width: 400, depth: 16, yawDeg: 0 },
        { x: 0.15, z: -24.5, width: 7, depth: 33.5, yawDeg: 0 },
        { x: -0.9, z: -52.2, width: 27, depth: 14, yawDeg: 29.2 },
        { x: 63.1, z: -110.4, width: 63.5, depth: 28.6, yawDeg: 29.2 },
        { x: 79.75, z: -98.25, width: 200.9, depth: 6, yawDeg: 34.8 },
      ],
      grass: [
        { x: 0, z: -24, width: 420, depth: 30, yawDeg: 0 },
        { x: 0, z: 24, width: 420, depth: 30, yawDeg: 0 },
        { x: 8, z: -66, width: 92, depth: 58, yawDeg: 29.2 },
      ],
    },
  },
} satisfies Record<string, Scenery>;
export type SceneryId = keyof typeof sceneries;
export const DEFAULT_SCENERY: SceneryId = "manisa";
export function airDensity(temperatureC: number, elevationM: number) {
  const pressure = 101325 * Math.pow(1 - 2.25577e-5 * elevationM, 5.25588);
  return pressure / (287.05 * (temperatureC + 273.15));
}

/** Sutherland dry-air law, SI; kinematic viscosity = dynamic viscosity / density. */
export function airKinematicViscosity(
  temperatureC: number,
  densityKgM3: number,
) {
  const kelvin = temperatureC + 273.15;
  return (1.458e-6 * kelvin ** 1.5) / (kelvin + 110.4) / densityKgM3;
}
