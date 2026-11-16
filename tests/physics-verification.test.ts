/**
 * Analytical verification of the flight engine (task checklist §4).
 * The ground is a flat plane, so the inclined-plane case is verified with the
 * equivalent horizontal force: a = (F − μ_k·N)/m, and no motion for F < μ_s·N.
 */
import { describe, expect, it } from "vitest";
import tiny from "../aircraft/ft-tiny-trainer.json";
import bronco from "../aircraft/ft-bronco.json";
import { readFileSync, readdirSync } from "node:fs";
import { parseAircraft, type Aircraft } from "../src/core/schema";
import { massProperties } from "../src/core/aircraft";
import {
  Simulation,
  calmEnvironment,
  densityAt,
  initialState,
  neutralControls,
  type Environment,
} from "../src/core/simulation";
import { PHYSICS, slidingFriction } from "../src/core/physics-config";
import { launchState, fitLandingGear } from "../src/core/launch";
import { axisQ, dot, matVec, rotate, type Vec3 } from "../src/core/math";
import { obstacleHit, type Obstacle } from "../src/core/obstacles";

const g = PHYSICS.gravity;

/** A rigid test body: Tiny Trainer mass/inertia, no lifting surfaces. */
function testBody(
  drag: Vec3 = [0, 0, 0],
  contacts: Aircraft["contactPoints"] = [],
): Aircraft {
  const a = parseAircraft(structuredClone(tiny));
  a.surfaces = [];
  a.motors = [];
  delete a.battery;
  a.fuselageDragAreaM2 = 0;
  if (drag.some((v) => v > 0)) a.bodyDragAreaM2 = drag;
  else delete a.bodyDragAreaM2;
  a.angularDamping = [1e-12, 1e-12, 1e-12];
  a.contactPoints = contacts.length
    ? contacts
    : [
        {
          id: "nose",
          positionM: [0.2, 0, 0.02],
          spanLinked: false,
          kind: "body",
          steering: false,
          wheelRadiusM: 0.03,
        },
      ];
  return a;
}

describe("1. free fall in vacuum", () => {
  it("matches y = ½·g·t² within 0.1 %", () => {
    const a = testBody(),
      s = initialState(a, 0, 1000, 0);
    s.velocity = [0, 0, 0];
    const sim = new Simulation(a, calmEnvironment(), s);
    for (let i = 0; i < 2 * 120; i++) sim.step(neutralControls());
    const fallen = sim.state.position[2] + 1000;
    expect(Math.abs(fallen / (0.5 * g * 4) - 1)).toBeLessThan(1e-3);
  });
});

describe("2. terminal velocity with quadratic drag", () => {
  it("approaches v_t = √(2mg/(ρ·C_d·A))", () => {
    const cdA = 0.01,
      a = testBody([cdA, cdA, cdA]),
      m = massProperties(a).mass;
    const s = initialState(a, 0, 3000, 0);
    s.velocity = [0, 0, 0];
    const sim = new Simulation(a, calmEnvironment(), s);
    for (let i = 0; i < 30 * 120; i++) sim.step(neutralControls());
    const vt = Math.sqrt((2 * m * g) / (1.225 * cdA));
    expect(Math.abs(sim.state.velocity[2] / vt - 1)).toBeLessThan(0.01);
  });
  it("never reverses a velocity component, even for a very light draggy body", () => {
    const a = testBody([2, 2, 2]);
    a.parts = a.parts.map((p) => ({ ...p, massKg: p.massKg * 0.1 }));
    const s = initialState(a, 60, 3000, 0);
    const sim = new Simulation(a, calmEnvironment(), s);
    let previous = 60;
    for (let i = 0; i < 240; i++) {
      sim.step(neutralControls());
      const vx = sim.state.velocity[0];
      expect(vx).toBeGreaterThanOrEqual(0);
      expect(vx).toBeLessThanOrEqual(previous + 1e-9);
      previous = vx;
    }
  });
});

describe("3. Coulomb friction (flat-ground equivalent of the inclined plane)", () => {
  const skids = (z: number): Aircraft["contactPoints"] =>
    (
      [
        [0.15, 0],
        [-0.15, -0.12],
        [-0.15, 0.12],
      ] as const
    ).map(([x, y], i) => ({
      id: `skid-${i}`,
      positionM: [x, y, z],
      spanLinked: false,
      kind: "skid" as const,
      steering: false,
      wheelRadiusM: 0.03,
    }));
  const grounded = (a: Aircraft, velocity: Vec3) => {
    const cg = massProperties(a).cg;
    const s = initialState(a, 0, 0, 0);
    s.position = [0, 0, -(0.05 - cg[2])];
    s.velocity = velocity;
    s.status = "grounded";
    return s;
  };
  it("slides with a = μ_k·g, stops at v₀²/(2·μ_k·g) and never reverses", () => {
    const a = testBody([0, 0, 0], skids(0.05));
    const mu = slidingFriction("skid", "asphalt").kinetic;
    const sim = new Simulation(a, calmEnvironment(), grounded(a, [3, 0, 0]));
    let distance = 0;
    for (let i = 0; i < 240; i++) {
      const before = sim.state.position[0];
      sim.step(neutralControls());
      distance += sim.state.position[0] - before;
      expect(sim.state.velocity[0]).toBeGreaterThanOrEqual(-1e-9);
    }
    expect(sim.state.velocity[0]).toBe(0);
    expect(Math.abs(distance / (9 / (2 * mu * g)) - 1)).toBeLessThan(0.03);
  });
  it("holds still while the applied force stays below μ_s·N, slides above it", () => {
    const base = parseAircraft(structuredClone(tiny));
    const make = (force: number) => {
      const a = testBody([0, 0, 0], skids(0.05));
      const m = structuredClone(base.motors[0]);
      m.positionM = [0.2, 0, massProperties(a).cg[2]];
      m.maxThrustN = force;
      delete m.performance;
      m.zeroThrustSpeedMps = 1000;
      // An ideal constant force source: no shaft dynamics or torque effects.
      for (const key of [
        "motorPowerW",
        "motorInertiaKgM2",
        "redlineRpm",
        "engine",
        "propGovernor",
        "propInertiaKgM2",
        "pFactor",
        "maxRpm",
      ] as const)
        delete m[key];
      delete m.spin;
      a.motors = [m];
      return a;
    };
    const muS = slidingFriction("skid", "asphalt").static,
      muK = slidingFriction("skid", "asphalt").kinetic;
    for (const [fraction, moves] of [
      [0.6, false],
      [1.4, true],
    ] as const) {
      const probe = make(1),
        mass = massProperties(probe).mass,
        force = fraction * muS * mass * g;
      const a = make(force);
      const sim = new Simulation(a, calmEnvironment(), grounded(a, [0, 0, 0]));
      sim.state.motors = [1];
      for (let i = 0; i < 120; i++)
        sim.step({ ...neutralControls(), throttle: 1 });
      if (!moves) expect(Math.abs(sim.state.position[0])).toBeLessThan(1e-4);
      else {
        // a = (F − μ_k·N)/m once sliding.
        const expected = force / mass - muK * g;
        expect(sim.state.velocity[0] / 1).toBeGreaterThan(0.85 * expected);
        expect(sim.state.velocity[0] / 1).toBeLessThan(1.15 * expected);
      }
    }
  });
  it("combines materials as √(μ_contact·μ_surface), kinetic below static", () => {
    const pair = slidingFriction("tyre", "asphalt");
    expect(pair.static).toBeCloseTo(
      Math.sqrt(
        PHYSICS.friction.contact.tyre * PHYSICS.friction.surface.asphalt,
      ),
      12,
    );
    expect(pair.kinetic).toBeLessThan(pair.static);
  });
});

describe("4. light body in a horizontal wind", () => {
  it("is carried towards the wind speed along the analytical quadratic-drag curve", () => {
    const cdA = 0.02,
      wind = 5,
      a = testBody([cdA, cdA, cdA]),
      m = massProperties(a).mass;
    const env: Environment = { ...calmEnvironment(), windMps: [0, wind, 0] };
    const s = initialState(a, 0, 3000, 0);
    s.velocity = [0, 0, 0];
    const sim = new Simulation(a, env, s);
    const t = 30;
    for (let i = 0; i < t * 120; i++) sim.step(neutralControls());
    // dv/dt = k·(W − v)², k = ρ·C_dA/(2m)  ⇒  W − v = 1/(1/W + k·t).
    const k = (1.225 * cdA) / (2 * m);
    const expected = wind - 1 / (1 / wind + k * t);
    expect(Math.abs(sim.state.velocity[1] / expected - 1)).toBeLessThan(0.01);
    expect(sim.state.velocity[1]).toBeLessThan(wind);
  });
});

describe("5. energy conservation without friction or drag", () => {
  it("keeps translational + rotational + potential energy within 1 % over 10 s", () => {
    const a = parseAircraft(structuredClone(bronco));
    a.surfaces = [];
    a.motors = [];
    delete a.battery;
    a.fuselageDragAreaM2 = 0;
    delete a.bodyDragAreaM2;
    a.angularDamping = [1e-12, 1e-12, 1e-12];
    const p = massProperties(a);
    const s = initialState(a, 0, 2000, 30);
    s.velocity = [12, 3, -8];
    s.omega = [4, 2, 6];
    const sim = new Simulation(a, calmEnvironment(), s);
    const energy = () => {
      const st = sim.state;
      return (
        0.5 * p.mass * dot(st.velocity, st.velocity) +
        0.5 * dot(st.omega, matVec(p.inertia, st.omega)) -
        p.mass * g * st.position[2]
      );
    };
    const e0 = energy();
    for (let i = 0; i < 10 * 120; i++) sim.step(neutralControls());
    expect(Math.abs(energy() / e0 - 1)).toBeLessThan(0.01);
  });
});

describe("6. timestep convergence", () => {
  it("halving dt converges at second order", () => {
    const a = parseAircraft(structuredClone(bronco));
    const run = (dt: number) => {
      const sim = new Simulation(
        a,
        calmEnvironment(),
        initialState(a, 12, 50, 2),
      );
      for (let i = 0; i < Math.round(3 / dt); i++)
        sim.step({ ...neutralControls(), pitch: 0.2, roll: 0.1 }, dt);
      return sim.state.position;
    };
    const reference = run(1 / 960);
    const error = (dt: number) =>
      Math.hypot(...run(dt).map((v, i) => v - reference[i]));
    const ratio = error(1 / 120) / error(1 / 240);
    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThan(5.5);
  });
});

describe("7. stress: 1000 randomized flights", () => {
  it("stays finite, bounded and never tunnels through the ground or a thin wall", () => {
    const ids = readdirSync("aircraft").map((f) => f.replace(/\.json$/, ""));
    const fleet = ids.map((id) =>
      parseAircraft(JSON.parse(readFileSync(`aircraft/${id}.json`, "utf8"))),
    );
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 1000; k++) {
      const a = fleet[k % fleet.length];
      const s = initialState(a, 0, 0.3 + rnd() * 30, 0);
      s.orientation = axisQ(
        [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5],
        rnd() * 6.28,
      );
      s.velocity = [rnd() * 60 - 30, rnd() * 60 - 30, rnd() * 60 - 30];
      s.omega = [rnd() * 40 - 20, rnd() * 40 - 20, rnd() * 40 - 20];
      s.motors = s.motors.map(() => rnd());
      const env: Environment = {
        ...calmEnvironment(),
        windMps: [rnd() * 20 - 10, rnd() * 20 - 10, 0],
        turbulence: "dryden",
        densityScaleHeightM: 8500,
        // Strong, frequent discrete gusts on top of the Dryden turbulence.
        discreteGusts: { meanIntervalS: 1, amplitudeMps: 8 },
      };
      const sim = new Simulation(a, env, s);
      for (let i = 0; i < 60; i++) {
        sim.step({
          roll: rnd() * 2 - 1,
          pitch: rnd() * 2 - 1,
          yaw: rnd() * 2 - 1,
          throttle: rnd(),
          gust: rnd() < 0.05 || undefined,
        });
        const st = sim.state;
        // No energy blow-up: speeds and rates stay physical.
        expect(Math.hypot(...st.velocity)).toBeLessThan(150);
        expect(Math.hypot(...st.omega)).toBeLessThan(100);
        // Dynamic shaft speed stays within [0, redline].
        st.rotorRadS?.forEach((w, j) => {
          const model = sim.rotorModels[j];
          expect(Number.isFinite(w)).toBe(true);
          expect(w).toBeGreaterThanOrEqual(0);
          if (model) expect(w).toBeLessThanOrEqual(model.omegaRedline);
        });
        expect(
          [
            ...st.position,
            ...st.velocity,
            ...st.omega,
            ...st.orientation,
          ].every(Number.isFinite),
        ).toBe(true);
        // No contact point may end a step more than a few cm below ground.
        const cg = sim.properties.cg;
        for (const c of a.contactPoints) {
          const z =
            st.position[2] +
            rotate(st.orientation, [
              c.positionM[0] - cg[0],
              c.positionM[1] - cg[1],
              c.positionM[2] - cg[2],
            ])[2];
          if (st.status === "flying") expect(z).toBeLessThan(0.05);
        }
      }
    }
    // Swept collision: a 1 cm wall cannot be skipped at 120 m/s per 1/120 s step.
    const wall: Obstacle = {
      id: "wall",
      shape: "box",
      center: [0.5, 0, -5],
      halfSize: [0.005, 5, 5],
    };
    expect(obstacleHit([0, 0, -5], [1, 0, -5], 0.01, wall)).not.toBeNull();
  }, 120_000);
});

describe("rest and density", () => {
  it("holds a parked aircraft exactly still, with no residual velocity", () => {
    const a = fitLandingGear(parseAircraft(structuredClone(bronco)));
    const sim = new Simulation(a, calmEnvironment(), launchState(a, "ground"));
    for (let i = 0; i < 20 * 120; i++) sim.step(neutralControls());
    expect(sim.state.velocity).toEqual([0, 0, 0]);
    expect(
      Math.hypot(sim.state.position[0], sim.state.position[1]),
    ).toBeLessThan(1e-4);
    expect(sim.state.status).toBe("grounded");
  });
  it("applies the optional density lapse ρ = ρ_field·e^(−h/H)", () => {
    const e: Environment = { ...calmEnvironment(), densityScaleHeightM: 8500 };
    expect(densityAt(e, 0)).toBe(1.225);
    expect(densityAt(e, 8500)).toBeCloseTo(1.225 / Math.E, 12);
    expect(densityAt(calmEnvironment(), 8500)).toBe(1.225);
    expect(densityAt(e, -3)).toBe(1.225);
  });
});
