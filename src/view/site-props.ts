/**
 * Renders a site's static ground objects (see core/site-props.ts) with one
 * InstancedMesh per kind. Each kind is a single merged, vertex-coloured
 * geometry whose base rests exactly on the ground (min Y = 0); the instance
 * colour tints the body parts (white vertex colour) and leaves fixed parts
 * (tyres, glass, propellers) dark. Invisible instanced boxes from each kind's
 * bounds become solid collision obstacles.
 */
import * as T from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { PropKind, ResolvedProp } from "../core/site-props";

const BODY = "#ffffff";
const TYRE = "#1d1f21";
const GLASS = "#26313a";
const DARK = "#3a3d40";
const METAL = "#8c9195";

type Part = T.BufferGeometry;

function paint(g: T.BufferGeometry, color: string) {
  const c = new T.Color(color);
  const n = g.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute("color", new T.BufferAttribute(colors, 3));
  // Non-indexed parts merge cleanly with mixed primitive types.
  return g.index ? g.toNonIndexed() : g;
}
const box = (
  l: number,
  h: number,
  w: number,
  x: number,
  y: number,
  z: number,
  color = BODY,
) => paint(new T.BoxGeometry(l, h, w).translate(x, y, z), color);
/** Wheel: cylinder with its axle along Z, resting on y = 0. */
const wheel = (r: number, width: number, x: number, z: number, color = TYRE) =>
  paint(
    new T.CylinderGeometry(r, r, width, 14)
      .rotateX(Math.PI / 2)
      .translate(x, r, z),
    color,
  );
const rod = (
  r: number,
  length: number,
  x: number,
  y: number,
  z: number,
  color = METAL,
) => paint(new T.CylinderGeometry(r, r, length, 6).translate(x, y, z), color);
/** Propeller disc facing +X. */
const disc = (r: number, x: number, y: number) =>
  paint(
    new T.CylinderGeometry(r, r, 0.006, 18)
      .rotateZ(Math.PI / 2)
      .translate(x, y, 0),
    DARK,
  );
/** Thin flat triangle in the XZ plane (delta wings, jet wings). */
function triangle(
  points: [number, number][],
  thickness: number,
  y: number,
  color = BODY,
) {
  const shape = new T.Shape(points.map(([x, z]) => new T.Vector2(x, z)));
  const g = new T.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
  });
  // Shape XY → scene XZ (rotate so extrusion points up), then lift.
  g.rotateX(Math.PI / 2).translate(0, y + thickness, 0);
  return paint(g, color);
}

function partsOf(kind: PropKind): Part[] {
  switch (kind) {
    case "model-trainer":
      return [
        box(0.95, 0.12, 0.12, 0, 0.27, 0),
        box(0.25, 0.025, 1.45, 0.08, 0.35, 0),
        box(0.14, 0.05, 0.1, 0.12, 0.35, 0, GLASS),
        box(0.16, 0.014, 0.5, -0.42, 0.28, 0),
        box(0.17, 0.16, 0.012, -0.43, 0.36, 0),
        disc(0.115, 0.49, 0.27),
        rod(0.006, 0.2, 0.12, 0.13, 0.12),
        rod(0.006, 0.2, 0.12, 0.13, -0.12),
        wheel(0.045, 0.025, 0.12, 0.13),
        wheel(0.045, 0.025, 0.12, -0.13),
        wheel(0.035, 0.02, 0.38, 0),
        rod(0.006, 0.18, 0.38, 0.14, 0),
      ];
    case "model-warbird":
      return [
        box(0.92, 0.12, 0.12, 0, 0.21, 0),
        box(0.24, 0.025, 1.2, 0.1, 0.16, 0),
        box(0.16, 0.06, 0.08, 0.06, 0.29, 0, GLASS),
        box(0.14, 0.012, 0.42, -0.4, 0.23, 0),
        box(0.15, 0.13, 0.012, -0.41, 0.3, 0),
        disc(0.13, 0.47, 0.21),
        wheel(0.05, 0.025, 0.2, 0.15),
        wheel(0.05, 0.025, 0.2, -0.15),
        rod(0.006, 0.1, 0.2, 0.12, 0.15),
        rod(0.006, 0.1, 0.2, 0.12, -0.15),
        wheel(0.018, 0.012, -0.42, 0),
        rod(0.005, 0.15, -0.42, 0.09, 0),
      ];
    case "model-jet":
      return [
        box(1.0, 0.1, 0.11, 0, 0.09, 0),
        box(0.18, 0.05, 0.07, 0.25, 0.155, 0, GLASS),
        triangle(
          [
            [0.15, 0],
            [-0.32, 0.4],
            [-0.4, 0.4],
            [-0.3, 0],
            [-0.4, -0.4],
            [-0.32, -0.4],
          ],
          0.012,
          0.07,
        ),
        box(0.14, 0.12, 0.01, -0.4, 0.19, 0.06),
        box(0.14, 0.12, 0.01, -0.4, 0.19, -0.06),
        box(0.6, 0.04, 0.03, 0.05, 0.02, 0, DARK),
      ];
    case "model-delta":
      return [
        triangle(
          [
            [0.45, 0],
            [-0.42, 0.47],
            [-0.45, 0.47],
            [-0.36, 0],
            [-0.45, -0.47],
            [-0.42, -0.47],
          ],
          0.03,
          0.04,
        ),
        box(0.3, 0.05, 0.08, 0.1, 0.09, 0, GLASS),
        box(0.16, 0.14, 0.01, -0.36, 0.14, 0.18),
        box(0.16, 0.14, 0.01, -0.36, 0.14, -0.18),
        box(0.5, 0.04, 0.04, 0, 0.02, 0, DARK),
      ];
    case "car-sedan":
    case "car-hatchback":
    case "car-suv": {
      const [l, w, h] =
        kind === "car-sedan"
          ? [4.6, 1.8, 1.45]
          : kind === "car-hatchback"
            ? [4.0, 1.75, 1.5]
            : [4.7, 1.9, 1.72];
      const clearance = kind === "car-suv" ? 0.3 : 0.2,
        body = kind === "car-suv" ? 0.8 : 0.66,
        cabinHeight = h - clearance - body - 0.02;
      const cabinLength = kind === "car-sedan" ? l * 0.5 : l * 0.62,
        cabinShift = kind === "car-sedan" ? -0.1 : -0.35;
      const r = kind === "car-suv" ? 0.36 : 0.31;
      return [
        box(l, body, w, 0, clearance + body / 2, 0),
        box(
          cabinLength,
          cabinHeight,
          w * 0.86,
          cabinShift,
          clearance + body + cabinHeight / 2,
          0,
          GLASS,
        ),
        box(cabinLength * 0.92, 0.05, w * 0.84, cabinShift, h - 0.025, 0),
        box(
          0.06,
          body * 0.35,
          w * 0.7,
          l / 2,
          clearance + body * 0.35,
          0,
          DARK,
        ),
        ...[-1, 1].flatMap((sx) =>
          [-1, 1].map((sz) =>
            wheel(r, 0.22, sx * l * 0.32, sz * (w / 2 - 0.13)),
          ),
        ),
      ];
    }
    case "plastic-chair":
      return [
        box(0.46, 0.04, 0.46, 0, 0.45, 0),
        box(0.04, 0.38, 0.46, -0.22, 0.65, 0),
        ...[-1, 1].flatMap((sx) =>
          [-1, 1].map((sz) =>
            rod(0.018, 0.45, sx * 0.2, 0.225, sz * 0.2, BODY),
          ),
        ),
      ];
    case "camp-chair":
      return [
        box(0.46, 0.05, 0.46, 0, 0.42, 0),
        box(0.05, 0.45, 0.46, -0.24, 0.66, 0),
        box(0.4, 0.03, 0.05, 0, 0.6, 0.25, DARK),
        box(0.4, 0.03, 0.05, 0, 0.6, -0.25, DARK),
        ...[-1, 1].flatMap((sx) =>
          [-1, 1].map((sz) =>
            rod(0.012, 0.44, sx * 0.21, 0.22, sz * 0.22, METAL),
          ),
        ),
      ];
    case "table":
      return [
        box(1.4, 0.04, 0.8, 0, 0.73, 0),
        ...[-1, 1].flatMap((sx) =>
          [-1, 1].map((sz) =>
            rod(0.025, 0.71, sx * 0.62, 0.355, sz * 0.34, METAL),
          ),
        ),
      ];
    case "toolbox":
      return [
        box(0.5, 0.24, 0.28, 0, 0.12, 0),
        box(0.3, 0.06, 0.04, 0, 0.27, 0, DARK),
      ];
    case "model-stand":
      return [
        box(0.55, 0.04, 0.3, 0, 0.02, 0, DARK),
        box(0.06, 0.26, 0.26, 0.2, 0.17, 0),
        box(0.06, 0.26, 0.26, -0.2, 0.17, 0),
        box(0.06, 0.03, 0.26, 0.2, 0.31, 0, "#c96b2c"),
        box(0.06, 0.03, 0.26, -0.2, 0.31, 0, "#c96b2c"),
      ];
    case "field-box":
      return [
        box(0.45, 0.34, 0.35, 0, 0.17, 0),
        box(0.47, 0.06, 0.37, 0, 0.37, 0, METAL),
      ];
  }
}

const geometryCache = new Map<PropKind, T.BufferGeometry>();
/** Merged geometry of a kind at scale 1; its base rests on y = 0. */
export function propGeometry(kind: PropKind) {
  let g = geometryCache.get(kind);
  if (!g) {
    g = mergeGeometries(partsOf(kind))!;
    g.computeBoundingBox();
    // Seat the lowest point exactly on the ground.
    g.translate(0, -g.boundingBox!.min.y, 0);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    geometryCache.set(kind, g);
  }
  return g;
}

/** Adds every prop to the field: visible instances plus solid collision boxes. */
export function addSiteProps(field: T.Group, props: ResolvedProp[]) {
  const material = new T.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0.08,
  });
  const byKind = new Map<PropKind, ResolvedProp[]>();
  for (const p of props) byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p]);
  const dummy = new T.Object3D();
  const group = new T.Group();
  group.name = "site-props";
  for (const [kind, list] of byKind) {
    const geometry = propGeometry(kind);
    const mesh = new T.InstancedMesh(geometry, material, list.length);
    mesh.name = `prop:${kind}`;
    mesh.castShadow = mesh.receiveShadow = true;
    const bounds = geometry.boundingBox!;
    const size = bounds.getSize(new T.Vector3()),
      centre = bounds.getCenter(new T.Vector3());
    const collider = new T.InstancedMesh(
      new T.BoxGeometry(size.x, size.y, size.z).translate(
        centre.x,
        centre.y,
        centre.z,
      ),
      undefined,
      list.length,
    );
    collider.name = `prop-collider:${kind}`;
    collider.visible = false;
    collider.userData.collision = "solid";
    list.forEach((p, i) => {
      dummy.position.set(p.x, 0, p.z);
      dummy.rotation.set(0, p.yaw, 0);
      dummy.scale.setScalar(p.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      collider.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, new T.Color(p.color));
    });
    group.add(mesh, collider);
    // Soft contact shadow under each object (cheap, no shadow-map cost).
    if (typeof document === "undefined") continue;
    const blob = new T.InstancedMesh(
      new T.CircleGeometry(0.5, 20).rotateX(-Math.PI / 2),
      shadowBlobMaterial(),
      list.length,
    );
    blob.name = `prop-shadow:${kind}`;
    list.forEach((p, i) => {
      dummy.position.set(p.x, 0.045, p.z);
      dummy.rotation.set(0, p.yaw, 0);
      dummy.scale.set(size.x * 1.05 * p.scale, 1, size.z * 1.05 * p.scale);
      dummy.updateMatrix();
      blob.setMatrixAt(i, dummy.matrix);
    });
    blob.renderOrder = 1;
    group.add(blob);
  }
  field.add(group);
  return group;
}

let blobMaterial: T.MeshBasicMaterial | undefined;
function shadowBlobMaterial() {
  if (blobMaterial) return blobMaterial;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, "rgba(0,0,0,0.45)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  blobMaterial = new T.MeshBasicMaterial({
    map: new T.CanvasTexture(canvas),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  return blobMaterial;
}
