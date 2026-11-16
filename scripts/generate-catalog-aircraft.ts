/**
 * Generate catalog aircraft from compact, sourced specifications.
 *
 * Every number either comes from a cited listing (span, area, mass, CG,
 * motor/prop/battery choice) or from a documented engineering rule:
 *
 * - Tail sizing from volume coefficients: S_h = V_h·S·c / l_t, S_v = V_v·S·b / l_t.
 * - Finite-wing lift slope a = 2π / (1 + 2/(e·AR)).
 * - Motor/propeller bench curve from a first-order DC motor (kV, R_m, I_0)
 *   driving a propeller with static coefficients C_T, C_P (UIUC-typical
 *   values for the pitch/diameter ratio): Kt·(I − I_0) = C_P·ρ·n²·D⁵ / 2π,
 *   with I = (d·V − 2πn/Kv)/R. Thrust T = C_T·ρ·n²·D⁴; battery current d·I.
 * - Battery placed to reach the target CG; structure fills the published mass.
 *
 * Output is deterministic. Usage: npx tsx scripts/generate-catalog-aircraft.ts
 */
import { writeFileSync } from "node:fs";
import { parseAircraft } from "../src/core/schema";
import { massProperties } from "../src/core/aircraft";
import { calmEnvironment, Simulation } from "../src/core/simulation";
import { findTrim } from "../src/core/trim";

type V3 = [number, number, number];
const r = (n: number, d = 4) => Number(n.toFixed(d));
const v = (a: number[]) => a.map((n) => r(n)) as V3;

interface Motor {
  model: string;
  kv: number;
  /** Winding + ESC resistance, Ω (estimated, typical for the size). */
  resistanceOhm: number;
  noLoadA: number;
  massKg: number;
  propDiameterM: number;
  propPitchM: number;
  propName: string;
  propMassKg: number;
  escModel: string;
  escMassKg: number;
  pusher?: boolean;
}
interface Spec {
  id: string;
  name: string;
  description: string;
  credit: { name: string; url: string };
  sources: Record<string, { note: string; url?: string }>;
  spanM: number;
  wingAreaM2: number;
  lengthM: number;
  massKg: number;
  battery: {
    cells: number;
    mah: number;
    massKg: number;
    resistanceOhm: number;
  };
  motor: Motor;
  /** Fraction of mean chord behind the leading edge, or absolute metres. */
  cg: { fraction?: number; fromLeadingEdgeM?: number; sourced: boolean };
  wing: {
    position: "high" | "mid" | "low";
    dihedralDeg: number;
    /** Optional outer panel from this semi-span fraction with its own dihedral. */
    polyhedral?: { at: number; dihedralDeg: number };
    incidenceDeg: number;
    zeroLiftDeg: number;
    cd0: number;
    efficiency: number;
    cm: number;
    stallDeg: number;
    ailerons?: { maxDeg: number };
    sweepOffsetM?: number;
  };
  tail:
    | {
        kind: "conventional";
        volumeH: number;
        volumeV: number;
        /** Wing quarter-chord to tail quarter-chord, metres. */
        armM: number;
        aspectH: number;
        aspectV: number;
        elevatorMaxDeg: number;
        rudderMaxDeg: number;
        rudder: boolean;
      }
    | {
        kind: "elevons";
        /** Elevon panels at the trailing edge: span fraction and chord. */
        elevonSpanM: number;
        elevonChordM: number;
        elevonArmM: number;
        maxDeg: number;
        finHeightM: number;
        finChordM: number;
      };
  gear: "taildragger" | "tricycle" | "none";
  /** Visual-only detail; canopy x is relative to the root leading edge. */
  visual: {
    fuselage: "box" | "rounded" | "round";
    finish: "foam" | "gloss";
    wing: Record<string, unknown>;
    tail: Record<string, unknown>;
    canopy?: {
      relXM: number;
      lengthM: number;
      heightM: number;
      widthM: number;
    };
    spinner?: boolean;
    markings?: string;
    camouflage?: boolean;
    underside?: string;
  };
  body: {
    widthM: number;
    heightM: number;
    boom?: { widthM: number };
    /** Nose station ahead of the wing leading edge as a fraction of length. */
    noseFraction?: number;
    /** Optional fuselage sections (fractions of length/width/height). */
    loft?: { x: number; width: number; top: number; bottom: number }[];
  };
  color: string;
  accent: string;
  trimSpeedMps: number;
  structure: { wing: number; body: number; tail: number; gear: number };
  servoCount: number;
  servoMassKg: number;
}

const RHO = 1.225;
/** Static C_T and C_P versus pitch/diameter (UIUC APC/slow-fly range). */
const propCoefficients = (pd: number) => ({
  ct: 0.1 + 0.03 * pd,
  cp: 0.025 + 0.04 * pd,
});

/** Solve motor speed where motor torque equals propeller torque. */
function benchPoint(m: Motor, supplyV: number, duty: number) {
  if (duty <= 0) return { thrustN: 0, currentA: 0, rps: 0 };
  const { ct, cp } = propCoefficients(m.propPitchM / m.propDiameterM);
  const kvRad = (m.kv * 2 * Math.PI) / 60,
    kt = 1 / kvRad,
    d = m.propDiameterM;
  const residual = (n: number) => {
    const omega = 2 * Math.PI * n;
    const current = (duty * supplyV - omega / kvRad) / m.resistanceOhm;
    const motorTorque = kt * (current - m.noLoadA);
    const propTorque = (cp * RHO * n * n * d ** 5) / (2 * Math.PI);
    return motorTorque - propTorque;
  };
  let lo = 0,
    hi = (duty * supplyV * kvRad) / (2 * Math.PI);
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (residual(mid) > 0) lo = mid;
    else hi = mid;
  }
  const n = (lo + hi) / 2,
    current = (duty * supplyV - (2 * Math.PI * n) / kvRad) / m.resistanceOhm;
  return {
    thrustN: ct * RHO * n * n * d ** 4,
    currentA: Math.max(0, current) * duty,
    rps: n,
  };
}

function build(spec: Spec) {
  const b = spec.spanM,
    S = spec.wingAreaM2,
    c = S / b,
    semi = b / 2;
  const AR = (b * b) / S;
  const slope = (ar: number, e: number) => (2 * Math.PI) / (1 + 2 / (e * ar));
  const { widthM: bw, heightM: bh } = spec.body;
  // Datum: wing quarter chord at x = 0; fuselage reference line at z = 0.
  const wingZ =
    spec.wing.position === "high"
      ? -bh / 2 - 0.006
      : spec.wing.position === "low"
        ? bh / 2 - 0.01
        : 0;
  // Root leading edge; a swept wing's mean-chord leading edge is further aft.
  const rootLeadingX = 0.25 * c + (spec.wing.sweepOffsetM ?? 0);
  const leadingX = 0.25 * c - (spec.wing.sweepOffsetM ?? 0) / 2;
  const noseX =
    rootLeadingX +
    spec.lengthM *
      (spec.body.noseFraction ?? (spec.tail.kind === "elevons" ? 0.18 : 0.28));
  const motorX = spec.motor.pusher ? leadingX - c - 0.03 : noseX + 0.02;
  const tailX =
    spec.tail.kind === "conventional" ? -spec.tail.armM : -spec.tail.elevonArmM;
  const tailEnd = Math.min(tailX - 0.08, noseX - spec.lengthM);
  const parts: Record<string, unknown>[] = [];
  const surfaces: Record<string, unknown>[] = [];
  const foam = { name: "Foam airframe", finish: "foam" as const };

  // Wing surfaces and wing structure mass.
  const panels: {
    side: number;
    y: number;
    z: number;
    span: number;
    roll: number;
    id: string;
  }[] = [];
  for (const side of [-1, 1]) {
    const tag = side < 0 ? "left" : "right";
    if (spec.wing.polyhedral) {
      const inner = semi * spec.wing.polyhedral.at,
        outer = semi - inner;
      const d1 = (spec.wing.dihedralDeg * Math.PI) / 180,
        d2 = (spec.wing.polyhedral.dihedralDeg * Math.PI) / 180;
      panels.push({
        side,
        id: `${tag}-inner-wing`,
        span: inner,
        roll: -side * spec.wing.dihedralDeg,
        y: side * (inner / 2) * Math.cos(d1),
        z: wingZ - (inner / 2) * Math.sin(d1),
      });
      const yBreak = inner * Math.cos(d1),
        zBreak = wingZ - inner * Math.sin(d1);
      panels.push({
        side,
        id: `${tag}-outer-wing`,
        span: outer,
        roll: -side * spec.wing.polyhedral.dihedralDeg,
        y: side * (yBreak + (outer / 2) * Math.cos(d2)),
        z: zBreak - (outer / 2) * Math.sin(d2),
      });
    } else {
      const d = (spec.wing.dihedralDeg * Math.PI) / 180;
      panels.push({
        side,
        id: `${tag}-wing`,
        span: semi,
        roll: -side * spec.wing.dihedralDeg,
        y: side * (semi / 2) * Math.cos(d),
        z: wingZ - (semi / 2) * Math.sin(d),
      });
    }
  }
  const servos: { id: string; at: V3 }[] = [];
  for (const p of panels) {
    const outerPanel = p.id.includes("outer") || !spec.wing.polyhedral;
    const aileron = spec.wing.ailerons && outerPanel;
    if (aileron)
      servos.push({ id: `servo-${p.id}`, at: [-0.05 * c, p.y * 0.6, p.z] });
    surfaces.push({
      id: p.id,
      kind: "wing",
      positionM: v([
        (-(spec.wing.sweepOffsetM ?? 0) * Math.abs(p.y)) / semi,
        p.y,
        p.z,
      ]),
      spanM: r(p.span),
      chordM: r(c),
      aspectRatio: r(AR),
      rollDeg: p.roll,
      incidenceDeg: spec.wing.incidenceDeg,
      liftSlope: r(slope(AR, spec.wing.efficiency)),
      zeroLiftDeg: spec.wing.zeroLiftDeg,
      stallDeg: spec.wing.stallDeg,
      cd0: spec.wing.cd0,
      efficiency: spec.wing.efficiency,
      cm: spec.wing.cm,
      ...(aileron
        ? {
            control: {
              axis: "roll",
              gain: p.side < 0 ? 1 : -1,
              maxDeg: spec.wing.ailerons!.maxDeg,
              effectiveness: 0.45,
              responseSeconds: 0.06,
              linkage: {
                servoPartId: `servo-${p.id}`,
                servoTravelDeg: 45,
                servoArmM: 0.01,
                surfaceArmM: 0.015,
              },
            },
          }
        : {}),
    });
    parts.push({
      id: `${p.id}-structure`,
      kind: "wing",
      massKg: 0,
      positionM: v([
        (-(spec.wing.sweepOffsetM ?? 0) * Math.abs(p.y)) / semi - 0.15 * c,
        p.y,
        p.z,
      ]),
      sizeM: v([c, p.span, Math.max(0.012, 0.1 * c)]),
      color: spec.color,
      orientationDeg: [p.roll, spec.wing.incidenceDeg, 0],
      material: foam,
    });
  }
  const wingParts = parts.filter((p) => p.kind === "wing");

  // Tail.
  let tailParts: Record<string, unknown>[] = [];
  if (spec.tail.kind === "conventional") {
    const t = spec.tail;
    const sh = (t.volumeH * S * c) / t.armM,
      sv = (t.volumeV * S * b) / t.armM;
    const bhSpan = Math.sqrt(sh * t.aspectH),
      ch = sh / bhSpan,
      bvSpan = Math.sqrt(sv * t.aspectV),
      cv = sv / bvSpan;
    const tailZ = spec.wing.position === "low" ? -0.01 : -0.005;
    servos.push({ id: "servo-elevator", at: [0.02 * c, -0.012, 0] });
    surfaces.push({
      id: "elevator",
      kind: "horizontal-tail",
      positionM: v([tailX, 0, tailZ]),
      spanM: r(bhSpan),
      chordM: r(ch),
      aspectRatio: r(t.aspectH),
      rollDeg: 0,
      incidenceDeg: 0,
      liftSlope: r(slope(t.aspectH, 0.78)),
      zeroLiftDeg: 0,
      stallDeg: 16,
      cd0: 0.025,
      efficiency: 0.78,
      cm: 0,
      control: {
        axis: "pitch",
        gain: -1,
        maxDeg: t.elevatorMaxDeg,
        effectiveness: 0.55,
        responseSeconds: 0.06,
        linkage: {
          servoPartId: "servo-elevator",
          servoTravelDeg: 45,
          servoArmM: 0.01,
          surfaceArmM: 0.015,
        },
      },
    });
    if (t.rudder) servos.push({ id: "servo-rudder", at: [0.02 * c, 0.012, 0] });
    surfaces.push({
      id: "fin",
      kind: "vertical-tail",
      positionM: v([tailX - 0.02, 0, tailZ - bvSpan / 2]),
      spanM: r(bvSpan),
      chordM: r(cv),
      aspectRatio: r(t.aspectV),
      rollDeg: 90,
      incidenceDeg: 0,
      liftSlope: r(slope(t.aspectV, 0.78)),
      zeroLiftDeg: 0,
      stallDeg: 16,
      cd0: 0.025,
      efficiency: 0.78,
      cm: 0,
      ...(t.rudder
        ? {
            control: {
              axis: "yaw",
              gain: -1,
              maxDeg: t.rudderMaxDeg,
              effectiveness: 0.55,
              responseSeconds: 0.06,
              linkage: {
                servoPartId: "servo-rudder",
                servoTravelDeg: 45,
                servoArmM: 0.01,
                surfaceArmM: 0.015,
              },
            },
          }
        : {}),
    });
    tailParts = [
      {
        id: "stabilizer",
        kind: "tail",
        massKg: 0,
        positionM: v([tailX - 0.25 * ch, 0, tailZ]),
        sizeM: v([ch, bhSpan, 0.005]),
        color: spec.color,
        material: foam,
      },
      {
        id: "fin-structure",
        kind: "tail",
        massKg: 0,
        positionM: v([tailX - 0.02 - 0.25 * cv, 0, tailZ - bvSpan / 2]),
        sizeM: v([cv, 0.005, bvSpan]),
        color: spec.accent,
        material: foam,
      },
    ];
  } else {
    const t = spec.tail;
    for (const side of [-1, 1]) {
      const tag = side < 0 ? "left" : "right";
      servos.push({ id: `servo-${tag}-elevon`, at: [-0.3 * c, side * 0.1, 0] });
      surfaces.push({
        id: `${tag}-elevon`,
        kind: "horizontal-tail",
        positionM: v([
          -t.elevonArmM,
          side * (semi - t.elevonSpanM / 2 - 0.02),
          wingZ,
        ]),
        spanM: r(t.elevonSpanM),
        chordM: r(t.elevonChordM),
        aspectRatio: r(t.elevonSpanM / t.elevonChordM),
        rollDeg: 0,
        incidenceDeg: 0,
        liftSlope: r(slope(t.elevonSpanM / t.elevonChordM, 0.75)),
        zeroLiftDeg: 0,
        stallDeg: 16,
        cd0: 0.02,
        efficiency: 0.75,
        cm: 0,
        control: {
          axis: "pitch",
          gain: -1,
          mix: { roll: side < 0 ? 1 : -1 },
          maxDeg: t.maxDeg,
          effectiveness: 0.6,
          responseSeconds: 0.06,
          linkage: {
            servoPartId: `servo-${tag}-elevon`,
            servoTravelDeg: 50,
            servoArmM: 0.01,
            surfaceArmM: 0.0125,
          },
        },
      });
      surfaces.push({
        id: `${tag}-fin`,
        kind: "vertical-tail",
        positionM: v([
          -t.elevonArmM - 0.02,
          side * (semi - 0.01),
          wingZ - t.finHeightM / 2,
        ]),
        spanM: r(t.finHeightM),
        chordM: r(t.finChordM),
        aspectRatio: r(t.finHeightM / t.finChordM),
        rollDeg: side * 90,
        incidenceDeg: 0,
        liftSlope: r(slope(t.finHeightM / t.finChordM, 0.75)),
        zeroLiftDeg: 0,
        stallDeg: 16,
        cd0: 0.02,
        efficiency: 0.75,
        cm: 0,
      });
      tailParts.push({
        id: `${tag}-fin-structure`,
        kind: "tail",
        massKg: 0,
        positionM: v([
          -t.elevonArmM - 0.02,
          side * (semi - 0.01),
          wingZ - t.finHeightM / 2,
        ]),
        sizeM: v([t.finChordM, 0.004, t.finHeightM]),
        color: spec.accent,
        material: foam,
      });
    }
  }

  // Fuselage (pod + optional boom).
  const bodyLength = noseX - tailEnd;
  const loft = spec.body.loft ?? [
    { x: -0.5, width: 0.3, top: -0.25, bottom: 0.2 },
    { x: -0.15, width: 0.7, top: -0.4, bottom: 0.35 },
    { x: 0.2, width: 1, top: -0.5, bottom: 0.5 },
    { x: 0.42, width: 0.95, top: -0.45, bottom: 0.48 },
    { x: 0.5, width: 0.75, top: -0.3, bottom: 0.38 },
  ];
  const bodyParts: Record<string, unknown>[] = spec.body.boom
    ? [
        {
          id: "pod",
          kind: "body",
          massKg: 0,
          positionM: v([noseX - spec.lengthM * 0.2, 0, 0]),
          sizeM: v([spec.lengthM * 0.4, bw, bh]),
          color: spec.color,
          material: foam,
          bodyLoft: loft,
        },
        {
          id: "tail-boom",
          kind: "boom",
          massKg: 0,
          positionM: v([
            (noseX - spec.lengthM * 0.35 + tailEnd) / 2,
            0,
            -bh * 0.15,
          ]),
          sizeM: v([
            noseX - spec.lengthM * 0.35 - tailEnd,
            spec.body.boom.widthM,
            spec.body.boom.widthM,
          ]),
          color: spec.accent,
          material: { name: "Carbon tube", finish: "carbon" },
        },
      ]
    : [
        {
          id: "fuselage",
          kind: "body",
          massKg: 0,
          positionM: v([(noseX + tailEnd) / 2, 0, 0]),
          sizeM: v([bodyLength, bw, bh]),
          color: spec.color,
          material: foam,
          bodyLoft: loft,
        },
      ];

  // Equipment.
  const m = spec.motor;
  const equipment: Record<string, unknown>[] = [
    {
      id: "motor",
      kind: "motor",
      massKg: m.massKg,
      positionM: v([motorX - (m.pusher ? -0.02 : 0.02), 0, 0]),
      sizeM: v([0.03, 0.028, 0.028]),
      color: "#c64222",
      model: m.model,
    },
    {
      id: "propeller",
      kind: "equipment",
      massKg: m.propMassKg,
      positionM: v([motorX, 0, 0]),
      sizeM: v([0.012, m.propDiameterM, 0.02]),
      color: "#2b2d30",
      model: m.propName,
      material: { name: "Molded propeller", finish: "plastic" },
    },
    {
      id: "esc",
      kind: "equipment",
      massKg: m.escMassKg,
      positionM: v([m.pusher ? leadingX - 0.6 * c : noseX - 0.08, 0, bh * 0.2]),
      sizeM: v([0.045, 0.025, 0.01]),
      color: "#292d31",
      model: m.escModel,
    },
    {
      id: "receiver",
      kind: "equipment",
      massKg: 0.008,
      positionM: v([0.05 * c, 0, bh * 0.25]),
      sizeM: v([0.027, 0.018, 0.009]),
      color: "#292d31",
      model: "Receiver (mass estimated)",
    },
    ...servos.map((s) => ({
      id: s.id,
      kind: "equipment",
      massKg: spec.servoMassKg,
      positionM: v(s.at),
      sizeM: v([0.023, 0.012, 0.024]),
      color: "#30486d",
      model: `${Math.round(spec.servoMassKg * 1000)} g positional servo (speed estimated)`,
      servo: { speedSecondsPer60Deg: 0.12, travelDeg: 150, ratedVoltage: 4.8 },
      material: { name: "Plastic servo housing", finish: "plastic" },
    })),
  ];
  // Gear geometry: main wheels ahead of the CG for taildraggers, behind it for tricycles.
  const contactPoints: Record<string, unknown>[] = [];
  const wheelR = Math.max(0.025, Math.min(0.04, spec.spanM * 0.022));
  const propR = m.propDiameterM / 2;
  const gearHeight =
    spec.gear === "none" ? 0 : Math.max(bh / 2 + 0.06, propR + wheelR * 0.4);
  if (spec.gear !== "none")
    equipment.push({
      id: "landing-gear",
      kind: "equipment",
      massKg: 0,
      positionM: v([
        spec.gear === "taildragger" ? 0.3 * c : -0.1 * c,
        0,
        bh / 2 + gearHeight / 2,
      ]),
      sizeM: v([0.05, spec.spanM * 0.2, gearHeight]),
      color: "#c9ccc5",
      model: "Landing gear (mass allocated)",
    });

  // Structure masses fill the published mass after equipment and battery.
  const fixed =
    equipment.reduce((n, p) => n + (p.massKg as number), 0) +
    spec.battery.massKg;
  const structure = spec.massKg - fixed;
  if (structure <= 0)
    throw Error(`${spec.id}: equipment exceeds published mass`);
  const st = spec.structure,
    total = st.wing + st.body + st.tail + st.gear;
  const share = (k: keyof Spec["structure"]) => (structure * st[k]) / total;
  wingParts.forEach((p) => (p.massKg = r(share("wing") / wingParts.length, 5)));
  bodyParts.forEach(
    (p, i) =>
      (p.massKg = r(
        share("body") * (bodyParts.length > 1 ? (i ? 0.3 : 0.7) : 1),
        5,
      )),
  );
  tailParts.forEach((p) => (p.massKg = r(share("tail") / tailParts.length, 5)));
  const gearPart = equipment.find((p) => p.id === "landing-gear");
  if (gearPart) gearPart.massKg = r(share("gear"), 5);
  else
    bodyParts[0].massKg = r((bodyParts[0].massKg as number) + share("gear"), 5);

  // Battery station from the target CG.
  const cgFromLE = spec.cg.fromLeadingEdgeM ?? (spec.cg.fraction ?? 0.28) * c;
  const cgX = leadingX - cgFromLE;
  const others = [...wingParts, ...tailParts, ...bodyParts, ...equipment];
  const moment = others.reduce(
    (n, p) => n + (p.massKg as number) * (p.positionM as V3)[0],
    0,
  );
  const mass = others.reduce((n, p) => n + (p.massKg as number), 0);
  const batteryX =
    (cgX * (mass + spec.battery.massKg) - moment) / spec.battery.massKg;
  if (batteryX > noseX - 0.03 || batteryX < tailEnd + 0.05)
    throw Error(
      `${spec.id}: battery station ${batteryX.toFixed(3)} outside fuselage`,
    );
  const batteryPart = {
    id: "battery",
    kind: "battery",
    massKg: spec.battery.massKg,
    positionM: v([batteryX, 0, bh * 0.15]),
    sizeM: v([0.1, 0.034, 0.024]),
    color: "#b79d4f",
    model: `${spec.battery.cells}S ${spec.battery.mah} mAh LiPo (mass estimated)`,
    material: { name: "LiPo pouch pack", finish: "plastic" },
  };

  if (spec.gear === "taildragger") {
    const mainX = cgX + 0.22 * c,
      mainZ = bh / 2 + gearHeight;
    for (const side of [-1, 1])
      contactPoints.push({
        id: side < 0 ? "left-wheel" : "right-wheel",
        kind: "wheel",
        positionM: v([mainX, side * Math.max(0.08, spec.spanM * 0.1), mainZ]),
        strutAnchorM: v([mainX - 0.01, 0, bh / 2]),
        spanLinked: false,
        wheelRadiusM: r(wheelR),
      });
    contactPoints.push({
      id: "tail-wheel",
      kind: "skid",
      positionM: v([tailEnd + 0.03, 0, bh * 0.35]),
      strutAnchorM: v([tailEnd + 0.05, 0, bh * 0.2]),
      spanLinked: false,
    });
  } else if (spec.gear === "tricycle") {
    const mainX = cgX - 0.18 * c,
      z = bh / 2 + gearHeight;
    for (const side of [-1, 1])
      contactPoints.push({
        id: side < 0 ? "left-wheel" : "right-wheel",
        kind: "wheel",
        positionM: v([mainX, side * spec.spanM * 0.09, z]),
        strutAnchorM: v([mainX + 0.01, 0, bh / 2]),
        spanLinked: false,
        wheelRadiusM: r(wheelR),
      });
    contactPoints.push({
      id: "nose-wheel",
      kind: "wheel",
      steering: true,
      positionM: v([noseX - 0.06, 0, z]),
      strutAnchorM: v([noseX - 0.05, 0, bh / 2]),
      spanLinked: false,
      wheelRadiusM: r(wheelR * 0.85),
    });
  } else {
    contactPoints.push({
      id: "belly-front",
      positionM: v([noseX - 0.08, 0, bh / 2]),
      spanLinked: false,
    });
    contactPoints.push({
      id: "belly-rear",
      positionM: v([cgX - 0.25 * c, 0, bh / 2]),
      spanLinked: false,
    });
  }
  contactPoints.push(
    { id: "nose", positionM: v([noseX, 0, bh * 0.3]), spanLinked: false },
    { id: "prop-tip", positionM: v([motorX, 0, propR]), spanLinked: false },
    { id: "tail-tip", positionM: v([tailEnd, 0, 0]), spanLinked: false },
  );
  const tip = panels.filter((p) => p.side > 0).at(-1)!;
  const tipZ =
    tip.z - (tip.span / 2) * Math.sin((Math.abs(tip.roll) * Math.PI) / 180);
  for (const side of [-1, 1])
    contactPoints.push({
      id: side < 0 ? "left-wingtip" : "right-wingtip",
      positionM: v([0, side * semi, tipZ]),
      spanLinked: true,
    });

  // Bench curve at nominal pack voltage (powertrain scales with terminal voltage²).
  const nominal = 3.7 * spec.battery.cells;
  const bench = [0, 0.1, 0.25, 0.5, 0.75, 1].map((duty) => ({
    duty,
    ...benchPoint(m, nominal, duty),
  }));
  const full = bench.at(-1)!;
  const zeroThrust = full.rps * m.propPitchM;

  const area = bw * bh;
  const a = {
    schemaVersion: 1,
    id: spec.id,
    name: spec.name,
    description: spec.description,
    credit: spec.credit,
    visual: (() => {
      const { canopy, ...rest } = spec.visual;
      return {
        ...rest,
        ...(canopy
          ? {
              canopy: {
                xM: r(rootLeadingX + canopy.relXM),
                lengthM: canopy.lengthM,
                heightM: canopy.heightM,
                widthM: canopy.widthM,
              },
            }
          : {}),
      };
    })(),
    livery: {
      body: spec.color,
      wing: spec.color,
      tail: spec.color,
      accent: spec.accent,
    },
    provenance: {
      ...Object.fromEntries(
        Object.entries(spec.sources).map(([k, s]) => [
          k,
          { status: "sourced", ...s },
        ]),
      ),
      geometry: {
        status: "estimated",
        note: `Generated by scripts/generate-catalog-aircraft.ts from the sourced span, wing area and length. Rectangular-equivalent panels use the ${r(c, 3)} m mean chord; fuselage sections, wing position, incidence ${spec.wing.incidenceDeg}° and dihedral are estimates, not traced plans.`,
      },
      tail:
        spec.tail.kind === "conventional"
          ? {
              status: "calculated",
              note: `Tail areas from volume coefficients V_h ${spec.tail.volumeH} and V_v ${spec.tail.volumeV} at a ${spec.tail.armM} m arm (typical sport/trainer values), not measured outlines.`,
            }
          : {
              status: "estimated",
              note: "Elevon and fin sizes estimated from typical flying-wing proportions; sweep is represented by the elevon moment arm.",
            },
      massLedger: {
        status: "estimated",
        note: `Total ${Math.round(spec.massKg * 1000)} g from the cited listing. Motor, ESC, servos, receiver and battery masses are typical values for the listed parts; structure fills the remainder by fixed fractions. Battery station is solved for the CG.`,
      },
      balance: {
        status: spec.cg.sourced ? "sourced" : "estimated",
        note: spec.cg.sourced
          ? `CG ${Math.round(cgFromLE * 1000)} mm behind the wing leading edge, as listed.`
          : `CG assumed at ${Math.round((cgFromLE / c) * 100)}% of the mean chord; confirm against the kit's marked CG.`,
      },
      aerodynamics: {
        status: "estimated",
        note: `Lift slope 2π/(1+2/(e·AR)), e ${spec.wing.efficiency}, zero-lift ${spec.wing.zeroLiftDeg}°, stall ${spec.wing.stallDeg}°, CD0 ${spec.wing.cd0}, CM ${spec.wing.cm}. No measured polar or flight calibration.`,
      },
      powertrain: {
        status: "calculated",
        note: `Bench curve from a first-order DC motor model (${m.kv} KV, ${m.resistanceOhm} Ω, ${m.noLoadA} A no-load; estimated) driving a ${m.propName} with static C_T/C_P typical of UIUC propeller data, at ${nominal.toFixed(1)} V nominal. Full command: ${full.thrustN.toFixed(2)} N, ${full.currentA.toFixed(1)} A, ${Math.round(full.rps * 60)} rpm. Zero-thrust speed = pitch × full-command rpm. Not a thrust-stand measurement.`,
      },
      operatingPoint: {
        status: "estimated",
        note: `Airborne trim ${spec.trimSpeedMps} m/s chosen at about 1.5× the analytical stall estimate.`,
      },
    },
    parts: [
      ...bodyParts,
      ...wingParts,
      ...tailParts,
      ...equipment,
      batteryPart,
    ],
    surfaces,
    motors: [
      {
        id: "motor",
        positionM: v([motorX, 0, 0]),
        partId: "motor",
        propPartId: "propeller",
        model: m.model,
        propeller: m.propName,
        propBlades: 2,
        propDiameterM: m.propDiameterM,
        maxThrustN: r(full.thrustN),
        zeroThrustSpeedMps: r(zeroThrust, 2),
        responseSeconds: 0.1,
        yawMix: 0,
        performance: {
          referenceVoltage: r(nominal, 2),
          referenceDensityKgM3: RHO,
          points: bench.map((p) => ({
            command: p.duty,
            thrustN: r(p.thrustN),
            currentA: r(p.currentA, 3),
          })),
        },
      },
    ],
    fuselageDragAreaM2: r(0.3 * area, 5),
    bodyDragAreaM2: v([
      0.3 * area,
      0.8 * bodyLength * bh,
      1.0 * bodyLength * bw,
    ]),
    angularDamping: v([0.01, 0.022, 0.028].map((k) => k * spec.massKg * b * b)),
    reference: {
      spanM: b,
      areaM2: r(S, 5),
      cgFromLeadingEdgeM: r(cgFromLE),
      leadingEdgeXM: r(leadingX),
      trimSpeedMps: spec.trimSpeedMps,
    },
    contactPoints,
    battery: {
      partId: "battery",
      chemistry: "LiPo",
      cells: spec.battery.cells,
      capacityMah: spec.battery.mah,
      resistanceOhm: spec.battery.resistanceOhm,
      initialSoc: 0.95,
      avionicsCurrentA: 0.2,
      voltageCurve: [
        { soc: 0, voltsPerCell: 3.3 },
        { soc: 0.1, voltsPerCell: 3.65 },
        { soc: 0.5, voltsPerCell: 3.8 },
        { soc: 0.9, voltsPerCell: 4.1 },
        { soc: 1, voltsPerCell: 4.2 },
      ],
    },
  };
  // Put the thrust line through the CG height, as designers do by placing the
  // motor or adding down-thrust; two passes because the motor mass moves too.
  for (let pass = 0; pass < 2; pass++) {
    const cgZ = massProperties(parseAircraft(a)).cg[2];
    for (const part of a.parts)
      if (part.id === "motor" || part.id === "propeller")
        (part.positionM as V3)[2] = r(cgZ);
    a.motors[0].positionM[2] = r(cgZ);
    for (const p of a.contactPoints)
      if (p.id === "prop-tip") (p.positionM as V3)[2] = r(cgZ + propR);
  }
  // Builder's power-trim test: choose down-thrust so that full power changes the
  // pitching moment as little as possible at the trimmed cruise state.
  const powerMoment = (down: number) => {
    const trial = parseAircraft(a);
    trial.motors[0].downThrustDeg = down;
    const trim = findTrim(trial, spec.trimSpeedMps, calmEnvironment());
    const sim = new Simulation(trial);
    const state = structuredClone(trim.state);
    state.motors = [1];
    return sim.forces(state, { ...trim.controls, throttle: 1 }).torque[1];
  };
  // Sign-agnostic bisection (a pusher behind the CG reverses the effect).
  let lo = -5,
    hi = 8,
    found = powerMoment(lo) * powerMoment(hi) < 0;
  if (found)
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (powerMoment(mid) * powerMoment(lo) > 0) lo = mid;
      else hi = mid;
    }
  const downThrust = found ? r((lo + hi) / 2, 1) : 0;
  (a.motors[0] as Record<string, unknown>).downThrustDeg = downThrust;
  (a.provenance as Record<string, unknown>).thrustLine = {
    status: "calculated",
    note: `Thrust line at the CG height with ${downThrust}° down-thrust, solved so full power leaves the pitching moment unchanged at the ${spec.trimSpeedMps} m/s trim (the usual builder's power test). The kit's actual motor angle is not published here.`,
  };
  const parsed = parseAircraft(a);
  const mp = massProperties(parsed);
  if (Math.abs(mp.mass - spec.massKg) > 1e-6)
    throw Error(`${spec.id}: mass ledger mismatch`);
  if (Math.abs(mp.cg[0] - cgX) > 0.002)
    throw Error(`${spec.id}: CG mismatch ${mp.cg[0]} vs ${cgX}`);
  return {
    json: a,
    summary: {
      downThrust,
      id: spec.id,
      mass: mp.mass,
      cg: cgX,
      thrust: full.thrustN,
      tw: full.thrustN / (spec.massKg * 9.80665),
      current: full.currentA,
      zeroThrust,
      wingLoading: (spec.massKg * 1000) / (S * 100),
    },
  };
}

const flitetest = (note: string, url: string) => ({ note, url });
const specs: Spec[] = [
  {
    id: "ft-simple-cub",
    name: "FT Simple Cub",
    description:
      "Flite Test 956 mm high-wing taildragger. Rudder, elevator and throttle; dihedral turns it with rudder. Gentle and slow. Generated from published specifications, not flight calibrated.",
    credit: { name: "Flite Test", url: "https://flitetest.com/simplecub" },
    sources: {
      publishedDimensions: flitetest(
        "956 mm span and about 283 g (10 oz) assembled without battery for the original kit; 3S 1300 mAh pack recommended.",
        "https://flitetest.com/simplecub",
      ),
      powerPack: flitetest(
        "Flite Test Power Pack B Radial v.2: Radial 2212 1050 KV, 25 A ESC, 9×4.5 propellers.",
        "https://www.getfpv.com/planes/flite-test-power-pack-b-radial-v-2.html",
      ),
    },
    spanM: 0.956,
    wingAreaM2: 0.956 * 0.19,
    lengthM: 0.74,
    massKg: 0.283 + 0.105,
    battery: { cells: 3, mah: 1300, massKg: 0.105, resistanceOhm: 0.05 },
    motor: {
      model: "Flite Test Radial 2212 1050 KV",
      kv: 1050,
      resistanceOhm: 0.25,
      noLoadA: 0.5,
      massKg: 0.052,
      propDiameterM: 0.2286,
      propPitchM: 0.1143,
      propName: "9 × 4.5",
      propMassKg: 0.008,
      escModel: "FT 25 A ESC",
      escMassKg: 0.024,
    },
    cg: { fraction: 0.27, sourced: false },
    wing: {
      position: "high",
      dihedralDeg: 4,
      incidenceDeg: 2,
      zeroLiftDeg: -2.5,
      cd0: 0.03,
      efficiency: 0.82,
      cm: -0.04,
      stallDeg: 14,
    },
    tail: {
      kind: "conventional",
      volumeH: 0.45,
      volumeV: 0.04,
      armM: 0.44,
      aspectH: 4,
      aspectV: 1.4,
      elevatorMaxDeg: 20,
      rudderMaxDeg: 25,
      rudder: true,
    },
    gear: "taildragger",
    visual: {
      fuselage: "rounded",
      finish: "foam",
      wing: { tipChordRatio: 1, tip: "rounded" },
      tail: { tipChordRatio: 0.7, tip: "rounded" },
      canopy: { relXM: 0.03, lengthM: 0.12, heightM: 0.028, widthM: 0.05 },
      markings: "cub-stripe",
    },
    body: {
      widthM: 0.06,
      heightM: 0.07,
      loft: [
        { x: -0.5, width: 0.25, top: -0.3, bottom: 0.15 },
        { x: -0.2, width: 0.65, top: -0.45, bottom: 0.35 },
        { x: 0.1, width: 1, top: -0.5, bottom: 0.5 },
        { x: 0.38, width: 1, top: -0.5, bottom: 0.5 },
        { x: 0.47, width: 0.92, top: -0.38, bottom: 0.46 },
        { x: 0.5, width: 0.82, top: -0.3, bottom: 0.4 },
      ],
    },
    color: "#f2d24b",
    accent: "#262626",
    trimSpeedMps: 9,
    structure: { wing: 0.42, body: 0.38, tail: 0.1, gear: 0.1 },
    servoCount: 2,
    servoMassKg: 0.009,
  },
  {
    id: "ft-explorer",
    name: "FT Explorer",
    description:
      "Flite Test 1447 mm pod-and-boom explorer with ailerons, rudder and elevator. Stable, slow and FPV-friendly; hand launch or ground start with removable gear. Generated from published specifications, not flight calibrated.",
    credit: {
      name: "Flite Test",
      url: "https://flitetest.com/articles/ft-explorer-build",
    },
    sources: {
      publishedDimensions: flitetest(
        "1447 mm span, about 490 g assembled without battery, CG 57 mm from the wing leading edge, 12° control throws.",
        "https://wiki.dallasmakerspace.org/wiki/FT_Explorer",
      ),
      powerPack: flitetest(
        "Designed for Flite Test Power Pack B or C; this preset uses Power Pack B Radial v.2 (2212 1050 KV, 9×4.5).",
        "https://flitetest.com/articles/ft-explorer-build",
      ),
    },
    spanM: 1.447,
    wingAreaM2: 1.447 * 0.2,
    lengthM: 1.0,
    massKg: 0.49 + 0.105,
    battery: { cells: 3, mah: 1300, massKg: 0.105, resistanceOhm: 0.05 },
    motor: {
      model: "Flite Test Radial 2212 1050 KV",
      kv: 1050,
      resistanceOhm: 0.25,
      noLoadA: 0.5,
      massKg: 0.052,
      propDiameterM: 0.2286,
      propPitchM: 0.1143,
      propName: "9 × 4.5",
      propMassKg: 0.008,
      escModel: "FT 25 A ESC",
      escMassKg: 0.024,
    },
    cg: { fromLeadingEdgeM: 0.057, sourced: true },
    wing: {
      position: "high",
      dihedralDeg: 3,
      incidenceDeg: 2,
      zeroLiftDeg: -2.5,
      cd0: 0.028,
      efficiency: 0.85,
      cm: -0.04,
      stallDeg: 14,
      ailerons: { maxDeg: 12 },
    },
    tail: {
      kind: "conventional",
      volumeH: 0.5,
      volumeV: 0.035,
      armM: 0.62,
      aspectH: 4,
      aspectV: 1.5,
      elevatorMaxDeg: 12,
      rudderMaxDeg: 12,
      rudder: true,
    },
    gear: "none",
    visual: {
      fuselage: "rounded",
      finish: "foam",
      wing: { tipChordRatio: 0.72, tip: "rounded", taperFromEta: 0.4 },
      tail: { tipChordRatio: 0.7, tip: "rounded" },
      canopy: { relXM: 0.2, lengthM: 0.13, heightM: 0.03, widthM: 0.05 },
      spinner: true,
      markings: "wingtips",
    },
    body: { widthM: 0.08, heightM: 0.09, boom: { widthM: 0.02 } },
    color: "#e8e9e4",
    accent: "#d0502c",
    trimSpeedMps: 9,
    structure: { wing: 0.48, body: 0.38, tail: 0.14, gear: 0 },
    servoCount: 4,
    servoMassKg: 0.009,
  },
  {
    id: "ft-spitfire",
    name: "FT Spitfire",
    description:
      "Flite Test 1080 mm low-wing warbird with ailerons, elevator and rudder on Power Pack C. Fast and lively; a taildragger that needs right rudder discipline. Generated from published specifications, not flight calibrated.",
    credit: {
      name: "Flite Test",
      url: "https://www.amainhobbies.com/flite-test-spitfire-speed-build-electric-airplane-kit-flt-1007/p673671",
    },
    sources: {
      publishedDimensions: flitetest(
        "1080 mm (42.5 in) span, 14.9 oz (422 g) assembled without battery; 3S 1000–2200 mAh, four 9 g servos.",
        "https://www.amainhobbies.com/flite-test-spitfire-speed-build-electric-airplane-kit-flt-1007/p673671",
      ),
      powerPack: flitetest(
        "Flite Test Power Pack C Radial v.2: Radial 2218 1180 KV, 40 A ESC; listing allows 8×6 or 9×4.7 props, this preset uses 9×4.7 on 3S 2200 mAh.",
        "https://www.getfpv.com/planes/flite-test-power-pack-c-radial-v-2.html",
      ),
    },
    spanM: 1.08,
    wingAreaM2: 1.08 * 0.185,
    lengthM: 0.86,
    massKg: 0.422 + 0.185,
    battery: { cells: 3, mah: 2200, massKg: 0.185, resistanceOhm: 0.03 },
    motor: {
      model: "Flite Test Radial 2218 1180 KV",
      kv: 1180,
      resistanceOhm: 0.15,
      noLoadA: 0.8,
      massKg: 0.07,
      propDiameterM: 0.2286,
      propPitchM: 0.1194,
      propName: "9 × 4.7",
      propMassKg: 0.009,
      escModel: "FT 40 A ESC",
      escMassKg: 0.035,
    },
    cg: { fraction: 0.27, sourced: false },
    wing: {
      position: "low",
      dihedralDeg: 5,
      incidenceDeg: 1.5,
      zeroLiftDeg: -2,
      cd0: 0.026,
      efficiency: 0.9,
      cm: -0.03,
      stallDeg: 14,
      ailerons: { maxDeg: 14 },
    },
    tail: {
      kind: "conventional",
      volumeH: 0.42,
      volumeV: 0.035,
      armM: 0.5,
      aspectH: 4.2,
      aspectV: 1.3,
      elevatorMaxDeg: 16,
      rudderMaxDeg: 20,
      rudder: true,
    },
    gear: "taildragger",
    visual: {
      fuselage: "round",
      finish: "foam",
      wing: { tipChordRatio: 0.4, tip: "elliptical" },
      tail: { tipChordRatio: 0.5, tip: "elliptical" },
      canopy: { relXM: -0.13, lengthM: 0.14, heightM: 0.035, widthM: 0.045 },
      spinner: true,
      markings: "raf-roundels",
      camouflage: true,
      underside: "#a9b4b3",
    },
    body: {
      widthM: 0.07,
      heightM: 0.09,
      loft: [
        { x: -0.5, width: 0.18, top: -0.22, bottom: 0.12 },
        { x: -0.2, width: 0.55, top: -0.38, bottom: 0.33 },
        { x: 0.1, width: 0.95, top: -0.47, bottom: 0.5 },
        { x: 0.33, width: 1, top: -0.5, bottom: 0.5 },
        { x: 0.46, width: 0.8, top: -0.36, bottom: 0.4 },
        { x: 0.5, width: 0.5, top: -0.24, bottom: 0.26 },
      ],
    },
    color: "#7d8a63",
    accent: "#5b6e86",
    trimSpeedMps: 12,
    structure: { wing: 0.45, body: 0.37, tail: 0.1, gear: 0.08 },
    servoCount: 4,
    servoMassKg: 0.009,
  },
  {
    id: "ft-mighty-mini-arrow",
    name: "FT Mighty Mini Arrow",
    description:
      "Flite Test 736 mm swept flying wing with a pusher motor and elevons. Quick, compact and hand-launched. Generated from published specifications, not flight calibrated.",
    credit: {
      name: "Flite Test",
      url: "https://store.flitetest.com/ft-mighty-mini-arrow",
    },
    sources: {
      publishedDimensions: flitetest(
        "736 mm (29 in) span, about 170 g (6 oz) without battery; 2205 2300 KV, 6×4.5 prop, 12 A ESC minimum, 3S 850 mAh, two 5 g servos.",
        "https://store.flitetest.com/ft-mighty-mini-arrow",
      ),
    },
    spanM: 0.736,
    wingAreaM2: 0.736 * 0.175,
    lengthM: 0.5,
    massKg: 0.17 + 0.075,
    battery: { cells: 3, mah: 850, massKg: 0.075, resistanceOhm: 0.08 },
    motor: {
      model: "2205 2300 KV",
      kv: 2300,
      resistanceOhm: 0.12,
      noLoadA: 0.8,
      massKg: 0.03,
      propDiameterM: 0.1524,
      propPitchM: 0.1143,
      propName: "6 × 4.5 (pusher)",
      propMassKg: 0.004,
      escModel: "12–20 A ESC",
      escMassKg: 0.012,
      pusher: true,
    },
    cg: { fraction: 0.2, sourced: false },
    wing: {
      position: "mid",
      dihedralDeg: 0,
      incidenceDeg: 1,
      zeroLiftDeg: -0.5,
      cd0: 0.022,
      efficiency: 0.8,
      cm: 0.005,
      stallDeg: 13,
      sweepOffsetM: 0.16,
    },
    tail: {
      kind: "elevons",
      elevonSpanM: 0.22,
      elevonChordM: 0.05,
      elevonArmM: 0.22,
      maxDeg: 20,
      finHeightM: 0.08,
      finChordM: 0.08,
    },
    gear: "none",
    visual: {
      fuselage: "rounded",
      finish: "foam",
      wing: { tipChordRatio: 0.4, tip: "square", sweepM: 0.16 },
      tail: { tipChordRatio: 0.65, tip: "rounded", sweepM: 0.03 },
      markings: "wingtips",
    },
    body: { widthM: 0.05, heightM: 0.045 },
    color: "#3a72b8",
    accent: "#f0f0ea",
    trimSpeedMps: 12,
    structure: { wing: 0.7, body: 0.2, tail: 0.1, gear: 0 },
    servoCount: 2,
    servoMassKg: 0.005,
  },
  {
    id: "ef-night-radian",
    name: "Night Radian 2.0 m",
    description:
      "E-flite 2 m powered sailplane: rudder, elevator and a folding prop. Climb on power, then glide and search for lift. Generated from published specifications, not flight calibrated.",
    credit: {
      name: "E-flite / Horizon Hobby",
      url: "https://www.air-rc.com/aircraft/E-flite_Night-Radian-20m_EFL36500",
    },
    sources: {
      publishedDimensions: {
        note: "2000 mm span, 35.5 dm² wing area, 1140 mm length, 1200 g with a 3S 2200 mAh pack (1020 g without), per the BNF Basic manual summary.",
        url: "https://www.notice-facile.com/en/manual/915081/e-flite+night-radian-2-0m-bnf-basic",
      },
      equipment: {
        note: "3533-960 KV 14-pole outrunner, 30 A ESC, two servos, folding 9.75×7.5 propeller.",
        url: "https://www.skyraccoon.com/aircraft/E-flite_Night-Radian-20m_EFL36500",
      },
    },
    spanM: 2.0,
    wingAreaM2: 0.355,
    lengthM: 1.14,
    massKg: 1.2,
    battery: { cells: 3, mah: 2200, massKg: 0.18, resistanceOhm: 0.03 },
    motor: {
      model: "E-flite 3533-960 KV",
      kv: 960,
      resistanceOhm: 0.08,
      noLoadA: 1.0,
      massKg: 0.105,
      propDiameterM: 0.2477,
      propPitchM: 0.1905,
      propName: "9.75 × 7.5 folding",
      propMassKg: 0.012,
      escModel: "30 A ESC",
      escMassKg: 0.03,
    },
    cg: { fraction: 0.32, sourced: false },
    wing: {
      position: "high",
      dihedralDeg: 3,
      polyhedral: { at: 0.55, dihedralDeg: 10 },
      incidenceDeg: 2.5,
      zeroLiftDeg: -3.5,
      cd0: 0.016,
      efficiency: 0.9,
      cm: -0.06,
      stallDeg: 13,
    },
    tail: {
      kind: "conventional",
      volumeH: 0.4,
      volumeV: 0.025,
      armM: 0.62,
      aspectH: 4.5,
      aspectV: 1.6,
      elevatorMaxDeg: 15,
      rudderMaxDeg: 30,
      rudder: true,
    },
    gear: "none",
    visual: {
      fuselage: "round",
      finish: "gloss",
      wing: { tipChordRatio: 0.55, tip: "rounded", taperFromEta: 0.5 },
      tail: { tipChordRatio: 0.65, tip: "rounded", sweepM: 0.02 },
      canopy: { relXM: 0.1, lengthM: 0.2, heightM: 0.025, widthM: 0.05 },
      spinner: true,
      markings: "wingtips",
    },
    body: {
      widthM: 0.065,
      heightM: 0.08,
      noseFraction: 0.36,
      loft: [
        { x: -0.5, width: 0.16, top: -0.12, bottom: 0.12 },
        { x: -0.1, width: 0.42, top: -0.27, bottom: 0.27 },
        { x: 0.15, width: 0.85, top: -0.45, bottom: 0.45 },
        { x: 0.35, width: 1, top: -0.5, bottom: 0.5 },
        { x: 0.47, width: 0.8, top: -0.36, bottom: 0.4 },
        { x: 0.5, width: 0.48, top: -0.22, bottom: 0.25 },
      ],
    },
    color: "#f1f1ec",
    accent: "#e07a1c",
    trimSpeedMps: 8,
    structure: { wing: 0.52, body: 0.38, tail: 0.1, gear: 0 },
    servoCount: 2,
    servoMassKg: 0.013,
  },
  {
    id: "ef-apprentice-sts",
    name: "Apprentice STS 1.5 m",
    description:
      "E-flite 1.5 m tricycle trainer with ailerons, elevator, rudder and a 15-size motor. Heavier and more wind-tolerant than the foam builds. Stabilization (SAFE) is not simulated. Generated from published specifications, not flight calibrated.",
    credit: {
      name: "E-flite / Horizon Hobby",
      url: "https://horizonhobby.com/EFL3700",
    },
    sources: {
      publishedDimensions: {
        note: "1500 mm span, 1080 mm length, 33.2 dm² wing area, 1390 g flying weight, CG 79 mm from the wing leading edge.",
        url: "https://www.readymaderc.com/products/details/86085-e-flite-apprentice-sts-1-5m-smart-trainer-w-safe-rtf-basic",
      },
      equipment: {
        note: "BL15 840 KV 12-pole outrunner, 11×8 propeller, Smart 30 A ESC, 3S 3200 mAh pack.",
        url: "https://www.azturnandburn.com/products/apprentice-sts-1-5m-smart-trainer-w-safe-rtf-basic",
      },
    },
    spanM: 1.5,
    wingAreaM2: 0.332,
    lengthM: 1.08,
    massKg: 1.39,
    battery: { cells: 3, mah: 3200, massKg: 0.26, resistanceOhm: 0.025 },
    motor: {
      model: "E-flite BL15 840 KV",
      kv: 840,
      resistanceOhm: 0.07,
      noLoadA: 1.2,
      massKg: 0.152,
      propDiameterM: 0.2794,
      propPitchM: 0.2032,
      propName: "11 × 8 electric",
      propMassKg: 0.02,
      escModel: "Smart 30 A ESC",
      escMassKg: 0.035,
    },
    cg: { fromLeadingEdgeM: 0.079, sourced: true },
    wing: {
      position: "high",
      dihedralDeg: 3,
      incidenceDeg: 2,
      zeroLiftDeg: -3,
      cd0: 0.025,
      efficiency: 0.85,
      cm: -0.05,
      stallDeg: 14,
      ailerons: { maxDeg: 14 },
    },
    tail: {
      kind: "conventional",
      volumeH: 0.5,
      volumeV: 0.04,
      armM: 0.62,
      aspectH: 4,
      aspectV: 1.5,
      elevatorMaxDeg: 16,
      rudderMaxDeg: 22,
      rudder: true,
    },
    gear: "tricycle",
    visual: {
      fuselage: "round",
      finish: "gloss",
      wing: { tipChordRatio: 1, tip: "rounded" },
      tail: { tipChordRatio: 0.72, tip: "rounded" },
      canopy: { relXM: 0.06, lengthM: 0.2, heightM: 0.045, widthM: 0.07 },
      spinner: true,
      markings: "trainer-stripes",
    },
    body: {
      widthM: 0.09,
      heightM: 0.12,
      loft: [
        { x: -0.5, width: 0.22, top: -0.22, bottom: 0.16 },
        { x: -0.2, width: 0.6, top: -0.42, bottom: 0.35 },
        { x: 0.1, width: 0.95, top: -0.5, bottom: 0.5 },
        { x: 0.33, width: 1, top: -0.48, bottom: 0.5 },
        { x: 0.46, width: 0.9, top: -0.35, bottom: 0.45 },
        { x: 0.5, width: 0.7, top: -0.25, bottom: 0.32 },
      ],
    },
    color: "#f4f4f2",
    accent: "#c4302b",
    trimSpeedMps: 11,
    structure: { wing: 0.4, body: 0.38, tail: 0.1, gear: 0.12 },
    servoCount: 4,
    servoMassKg: 0.013,
  },
];

/**
 * Calibration against published bench points. The effective series resistance
 * (winding + ESC + wiring) was chosen per motor size so that these comparable
 * motor/prop pairs fall within ±25 % of their published thrust and current.
 */
const calibration: {
  name: string;
  motor: Pick<
    Motor,
    "kv" | "resistanceOhm" | "noLoadA" | "propDiameterM" | "propPitchM"
  >;
  volts: number;
  thrustN?: number;
  rpm?: number;
  currentA: number;
}[] = [
  {
    // https://hobbyking.com/en_us/ntm-prop-drive-28-26-1000kv-235w.html
    name: "2826 1000 KV, 9×4.7, 3S",
    motor: {
      kv: 1000,
      resistanceOhm: 0.25,
      noLoadA: 0.5,
      propDiameterM: 0.2286,
      propPitchM: 0.1194,
    },
    volts: 11.1,
    thrustN: 0.632 * 9.80665,
    currentA: 10.2,
  },
  {
    // https://rotorgeeks.com/emax-gt2218-1100kv-motor
    name: "GT2218 1100 KV, 10×4.7, 3S",
    motor: {
      kv: 1100,
      resistanceOhm: 0.15,
      noLoadA: 0.8,
      propDiameterM: 0.254,
      propPitchM: 0.1194,
    },
    volts: 11.1,
    thrustN: 1.29 * 9.80665,
    currentA: 24,
  },
  {
    // E-flite Power 15 manual: APC 11×7E, 27.8 A at 10.4 V, 8200 rpm.
    name: "Power 15 950 KV, 11×7, 10.4 V",
    motor: {
      kv: 950,
      resistanceOhm: 0.07,
      noLoadA: 1.2,
      propDiameterM: 0.2794,
      propPitchM: 0.1778,
    },
    volts: 10.4,
    rpm: 8200,
    currentA: 27.8,
  },
];
for (const c of calibration) {
  const p = benchPoint(c.motor as Motor, c.volts, 1);
  const checks: [string, number, number][] = [
    ["current A", p.currentA, c.currentA],
  ];
  if (c.thrustN) checks.push(["thrust N", p.thrustN, c.thrustN]);
  if (c.rpm) checks.push(["rpm", p.rps * 60, c.rpm]);
  for (const [what, model, published] of checks) {
    const error = model / published - 1;
    console.log(
      `calibration ${c.name}: ${what} model ${model.toFixed(1)} vs published ${published.toFixed(1)} (${(error * 100).toFixed(0)} %)`,
    );
    if (Math.abs(error) > 0.25)
      throw Error(`Calibration outside ±25 %: ${c.name} ${what}`);
  }
}

const summaries = [];
for (const spec of specs) {
  const { json, summary } = build(spec);
  writeFileSync(
    `aircraft/${spec.id}.json`,
    JSON.stringify(json, null, 2) + "\n",
  );
  summaries.push(summary);
}
console.table(
  summaries.map((s) => ({
    id: s.id,
    "mass g": Math.round(s.mass * 1000),
    "thrust N": s.thrust.toFixed(2),
    "T/W": s.tw.toFixed(2),
    "current A": s.current.toFixed(1),
    "V0 m/s": s.zeroThrust.toFixed(1),
    "g/dm²": s.wingLoading.toFixed(1),
    "down °": s.downThrust,
  })),
);
