# Graphics engine and quality presets

Since 0.9.0 the flight scene is drawn by an independent render layer in `src/render/`. It adds a physically based sky and lighting, cascaded sun shadows, ambient occlusion, height fog and a tone-mapped HDR post chain, with four quality presets. The physics, controls, calibration, OSD data and Expo logic are unchanged, and render settings never enter a recording.

Values marked **estimate (tahmin)** are visual judgement, not measurements. Every one of them lives in [`src/render/render-config.ts`](../src/render/render-config.ts), and that file is the only place to tune them.

## Stack and why

| Choice                                       | Reason                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **three.js r185 on WebGL2** (kept)           | The field's custom terrain, grass and runway shaders hook into three.js materials (`onBeforeCompile`), and the post chain uses `EffectComposer`. Both are WebGL-only. Rewriting them for a new engine or for TSL/WebGPU would have replaced working, tested scenery code without making the picture any better.                                                      |
| **WebGPU: detected, not used yet**           | `render/backend.ts` probes for an adapter and `chooseBackend` is the single switch. `WEBGPU_RENDERING_READY` stays `false` until the custom shaders are ported to node materials. Headless test browsers expose `navigator.gpu` but grant no adapter, so a WebGPU path could not be verified here. Without WebGL2 the app shows a clear message instead of crashing. |
| **Linear depth** (logarithmic depth removed) | GTAO, polygon offsets and CSM need a linear depth buffer. Near planes are 0.15 m for the pilot view and 0.03 m for FPV, and the far plane is 14 km. The FPV near plane was previously 0.003 m, which only worked with logarithmic depth.                                                                                                                             |
| **three.js example modules**                 | Sky (Preetham Rayleigh/Mie with clouds), CSM, GTAOPass, UnrealBloomPass, OutputPass, SMAA/FXAA. They are MIT-licensed, ship with the three.js package and add no dependency.                                                                                                                                                                                         |

## Module map

| File                             | Role                                                                                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `render/engine.ts`               | `RenderEngine`: renderer, sky, IBL, shadows, post chain, quality switch, time of day, dynamic resolution and per-stage CPU timings. Also `parseRenderSettings`. |
| `render/render-config.ts`        | Presets, budgets and every tunable value.                                                                                                                       |
| `render/backend.ts`              | WebGPU/WebGL2 capability probe, backend choice and the no-backend message.                                                                                      |
| `render/quality.ts`              | Automatic preset from device hints, `DynamicResolution`, `pixelRatioFor` and `lodLevel`.                                                                        |
| `render/interpolation.ts`        | Snapshots and interpolation between physics steps (lerp + shortest-path slerp), plus `StateInterpolator`, which never blends across a teleport.                 |
| `render/solar.ts`                | Sun elevation and azimuth for the hour at the field (38.61° N, June solstice) and the twilight fade.                                                            |
| `render/sky.ts`                  | `SkySystem`: the dome follows the camera and the clouds drift with the wind. Also sun colour, haze colour and exposure by sun elevation.                        |
| `render/environment.ts`          | IBL: the same sky without clouds or sun disc, PMREM-filtered, rebuilt only when the sun moves or the preset changes.                                            |
| `render/shadows.ts`              | `SunShadows`: CSM chained with each material's own shader hook.                                                                                                 |
| `render/fog.ts`                  | Analytic exponential height fog with aerial perspective (patched fog chunks), plus a CPU mirror for tests.                                                      |
| `render/post.ts`                 | `PostChain`: scene (HDR, MSAA ×4 at High/Ultra) → GTAO → bloom → ACES + sRGB → vignette → FXAA/SMAA.                                                            |
| `render/materials.ts`            | Aircraft finishes: clearcoat paint, tinted glass, object-space wear and panel lines (no UVs needed), and propeller motion discs.                                |
| `render/textures/procedural.ts`  | Tileable, deterministic concrete, asphalt and corrugated-sheet normal/roughness maps, generated at start-up.                                                    |
| `render/textures/alpha-bleed.ts` | Colour bleeding for alpha-cutout atlases, so leaves get no white fringes.                                                                                       |

Data flow per frame:

1. `main.ts` advances the physics in fixed 1/120 s steps (`FlightClock`) and pushes each state to the `StateInterpolator`.
2. `FlightScene.render` receives `interpolator.sample(clock.alpha)` and poses the aircraft and cameras from that copy.
3. `RenderEngine.frame` updates the sky, shadows and post chain and draws.

Nothing in `src/render` writes to the simulation, and `src/core` does not import the render layer. `tests/render-boundary.test.ts` checks both.

## Quality presets

The presets are chosen in **Flight setup → Field → Graphics quality**: Auto, Low, Medium, High or Ultra. Auto picks Low for software renderers or a max texture size below 4096; Medium for mobile devices, ≤4 cores or ≤4 GB; Ultra for a discrete GPU with ≥8 cores; High otherwise. Dynamic resolution then lowers the render scale (down to 0.6) after a run of slow frames and raises it again when there is headroom.

|                          | Low              | Medium           | High             | Ultra            |
| ------------------------ | ---------------- | ---------------- | ---------------- | ---------------- |
| Pixel density ×          | 0.75             | 1                | 1                | 1.25             |
| Sun shadows              | 2 × 1024², 120 m | 2 × 1024², 250 m | 3 × 2048², 450 m | 4 × 2048², 800 m |
| Grass density            | 35 %             | 70 %             | 100 %            | 100 %            |
| Ambient occlusion (GTAO) | –                | –                | ✓                | ✓                |
| Bloom                    | –                | ✓                | ✓                | ✓                |
| Anti-aliasing            | FXAA             | FXAA             | MSAA ×4 + SMAA   | MSAA ×4 + SMAA   |
| Clouds                   | –                | ✓                | ✓                | ✓                |
| IBL cube face            | 64               | 128              | 256              | 256              |

The drawing buffer is capped at 2× device pixels and 3.7 megapixels whatever the preset. Low still uses two cascades because three.js CSM casts no shadow with one. Foliage uses alpha-to-coverage only when MSAA is on: with FXAA the coverage dither shows.

The time-of-day slider runs from 06:00 to 19:15. At that latitude the sun sets at about 19:21 local solar time. Past that the scene has no night lighting, so the slider stops there.

## Lighting chain

- **Sun:** the direction comes from `solar.ts`, converted to the runway-aligned scene axes. The colour reddens with low elevation. Intensity is 4.2 at zenith (estimate) and fades through civil twilight.
- **Sky:** Preetham Rayleigh/Mie with turbidity 4.2, Rayleigh 1.4, Mie 0.004 and g = 0.82 (estimate: a clear, slightly hazy summer day). The sun disc and halo come from the same model. Clouds are the sky shader's procedural layer at 42 % coverage and drift at three times the surface wind (estimate).
- **IBL:** the sky without clouds or sun disc is rendered into a PMREM cube, at 0.38 × intensity (estimate), scaled by daylight. Every PBR material picks up a correct sky-coloured ambient light and reflection from it.
- **Shadows:** CSM in practical split mode with soft PCF, depth bias −1e−5 of the 2 km light range (≈ 2 cm) and normal bias 0.02. The bias was tuned so the aircraft's shadow touches its wheels.
- **Fog:** exponential height fog, density 1.2e−4 /m at ground level (≈ 25 km visibility, estimate), falling off by e every 850 m (estimate), integrated analytically along each view ray. Its colour follows the horizon haze.
- **Exposure:** ACES filmic tone mapping. Exposure goes from 0.52 at noon to 0.72 at sunset (estimate). It follows the sun's elevation deterministically rather than a luminance histogram, so it never pumps.
- **Bloom:** strength 0.14, threshold 5 in linear HDR (estimate), so only the sun and specular glints glow, not the bright sky or concrete.

## Materials and assets

Everything new in 0.9.0 is generated in code. No image, model or font was added, and the 5.2 MB HDR sky photograph was removed.

| Asset                                                                            | Origin                                                                              | Licence                         |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------- |
| Sky, sun disc and clouds                                                         | three.js `Sky` shader, parameters in `render-config`                                | MIT (three.js)                  |
| Image-based light                                                                | Generated each time the sun moves, from the sky above                               | – (computed)                    |
| Concrete, asphalt and corrugated-sheet micro-relief                              | `render/textures/procedural.ts`, deterministic seeds                                | Original, MIT (this repository) |
| Aircraft clearcoat, glass, wear and panel lines                                  | `render/materials.ts` shader patch                                                  | Original, MIT                   |
| Propeller discs                                                                  | `render/materials.ts` geometry                                                      | Original, MIT                   |
| Runway paint, rubber, cracks; hangar, clubhouse, tables, parked models, windsock | Existing procedural builders in `view/`                                             | Original, MIT                   |
| Ground textures (turf, dry ground, rock, asphalt)                                | ambientCG / Poly Haven, see [scenery assets](../public/scenery/README.md)           | CC0 (unchanged)                 |
| Vegetation atlas `vegetation-v2.png`                                             | Generated for the project (2026), see [scenery assets](../public/scenery/README.md) | Project asset (unchanged)       |

There are no brands, logos or designs copied from real products. The aircraft, buildings and vehicles are built procedurally from the simulator's own data.

## Budgets and measurements

`npm run render:check` (with `npm run dev` running) switches through every preset through the same path as the settings panel. In each preset it draws six fixed views (hangar, runway, grass close-up, sunset sky, aircraft close-up, FPV) and records CPU frame time, draw calls and triangles. It fails if a preset switch throws, if a view exceeds `RENDER_CONFIG.budgets`, or if a High image differs from `tests/visual-reference/` by more than 4 % of pixels. `--update` accepts new references after a deliberate visual change. The stored references were drawn by headless Chromium with software WebGL. A different GPU or driver rasterises slightly differently, so on a new machine first run `--update` on the unchanged branch, then compare. Each image is drawn at a fixed cloud time so that it does not depend on how many frames ran before it. `--quality high` limits the run to one preset.

Measured on 17 November 2026 with `render:check --update` at a 1280 × 720 viewport. The browser was headless Chromium on a cloud machine without a GPU (software WebGL). The times are wall-clock milliseconds per frame including `gl.finish()`. They show the relative cost of the presets, **not** the frame rate of a real laptop GPU. The ≥ 60 fps (Medium) and ≥ 45 fps (High) targets on a mid-range laptop could not be measured here; that measurement is still open. Dynamic resolution protects the frame rate in the meantime.

| Preset | Buffer     | ms/frame (min–max of 6 views) | Draw calls (max) | Triangles (max) | Budget: calls / triangles |
| ------ | ---------- | ----------------------------- | ---------------- | --------------- | ------------------------- |
| Low    | 960 × 498  | 1.7–4.8                       | 365              | 93 404          | 420 / 110 000             |
| Medium | 1280 × 664 | 2.2–8.4                       | 397              | 116 546         | 460 / 135 000             |
| High   | 1280 × 664 | 2.5–8.6                       | 541              | 148 548         | 620 / 175 000             |
| Ultra  | 1600 × 830 | 2.8–10.9                      | 670              | 162 794         | 770 / 190 000             |

Before the new engine, the same machine measured 113–269 draw calls, 59 000–126 000 triangles and 1.4–3.8 ms on five of these views. The draw calls roughly doubled, because every shadow cascade redraws its casters and each post pass adds a full-screen draw. Above 220 m the aircraft stops casting shadows (`lodLevel`), which removes it from every cascade.

`RenderEngine.timings` reports the CPU time of the shadow update, the post chain and the whole frame for profiling in a real browser. The full per-view table is written to `results/render-check/report.md`.

The download is 29 MB for `dist` in total (limit 40 MB). The flight scene loads about 24 MB of scenery images, mostly the CC0 ground scans and the vegetation atlas.

## Not done in 0.9.0 (next steps)

- **WebGPU path:** port the terrain, grass, runway and wear shaders to node materials, then flip `WEBGPU_RENDERING_READY`.
- **Models:** glTF aircraft and scenery models with three LODs and KTX2 textures; the aircraft are still built procedurally from their JSON definitions. Wheels do not spin and there is no suspension animation.
- **Vegetation:** tree impostors, and a new hand-made or CC0 atlas to replace the generated vegetation atlas.
- **Terrain:** clipmap terrain LOD (the field uses one 128 × 128 mesh with denser cells near the runway) and real cloud shadows.
- **Effects:** TAA, motion blur, FPV lens distortion and vibration, particles, heat haze and screen-space contact shadows. GTAO only partly stands in for contact shadows.
- **Profiling:** GPU timer queries. The engine reports CPU time per stage only, and headless timings come from a software renderer.
- **Scenery props:** no cars or chairs were added (the field has tables, toolboxes and parked models); no water at the Manisa site.
- **Night lighting** beyond civil twilight.
