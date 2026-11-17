/**
 * Smooth presentation between fixed physics steps. The simulation advances in
 * 1/120 s steps while the screen refreshes at its own rate; drawing the latest
 * step directly makes motion judder. The render layer keeps the state of the
 * previous and the current step and draws a blend at the fraction of a step
 * that has elapsed since the last one (Fiedler, "Fix your timestep").
 *
 * Read-only: snapshots copy the state; nothing here writes to the simulation.
 */
import type { Quat, Vec3 } from "../core/math";

export interface RenderSnapshot {
  position: Vec3;
  /** Body→world quaternion [x, y, z, w]. */
  orientation: Quat;
  /** Surface commands (servo positions) for the moving control surfaces. */
  surfaceCommands?: number[];
  time: number;
}

export function snapshot(state: {
  position: Vec3;
  orientation: Quat;
  surfaceCommands?: number[];
  time: number;
}): RenderSnapshot {
  return {
    position: [...state.position] as Vec3,
    orientation: [...state.orientation] as Quat,
    ...(state.surfaceCommands
      ? { surfaceCommands: [...state.surfaceCommands] }
      : {}),
    time: state.time,
  };
}

/** Shortest-path normalized spherical interpolation of unit quaternions. */
export function slerp(a: Quat, b: Quat, t: number): Quat {
  let [bx, by, bz, bw] = b;
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let k0: number, k1: number;
  if (cos > 0.9995) {
    k0 = 1 - t;
    k1 = t;
  } else {
    const angle = Math.acos(cos),
      sin = Math.sin(angle);
    k0 = Math.sin((1 - t) * angle) / sin;
    k1 = Math.sin(t * angle) / sin;
  }
  const q: Quat = [
    a[0] * k0 + bx * k1,
    a[1] * k0 + by * k1,
    a[2] * k0 + bz * k1,
    a[3] * k0 + bw * k1,
  ];
  const n = Math.hypot(...q) || 1;
  return q.map((v) => v / n) as Quat;
}

/** Blend two snapshots; `alpha` 0 = previous step, 1 = current step. */
export function interpolate(
  previous: RenderSnapshot,
  current: RenderSnapshot,
  alpha: number,
): RenderSnapshot {
  const t = Math.min(1, Math.max(0, Number.isFinite(alpha) ? alpha : 1));
  const lerp = (x: number, y: number) => x + (y - x) * t;
  const surfaces =
    previous.surfaceCommands &&
    current.surfaceCommands &&
    previous.surfaceCommands.length === current.surfaceCommands.length
      ? current.surfaceCommands.map((v, i) =>
          lerp(previous.surfaceCommands![i], v),
        )
      : current.surfaceCommands;
  return {
    position: previous.position.map((v, i) =>
      lerp(v, current.position[i]),
    ) as Vec3,
    orientation: slerp(previous.orientation, current.orientation, t),
    ...(surfaces ? { surfaceCommands: [...surfaces] } : {}),
    time: lerp(previous.time, current.time),
  };
}

/**
 * Keeps the previous/current pair as steps arrive. A jump (reset, replay
 * restart, teleport) larger than `teleportM` is not blended.
 */
export class StateInterpolator {
  private previous?: RenderSnapshot;
  private current?: RenderSnapshot;
  constructor(readonly teleportM = 25) {}
  /** Call after every physics step. */
  push(state: Parameters<typeof snapshot>[0]) {
    const next = snapshot(state);
    const jump =
      this.current &&
      Math.hypot(
        next.position[0] - this.current.position[0],
        next.position[1] - this.current.position[1],
        next.position[2] - this.current.position[2],
      ) > this.teleportM;
    this.previous = jump || !this.current ? next : this.current;
    this.current = next;
  }
  /** Forget history (on reset): the next frame shows the state as is. */
  reset() {
    this.previous = this.current = undefined;
  }
  /** State to draw at `alpha` of a step after the latest one. */
  sample(alpha: number, fallback: Parameters<typeof snapshot>[0]) {
    if (!this.previous || !this.current) return snapshot(fallback);
    return interpolate(this.previous, this.current, alpha);
  }
}
