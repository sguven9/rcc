import * as T from "three";
import { runwayOf, type RunwayLayout, type Scenery } from "../core/scenery";
import {
  noiseGLSL,
  seededRandom,
  surfaceTexture,
  terrainMaterial,
} from "./terrain-material";
import { surfaceDetailGLSL } from "./surface-detail";

// View dimensions in metres. +X is local north; on the club strip 36 and 18
// face opposing approaches. Other sites supply their own layout.
export const runwayLayout = { x: 48, length: 170, width: 7 };

/** Jointed concrete slabs (≈5 × 4 m) with per-slab tone, stains and tyre marks. */
function concreteMaterial(layout: RunwayLayout) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const rand = seededRandom(733);
  // Canvas spans 40 m along × 16 m across: 8 × 4 slabs.
  const sx = canvas.width / 40,
    sz = canvas.height / 16;
  for (let i = 0; i < 8; i++)
    for (let j = 0; j < 4; j++) {
      const tone = 176 + Math.round((rand() - 0.5) * 22);
      ctx.fillStyle = `rgb(${tone + 4},${tone + 1},${tone - 6})`;
      ctx.fillRect(i * 5 * sx, j * 4 * sz, 5 * sx, 4 * sz);
    }
  // Small weathering marks (≤ 0.25 m); larger blotches read as moiré at range.
  for (let n = 0; n < 700; n++) {
    ctx.fillStyle = `rgba(${rand() < 0.5 ? "70,66,58" : "220,216,206"},${0.02 + rand() * 0.04})`;
    const r = 1.5 + rand() * 5;
    ctx.beginPath();
    ctx.ellipse(
      rand() * canvas.width,
      rand() * canvas.height,
      r,
      r * (0.4 + rand() * 0.6),
      rand() * Math.PI,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(60,58,54,0.55)";
  ctx.lineWidth = 2;
  for (let i = 0; i <= 8; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 5 * sx, 0);
    ctx.lineTo(i * 5 * sx, canvas.height);
    ctx.stroke();
  }
  for (let j = 0; j <= 4; j++) {
    ctx.beginPath();
    ctx.moveTo(0, j * 4 * sz);
    ctx.lineTo(canvas.width, j * 4 * sz);
    ctx.stroke();
  }
  // Faint tyre marks near the centre line.
  ctx.fillStyle = "rgba(40,38,36,0.08)";
  for (const z of [6.6, 9.4]) ctx.fillRect(0, z * sz, canvas.width, 0.5 * sz);
  const map = new T.CanvasTexture(canvas);
  map.wrapS = map.wrapT = T.RepeatWrapping;
  map.repeat.set(layout.length / 40, layout.width / 16);
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 8;
  return new T.MeshStandardMaterial({ map, roughness: 0.93 });
}

/** Paint mask stays on the runway material, avoiding coplanar decal flicker. */
function paintMask() {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.setTransform(
    canvas.width / 170,
    0,
    0,
    canvas.height / 7,
    0,
    canvas.height / 2,
  );
  ctx.fillStyle = "#eeeeee";
  const rect = (x: number, z: number, length: number, width: number) =>
    ctx.fillRect(x, z, length, width);
  rect(1.5, -3.15, 167, 0.11);
  rect(1.5, 3.04, 167, 0.11);
  for (const x of [1.5, 168.15]) rect(x, -3.15, 0.35, 6.3);
  for (const x of [3.0, 161.5])
    for (const z of [-2.7, -1.95, -1.2, 0.75, 1.5, 2.25]) rect(x, z, 5.5, 0.45);
  for (let x = 23; x < 148; x += 10) rect(x, -0.09, 4, 0.18);
  for (const x of [29, 137]) for (const z of [-2.25, 1.55]) rect(x, z, 4, 0.7);
  for (const [x, label, angle] of [
    [14.5, "36", Math.PI / 2],
    [155.5, "18", -Math.PI / 2],
  ] as const) {
    ctx.save();
    ctx.translate(x, 0);
    ctx.rotate(angle);
    ctx.font = "bold 4.8px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, 0, 2.6);
    ctx.restore();
  }
  ctx.restore();
  // Subtle paint loss; mipmaps filter this at long distances.
  const rand = seededRandom(513);
  ctx.fillStyle = "#00000028";
  for (let i = 0; i < 2500; i++)
    ctx.fillRect(
      rand() * canvas.width,
      rand() * canvas.height,
      1 + rand() * 3,
      1 + rand() * 2,
    );
  const map = new T.CanvasTexture(canvas);
  map.anisotropy = 4;
  return map;
}

function asphaltMaterial() {
  const paint = paintMask();
  const material = new T.MeshStandardMaterial({
    map: surfaceTexture("lite/asphalt-color.jpg", true),
    roughness: 0.96,
  });
  material.userData.ownedTextures = [paint];
  material.onBeforeCompile = (shader) => {
    shader.uniforms.runwayPaint = { value: paint };
    shader.vertexShader =
      "varying vec3 vRunwayPosition; varying vec2 vRunwayUV;\n" +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvRunwayPosition = (modelMatrix * vec4(position, 1.0)).xyz; vRunwayUV = uv;",
    );
    shader.fragmentShader =
      "varying vec3 vRunwayPosition; varying vec2 vRunwayUV; uniform sampler2D runwayPaint;\n" +
      noiseGLSL +
      surfaceDetailGLSL +
      shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `
      vec2 roadUV = mat2(0.8, -0.6, 0.6, 0.8) * vRunwayPosition.xz / 3.0;
      vec3 sampleColor = naturalSurface(map, roadUV);
      // Compress the source's deep fissures: small RC wheels should read against
      // fine aggregate, not oversized black cracks. No additional texture fetch.
      float aggregate = dot(sampleColor, vec3(0.299, 0.587, 0.114));
      vec3 asphalt = vec3(0.105, 0.109, 0.111) + (sampleColor - vec3(0.14)) * 0.32;
      float weather = fieldNoise(vRunwayPosition.xz * 0.07);
      asphalt *= 0.94 + weather * 0.12;
      float paint = texture2D(runwayPaint, vRunwayUV).r;
      float edgeDust = smoothstep(2.85, 3.5, abs(vRunwayPosition.z)) * (0.13 + weather * 0.15);
      asphalt = mix(asphalt, vec3(0.22, 0.20, 0.15), edgeDust);
      // Faint rubber wear is concentrated around the two touchdown areas.
      float touchdown = exp(-pow((vRunwayPosition.x + 8.0) / 12.0, 2.0)) + exp(-pow((vRunwayPosition.x - 104.0) / 12.0, 2.0));
      float wheelTrack = exp(-pow((abs(vRunwayPosition.z) - 0.32) / 0.11, 2.0));
      asphalt *= 1.0 - touchdown * wheelTrack * weather * 0.14;
      diffuseColor.rgb *= mix(asphalt, vec3(0.64, 0.65, 0.61), paint * (0.88 + 0.08 * weather));
      float roadFootprint = max(length(dFdx(vRunwayPosition.xz)), length(dFdy(vRunwayPosition.xz)));
      float roadHeight = aggregate * 0.002
        * (1.0 - smoothstep(0.025, 0.16, roadFootprint)) * (1.0 - paint * 0.8);
    `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_maps>",
      "#include <normal_fragment_maps>\nnormal = surfaceRelief(-vViewPosition, normal, roadHeight);",
    );
  };
  material.customProgramCacheKey = () => "runway-asphalt-natural-v3";
  return material;
}

export function addRunway(field: T.Group, profile: Scenery) {
  const layout = runwayOf(profile);
  const material =
    layout.material === "concrete"
      ? concreteMaterial(layout)
      : layout.material === "asphalt"
        ? asphaltMaterial()
        : terrainMaterial(profile.surface === "dirt", true);
  const runway = new T.Mesh(
    new T.PlaneGeometry(layout.length, layout.width),
    material,
  );
  runway.rotation.x = -Math.PI / 2;
  runway.position.x = layout.x;
  runway.receiveShadow = true;
  field.add(runway);
  // Unmarked concrete sites have no club edge boards.
  if (layout.material === "concrete") return;

  // Low, white edge boards give unpaved strips a readable boundary from approach.
  // These are outside the flying surface; cones remain on the pilot safety line.
  const white = new T.MeshStandardMaterial({
    color: "#dfded0",
    roughness: 0.85,
  });
  const markers = new T.InstancedMesh(
    new T.BoxGeometry(0.7, 0.09, 0.24),
    white,
    16,
  );
  const dummy = new T.Object3D();
  let index = 0;
  for (const side of [-1, 1]) {
    for (let i = 0; i < 8; i++) {
      dummy.position.set(-36 + i * 24, 0.045, side * 4.5);
      dummy.updateMatrix();
      markers.setMatrixAt(index++, dummy.matrix);
    }
  }
  markers.castShadow = markers.receiveShadow = true;
  field.add(markers);
}
