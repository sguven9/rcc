/**
 * Every tunable of the render layer in one place. Values marked "estimate"
 * (tahmin) are visual judgement, not measurements; adjust them here only.
 *
 * Rendering never feeds back into the simulation: none of these values is
 * part of a recording or of the physics.
 */
export type QualityLevel = "low" | "medium" | "high" | "ultra";
export const QUALITY_LEVELS: QualityLevel[] = [
  "low",
  "medium",
  "high",
  "ultra",
];

export interface QualityPreset {
  /** Multiplier on the device pixel ratio before caps (dynamic resolution scales below it). */
  resolutionScale: number;
  /** Cascaded shadow maps: count, map size (px) and covered distance (m). */
  shadowCascades: number;
  shadowMapSize: number;
  shadowDistanceM: number;
  /** Grass instance density multiplier (0–1 of the authored clumps). */
  grassDensity: number;
  /** Post-processing stages. */
  ao: boolean;
  bloom: boolean;
  antialias: "none" | "fxaa" | "smaa";
  vignette: boolean;
  clouds: boolean;
  /** Environment (IBL) cube resolution, px per face. */
  envMapSize: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: {
    resolutionScale: 0.75,
    // three.js CSM needs at least two cascades (one cascade casts no shadow).
    shadowCascades: 2,
    shadowMapSize: 1024,
    shadowDistanceM: 120,
    grassDensity: 0.35,
    ao: false,
    bloom: false,
    antialias: "fxaa",
    vignette: false,
    clouds: false,
    envMapSize: 64,
  },
  medium: {
    resolutionScale: 1,
    shadowCascades: 2,
    shadowMapSize: 1024,
    shadowDistanceM: 250,
    grassDensity: 0.7,
    ao: false,
    bloom: true,
    antialias: "fxaa",
    vignette: true,
    clouds: true,
    envMapSize: 128,
  },
  high: {
    resolutionScale: 1,
    shadowCascades: 3,
    shadowMapSize: 2048,
    shadowDistanceM: 450,
    grassDensity: 1,
    ao: true,
    bloom: true,
    antialias: "smaa",
    vignette: true,
    clouds: true,
    envMapSize: 256,
  },
  ultra: {
    resolutionScale: 1.25,
    shadowCascades: 4,
    shadowMapSize: 2048,
    shadowDistanceM: 800,
    grassDensity: 1,
    ao: true,
    bloom: true,
    antialias: "smaa",
    vignette: true,
    clouds: true,
    envMapSize: 256,
  },
};

export const RENDER_CONFIG = {
  /** Frame-rate targets for dynamic resolution (fps). */
  targetFps: 60,
  /** Dynamic resolution limits (fraction of the preset resolution). */
  dynamicResolution: { min: 0.6, max: 1, step: 0.05, settleFrames: 30 },
  /** Hard caps on the drawing buffer. */
  maxPixelRatio: 2,
  maxPixels: 3_700_000,
  /** Camera depth range, m. FPV near plane trades lens clearance for depth precision. */
  camera: { pilotNear: 0.15, fpvNear: 0.03, far: 14000 },
  /** Manisa field location and the default time of day. */
  site: { latitudeDeg: 38.61, dayOfYear: 172, defaultHour: 15.5 },
  sky: {
    // Preetham/Rayleigh–Mie parameters (estimate; a clear, slightly hazy summer day).
    turbidity: 4.2,
    rayleigh: 1.4,
    mieCoefficient: 0.004,
    mieDirectionalG: 0.82,
  },
  sun: {
    /** Direct sun illuminance at zenith, three.js intensity units (estimate). */
    intensity: 4.2,
    /** Below this elevation (deg) the sun fades to twilight (estimate). */
    twilightDeg: -4,
  },
  /** Image-based light scale relative to physically derived sky radiance (estimate). */
  environmentIntensity: 0.38,
  exposure: {
    /** ACES exposure at noon and at sunset; interpolated by sun elevation (estimate). */
    noon: 0.52,
    low: 0.72,
  },
  fog: {
    /** Exponential density at ground level, 1/m (estimate: ~25 km visibility). */
    density: 0.00012,
    /** Height (m) over which the fog thins by e (estimate). */
    heightFalloffM: 850,
  },
  clouds: {
    altitudeM: 1600,
    coverage: 0.42,
    /** Drift speed relative to the surface wind (estimate). */
    windFactor: 3,
    opacity: 0.85,
  },
  /**
   * Bloom acts on linear HDR before exposure: the threshold sits above the
   * sky's radiance so only the sun and specular glints glow (estimate).
   */
  bloom: { strength: 0.14, radius: 0.4, threshold: 5 },
  ao: { radius: 0.6, distanceExponent: 1.6, thickness: 1, scale: 1 },
  vignette: { offset: 1.05, darkness: 0.55 },
  /** Aircraft finish (estimate): clearcoat over paint, glass tint. */
  materials: {
    paintClearcoat: 0.55,
    paintClearcoatRoughness: 0.18,
    glassTint: "#9fb4c0",
    glassOpacity: 0.32,
    wearStrength: 0.16,
    panelLineSpacingM: 0.18,
  },
  /** Propeller disc shows above this fraction of maximum speed. */
  propellerBlurFrom: 0.35,
  /**
   * Per-frame budgets checked by `npm run render:check` on six fixed views
   * (Manisa field, one aircraft). Set from measurements with ~15 % headroom
   * (estimate); a change that exceeds them must justify the cost.
   */
  budgets: {
    low: { drawCalls: 420, triangles: 110_000 },
    medium: { drawCalls: 460, triangles: 135_000 },
    high: { drawCalls: 620, triangles: 175_000 },
    ultra: { drawCalls: 770, triangles: 190_000 },
  } as Record<QualityLevel, { drawCalls: number; triangles: number }>,
  /** Total download (dist) limit, MB. */
  maxDownloadMb: 40,
  /** LOD switch distances (m) for objects with three levels (estimate). */
  lodDistancesM: [60, 220] as [number, number],
} as const;
