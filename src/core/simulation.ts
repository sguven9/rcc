import { ObstacleCollisions, type Obstacle } from "./obstacles";
import { propellerMoments, propellerSpinAxis } from "./propeller-effects";
import { acroStep, type ControlPower } from "./flight-controller";
import {
  advanceRotorSpeed,
  equilibriumRotorSpeed,
  governorPitch,
  governorRate,
  rotorHalfStep,
  rotorModel,
  rotorTorques,
  type RotorModel,
} from "./rotor-dynamics";
import { DiscreteGusts, type DiscreteGustSettings } from "./discrete-gust";
import {
  surfacePolar,
  STANDARD_AIR_VISCOSITY,
  downwashAngle,
  postStallMoment,
} from "./aerodynamics";
import {
  diskInducedVelocity,
  jetHeightFactor,
  slipstreamAt,
  spanCoverage,
} from "./propwash";
import {
  DrydenTurbulence,
  groundEffectLiftRatio,
  meanWindAt,
  wingGroundEffect,
  type WindProfile,
} from "./atmosphere";
import { powertrain, thrustSpeedFactor } from "./powertrain";
import { surfaceCommand } from "./surface-control";
import { PHYSICS } from "./physics-config";
import { sceneries, surfaceAt, type Scenery } from "./scenery";
import { surfaceActuation, advanceSurfaceCommand } from "./actuation";
import { resolveGroundContacts } from "./ground";
import type { Aircraft } from "./schema";
import { massProperties } from "./aircraft";
import {
  add,
  sub,
  scale,
  dot,
  cross,
  length,
  unit,
  rotate,
  inverseQ,
  axisQ,
  radians,
  clamp,
  advanceQ,
  matVec,
  type Vec3,
  type Quat,
} from "./math";
export { SIM_VERSION } from "./versions";
export const FIXED_DT = PHYSICS.fixedDt;
export const GRAVITY = PHYSICS.gravity;
export interface Controls {
  roll: number;
  pitch: number;
  yaw: number;
  throttle: number;
  /** One-shot: start a discrete gust at this step (recorded for replay). */
  gust?: boolean;
  /**
   * Flight-controller mode (fixed-wing): "acro" = gyro rate hold, sticks
   * command body rates. Omitted = MANUAL, sticks drive the surfaces directly.
   */
  fcMode?: "acro";
}
export const neutralControls = (): Controls => ({
  roll: 0,
  pitch: 0,
  yaw: 0,
  throttle: 0,
});
export interface Environment {
  windMps: Vec3;
  gustMps: number;
  seed: number;
  densityKgM3: number;
  kinematicViscosityM2S?: number;
  sceneryId?: string;
  obstacles?: Obstacle[];
  surface?: "asphalt" | "grass" | "dirt";
  /** Logarithmic wind gradient; `windMps` is then the wind at the reference height. */
  windProfile?: WindProfile;
  /** Seeded MIL-F-8785C low-altitude Dryden turbulence scaled by the mean wind. */
  turbulence?: "dryden";
  /** Turbulence intensity multiplier on the MIL-F-8785C σ values (default 1). */
  turbulenceIntensity?: number;
  /**
   * Optional isothermal density lapse above the field: ρ = ρ_field·e^(−h/H),
   * with H in metres (8500 in the browser). Omitted: uniform density.
   */
  densityScaleHeightM?: number;
  /**
   * Ground material per contact from the site's zones (paved / grass / dirt,
   * 0.13.0). Off when omitted: the single `surface` applies everywhere.
   */
  surfaceZones?: boolean;
  /** Seeded Poisson-triggered "1−cos" discrete gusts (off when omitted). */
  discreteGusts?: DiscreteGustSettings;
}
/** Air density at a height above the field. */
export function densityAt(e: Environment, heightM: number) {
  return e.densityScaleHeightM
    ? e.densityKgM3 * Math.exp(-Math.max(0, heightM) / e.densityScaleHeightM)
    : e.densityKgM3;
}
export const calmEnvironment = (): Environment => ({
  windMps: [0, 0, 0],
  gustMps: 0,
  seed: 42,
  densityKgM3: 1.225,
});
export interface State {
  time: number;
  position: Vec3;
  velocity: Vec3;
  orientation: Quat;
  omega: Vec3;
  motors: number[];
  batterySoc?: number;
  surfaceCommands?: number[];
  /** Shaft speed Ω per motor, rad/s (only with dynamic-rotor motors; 0 for others). */
  rotorRadS?: number[];
  /** Constant-speed governor integral (pitch factor) per motor. */
  rotorPitch?: number[];
  /** ACRO flight-controller integrators (roll, pitch, yaw channel units). */
  fcIntegral?: Vec3;
  /** ACRO accumulated attitude error (roll, pitch, yaw), rad. */
  fcAttitude?: Vec3;
  status: "flying" | "grounded" | "landed" | "crashed";
}
/** Per-motor shaft dynamics at one state (dynamic-rotor motors only). */
export interface RotorTelemetry {
  motor: number;
  omegaRadS: number;
  rpm: number;
  qMotor: number;
  qProp: number;
  qFriction: number;
  /** Spin-up torque I_tot·dΩ/dt, N·m. */
  qSpinUp: number;
  omegaDot: number;
  jacobian: number;
  pitch: number;
  governorRate: number;
  /** Shaft rotational energy ½·I_tot·Ω², J. */
  energyJ: number;
}
export interface SurfaceForce {
  kind: Aircraft["surfaces"][number]["kind"];
  id: string;
  position: Vec3;
  force: Vec3;
  alphaDeg: number;
  reynolds: number;
  coefficientSource: "analytical" | "polar-table" | "reynolds-table";
  outsidePolarEnvelope: boolean;
  stalled: boolean;
  /** McCormick induced-drag factor; 1 outside ground effect. */
  groundEffect: number;
  /** Wing downwash angle applied at this tail surface, degrees (0 for wings). */
  downwashDeg: number;
}
export interface Forces {
  force: Vec3;
  torque: Vec3;
  surfaces: SurfaceForce[];
  airspeed: number;
  /** Body-frame breakdown for diagnostics: thrust, surface aerodynamics, body drag. */
  thrust: Vec3;
  aero: Vec3;
  bodyDrag: Vec3;
  /** Air density used at this state, kg/m³. */
  density: number;
  /** Summed propeller gyroscopic and P-factor moments (body axes), N·m. */
  propellerGyro: Vec3;
  pFactor: Vec3;
  /** Shaft dynamics of dynamic-rotor motors. */
  rotors: RotorTelemetry[];
}
export const initialState = (
  a: Aircraft,
  speed = 12,
  altitude = 18,
  pitchDeg = 3,
): State => ({
  time: 0,
  position: [0, 0, -altitude],
  velocity: [speed, 0, 0],
  orientation: axisQ([0, 1, 0], radians(pitchDeg)),
  omega: [0, 0, 0],
  motors: a.motors.map(() => 0),
  ...(a.battery ? { batterySoc: a.battery.initialSoc } : {}),
  status: "flying",
});
/** Mean wind (sheared when `heightM` and a profile are given) plus legacy sinusoidal gusts. */
export function windAt(t: number, e: Environment, heightM?: number): Vec3 {
  const p = e.seed * 0.371;
  return add(
    heightM === undefined
      ? e.windMps
      : meanWindAt(e.windMps, heightM, e.windProfile),
    scale(
      [
        Math.sin(t * 0.73 + p),
        Math.sin(t * 1.17 + p * 2),
        0.25 * Math.sin(t * 0.91 + p * 3),
      ],
      e.gustMps,
    ),
  );
}
export function cleanControls(c: Controls): Controls {
  return {
    roll: clamp(Number.isFinite(c.roll) ? c.roll : 0, -1, 1),
    pitch: clamp(Number.isFinite(c.pitch) ? c.pitch : 0, -1, 1),
    yaw: clamp(Number.isFinite(c.yaw) ? c.yaw : 0, -1, 1),
    throttle: clamp(Number.isFinite(c.throttle) ? c.throttle : 0, 0, 1),
    ...(c.gust === true ? { gust: true } : {}),
    ...(c.fcMode === "acro" ? { fcMode: "acro" as const } : {}),
  };
}
export class Simulation {
  readonly properties: ReturnType<typeof massProperties>;
  private collisions: ObstacleCollisions;
  private turbulence?: DrydenTurbulence;
  /** Per-point ground material when the environment enables surface zones. */
  private surfaceLookup?: (
    x: number,
    y: number,
  ) => "asphalt" | "grass" | "dirt";
  /** Discrete gust generator (seeded; idle unless enabled or triggered). */
  readonly gusts: DiscreteGusts;
  /** Control power per channel for the ACRO flight controller (fixed-wing). */
  readonly controlPower?: ControlPower;
  /** Per surface: span intervals covered by a fuselage or nacelle (no blown lift). */
  private slipstreamBlocked: [number, number][][];
  /** Dynamic shaft-speed model per motor (null: quasi-static rpm). */
  readonly rotorModels: (RotorModel | null)[];
  readonly actuations: ReturnType<typeof surfaceActuation>[];
  state: State;
  lastForces: Forces = {
    force: [0, 0, 0],
    torque: [0, 0, 0],
    surfaces: [],
    airspeed: 0,
    thrust: [0, 0, 0],
    aero: [0, 0, 0],
    bodyDrag: [0, 0, 0],
    density: 0,
    propellerGyro: [0, 0, 0],
    pFactor: [0, 0, 0],
    rotors: [],
  };
  constructor(
    public readonly aircraft: Aircraft,
    public environment: Environment = calmEnvironment(),
    state?: State,
    withFlightController = true,
  ) {
    this.properties = massProperties(aircraft);
    this.collisions = new ObstacleCollisions(aircraft, this.properties.cg);
    this.actuations = aircraft.surfaces.map((s) =>
      surfaceActuation(aircraft, s),
    );
    this.state = structuredClone(state ?? initialState(aircraft));
    this.gusts = new DiscreteGusts(environment.seed);
    // Bodies whose length spans a surface's position hide that part of its
    // span from the slipstream (in the surface's span coordinate).
    this.slipstreamBlocked = aircraft.surfaces.map((w) => {
      const spanY = Math.cos(radians(w.rollDeg));
      if (Math.abs(spanY) < 0.3) return [];
      return aircraft.parts
        .filter(
          (p) =>
            p.kind === "body" &&
            Math.abs(p.positionM[0] - w.positionM[0]) < p.sizeM[0] / 2,
        )
        .map((p) => {
          const a = (p.positionM[1] - p.sizeM[1] / 2 - w.positionM[1]) / spanY,
            b = (p.positionM[1] + p.sizeM[1] / 2 - w.positionM[1]) / spanY;
          return [Math.min(a, b), Math.max(a, b)] as [number, number];
        });
    });
    const site =
      environment.surfaceZones && environment.sceneryId
        ? (sceneries as Record<string, Scenery>)[environment.sceneryId]
        : undefined;
    if (site?.surfaceZones)
      this.surfaceLookup = (x, y) => surfaceAt(site, x, y);
    this.rotorModels = aircraft.motors.map((m) => rotorModel(m));
    if (aircraft.battery && this.state.batterySoc === undefined)
      this.state.batterySoc = aircraft.battery.initialSoc;
    if (environment.turbulence === "dryden") {
      this.turbulence = new DrydenTurbulence(environment.seed);
      this.turbulence.initialize(
        -this.state.position[2],
        environment.windMps,
        environment.windProfile,
      );
    }
    if (withFlightController) this.controlPower = this.measureControlPower();
    // Start each dynamic rotor at its steady speed for the initial command
    // and airspeed (a trimmed launch is then in rotor equilibrium too).
    if (this.rotorModels.some(Boolean)) {
      if (!this.state.rotorRadS) {
        const f = this.forces(this.state, neutralControls());
        this.state.rotorRadS = this.aircraft.motors.map(
          (_, i) => f.rotors.find((r) => r.motor === i)?.omegaRadS ?? 0,
        );
      }
      if (!this.state.rotorPitch && this.rotorModels.some((m) => m?.governed))
        this.state.rotorPitch = this.aircraft.motors.map(() => 1);
    }
  }
  /** Angular acceleration per unit roll/pitch/yaw command at the trim speed. */
  private measureControlPower(): ControlPower | undefined {
    const a = this.aircraft;
    if (!a.surfaces.some((w) => w.control)) return undefined;
    const speed = a.reference.trimSpeedMps ?? 12;
    const probe = initialState(a, speed, 200, 0);
    probe.motors = probe.motors.map(() => 0);
    delete probe.surfaceCommands;
    const calm = new Simulation(a, calmEnvironment(), probe, false);
    const perCommand = (["roll", "pitch", "yaw"] as const).map((axis, i) => {
      const at = (u: number) =>
        matVec(
          calm.properties.inverseInertia,
          calm.forces(probe, { ...neutralControls(), [axis]: u }).torque,
        )[i];
      return (at(0.2) - at(-0.2)) / 0.4;
    }) as Vec3;
    // Aerodynamic rate damping: −∂(angular acceleration)/∂(body rate).
    const damping = [0, 1, 2].map((i) => {
      const at = (w: number) => {
        const omega: Vec3 = [0, 0, 0];
        omega[i] = w;
        return matVec(
          calm.properties.inverseInertia,
          calm.forces({ ...probe, omega }, neutralControls()).torque,
        )[i];
      };
      return Math.max(0, (at(-0.3) - at(0.3)) / 0.6);
    }) as Vec3;
    return { perCommand, damping, referenceSpeed: speed };
  }
  /** World air velocity at the CG: sheared mean wind, gusts and turbulence. */
  airVelocity(s: State): Vec3 {
    const wind = add(
      windAt(s.time, this.environment, -s.position[2]),
      this.gusts.velocity(s.time),
    );
    return this.turbulence
      ? add(
          wind,
          scale(
            this.turbulence.gust,
            this.environment.turbulenceIntensity ?? 1,
          ),
        )
      : wind;
  }
  forces(s: State, c: Controls): Forces {
    const rho = densityAt(this.environment, -s.position[2]);
    let thrustForce: Vec3 = [0, 0, 0],
      propellerGyro: Vec3 = [0, 0, 0],
      pFactor: Vec3 = [0, 0, 0];
    const flow = rotate(
      inverseQ(s.orientation),
      sub(s.velocity, this.airVelocity(s)),
    );
    const power = powertrain(this.aircraft, s.motors, s.batterySoc, rho);
    // Shaft speed: dynamic rotors replace the quasi-static rpm ratio, static
    // thrust and zero-thrust speed; the thrust law itself is unchanged
    // (T = T_max·ρ/ρ_ref·r²·g·(1 − V/(g·V0·r)), r = Ω/Ω_max).
    const staticThrust = [...power.thrust],
      rpmRatio = [...power.rpmRatio],
      zeroThrust = this.aircraft.motors.map((m) => m.zeroThrustSpeedMps);
    const rotors: RotorTelemetry[] = [];
    this.rotorModels.forEach((model, i) => {
      if (!model) return;
      const input = {
        commandRpmRatio: power.rpmRatio[i],
        axialSpeedMps: Math.max(0, flow[0]),
        density: rho,
        pitch: 1,
      };
      const integral = s.rotorPitch?.[i] ?? 1;
      const omega = s.rotorRadS?.[i] ?? equilibriumRotorSpeed(model, input);
      input.pitch = governorPitch(model, integral, omega);
      const t = rotorTorques(model, omega, input);
      staticThrust[i] = model.at * rho * omega * omega * input.pitch;
      rpmRatio[i] = omega / model.omegaMax;
      zeroThrust[i] *= input.pitch;
      rotors.push({
        motor: i,
        omegaRadS: omega,
        rpm: (omega * 60) / (2 * Math.PI),
        qMotor: t.qMotor,
        qProp: t.qProp,
        qFriction: t.qFriction,
        qSpinUp: t.qNet,
        omegaDot: t.omegaDot,
        jacobian: t.jacobian,
        pitch: input.pitch,
        governorRate: governorRate(model, integral, omega),
        energyJ: 0.5 * model.inertia * omega * omega,
      });
    });
    const rotorAt = (i: number) => rotors.find((r) => r.motor === i);
    // Shaft torque on the airframe: −(Q_motor − Q_friction)·ŝ, i.e. the
    // propeller load plus the spin-up torque I·dΩ/dt (no separate reaction).
    const shaftReaction = (i: number, thrustAxis: Vec3) => {
      const r = rotorAt(i)!,
        axis = propellerSpinAxis(thrustAxis, this.aircraft.motors[i].spin)!;
      return scale(axis, -(r.qMotor - r.qFriction));
    };
    let force: Vec3 = [0, 0, 0],
      torque: Vec3 = [0, 0, 0];
    const surfaces: SurfaceForce[] = [];
    const apply = (f: Vec3, position: Vec3) => {
      force = add(force, f);
      torque = add(torque, cross(sub(position, this.properties.cg), f));
    };
    // Gyroscopic and P-factor moments of one propeller (zero unless the motor
    // defines spin plus I_p/max rpm or k_p).
    const propeller = (i: number, thrustAxis: Vec3, thrustN: number) => {
      const m = this.aircraft.motors[i];
      if (!m.spin || !(m.propInertiaKgM2 || m.pFactor)) return;
      const r = sub(m.positionM, this.properties.cg);
      const dynamic = rotorAt(i);
      const effects = propellerMoments(m, {
        thrustAxis,
        omegaBody: s.omega,
        rpmRatio: rpmRatio[i],
        thrustN,
        localFlow: add(flow, cross(s.omega, r)),
        ...(dynamic
          ? {
              spinRadS: dynamic.omegaRadS,
              inertiaKgM2: this.rotorModels[i]!.inertia,
            }
          : {}),
      });
      propellerGyro = add(propellerGyro, effects.gyro);
      pFactor = add(pFactor, effects.pFactor);
    };
    // Wings first: their lift sets the downwash seen by the tail.
    const order = this.aircraft.surfaces
      .map((_, i) => i)
      .sort(
        (i, j) =>
          Number(this.aircraft.surfaces[i].kind !== "wing") -
          Number(this.aircraft.surfaces[j].kind !== "wing"),
      );
    const records: SurfaceForce[] = [];
    let wingLift = 0,
      wingArea = 0,
      wingGround = 0;
    for (const surfaceIndex of order) {
      const wing = this.aircraft.surfaces[surfaceIndex];
      const r = sub(wing.positionM, this.properties.cg),
        v = add(flow, cross(s.omega, r));
      const downwash = downwashAngle(
        this.aircraft,
        wing,
        wingArea > 0 ? wingLift / wingArea : 0,
        wingArea > 0 ? wingGround / wingArea : 1,
      );
      // Downwash: air moving down at the tail lowers its angle of attack.
      if (downwash) v[2] -= downwash * Math.abs(v[0]);
      const orient = axisQ([1, 0, 0], radians(wing.rollDeg));
      const normal = rotate(orient, [0, 0, -1]),
        span = rotate(orient, [0, 1, 0]);
      // Tractor slipstream: raise the surface's mean axial dynamic pressure by
      // the span fraction inside each contracted actuator-disk slipstream.
      if (PHYSICS.slipstream.enabled) {
        const axial = Math.max(0, v[0]);
        let extra = 0,
          swirl: Vec3 = [0, 0, 0];
        for (let i = 0; i < this.aircraft.motors.length; i++) {
          const motor = this.aircraft.motors[i],
            dx = motor.positionM[0] - wing.positionM[0];
          if (!(dx > 0 && dx < 1.5)) continue;
          const radius = motor.propDiameterM / 2,
            thrust =
              staticThrust[i] *
              thrustSpeedFactor(flow[0], zeroThrust[i], rpmRatio[i]);
          const induced = diskInducedVelocity(thrust, axial, rho, radius);
          if (!(induced > 0)) continue;
          const slip = slipstreamAt(dx, induced, axial, radius);
          const offset = sub(motor.positionM, wing.positionM);
          const fraction = spanCoverage(
            dot(offset, span),
            dot(offset, normal),
            slip.radius,
            wing.spanM,
            this.slipstreamBlocked[surfaceIndex],
          );
          extra +=
            fraction *
            jetHeightFactor(slip.radius, wing.chordM) *
            ((axial + slip.increment) ** 2 - axial * axial);
          // Swirl: the slipstream turns with the propeller, so a surface off
          // the axis meets a tangential flow u = ω_s·ŝ × r_⊥ (left-turning
          // tendency on a fin above a CW propeller's axis).
          const sw = PHYSICS.swirl;
          // Dynamic-rotor motors only (their Q_prop is known), so 0.11.0
          // aircraft and recordings are unchanged. Tail surfaces only: over a
          // wing root the swirl is up on one side and down on the other, which
          // a single centre-point velocity cannot represent.
          const dyn = rotorAt(i);
          if (sw.enabled && dyn && fraction > 0 && wing.kind !== "wing") {
            const torqueQ = dyn.qProp;
            if (torqueQ > 0) {
              const rEff = sw.radiusFraction * radius,
                area = Math.PI * radius * radius;
              const rate =
                (sw.coefficient * torqueQ) /
                (rho *
                  area *
                  Math.max(axial + induced, sw.minInducedMps) *
                  rEff *
                  rEff);
              const d = sub(wing.positionM, motor.positionM);
              const across: Vec3 = [0, d[1], d[2]];
              const axisS = propellerSpinAxis([1, 0, 0], motor.spin)!;
              let u = scale(cross(axisS, across), rate);
              const cap = sw.maxSideFraction * (axial + slip.increment);
              if (length(u) > cap) u = scale(u, cap / length(u));
              swirl = add(swirl, scale(u, fraction));
            }
          }
        }
        if (extra > 0) v[0] = Math.sqrt(axial * axial + extra);
        if (swirl[1] || swirl[2]) {
          v[1] -= swirl[1];
          v[2] -= swirl[2];
        }
      }
      const planar = sub(v, scale(span, dot(v, span))),
        speed = length(planar),
        direction = unit(planar);
      const geometric = Math.atan2(-dot(planar, normal), planar[0]);
      const deflect = wing.control
        ? (s.surfaceCommands?.[surfaceIndex] ??
            surfaceCommand(wing.control, c)) *
          radians(this.actuations[surfaceIndex].maxDeg) *
          wing.control.effectiveness
        : 0;
      const alpha =
        geometric + radians(wing.incidenceDeg - wing.zeroLiftDeg) + deflect;
      const stall = radians(wing.stallDeg),
        blend = clamp((Math.abs(alpha) - stall) / radians(12), 0, 1);
      let cl =
        (1 - blend) * wing.liftSlope * alpha +
        blend * 1.1 * Math.sin(2 * alpha);
      let cd =
        wing.cd0 +
        (cl * cl) / (Math.PI * wing.aspectRatio * wing.efficiency) +
        blend * 1.3 * Math.sin(alpha) ** 2;
      // Past the stall the normal force's centre of pressure moves aft of c/4
      // towards mid-chord (flat-plate data), giving the nose-down stall break.
      const normalCoefficient = cl * Math.cos(alpha) + cd * Math.sin(alpha);
      let cm =
        (1 - blend) * wing.cm +
        blend * postStallMoment(normalCoefficient, alpha);
      const reynolds =
        (speed * wing.chordM) /
        (this.environment.kinematicViscosityM2S ?? STANDARD_AIR_VISCOSITY);
      const coefficients = surfacePolar(
        wing,
        ((geometric + radians(wing.incidenceDeg) + deflect) * 180) / Math.PI,
        reynolds,
        { cl, cd, cm },
      );
      ({ cl, cd, cm } = coefficients);
      // Wing-in-ground effect for roughly horizontal surfaces (image-vortex theory).
      let groundEffect = 1;
      if (wing.kind !== "vertical-tail" && Math.abs(wing.rollDeg) <= 45) {
        groundEffect = wingGroundEffect(
          -(s.position[2] + rotate(s.orientation, r)[2]),
          wing.spanM,
        );
        if (groundEffect < 1) {
          const attached = 1 - blend,
            k = Math.PI * wing.aspectRatio * wing.efficiency;
          const ratio =
            1 +
            (groundEffectLiftRatio(
              wing.liftSlope,
              wing.aspectRatio,
              wing.efficiency,
              groundEffect,
            ) -
              1) *
              attached;
          const clGround = cl * ratio;
          cd = Math.max(
            0,
            cd +
              (attached * (groundEffect * clGround * clGround - cl * cl)) / k,
          );
          cl = clGround;
        }
      }
      const pressure = 0.5 * rho * speed * speed * wing.spanM * wing.chordM;
      const liftDirection = unit(cross(span, direction)); // upward for forward flow; perpendicular to local airflow
      const f = add(
        scale(liftDirection, cl * pressure),
        scale(direction, -cd * pressure),
      );
      apply(f, wing.positionM);
      torque = add(torque, scale(span, cm * pressure * wing.chordM));
      if (wing.kind === "wing") {
        const area = wing.spanM * wing.chordM;
        wingLift += cl * area;
        wingArea += area;
        wingGround += groundEffect * area;
      }
      records[surfaceIndex] = {
        id: wing.id,
        kind: wing.kind,
        position: wing.positionM,
        force: f,
        alphaDeg: (alpha * 180) / Math.PI,
        reynolds,
        coefficientSource: coefficients.source,
        outsidePolarEnvelope: coefficients.outsideEnvelope,
        stalled: Math.abs(alpha) > stall,
        groundEffect,
        downwashDeg: (downwash * 180) / Math.PI,
      };
    }
    surfaces.push(...records);
    for (let i = 0; i < this.aircraft.motors.length; i++) {
      const m = this.aircraft.motors[i],
        speedFactor = thrustSpeedFactor(flow[0], zeroThrust[i], rpmRatio[i]);
      {
        const thrust = staticThrust[i] * speedFactor;
        // Down- and right-thrust tilt the thrust line, as on real airframes.
        const down = radians(m.downThrustDeg ?? 0),
          right = radians(m.rightThrustDeg ?? 0);
        const vector: Vec3 = [
          thrust * Math.cos(down) * Math.cos(right),
          thrust * Math.cos(down) * Math.sin(right),
          thrust * Math.sin(down),
        ];
        apply(vector, m.positionM);
        thrustForce = add(thrustForce, vector);
        const thrustAxis: Vec3 = [
          Math.cos(down) * Math.cos(right),
          Math.cos(down) * Math.sin(right),
          Math.sin(down),
        ];
        if (rotorAt(i)) torque = add(torque, shaftReaction(i, thrustAxis));
        else if (m.spin)
          torque[0] += thrust * m.torquePerThrustM * (m.spin === "cw" ? -1 : 1);
        propeller(i, thrustAxis, thrust);
      }
    }
    // Quadratic body drag, bounded so one explicit step cannot reverse the
    // air-relative velocity of a very light, draggy body.
    const limit = (v: number, f: number) => {
      const bound =
        (PHYSICS.maxDragVelocityFractionPerStep *
          this.properties.mass *
          Math.abs(v)) /
        PHYSICS.fixedDt;
      return Math.sign(f) * Math.min(Math.abs(f), bound);
    };
    const bodyDrag: Vec3 = this.aircraft.bodyDragAreaM2
      ? (flow.map((v, i) =>
          limit(
            v,
            -0.5 * rho * this.aircraft.bodyDragAreaM2![i] * Math.abs(v) * v,
          ),
        ) as Vec3)
      : (flow.map((v) =>
          limit(
            v,
            -0.5 * rho * length(flow) * this.aircraft.fuselageDragAreaM2 * v,
          ),
        ) as Vec3);
    force = add(force, bodyDrag);
    torque = add(add(torque, propellerGyro), pFactor);
    torque = add(
      torque,
      s.omega.map(
        (w, i) =>
          -w * this.aircraft.angularDamping[i] * (1 + length(flow) * 0.1),
      ) as Vec3,
    );
    const aero = surfaces.reduce<Vec3>((n, f) => add(n, f.force), [0, 0, 0]);
    return {
      force,
      torque,
      surfaces,
      airspeed: length(flow),
      thrust: thrustForce,
      aero,
      bodyDrag,
      density: rho,
      propellerGyro,
      pFactor,
      rotors,
    };
  }
  private acceleration(s: State, c: Controls) {
    const f = this.forces(s, c);
    return {
      velocity: add(
        scale(rotate(s.orientation, f.force), 1 / this.properties.mass),
        [0, 0, GRAVITY],
      ),
      omega: matVec(
        this.properties.inverseInertia,
        sub(f.torque, cross(s.omega, matVec(this.properties.inertia, s.omega))),
      ),
      rotors: f.rotors,
    };
  }
  private resolveGround(c: Controls, dt: number) {
    resolveGroundContacts(
      this.state,
      this.aircraft,
      this.properties,
      c,
      dt,
      this.surfaceLookup ?? this.environment.surface,
    );
  }
  step(raw: Controls, dt = FIXED_DT): State {
    if (!Number.isFinite(dt) || dt <= 0 || dt > PHYSICS.maxDt)
      throw new Error("Simulation timestep must be in (0, 1/30] seconds");
    if (this.state.status === "crashed" || this.state.status === "landed")
      return this.state;
    const c = cleanControls(raw),
      s = this.state;
    // ACRO: the flight controller turns stick rate commands into channels.
    if (c.fcMode === "acro" && this.controlPower) {
      const air = rotate(
        inverseQ(s.orientation),
        sub(s.velocity, this.airVelocity(s)),
      );
      const out = acroStep(
        [c.roll, c.pitch, c.yaw],
        s.omega,
        length(air),
        {
          integral: s.fcIntegral ?? [0, 0, 0],
          attitude: s.fcAttitude ?? [0, 0, 0],
        },
        this.controlPower,
        dt,
        s.status === "grounded",
      );
      [c.roll, c.pitch, c.yaw] = out.channels;
      s.fcIntegral = out.state.integral;
      s.fcAttitude = out.state.attitude;
    }
    if (c.gust)
      this.gusts.trigger(
        s.time,
        this.environment.discreteGusts?.amplitudeMps ??
          PHYSICS.gust.amplitudeMps,
      );
    this.gusts.advance(s.time, dt, this.environment.discreteGusts);
    if (this.turbulence) {
      const height = -s.position[2];
      this.turbulence.advance(
        dt,
        length(sub(s.velocity, windAt(s.time, this.environment, height))),
        height,
        this.environment.windMps,
        this.environment.windProfile,
      );
    }
    // Actuators advance over the step; the integrator samples them at the
    // matching instants (start for k1, midpoint average for k2) so actuator
    // dynamics keep the scheme second order instead of leading by dt/2.
    const startMotors = [...s.motors],
      startCommands = s.surfaceCommands ? [...s.surfaceCommands] : undefined;
    s.motors = s.motors.map((v, i) => {
      const m = this.aircraft.motors[i];
      const target = clamp(c.throttle * (1 + c.yaw * m.yawMix * 0.45), 0, 1);
      return v + (target - v) * (1 - Math.exp(-dt / m.responseSeconds));
    });
    if (
      this.aircraft.surfaces.some(
        (w) =>
          w.control?.responseSeconds ||
          w.control?.rateLimitDegS ||
          w.control?.linkage,
      )
    ) {
      s.surfaceCommands = this.aircraft.surfaces.map((w, i) => {
        if (!w.control) return 0;
        const target = surfaceCommand(w.control, c),
          previous = s.surfaceCommands?.[i] ?? 0;
        return advanceSurfaceCommand(previous, target, this.actuations[i], dt);
      });
    }
    const average = (a: number[], b: number[]) =>
      a.map((v, i) => (v + b[i]) / 2);
    const hasStartCommands =
      startCommands !== undefined &&
      s.surfaceCommands !== undefined &&
      startCommands.length === s.surfaceCommands.length;
    const k1 = this.acceleration(
      {
        ...s,
        motors: startMotors,
        surfaceCommands: hasStartCommands ? startCommands : s.surfaceCommands,
      },
      c,
    );
    // Shaft speed: linearly implicit half step to the midpoint, so k2 reads Ω
    // at t + dt/2 (as the airframe and actuators do).
    const rotorMid = s.rotorRadS?.map((w, i) => {
      const r = k1.rotors.find((x) => x.motor === i),
        model = this.rotorModels[i];
      return r && model
        ? rotorHalfStep(model, w, r.omegaDot, r.jacobian, dt)
        : w;
    });
    const pitchMid = s.rotorPitch?.map(
      (g, i) =>
        g +
        (dt / 2) * (k1.rotors.find((x) => x.motor === i)?.governorRate ?? 0),
    );
    const mid: State = {
      ...s,
      ...(rotorMid ? { rotorRadS: rotorMid } : {}),
      ...(pitchMid ? { rotorPitch: pitchMid } : {}),
      motors: average(startMotors, s.motors),
      surfaceCommands: hasStartCommands
        ? average(startCommands!, s.surfaceCommands!)
        : s.surfaceCommands,
      time: s.time + dt / 2,
      position: add(s.position, scale(s.velocity, dt / 2)),
      velocity: add(s.velocity, scale(k1.velocity, dt / 2)),
      omega: add(s.omega, scale(k1.omega, dt / 2)),
      orientation: advanceQ(s.orientation, s.omega, dt / 2),
    };
    const k2 = this.acceleration(mid, c);
    const power = powertrain(
      this.aircraft,
      mid.motors,
      mid.batterySoc,
      densityAt(this.environment, -mid.position[2]),
    );
    this.state = {
      ...s,
      time: s.time + dt,
      ...(this.aircraft.battery
        ? {
            batterySoc: clamp(
              (s.batterySoc ?? this.aircraft.battery.initialSoc) -
                (power.current * dt) /
                  (this.aircraft.battery.capacityMah * 3.6),
              0,
              1,
            ),
          }
        : {}),
      position: add(s.position, scale(mid.velocity, dt)),
      velocity: add(s.velocity, scale(k2.velocity, dt)),
      omega: add(s.omega, scale(k2.omega, dt)),
      orientation: advanceQ(s.orientation, mid.omega, dt),
      // Linearly implicit midpoint for Ω: second order, cannot blow up for a
      // very light propeller, and stays within [0, redline].
      ...(s.rotorRadS
        ? {
            rotorRadS: s.rotorRadS.map((w, i) => {
              const r = k2.rotors.find((x) => x.motor === i),
                model = this.rotorModels[i];
              return r && model
                ? advanceRotorSpeed(
                    model,
                    w,
                    rotorMid![i],
                    r.omegaDot,
                    r.jacobian,
                    dt,
                  )
                : w;
            }),
          }
        : {}),
      ...(s.rotorPitch
        ? {
            rotorPitch: s.rotorPitch.map(
              (g, i) =>
                g +
                dt * (k2.rotors.find((x) => x.motor === i)?.governorRate ?? 0),
            ),
          }
        : {}),
    };
    if (
      ![
        ...this.state.position,
        ...this.state.velocity,
        ...this.state.omega,
        ...this.state.orientation,
      ].every(Number.isFinite)
    )
      throw new Error(
        "Non-finite flight state: inspect aircraft coefficients or reduce timestep",
      );
    if (
      !this.collisions.resolve(s, this.state, this.environment.obstacles ?? [])
    ) {
      const before = { v: this.state.velocity, w: this.state.omega };
      this.resolveGround(c, dt);
      // The midpoint position update used the pre-contact velocity. Contact
      // impulses act over the step, so apply half their velocity change to the
      // pose as well: a body held by static friction then stays exactly put
      // instead of creeping ½·a·dt² per step.
      if (this.state.status === "grounded") {
        const dv = sub(this.state.velocity, before.v),
          dw = sub(this.state.omega, before.w);
        this.state.position = add(this.state.position, scale(dv, dt / 2));
        if (length(dw) > 0)
          this.state.orientation = advanceQ(this.state.orientation, dw, dt / 2);
      }
    }
    this.lastForces = this.forces(this.state, c);
    return this.state;
  }
}
