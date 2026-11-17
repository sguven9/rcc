/**
 * Quality presets: automatic selection from coarse device hints and a
 * dynamic-resolution controller that keeps the frame rate near the target.
 * Pure (no DOM, no three.js) so both are unit-tested.
 */
import {
  QUALITY_LEVELS,
  QUALITY_PRESETS,
  RENDER_CONFIG,
  type QualityLevel,
} from "./render-config";

export interface DeviceHints {
  /** Logical CPU cores (navigator.hardwareConcurrency). */
  cores: number;
  /** Device memory in GB, if the browser reports it. */
  memoryGb?: number;
  /** Largest texture size from the GL context. */
  maxTextureSize: number;
  /** Unmasked renderer string, if available (lower case is fine). */
  renderer?: string;
  /** Touch-first or small device. */
  mobile: boolean;
}

/** A conservative starting preset; dynamic resolution then adapts. */
export function detectQuality(h: DeviceHints): QualityLevel {
  const r = (h.renderer ?? "").toLowerCase();
  const software = /swiftshader|llvmpipe|software|basic render/.test(r);
  if (software || h.maxTextureSize < 4096) return "low";
  if (h.mobile || h.cores <= 4 || (h.memoryGb !== undefined && h.memoryGb <= 4))
    return "medium";
  const discrete = /nvidia|geforce|rtx|radeon rx|arc a|apple m[2-9]/.test(r);
  if (discrete && h.cores >= 8) return "ultra";
  return "high";
}

export function isQualityLevel(v: unknown): v is QualityLevel {
  return typeof v === "string" && (QUALITY_LEVELS as string[]).includes(v);
}
export function presetFor(level: QualityLevel) {
  return QUALITY_PRESETS[level];
}

/**
 * Lowers the resolution scale after a run of slow frames and raises it again
 * after a run of fast ones (hysteresis avoids oscillation).
 */
export class DynamicResolution {
  scale = 1;
  private slow = 0;
  private fast = 0;
  constructor(
    readonly targetFps = RENDER_CONFIG.targetFps,
    readonly limits = RENDER_CONFIG.dynamicResolution,
  ) {}
  /** Feed one frame time (s); returns true when the scale changed. */
  update(frameSeconds: number): boolean {
    if (!(frameSeconds > 0) || !Number.isFinite(frameSeconds)) return false;
    const budget = 1 / this.targetFps;
    if (frameSeconds > budget * 1.15) {
      this.slow++;
      this.fast = 0;
    } else if (frameSeconds < budget * 0.8) {
      this.fast++;
      this.slow = 0;
    } else {
      this.slow = 0;
      this.fast = 0;
    }
    const { min, max, step, settleFrames } = this.limits;
    if (this.slow >= settleFrames && this.scale > min) {
      this.scale = Math.max(min, +(this.scale - step).toFixed(3));
      this.slow = 0;
      return true;
    }
    if (this.fast >= settleFrames * 2 && this.scale < max) {
      this.scale = Math.min(max, +(this.scale + step).toFixed(3));
      this.fast = 0;
      return true;
    }
    return false;
  }
  reset() {
    this.scale = 1;
    this.slow = 0;
    this.fast = 0;
  }
}

/** Drawing-buffer pixel ratio for a viewport, preset and dynamic scale. */
export function pixelRatioFor(
  width: number,
  height: number,
  deviceRatio: number,
  level: QualityLevel,
  dynamicScale = 1,
) {
  const preset = QUALITY_PRESETS[level];
  const wanted = deviceRatio * preset.resolutionScale * dynamicScale;
  const byPixels = Math.sqrt(
    RENDER_CONFIG.maxPixels / Math.max(1, width * height),
  );
  return Math.max(
    0.25,
    Math.min(wanted, RENDER_CONFIG.maxPixelRatio, byPixels),
  );
}

/** Level of detail (0 = full) for a distance and two switch distances. */
export function lodLevel(
  distanceM: number,
  thresholds: readonly [number, number] = RENDER_CONFIG.lodDistancesM,
) {
  if (!(distanceM >= 0)) return 0;
  return distanceM < thresholds[0] ? 0 : distanceM < thresholds[1] ? 1 : 2;
}
