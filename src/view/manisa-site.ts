import * as T from "three";
import { terrainMaterial } from "./terrain-material";

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
  color: "#27323b",
  roughness: 0.18,
  metalness: 0.5,
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
  overlay(
    field,
    { x: -0.9, z: -52.2, width: 27, depth: 14, yaw },
    concrete,
    0.036,
  );
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
  building(
    field,
    { x: -12.8, z: -67.6, width: 28, depth: 24, yaw },
    {
      wallHeight: 6,
      roofRise: 2.4,
      wall: white,
      roof: paleRoof,
      roofKind: "barrel",
      ridgeAlongDepth: true,
      door: { width: 20, height: 5.2, material: darkDoor },
      windows: { count: 10, width: 1.6, height: 0.7, sill: 4.6 },
      name: "manisa-hangar",
    },
  );
  building(
    field,
    { x: 30.8, z: -82.6, width: 17, depth: 16, yaw },
    {
      wallHeight: 3.6,
      roofRise: 2.2,
      wall: white,
      roof: paleRoof,
      roofKind: "hip",
      door: { width: 1.8, height: 2.3, material: darkDoor },
      windows: { count: 6, width: 1.3, height: 1.2, sill: 1 },
      name: "manisa-clubhouse",
    },
  );
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
