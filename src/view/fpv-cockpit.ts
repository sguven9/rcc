/**
 * Decorative scale cockpit in front of the FPV lens, modelled on the reference
 * FPV footage (a small printed cockpit the camera looks over): glare shield,
 * panel face with three glass displays, knobs, two round instruments and side
 * consoles. Real low-poly geometry, one merged mesh, one material with a
 * canvas texture atlas. The instruments are static artwork (needles in a fixed
 * pose); nothing is driven by the simulation and no branding is reproduced.
 *
 * Coordinates are the camera component's axes: +X along the lens, +Y right,
 * +Z down; metres from the housing centre. The panel sits just below the line
 * of sight, so it fills the lower part of a 90° FPV view.
 */
import * as T from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Atlas layout (UV rectangles, [u0, v0, u1, v1]). */
const SWATCH = {
  panel: [0.01, 0.01, 0.06, 0.06],
  shield: [0.01, 0.11, 0.06, 0.16],
  green: [0.01, 0.21, 0.06, 0.26],
  orange: [0.01, 0.31, 0.06, 0.36],
  red: [0.01, 0.41, 0.06, 0.46],
  bezel: [0.01, 0.51, 0.06, 0.56],
} as const;
const SCREEN = {
  pfd: [0.25, 0.0, 0.5, 1.0],
  map: [0.5, 0.0, 0.75, 1.0],
  engine: [0.75, 0.0, 1.0, 1.0],
  dial: [0.08, 0.6, 0.24, 0.98],
} as const;
type Rect = readonly [number, number, number, number];

function atlasTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  // Test canvases may lack 2D drawing: keep a blank atlas.
  if (!ctx || typeof ctx.save !== "function") return texture;
  const W = canvas.width,
    H = canvas.height;
  // Canvas y grows downward; UV v grows upward.
  const box = (r: Rect) =>
    [r[0] * W, (1 - r[3]) * H, (r[2] - r[0]) * W, (r[3] - r[1]) * H] as const;
  const fill = (r: Rect, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(...box(r));
  };
  fill([0, 0, 0.25, 1], "#16171a");
  fill(SWATCH.panel, "#17181b");
  fill(SWATCH.shield, "#0e0f10");
  fill(SWATCH.green, "#2fae78");
  fill(SWATCH.orange, "#e3a02a");
  fill(SWATCH.red, "#c8402e");
  fill(SWATCH.bezel, "#4f555b");
  // PFD: horizon slightly banked, pitch ladder, tapes, aircraft symbol.
  {
    const [x, y, w, h] = box(SCREEN.pfd);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(-0.08);
    ctx.fillStyle = "#2f6db2";
    ctx.fillRect(-w, -h, 2 * w, h);
    ctx.fillStyle = "#8a5a2c";
    ctx.fillRect(-w, 0, 2 * w, h);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3;
    for (const p of [-2, -1, 0, 1, 2]) {
      const half = p ? w * 0.12 : w;
      ctx.beginPath();
      ctx.moveTo(-half, p * h * 0.14);
      ctx.lineTo(half, p * h * 0.14);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x, y + h * 0.3, w * 0.22, h * 0.4);
    ctx.fillRect(x + w * 0.78, y + h * 0.3, w * 0.22, h * 0.4);
    ctx.strokeStyle = "#ffd23a";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.3, y + h / 2);
    ctx.lineTo(x + w * 0.45, y + h / 2);
    ctx.lineTo(x + w * 0.5, y + h * 0.56);
    ctx.lineTo(x + w * 0.55, y + h / 2);
    ctx.lineTo(x + w * 0.7, y + h / 2);
    ctx.stroke();
  }
  // Moving-map style display.
  {
    const [x, y, w, h] = box(SCREEN.map);
    ctx.fillStyle = "#16324a";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#3e6b3a";
    for (let i = 0; i < 6; i++)
      ctx.fillRect(
        x + w * 0.1 + i * w * 0.13,
        y + h * (0.2 + (i % 3) * 0.2),
        w * 0.1,
        h * 0.12,
      );
    ctx.strokeStyle = "#d9e3e8";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.15, y + h * 0.85);
    ctx.lineTo(x + w * 0.85, y + h * 0.15);
    ctx.stroke();
    ctx.fillStyle = "#ff8a5c";
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, h * 0.05, 0, Math.PI * 2);
    ctx.fill();
  }
  // Engine page: two arcs and bars.
  {
    const [x, y, w, h] = box(SCREEN.engine);
    ctx.fillStyle = "#0b1622";
    ctx.fillRect(x, y, w, h);
    ctx.lineWidth = 10;
    for (const [cx, value, color] of [
      [0.3, 0.65, "#2fae78"],
      [0.7, 0.4, "#e3a02a"],
    ] as const) {
      ctx.strokeStyle = "#2a3540";
      ctx.beginPath();
      ctx.arc(
        x + w * cx,
        y + h * 0.4,
        h * 0.18,
        Math.PI * 0.75,
        Math.PI * 2.25,
      );
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(
        x + w * cx,
        y + h * 0.4,
        h * 0.18,
        Math.PI * 0.75,
        Math.PI * (0.75 + 1.5 * value),
      );
      ctx.stroke();
    }
    ctx.fillStyle = "#2fae78";
    ctx.fillRect(x + w * 0.12, y + h * 0.75, w * 0.5, h * 0.06);
    ctx.fillStyle = "#3a8fd6";
    ctx.fillRect(x + w * 0.12, y + h * 0.86, w * 0.35, h * 0.06);
  }
  // Round dial face (shared by both small instruments), needle fixed.
  {
    const [x, y, w, h] = box(SCREEN.dial);
    const cx = x + w / 2,
      cy = y + h / 2,
      r = Math.min(w, h) * 0.46;
    ctx.fillStyle = "#0f1317";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#d8dee2";
    ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8);
      ctx.lineTo(cx + Math.cos(a) * r * 0.95, cy + Math.sin(a) * r * 0.95);
      ctx.stroke();
    }
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(-2.2) * r * 0.75, cy + Math.sin(-2.2) * r * 0.75);
    ctx.stroke();
  }
  texture.needsUpdate = true;
  return texture;
}

/** Map every face's 0..1 UVs into an atlas rectangle. */
function mapUv(g: T.BufferGeometry, r: Rect) {
  const uv = g.getAttribute("uv");
  for (let i = 0; i < uv.count; i++)
    uv.setXY(
      i,
      r[0] + uv.getX(i) * (r[2] - r[0]),
      r[1] + uv.getY(i) * (r[3] - r[1]),
    );
  return g.index ? g.toNonIndexed() : g;
}
const block = (
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
  r: Rect,
) => mapUv(new T.BoxGeometry(sx, sy, sz).translate(x, y, z), r);
/** Flat display facing the camera (−X), image upright for the viewer. */
function display(
  width: number,
  height: number,
  x: number,
  y: number,
  z: number,
  r: Rect,
) {
  const g = new T.PlaneGeometry(width, height);
  g.applyMatrix4(
    new T.Matrix4().makeBasis(
      new T.Vector3(0, 1, 0),
      new T.Vector3(0, 0, -1),
      new T.Vector3(-1, 0, 0),
    ),
  );
  return mapUv(g.translate(x, y, z), r);
}
/** Round knob or dial along X (facing the camera). */
function disc(
  radius: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  r: Rect,
) {
  return mapUv(
    new T.CylinderGeometry(radius, radius, depth, 16)
      .rotateZ(Math.PI / 2)
      .translate(x, y, z),
    r,
  );
}

let atlas: T.CanvasTexture | undefined;
/** Cockpit geometry relative to the lens at x = lensX (camera component axes). */
export function buildFpvCockpit(lensX: number) {
  if (typeof document === "undefined") return undefined;
  atlas ??= atlasTexture();
  const x0 = lensX + 0.034; // panel face distance from the lens
  const parts = [
    // Glare shield over the panel, slightly wider, top just below the sight line.
    block(0.016, 0.084, 0.005, x0 - 0.002, 0, 0.011, SWATCH.shield),
    block(0.01, 0.07, 0.004, x0 - 0.009, 0, 0.0135, SWATCH.shield),
    // Panel face and body.
    block(0.006, 0.078, 0.032, x0 + 0.003, 0, 0.03, SWATCH.panel),
    // Displays (pfd centre, map left, engine right), slightly proud of the face.
    display(0.021, 0.016, x0 - 0.0005, 0, 0.026, SCREEN.pfd),
    display(0.017, 0.013, x0 - 0.0005, -0.021, 0.027, SCREEN.map),
    display(0.017, 0.013, x0 - 0.0005, 0.021, 0.027, SCREEN.engine),
    // Display bezels.
    block(0.002, 0.024, 0.019, x0 + 0.0003, 0, 0.026, SWATCH.bezel),
    block(0.002, 0.02, 0.016, x0 + 0.0003, -0.021, 0.027, SWATCH.bezel),
    block(0.002, 0.02, 0.016, x0 + 0.0003, 0.021, 0.027, SWATCH.bezel),
    // Knobs along the glare shield (green, orange, green) and two switches.
    disc(0.0022, 0.004, x0 - 0.011, -0.006, 0.0105, SWATCH.green),
    disc(0.0022, 0.004, x0 - 0.011, 0, 0.0105, SWATCH.orange),
    disc(0.0022, 0.004, x0 - 0.011, 0.006, 0.0105, SWATCH.green),
    block(0.003, 0.002, 0.003, x0 - 0.001, -0.012, 0.039, SWATCH.red),
    block(0.003, 0.002, 0.003, x0 - 0.001, 0.012, 0.039, SWATCH.orange),
    // Small round instruments on the panel wings.
    disc(0.0055, 0.002, x0 - 0.0005, -0.034, 0.032, SCREEN.dial),
    disc(0.0055, 0.002, x0 - 0.0005, 0.034, 0.032, SCREEN.dial),
    disc(0.0065, 0.0015, x0 + 0.0002, -0.034, 0.032, SWATCH.bezel),
    disc(0.0065, 0.0015, x0 + 0.0002, 0.034, 0.032, SWATCH.bezel),
    // Side consoles running back toward the camera at the bottom corners.
    block(0.028, 0.012, 0.01, x0 - 0.012, -0.036, 0.045, SWATCH.panel),
    block(0.028, 0.012, 0.01, x0 - 0.012, 0.036, 0.045, SWATCH.panel),
  ];
  const mesh = new T.Mesh(
    mergeGeometries(parts)!,
    new T.MeshStandardMaterial({
      map: atlas,
      emissive: "#ffffff",
      emissiveMap: atlas,
      emissiveIntensity: 0.18,
      roughness: 0.55,
      metalness: 0.1,
    }),
  );
  mesh.name = "fpv-cockpit";
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
