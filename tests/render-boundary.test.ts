import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { daylight, sunPosition } from "../src/render/solar";
import { heightFogFactor } from "../src/render/fog";
import { RENDER_CONFIG } from "../src/render/render-config";
import { createRecording } from "../src/core/experiment";
import { bundledAircraft } from "../src/app/bundled-aircraft";
import { Simulation, calmEnvironment } from "../src/core/simulation";
import { launchState } from "../src/core/launch";

const root = join(__dirname, "..");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? files(path)
      : /\.ts$/.test(name)
        ? [path]
        : [];
  });
const imports = (path: string) =>
  [
    ...readFileSync(path, "utf8").matchAll(
      /^import\s+(type\s+)?[^;]*?from\s+"([^"]+)"/gms,
    ),
  ].map((m) => ({ typeOnly: !!m[1], from: m[2] }));

describe("render module boundary (one way: simulation → render)", () => {
  it("the simulation core never imports the render layer or three.js", () => {
    for (const file of files(join(root, "src/core")))
      for (const i of imports(file)) {
        expect(i.from, relative(root, file)).not.toMatch(/render|view|^three/);
      }
  });
  it("the render layer reads simulation types only (no runtime sim imports)", () => {
    for (const file of files(join(root, "src/render")))
      for (const i of imports(file)) {
        if (/\.\.\/(core|app|input|view)\//.test(i.from))
          expect(
            i.typeOnly,
            `${relative(root, file)} imports ${i.from} at runtime`,
          ).toBe(true);
      }
  });
  it("no render or view code assigns to simulation state", () => {
    const write =
      /\bsim(?:ulation)?\.(?:state|environment|aircraft|lastForces)\b[\w.[\]]*\s*(?:[+\-*/]?=(?!=)|\+\+|--)/;
    // The pattern itself must catch writes and ignore reads.
    expect(write.test("sim.state.position[0] = 1")).toBe(true);
    expect(write.test("sim.environment.windMps += 2")).toBe(true);
    expect(write.test("const p = sim.state.position;")).toBe(false);
    expect(write.test("if (sim.state.time === 0)")).toBe(false);
    for (const dir of ["src/render", "src/view"])
      for (const file of files(join(root, dir))) {
        const text = readFileSync(file, "utf8");
        expect(write.test(text), relative(root, file)).toBe(false);
      }
  });
  it("render settings are not part of a flight recording", () => {
    const aircraft = bundledAircraft[0],
      environment = calmEnvironment();
    const sim = new Simulation(
      aircraft,
      environment,
      launchState(aircraft, "airborne", environment),
    );
    const text = JSON.stringify(createRecording(sim));
    for (const key of [
      "quality",
      "dynamicResolution",
      "vignette",
      "exposure",
      "bloom",
    ])
      expect(text).not.toContain(`"${key}"`);
  });
});

describe("sun position at the Manisa field", () => {
  const { latitudeDeg: lat, dayOfYear: day } = RENDER_CONFIG.site;
  const deg = (r: number) => (r * 180) / Math.PI;
  it("culminates due south at 90° − latitude + declination", () => {
    const noon = sunPosition(12, day, lat);
    // Day 172 is the June solstice: declination ≈ +23.44°.
    expect(deg(noon.elevation)).toBeCloseTo(90 - lat + 23.44, 1);
    expect(deg(noon.azimuth)).toBeCloseTo(180, 6);
  });
  it("rises in the north-east and sets in the north-west in summer", () => {
    const morning = sunPosition(6, day, lat),
      evening = sunPosition(18, day, lat);
    expect(deg(morning.azimuth)).toBeGreaterThan(45);
    expect(deg(morning.azimuth)).toBeLessThan(90);
    expect(deg(evening.azimuth)).toBeGreaterThan(270);
    expect(deg(evening.azimuth)).toBeLessThan(315);
    expect(morning.elevation).toBeCloseTo(evening.elevation, 10);
  });
  it("crosses the horizon at the sunrise equation's hour angle", () => {
    const decl = (23.44 * Math.PI) / 180,
      phi = (lat * Math.PI) / 180;
    const h0 = Math.acos(-Math.tan(phi) * Math.tan(decl));
    const sunset = 12 + (h0 * 180) / Math.PI / 15;
    expect(Math.abs(sunPosition(sunset, day, lat).elevation)).toBeLessThan(
      0.002,
    );
  });
  it("returns a unit north/east/up direction consistent with the angles", () => {
    for (const hour of [5, 8, 12, 15.5, 19]) {
      const s = sunPosition(hour, day, lat);
      expect(Math.hypot(...s.direction)).toBeCloseTo(1, 12);
      expect(Math.asin(s.direction[2])).toBeCloseTo(s.elevation, 12);
    }
  });
  it("daylight fades smoothly through twilight", () => {
    const rad = Math.PI / 180;
    expect(daylight(-10 * rad)).toBe(0);
    expect(daylight(30 * rad)).toBe(1);
    let last = 0;
    for (let e = -6; e <= 8; e += 0.25) {
      const d = daylight(e * rad);
      expect(d).toBeGreaterThanOrEqual(last);
      last = d;
    }
  });
});

describe("height fog", () => {
  /** Numerical optical depth along the ray: ∫ density·exp(−y/H) ds. */
  const numeric = (
    camera: [number, number, number],
    point: [number, number, number],
    density: number,
    falloff: number,
  ) => {
    const n = 20000,
      length = Math.hypot(...point.map((v, i) => v - camera[i]));
    let optical = 0;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n,
        y = camera[1] + (point[1] - camera[1]) * t;
      optical += density * Math.exp(-Math.max(y, 0) / falloff) * (length / n);
    }
    return 1 - Math.exp(-optical);
  };
  it.each([
    [
      [0, 2, 0],
      [3000, 0, 0],
    ],
    [
      [0, 2, 0],
      [2000, 900, 400],
    ],
    [
      [0, 400, 0],
      [-5000, 10, 3000],
    ],
    [
      [0, 50, 0],
      [0, 50, 8000],
    ],
  ] as [[number, number, number], [number, number, number]][])(
    "matches numerical integration from %j to %j",
    (camera, point) => {
      expect(heightFogFactor(camera, point, 0.00012, 850)).toBeCloseTo(
        numeric(camera, point, 0.00012, 850),
        4,
      );
    },
  );
  it("thins with altitude and grows with distance", () => {
    const low = heightFogFactor([0, 2, 0], [4000, 2, 0]),
      high = heightFogFactor([0, 1500, 0], [4000, 1500, 0]);
    expect(high).toBeLessThan(low);
    expect(heightFogFactor([0, 2, 0], [8000, 2, 0])).toBeGreaterThan(low);
    expect(heightFogFactor([0, 2, 0], [0, 2, 0])).toBe(0);
  });
});
