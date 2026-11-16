import * as T from "three";
import { surfaceTexture, terrainMaterial } from "./terrain-material";
import { MANISA_PROPS, manisaAnchors } from "../core/site-props";
import { addSiteProps } from "./site-props";

/**
 * Manisa Havacılık Sporları Tesisi, Manisa (38.7017° N, 27.4546° E).
 *
 * Original procedural geometry. Footprints, spacing and bearings were measured
 * from user-supplied aerial screenshots (scale ≈ 0.357 m/px from two on-image
 * distance measurements) and are approximate. No imagery is copied.
 *
 * Local axes are runway-aligned: +X is the runway 10 direction (true 103°),
 * +Z is true 193°, and the origin is where the taxiway meets the runway
 * centre line. Buildings lie on the −Z (north) side, next to the pilot.
 */
const BUILDING_YAW = T.MathUtils.degToRad(29.2);
const MAIN_ROAD = { x: 150.8, z: -163.5, yaw: T.MathUtils.degToRad(-29.9) };

type Footprint = {
  x: number;
  z: number;
  width: number;
  depth: number;
  yaw: number;
};

/** Axis-aligned collision cells covering a rotated footprint (NED snapshot boxes). */
function addColliders(
  field: T.Group,
  f: Footprint,
  height: number,
  name: string,
) {
  const cell = 4,
    nx = Math.max(1, Math.ceil(f.width / cell)),
    nz = Math.max(1, Math.ceil(f.depth / cell));
  const cw = f.width / nx,
    cd = f.depth / nz;
  const c = Math.cos(f.yaw),
    s = Math.sin(f.yaw);
  // Box local X → (cos, −sin) and local Z → (sin, cos) in view X/Z.
  const ax = cw * Math.abs(c) + cd * Math.abs(s),
    az = cw * Math.abs(s) + cd * Math.abs(c);
  const geometry = new T.BoxGeometry(ax, height, az);
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      const u = (i + 0.5) * cw - f.width / 2,
        v = (j + 0.5) * cd - f.depth / 2;
      const proxy = new T.Mesh(geometry);
      proxy.visible = false;
      proxy.name = name;
      proxy.position.set(f.x + u * c + v * s, height / 2, f.z - u * s + v * c);
      proxy.userData.collision = "solid";
      field.add(proxy);
    }
}

/** Flat overlay on the ground plane; polygon offset prevents depth fighting. */
function overlay(
  field: T.Group,
  f: Footprint,
  material: T.Material,
  lift: number,
) {
  const mesh = new T.Mesh(new T.PlaneGeometry(f.width, f.depth), material);
  mesh.rotation.set(-Math.PI / 2, 0, f.yaw);
  mesh.position.set(f.x, lift, f.z);
  mesh.receiveShadow = true;
  field.add(mesh);
  return mesh;
}

const glass = new T.MeshStandardMaterial({
  color: "#5d707c",
  roughness: 0.12,
  metalness: 0.35,
});

/** Tileable furrow stripes (1.6 m pitch) for ploughed ground, as an alpha overlay.
 * Smooth sinusoidal rows and low contrast avoid moiré where mipmaps blend them. */
function furrowMaterial() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y++) {
    const wave = Math.sin((2 * Math.PI * y) / 16);
    ctx.fillStyle =
      wave > 0
        ? `rgba(52,38,26,${(0.16 * wave).toFixed(3)})`
        : `rgba(236,216,190,${(-0.07 * wave).toFixed(3)})`;
    ctx.fillRect(0, y, 256, 1);
  }
  const map = new T.CanvasTexture(canvas);
  map.wrapS = map.wrapT = T.RepeatWrapping;
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 8;
  return new T.MeshStandardMaterial({
    map,
    transparent: true,
    depthWrite: false,
    roughness: 1,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

/** Dashed white centre line (3 m dash, 6 m gap) for a two-lane road. */
function centreLineMaterial(length: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 4;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 64, 4);
  ctx.fillStyle = "#e9e7df";
  ctx.fillRect(0, 0, 21, 4);
  const map = new T.CanvasTexture(canvas);
  map.wrapS = T.RepeatWrapping;
  map.repeat.set(length / 9, 1);
  map.colorSpace = T.SRGBColorSpace;
  return new T.MeshStandardMaterial({
    map,
    transparent: true,
    depthWrite: false,
    roughness: 0.7,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
}

function flatMaterial(color: string, roughness = 0.95) {
  return new T.MeshStandardMaterial({
    color,
    roughness,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

function cropMaterial(tint: string) {
  const m = terrainMaterial(true);
  m.color.set(tint);
  m.polygonOffset = true;
  m.polygonOffsetFactor = -1;
  m.polygonOffsetUnits = -1;
  return m;
}

/** Walls, roof and a door face toward local +Z (the runway side). */
function building(
  field: T.Group,
  f: Footprint,
  options: {
    wallHeight: number;
    roofRise: number;
    wall: T.Material;
    roof: T.Material;
    roofKind: "gable" | "hip" | "barrel";
    /** Ridge along the footprint width (default) or depth. */
    ridgeAlongDepth?: boolean;
    door?: { width: number; height: number; material: T.Material };
    /** Evenly spaced windows on both long (±Z) faces, skipping the door. */
    windows?: { count: number; width: number; height: number; sill: number };
    name: string;
  },
) {
  const group = new T.Group();
  group.position.set(f.x, 0, f.z);
  group.rotation.y = f.yaw;
  field.add(group);
  const walls = new T.Mesh(
    new T.BoxGeometry(f.width, options.wallHeight, f.depth),
    options.wall,
  );
  walls.position.y = options.wallHeight / 2;
  walls.castShadow = walls.receiveShadow = true;
  group.add(walls);
  const overhang = 0.4,
    span = options.ridgeAlongDepth ? f.width : f.depth,
    run = options.ridgeAlongDepth ? f.depth : f.width;
  let roof: T.Mesh;
  if (options.roofKind === "hip") {
    // Square pyramid of unit base, turned before the non-uniform scale.
    const pyramid = new T.ConeGeometry(Math.SQRT1_2, 1, 4, 1);
    pyramid.rotateY(Math.PI / 4);
    roof = new T.Mesh(pyramid, options.roof);
    roof.scale.set(
      f.width + overhang * 2,
      options.roofRise,
      f.depth + overhang * 2,
    );
    roof.position.y = options.wallHeight + options.roofRise / 2;
  } else {
    const shape = new T.Shape();
    const half = span / 2 + overhang;
    if (options.roofKind === "barrel") {
      shape.moveTo(-half, 0);
      shape.absellipse(0, 0, half, options.roofRise, Math.PI, 0, true);
      shape.lineTo(-half, 0);
    } else {
      shape.moveTo(-half, 0);
      shape.lineTo(half, 0);
      shape.lineTo(0, options.roofRise);
      shape.closePath();
    }
    const geometry = new T.ExtrudeGeometry(shape, {
      depth: run + overhang * 2,
      bevelEnabled: false,
      curveSegments: 10,
    });
    geometry.translate(0, 0, -(run + overhang * 2) / 2);
    roof = new T.Mesh(geometry, options.roof);
    // Extrusion runs along local Z; turn it so the ridge follows `run`.
    if (!options.ridgeAlongDepth) roof.rotation.y = Math.PI / 2;
    roof.position.y = options.wallHeight;
  }
  roof.castShadow = roof.receiveShadow = true;
  group.add(roof);
  if (options.door) {
    const door = new T.Mesh(
      new T.BoxGeometry(options.door.width, options.door.height, 0.08),
      options.door.material,
    );
    door.position.set(0, options.door.height / 2, f.depth / 2 + 0.03);
    group.add(door);
  }
  if (options.windows) {
    const w = options.windows,
      spots: [number, number][] = [];
    for (const side of [-1, 1])
      for (let i = 0; i < w.count; i++) {
        const x = -f.width / 2 + ((i + 0.5) * f.width) / w.count;
        const doorHalf = options.door ? options.door.width / 2 + 0.4 : -1;
        if (side > 0 && Math.abs(x) < doorHalf + w.width / 2) continue;
        spots.push([x, side * (f.depth / 2 + 0.03)]);
      }
    const panes = new T.InstancedMesh(
      new T.BoxGeometry(w.width, w.height, 0.06),
      glass,
      spots.length,
    );
    const dummy = new T.Object3D();
    spots.forEach(([x, z], i) => {
      dummy.position.set(x, w.sill + w.height / 2, z);
      dummy.updateMatrix();
      panes.setMatrixAt(i, dummy.matrix);
    });
    group.add(panes);
  }
  addColliders(field, f, options.wallHeight + options.roofRise, options.name);
}

/** Posts collide individually; the wire mesh is visual only. */
function fenceLine(
  field: T.Group,
  points: [number, number][],
  spacing: number,
  height: number,
  post: T.Material,
  wire: T.Material,
  name: string,
) {
  const positions: [number, number][] = [];
  for (let k = 0; k < points.length - 1; k++) {
    const [x0, z0] = points[k],
      [x1, z1] = points[k + 1];
    const length = Math.hypot(x1 - x0, z1 - z0),
      n = Math.max(1, Math.round(length / spacing));
    for (let i = 0; i < n; i++)
      positions.push([x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n]);
    const rail = new T.Mesh(
      new T.BoxGeometry(length, height * 0.85, 0.02),
      wire,
    );
    rail.position.set((x0 + x1) / 2, height * 0.5, (z0 + z1) / 2);
    rail.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    field.add(rail);
  }
  positions.push(points.at(-1)!);
  const posts = new T.InstancedMesh(
    new T.CylinderGeometry(0.04, 0.04, height, 6),
    post,
    positions.length,
  );
  const dummy = new T.Object3D();
  positions.forEach(([x, z], i) => {
    dummy.position.set(x, height / 2, z);
    dummy.updateMatrix();
    posts.setMatrixAt(i, dummy.matrix);
  });
  posts.name = name;
  posts.castShadow = true;
  posts.userData.collision = "solid";
  field.add(posts);
}

/** Footprint corners in local X/Z after rotation, for fences around pads. */
function corners(f: Footprint, margin: number): [number, number][] {
  const c = Math.cos(f.yaw),
    s = Math.sin(f.yaw);
  const w = f.width / 2 + margin,
    d = f.depth / 2 + margin;
  return (
    [
      [-w, -d],
      [w, -d],
      [w, d],
      [-w, d],
      [-w, -d],
    ] as const
  ).map(([u, v]) => [f.x + u * c + v * s, f.z - u * s + v * c]);
}

export function addManisaSite(field: T.Group) {
  const yaw = BUILDING_YAW;
  // Ground overlays: fields beyond the main road, then roads and paved areas.
  const along = (t: number, offset: number): [number, number] => [
    MAIN_ROAD.x +
      t * Math.cos(-MAIN_ROAD.yaw) -
      offset * Math.sin(MAIN_ROAD.yaw),
    MAIN_ROAD.z +
      t * Math.sin(-MAIN_ROAD.yaw) -
      offset * Math.cos(MAIN_ROAD.yaw),
  ];
  for (const [tMin, tMax, oMin, oMax, tint] of [
    [-120, 90, 6, 110, "#f2d79a"], // wheat stubble
    [95, 330, 6, 150, "#b88472"], // red-brown ploughed soil
    [-330, -125, 6, 110, "#a7b08a"], // green crop
  ] as const) {
    // Positive offset is the far side of the road from the runway.
    const [x, z] = along((tMin + tMax) / 2, (oMin + oMax) / 2);
    overlay(
      field,
      { x, z, width: tMax - tMin, depth: oMax - oMin, yaw: MAIN_ROAD.yaw },
      cropMaterial(tint),
      0.02,
    );
  }
  const asphalt = flatMaterial("#5c5f60", 0.9),
    gravel = flatMaterial("#c4b79e"),
    concrete = flatMaterial("#c9c5bb", 0.92);
  overlay(
    field,
    {
      x: MAIN_ROAD.x,
      z: MAIN_ROAD.z,
      width: 3000,
      depth: 7,
      yaw: MAIN_ROAD.yaw,
    },
    asphalt,
    0.04,
  );
  overlay(
    field,
    {
      x: MAIN_ROAD.x,
      z: MAIN_ROAD.z,
      width: 3000,
      depth: 0.15,
      yaw: MAIN_ROAD.yaw,
    },
    centreLineMaterial(3000),
    0.045,
  );
  // Furrows on the ploughed land either side of the runway strip, laid
  // parallel to the runway as in the aerial view. Roads and pads sit above.
  for (const [z, depth] of [
    [-166, 300],
    [166, 300],
  ] as const) {
    const furrows = furrowMaterial();
    furrows.map!.repeat.set(900 / 25.6, depth / 25.6);
    overlay(field, { x: 0, z, width: 900, depth, yaw: 0 }, furrows, 0.012);
  }
  // Access road from the taxiway to the main road (measured ≈ 6–8 m wide).
  overlay(
    field,
    {
      x: 79.75,
      z: -98.25,
      width: 200.9,
      depth: 6,
      yaw: T.MathUtils.degToRad(34.8),
    },
    gravel,
    0.03,
  );
  // Taxiway: runway edge to access road, ≈ 29 m long, 7 m wide.
  overlay(
    field,
    { x: 0.15, z: -24.5, width: 7, depth: 33.5, yaw: 0 },
    concrete,
    0.035,
  );
  // Hangar apron with door rail, taxi line and parking boxes (see apronMaterial).
  overlay(
    field,
    { x: -0.9, z: -52.2, width: 27, depth: 14, yaw },
    apronMaterial(27, 14, hangarApronMarkings),
    0.036,
  );
  // Clubhouse forecourt and the concrete path lined with parked models.
  const club = manisaAnchors.clubhouse;
  const at = (u: number, v: number) => ({
    x: club.x + u * Math.cos(yaw) + v * Math.sin(yaw),
    z: club.z - u * Math.sin(yaw) + v * Math.cos(yaw),
  });
  overlay(
    field,
    { ...at(0, 11), width: 22, depth: 6, yaw },
    apronMaterial(22, 6, clubPathMarkings),
    0.037,
  );
  // Gravel parking west of the clubhouse.
  overlay(
    field,
    { ...at(-17.2, 2.2), width: 14, depth: 7, yaw },
    gravel,
    0.033,
  );
  // Mown grass around the buildings and along the runway (soft-edged).
  for (const [f, seed] of [
    [{ x: 8, z: -66, width: 92, depth: 58, yaw }, 3],
    [{ x: 0, z: -24, width: 420, depth: 30, yaw: 0 }, 7],
    [{ x: 0, z: 24, width: 420, depth: 30, yaw: 0 }, 11],
  ] as [Footprint, number][])
    overlay(field, f, grassPatchMaterial(f.width, f.depth, seed), 0.016);
  const pad: Footprint = { x: 63.1, z: -110.4, width: 63.5, depth: 28.6, yaw };
  overlay(field, pad, concrete, 0.034);

  const white = new T.MeshStandardMaterial({
      color: "#e6e6e0",
      roughness: 0.8,
    }),
    cream = new T.MeshStandardMaterial({ color: "#d9cdb6", roughness: 0.9 }),
    redRoof = new T.MeshStandardMaterial({ color: "#8c2f2a", roughness: 0.75 }),
    paleRoof = new T.MeshStandardMaterial({
      color: "#d8dad7",
      roughness: 0.55,
      metalness: 0.2,
    }),
    darkDoor = new T.MeshStandardMaterial({
      color: "#878c8f",
      roughness: 0.5,
      metalness: 0.35,
    }),
    steel = new T.MeshStandardMaterial({
      color: "#6c7473",
      roughness: 0.6,
      metalness: 0.3,
    }),
    mesh = new T.MeshStandardMaterial({
      color: "#9aa3a2",
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      side: T.DoubleSide,
    });
  hangar(field, { x: -12.8, z: -67.6, width: 28, depth: 24, yaw });
  clubhouse(field, { x: 30.8, z: -82.6, width: 17, depth: 16, yaw });
  addSiteProps(field, MANISA_PROPS);
  building(
    field,
    { x: 52.9, z: -103.9, width: 22, depth: 13, yaw },
    {
      wallHeight: 3.8,
      roofRise: 2.4,
      wall: cream,
      roof: redRoof,
      roofKind: "gable",
      door: { width: 2, height: 2.4, material: darkDoor },
      windows: { count: 7, width: 1.3, height: 1.2, sill: 1 },
      name: "manisa-red-building",
    },
  );
  building(
    field,
    { x: 77.3, z: -124.5, width: 15, depth: 18, yaw },
    {
      wallHeight: 3.8,
      roofRise: 2.6,
      wall: cream,
      roof: redRoof,
      roofKind: "gable",
      ridgeAlongDepth: true,
      door: { width: 2, height: 2.4, material: darkDoor },
      windows: { count: 7, width: 1.3, height: 1.2, sill: 1 },
      name: "manisa-red-building",
    },
  );
  building(
    field,
    { x: 134.8, z: -149.7, width: 8, depth: 8, yaw },
    {
      wallHeight: 2.8,
      roofRise: 0.8,
      wall: white,
      roof: paleRoof,
      roofKind: "gable",
      windows: { count: 1, width: 0.9, height: 0.8, sill: 1.2 },
      name: "manisa-shed",
    },
  );
  // Separate compound south of the runway, behind a long boundary fence.
  building(
    field,
    { x: -39.5, z: 66.8, width: 12, depth: 11, yaw },
    {
      wallHeight: 3.2,
      roofRise: 1.2,
      wall: white,
      roof: paleRoof,
      roofKind: "gable",
      windows: { count: 4, width: 1.2, height: 1.1, sill: 1 },
      name: "manisa-south-building",
    },
  );
  fenceLine(field, corners(pad, 0.6), 3, 1.8, steel, mesh, "manisa-fence");
  fenceLine(
    field,
    [
      [-180, 66.8],
      [140, 83],
    ],
    4,
    1.6,
    steel,
    mesh,
    "manisa-boundary-fence",
  );
}

/** Wind-sock mast beside the taxiway, clear of the pilot position. */
export const manisaWindsock = { x: 14, z: -22 };

// --------------------------------------------------------------------------
// Details from the 2026-11-16 reference photos (drone and FPV): textured
// aprons with markings, mown grass, the gable steel hangar and the two-storey
// teal clubhouse with its open ground floor. Colours are approximate; no
// signage, logo or text from the photos is reproduced.

/** Light/dark vertical ribs of profiled steel sheet (≈0.25 m pitch). */
function corrugatedMaterial(color: string, lengthM: number, roughness = 0.6) {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 4;
  const ctx = canvas.getContext("2d")!;
  for (let x = 0; x < 32; x++) {
    const shade = 0.86 + 0.14 * Math.cos((2 * Math.PI * x) / 32);
    const v = Math.round(255 * shade);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(x, 0, 1, 4);
  }
  const map = new T.CanvasTexture(canvas);
  map.wrapS = map.wrapT = T.RepeatWrapping;
  map.repeat.set(Math.round(lengthM / 0.25), 1);
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 4;
  return new T.MeshStandardMaterial({ color, map, roughness, metalness: 0.15 });
}

type Markings = (ctx: CanvasRenderingContext2D, w: number, d: number) => void;

/**
 * Concrete apron texture in metres: 4 m slabs with sealed joints, per-slab
 * tone, oil stains, then markings. Canvas x runs along the footprint width
 * (u), canvas y toward its front (+v, the runway side).
 */
function apronMaterial(width: number, depth: number, markings: Markings) {
  const px = 24,
    canvas = document.createElement("canvas");
  canvas.width = Math.round(width * px);
  canvas.height = Math.round(depth * px);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(px, px);
  let seed = Math.round(width * 31 + depth * 7);
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let x = 0; x < width; x += 4)
    for (let y = 0; y < depth; y += 4) {
      const t = 196 + Math.round((rand() - 0.5) * 14);
      ctx.fillStyle = `rgb(${t + 6},${t + 3},${t - 4})`;
      ctx.fillRect(x, y, 4, 4);
    }
  for (let i = 0; i < width * depth * 0.6; i++) {
    ctx.fillStyle = `rgba(${rand() < 0.6 ? "78,72,64" : "232,228,218"},${0.04 + rand() * 0.06})`;
    ctx.beginPath();
    ctx.ellipse(
      rand() * width,
      rand() * depth,
      0.05 + rand() * 0.35,
      0.04 + rand() * 0.2,
      rand() * Math.PI,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(70,66,60,0.55)";
  ctx.lineWidth = 0.05;
  for (let x = 4; x < width; x += 4) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, depth);
    ctx.stroke();
  }
  for (let y = 4; y < depth; y += 4) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  markings(ctx, width, depth);
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 8;
  return new T.MeshStandardMaterial({
    map,
    roughness: 0.9,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

/**
 * Hangar apron (27 × 14 m, its centre 2.9 m right of the door axis): sliding
 * door rails, a yellow lead-in line from the door and parking boxes under
 * the parked models (core/site-props.ts).
 */
const hangarApronMarkings: Markings = (ctx, w) => {
  const doorAxis = w / 2 - 2.88; // apron x of hangar u = 0
  ctx.fillStyle = "#3b3d3e";
  for (const y of [0.12, 0.42]) ctx.fillRect(doorAxis - 10.2, y, 20.4, 0.08);
  ctx.fillStyle = "rgba(226,182,44,0.88)";
  ctx.fillRect(doorAxis - 0.08, 0.8, 0.16, 13.2);
  ctx.strokeStyle = "rgba(240,240,232,0.8)";
  ctx.lineWidth = 0.1;
  for (const u of [-7.5, -4.3, -1.1, 2.1])
    ctx.strokeRect(doorAxis + u - 1.05, 2.95 - 0.95, 2.1, 1.9);
};
const clubPathMarkings: Markings = (ctx, w, d) => {
  ctx.fillStyle = "rgba(240,240,232,0.55)";
  ctx.fillRect(0.2, d - 0.35, w - 0.4, 0.1);
};

/**
 * Mown grass from the local turf scan with soft, irregular edges blending into
 * the soil (alpha mask), and broad fresh/dry variation from world-space noise
 * so the scan's repeat is not visible at range.
 */
function grassPatchMaterial(width: number, depth: number, seed: number) {
  const size = 256,
    canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const pixels = new Uint8ClampedArray(size * size * 4);
  const hash = (x: number, y: number) => {
    const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const noise = (x: number, y: number) => {
    const ix = Math.floor(x),
      iy = Math.floor(y),
      fx = x - ix,
      fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx),
      sy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy),
      b = hash(ix + 1, iy),
      c = hash(ix, iy + 1),
      d = hash(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  const feather = Math.min(8, Math.min(width, depth) * 0.3);
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const x = ((i + 0.5) / size) * width,
        y = ((j + 0.5) / size) * depth;
      const edge = Math.min(x, width - x, y, depth - y);
      const wobble = (noise(x * 0.15, y * 0.15) - 0.5) * feather * 1.2;
      const a = Math.max(0, Math.min(1, (edge + wobble) / feather));
      // Bare patches inside the grass (worn spots, molehills).
      const bare = noise(x * 0.4 + 9, y * 0.4 + 3) > 0.86 ? 0.7 : 1;
      const v = Math.round(255 * a * a * (3 - 2 * a) * bare);
      pixels.set([v, v, v, 255], (j * size + i) * 4);
    }
  // Test canvases may not implement image data; the mask is then plain.
  const image = ctx.createImageData?.(size, size);
  if (image?.data) {
    image.data.set(pixels);
    ctx.putImageData(image, 0, 0);
  }
  const alphaMap = new T.CanvasTexture(canvas);
  const map = surfaceTexture("lite/turf-color.jpg", true);
  map.repeat.set(width / 2.2, depth / 2.2);
  const material = new T.MeshStandardMaterial({
    map,
    alphaMap,
    transparent: true,
    depthWrite: false,
    roughness: 1,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vGrassWorld;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvGrassWorld = (modelMatrix * vec4(position, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vGrassWorld;",
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        vec2 gp = vGrassWorld.xz;
        float gn = sin(gp.x * 0.071 + sin(gp.y * 0.053) * 2.3) * 0.5 + 0.5;
        float gm = sin(gp.y * 0.19 + sin(gp.x * 0.17) * 1.7) * 0.5 + 0.5;
        float dry = smoothstep(0.35, 0.85, gn * 0.7 + gm * 0.3);
        // Olive green (≈#7a8250) to straw (≈#b9a877), as photographed; the
        // scan only supplies blade-scale brightness detail.
        float grassLum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)) / 0.134;
        vec3 palette = mix(vec3(0.17, 0.20, 0.075), vec3(0.40, 0.33, 0.16), dry);
        diffuseColor.rgb = palette * clamp(grassLum, 0.55, 1.45) * (0.92 + 0.16 * gm);`,
      );
  };
  material.customProgramCacheKey = () => "manisa-grass-v1";
  return material;
}

/** Gable steel hangar: profiled walls, twin sliding doors on a rail, high windows. */
function hangar(field: T.Group, f: Footprint) {
  const wallHeight = 6,
    roofRise = 2.6;
  const group = new T.Group();
  group.position.set(f.x, 0, f.z);
  group.rotation.y = f.yaw;
  field.add(group);
  const walls = new T.Mesh(
    new T.BoxGeometry(f.width, wallHeight, f.depth),
    corrugatedMaterial("#e3e5e2", f.width),
  );
  walls.position.y = wallHeight / 2;
  walls.castShadow = walls.receiveShadow = true;
  group.add(walls);
  // Gable roof, ridge toward the doors (door in the gable end, as photographed).
  const half = f.width / 2 + 0.4;
  const shape = new T.Shape();
  shape.moveTo(-half, 0);
  shape.lineTo(half, 0);
  shape.lineTo(0, roofRise);
  shape.closePath();
  const roofGeometry = new T.ExtrudeGeometry(shape, {
    depth: f.depth + 0.8,
    bevelEnabled: false,
  }).translate(0, 0, -(f.depth + 0.8) / 2);
  const roof = new T.Mesh(
    roofGeometry,
    corrugatedMaterial("#cdd1d0", f.depth, 0.5),
  );
  roof.position.y = wallHeight;
  roof.castShadow = roof.receiveShadow = true;
  group.add(roof);
  const doorMaterial = corrugatedMaterial("#b7bcbc", 10, 0.45);
  for (const [x, offset] of [
    [-4.95, 0.06],
    [4.95, 0.16],
  ] as const) {
    const door = new T.Mesh(new T.BoxGeometry(9.9, 5.4, 0.08), doorMaterial);
    door.position.set(x, 2.7, f.depth / 2 + offset);
    door.castShadow = true;
    group.add(door);
  }
  const rail = new T.Mesh(
    new T.BoxGeometry(20.6, 0.22, 0.22),
    new T.MeshStandardMaterial({
      color: "#5c6062",
      metalness: 0.5,
      roughness: 0.5,
    }),
  );
  rail.position.set(0, 5.55, f.depth / 2 + 0.2);
  group.add(rail);
  const personnel = new T.Mesh(
    new T.BoxGeometry(1, 2.1, 0.06),
    new T.MeshStandardMaterial({ color: "#6f7476", roughness: 0.5 }),
  );
  personnel.position.set(12.2, 1.05, f.depth / 2 + 0.04);
  group.add(personnel);
  const spots: [number, number, number][] = [];
  for (const side of [-1, 1])
    for (let i = 0; i < 6; i++)
      spots.push([
        side * (f.width / 2 + 0.03),
        4.6,
        -f.depth / 2 + 2.5 + i * 3.8,
      ]);
  const panes = new T.InstancedMesh(
    new T.BoxGeometry(0.06, 0.7, 1.8),
    glass,
    spots.length,
  );
  const dummy = new T.Object3D();
  spots.forEach(([x, y, z], i) => {
    dummy.position.set(x, y, z);
    dummy.updateMatrix();
    panes.setMatrixAt(i, dummy.matrix);
  });
  group.add(panes);
  addColliders(field, f, wallHeight + roofRise, "manisa-hangar");
}

/**
 * Two-storey teal clubhouse: open ground floor on pillars (seating and
 * models underneath), enclosed upper floor with a wide window, low hip roof
 * of grey profiled sheet with a maroon eave trim, and an outside stair.
 */
function clubhouse(field: T.Group, f: Footprint) {
  const group = new T.Group();
  group.position.set(f.x, 0, f.z);
  group.rotation.y = f.yaw;
  field.add(group);
  const teal = new T.MeshStandardMaterial({
      color: "#7fcfc2",
      roughness: 0.92,
    }),
    trim = new T.MeshStandardMaterial({ color: "#6d2b25", roughness: 0.7 }),
    slabMaterial = new T.MeshStandardMaterial({
      color: "#d9d5cc",
      roughness: 0.9,
    });
  const add = (
    geometry: T.BufferGeometry,
    material: T.Material,
    x: number,
    y: number,
    z: number,
  ) => {
    const mesh = new T.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const halfD = f.depth / 2;
  // Ground floor: enclosed rear rooms, open front bay on pillars.
  add(new T.BoxGeometry(f.width, 3, 9), teal, 0, 1.5, -halfD + 4.5);
  for (const u of [-8.1, -2.7, 2.7, 8.1])
    add(new T.BoxGeometry(0.45, 3, 0.45), teal, u, 1.5, halfD - 0.4);
  add(
    new T.BoxGeometry(f.width + 0.2, 0.35, f.depth + 0.2),
    slabMaterial,
    0,
    3.175,
    0,
  );
  // Upper floor and its windows.
  add(new T.BoxGeometry(f.width, 3, f.depth), teal, 0, 4.85, 0);
  add(new T.BoxGeometry(7, 2, 0.06), glass, -2, 4.9, halfD + 0.03);
  add(new T.BoxGeometry(2.4, 1.4, 0.06), glass, 5.4, 5, halfD + 0.03);
  for (const z of [-4, 2])
    for (const side of [-1, 1])
      add(
        new T.BoxGeometry(0.06, 1.3, 1.8),
        glass,
        side * (f.width / 2 + 0.03),
        5,
        z,
      );
  add(new T.BoxGeometry(2.6, 2.2, 0.06), glass, -4, 1.3, -halfD + 9.03);
  // Low hip roof with a maroon eave band.
  const pyramid = new T.ConeGeometry(Math.SQRT1_2, 1, 4, 1);
  pyramid.rotateY(Math.PI / 4);
  const roof = new T.Mesh(
    pyramid,
    corrugatedMaterial("#c8cccb", f.width, 0.55),
  );
  roof.scale.set(f.width + 1, 1.3, f.depth + 1);
  roof.position.y = 6.35 + 0.65;
  roof.castShadow = roof.receiveShadow = true;
  group.add(roof);
  add(new T.BoxGeometry(f.width + 1, 0.28, 0.12), trim, 0, 6.3, halfD + 0.5);
  add(new T.BoxGeometry(f.width + 1, 0.28, 0.12), trim, 0, 6.3, -halfD - 0.5);
  add(
    new T.BoxGeometry(0.12, 0.28, f.depth + 1),
    trim,
    f.width / 2 + 0.5,
    6.3,
    0,
  );
  add(
    new T.BoxGeometry(0.12, 0.28, f.depth + 1),
    trim,
    -f.width / 2 - 0.5,
    6.3,
    0,
  );
  // Outside stair along the east wall.
  const steps = new T.InstancedMesh(
    new T.BoxGeometry(1.1, 0.18, 0.3),
    slabMaterial,
    16,
  );
  const dummy = new T.Object3D();
  for (let i = 0; i < 16; i++) {
    dummy.position.set(f.width / 2 + 0.6, 0.09 + i * 0.2, 6 - i * 0.3);
    dummy.updateMatrix();
    steps.setMatrixAt(i, dummy.matrix);
  }
  steps.castShadow = true;
  group.add(steps);
  addColliders(field, f, 7.7, "manisa-clubhouse");
}
