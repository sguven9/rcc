/**
 * Sun direction for a time of day at the flying site (NOAA-style
 * approximation: declination from the day of year, hour angle from local
 * solar time; equation of time ignored, about ±16 min). Pure; unit-tested.
 *
 * The result is in the simulator's north/east/up frame; the runway-aligned
 * scene adds the site heading offset when converting.
 */
export interface SunPosition {
  /** Elevation above the horizon, radians. */
  elevation: number;
  /** Azimuth clockwise from true north, radians. */
  azimuth: number;
  /** Unit vector [north, east, up]. */
  direction: [number, number, number];
}

const RAD = Math.PI / 180;

export function sunPosition(
  hour: number,
  dayOfYear: number,
  latitudeDeg: number,
): SunPosition {
  const decl = 23.44 * RAD * Math.sin(((2 * Math.PI) / 365) * (dayOfYear - 81));
  const hourAngle = (hour - 12) * 15 * RAD;
  const lat = latitudeDeg * RAD;
  const sinEl =
    Math.sin(lat) * Math.sin(decl) +
    Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  // Azimuth from north, clockwise.
  const y = -Math.sin(hourAngle) * Math.cos(decl);
  const x =
    Math.cos(lat) * Math.sin(decl) -
    Math.sin(lat) * Math.cos(decl) * Math.cos(hourAngle);
  const azimuth = (Math.atan2(y, x) + 2 * Math.PI) % (2 * Math.PI);
  const c = Math.cos(elevation);
  return {
    elevation,
    azimuth,
    direction: [
      c * Math.cos(azimuth),
      c * Math.sin(azimuth),
      Math.sin(elevation),
    ],
  };
}

/** 0 at night, 1 in daylight, smooth through civil twilight. */
export function daylight(elevation: number, twilightDeg = -4) {
  const t = (elevation / RAD - twilightDeg) / (6 - twilightDeg);
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}
