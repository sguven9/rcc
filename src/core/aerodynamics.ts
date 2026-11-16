import type { Aircraft } from "./schema";
import { interpolate } from "./powertrain";
import { clamp } from "./math";

type Surface = Aircraft["surfaces"][number];
type Coefficients = { cl: number; cd: number; cm: number };
export const STANDARD_AIR_VISCOSITY = 1.4607e-5; // kinematic, m²/s at 15 °C / sea level

/** Interpolate angle, then log(Re). No extrapolation of measured coefficients.
 * Each table blends to the analytical fallback outside its own angle range.
 * Reynolds boundaries clamp, and coverage is reported rather than concealed.
 */
export function surfacePolar(
  surface: Surface,
  angleDeg: number,
  reynolds: number,
  fallback: Coefficients,
) {
  const family = surface.reynoldsPolars?.tables;
  const tables =
    family ?? (surface.polar ? [{ reynolds, points: surface.polar }] : []);
  if (!tables.length)
    return {
      ...fallback,
      source: "analytical" as const,
      outsideEnvelope: false,
    };
  const read = (table: (typeof tables)[number]) => {
    const points = table.points;
    const outside = Math.max(
      points[0].alphaDeg - angleDeg,
      angleDeg - points.at(-1)!.alphaDeg,
      0,
    );
    const weight = clamp(outside / 12, 0, 1);
    const values = { ...fallback };
    for (const key of ["cl", "cd", "cm"] as const)
      values[key] =
        interpolate(
          points,
          angleDeg,
          (p) => p.alphaDeg,
          (p) => p[key],
        ) *
          (1 - weight) +
        fallback[key] * weight;
    return { ...values, outside: outside > 0 };
  };
  let high = tables.findIndex((t) => t.reynolds >= reynolds);
  if (high < 0) high = tables.length - 1;
  const low = Math.max(0, high - 1);
  const a = read(tables[low]),
    b = read(tables[high]);
  const weight =
    low === high
      ? 0
      : clamp(
          Math.log(Math.max(1, reynolds) / tables[low].reynolds) /
            Math.log(tables[high].reynolds / tables[low].reynolds),
          0,
          1,
        );
  return {
    cl: a.cl + (b.cl - a.cl) * weight,
    cd: a.cd + (b.cd - a.cd) * weight,
    cm: a.cm + (b.cm - a.cm) * weight,
    source: family ? ("reynolds-table" as const) : ("polar-table" as const),
    outsideEnvelope:
      (weight < 1 && a.outside) ||
      (weight > 0 && b.outside) ||
      Boolean(
        family &&
        (reynolds < tables[0].reynolds || reynolds > tables.at(-1)!.reynolds),
      ),
  };
}

/**
 * Post-stall pitching moment about c/4 from the normal force, with the centre
 * of pressure moving from c/4 towards mid-chord as x_cp = 0.25 + 0.25·√|sin α|
 * (≈0.42c at 40°, 0.5c at 90°; flat-plate trend, Hoerner, Fluid-Dynamic Lift).
 * Blended in with the existing stall blend, so attached flow is unchanged.
 */
export function postStallMoment(normalCoefficient: number, alphaRad: number) {
  return -normalCoefficient * 0.25 * Math.sqrt(Math.abs(Math.sin(alphaRad)));
}

/**
 * Wing downwash at a horizontal tail, radians: ε = 2·C_L/(π·AR) (elliptic-wing
 * far-field estimate, e.g. Etkin & Reid), reduced in ground effect by the
 * wing's area-weighted McCormick factor. Applied only to tails at least 1.5
 * mean chords behind the wing; elevons on the wing's trailing edge are part of
 * its lifting system and see none.
 */
export function downwashAngle(
  a: Aircraft,
  surface: Surface,
  wingLiftCoefficient: number,
  wingGroundFactor: number,
) {
  if (surface.kind !== "horizontal-tail") return 0;
  const wings = a.surfaces.filter((w) => w.kind === "wing");
  if (!wings.length) return 0;
  const area = wings.reduce((n, w) => n + w.spanM * w.chordM, 0);
  const span = a.reference.spanM,
    chord = area / span,
    x =
      wings.reduce((n, w) => n + w.positionM[0] * w.spanM * w.chordM, 0) / area;
  if (x - surface.positionM[0] < 1.5 * chord) return 0;
  const aspect = (span * span) / area;
  return (2 * wingLiftCoefficient * wingGroundFactor) / (Math.PI * aspect);
}
