import { expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { parseAircraft } from "../src/core/schema";
import { aircraftCredit } from "../src/app/aircraft-credit";
import { savedAircraft } from "../src/app/aircraft-storage";
import bronco from "../aircraft/ft-bronco.json";
import vortex from "../aircraft/vt-simple-trainer.json";

it("credits every bundled design and keeps only the Vortex Simple Trainer", () => {
  const all = readdirSync("aircraft")
    .filter((p) => p.endsWith(".json"))
    .map((p) =>
      parseAircraft(JSON.parse(readFileSync(`aircraft/${p}`, "utf8"))),
    );
  expect(all.every((a) => a.credit)).toBe(true);
  expect(
    all.filter((a) => a.name === "Simple Trainer").map((a) => a.id),
  ).toEqual(["vt-simple-trainer"]);
  expect(all.some((a) => a.id === "simple-trainer")).toBe(false);
});

it("accepts older files without credit, rejects unsafe link protocols and shows plain-text credit", () => {
  const a = parseAircraft(bronco);
  delete a.credit;
  expect(aircraftCredit(parseAircraft(a))).toBe("");
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///tmp/test",
  ]) {
    expect(() =>
      parseAircraft({ ...a, credit: { name: "Creator", url } }),
    ).toThrow();
  }
  a.credit = {
    name: '<img src=x onerror="alert(1)">',
    url: "https://example.org/?a=1&b=2",
  };
  const html = aircraftCredit(parseAircraft(a));
  expect(html).not.toContain("<img");
  expect(html).toContain("&lt;img");
  // The app shows no outbound links; the URL stays in the definition.
  expect(html).not.toContain("<a ");
  expect(html).not.toContain("example.org");
});

it.each([
  [bronco, "FT Bronco"],
  [vortex, "Simple Trainer · Vortex RC"],
] as const)(
  "refreshes old catalog labels and credits without replacing the applied setup",
  (raw, oldName) => {
    const base = parseAircraft(raw),
      edited = structuredClone(base);
    delete edited.credit;
    edited.name = oldName;
    edited.parts[0].massKg += 0.025;
    const storage = { getItem: () => JSON.stringify(edited) };
    const loaded = savedAircraft(base, storage);
    expect(loaded.name).toBe(base.name);
    expect(loaded.credit).toEqual(base.credit);
    expect(loaded.parts).toEqual(edited.parts);
    edited.name = "My custom build";
    expect(savedAircraft(base, storage).name).toBe("My custom build");
  },
);
