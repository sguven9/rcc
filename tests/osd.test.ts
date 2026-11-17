/**
 * OSD visibility and content (task §3): shown only in FPV during a flight,
 * kept in full-screen flight, absent in the pilot view, and never showing
 * NaN or undefined values.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Osd, osdMarkup } from "../src/view/osd";
import { flightSetupMarkup } from "../src/view/flight-setup";
import { formatOsd, readInstruments } from "../src/core/instruments";
import { parseAircraft } from "../src/core/schema";
import { Simulation, calmEnvironment } from "../src/core/simulation";
import { findTrim } from "../src/core/trim";

interface FakeElement {
  hidden: boolean;
  textContent: string;
  style: Record<string, string>;
  width: number;
  height: number;
  getBoundingClientRect(): DOMRect;
  getContext(): null;
}
let elements: Map<string, FakeElement>;
const rect = { top: 0, left: 0, width: 1280, height: 720 } as DOMRect;
beforeEach(() => {
  elements = new Map();
  const ids = [...osdMarkup().matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  for (const id of ids)
    elements.set(id, {
      hidden: id === "osd",
      textContent: "",
      style: {},
      width: 420,
      height: 34,
      getBoundingClientRect: () => rect,
      getContext: () => null,
    });
  (globalThis as { document?: unknown }).document = {
    getElementById: (id: string) => elements.get(id) ?? null,
  };
});
afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
});

describe("OSD visibility", () => {
  it("is on by default in the flight setup", () => {
    expect(flightSetupMarkup()).toMatch(/id="osd-toggle" checked/);
  });
  it("shows in FPV during a flight and hides in the pilot view or menus", () => {
    const osd = new Osd();
    const box = elements.get("osd")!;
    osd.enabled = true;
    osd.active = true; // FPV camera
    osd.inFlight = true;
    expect(osd.visible).toBe(true);
    expect(box.hidden).toBe(false);
    osd.active = false; // pilot (ground) view
    expect(box.hidden).toBe(true);
    osd.active = true;
    osd.inFlight = false; // menu / setup
    expect(box.hidden).toBe(true);
    osd.inFlight = true;
    osd.enabled = false; // user toggle
    expect(box.hidden).toBe(true);
  });
  it("is not among the elements full-screen flight hides", () => {
    const css = readFileSync("src/view/osd.css", "utf8");
    const immersiveRules = [
      ...css.matchAll(/body\.flight-immersive[^{]*\{[^}]*\}/g),
    ].map((m) => m[0]);
    expect(immersiveRules.length).toBeGreaterThan(0);
    const hiding = immersiveRules.filter((r) => /display:\s*none/.test(r));
    expect(hiding.length).toBeGreaterThan(0);
    for (const rule of hiding) expect(rule).not.toMatch(/\.osd\b|#osd\b/);
  });
});

describe("OSD content", () => {
  it.each(["ft-simple-cub", "ef-apprentice-sts", "ft-22-raptor"])(
    "%s: every field is a finite, unit-labelled value",
    (id) => {
      const a = parseAircraft(
        JSON.parse(readFileSync(`aircraft/${id}.json`, "utf8")),
      );
      const trim = findTrim(a, a.reference.trimSpeedMps ?? 12);
      const sim = new Simulation(
        a,
        { ...calmEnvironment(), windMps: [2, -3, 0] },
        { ...trim.state, position: [0, 0, -40] },
      );
      for (let i = 0; i < 250; i++) sim.step({ ...trim.controls, throttle: 1 });
      const osd = new Osd();
      osd.enabled = osd.active = osd.inFlight = true;
      for (const units of [
        { speed: "kmh", altitude: "m" },
        { speed: "kt", altitude: "ft" },
      ] as const) {
        const r = readInstruments(sim, {
          headingOffsetDeg: 103,
          location: { latitude: 38.6, longitude: 27.4 },
        });
        const text = formatOsd(r, units);
        osd.update(r, text, {
          mode: "ACRO",
          verticalFovDeg: 70,
          odometerFactor: 1,
          odometerLabel: "km",
          viewRect: rect,
        });
        for (const value of Object.values(text))
          expect(String(value)).not.toMatch(/NaN|undefined|Infinity/);
        for (const [key, el] of elements) {
          expect(el.textContent, key).not.toMatch(/NaN|undefined|Infinity/);
          for (const style of Object.values(el.style))
            expect(style, key).not.toMatch(/NaN|undefined/);
        }
        expect(text.speed).toContain(units.speed === "kmh" ? "km/h" : "kt");
        expect(text.altitude).toContain(units.altitude);
        expect(text.wind).toContain(units.speed === "kmh" ? "km/h" : "kt");
        expect(text.heading).toMatch(/^\d{3}°$/);
        expect(text.throttle).toBe("100%");
        expect(text.time).toBe("00:02");
        expect(elements.get("osd-mode")!.textContent).toBe("ACRO");
      }
    },
  );
});
