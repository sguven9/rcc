/**
 * Manisa site and simplified flight UI (task §7 tests 4–7): OSD only in FPV,
 * immersive mode hides and restores the interface, props rest on the ground
 * and collide, grass sways with the wind and fades with distance, and wheel
 * friction follows the ground material.
 */
import { describe, expect, it, vi } from "vitest";
import * as T from "three";
import { readFileSync } from "node:fs";
import { osdShown, setImmersive, IMMERSIVE_CLASS } from "../src/app/immersive";
import { MANISA_PROPS, PROP_SIZE, type PropKind } from "../src/core/site-props";
import { addSiteProps, propGeometry } from "../src/view/site-props";
import { collectFieldObstacles } from "../src/view/field-collisions";
import { obstacleHit } from "../src/core/obstacles";
import { sceneries, surfaceAt } from "../src/core/scenery";
import {
  GRASS,
  bladeFade,
  grassClumps,
  swayOffset,
} from "../src/core/grass-field";
import { addGrass } from "../src/view/grass";
import { formatOsd, readInstruments } from "../src/core/instruments";
import {
  Simulation,
  calmEnvironment,
  initialState,
} from "../src/core/simulation";
import { parseAircraft } from "../src/core/schema";
import { PHYSICS } from "../src/core/physics-config";

const manisa = sceneries.manisa;

describe("4. OSD is the FPV overlay only", () => {
  it("shows in FPV when enabled and never in the pilot view", () => {
    expect(osdShown(true, "fpv")).toBe(true);
    expect(osdShown(true, "ground")).toBe(false);
    expect(osdShown(false, "fpv")).toBe(false);
  });
  it("formats the live values in the chosen units", () => {
    const a = parseAircraft(
      JSON.parse(readFileSync("aircraft/ft-simple-cub.json", "utf8")),
    );
    const s = initialState(a, 10, 50, 0);
    const sim = new Simulation(
      a,
      { ...calmEnvironment(), windMps: [0, -4, 0] },
      s,
    );
    sim.lastForces = sim.forces(sim.state, {
      roll: 0,
      pitch: 0,
      yaw: 0,
      throttle: 0,
    });
    const r = readInstruments(sim, { headingOffsetDeg: 103 });
    expect(r.altitudeM).toBeCloseTo(50, 9);
    expect(r.headingDeg).toBeCloseTo(103, 9);
    expect(r.windSpeedMps).toBeCloseTo(4, 9);
    const metric = formatOsd(r, { speed: "kmh", altitude: "m" });
    const imperial = formatOsd(r, { speed: "kt", altitude: "ft" });
    expect(metric.altitude).toBe("50 m");
    expect(imperial.altitude).toBe(`${(50 / 0.3048).toFixed(0)} ft`);
    expect(metric.speed).toBe(`${(r.airspeedMps * 3.6).toFixed(0)} km/h`);
    expect(imperial.wind).toBe(`${(4 / 0.514444).toFixed(0)} kt`);
  });
});

describe("5. immersive flight", () => {
  const fakeDocument = () => {
    const classes = new Set<string>();
    const doc = {
      body: {
        classList: {
          toggle: (name: string, on: boolean) =>
            on ? classes.add(name) : classes.delete(name),
        },
      },
      documentElement: {
        requestFullscreen: vi.fn(async () => {
          doc.fullscreenElement = {};
        }),
      },
      fullscreenElement: null as unknown,
      exitFullscreen: vi.fn(async () => {
        doc.fullscreenElement = null;
      }),
    };
    return { doc, classes };
  };
  it("hides the interface and goes full screen on start, restores on exit", async () => {
    const { doc, classes } = fakeDocument();
    setImmersive(doc, true);
    expect(classes.has(IMMERSIVE_CLASS)).toBe(true);
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledOnce();
    await Promise.resolve();
    setImmersive(doc, false);
    expect(classes.has(IMMERSIVE_CLASS)).toBe(false);
    expect(doc.exitFullscreen).toHaveBeenCalledOnce();
  });
  it("still hides the interface when full screen is refused", async () => {
    const { doc, classes } = fakeDocument();
    doc.documentElement.requestFullscreen = vi.fn(() =>
      Promise.reject(new Error("no gesture")),
    );
    setImmersive(doc, true);
    await Promise.resolve();
    expect(classes.has(IMMERSIVE_CLASS)).toBe(true);
  });
  it("hides every panel in CSS, keeping the OSD", () => {
    const css = readFileSync("src/view/osd.css", "utf8");
    for (const selector of [
      ".app-header",
      ".camera-bar",
      ".flight-navigation",
      ".flight-bottom",
      ".flight-key-guide",
    ])
      expect(css).toContain(`body.flight-immersive ${selector}`);
    expect(css).not.toContain("body.flight-immersive .osd,");
  });
});

describe("6. ground objects", () => {
  it("rest exactly on the ground and match their nominal size", () => {
    for (const kind of Object.keys(PROP_SIZE) as PropKind[]) {
      const box = propGeometry(kind).boundingBox!;
      expect(Math.abs(box.min.y)).toBeLessThan(1e-9);
      const [l, w, h] = PROP_SIZE[kind];
      const size = box.getSize(new T.Vector3());
      expect(Math.abs(size.y / h - 1)).toBeLessThan(0.25);
      expect(
        Math.abs(Math.max(size.x, size.z) / Math.max(l, w) - 1),
      ).toBeLessThan(0.25);
    }
  });
  it("collide: every prop has a solid box and a swept path through a car hits", () => {
    const field = new T.Group();
    addSiteProps(field, MANISA_PROPS);
    const obstacles = collectFieldObstacles(field).filter((o) =>
      o.id.startsWith("prop-collider"),
    );
    expect(obstacles).toHaveLength(MANISA_PROPS.length);
    for (const p of MANISA_PROPS) {
      const hit = obstacles.some(
        (o) =>
          Math.abs(o.center[0] - p.x) < 0.5 &&
          Math.abs(o.center[1] - p.z) < 0.5 &&
          Math.abs(o.center[2] + o.halfSize[2]) < 0.02,
      );
      expect(hit).toBe(true);
    }
    const car = MANISA_PROPS.find((p) => p.kind === "car-sedan")!;
    const box = obstacles.find(
      (o) =>
        Math.abs(o.center[0] - car.x) < 0.5 &&
        Math.abs(o.center[1] - car.z) < 0.5,
    )!;
    expect(
      obstacleHit(
        [car.x - 10, car.z, -0.8],
        [car.x + 10, car.z, -0.8],
        0.05,
        box,
      ),
    ).not.toBeNull();
  });
});

describe("7. grass", () => {
  it("leans downwind and changes direction with the wind", () => {
    const east = swayOffset(5, 0, 1, 0, 1, 0.3),
      north = swayOffset(0, -5, 1, 0, 1, 0.3);
    expect(east[0]).toBeGreaterThan(0);
    expect(Math.abs(east[1])).toBeLessThan(1e-12);
    expect(north[1]).toBeLessThan(0);
    expect(Math.abs(north[0])).toBeLessThan(1e-12);
    expect(swayOffset(0, 0, 1, 0, 1, 0.3)).toEqual([0, 0]);
    // Roots stay put; stronger wind leans further (until the cap).
    expect(swayOffset(5, 0, 1, 0, 0, 0.3)[0]).toBe(0);
    expect(swayOffset(10, 0, 0, 0, 1, 0.3)[0]).toBeGreaterThan(
      swayOffset(5, 0, 0, 0, 1, 0.3)[0],
    );
  });
  it("fades out monotonically between the LOD distances", () => {
    expect(bladeFade(0)).toBe(1);
    expect(bladeFade(GRASS.fadeStartM)).toBe(1);
    expect(bladeFade(GRASS.fadeEndM)).toBe(0);
    let previous = 1;
    for (let d = 0; d < 100; d += 2) {
      expect(bladeFade(d)).toBeLessThanOrEqual(previous);
      previous = bladeFade(d);
    }
  });
  it("grows only on grass, short by the runway and taller away from it", () => {
    const clumps = grassClumps(manisa, 3, { x: [-60, 60], z: [-45, 45] });
    expect(clumps.length).toBeGreaterThan(1000);
    for (const c of clumps) expect(surfaceAt(manisa, c.x, c.z)).toBe("grass");
    const near = clumps.filter((c) => Math.abs(c.z) < 12),
      far = clumps.filter((c) => Math.abs(c.z) > 30);
    const mean = (l: typeof clumps) =>
      l.reduce((n, c) => n + c.height, 0) / l.length;
    expect(mean(far)).toBeGreaterThan(mean(near) * 2);
    expect(far.length / 15).toBeGreaterThan(near.length / 4 / 1.0);
  });
  it("builds instanced tiles and updates wind and LOD without errors", () => {
    const field = new T.Group();
    const grass = addGrass(field, manisa);
    expect(grass.count).toBeGreaterThan(5000);
    const camera = new T.PerspectiveCamera();
    for (const [x, z] of [
      [0, 20],
      [150, -30],
      [-180, 60],
    ]) {
      camera.position.set(x, 2, z);
      expect(() => grass.update(camera, [3, -2], 5)).not.toThrow();
      const tiles = field.getObjectByName("grass-blades")!.children;
      for (const t of tiles) {
        const box = new T.Box3().setFromObject(t);
        const centre = box.getCenter(new T.Vector3());
        const d = Math.hypot(centre.x - x, centre.z - z);
        if (d > GRASS.fadeEndM + 2 * GRASS.tileM) expect(t.visible).toBe(false);
      }
    }
  });
});

describe("ground material and wheel friction", () => {
  it("maps the Manisa runway, grass and bare soil", () => {
    expect(surfaceAt(manisa, 0, 0)).toBe("asphalt");
    expect(surfaceAt(manisa, 0, 20)).toBe("grass");
    expect(surfaceAt(manisa, 30, -20)).toBe("grass");
    expect(surfaceAt(manisa, 0, -24)).toBe("asphalt"); // taxiway
    expect(surfaceAt(manisa, 0, 120)).toBe("dirt");
  });
  it("slows a rolling aircraft more on grass than on the runway", () => {
    const a = parseAircraft(
      JSON.parse(readFileSync("aircraft/vt-simple-trainer.json", "utf8")),
    );
    const roll = (z: number) => {
      const env = {
        ...calmEnvironment(),
        sceneryId: "manisa",
        surfaceZones: true,
      };
      const s = initialState(a, 4, 0, 0);
      const cg = new Simulation(a).properties.cg;
      const lowest = Math.max(
        ...a.contactPoints.map((p) => p.positionM[2] + p.wheelRadiusM),
      );
      s.position = [0, z, -(lowest - cg[2])];
      s.status = "grounded";
      const sim = new Simulation(a, env, s);
      for (let i = 0; i < 240; i++)
        sim.step({ roll: 0, pitch: 0, yaw: 0, throttle: 0 });
      return sim.state.velocity[0];
    };
    expect(roll(20)).toBeLessThan(roll(0));
    expect(PHYSICS.friction.rolling.grass).toBeGreaterThan(
      PHYSICS.friction.rolling.asphalt,
    );
  });
});
