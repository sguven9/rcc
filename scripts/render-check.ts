/**
 * Visual regression and performance check for the flight renderer.
 *
 *   npm run dev                       # in one terminal (development build)
 *   npm run render:check              # compare against the references
 *   npm run render:check -- --update  # accept the current images
 *   npm run render:check -- --url http://127.0.0.1:5173 --frames 30
 *   npm run render:check -- --quality high   # one preset only
 *
 * For every quality preset it switches the renderer through the same path as
 * the settings panel (a switch that throws fails the run), draws six fixed
 * views (hangar, runway, grass close-up, sunset sky, aircraft close-up, FPV)
 * and records CPU frame time, draw calls and triangles against the budgets
 * in src/render/render-config.ts. The High preset is
 * compared pixel-by-pixel with tests/visual-reference/*.png; the table and
 * images go to results/render-check/. Needs Playwright with Chromium
 * (optional; not a project dependency).
 *
 * Timings are measured in whatever browser runs the script: a headless
 * software renderer is far slower than a real GPU and only shows relative
 * cost between presets.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { RENDER_CONFIG } from "../src/render/render-config";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const url = option("url", "http://127.0.0.1:5173") + "/#/fly";
const frames = Number(option("frames", "12"));
const update = flag("update");
const root = join(import.meta.dirname, "..");
const referenceDir = join(root, "tests/visual-reference");
const outDir = join(root, "results/render-check");
const QUALITIES = ["low", "medium", "high", "ultra"] as const;
const REFERENCE_QUALITY = "high";
/** Width of stored reference images (px); height follows the viewport. */
const REFERENCE_WIDTH = 640;
/** A view fails when more than this share of pixels differs by > 10 %. */
const MAX_CHANGED_PIXELS = 0.04;

type View =
  | { kind: "debug"; position: number[]; target: number[]; fov?: number }
  | { kind: "aircraft" }
  | { kind: "sunset" }
  | { kind: "fpv" };
const VIEWS: Record<string, View> = {
  hangar: { kind: "debug", position: [-25, 6, -45], target: [-5, 3, -75] },
  runway: { kind: "debug", position: [-40, 2.5, 0], target: [60, 0, 0] },
  "grass-close": {
    kind: "debug",
    position: [20, 1.2, 25],
    target: [30, 0.2, 35],
  },
  "sunset-sky": { kind: "sunset" },
  "aircraft-close": { kind: "aircraft" },
  fpv: { kind: "fpv" },
};

async function main() {
  let chromium;
  try {
    ({ chromium } = createRequire(import.meta.url)("playwright"));
  } catch {
    console.error(
      "render:check needs Playwright with Chromium (npm i -D playwright && npx playwright install chromium).",
    );
    process.exit(2);
  }
  mkdirSync(outDir, { recursive: true });
  mkdirSync(referenceDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(e.message));
  page.on("console", (m: { type(): string; text(): string }) => {
    if (m.type() === "error") errors.push(m.text());
  });
  // tsx keeps function names with an `__name` helper that the page lacks.
  await page.addInitScript("globalThis.__name = (f) => f;");
  // Skip the first-run transmitter wizard; no gamepad is attached.
  await page.addInitScript(() => {
    localStorage.setItem(
      "rcsim.setup.v1",
      JSON.stringify({ completed: false, skipped: true }),
    );
    navigator.getGamepads = () => [];
  });
  await page.goto(url);
  await page.waitForFunction(
    () => (window as unknown as { __sim?: { scene?: unknown } }).__sim?.scene,
    undefined,
    { timeout: 60000 },
  );
  await page.waitForTimeout(4000);
  await page.addStyleTag({
    content:
      "#app > :not(main), .app-header, aside, .flight-bottom, #flight-feedback, .field-label, .camera-bar, .flight-navigation, #position-panel { display: none !important }",
  });

  const rows: Record<string, unknown>[] = [];
  const failures: string[] = [];
  const only = option("quality", "");
  for (const quality of QUALITIES.filter((q) => !only || q === only)) {
    const before = errors.length;
    await page.evaluate((q: string) => {
      const s = (window as any).__sim.scene;
      s.setRenderSettings({
        quality: q,
        hour: 15.5,
        dynamicResolution: false,
        vignette: true,
      });
    }, quality);
    if (errors.length > before)
      failures.push(`switch to ${quality}: ${errors.slice(before).join("; ")}`);
    for (const [name, view] of Object.entries(VIEWS)) {
      const r = await page.evaluate(
        ({
          view,
          frames,
          width,
        }: {
          view: View;
          frames: number;
          width: number;
        }) => {
          const w = window as any;
          const s = w.__sim.scene,
            sim = w.__sim.sim,
            engine = s.engine;
          const controls = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
          s.mode = "ground";
          s.debugView = undefined;
          engine.setHour(view.kind === "sunset" ? 19 : 15.5);
          if (view.kind === "debug") s.debugView = view;
          else if (view.kind === "aircraft") {
            const p = sim.state.position;
            s.debugView = {
              position: [p[0] - 2.2, 1.0, p[1] - 2.4],
              target: [p[0], 0.35, p[1]],
              fov: 45,
            };
          } else if (view.kind === "sunset") {
            const d = engine.sunDirection;
            s.debugView = {
              position: [0, 25, 0],
              target: [d.x * 1000, 25 + Math.max(d.y, 0.05) * 600, d.z * 1000],
              fov: 60,
            };
          } else s.mode = "fpv";
          const gl = s.renderer.getContext();
          for (let i = 0; i < 3; i++) s.render(sim, controls, 1 / 60);
          const t0 = performance.now();
          for (let i = 0; i < frames; i++) {
            s.render(sim, controls, 1 / 60);
            gl.finish();
          }
          const ms = (performance.now() - t0) / frames;
          const info = {
            calls: s.renderer.info.render.calls,
            triangles: s.renderer.info.render.triangles,
          };
          // The image is drawn at a fixed cloud time with no time step, so it
          // does not depend on how many frames ran before.
          engine.sky.cloudTime = 0;
          s.render(sim, controls, 0);
          const source = s.renderer.domElement as HTMLCanvasElement;
          const small = document.createElement("canvas");
          small.width = width;
          small.height = Math.round((source.height / source.width) * width);
          small
            .getContext("2d")!
            .drawImage(source, 0, 0, small.width, small.height);
          const shot = small.toDataURL("image/png");
          s.debugView = undefined;
          s.mode = "ground";
          engine.setHour(15.5);
          return {
            ms: +ms.toFixed(2),
            calls: info.calls,
            triangles: info.triangles,
            buffer: `${gl.drawingBufferWidth}×${gl.drawingBufferHeight}`,
            shot,
          };
        },
        { view, frames, width: REFERENCE_WIDTH },
      );
      const png = Buffer.from(r.shot.split(",")[1], "base64");
      writeFileSync(join(outDir, `${quality}-${name}.png`), png);
      const row: Record<string, unknown> = {
        quality,
        view: name,
        ms: r.ms,
        calls: r.calls,
        triangles: r.triangles,
        buffer: r.buffer,
      };
      const budget = RENDER_CONFIG.budgets[quality];
      if (r.calls > budget.drawCalls || r.triangles > budget.triangles)
        failures.push(
          `${quality}/${name}: ${r.calls} calls, ${r.triangles} triangles exceed the budget (${budget.drawCalls}, ${budget.triangles})`,
        );
      if (quality === REFERENCE_QUALITY) {
        const ref = join(referenceDir, `${name}.png`);
        if (update || !existsSync(ref)) {
          writeFileSync(ref, png);
          row.reference = "updated";
        } else {
          const changed = await page.evaluate(
            async ([a, b]: string[]) => {
              const load = (src: string) =>
                new Promise<HTMLImageElement>((ok, fail) => {
                  const img = new Image();
                  img.onload = () => ok(img);
                  img.onerror = fail;
                  img.src = src;
                });
              const [x, y] = await Promise.all([load(a), load(b)]);
              if (x.width !== y.width || x.height !== y.height) return 1;
              const pixels = (img: HTMLImageElement) => {
                const c = document.createElement("canvas");
                c.width = img.width;
                c.height = img.height;
                const ctx = c.getContext("2d")!;
                ctx.drawImage(img, 0, 0);
                return ctx.getImageData(0, 0, c.width, c.height).data;
              };
              const p = pixels(x),
                q = pixels(y);
              let n = 0;
              for (let i = 0; i < p.length; i += 4) {
                const d = Math.max(
                  Math.abs(p[i] - q[i]),
                  Math.abs(p[i + 1] - q[i + 1]),
                  Math.abs(p[i + 2] - q[i + 2]),
                );
                if (d > 25) n++;
              }
              return n / (p.length / 4);
            },
            [
              "data:image/png;base64," + readFileSync(ref).toString("base64"),
              r.shot,
            ],
          );
          row.reference = `${(changed * 100).toFixed(2)} % changed`;
          if (changed > MAX_CHANGED_PIXELS)
            failures.push(
              `${name}: ${(changed * 100).toFixed(1)} % of pixels differ from the reference`,
            );
        }
      }
      rows.push(row);
    }
  }
  await browser.close();
  console.table(rows);
  const table = [
    "| Quality | View | CPU ms/frame | Draw calls | Triangles | Buffer | Reference |",
    "|---|---|---:|---:|---:|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.quality} | ${r.view} | ${r.ms} | ${r.calls} | ${r.triangles} | ${r.buffer} | ${r.reference ?? ""} |`,
    ),
  ].join("\n");
  writeFileSync(join(outDir, "report.md"), table + "\n");
  writeFileSync(join(outDir, "report.json"), JSON.stringify(rows, null, 2));
  if (errors.length) failures.push(...errors.map((e) => `page error: ${e}`));
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log(`Render check passed; images and report in ${outDir}`);
}
main();
