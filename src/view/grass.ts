/**
 * GPU-instanced grass clumps (three crossed blades each) on the site's grass
 * zones. The vertex shader leans blades downwind with a flutter (mirrors
 * core/grass-field.ts `swayOffset`) using the simulation's wind, and shrinks
 * them to nothing between the LOD fade distances (`bladeFade`); tiles beyond
 * the fade radius are hidden so only the ground texture remains far away.
 */
import * as T from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GRASS, grassClumps } from "../core/grass-field";
import type { Scenery } from "../core/scenery";

/** One clump of unit height: three tapered blades, vertex-coloured root → tip. */
function clumpGeometry() {
  const blades: T.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const g = new T.BufferGeometry();
    const w = 0.035;
    // Root quad, mid quad, tip: 5 vertices, 3 triangles, slight bend.
    const pos = [
      -w,
      0,
      0,
      w,
      0,
      0,
      -w * 0.6,
      0.55,
      0.02,
      w * 0.6,
      0.55,
      0.02,
      0,
      1,
      0.06,
    ];
    const color = [
      0.16, 0.2, 0.07, 0.16, 0.2, 0.07, 0.3, 0.33, 0.14, 0.3, 0.33, 0.14, 0.52,
      0.47, 0.24,
    ];
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new T.Float32BufferAttribute(color, 3));
    g.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
    g.computeVertexNormals();
    g.rotateY((i * Math.PI * 2) / 3);
    g.translate(Math.cos(i * 2.1) * 0.03, 0, Math.sin(i * 2.1) * 0.03);
    blades.push(g);
  }
  return mergeGeometries(blades)!;
}

export function addGrass(field: T.Group, profile: Scenery) {
  const clumps = grassClumps(profile);
  const uniforms = {
    uTime: { value: 0 },
    uWind: { value: new T.Vector2(0, 0) },
    uFade: { value: new T.Vector2(GRASS.fadeStartM, GRASS.fadeEndM) },
    uLean: { value: new T.Vector2(GRASS.leanPerMps, GRASS.maxWindMps) },
  };
  const material = new T.MeshStandardMaterial({
    vertexColors: true,
    side: T.DoubleSide,
    roughness: 0.95,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uTime; uniform vec2 uWind; uniform vec2 uFade; uniform vec2 uLean;",
      )
      .replace(
        "#include <project_vertex>",
        `vec4 mvPosition = vec4(transformed, 1.0);
        vec3 root = vec3(0.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          root = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #endif
        float bladeHeight = length(instanceMatrix[1].xyz);
        float heightFraction = clamp(position.y, 0.0, 1.0);
        float speed = length(uWind);
        if (speed > 0.01) {
          float flutter = 0.6 + 0.4 * sin(uTime * (1.5 + 0.15 * speed) + dot(root.xz, vec2(0.37, 0.21)));
          float amount = uLean.x * min(speed, uLean.y) * heightFraction * heightFraction * bladeHeight * flutter;
          mvPosition.xz += uWind / speed * amount;
        }
        vec3 rootWorld = (modelMatrix * vec4(root, 1.0)).xyz;
        float fade = 1.0 - smoothstep(uFade.x, uFade.y, distance(rootWorld.xz, cameraPosition.xz));
        mvPosition.y = root.y + (mvPosition.y - root.y) * fade;
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`,
      );
  };
  material.customProgramCacheKey = () => "grass-blades-v1";
  const geometry = clumpGeometry();
  const tiles = new Map<string, typeof clumps>();
  for (const c of clumps) {
    const key = `${Math.floor(c.x / GRASS.tileM)},${Math.floor(c.z / GRASS.tileM)}`;
    tiles.set(key, [...(tiles.get(key) ?? []), c]);
  }
  const group = new T.Group();
  group.name = "grass-blades";
  const dummy = new T.Object3D();
  const meshes: { mesh: T.InstancedMesh; x: number; z: number }[] = [];
  for (const [key, list] of tiles) {
    const mesh = new T.InstancedMesh(geometry, material, list.length);
    list.forEach((c, i) => {
      dummy.position.set(c.x, 0, c.z);
      dummy.rotation.set(0, c.yaw, 0);
      dummy.scale.set(c.height * 1.4, c.height, c.height * 1.4);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    mesh.name = `grass-tile:${key}`;
    const [tx, tz] = key.split(",").map(Number);
    meshes.push({
      mesh,
      x: (tx + 0.5) * GRASS.tileM,
      z: (tz + 0.5) * GRASS.tileM,
    });
    group.add(mesh);
  }
  field.add(group);
  return {
    count: clumps.length,
    /** Advance sway time and wind (scene x/z, m/s) and cull far tiles. */
    update(camera: T.Camera, wind: [number, number], timeS: number) {
      uniforms.uTime.value = timeS;
      uniforms.uWind.value.set(wind[0], wind[1]);
      const reach = GRASS.fadeEndM + GRASS.tileM;
      for (const t of meshes)
        t.mesh.visible =
          Math.hypot(t.x - camera.position.x, t.z - camera.position.z) < reach;
    },
  };
}
