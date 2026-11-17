import * as T from "three";
import { isClearArea, type Scenery } from "../core/scenery";
import { seededRandom, terrainNoise as noise } from "./terrain-material";

import { renderBudget } from "./render-budget";
import { mountainMaterial } from "./mountain-material";
import alpineTerrain from "./data/alpine-height.json";
import mesaTerrain from "./data/mesa-height.json";

/** Bilinear sampling of metre-valued DEM data; field clearing is a deliberate visual edit. */
export function landscapeHeight(x: number, z: number, profile: Scenery) {
  const radius = Math.hypot(x, z);
  const rise = T.MathUtils.smoothstep(radius, 430, 1100);
  if (profile.surface === "asphalt") {
    // Overlapping asymmetric ridges leave saddles/open horizons instead of a
    // smooth circular wall. The central operating field remains physically flat.
    const broad = noise(x * 0.0008 + profile.seed, z * 0.0008);
    const ridge = Math.max(
      0,
      1 - Math.abs(noise(x * 0.0018 + 4.1, z * 0.0013) * 2 - 1),
    );
    const rolling =
      broad * broad * 115 + ridge ** 3 * 45 + noise(x * 0.007, z * 0.005) * 7;
    const clearing = T.MathUtils.smoothstep(Math.hypot(x / 1.3, z), 380, 1250);
    return rolling * clearing - 1.5;
  }
  const data = profile.surface === "grass" ? alpineTerrain : mesaTerrain;
  const u = T.MathUtils.clamp(
    (x / data.extentM + 0.5) * (data.grid - 1),
    0,
    data.grid - 1.0001,
  );
  const v = T.MathUtils.clamp(
    (z / data.extentM + 0.5) * (data.grid - 1),
    0,
    data.grid - 1.0001,
  );
  const col = Math.floor(u),
    row = Math.floor(v),
    i = row * data.grid + col;
  const a = T.MathUtils.lerp(
    data.elevationsM[i],
    data.elevationsM[i + 1],
    u - col,
  );
  const b = T.MathUtils.lerp(
    data.elevationsM[i + data.grid],
    data.elevationsM[i + data.grid + 1],
    u - col,
  );
  const elevation = Math.max(0, T.MathUtils.lerp(a, b, v - row) - data.datumM);
  return elevation * rise - 1.5;
}

// The renderer and vegetation must sample the same triangles. Sampling the
// underlying height function directly can leave trees metres above a coarse DEM.
const terrainExtent = 6000;
export function landscapeGridPosition(index: number) {
  const unit = (index / renderBudget.terrainSegments) * 2 - 1;
  return Math.sign(unit) * terrainExtent * Math.abs(unit) ** 1.45;
}

export function landscapeSurfaceHeight(x: number, z: number, profile: Scenery) {
  const segments = renderBudget.terrainSegments;
  const gridCoordinate = (value: number) => {
    const unit = T.MathUtils.clamp(value / terrainExtent, -1, 1);
    return (
      ((Math.sign(unit) * Math.abs(unit) ** (1 / 1.45) + 1) / 2) * segments
    );
  };
  const gx = gridCoordinate(x),
    gz = gridCoordinate(z);
  const col = Math.min(segments - 1, Math.floor(gx));
  const row = Math.min(segments - 1, Math.floor(gz));
  const x0 = landscapeGridPosition(col),
    x1 = landscapeGridPosition(col + 1);
  const z0 = landscapeGridPosition(row),
    z1 = landscapeGridPosition(row + 1);
  // Interpolate in world space, not the nonlinearly distributed grid coordinate.
  const u = T.MathUtils.clamp((x - x0) / (x1 - x0), 0, 1);
  const v = T.MathUtils.clamp((z - z0) / (z1 - z0), 0, 1);
  const y10 = landscapeHeight(x1, z0, profile);
  const y01 = landscapeHeight(x0, z1, profile);
  if (u + v <= 1) {
    const y00 = landscapeHeight(x0, z0, profile);
    return y00 + u * (y10 - y00) + v * (y01 - y00);
  }
  const y11 = landscapeHeight(x1, z1, profile);
  return y11 + (1 - u) * (y01 - y11) + (1 - v) * (y10 - y11);
}

export function createLandscapeGeometry(profile: Scenery) {
  const geometry = new T.PlaneGeometry(
    12000,
    12000,
    renderBudget.terrainSegments,
    renderBudget.terrainSegments,
  );
  geometry.rotateX(-Math.PI / 2);
  const p = geometry.getAttribute("position");
  const rowSize = renderBudget.terrainSegments + 1;
  for (let i = 0; i < p.count; i++) {
    // Same triangle budget, with more samples near the flight area and fewer
    // at the outer horizon. The DEM and shading use world-space metres.
    const x = landscapeGridPosition(i % rowSize);
    const z = landscapeGridPosition(Math.floor(i / rowSize));
    p.setXYZ(i, x, landscapeHeight(x, z, profile), z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** Distant visual terrain. The usable airfield retains its flat collision surface. */
export function addLandscape(
  field: T.Group,
  profile: Scenery,
  fieldMap: T.Texture,
) {
  const dry = profile.surface === "dirt";
  const geometry = createLandscapeGeometry(profile);
  const p = geometry.getAttribute("position");
  const occlusion = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      z = p.getZ(i);
    const surrounding =
      (landscapeHeight(x - 90, z, profile) +
        landscapeHeight(x + 90, z, profile) +
        landscapeHeight(x, z - 90, profile) +
        landscapeHeight(x, z + 90, profile)) /
      4;
    occlusion[i] =
      1 - T.MathUtils.clamp((surrounding - p.getY(i)) / 100, 0, 0.28);
  }
  geometry.setAttribute(
    "terrainOcclusion",
    new T.BufferAttribute(occlusion, 1),
  );
  field.add(
    new T.Mesh(geometry, mountainMaterial(geometry, profile, fieldMap)),
  );

  const rand = seededRandom(profile.seed + 25),
    dummy = new T.Object3D();
  const rockGeometry = new T.IcosahedronGeometry(1, 1),
    rp = rockGeometry.getAttribute("position");
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i),
      y = rp.getY(i),
      z = rp.getZ(i);
    const d = 0.85 + noise(x * 5, z * 5) * 0.3;
    rp.setXYZ(i, x * d, y * (0.55 + noise(x * 3, y * 2) * 0.3), z * d);
  }
  rockGeometry.computeVertexNormals();
  const rocks = new T.InstancedMesh(
    rockGeometry,
    new T.MeshStandardMaterial({
      color: dry ? "#baa187" : "#a4aa99",
      roughness: 1,
    }),
    dry ? 60 : 18,
  );
  for (let i = 0; i < rocks.count; i++) {
    const x = -100 + rand() * 400;
    let z = (rand() - 0.5) * 300;
    if (Math.abs(z) < 15) z = Math.sign(z || 1) * (15 + rand() * 40);
    // Built sites: keep rocks off roads, pads and buildings (south side is open field).
    if (isClearArea(profile, x, z)) z = 20 + rand() * 40;
    if (profile.rockBandZ) {
      const [z0, z1] = profile.rockBandZ;
      z = z0 + ((z - -150) / 300) * (z1 - z0);
    }
    const size = i < 25 ? 0.4 + rand() * 0.8 : 0.04 + rand() * 0.22;
    dummy.position.set(x, size * 0.12, z);
    dummy.scale.set(size * (0.9 + rand()), size, size * (0.8 + rand()));
    dummy.rotation.set(rand() * 0.25, rand() * Math.PI * 2, rand() * 0.2);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
  }
  rocks.userData.collision = "solid";
  rocks.name = "rock";
  rocks.receiveShadow = true;
  field.add(rocks);
}

/** Photographic clouds over field haze; one compact texture and no scattering pass. */
