/**
 * Aircraft finish on top of the procedural airframe (view/model.ts): painted
 * panels get a clearcoat, transparent parts become tinted glass, and every
 * lit surface gets object-space wear (roughness and dirt variation) and faint
 * chordwise panel lines, without UVs, so they work on any airframe. A disc
 * appears in front of fast-turning propellers.
 *
 * Parameters are estimates in render-config. Rendering only.
 */
import * as T from "three";
import { RENDER_CONFIG } from "./render-config";

const M = RENDER_CONFIG.materials;

/** GLSL value noise and fbm in 3D (shared by the wear shader). */
export const NOISE_GLSL = `
float rN_hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float rN_noise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(rN_hash(i), rN_hash(i + vec3(1,0,0)), f.x), mix(rN_hash(i + vec3(0,1,0)), rN_hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(rN_hash(i + vec3(0,0,1)), rN_hash(i + vec3(1,0,1)), f.x), mix(rN_hash(i + vec3(0,1,1)), rN_hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
float rN_fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * rN_noise(p); p *= 2.03; a *= 0.5; } return s; }
`;

/** Classify a material from the existing airframe builder. */
export function finishOf(
  m: T.MeshStandardMaterial,
): "glass" | "paint" | "matte" {
  if (m.transparent && m.opacity < 0.95) return "glass";
  if (m.metalness > 0.4) return "paint";
  if (m.roughness <= 0.62) return "paint";
  return "matte";
}

function addWear(material: T.MeshStandardMaterial, panelLines: boolean) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.wearStrength = { value: M.wearStrength };
    shader.uniforms.panelSpacing = { value: M.panelLineSpacingM };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWearPos;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvWearPos = position;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 vWearPos;\nuniform float wearStrength;\nuniform float panelSpacing;\n${NOISE_GLSL}`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        float wear = rN_fbm(vWearPos * 9.0);
        float grime = smoothstep(0.55, 0.85, rN_fbm(vWearPos * 2.3 + 7.1));
        roughnessFactor = clamp(roughnessFactor + (wear - 0.5) * wearStrength + grime * wearStrength * 0.6, 0.04, 1.0);
        diffuseColor.rgb *= 1.0 - grime * wearStrength * 0.55;
        ${
          panelLines
            ? `float panel = abs(fract(vWearPos.x / panelSpacing) - 0.5) * 2.0;
        float line = 1.0 - smoothstep(0.0, 0.035, 1.0 - panel);
        diffuseColor.rgb *= 1.0 - line * 0.18;
        roughnessFactor = mix(roughnessFactor, 0.7, line * 0.5);`
            : ""
        }`,
      );
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () =>
    `${key()}|wear${panelLines ? "+panel" : ""}`;
}

/**
 * Upgrade the airframe's materials in place (each shared material once).
 * Returns the number of materials changed.
 */
export function upgradeAircraftMaterials(root: T.Object3D) {
  const seen = new Map<T.Material, T.Material>();
  let changed = 0;
  root.traverse((o) => {
    const mesh = o as T.Mesh;
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = list.map((m) => {
      if (seen.has(m)) return seen.get(m)!;
      if (!(m instanceof T.MeshStandardMaterial) || m.userData.finish) {
        seen.set(m, m);
        return m;
      }
      const kind = finishOf(m);
      const physical = new T.MeshPhysicalMaterial();
      T.MeshStandardMaterial.prototype.copy.call(physical, m);
      physical.userData = { ...m.userData, finish: kind };
      if (kind === "glass") {
        physical.color.set(M.glassTint);
        physical.roughness = 0.05;
        physical.metalness = 0;
        physical.opacity = M.glassOpacity;
        physical.transparent = true;
        physical.clearcoat = 1;
        physical.clearcoatRoughness = 0.04;
        physical.envMapIntensity = 1.4;
        physical.depthWrite = false;
      } else {
        if (kind === "paint") {
          physical.clearcoat = M.paintClearcoat;
          physical.clearcoatRoughness = M.paintClearcoatRoughness;
        }
        addWear(physical, kind === "paint");
      }
      physical.needsUpdate = true;
      changed++;
      seen.set(m, physical);
      return physical;
    });
    mesh.material = Array.isArray(mesh.material) ? next : next[0];
  });
  return changed;
}

/** Translucent motion disc per propeller, shown at speed. */
export function propellerDiscs(
  propellers: readonly T.Object3D[],
  diameters: readonly number[],
) {
  const discs = propellers.map((p, i) => {
    const disc = new T.Mesh(
      new T.CircleGeometry((diameters[i] ?? 0.2) / 2, 40),
      new T.MeshStandardMaterial({
        color: "#202326",
        roughness: 0.6,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: T.DoubleSide,
      }),
    );
    disc.name = "propeller-disc";
    // The propeller group spins about its local X; the disc lies in its YZ plane.
    disc.rotation.y = Math.PI / 2;
    disc.renderOrder = 2;
    p.parent?.add(disc);
    disc.position.copy(p.position);
    return disc;
  });
  return {
    discs,
    /** speed: fraction of maximum rpm per propeller (0–1). */
    update(speed: readonly number[]) {
      discs.forEach((d, i) => {
        const s = speed[i] ?? 0;
        const t = T.MathUtils.smoothstep(
          s,
          RENDER_CONFIG.propellerBlurFrom,
          0.8,
        );
        (d.material as T.MeshStandardMaterial).opacity = 0.42 * t;
        d.visible = t > 0.01;
        // Blades fade as the disc takes over (motion blur proxy).
        for (const blade of propellers[i].children)
          if (blade.name !== "spinner") blade.visible = t < 0.95;
      });
    },
    dispose() {
      discs.forEach((d) => {
        d.removeFromParent();
        d.geometry.dispose();
        (d.material as T.Material).dispose();
      });
    },
  };
}
