/**
 * Transmitter-style stick expo, per channel. Replaces the former Gentle /
 * Standard / Direct response presets: the only shaping between the RC
 * transmitter and the aircraft is expo (and the aircraft's trim).
 *
 *   out = (1 − e)·x + e·x³,  x ∈ [−1, 1],  e ∈ [0, 1]
 *
 * so out(±1) = ±1, out(0) = 0 and e = 0 is linear. Throttle (0..1) is shaped
 * about mid-stick: x = 2t − 1, t' = (out + 1)/2.
 */
import { z } from "zod";
import { clamp } from "./math";
import type { Controls } from "./simulation";

const rate = z.number().finite().min(0.1).max(1);
/**
 * Legacy per-aircraft response block. Still accepted in aircraft files and
 * recordings so older files load, but ignored: expo is a pilot setting.
 */
export const PilotResponseSchema = z
  .object({
    preset: z.enum(["gentle", "standard", "direct", "custom"]),
    rates: z.tuple([rate, rate, rate]).default([0.55, 0.45, 0.65]),
    expo: z.number().finite().min(0).max(0.8).default(0.4),
    smoothingSeconds: z.number().finite().min(0).max(0.2).default(0.09),
  })
  .strict();
export type PilotResponse = z.infer<typeof PilotResponseSchema>;

export interface ExpoSettings {
  roll: number;
  pitch: number;
  yaw: number;
  throttle: number;
}
export const EXPO_CHANNELS = ["roll", "pitch", "yaw", "throttle"] as const;
/** Sensible defaults: soft centre on the sticks, linear throttle. */
export const DEFAULT_EXPO: ExpoSettings = {
  roll: 0.3,
  pitch: 0.3,
  yaw: 0.2,
  throttle: 0,
};
export const ExpoSchema = z
  .object({
    roll: z.number().finite().min(0).max(1),
    pitch: z.number().finite().min(0).max(1),
    yaw: z.number().finite().min(0).max(1),
    throttle: z.number().finite().min(0).max(1),
  })
  .strict();

/** Cubic expo of a normalized stick value. */
export function expo(x: number, e: number) {
  const v = clamp(Number.isFinite(x) ? x : 0, -1, 1),
    k = clamp(Number.isFinite(e) ? e : 0, 0, 1);
  return (1 - k) * v + k * v * v * v;
}

/** Shape transmitter sticks with per-channel expo (stateless). */
export function applyExpo(input: Controls, settings: ExpoSettings): Controls {
  const t = clamp(Number.isFinite(input.throttle) ? input.throttle : 0, 0, 1);
  return {
    ...input,
    roll: expo(input.roll, settings.roll),
    pitch: expo(input.pitch, settings.pitch),
    yaw: expo(input.yaw, settings.yaw),
    throttle:
      settings.throttle > 0 ? (expo(2 * t - 1, settings.throttle) + 1) / 2 : t,
  };
}

/** Preserve the whole trim offset while scaling the available pilot authority. */
const trimmed = (value: number, trim: number) =>
  trim + value * (value >= 0 ? 1 - trim : 1 + trim);
export function withPitchTrim(input: Controls, trim: number): Controls {
  return { ...input, pitch: trimmed(input.pitch, trim) };
}
/** Apply aileron, elevator and rudder trim offsets the same way. */
export function withTrim(
  input: Controls,
  trim: { roll: number; pitch: number; yaw: number },
): Controls {
  return {
    ...input,
    roll: trimmed(input.roll, trim.roll),
    pitch: trimmed(input.pitch, trim.pitch),
    yaw: trimmed(input.yaw, trim.yaw),
  };
}
