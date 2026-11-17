import { z } from "zod";
import { PilotResponseSchema } from "./pilot-response";
import { AIRCRAFT_FORMAT_VERSION } from "./versions";
export { AIRCRAFT_FORMAT_VERSION } from "./versions";
const finite = z.number().finite();
const vec = z.tuple([finite, finite, finite]);
const positive = finite.positive();
const dims = z.tuple([positive, positive, positive]);
const panelPoint = z.tuple([finite.min(-10).max(10), finite.min(-10).max(10)]);
const panel = z
  .object({
    // Coordinates are chord/span fractions, relative to the surface aerodynamic center.
    outline: z.array(panelPoint).min(3).max(64),
    thicknessM: positive.max(0.1),
    controlHinge: z.tuple([panelPoint, panelPoint]).optional(),
  })
  .strict();
const polarTable = z
  .array(
    z
      .object({
        alphaDeg: finite.min(-180).max(180),
        cl: finite.min(-5).max(5),
        cd: finite.min(0).max(5),
        cm: finite.min(-2).max(2),
      })
      .strict(),
  )
  .min(3)
  .max(721)
  .refine(
    (points) =>
      points.every((p, i) => i === 0 || p.alphaDeg > points[i - 1].alphaDeg),
    "Polar angles must be strictly increasing",
  );
/** Drawn planform; chords are normalised to the surface's aerodynamic area. */
const planformSchema = z
  .object({
    tipChordRatio: finite.min(0.2).max(1),
    tip: z.enum(["square", "rounded", "elliptical"]),
    /** Span fraction where taper begins (constant chord inboard). */
    taperFromEta: finite.min(0).max(0.95).optional(),
    /** Quarter-chord aft displacement at the tip, metres. */
    sweepM: finite.min(-1).max(1).optional(),
  })
  .strict();
const provenance = z
  .object({
    status: z.enum(["sourced", "calculated", "estimated", "calibrated"]),
    note: z.string().min(1),
    url: z.string().url().optional(),
  })
  .strict();
export const AircraftSchema = z
  .object({
    schemaVersion: z.literal(AIRCRAFT_FORMAT_VERSION),
    /** Fixed-wing only; the field is kept so existing files stay valid. */
    vehicleType: z.literal("fixed-wing").default("fixed-wing"),
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    description: z.string(),
    credit: z
      .object({
        name: z.string().min(1).max(120),
        url: z
          .string()
          .url()
          .refine((value) => /^https?:\/\//i.test(value), {
            message: "Creator links must use HTTP or HTTPS",
          }),
      })
      .strict()
      .optional(),
    pilotResponse: PilotResponseSchema.optional(),
    /** Visual-only detail for the generic renderer; physics never reads it. */
    visual: z
      .object({
        fuselage: z.enum(["box", "rounded", "round"]).optional(),
        finish: z.enum(["foam", "gloss"]).optional(),
        wing: planformSchema.optional(),
        tail: planformSchema.optional(),
        canopy: z
          .object({
            xM: finite,
            lengthM: positive.max(2),
            heightM: positive.max(0.5),
            widthM: positive.max(0.5),
          })
          .strict()
          .optional(),
        spinner: z.boolean().optional(),
        markings: z
          .enum(["raf-roundels", "cub-stripe", "trainer-stripes", "wingtips"])
          .optional(),
        camouflage: z.boolean().optional(),
        underside: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
      })
      .strict()
      .optional(),
    /** Optional paint scheme for the generic renderer; plan models keep their own. */
    livery: z
      .object({
        body: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        wing: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        tail: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      })
      .strict()
      .optional(),
    /**
     * Pre-mounted FPV viewpoint (massless): lens position in datum axes,
     * camera pitch (positive up) and vertical FOV. Used for the FPV view when
     * no FPV camera component is installed (0.13.0).
     */
    viewpoint: z
      .object({
        positionM: vec,
        pitchDeg: finite.min(-30).max(45).default(0),
        fovDeg: finite.min(40).max(120).default(90),
      })
      .strict()
      .optional(),
    fpv: z
      .object({
        partId: z.string().min(1),
        fovDeg: finite.min(40).max(120).default(90),
      })
      .strict()
      .optional(),
    provenance: z.record(z.string(), provenance),
    battery: z
      .object({
        partId: z.string().min(1),
        chemistry: z.enum(["LiPo", "LiIon", "other"]),
        cells: z.number().int().min(1).max(24),
        capacityMah: positive.max(100000),
        resistanceOhm: finite.min(0).max(10),
        initialSoc: finite.min(0).max(1).default(1),
        avionicsCurrentA: finite.min(0).max(20).default(0.15),
        voltageCurve: z
          .array(
            z
              .object({
                soc: finite.min(0).max(1),
                voltsPerCell: positive.max(5),
              })
              .strict(),
          )
          .min(2)
          .max(100),
      })
      .strict()
      .optional(),
    parts: z
      .array(
        z
          .object({
            id: z.string().min(1),
            kind: z.enum([
              "wing",
              "body",
              "boom",
              "tail",
              "battery",
              "motor",
              "equipment",
            ]),
            massKg: positive.max(100),
            material: z
              .object({
                name: z.string().min(1),
                densityKgM3: positive.optional(),
                finish: z
                  .enum(["foam", "carbon", "metal", "plastic", "wood"])
                  .optional(),
              })
              .strict()
              .optional(),
            manufacturer: z.string().optional(),
            model: z.string().optional(),
            catalogId: z.string().min(1).optional(),
            servo: z
              .object({
                speedSecondsPer60Deg: positive.max(5),
                travelDeg: positive.max(270),
                ratedVoltage: positive.max(24),
                stallTorqueNm: positive.max(20).optional(),
              })
              .strict()
              .optional(),
            inertiaDiagonalKgM2: z
              .tuple([positive, positive, positive])
              .optional(),
            orientationDeg: vec.optional(),
            // Dimensionless sections relative to component position and size.
            bodyLoft: z
              .array(
                z
                  .object({
                    x: finite.min(-2).max(2),
                    width: positive.max(2),
                    top: finite.min(-2).max(2),
                    bottom: finite.min(-2).max(2),
                    topColor: z
                      .string()
                      .regex(/^#[0-9a-fA-F]{6}$/)
                      .optional(),
                  })
                  .strict(),
              )
              .min(2)
              .max(32)
              .optional(),
            positionM: vec,
            sizeM: dims,
            color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
          })
          .strict(),
      )
      .min(1),
    surfaces: z.array(
      z
        .object({
          id: z.string().min(1),
          kind: z.enum(["wing", "horizontal-tail", "vertical-tail", "other"]),
          positionM: vec,
          spanM: positive.max(20),
          chordM: positive.max(5),
          aspectRatio: positive,
          rollDeg: finite.min(-180).max(180),
          incidenceDeg: finite.min(-20).max(20),
          panel: panel.optional(),
          foamWing: z
            .object({
              rootChordM: positive.max(5),
              boardThicknessM: positive.max(0.03),
              foldHeightM: positive.max(0.3),
              hingeFraction: finite.min(0.4).max(0.95),
              controlSpan: z.tuple([
                finite.min(0).max(1),
                finite.min(0).max(1),
              ]),
              // Outboard span fraction, leading-edge fraction, trailing-edge fraction.
              tipStations: z
                .array(
                  z.tuple([
                    finite.min(0).max(1),
                    finite.min(0).max(1),
                    finite.min(0).max(1),
                  ]),
                )
                .min(2)
                .max(20),
            })
            .strict()
            .optional(),
          reynoldsPolars: z
            .object({
              // A 2-D section table must first be converted to finite-wing data.
              convention: z.literal("finite-wing"),
              source: z.string().min(1).max(2000),
              tables: z
                .array(
                  z
                    .object({
                      reynolds: positive.min(1000).max(100000000),
                      points: polarTable,
                    })
                    .strict(),
                )
                .min(2)
                .max(20)
                .refine(
                  (tables) =>
                    tables.every(
                      (t, i) => i === 0 || t.reynolds > tables[i - 1].reynolds,
                    ),
                  "Reynolds numbers must be strictly increasing",
                ),
            })
            .strict()
            .optional(),
          polar: z
            .array(
              z
                .object({
                  alphaDeg: finite.min(-180).max(180),
                  cl: finite.min(-5).max(5),
                  cd: finite.min(0).max(5),
                  cm: finite.min(-2).max(2),
                })
                .strict(),
            )
            .min(3)
            .max(721)
            .optional(),
          liftSlope: positive.max(10),
          zeroLiftDeg: finite.min(-15).max(15),
          stallDeg: positive.max(45),
          cd0: finite.min(0).max(1),
          efficiency: positive.max(1),
          cm: finite.min(-1).max(1),
          control: z
            .object({
              axis: z.enum(["roll", "pitch", "yaw"]),
              gain: finite.min(-2).max(2),
              mix: z
                .object({
                  roll: finite.min(-2).max(2).optional(),
                  pitch: finite.min(-2).max(2).optional(),
                  yaw: finite.min(-2).max(2).optional(),
                })
                .strict()
                .optional(),
              maxDeg: finite.min(0).max(45),
              effectiveness: finite.min(0).max(1),
              responseSeconds: positive.max(2).optional(),
              rateLimitDegS: positive.max(2000).optional(),
              linkage: z
                .object({
                  servoPartId: z.string().min(1),
                  servoTravelDeg: positive.max(135),
                  servoArmM: positive.max(0.2),
                  surfaceArmM: positive.max(0.2),
                })
                .strict()
                .optional(),
            })
            .strict()
            .optional(),
        })
        .strict(),
    ),
    motors: z.array(
      z
        .object({
          id: z.string().min(1),
          positionM: vec,
          performance: z
            .object({
              referenceVoltage: positive.max(100),
              referenceDensityKgM3: positive.max(3).default(1.225),
              points: z
                .array(
                  z
                    .object({
                      command: finite.min(0).max(1),
                      thrustN: finite.min(0).max(1000),
                      currentA: finite.min(0).max(500),
                    })
                    .strict(),
                )
                .min(2)
                .max(100),
            })
            .strict()
            .optional(),
          model: z.string().optional(),
          propeller: z.string().optional(),
          // Optional visual dimensions from the motor already present in the mass ledger.
          partId: z.string().min(1).optional(),
          propPartId: z.string().min(1).optional(),
          propBlades: z.number().int().min(2).max(6).optional(),
          maxThrustN: positive.max(1000),
          zeroThrustSpeedMps: positive,
          responseSeconds: positive,
          yawMix: finite.min(-1).max(1),
          spin: z.enum(["cw", "ccw"]).optional(),
          torquePerThrustM: finite.min(0).max(1).default(0.015),
          propDiameterM: positive.max(2).default(0.2032),
          /** Fixed-wing installation angles: thrust tilted down and to the right (deg). */
          downThrustDeg: finite.min(-10).max(10).optional(),
          rightThrustDeg: finite.min(-10).max(10).optional(),
          /** Propeller polar moment of inertia I_p about its shaft, kg·m². */
          propInertiaKgM2: finite.min(0).max(0.1).optional(),
          /** Shaft speed at full command and reference voltage, rev/min. */
          maxRpm: finite.min(0).max(100000).optional(),
          /** P-factor coefficient k_p: thrust-centre shift k_p·sin α_p·R. */
          pFactor: finite.min(0).max(0.5).optional(),
          /**
           * Dynamic shaft speed (0.12.0): rated shaft power at maxRpm (W),
           * motor rotor inertia (kg·m²), redline (rev/min), engine kind and an
           * optional constant-speed governor. Needs spin, propInertiaKgM2 and
           * maxRpm; absent, the quasi-static rpm law applies.
           */
          motorPowerW: finite.min(0.1).max(200000).optional(),
          motorInertiaKgM2: finite.min(0).max(1).optional(),
          redlineRpm: finite.min(1).max(100000).optional(),
          engine: z.enum(["electric", "piston"]).optional(),
          propGovernor: z.boolean().optional(),
        })
        .strict(),
    ),
    fuselageDragAreaM2: finite.min(0).max(2),
    bodyDragAreaM2: z
      .tuple([finite.min(0).max(2), finite.min(0).max(2), finite.min(0).max(2)])
      .optional(),
    angularDamping: z.tuple([positive, positive, positive]),
    contactPoints: z
      .array(
        z
          .object({
            id: z.string().min(1),
            positionM: vec,
            spanLinked: z.boolean(),
            kind: z.enum(["body", "wheel", "skid"]).default("body"),
            steering: z.boolean().default(false),
            wheelRadiusM: positive.max(0.3).default(0.032),
            // Optional visual wire/strut anchor, in aircraft-datum coordinates.
            strutAnchorM: vec.optional(),
            wheelColor: z
              .string()
              .regex(/^#[0-9a-fA-F]{6}$/)
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(128),
    reference: z
      .object({
        // Authored operating point for airborne starts and default experiments.
        trimSpeedMps: positive.max(100).optional(),
        spanM: positive,
        areaM2: positive,
        cgFromLeadingEdgeM: finite,
        leadingEdgeXM: finite,
      })
      .strict(),
  })
  .strict()
  .superRefine((a, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    if (
      a.fpv &&
      !a.parts.some(
        (p) => p.id === a.fpv!.partId && p.kind === "equipment" && !p.servo,
      )
    )
      issue(
        ["fpv", "partId"],
        "FPV must reference an existing non-servo equipment mass component",
      );
    if (a.battery) {
      if (
        !a.parts.some((p) => p.id === a.battery!.partId && p.kind === "battery")
      )
        issue(
          ["battery", "partId"],
          "Battery must reference an existing battery mass component",
        );
      const points = a.battery.voltageCurve;
      if (
        points[0].soc !== 0 ||
        points.at(-1)!.soc !== 1 ||
        points.some(
          (p, i) =>
            i > 0 &&
            (p.soc <= points[i - 1].soc ||
              p.voltsPerCell < points[i - 1].voltsPerCell),
        )
      )
        issue(
          ["battery", "voltageCurve"],
          "OCV curve must cover SOC 0 to 1 in increasing order",
        );
      if (a.motors.some((m) => !m.performance))
        issue(
          ["motors"],
          "Battery simulation needs a thrust/current performance curve on every motor",
        );
    }
    a.parts.forEach((p, i) => {
      if (p.servo && p.kind !== "equipment")
        issue(
          ["parts", i, "servo"],
          "A servo must be an equipment mass component",
        );
      if (
        p.bodyLoft &&
        ((p.kind !== "body" && p.kind !== "boom") ||
          p.bodyLoft.some(
            (s, j) =>
              s.top >= s.bottom || (j > 0 && s.x <= p.bodyLoft![j - 1].x),
          ))
      )
        issue(
          ["parts", i, "bodyLoft"],
          "Body lofts need increasing X sections and top below bottom in the body Z-down frame",
        );
      const d = p.inertiaDiagonalKgM2;
      if (d && d.some((v, j) => v > d[(j + 1) % 3] + d[(j + 2) % 3] + 1e-12))
        issue(
          ["parts", i, "inertiaDiagonalKgM2"],
          "Principal inertias must satisfy triangle inequalities",
        );
    });
    a.motors.forEach((m, i) => {
      const dynamicFields =
        m.motorPowerW !== undefined ||
        m.motorInertiaKgM2 !== undefined ||
        m.redlineRpm !== undefined ||
        m.engine !== undefined ||
        m.propGovernor !== undefined;
      if (
        dynamicFields &&
        (m.motorPowerW === undefined ||
          !m.spin ||
          !m.propInertiaKgM2 ||
          !m.maxRpm)
      )
        issue(
          ["motors", i, "motorPowerW"],
          "Dynamic shaft speed needs motorPowerW, spin, propInertiaKgM2 and maxRpm",
        );
      if (m.redlineRpm !== undefined && m.maxRpm && m.redlineRpm <= m.maxRpm)
        issue(["motors", i, "redlineRpm"], "Redline must be above maxRpm");
      if (
        m.propPartId &&
        (!a.parts.some(
          (p) => p.id === m.propPartId && p.kind === "equipment",
        ) ||
          a.motors.some((n, j) => j < i && n.propPartId === m.propPartId))
      )
        issue(
          ["motors", i, "propPartId"],
          "Propeller must reference its own equipment mass component",
        );
      if (
        m.partId &&
        !a.parts.some((p) => p.id === m.partId && p.kind === "motor")
      )
        issue(
          ["motors", i, "partId"],
          "Motor must reference an existing motor mass component",
        );
      if (m.partId && a.motors.some((n, j) => j < i && n.partId === m.partId))
        issue(
          ["motors", i, "partId"],
          "A motor mass component cannot represent two motors",
        );
      const p = m.performance?.points;
      if (
        p &&
        (p[0].command !== 0 ||
          p.at(-1)!.command !== 1 ||
          p[0].thrustN !== 0 ||
          p.some(
            (v, j) =>
              j > 0 &&
              (v.command <= p[j - 1].command ||
                v.thrustN < p[j - 1].thrustN ||
                v.currentA < p[j - 1].currentA),
          ))
      )
        issue(
          ["motors", i, "performance"],
          "Performance must cover commands 0 to 1 with increasing command and nondecreasing thrust/current, starting at zero thrust",
        );
      if (p && Math.abs(p.at(-1)!.thrustN - m.maxThrustN) > 1e-6)
        issue(
          ["motors", i, "maxThrustN"],
          "Max thrust must match the performance curve endpoint",
        );
    });
    a.surfaces.forEach((s, i) => {
      if (s.foamWing) {
        const w = s.foamWing,
          stations = w.tipStations;
        if (
          s.kind !== "wing" ||
          s.panel ||
          w.controlSpan[0] >= w.controlSpan[1] ||
          stations[0][0] !== 0 ||
          stations.at(-1)![0] !== 1 ||
          stations.some(
            (p, j) => p[1] >= p[2] || (j > 0 && p[0] <= stations[j - 1][0]),
          )
        )
          issue(
            ["surfaces", i, "foamWing"],
            "Foam wings need ordered full-span tip stations, a nonzero control span and no flat panel",
          );
        if (s.control) {
          const [start, end] = w.controlSpan;
          for (let j = 1; j < stations.length; j++) {
            const a = stations[j - 1],
              b = stations[j];
            if (b[0] <= a[0] || b[0] < start || a[0] > end) continue;
            for (const f of [Math.max(start, a[0]), Math.min(end, b[0])]) {
              const t = (f - a[0]) / (b[0] - a[0]);
              const leading = a[1] + (b[1] - a[1]) * t;
              const trailing = a[2] + (b[2] - a[2]) * t;
              if (
                leading >= w.hingeFraction ||
                trailing <= w.hingeFraction + 0.0006 / w.rootChordM
              )
                issue(
                  ["surfaces", i, "foamWing", "controlSpan"],
                  "The entire aileron hinge must lie inside the wing outline",
                );
            }
          }
        }
      }
      const linkage = s.control?.linkage;
      if (linkage) {
        const servo = a.parts.find((p) => p.id === linkage.servoPartId)?.servo;
        if (!servo)
          issue(
            ["surfaces", i, "control", "linkage"],
            "Linkage must reference a servo mass component",
          );
        else if (linkage.servoTravelDeg * 2 > servo.travelDeg + 1e-6)
          issue(
            ["surfaces", i, "control", "linkage", "servoTravelDeg"],
            "Commanded servo travel exceeds its rated range",
          );
      }
      if (s.panel) {
        const points = s.panel.outline;
        const twiceArea = points.reduce((sum, p, j) => {
          const next = points[(j + 1) % points.length];
          return sum + p[0] * next[1] - next[0] * p[1];
        }, 0);
        if (Math.abs(twiceArea) < 1e-8)
          issue(
            ["surfaces", i, "panel", "outline"],
            "Panel outline must enclose an area",
          );
        const hinge = s.panel.controlHinge;
        if (hinge && (!s.control || hinge[1][1] <= hinge[0][1]))
          issue(
            ["surfaces", i, "panel", "controlHinge"],
            "A control hinge needs a control and must run from lower to higher span coordinate",
          );
      }
      if (s.polar && s.reynoldsPolars)
        issue(["surfaces", i], "Choose polar or reynoldsPolars, not both");
      if (
        s.polar &&
        s.polar.some((p, j) => j > 0 && p.alphaDeg <= s.polar![j - 1].alphaDeg)
      )
        issue(
          ["surfaces", i, "polar"],
          "Polar angles must be strictly increasing",
        );
    });
    if (!a.surfaces.length)
      ctx.addIssue({
        code: "custom",
        message: "Fixed-wing aircraft need aerodynamic surfaces",
        path: ["surfaces"],
      });
    for (const key of [
      "parts",
      "surfaces",
      "motors",
      "contactPoints",
    ] as const) {
      const seen = new Set<string>();
      a[key].forEach((v, i) => {
        if (seen.has(v.id))
          ctx.addIssue({
            code: "custom",
            path: [key, i, "id"],
            message: "Duplicate component id",
          });
        seen.add(v.id);
      });
    }
  });
export type Aircraft = z.infer<typeof AircraftSchema>;
export function parseAircraft(value: unknown): Aircraft {
  return AircraftSchema.parse(value);
}
