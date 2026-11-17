/**
 * Instrument readings for the on-screen display, taken
 * directly from the simulation state (no rendering). Unit conversion and
 * formatting are pure so they can be tested.
 *
 * Frames: the sim's local frame is runway-aligned (+X has true bearing
 * `headingOffsetDeg`); headings and wind directions are reported as true
 * bearings, 0–360°.
 */
import type { Simulation } from "./simulation";
import { euler } from "./math";
import { powertrain } from "./powertrain";
import { PHYSICS } from "./physics-config";

export interface InstrumentReadings {
  /** Indicated (true, sea-level-equivalent ignored) airspeed, m/s. */
  airspeedMps: number;
  groundSpeedMps: number;
  /** Height above the field, m. */
  altitudeM: number;
  /** Climb rate, m/s (positive up). */
  verticalSpeedMps: number;
  pitchDeg: number;
  rollDeg: number;
  /** True heading, 0–360°. */
  headingDeg: number;
  /** Rate of turn of the heading, deg/s (positive right). */
  turnRateDegS: number;
  /** Lateral specific force over g: the slip ball's deflection (positive right). */
  slip: number;
  /** Shaft speed of motor 1, rpm (undefined without maxRpm). */
  rpm?: number;
  throttle: number;
  voltageV?: number;
  currentA?: number;
  usedMah?: number;
  /** Wind at the aircraft: speed and the true bearing it blows from. */
  windSpeedMps: number;
  windFromDeg: number;
  flightTimeS: number;
  /** Straight-line horizontal distance and true bearing to home, m and deg. */
  homeDistanceM: number;
  homeBearingDeg: number;
  /** WGS84 position when the site has a reference location. */
  latitude?: number;
  longitude?: number;
}

export interface InstrumentContext {
  headingOffsetDeg?: number;
  /** Home point in local metres [x, y] (sim north/east axes). */
  home?: [number, number];
  location?: { latitude: number; longitude: number };
}

const wrap360 = (deg: number) => ((deg % 360) + 360) % 360;
const DEG = 180 / Math.PI;

/** Local runway-aligned displacement [x, y] → true north/east metres. */
export function trueDisplacement(dx: number, dy: number, headingOffsetDeg = 0) {
  const h = headingOffsetDeg / DEG;
  return {
    north: dx * Math.cos(h) - dy * Math.sin(h),
    east: dx * Math.sin(h) + dy * Math.cos(h),
  };
}

export function readInstruments(
  sim: Simulation,
  context: InstrumentContext = {},
): InstrumentReadings {
  const s = sim.state,
    offset = context.headingOffsetDeg ?? 0;
  const [roll, pitch, yaw] = euler(s.orientation);
  const [, q, r] = s.omega;
  const turnRate =
    ((q * Math.sin(roll) + r * Math.cos(roll)) /
      Math.max(0.05, Math.cos(pitch))) *
    DEG;
  const air = sim.airVelocity(s);
  const windToward = trueDisplacement(air[0], air[1], offset);
  const windSpeed = Math.hypot(air[0], air[1]);
  const home = context.home ?? [0, 0];
  const toHome = trueDisplacement(
    home[0] - s.position[0],
    home[1] - s.position[1],
    offset,
  );
  const f = sim.lastForces;
  const motor = sim.aircraft.motors[0];
  const rotor = f.rotors.find((x) => x.motor === 0);
  const power = sim.aircraft.motors.length
    ? powertrain(sim.aircraft, s.motors, s.batterySoc, f.density || 1.225)
    : undefined;
  const rpm = rotor
    ? rotor.rpm
    : motor?.maxRpm && power
      ? motor.maxRpm * power.rpmRatio[0]
      : undefined;
  const battery = sim.aircraft.battery;
  const readings: InstrumentReadings = {
    airspeedMps: f.airspeed,
    groundSpeedMps: Math.hypot(s.velocity[0], s.velocity[1]),
    altitudeM: -s.position[2],
    verticalSpeedMps: -s.velocity[2],
    pitchDeg: pitch * DEG,
    rollDeg: roll * DEG,
    headingDeg: wrap360(yaw * DEG + offset),
    turnRateDegS: turnRate,
    // The ball lags the airframe: it moves opposite to the side acceleration.
    slip: -f.force[1] / (sim.properties.mass * PHYSICS.gravity),
    throttle: s.motors.length ? Math.max(...s.motors) : 0,
    windSpeedMps: windSpeed,
    windFromDeg: wrap360(
      Math.atan2(windToward.east, windToward.north) * DEG + 180,
    ),
    flightTimeS: s.time,
    homeDistanceM: Math.hypot(toHome.north, toHome.east),
    homeBearingDeg: wrap360(Math.atan2(toHome.east, toHome.north) * DEG),
  };
  if (rpm !== undefined) readings.rpm = rpm;
  if (battery && power) {
    readings.voltageV = power.voltage;
    readings.currentA = power.current;
    readings.usedMah =
      Math.max(0, battery.initialSoc - (s.batterySoc ?? battery.initialSoc)) *
      battery.capacityMah;
  }
  if (context.location) {
    const d = trueDisplacement(s.position[0], s.position[1], offset);
    const lat = context.location.latitude;
    readings.latitude = lat + d.north / 111320;
    readings.longitude =
      context.location.longitude + d.east / (111320 * Math.cos(lat / DEG));
  }
  return readings;
}

export type SpeedUnit = "mps" | "kmh" | "kt";
export type AltitudeUnit = "m" | "ft";
export const SPEED_UNITS: Record<SpeedUnit, { factor: number; label: string }> =
  {
    mps: { factor: 1, label: "m/s" },
    kmh: { factor: 3.6, label: "km/h" },
    kt: { factor: 1 / 0.514444, label: "kt" },
  };
export const ALTITUDE_UNITS: Record<
  AltitudeUnit,
  { factor: number; label: string }
> = {
  m: { factor: 1, label: "m" },
  ft: { factor: 1 / 0.3048, label: "ft" },
};

export interface OsdText {
  speed: string;
  groundSpeed: string;
  altitude: string;
  verticalSpeed: string;
  heading: string;
  throttle: string;
  rpm: string;
  battery: string;
  current: string;
  used: string;
  wind: string;
  windArrowDeg: number;
  time: string;
  home: string;
  homeArrowDeg: number;
  latitude: string;
  longitude: string;
}

/** OSD strings in the chosen units (values from `readInstruments`). */
export function formatOsd(
  r: InstrumentReadings,
  units: { speed: SpeedUnit; altitude: AltitudeUnit },
): OsdText {
  const sp = SPEED_UNITS[units.speed],
    al = ALTITUDE_UNITS[units.altitude];
  const speed = (v: number) =>
    `${(v * sp.factor).toFixed(units.speed === "mps" ? 1 : 0)} ${sp.label}`;
  const minutes = Math.floor(r.flightTimeS / 60),
    seconds = Math.floor(r.flightTimeS % 60);
  return {
    speed: speed(r.airspeedMps),
    groundSpeed: speed(r.groundSpeedMps),
    altitude: `${(r.altitudeM * al.factor).toFixed(0)} ${al.label}`,
    verticalSpeed: `${(r.verticalSpeedMps * al.factor).toFixed(1)} ${al.label}/s`,
    heading: `${Math.round(r.headingDeg) % 360}°`.padStart(4, "0"),
    throttle: `${Math.round(r.throttle * 100)}%`,
    rpm: r.rpm === undefined ? "—" : `${Math.round(r.rpm)} rpm`,
    battery: r.voltageV === undefined ? "—" : `${r.voltageV.toFixed(1)} V`,
    current: r.currentA === undefined ? "—" : `${r.currentA.toFixed(1)} A`,
    used: r.usedMah === undefined ? "—" : `${Math.round(r.usedMah)} mAh`,
    wind: speed(r.windSpeedMps),
    windArrowDeg: wrap360(r.windFromDeg + 180 - r.headingDeg),
    time: `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`,
    home: `${(r.homeDistanceM * al.factor).toFixed(0)} ${al.label}`,
    homeArrowDeg: wrap360(r.homeBearingDeg - r.headingDeg),
    latitude: r.latitude === undefined ? "" : r.latitude.toFixed(7),
    longitude: r.longitude === undefined ? "" : r.longitude.toFixed(7),
  };
}

/** Pitch-ladder / horizon helper: screen offset of the horizon for an FOV. */
export function horizonOffset(
  pitchDeg: number,
  verticalFovDeg: number,
  heightPx: number,
) {
  return (
    (Math.tan(pitchDeg / DEG) / Math.tan(verticalFovDeg / 2 / DEG)) *
    (heightPx / 2)
  );
}
