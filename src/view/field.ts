import { collectFieldObstacles } from "./field-collisions";
import {
  isDryGround,
  runwayOf,
  sceneries,
  type Scenery,
} from "../core/scenery";
import { addManisaSite, manisaWindsock } from "./manisa-site";
import { addGrass } from "./grass";
import * as T from "three";
import { terrainMaterial } from "./terrain-material";
import { addVegetation } from "./vegetation";
import { addLandscape, createSky } from "./landscape";
import { addRunway } from "./runway";
/** Adjacent terrain patches share edges, never overlapping depth surfaces. */
function patch(
  width: number,
  height: number,
  hole?: { x: number; width: number; height: number },
) {
  const shape = new T.Shape();
  shape.moveTo(-width / 2, -height / 2);
  shape.lineTo(width / 2, -height / 2);
  shape.lineTo(width / 2, height / 2);
  shape.lineTo(-width / 2, height / 2);
  shape.closePath();
  if (hole) {
    const h = new T.Path(),
      x = hole.x,
      w = hole.width / 2,
      z = hole.height / 2;
    h.moveTo(x - w, -z);
    h.lineTo(x - w, z);
    h.lineTo(x + w, z);
    h.lineTo(x + w, -z);
    h.closePath();
    shape.holes.push(h);
  }
  const g = new T.ShapeGeometry(shape),
    position = g.getAttribute("position"),
    uv = g.getAttribute("uv");
  for (let i = 0; i < position.count; i++)
    uv.setXY(
      i,
      position.getX(i) / width + 0.5,
      position.getY(i) / height + 0.5,
    );
  return g;
}
export function createField(
  scene: T.Scene,
  profile: Scenery = sceneries.manisa,
) {
  const field = new T.Group();
  scene.add(field);
  addManisaSite(field);
  const grass = addGrass(field, profile);
  addVegetation(field, profile);
  const groundMaterial = terrainMaterial(isDryGround(profile));
  addLandscape(field, profile, groundMaterial.map!);
  // Mown strip 15 m before and 35 m beyond the runway; for the club layout this
  // reproduces the original 220 × 22 m strip at x = 58.
  const runway = runwayOf(profile),
    stripStart = runway.x - runway.length / 2 - 15,
    stripLength = runway.length + 50,
    stripWidth = runway.width + 15,
    stripX = stripStart + stripLength / 2;
  const ground = new T.Mesh(
    patch(6000, 6000, { x: stripX, width: stripLength, height: stripWidth }),
    groundMaterial,
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  field.add(ground);
  const strip = new T.Mesh(
    patch(stripLength, stripWidth, {
      x: runway.x - stripX,
      width: runway.length + 2,
      height: runway.width + 1.4,
    }),
    groundMaterial,
  );
  strip.rotation.x = -Math.PI / 2;
  strip.position.set(stripX, 0, 0);
  strip.receiveShadow = true;
  field.add(strip);
  const shoulderMaterial = terrainMaterial(profile.surface !== "grass");
  shoulderMaterial.color.set(
    runway.material === "concrete"
      ? "#d6cbb8"
      : profile.surface === "asphalt"
        ? "#b3b5ab"
        : profile.surface === "grass"
          ? "#d1d8b5"
          : "#fff3dd",
  );
  const shoulder = new T.Mesh(
    patch(runway.length + 2, runway.width + 1.4, {
      x: 0,
      width: runway.length,
      height: runway.width,
    }),
    shoulderMaterial,
  );
  shoulder.rotation.x = -Math.PI / 2;
  shoulder.position.x = runway.x;
  shoulder.receiveShadow = true;
  field.add(shoulder);
  addRunway(field, profile);
  const metal = new T.MeshStandardMaterial({
    color: "#5b6665",
    metalness: 0.45,
    roughness: 0.55,
  });
  const sockAt = manisaWindsock;
  const pole = new T.Mesh(new T.CylinderGeometry(0.025, 0.035, 4, 12), metal);
  pole.position.set(sockAt.x, 2, sockAt.z);
  pole.userData.collision = "solid";
  field.add(pole);
  const sock = new T.Group();
  sock.position.set(sockAt.x, 4, sockAt.z);
  field.add(sock);
  for (let i = 0; i < 5; i++) {
    const cone = new T.Mesh(
      new T.CylinderGeometry(
        0.14 - i * 0.021,
        0.16 - i * 0.021,
        0.22,
        12,
        1,
        true,
      ),
      new T.MeshStandardMaterial({
        color: i % 2 ? "#e5e2d6" : "#b84f28",
        side: T.DoubleSide,
      }),
    );
    cone.rotation.z = Math.PI / 2;
    cone.position.x = 0.11 + i * 0.22;
    sock.add(cone);
  }
  const sky = createSky(profile);
  scene.add(sky);
  return {
    field,
    obstacles: collectFieldObstacles(field),
    sky,
    sock,
    grass,
    update: (camera: T.Camera, wind: [number, number] = [0, 0], timeS = 0) => {
      sky.position.copy(camera.position);
      grass.update(camera, wind, timeS);
    },
    dispose: () => {
      scene.remove(field, sky);
      const geometries = new Set<T.BufferGeometry>(),
        materials = new Set<T.Material>(),
        textures = new Set<T.Texture>();
      for (const root of [field, sky])
        root.traverse((o) => {
          if (o instanceof T.Mesh) {
            if (o instanceof T.InstancedMesh) o.dispose();
            geometries.add(o.geometry);
            for (const m of Array.isArray(o.material)
              ? o.material
              : [o.material]) {
              materials.add(m);
              for (const v of Object.values(m))
                if (v instanceof T.Texture) textures.add(v);
              for (const texture of m.userData.ownedTextures ?? [])
                textures.add(texture);
            }
          }
        });
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
    },
  };
}
