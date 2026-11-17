# Changelog

Application releases are separate from physics/replay and aircraft format versions. See [versioning](docs/versioning.md). Unreleased entries describe the current development branch, not a published deployment.

## 0.9.0 — Unreleased

- New graphics engine in `src/render/` ([rendering guide](docs/rendering.md)):
  - physically based lighting: a Rayleigh/Mie sky with sun disc and clouds that drift with the wind, image-based light generated from that sky, cascaded soft sun shadows, ambient occlusion (GTAO), height fog with aerial perspective, ACES tone mapping, bloom and an optional vignette;
  - a **time-of-day** slider (06:00–19:15) moves the sun at the Manisa field's latitude; light colour, exposure and haze follow it;
  - **quality presets** Low, Medium, High and Ultra with automatic selection and dynamic resolution, under Flight setup → Field; the choice is stored per browser and never enters a recording;
  - motion is interpolated between the 120 Hz physics steps, so the aircraft moves smoothly at any display rate;
  - aircraft get clearcoat paint, tinted glass, subtle wear and panel lines, and propeller discs at speed; the runway concrete and hangar sheets get procedural surface relief; foliage edges no longer show white fringes;
  - WebGPU is detected but the renderer stays on WebGL2 until the custom shaders are ported; without WebGL2 the app explains why instead of failing.

  Also:
  - the 5.2 MB HDR sky photograph is removed;
  - `npm run render:check` compares six reference views and checks draw-call and triangle budgets per preset;
  - the FPV camera's near plane is now 3 cm (the logarithmic depth buffer was removed for post-processing).

  Simulation compatibility is unchanged (0.14.0); recordings from 0.8.0 replay as before.

## 0.8.0 — Unreleased

- New identity and first-run setup:
  - the product name, tagline and storage prefix live in `src/config/brand.ts`; the previous name, its links and its long introduction page are gone, replaced by a short loading screen with a progress bar;
  - a new warm "Manisa sunset" palette, Sora/Figtree fonts (bundled locally), logo, favicon, share image, focus rings and component styles, all as tokens in `src/theme/`;
  - a full-screen **RC transmitter setup wizard** on the first visit: connect, stick mode, centre and noise, endpoints, automatic channel and direction detection, optional arm/flight-mode switches, live test with an idle-throttle check, and save; it can be rerun from Controllers and is offered when another transmitter is connected;
  - flights no longer start with the throttle up;
  - multirotor and VTOL aircraft were removed (fixed-wing only); stored drone settings are ignored silently;
  - the app shows no outbound links; the MIT license notice stays in `LICENSE`.

  Saved settings move to a new storage prefix, so earlier browser preferences and calibrations are not carried over.

- Full-throttle nose-up fixed at the root ([measurements](docs/physics-engine.md#full-throttle-nose-up-moment-breakdown-and-fix-0140)):
  - an **ACRO** gyro flight controller (default; MANUAL selectable in Flight setup) holds the attitude with centred sticks, never reads throttle and takes its gains from each aircraft's measured control power;
  - blown-wing lift no longer counts span inside the fuselage or nacelles and uses a finite-jet factor, so full-throttle ground lift-off happens near stall speed instead of at 3 m/s;
  - per-preset regression tests for the throttle step, the throttle cut and the ground roll.

  Also:
  - the decorative 3D cockpit, its gauge smoothing and the cockpit panel styles are removed;
  - the OSD is on by default, a stale saved "off" preference from the first OSD build is ignored, and the OSD shows ACRO/MANUAL.

  Simulation compatibility is now 0.14.0.

- Simplified flight app. Removed:
  - the brand, Docs, Local session, version and GitHub links;
  - the Experiments page;
  - the Northfield, Alpine and Desert sites (Manisa only, no site picker);
  - keyboard, gamepad and flight-stick input (RC transmitter only);
  - the chase camera;
  - the Gentle/Standard/Direct presets.

  Added:
  - an **Expos** page with per-channel expo (1 − e)·x + e·x³, curve previews, reset and persistence;
  - FPV as the default view from a massless `viewpoint` in every aircraft file (the decorative 3D cockpit added here was removed again in the next change);
  - an OSD shown only in FPV during flight;
  - full-screen flight with every panel hidden (Esc pauses and restores);
  - instanced grass that sways with the simulated wind, with distance LOD;
  - per-contact ground materials.

  Throttle-induced climb was diagnosed as speed stability (γ ≈ asin(ΔT/W)), not a thrust moment, and is pinned by new tests ([diagnosis](docs/physics-engine.md#throttle-and-pitch-diagnosis-0130)). Simulation compatibility is now 0.13.0.

- Dynamic propeller shaft speed ([details](docs/physics-engine.md#dynamic-shaft-speed-0120)). Motors with `motorPowerW` integrate Ω from motor, propeller and friction torque, so a dive overspeeds the propeller up to redline, a climb loads it, a throttle cut windmills, and a spin-up reacts on the airframe. Also adds slipstream swirl on the tail, an optional constant-speed governor and piston density scaling. The airframe reaction becomes −(Q_motor − Q_f)·ŝ, and H uses I_prop + I_motor. Ω uses a linearly implicit midpoint update: second order and stable for light propellers. Nine presets gain estimated power, rotor inertia and redline. Trim banks to cancel the side force of a sideslip trim. The debug panel shows per-motor rpm and torques, and the energy graph includes shaft energy. The JSBSim adapter mirrors the shaft torque, and the independent RK4 check now integrates Ω. Simulation 0.12.0 opens 0.10.0 and 0.11.0 recordings.

- Propeller side effects and discrete gusts ([details](docs/physics-engine.md#propeller-side-effects-0110)). Add the gyroscopic moment −ω×(I_p·Ω·ŝ) and P-factor thrust-centre shift k_p·sin α_p·R per motor, opt-in through new motor fields `propInertiaKgM2`, `maxRpm` and `pFactor`, and set them with `spin: "cw"` on nine single-motor presets. Add seeded Poisson-triggered "1−cos" gusts with Field-panel rate and peak sliders, a trigger button (key U) and a highlighted minimap wind arrow. The trim solver adds aileron/rudder (or sideslip) trim for propeller torque, applied in flight. Replacing a motor/prop package now drops the old propeller's inertia, rpm and P-factor. The JSBSim adapter mirrors the new moments. Simulation compatibility advances to 0.11.0 and still opens 0.10.0 recordings.

- Physics engine audit ([report](docs/physics-engine.md)). Fix static-friction creep (contact pose correction), the resting residual velocity (split impulse, resting snap), and first-order actuator coupling (RK2 stage-time sampling). Add static/kinetic friction with material combination, a body-drag stability bound, the optional density lapse with height, turbulence intensity, wind direction in 15° steps, a live minimap wind arrow, and a physics debug overlay (force arrows and an energy graph, key G). Constants move to `src/core/physics-config.ts`. Add 12 analytical verification tests. Simulation compatibility advances to 0.10.0.

- Realistic throttle response: propeller thrust now unloads at a zero-thrust speed proportional to shaft speed (advance-ratio law), and brakes above it. A moderate throttle increase now gives a steady climb at constant speed instead of a sharp pitch-up, and closing the throttle slows the aircraft. Simulation compatibility advances to 0.9.3; the JSBSim adapter mirrors it (92 cases, 1012 checks pass).

- Realistic stalls: add wing downwash at the horizontal tail (2·CL/(π·AR), reduced in ground effect) and the post-stall centre-of-pressure shift. Aircraft now stall when the elevator is raised slowly and drop their nose; tail authority and static stability fall to realistic values. Add a shared builder's power-test solver (`src/core/thrust-line.ts`); the Simple Trainer gets a calculated 1.3° down-thrust. The Bronco, Apprentice and Explorer no longer loop on hands-off full throttle. Simulation compatibility advances to 0.9.2; the JSBSim adapter mirrors both terms (92 cases, 1012 checks pass).

- Detailed models for the six generated aircraft: smooth superellipse fuselages, tapered/elliptical/swept planforms with cambered sections, painted canvas liveries (RAF roundels, camouflage, stripes, tips), canopy, spinner, tyres and hinge-accurate control surfaces. A new visual-only `visual` block drives them; physics is unchanged, and the original plan models are untouched.

- Add six catalog aircraft generated from published specifications: FT Simple Cub, FT Explorer, FT Spitfire, FT Mighty Mini Arrow, E-flite Night Radian 2.0 m and Apprentice STS 1.5 m. Thrust/current tables come from a DC motor model calibrated against published bench points; down-thrust is solved with the builder's power test. Add an optional aircraft `livery` for the generic renderer.

- Replace the propeller-slipstream estimate with an actuator-disk model (correct span coverage, slipstream development and contraction, no tuned decay). Add optional motor `downThrustDeg` and `rightThrustDeg`. Simulation compatibility advances to 0.9.1 and rejects 0.9.0 replays; aircraft files remain compatible.

- Fixed-wing launch trim now solves airspeed in the mean wind. Crosswind starts drift with the air instead of beginning in a sideslip, and placed launches turn only the air-relative velocity.
- Add documentation charts for ground effect, the wind gradient and Dryden turbulence. They are computed from the simulator's own functions and checked by `docs:check`.
- Manisa: windows, furrowed ploughed land and a dashed main-road centre line.

- Add the **Manisa** flying site: a procedural model of the 10/28 concrete runway, hangar, clubhouse and red-roofed buildings of Manisa Havacılık Sporları Tesisi, laid out from measured aerial screenshots. Runway layout, heading reference and site details are now per-site; the existing three fields are unchanged.

- Add near-ground physics: McCormick wing ground effect, Cheeseman–Bennett multirotor ground effect, an optional logarithmic wind gradient and optional seeded MIL-F-8785C Dryden turbulence. Simulation compatibility advances to 0.9.0 and rejects 0.8.1 replays; aircraft files remain compatible.

- Add bounded crash breakup using the aircraft's own geometry, with reset restoring the intact model.
- Add recorded scenery collisions for trees, buildings, rocks, tables, cones and fences; simulation compatibility advances to 0.8.1 and rejects older replays. Aircraft files remain compatible.
- Restore a compact photographic sky across all three maps, improve canopy cutouts/shadows and reduce oversized ground colour patches.
- Add optional, smoothly bounded pilot-camera focus at distance without changing aircraft scale, chase or FPV.

- Make documentation diagrams, enlarged views and SVG downloads follow the chosen light/dark theme.
- Add shared light/dark appearance across the simulator and documentation, with a two-row navigation layout on small screens.
- Replace the balance illustration with a conventional Tiny Trainer view and an interactive battery/CG demonstration; retain a downloadable static diagram and frozen documentation snapshots.
- Correct VTOL motor supports, pivot/servo alignment and wiring. The revised preset includes its support-plate mass (1,323 g assembled), updated trim and documented flight-envelope limits; legacy component orientations retain their previous convention.
- Add the Bronco tricopter VTOL with two front conversion servos and a separate rear yaw-tilt servo, component-derived mass/CG, battery-limited thrust, configurable hover/cruise assistance and deterministic transition experiments.
- Add VTOL keyboard/gamepad shortcuts, explicit CH5 Hover/Cruise binding, mechanical control-test animation and ArduPilot-referenced setup documentation; CH6 remains the Arduino RUN guard.
- Add cancelable 3D component placement with live CG feedback, a hover-load check, component icons and richer radio/aircraft diagrams.

- Add illustrated radio wiring, keyboard/gamepad/transmitter guides, zoomable diagrams and a locally configured, copyable AI-agent connection prompt.

- Add same-site documentation at `/docs/`, with local search, readable source guides, version-aware downloads and explicit immutable release snapshots.
- Add a checksum-verified local plan library with original designer credits; upstream PDFs stay out of public builds.
- Consolidate launch and contribution guides, archive historical review logs, and extract the bundled-aircraft registry from the browser entry point.

- Correct the Bronco’s high-wing seating and add a separate conventional H-tail preset alongside the V-tail, with configuration-specific components and controls.
- Remove the generic trainer from the bundled catalog. **Simple Trainer** now refers only to the Vortex RC design (`vt-simple-trainer`). Older exported generic builds still import normally.
- Add discreet original-creator links to the editor and flight setup. Existing local physical edits are preserved; Restore original aircraft adopts the revised geometry.

- Add local aircraft history: named snapshots, automatic versions on apply, component-level comparison, safe restore into a draft, and portable history backups.
- Enlarge navigation icons and add a GitHub link and application-version dialog. Configure the intended canonical address.
- Document the first-contribution workflow, release process, static hosting and transfer of aircraft between browser origins.
- Add FPV camera components with an interactive mount editor, surface picking and live lens preview.
- Add configurable control response rates and surface mixers, with live control tests in the aircraft editor.
- Add the Vortex RC Simple Trainer with documented source dimensions and estimated component/aerodynamic assumptions.

**Compatibility:** aircraft definitions remain format 1. Optional `credit` metadata is accepted by the current reader; older strict readers may reject new files containing it. VTOL adds `vehicleType: "vtol"` and a validated optional `vtol` block; older strict readers reject those definitions. Physics/recording compatibility advances to **0.8.0** for VTOL state and command replay. Recordings from another simulation version are rejected; use the original engine or make a new recording. Local history begins at format 1 and does not change the shared aircraft JSON format. Presets remain engineering approximations, not flight-test-calibrated aircraft.
