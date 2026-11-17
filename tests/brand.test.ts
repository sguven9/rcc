/**
 * Product identity: the previous name appears nowhere except in the license
 * texts (whose copyright notice the MIT license requires us to keep); the
 * name comes from src/config/brand.ts; the app shows no outbound links.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { BRAND, storageKey } from "../src/config/brand";
import { workbenchMarkup } from "../src/view/workbench";
import { flightSetupMarkup } from "../src/view/flight-setup";

/** The former product name, assembled so this file does not match itself. */
const OLD = ["rc", "forge"].join("");

const tracked = () =>
  execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);

describe("brand", () => {
  it("has no trace of the former name outside the license texts", () => {
    const allowed = /^(LICENSE|public\/licenses\/[^/]+)$/;
    const offenders: string[] = [];
    for (const file of tracked()) {
      if (allowed.test(file)) continue;
      if (file.toLowerCase().includes(OLD)) offenders.push(file);
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue; // deleted in the working tree
      }
      if (text.toLowerCase().includes(OLD)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
  it("keeps the original MIT copyright notice in LICENSE", () => {
    const license = readFileSync("LICENSE", "utf8");
    expect(license).toMatch(/^MIT License/);
    expect(license).toMatch(/Copyright \(c\)/);
    expect(license).toMatch(/Permission is hereby granted/);
  });
  it("reads the product name and storage prefix from one config", () => {
    expect(BRAND.name.length).toBeGreaterThan(0);
    expect(storageKey("expo")).toBe(`${BRAND.storagePrefix}expo`);
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain("%APP_NAME%");
    expect(html).not.toContain(BRAND.name); // injected at build time only
  });
  it("shows no outbound links or open-source/guide links in the app", () => {
    const markup = workbenchMarkup() + flightSetupMarkup();
    expect(markup).not.toMatch(/href="https?:/);
    expect(markup).not.toMatch(/href="\/docs/);
    expect(markup).not.toMatch(/github|open-source|source code/i);
    const html = readFileSync("index.html", "utf8");
    expect(html).not.toMatch(/<a\s/);
    expect(html).not.toMatch(/open-source|github/i);
  });
});
