/**
 * RC transmitter calibration: pure functions behind the setup wizard
 * (app/setup-wizard.ts). Everything here works on raw axis samples in the
 * Gamepad API range and is unit-tested without a browser.
 *
 * Normalization (input/controls.ts `normalizeAxis`, unchanged): the raw value
 * is mapped piecewise about the measured centre, x = (raw − c)/(max − c) above
 * and (raw − c)/(c − min) below, so a centre that is not the midpoint of the
 * endpoints still reads 0 at rest and ±1 at the ends; then clamped to ±1,
 * reversed if needed, deadzoned and given expo. Throttle uses the full
 * span, t = (raw − min)/(max − min) (1 − t when reversed).
 */
import { clamp } from "../core/math";
import {
  channels,
  defaultProfile,
  type AxisBinding,
  type Channel,
  type ControllerProfile,
  type SwitchBinding,
} from "./controls";
export type { SwitchBinding };

/** Calibration format version stored with the profile. */
export const CALIBRATION_VERSION = 2;
/** Stick modes: which stick carries throttle and pitch (left/right). */
export type StickMode = 1 | 2 | 3 | 4;
export type Stick = "left" | "right";

/**
 * Channel → stick for each mode (vertical channels: throttle, pitch;
 * horizontal: roll, yaw). Mode 2 is the common one: throttle and rudder on
 * the left stick, elevator and aileron on the right.
 */
export const MODE_LAYOUT: Record<StickMode, Record<Channel, Stick>> = {
  1: { throttle: "right", pitch: "left", yaw: "left", roll: "right" },
  2: { throttle: "left", pitch: "right", yaw: "left", roll: "right" },
  3: { throttle: "right", pitch: "left", yaw: "right", roll: "left" },
  4: { throttle: "left", pitch: "right", yaw: "right", roll: "left" },
};

/** The single calibration object (a versioned controller profile). */
export interface Calibration extends ControllerProfile {
  version: typeof CALIBRATION_VERSION;
  mode: StickMode;
}

/** Mean and peak-to-peak spread of each axis over a run of samples. */
export function centerStats(samples: readonly (readonly number[])[]) {
  const n = samples.length,
    axes = Math.max(0, ...samples.map((s) => s.length));
  const center: number[] = [],
    noise: number[] = [];
  for (let a = 0; a < axes; a++) {
    const values = samples.map((s) => s[a]).filter(Number.isFinite);
    center.push(
      values.length ? values.reduce((x, y) => x + y, 0) / values.length : 0,
    );
    noise.push(values.length ? Math.max(...values) - Math.min(...values) : 0);
  }
  return { center, noise, samples: n };
}

/**
 * Deadzone (fraction of half travel) that hides the measured noise with a
 * margin: three times the peak-to-peak noise, between 2 % and 15 %.
 */
export function suggestDeadzone(noise: number, halfRange = 1) {
  if (!(halfRange > 0)) return 0.04;
  return Math.round(clamp((3 * noise) / halfRange, 0.02, 0.15) * 1000) / 1000;
}

/** Running per-axis minimum and maximum (the endpoint step). */
export class RangeTracker {
  min: number[] = [];
  max: number[] = [];
  add(axes: readonly number[]) {
    axes.forEach((v, i) => {
      if (!Number.isFinite(v)) return;
      this.min[i] = Math.min(this.min[i] ?? v, v);
      this.max[i] = Math.max(this.max[i] ?? v, v);
    });
  }
  span(i: number) {
    return (this.max[i] ?? 0) - (this.min[i] ?? 0);
  }
  /** Axes that travelled at least `minSpan` (raw units; full span is 2). */
  moved(minSpan = 1.2) {
    return this.max.map((_, i) => i).filter((i) => this.span(i) >= minSpan);
  }
}

/** One movement prompt in the channel step. */
export interface ChannelPrompt {
  channel: Channel;
  /** Direction the pilot is asked to move, in stick terms. */
  move: "up" | "down" | "left" | "right";
  /** True for the first of the two prompts of a channel. */
  first: boolean;
}
export const CHANNEL_PROMPTS: ChannelPrompt[] = [
  { channel: "throttle", move: "up", first: true },
  { channel: "throttle", move: "down", first: false },
  { channel: "roll", move: "left", first: true },
  { channel: "roll", move: "right", first: false },
  { channel: "pitch", move: "up", first: true },
  { channel: "pitch", move: "down", first: false },
  { channel: "yaw", move: "left", first: true },
  { channel: "yaw", move: "right", first: false },
];

/** Plain-language instruction for a prompt, naming the stick for the mode. */
export function promptText(p: ChannelPrompt, mode: StickMode) {
  const stick = MODE_LAYOUT[mode][p.channel] === "left" ? "left" : "right";
  const verb =
    p.move === "up"
      ? "Push the %s stick fully up"
      : p.move === "down"
        ? "Pull the %s stick fully down"
        : `Push the %s stick fully ${p.move}`;
  const role = {
    throttle: "throttle",
    roll: "aileron",
    pitch: "elevator",
    yaw: "rudder",
  }[p.channel];
  return `${verb.replace("%s", stick)} (${role}), then hold it.`;
}

/**
 * The axis that moved most from `baseline`, if it moved by at least
 * `threshold` (raw units). Axes in `exclude` are ignored.
 */
export function detectAxis(
  baseline: readonly number[],
  current: readonly number[],
  threshold = 0.5,
  exclude: readonly number[] = [],
): { axis: number; delta: number } | null {
  let best: { axis: number; delta: number } | null = null;
  current.forEach((v, i) => {
    if (exclude.includes(i) || !Number.isFinite(v)) return;
    const delta = v - (baseline[i] ?? 0);
    if (
      Math.abs(delta) >= threshold &&
      (!best || Math.abs(delta) > Math.abs(best.delta))
    )
      best = { axis: i, delta };
  });
  return best;
}

export type PromptResult =
  { ok: true; axis: number; sign: 1 | -1 } | { ok: false; error: string };

/**
 * Check a detected movement against the channel mapping built so far:
 * the second prompt of a channel must move the same axis the other way, and
 * an axis already assigned to another channel cannot be reused.
 */
export function checkPrompt(
  prompt: ChannelPrompt,
  detected: { axis: number; delta: number },
  assigned: Partial<Record<Channel, { axis: number; sign: 1 | -1 }>>,
): PromptResult {
  const sign = detected.delta > 0 ? 1 : -1;
  const names: Record<Channel, string> = {
    throttle: "throttle",
    roll: "aileron",
    pitch: "elevator",
    yaw: "rudder",
  };
  const other = (Object.keys(assigned) as Channel[]).find(
    (c) => c !== prompt.channel && assigned[c]!.axis === detected.axis,
  );
  if (other)
    return {
      ok: false,
      error: `That axis is already used for the ${names[other]}. Move only the ${names[prompt.channel]} as asked.`,
    };
  const mine = assigned[prompt.channel];
  if (!prompt.first && mine) {
    if (mine.axis !== detected.axis)
      return {
        ok: false,
        error: `A different axis moved than in the previous step. Move the same stick in the opposite direction.`,
      };
    if (mine.sign === sign)
      return {
        ok: false,
        error: "The stick moved the same way as before. Move it the other way.",
      };
  }
  return { ok: true, axis: detected.axis, sign };
}

/**
 * Whether a channel's raw axis must be reversed, from the sign of the first
 * prompt's movement: throttle up must read 1; aileron left, elevator up
 * (nose down) and rudder left must read −1.
 */
export function reversedFor(channel: Channel, firstSign: 1 | -1) {
  return channel === "throttle" ? firstSign < 0 : firstSign > 0;
}

/**
 * Detect a two-position switch flip between two snapshots of buttons and
 * axes. Axes in `exclude` (the sticks) are ignored.
 */
export function detectSwitch(
  before: { axes: readonly number[]; buttons: readonly number[] },
  after: { axes: readonly number[]; buttons: readonly number[] },
  exclude: readonly number[],
): SwitchBinding | null {
  for (let i = 0; i < after.buttons.length; i++)
    if (Math.abs(after.buttons[i] - (before.buttons[i] ?? 0)) > 0.5)
      return {
        kind: "button",
        index: i,
        onValue: after.buttons[i],
        threshold: 0.5,
      };
  const axis = detectAxis(before.axes, after.axes, 0.8, exclude);
  return axis
    ? {
        kind: "axis",
        index: axis.axis,
        onValue: after.axes[axis.axis],
        threshold: (after.axes[axis.axis] + before.axes[axis.axis]) / 2,
      }
    : null;
}

/** Whether a switch is in its "on" position for a device snapshot. */
export function switchOn(
  s: SwitchBinding,
  device: { axes: readonly number[]; buttons: readonly { value: number }[] },
) {
  const v =
    s.kind === "button" ? device.buttons[s.index]?.value : device.axes[s.index];
  if (!Number.isFinite(v)) return false;
  return s.onValue >= s.threshold ? v! >= s.threshold : v! < s.threshold;
}

/** Assemble the calibration object from the wizard's measurements. */
export function buildCalibration(input: {
  deviceId: string;
  mode: StickMode;
  centers: readonly number[];
  noise: readonly number[];
  range: RangeTracker;
  assigned: Record<Channel, { axis: number; sign: 1 | -1 }>;
  switches?: Calibration["switches"];
  expo?: Partial<Record<Channel, number>>;
}): Calibration {
  const base = defaultProfile(input.deviceId);
  const bindings = {} as Record<Channel, AxisBinding>;
  for (const ch of channels) {
    const { axis, sign } = input.assigned[ch];
    const min = input.range.min[axis] ?? -1,
      max = input.range.max[axis] ?? 1;
    const center =
      ch === "throttle"
        ? (min + max) / 2
        : clamp(input.centers[axis] ?? (min + max) / 2, min, max);
    const half = Math.min(max - center, center - min);
    bindings[ch] = {
      ...base.bindings[ch],
      axis,
      min,
      max: max > min ? max : min + 1e-3,
      center,
      reversed: reversedFor(ch, sign),
      deadzone:
        ch === "throttle" ? 0 : suggestDeadzone(input.noise[axis] ?? 0, half),
      expo: input.expo?.[ch] ?? 0,
    };
  }
  return {
    version: CALIBRATION_VERSION,
    deviceId: input.deviceId,
    mode: input.mode,
    bindings,
    noise: [...input.noise],
    ...(input.switches && Object.keys(input.switches).length
      ? { switches: input.switches }
      : {}),
  };
}

/* First-run state -------------------------------------------------------- */

export interface SetupState {
  /** Wizard finished and saved for `deviceId`. */
  completed: boolean;
  /** The pilot chose "Skip" (default mapping in use). */
  skipped: boolean;
  deviceId?: string;
  /** A flight has not yet started since the calibration was saved. */
  firstFlightPending?: boolean;
}

export function parseSetupState(text: string | null): SetupState | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object") return null;
    return {
      completed: v.completed === true,
      skipped: v.skipped === true,
      ...(typeof v.deviceId === "string" ? { deviceId: v.deviceId } : {}),
      ...(v.firstFlightPending === true ? { firstFlightPending: true } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Open the wizard automatically on the first visit, or when no calibration
 * has been saved (and the pilot has not chosen to skip it).
 */
export function shouldOpenWizard(
  state: SetupState | null,
  hasSavedCalibration: boolean,
) {
  if (state?.completed || state?.skipped) return false;
  return !hasSavedCalibration;
}

/** A device other than the calibrated one: suggest recalibration. */
export function needsRecalibration(
  state: SetupState | null,
  deviceId: string | undefined,
) {
  return !!(
    state?.completed &&
    state.deviceId &&
    deviceId &&
    deviceId !== state.deviceId
  );
}

/** Throttle must be at idle before a flight starts (fraction 0–1). */
export const THROTTLE_SAFE_MAX = 0.05;
export function throttleSafe(throttle: number) {
  return Number.isFinite(throttle) && throttle <= THROTTLE_SAFE_MAX;
}
