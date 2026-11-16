/**
 * Detailed generic airframe: smooth fuselage lofts, tapered/elliptical lifting
 * surfaces with real airfoil sections, and painted liveries drawn into canvas
 * textures that follow the surface curvature.
 *
 * Visual only. Planform chords are normalised so each surface's drawn area
 * equals its aerodynamic `spanM × chordM`; physics never reads these meshes.
 */
import * as T from "three";
import type { Aircraft } from "../core/schema";
import { radians } from "../core/math";

type Surface = Aircraft["surfaces"][number];
type Visual = NonNullable<Aircraft["visual"]>;
type Planform = NonNullable<Visual["wing"]>;
type Section = { x: number; width: number; top: number; bottom: number };

const hasCanvas = () =>
  typeof document !== "undefined" &&
  typeof document.createElement === "function";

/** Deterministic PRNG for camouflage and weathering. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- planforms

/** Unnormalised chord factor at η (0 root, 1 tip). */
function chordShape(p: Planform, eta: number) {
  const start = p.taperFromEta ?? 0;
  const linear =
    eta <= start
      ? 1
      : 1 - ((1 - p.tipChordRatio) * (eta - start)) / Math.max(1e-6, 1 - start);
  if (p.tip === "elliptical")
    return Math.sqrt(Math.max(0.03, 1 - eta * eta)) * (0.75 + 0.25 * linear);
  if (p.tip === "rounded") {
    const k = 0.12;
    if (eta > 1 - k) {
      const u = (eta - (1 - k)) / k;
      return linear * Math.sqrt(Math.max(0.05, 1 - u * u));
    }
  }
  return linear;
}
const meanShape = (p: Planform) => {
  let sum = 0;
  for (let i = 0; i < 400; i++) sum += chordShape(p, (i + 0.5) / 400);
  return sum / 400;
};

/** NACA four-digit thickness plus a mild camber line; t is the chord fraction. */
function section(
  t: number,
  thickness: number,
  camber: number,
  flatBottom: number,
) {
  const yt =
    5 *
    thickness *
    (0.2969 * Math.sqrt(t) -
      0.126 * t -
      0.3516 * t * t +
      0.2843 * t ** 3 -
      0.1036 * t ** 4);
  const c = camber * 4 * t * (1 - t);
  return { upper: c + yt, lower: c - yt * flatBottom };
}

interface SurfaceShape {
  /** Local y of the root and the tip-ward direction (+1, −1, or 0 = symmetric). */
  rootY: number;
  tipward: number;
  /** η at the local root and tip of this panel within the whole half-span. */
  eta0: number;
  eta1: number;
  /** Root chord after normalisation, metres. */
  rootChord: number;
  planform: Planform;
  /** Quarter-chord aft displacement at η = 1 (sweep), metres. */
  sweepM: number;
  /** η of the surface's aerodynamic centre (its local origin). */
  etaCentre: number;
}

/** Local chord, quarter-chord x and η for a local span coordinate y. */
function stationAt(shape: SurfaceShape, span: number, y: number) {
  const along =
    shape.tipward === 0
      ? Math.abs(y) / (span / 2)
      : ((y - shape.rootY) * shape.tipward) / span;
  const eta = shape.eta0 + (shape.eta1 - shape.eta0) * along;
  return {
    eta,
    chord: shape.rootChord * chordShape(shape.planform, eta),
    qc: -shape.sweepM * (eta - shape.etaCentre),
  };
}

/**
 * Lofted airfoil between chord fractions [t0, t1] and local span [y0, y1].
 * UV: u = chord fraction, v = η. Group 0 is the upper skin, group 1 the lower.
 */
function liftingGeometry(
  shape: SurfaceShape,
  span: number,
  opts: {
    t0: number;
    t1: number;
    y0: number;
    y1: number;
    thickness: number;
    camber: number;
    flatBottom: number;
    origin?: [number, number];
  },
) {
  const chordwise = 22,
    spanwise = 28;
  const pos: number[] = [],
    uv: number[] = [],
    upper: number[] = [],
    lower: number[] = [],
    edges: number[] = [];
  const [ox, oz] = opts.origin ?? [0, 0];
  const row = chordwise + 1;
  // Cosine spacing chordwise (dense at the leading edge); denser at the tips.
  for (let skin = 0; skin < 2; skin++)
    for (let j = 0; j <= spanwise; j++) {
      const s = j / spanwise;
      const y =
        opts.y0 + (opts.y1 - opts.y0) * (0.5 - 0.5 * Math.cos(Math.PI * s));
      const st = stationAt(shape, span, y);
      for (let i = 0; i <= chordwise; i++) {
        const t =
          opts.t0 +
          (opts.t1 - opts.t0) *
            (0.5 - 0.5 * Math.cos((Math.PI * i) / chordwise));
        const sec = section(
          Math.max(t, 1e-4),
          opts.thickness,
          opts.camber,
          opts.flatBottom,
        );
        const z = -(skin === 0 ? sec.upper : sec.lower) * st.chord;
        pos.push(st.qc + st.chord * (0.25 - t) - ox, y, z - oz);
        // Canvas rows run root → tip downwards; CanvasTexture flips Y.
        uv.push(
          t,
          1 - (st.eta - shape.eta0) / Math.max(1e-6, shape.eta1 - shape.eta0),
        );
      }
    }
  const base = (skin: number, j: number) =>
    skin * (spanwise + 1) * row + j * row;
  for (let j = 0; j < spanwise; j++)
    for (let i = 0; i < chordwise; i++) {
      const a = base(0, j) + i,
        b = base(0, j + 1) + i;
      upper.push(a, b, a + 1, a + 1, b, b + 1);
      const c = base(1, j) + i,
        d = base(1, j + 1) + i;
      lower.push(c, c + 1, d, c + 1, d + 1, d);
    }
  // Trailing (or hinge) edge and leading edge closures.
  for (const i of [0, chordwise])
    for (let j = 0; j < spanwise; j++) {
      const a = base(0, j) + i,
        b = base(0, j + 1) + i,
        c = base(1, j) + i,
        d = base(1, j + 1) + i;
      if (i === 0) edges.push(a, c, b, b, c, d);
      else edges.push(a, b, c, b, d, c);
    }
  // Span-end caps.
  for (const j of [0, spanwise])
    for (let i = 0; i < chordwise; i++) {
      const a = base(0, j) + i,
        b = base(1, j) + i;
      if (j === 0) edges.push(a, a + 1, b, a + 1, b + 1, b);
      else edges.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  // Triangles above are wound inward in the body frame; flip them outward.
  const flip = (list: number[]) => {
    for (let k = 0; k < list.length; k += 3)
      [list[k + 1], list[k + 2]] = [list[k + 2], list[k + 1]];
    return list;
  };
  g.setIndex([...flip(upper), ...flip(lower), ...flip(edges)]);
  g.addGroup(0, upper.length, 0);
  g.addGroup(upper.length, lower.length + edges.length, 1);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- fuselage

/** Catmull-Rom resampling of authored sections into a smooth station list. */
function resample(sections: Section[], count: number): Section[] {
  const at = (i: number) =>
    sections[Math.max(0, Math.min(sections.length - 1, i))];
  const out: Section[] = [];
  for (let k = 0; k < count; k++) {
    const f = (k / (count - 1)) * (sections.length - 1);
    const i = Math.min(sections.length - 2, Math.floor(f)),
      t = f - i;
    const lerp = (key: keyof Section) => {
      const p0 = at(i - 1)[key],
        p1 = at(i)[key],
        p2 = at(i + 1)[key],
        p3 = at(i + 2)[key];
      return (
        0.5 *
        (2 * p1 +
          (-p0 + p2) * t +
          (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
          (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)
      );
    };
    const top = lerp("top"),
      bottom = lerp("bottom");
    out.push({
      x: lerp("x"),
      width: Math.max(0.002, lerp("width")),
      top: Math.min(top, bottom - 0.002),
      bottom: Math.max(bottom, top + 0.002),
    });
  }
  return out;
}

/**
 * Superellipse fuselage: exponent 2 is round, 4–5 a rounded foam box.
 * UV: u along the length (nose = 1), v around the section (0 = top, 0.25 = right side).
 */
export function smoothLoftGeometry(
  sections: Section[],
  exponent: number,
  y = 0,
) {
  const stations = resample(sections, 36),
    around = 28;
  const pos: number[] = [],
    uv: number[] = [],
    idx: number[] = [];
  const x0 = stations[0].x,
    x1 = stations.at(-1)!.x;
  const e = 2 / exponent;
  for (const s of stations) {
    const zc = (s.top + s.bottom) / 2,
      hh = (s.bottom - s.top) / 2,
      hw = s.width / 2;
    for (let k = 0; k <= around; k++) {
      const a = (k / around) * Math.PI * 2;
      // a = 0 at the top (−z), increasing towards +y (right side).
      const sy = Math.sin(a),
        cz = Math.cos(a);
      pos.push(
        s.x,
        y + hw * Math.sign(sy) * Math.abs(sy) ** e,
        zc - hh * Math.sign(cz) * Math.abs(cz) ** e,
      );
      uv.push((s.x - x0) / (x1 - x0), k / around);
    }
  }
  const row = around + 1;
  for (let i = 0; i < stations.length - 1; i++)
    for (let k = 0; k < around; k++) {
      const a = i * row + k,
        b = a + row;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  // End caps fan to each end-section centre.
  for (const [i, flip] of [
    [0, true],
    [stations.length - 1, false],
  ] as const) {
    const s = stations[i];
    const centre = pos.length / 3;
    pos.push(s.x, y, (s.top + s.bottom) / 2);
    uv.push(i ? 1 : 0, 0.5);
    for (let k = 0; k < around; k++) {
      const a = i * row + k;
      if (flip) idx.push(centre, a + 1, a);
      else idx.push(centre, a, a + 1);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geometry: g, x0, x1 };
}

// ---------------------------------------------------------------- liveries

interface Paint {
  base: string;
  accent: string;
  underside: string;
  markings?: Visual["markings"];
  camouflage?: boolean;
}

function canvasTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
) {
  if (!hasCanvas()) return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx || typeof ctx.fillRect !== "function") return undefined;
  draw(ctx, width, height);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function roundel(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rings: string[],
) {
  rings.forEach((color, i) => {
    const f = 1 - i / rings.length;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * f, ry * f, 0, 0, Math.PI * 2);
    ctx.fill();
  });
}

function camouflage(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
) {
  const rand = random(seed);
  ctx.fillStyle = "#6f7357"; // ocean grey / dark earth base
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#4a5a3a"; // dark green
  for (let n = 0; n < 7; n++) {
    ctx.beginPath();
    const cx = rand() * w,
      cy = rand() * h;
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2,
        r = (0.15 + rand() * 0.2) * Math.min(w, h) * 1.8;
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.7);
    }
    ctx.closePath();
    ctx.fill();
  }
}

/** Subtle weathering and panel lines shared by every painted surface. */
function finish(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
  lines: number,
) {
  const rand = random(seed);
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(${rand() < 0.5 ? "0,0,0" : "255,255,255"},${0.012 + rand() * 0.02})`;
    ctx.fillRect(rand() * w, rand() * h, 2 + rand() * 14, 1 + rand() * 6);
  }
  ctx.strokeStyle = "rgba(0,0,0,0.13)";
  ctx.lineWidth = 1;
  for (let i = 1; i < lines; i++) {
    ctx.beginPath();
    ctx.moveTo(0, (i / lines) * h);
    ctx.lineTo(w, (i / lines) * h);
    ctx.stroke();
  }
}

const RAF = ["#f2c832", "#1c2f63", "#f2f0ea", "#b3262b"];

/** Wing/tail upper-surface texture: u = chord fraction (x), v = η (y). */
function surfaceTexture(
  paint: Paint,
  s: Surface,
  shape: SurfaceShape,
  upper: boolean,
) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    const kind = s.kind;
    if (upper && paint.camouflage) camouflage(ctx, w, h, s.id.length * 97);
    else {
      ctx.fillStyle = upper ? paint.base : paint.underside;
      ctx.fillRect(0, 0, w, h);
    }
    const etaY = (eta: number) =>
      ((eta - shape.eta0) / Math.max(1e-6, shape.eta1 - shape.eta0)) * h;
    const halfSpan =
      s.spanM / Math.max(1e-6, shape.eta1 - shape.eta0) || s.spanM;
    if (paint.markings === "raf-roundels" && kind === "wing") {
      const eta = 0.68;
      if (eta >= shape.eta0 && eta <= shape.eta1) {
        const chord = shape.rootChord * chordShape(shape.planform, eta);
        const r = chord * 0.36;
        roundel(
          ctx,
          0.42 * w,
          etaY(eta),
          (r / chord) * w,
          (r / halfSpan) * h,
          upper ? RAF.slice(1, 2).concat(RAF[3]) : RAF.slice(1),
        );
      }
    }
    if (paint.markings === "wingtips" || paint.markings === "trainer-stripes") {
      if (kind !== "vertical-tail") {
        ctx.fillStyle = paint.accent;
        const y = etaY(0.86);
        ctx.fillRect(0, y, w, h - y);
      }
    }
    if (paint.markings === "cub-stripe" && kind === "wing" && upper) {
      ctx.fillStyle = paint.accent;
      ctx.fillRect(0, etaY(0.93), w, h);
    }
    if (kind === "vertical-tail" && paint.markings === "raf-roundels") {
      const stripes = ["#b3262b", "#f2f0ea", "#1c2f63"];
      stripes.forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.fillRect((i / 3) * 0.55 * w, 0, (0.55 * w) / 3, h * 0.7);
      });
    }
    if (kind === "vertical-tail" && paint.markings !== "raf-roundels") {
      ctx.fillStyle = paint.accent;
      ctx.fillRect(0, 0, w, h * 0.28);
    }
    finish(ctx, w, h, s.id.length * 31, kind === "wing" ? 5 : 3);
  });
}

/** Fuselage texture: u along the length (x), v around (0 top, 0.25 right side). */
function fuselageTexture(
  paint: Paint,
  length: number,
  x0: number,
  a: Aircraft,
) {
  return canvasTexture(512, 256, (ctx, w, h) => {
    if (paint.camouflage) {
      camouflage(ctx, w, h * 0.5, 7);
      ctx.drawImage(ctx.canvas, 0, 0, w, h * 0.5, 0, h * 0.5, w, h * 0.5);
      // Light underside band around v = 0.5.
      ctx.fillStyle = paint.underside;
      ctx.fillRect(0, h * 0.36, w, h * 0.28);
    } else {
      ctx.fillStyle = paint.base;
      ctx.fillRect(0, 0, w, h);
    }
    const ux = (x: number) => ((x - x0) / length) * w;
    const wingX =
      a.reference.leadingEdgeXM -
      0.6 * (a.reference.areaM2 / a.reference.spanM);
    if (paint.markings === "raf-roundels")
      for (const v of [0.25, 0.75]) {
        const cx = ux(wingX - length * 0.22),
          r = h * 0.075;
        roundel(ctx, cx, v * h, r * 1.2, r, RAF);
      }
    if (paint.markings === "cub-stripe") {
      ctx.fillStyle = paint.accent;
      for (const v of [0.25, 0.75]) {
        ctx.beginPath();
        // Lightning flash: a tapered zig-zag along the side.
        const y = v * h;
        ctx.moveTo(w * 1.0, y - 3);
        ctx.lineTo(w * 0.62, y - 6);
        ctx.lineTo(w * 0.5, y + 4);
        ctx.lineTo(w * 0.12, y - 1);
        ctx.lineTo(w * 0.5, y + 9);
        ctx.lineTo(w * 0.62, y + 1);
        ctx.lineTo(w * 1.0, y + 5);
        ctx.closePath();
        ctx.fill();
      }
    }
    if (paint.markings === "trainer-stripes" || paint.markings === "wingtips") {
      ctx.fillStyle = paint.accent;
      for (const v of [0.25, 0.75]) {
        ctx.fillRect(0, v * h - 5, w, 4);
        ctx.fillRect(w * 0.55, v * h + 2, w * 0.45, 2);
      }
    }
    finish(ctx, w, h, 13, 0);
    // Panel joints around the fuselage.
    ctx.strokeStyle = "rgba(0,0,0,0.12)";
    for (const f of [0.18, 0.42, 0.66, 0.84]) {
      ctx.beginPath();
      ctx.moveTo(f * w, 0);
      ctx.lineTo(f * w, h);
      ctx.stroke();
    }
  });
}

function paintMaterial(
  color: string,
  finishKind: Visual["finish"],
  map?: T.Texture,
) {
  const gloss = finishKind === "gloss";
  return new T.MeshStandardMaterial({
    color: map ? "#ffffff" : color,
    map,
    roughness: gloss ? 0.34 : 0.78,
    metalness: 0,
  });
}

// ---------------------------------------------------------------- builders

export interface DetailedSurface {
  group: T.Group;
  pivot?: T.Group;
  hingeAxis?: T.Vector3;
}

/** Wing/tail panel: its η span inside the whole half-span of matching surfaces. */
function surfaceShape(
  a: Aircraft,
  s: Surface,
  planform: Planform,
): SurfaceShape {
  const roll = radians(s.rollDeg);
  if (s.kind === "wing") {
    const side = Math.sign(s.positionM[1]) || 1;
    const panels = a.surfaces
      .filter((o) => o.kind === "wing" && Math.sign(o.positionM[1]) === side)
      .sort((p, q) => Math.abs(p.positionM[1]) - Math.abs(q.positionM[1]));
    const total = panels.reduce((n, o) => n + o.spanM, 0);
    let before = 0;
    for (const o of panels) {
      if (o === s) break;
      before += o.spanM;
    }
    const eta0 = before / total,
      eta1 = (before + s.spanM) / total;
    // Local +y points along the panel; its outboard end is on the `side` side.
    const tipward = side * (Math.cos(roll) >= 0 ? 1 : -1);
    const rootChord = s.chordM / meanShape(planform);
    return {
      rootY: (-tipward * s.spanM) / 2,
      tipward,
      eta0,
      eta1,
      rootChord,
      planform,
      sweepM: planform.sweepM ?? 0,
      etaCentre: (eta0 + eta1) / 2,
    };
  }
  const sin = Math.sin(roll);
  const tipward = Math.abs(sin) > 0.5 ? -Math.sign(sin) : 0;
  const rootChord = s.chordM / meanShape(planform);
  return {
    rootY: tipward === 0 ? 0 : (-tipward * s.spanM) / 2,
    tipward,
    eta0: 0,
    eta1: 1,
    rootChord,
    planform,
    sweepM: planform.sweepM ?? 0,
    etaCentre: tipward === 0 ? 0.5 : 0.5,
  };
}

export function detailedSurface(a: Aircraft, s: Surface): DetailedSurface {
  const visual = a.visual!;
  const planform =
    (s.kind === "wing" ? visual.wing : visual.tail) ??
    ({ tipChordRatio: 1, tip: "square" } as Planform);
  const shape = surfaceShape(a, s, planform);
  const paint: Paint = {
    base:
      s.kind === "wing"
        ? (a.livery?.wing ?? "#e2e5e7")
        : (a.livery?.tail ?? "#e2e5e7"),
    accent: a.livery?.accent ?? "#285982",
    underside: visual.underside ?? a.livery?.wing ?? "#d5d9dc",
    markings: visual.markings,
    camouflage: visual.camouflage,
  };
  const upper = paintMaterial(
    paint.base,
    visual.finish,
    surfaceTexture(paint, s, shape, true),
  );
  const lower = paintMaterial(
    paint.underside,
    visual.finish,
    surfaceTexture(paint, s, shape, false),
  );
  const wing = s.kind === "wing";
  const thickness = wing ? (visual.finish === "gloss" ? 0.1 : 0.09) : 0.055;
  const camber = wing ? 0.02 : 0;
  const flatBottom = wing ? 0.35 : 1;
  const hinge = 0.74;
  const half = s.spanM / 2;
  const group = new T.Group();
  const control = s.control;
  // Control span (visual): outer 55 % for ailerons, nearly full span for tails.
  let c0 = -half,
    c1 = half;
  if (control && wing) {
    const inner = shape.rootY + shape.tipward * s.spanM * 0.38,
      outer = shape.rootY + shape.tipward * s.spanM * 0.94;
    c0 = Math.min(inner, outer);
    c1 = Math.max(inner, outer);
  } else if (control) {
    c0 = -half * 0.96;
    c1 = half * 0.96;
  }
  const main = liftingGeometry(shape, s.spanM, {
    t0: 0,
    t1: control ? hinge : 1,
    y0: -half,
    y1: half,
    thickness,
    camber,
    flatBottom,
  });
  const body = new T.Mesh(main, [upper, lower]);
  body.castShadow = body.receiveShadow = true;
  group.add(body);
  if (!control) return { group };
  // Fixed trailing strips outside the control span.
  for (const [y0, y1] of [
    [-half, c0],
    [c1, half],
  ])
    if (y1 - y0 > 0.002) {
      const strip = new T.Mesh(
        liftingGeometry(shape, s.spanM, {
          t0: hinge,
          t1: 1,
          y0,
          y1,
          thickness,
          camber,
          flatBottom,
        }),
        [upper, lower],
      );
      strip.castShadow = true;
      group.add(strip);
    }
  // Hinge line between the control-span ends.
  const end = (y: number) => {
    const st = stationAt(shape, s.spanM, y);
    const sec = section(hinge, thickness, camber, flatBottom);
    return new T.Vector3(
      st.qc + st.chord * (0.25 - hinge),
      y,
      (-(sec.upper + sec.lower) / 2) * st.chord,
    );
  };
  const p0 = end(c0),
    p1 = end(c1);
  const pivot = new T.Group();
  pivot.position.copy(p0.clone().add(p1).multiplyScalar(0.5));
  group.add(pivot);
  const flap = new T.Mesh(
    liftingGeometry(shape, s.spanM, {
      t0: hinge,
      t1: 1,
      y0: c0,
      y1: c1,
      thickness,
      camber,
      flatBottom,
      origin: [pivot.position.x, pivot.position.z],
    }),
    [upper, lower],
  );
  flap.position.y = -pivot.position.y;
  flap.castShadow = true;
  pivot.add(flap);
  const hingeAxis = p1.clone().sub(p0).normalize();
  if (hingeAxis.y < 0) hingeAxis.negate();
  return { group, pivot, hingeAxis };
}

export function detailedFuselage(
  a: Aircraft,
  part: Aircraft["parts"][number],
  sections: Section[],
) {
  const visual = a.visual!;
  const exponent =
    visual.fuselage === "round"
      ? 2.2
      : visual.fuselage === "rounded"
        ? 4.5
        : 12;
  const { geometry, x0, x1 } = smoothLoftGeometry(
    sections,
    exponent,
    part.positionM[1],
  );
  const paint: Paint = {
    base: a.livery?.body ?? part.color,
    accent: a.livery?.accent ?? "#285982",
    underside: visual.underside ?? a.livery?.body ?? part.color,
    markings: part.kind === "boom" ? undefined : visual.markings,
    camouflage: part.kind === "boom" ? false : visual.camouflage,
  };
  const texture =
    part.kind === "boom" ? undefined : fuselageTexture(paint, x1 - x0, x0, a);
  const m = new T.Mesh(
    geometry,
    paintMaterial(paint.base, visual.finish, texture),
  );
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** Tinted canopy bubble on the fuselage top. */
export function canopy(a: Aircraft, fuselageTopAt: (x: number) => number) {
  const c = a.visual?.canopy;
  if (!c) return undefined;
  const glass = new T.MeshStandardMaterial({
    color: "#1b2731",
    roughness: 0.06,
    metalness: 0.55,
  });
  const steps = 12,
    sections: Section[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps,
      x = c.xM + c.lengthM * (0.5 - t);
    const bulge = Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.7;
    const top = fuselageTopAt(x);
    sections.push({
      x,
      width: Math.max(0.004, c.widthM * (0.35 + 0.65 * bulge)),
      top: top - c.heightM * bulge - 0.001,
      bottom: top + 0.004,
    });
  }
  sections.reverse();
  const { geometry } = smoothLoftGeometry(sections, 2.2);
  const m = new T.Mesh(geometry, glass);
  m.castShadow = true;
  m.name = "canopy";
  return m;
}

/** Streamlined spinner, local +X along the thrust axis (front). */
export function spinner(radius: number, color: string) {
  const points: T.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    points.push(
      new T.Vector2(radius * Math.sqrt(1 - t * t) ** 0.9, radius * 2.1 * t),
    );
  }
  const g = new T.LatheGeometry(points, 24);
  const m = new T.Mesh(
    g,
    new T.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.2 }),
  );
  m.castShadow = true;
  // Lathe axis is +Y; turn it to point forward (+X in the prop's frame).
  m.rotation.z = -Math.PI / 2;
  return m;
}

/** Rubber tyre with a light hub, axle along local Y. */
export function wheel(radius: number, width: number) {
  const group = new T.Group();
  const tyre = new T.Mesh(
    new T.TorusGeometry(radius - width * 0.35, width * 0.42, 12, 28),
    new T.MeshStandardMaterial({ color: "#1d1f21", roughness: 0.9 }),
  );
  tyre.rotation.x = Math.PI / 2;
  const hub = new T.Mesh(
    new T.CylinderGeometry(radius * 0.55, radius * 0.55, width * 0.8, 20),
    new T.MeshStandardMaterial({
      color: "#c9ccd0",
      roughness: 0.35,
      metalness: 0.6,
    }),
  );
  tyre.castShadow = hub.castShadow = true;
  group.add(tyre, hub);
  return group;
}

/** Drawn planform area of one surface (∫ chord dy), for consistency checks. */
export function drawnArea(a: Aircraft, s: Surface) {
  const planform =
    (s.kind === "wing" ? a.visual?.wing : a.visual?.tail) ??
    ({ tipChordRatio: 1, tip: "square" } as Planform);
  const shape = surfaceShape(a, s, planform);
  let area = 0;
  const n = 2000;
  for (let i = 0; i < n; i++) {
    const y = -s.spanM / 2 + ((i + 0.5) / n) * s.spanM;
    area += (stationAt(shape, s.spanM, y).chord * s.spanM) / n;
  }
  return area;
}
