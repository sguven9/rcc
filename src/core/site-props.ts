/**
 * Static ground objects of a flying site: parked model aircraft, cars, the
 * seating area and small equipment. One data file per site holds every
 * placement (kind, anchor, local offset, heading, colour); rendering and
 * collision boxes are generated from it, nothing is placed by hand in code.
 *
 * Coordinates are field metres (scene X/Z, Y up). Each placement is given in
 * an anchor's local frame: u along the anchor's width, v toward its front
 * (the runway side for Manisa buildings), so the layout stays readable and
 * follows the building footprints.
 *
 * Layout and sizes follow the user's reference photos of the Manisa field
 * (2026-11-16); positions are estimates, colours are approximate, and no
 * logo, marking or text from the photos is reproduced.
 */
export type PropKind =
  | "model-trainer"
  | "model-warbird"
  | "model-jet"
  | "model-delta"
  | "car-sedan"
  | "car-hatchback"
  | "car-suv"
  | "camp-chair"
  | "plastic-chair"
  | "table"
  | "toolbox"
  | "model-stand"
  | "field-box";

/** Bounding box of a prop at scale 1: length (X), width (Z), height (Y), m. */
export const PROP_SIZE: Record<PropKind, [number, number, number]> = {
  "model-trainer": [1.15, 1.45, 0.42],
  "model-warbird": [1.05, 1.2, 0.36],
  "model-jet": [1.1, 0.8, 0.22],
  "model-delta": [0.9, 0.95, 0.16],
  "car-sedan": [4.6, 1.8, 1.45],
  "car-hatchback": [4.0, 1.75, 1.5],
  "car-suv": [4.7, 1.9, 1.72],
  "camp-chair": [0.55, 0.55, 0.9],
  "plastic-chair": [0.5, 0.52, 0.82],
  table: [1.4, 0.8, 0.75],
  toolbox: [0.5, 0.28, 0.3],
  "model-stand": [0.55, 0.3, 0.32],
  "field-box": [0.45, 0.35, 0.4],
};

/** Collision class: models and furniture are solid, so aircraft cannot pass through. */
export const PROP_SOLID: Record<PropKind, boolean> = Object.fromEntries(
  Object.keys(PROP_SIZE).map((k) => [k, true]),
) as Record<PropKind, boolean>;

export interface PropAnchor {
  x: number;
  z: number;
  /** Rotation about +Y, radians (scene convention: u → (cos, −sin)). */
  yaw: number;
}

export interface PropPlacement {
  kind: PropKind;
  anchor: string;
  /** Offsets in the anchor frame, metres. */
  u: number;
  v: number;
  /** Heading relative to the anchor's +u axis, degrees. */
  headingDeg: number;
  scale?: number;
  /** Body colour (hex); defaults per kind. */
  color?: string;
}

export interface ResolvedProp {
  kind: PropKind;
  x: number;
  z: number;
  /** Rotation about +Y, radians. */
  yaw: number;
  scale: number;
  color: string;
}

export const DEFAULT_PROP_COLOR: Record<PropKind, string> = {
  "model-trainer": "#f2f1ec",
  "model-warbird": "#7f8a6a",
  "model-jet": "#e9ecef",
  "model-delta": "#c9302c",
  "car-sedan": "#f1f2f0",
  "car-hatchback": "#2f4a6b",
  "car-suv": "#9aa0a3",
  "camp-chair": "#2b2f35",
  "plastic-chair": "#f0f0ea",
  table: "#ece9e1",
  toolbox: "#c23b2b",
  "model-stand": "#3c4248",
  "field-box": "#2d3236",
};

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Field position of an anchor-local point (same rule as building footprints). */
export function anchorPoint(a: PropAnchor, u: number, v: number) {
  const c = Math.cos(a.yaw),
    s = Math.sin(a.yaw);
  return { x: a.x + u * c + v * s, z: a.z - u * s + v * c };
}

export function resolveProps(
  anchors: Record<string, PropAnchor>,
  placements: PropPlacement[],
): ResolvedProp[] {
  return placements.map((p) => {
    const a = anchors[p.anchor];
    if (!a) throw new Error(`Unknown prop anchor ${p.anchor}`);
    const { x, z } = anchorPoint(a, p.u, p.v);
    return {
      kind: p.kind,
      x,
      z,
      // Heading turns from +u toward +v; scene rotation about +Y is the reverse sense.
      yaw: a.yaw - rad(p.headingDeg),
      scale: p.scale ?? 1,
      color: p.color ?? DEFAULT_PROP_COLOR[p.kind],
    };
  });
}

// ---------------------------------------------------------------- Manisa ---

const MANISA_YAW = rad(29.2);

/**
 * Anchors are the measured building footprints (see view/manisa-site.ts):
 * hangar (28 × 24 m) and clubhouse (17 × 16 m); +v faces the runway.
 */
export const manisaAnchors: Record<string, PropAnchor> = {
  hangar: { x: -12.8, z: -67.6, yaw: MANISA_YAW },
  clubhouse: { x: 30.8, z: -82.6, yaw: MANISA_YAW },
};

/** Heading 90° points a model's nose along +v (toward the runway). */
const row = (
  anchor: string,
  kinds: [PropKind, string?][],
  u0: number,
  du: number,
  v: number,
  headingDeg: number,
): PropPlacement[] =>
  kinds.map(([kind, color], i) => ({
    kind,
    anchor,
    u: u0 + i * du,
    v,
    headingDeg,
    ...(color ? { color } : {}),
  }));

export const manisaProps: PropPlacement[] = [
  // Hangar apron: models parked nose-out in front of the doors (estimate).
  ...row(
    "hangar",
    [
      ["model-trainer"],
      ["model-warbird", "#c9c3a6"],
      ["model-trainer", "#f3d34a"],
      ["model-jet", "#4e5d6c"],
    ],
    -7.5,
    3.2,
    15.2,
    90,
  ),
  { kind: "model-stand", anchor: "hangar", u: 4.5, v: 14.2, headingDeg: 0 },
  { kind: "toolbox", anchor: "hangar", u: 5.4, v: 13.6, headingDeg: 12 },
  { kind: "field-box", anchor: "hangar", u: -10.2, v: 13.4, headingDeg: 0 },
  // Clubhouse: the line of models beside the concrete path, as in the
  // drone photos (trainer, scale jets, red delta).
  ...row(
    "clubhouse",
    [
      ["model-trainer", "#efe9e0"],
      ["model-jet", "#e8edf0"],
      ["model-jet", "#33475e"],
      ["model-trainer", "#d7413a"],
      ["model-delta"],
      ["model-warbird", "#e9e4dc"],
    ],
    -6.8,
    2.1,
    11.4,
    70,
  ),
  // Seating under the open ground floor and at the pilots' table.
  { kind: "table", anchor: "clubhouse", u: -4.2, v: 5.2, headingDeg: 0 },
  { kind: "table", anchor: "clubhouse", u: 1.6, v: 5.2, headingDeg: 0 },
  ...[-5.2, -3.2].flatMap((u) => [
    {
      kind: "plastic-chair" as const,
      anchor: "clubhouse",
      u,
      v: 4.3,
      headingDeg: 90,
    },
    {
      kind: "plastic-chair" as const,
      anchor: "clubhouse",
      u,
      v: 6.1,
      headingDeg: -90,
    },
  ]),
  ...[0.6, 2.6].flatMap((u) => [
    {
      kind: "plastic-chair" as const,
      anchor: "clubhouse",
      u,
      v: 4.3,
      headingDeg: 90,
    },
    {
      kind: "plastic-chair" as const,
      anchor: "clubhouse",
      u,
      v: 6.1,
      headingDeg: -90,
    },
  ]),
  { kind: "camp-chair", anchor: "clubhouse", u: -1.4, v: 10.2, headingDeg: 60 },
  { kind: "camp-chair", anchor: "clubhouse", u: 0.2, v: 10.5, headingDeg: 80 },
  { kind: "field-box", anchor: "clubhouse", u: -0.6, v: 9.6, headingDeg: 20 },
  { kind: "toolbox", anchor: "clubhouse", u: 6.4, v: 9.2, headingDeg: -15 },
  // Parked cars on the gravel west of the clubhouse (white, blue, grey).
  { kind: "car-sedan", anchor: "clubhouse", u: -12.6, v: 2.4, headingDeg: 90 },
  {
    kind: "car-sedan",
    anchor: "clubhouse",
    u: -15.6,
    v: 2.0,
    headingDeg: 88,
    color: "#e4e6e3",
  },
  {
    kind: "car-hatchback",
    anchor: "clubhouse",
    u: -18.6,
    v: 2.4,
    headingDeg: 91,
  },
  { kind: "car-suv", anchor: "clubhouse", u: -21.7, v: 2.1, headingDeg: 90 },
];

export const MANISA_PROPS = resolveProps(manisaAnchors, manisaProps);
