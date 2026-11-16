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

/** Field elevation affects pressure/density; local flight coordinates remain metres AGL. */
export const sceneries = {
  club: {
    name: "Northfield club",
    description: "Mown grass, paved runway, late afternoon",
    temperatureC: 18,
    elevationM: 120,
    surface: "asphalt" as const,
    ground: "#95a078",
    strip: "#a6b58d",
    ridge: "#728576",
    fog: "#b9cad4",
    sun: [25, 60, -35] as [number, number, number],
    sunColor: "#fff4dc",
    sunIntensity: 3.2,
    treeCount: 150,
    ridgeHeight: 1,
    seed: 41,
  },
  valley: {
    name: "Alpine meadow",
    description: "Grass strip, conifer valley, cool morning",
    temperatureC: 10,
    elevationM: 1250,
    surface: "grass" as const,
    ground: "#7e967b",
    strip: "#a0b18b",
    ridge: "#657e85",
    fog: "#b7ccd5",
    sun: [-45, 34, -40] as [number, number, number],
    sunColor: "#e6efff",
    sunIntensity: 2.5,
    treeCount: 260,
    ridgeHeight: 5,
    seed: 83,
  },
  mesa: {
    name: "Desert mesa",
    description: "Dirt strip, dry scrub, warm evening",
    temperatureC: 32,
    elevationM: 650,
    surface: "dirt" as const,
    ground: "#c0a27c",
    strip: "#d5b590",
    ridge: "#ad8a72",
    fog: "#dbc4a7",
    sun: [55, 23, -25] as [number, number, number],
    sunColor: "#ffd8a3",
    sunIntensity: 3.6,
    treeCount: 45,
    ridgeHeight: 2.5,
    seed: 129,
  },
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
  },
} satisfies Record<string, Scenery>;
export type SceneryId = keyof typeof sceneries;
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
