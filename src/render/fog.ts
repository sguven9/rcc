/**
 * Height fog with aerial perspective: scenes using `FogExp2` get an
 * exponential fog whose density thins with altitude, integrated analytically
 * along the view ray (Quílez, "better fog"). Linear `Fog` (the editor studio)
 * is unchanged. Patched once into three.js's shared fog chunks before any
 * material compiles; the fog colour follows the sky haze each frame.
 */
import * as T from "three";
import { RENDER_CONFIG } from "./render-config";

let installed = false;
export function installHeightFog(
  falloffM: number = RENDER_CONFIG.fog.heightFalloffM,
) {
  if (installed) return;
  installed = true;
  const b = (1 / falloffM).toFixed(8);
  T.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif`;
  T.ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorld = ( inverse( viewMatrix ) * mvPosition ).xyz;
#endif`;
  T.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  T.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    vec3 fogRay = vFogWorld - cameraPosition;
    float fogDistance = length( fogRay );
    float fogB = ${b};
    float fogK = fogRay.y * fogB;
    float fogPath = abs( fogK ) > 1e-4 ? ( 1.0 - exp( - fogK ) ) / fogK : 1.0;
    float fogDepthOptical = fogDensity * fogDistance * exp( - max( cameraPosition.y, 0.0 ) * fogB ) * fogPath;
    float fogFactor = 1.0 - exp( - max( fogDepthOptical, 0.0 ) );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;
}

/** Fraction of light scattered away over a path (CPU mirror of the shader). */
export function heightFogFactor(
  camera: [number, number, number],
  point: [number, number, number],
  density: number = RENDER_CONFIG.fog.density,
  falloffM: number = RENDER_CONFIG.fog.heightFalloffM,
) {
  const ray = point.map((v, i) => v - camera[i]);
  const distance = Math.hypot(...ray);
  const b = 1 / falloffM,
    k = ray[1] * b;
  const path = Math.abs(k) > 1e-4 ? (1 - Math.exp(-k)) / k : 1;
  const optical =
    density * distance * Math.exp(-Math.max(camera[1], 0) * b) * path;
  return 1 - Math.exp(-Math.max(optical, 0));
}
