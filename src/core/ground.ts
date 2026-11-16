import type { Aircraft } from "./schema";
import type { State, Controls } from "./simulation";
import type { massProperties } from "./aircraft";
import { PHYSICS, slidingFriction, type GroundSurface } from "./physics-config";
import {
  add,
  sub,
  scale,
  cross,
  dot,
  rotate,
  inverseQ,
  matVec,
  unit,
  clamp,
  length,
  type Vec3,
} from "./math";
/**
 * Sequential point impulses with Coulomb friction on flat terrain at world Z=0.
 *
 * - Normal impulses are inelastic (restitution 0), so resting wheels do not
 *   bounce. Penetration is removed by position projection beyond a small slop
 *   (split impulse): no Baumgarte velocity is injected, so a resting aircraft
 *   keeps exactly zero velocity instead of a residual upward speed.
 * - Friction impulses are clamped to the Coulomb cone |j_t| ≤ μ·j_n on the
 *   accumulated impulse, so friction stops relative motion without reversing it.
 *   Sliding uses μ_k above a slip speed, static μ_s below; pairs combine as
 *   √(μ_contact·μ_surface). Tyres roll with C_rr resistance.
 */
export function resolveGroundContacts(
  s: State,
  a: Aircraft,
  properties: ReturnType<typeof massProperties>,
  c: Controls,
  dt: number,
  surface: GroundSurface = "asphalt",
) {
  const config = PHYSICS.contact;
  const tyre = slidingFriction("tyre", surface),
    skid = slidingFriction("skid", surface);
  const rollingFriction = PHYSICS.friction.rolling[surface];
  const { mass, cg, inverseInertia } = properties;
  const bodyToWorld = (v: Vec3) => rotate(s.orientation, v),
    worldToBody = (v: Vec3) => rotate(inverseQ(s.orientation), v);
  const inverseWorld = (v: Vec3) =>
    bodyToWorld(matVec(inverseInertia, worldToBody(v)));
  const pointVelocity = (r: Vec3) =>
    add(s.velocity, bodyToWorld(cross(s.omega, worldToBody(r))));
  const apply = (r: Vec3, impulse: Vec3) => {
    s.velocity = add(s.velocity, scale(impulse, 1 / mass));
    s.omega = add(
      s.omega,
      matVec(inverseInertia, worldToBody(cross(r, impulse))),
    );
  };
  const effectiveMass = (r: Vec3, n: Vec3) =>
    1 / mass + dot(n, cross(inverseWorld(cross(r, n)), r));
  const contacts = a.contactPoints.map((p) => {
    const r = bodyToWorld(sub(p.positionM, cg));
    return {
      p,
      r,
      depth: add(s.position, r)[2],
      normalImpulse: 0,
      lateralImpulse: 0,
      rollingImpulse: 0,
    };
  });
  const touching = contacts.filter((v) => v.depth >= -config.touchToleranceM);
  if (!touching.length) {
    s.status = "flying";
    return;
  }
  const hard = touching.some(
    (v) =>
      v.depth >= 0 &&
      (pointVelocity(v.r)[2] >
        (v.p.kind !== "body" ? config.crashSinkMps : config.bodyCrashSinkMps) ||
        (v.p.kind === "body" && length(s.velocity) > config.bodyCrashSpeedMps)),
  );
  const body = touching.find((v) => v.depth >= 0 && v.p.kind === "body");
  if (hard || body) {
    const up = bodyToWorld([0, 0, -1]);
    s.status = !hard && up[2] < -0.9 ? "landed" : "crashed";
    s.position[2] -= Math.max(0, ...touching.map((v) => v.depth));
    s.velocity = [0, 0, 0];
    s.omega = [0, 0, 0];
    s.motors.fill(0);
    return;
  }
  s.status = "grounded";
  const wheels = touching.filter((v) => v.p.kind !== "body");
  // Static or kinetic sliding friction, chosen once from the pre-solve slip.
  const sliding = wheels.map((wheel) => {
    const v = pointVelocity(wheel.r),
      slip = Math.hypot(v[0], v[1]) > config.slipSpeedMps;
    const mu = wheel.p.kind === "skid" ? skid : tyre;
    return slip ? mu.kinetic : mu.static;
  });
  for (let iteration = 0; iteration < config.iterations; iteration++)
    for (const [index, wheel] of wheels.entries()) {
      const { r, p } = wheel,
        n: Vec3 = [0, 0, -1];
      const lateralFriction = sliding[index];
      let velocity = pointVelocity(r);
      // Project accumulated impulses, not each iteration's increment. Later
      // contacts must be able to release excess support from earlier iterations.
      const previousNormal = wheel.normalImpulse;
      wheel.normalImpulse = Math.max(
        0,
        previousNormal - dot(velocity, n) / effectiveMass(r, n),
      );
      apply(r, scale(n, wheel.normalImpulse - previousNormal));
      const steer = p.steering ? c.yaw * 0.45 : 0;
      const bodyForward = bodyToWorld([Math.cos(steer), Math.sin(steer), 0]);
      const forward = unit([bodyForward[0], bodyForward[1], 0]),
        side: Vec3 = [-forward[1], forward[0], 0];
      velocity = pointVelocity(r);
      const previousLateral = wheel.lateralImpulse;
      wheel.lateralImpulse = clamp(
        previousLateral - dot(velocity, side) / effectiveMass(r, side),
        -lateralFriction * wheel.normalImpulse,
        lateralFriction * wheel.normalImpulse,
      );
      apply(r, scale(side, wheel.lateralImpulse - previousLateral));
      velocity = pointVelocity(r);
      const previousRolling = wheel.rollingImpulse;
      const friction = p.kind === "skid" ? lateralFriction : rollingFriction;
      wheel.rollingImpulse = clamp(
        previousRolling - dot(velocity, forward) / effectiveMass(r, forward),
        -friction * wheel.normalImpulse,
        friction * wheel.normalImpulse,
      );
      apply(r, scale(forward, wheel.rollingImpulse - previousRolling));
    }
  // Position projection (split impulse): remove most penetration beyond the slop.
  const depth = Math.max(0, ...wheels.map((v) => v.depth));
  s.position[2] -= Math.max(0, depth - config.slopM) * config.projection;
  // Rest: an unpowered aircraft that has stopped is held exactly still.
  if (
    s.motors.every((m) => m < 1e-3) &&
    length(s.velocity) < config.restSpeedMps &&
    length(s.omega) < config.restRateRadS
  ) {
    s.velocity = [0, 0, 0];
    s.omega = [0, 0, 0];
  }
}
