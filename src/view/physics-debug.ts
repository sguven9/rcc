/**
 * Physics debug overlay: world-space force/velocity arrows at the CG and a
 * rolling energy graph. Rendering only — it reads the simulation's last
 * force breakdown and never changes simulation state.
 */
import * as T from "three";
import type { Simulation } from "../core/simulation";
import { PHYSICS } from "../core/physics-config";
import { rotate, type Vec3 } from "../core/math";

/** NED (north, east, down) to scene coordinates. */
const toScene = (v: Vec3) => new T.Vector3(v[0], -v[2], v[1]);

const VECTORS = [
  { key: "velocity", color: 0xffffff, label: "Ground velocity" },
  { key: "wind", color: 0x5fc9f0, label: "Wind (air velocity)" },
  { key: "thrust", color: 0xf0a33c, label: "Thrust" },
  { key: "aero", color: 0x7ed37e, label: "Wing & tail aerodynamics" },
  { key: "drag", color: 0xe3655b, label: "Body drag" },
  { key: "weight", color: 0xb48ce8, label: "Weight" },
] as const;
export const PHYSICS_DEBUG_LEGEND = VECTORS;

export class PhysicsDebugArrows {
  readonly group = new T.Group();
  private arrows = new Map<string, T.ArrowHelper>();
  constructor() {
    for (const v of VECTORS) {
      const arrow = new T.ArrowHelper(
        new T.Vector3(1, 0, 0),
        new T.Vector3(),
        1,
        v.color,
        0.12,
        0.06,
      );
      // Draw over the airframe so arrows inside the fuselage stay visible.
      for (const m of [
        arrow.line.material,
        arrow.cone.material,
      ] as T.Material[]) {
        m.depthTest = false;
        m.transparent = true;
      }
      arrow.renderOrder = 30;
      this.arrows.set(v.key, arrow);
      this.group.add(arrow);
    }
    this.group.visible = false;
  }
  /**
   * Forces are scaled so the weight arrow is half the wingspan long; velocities
   * use 0.06 m per m/s.
   */
  update(sim: Simulation, origin: T.Vector3) {
    if (!this.group.visible) return;
    const s = sim.state,
      f = sim.lastForces,
      mass = sim.properties.mass,
      span = sim.aircraft.reference.spanM;
    const forceScale = (0.5 * span) / (mass * PHYSICS.gravity);
    const body = (v: Vec3) => rotate(s.orientation, v);
    const vectors: Record<string, { v: Vec3; scale: number }> = {
      velocity: { v: s.velocity, scale: 0.06 },
      wind: { v: sim.airVelocity(s), scale: 0.06 },
      thrust: { v: body(f.thrust), scale: forceScale },
      aero: { v: body(f.aero), scale: forceScale },
      drag: { v: body(f.bodyDrag), scale: forceScale },
      weight: { v: [0, 0, mass * PHYSICS.gravity], scale: forceScale },
    };
    for (const [key, { v, scale }] of Object.entries(vectors)) {
      const arrow = this.arrows.get(key)!;
      const world = toScene(v),
        length = world.length() * scale;
      arrow.visible = length > 0.01;
      if (!arrow.visible) continue;
      arrow.position.copy(origin);
      arrow.setDirection(world.normalize());
      arrow.setLength(
        length,
        Math.min(0.12, length * 0.3),
        Math.min(0.06, length * 0.15),
      );
    }
  }
  dispose() {
    this.group.traverse((o) => {
      if (o instanceof T.Mesh || o instanceof T.Line) {
        o.geometry.dispose();
        (o.material as T.Material).dispose();
      }
    });
  }
}

/** Per-motor shaft dynamics as text lines (dynamic-rotor motors only). */
export function rotorDebugLines(sim: Simulation) {
  return sim.lastForces.rotors.map((r) => {
    const thrust = Math.hypot(...sim.lastForces.thrust);
    return `M${r.motor + 1} ${r.rpm.toFixed(0)} rpm · Qm ${r.qMotor.toFixed(3)} · Qp ${r.qProp.toFixed(3)} · I·Ω̇ ${r.qSpinUp.toFixed(3)} N·m · T ${thrust.toFixed(2)} N`;
  });
}

/**
 * Rolling 20 s energy graph: kinetic, potential, propeller rotation
 * (½·I·Ω²) and their sum, in joules. The shaft energy is part of the total so
 * a spin-up does not look like a mechanical-energy jump.
 */
export class EnergyGraph {
  private samples: {
    t: number;
    kinetic: number;
    potential: number;
    rotor: number;
  }[] = [];
  constructor(private canvas: HTMLCanvasElement) {}
  reset() {
    this.samples = [];
  }
  push(sim: Simulation) {
    const s = sim.state,
      m = sim.properties.mass;
    const speed2 = s.velocity.reduce((n, v) => n + v * v, 0);
    this.samples.push({
      t: s.time,
      kinetic: 0.5 * m * speed2,
      potential: m * PHYSICS.gravity * Math.max(0, -s.position[2]),
      rotor: sim.lastForces.rotors.reduce((n, r) => n + r.energyJ, 0),
    });
    while (this.samples.length && s.time - this.samples[0].t > 20)
      this.samples.shift();
    if (this.samples.length && this.samples.at(-1)!.t < this.samples[0].t)
      this.samples = [this.samples.at(-1)!];
  }
  draw() {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const w = this.canvas.width,
      h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(14,18,22,0.82)";
    ctx.fillRect(0, 0, w, h);
    const data = this.samples;
    if (data.length < 2) return;
    const total = (d: (typeof data)[number]) =>
      d.kinetic + d.potential + d.rotor;
    const max = Math.max(...data.map(total), 1) * 1.1;
    const t0 = data.at(-1)!.t - 20;
    const x = (t: number) => ((t - t0) / 20) * (w - 10) + 5;
    const y = (e: number) => h - 18 - (e / max) * (h - 34);
    const series: [string, (d: (typeof data)[number]) => number][] = [
      ["#f0a33c", (d) => d.kinetic],
      ["#5fc9f0", (d) => d.potential],
      ["#b48ce8", (d) => d.rotor],
      ["#f2f2ee", total],
    ];
    for (const [color, value] of series) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      data.forEach((d, i) =>
        i ? ctx.lineTo(x(d.t), y(value(d))) : ctx.moveTo(x(d.t), y(value(d))),
      );
      ctx.stroke();
    }
    const last = data.at(-1)!;
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillStyle = "#f2f2ee";
    ctx.fillText(`E ${total(last).toFixed(0)} J`, 6, 13);
    ctx.fillStyle = "#f0a33c";
    ctx.fillText(`kinetic ${last.kinetic.toFixed(0)}`, 70, 13);
    ctx.fillStyle = "#5fc9f0";
    ctx.fillText(`potential ${last.potential.toFixed(0)}`, 150, 13);
    if (data.some((d) => d.rotor > 0)) {
      ctx.fillStyle = "#b48ce8";
      ctx.fillText(`prop ${last.rotor.toFixed(1)}`, 236, 13);
    }
    ctx.fillStyle = "#9aa3ad";
    ctx.fillText("last 20 s", 6, h - 5);
  }
}
