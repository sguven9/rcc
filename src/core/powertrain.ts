import type { Aircraft } from "./schema";
import { clamp } from "./math";
export function interpolate<T>(
  points: readonly T[],
  x: number,
  coordinate: (p: T) => number,
  value: (p: T) => number,
) {
  if (x <= coordinate(points[0])) return value(points[0]);
  for (let i = 1; i < points.length; i++)
    if (x <= coordinate(points[i])) {
      const t =
        (x - coordinate(points[i - 1])) /
        (coordinate(points[i]) - coordinate(points[i - 1]));
      return value(points[i - 1]) * (1 - t) + value(points[i]) * t;
    }
  return value(points[points.length - 1]);
}
/** Quasi-static resistive battery. Bench current is scaled by terminal voltage at fixed command. */
export function powertrain(
  a: Aircraft,
  commands: number[],
  soc = a.battery?.initialSoc ?? 1,
  density = 1.225,
) {
  const bench = a.motors.map((m, i) => {
    const command = clamp(commands[i] ?? 0, 0, 1),
      p = m.performance;
    return {
      thrust: p
        ? interpolate(
            p.points,
            command,
            (v) => v.command,
            (v) => v.thrustN,
          )
        : m.maxThrustN * command,
      current: p
        ? interpolate(
            p.points,
            command,
            (v) => v.command,
            (v) => v.currentA,
          )
        : 0,
    };
  });
  const battery = a.battery;
  const ocv = battery
    ? battery.cells *
      interpolate(
        battery.voltageCurve,
        clamp(soc, 0, 1),
        (v) => v.soc,
        (v) => v.voltsPerCell,
      )
    : 0;
  const conductance = bench.reduce(
    (sum, p, i) =>
      sum + p.current / (a.motors[i].performance?.referenceVoltage ?? 1),
    0,
  );
  const voltage = battery
    ? Math.max(
        0,
        (ocv - battery.resistanceOhm * battery.avionicsCurrentA) /
          (1 + battery.resistanceOhm * conductance),
      )
    : 0;
  const current =
    battery && soc > 0 ? conductance * voltage + battery.avionicsCurrentA : 0;
  const thrust = bench.map((p, i) => {
    const performance = a.motors[i].performance;
    const ratio = battery
      ? soc > 0
        ? voltage / performance!.referenceVoltage
        : 0
      : 1;
    return (
      (p.thrust * ratio * ratio * density) /
      (performance?.referenceDensityKgM3 ?? 1.225)
    );
  });
  // Shaft speed relative to full command at the reference voltage: static
  // thrust ∝ n², and n ∝ terminal voltage at a fixed command.
  const rpmRatio = bench.map((p, i) => {
    const max = a.motors[i].maxThrustN;
    const voltageRatio = battery
      ? soc > 0
        ? voltage / a.motors[i].performance!.referenceVoltage
        : 0
      : 1;
    return max > 0 ? Math.sqrt(Math.max(0, p.thrust) / max) * voltageRatio : 0;
  });
  return {
    thrust,
    rpmRatio,
    voltage: soc > 0 ? voltage : 0,
    current,
    powerW: voltage * current,
    soc: clamp(soc, 0, 1),
  };
}

/**
 * Fixed-pitch propeller thrust in forward flight from the linear advance-ratio
 * law C_T(J) = C_T0·(1 − J/J0) with J = V/(n·D). Thrust falls to zero at
 * V = V0·(n/n_max), so the zero-thrust speed scales with shaft speed: at part
 * throttle the propeller unloads at a proportionally lower airspeed. Above it
 * the factor turns negative and the propeller brakes (drag); since the static
 * thrust scales with n², that drag, T0·r·(V/V0 − r), stays bounded and
 * vanishes as the command goes to zero. `zeroThrustSpeedMps` is V0 at full
 * command and the reference voltage.
 */
export function thrustSpeedFactor(
  axialSpeedMps: number,
  zeroThrustSpeedMps: number,
  rpmRatio: number,
) {
  const v = Math.max(0, axialSpeedMps);
  if (!(rpmRatio > 0)) return 0;
  return Math.min(1, 1 - v / (zeroThrustSpeedMps * rpmRatio));
}
