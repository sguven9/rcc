# Changelog

Application releases are separate from physics/replay and aircraft format versions. See [versioning](docs/versioning.md). Unreleased entries describe the current development branch, not a published deployment.

## 0.8.0 — Unreleased

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
- Enlarge navigation icons and add a GitHub link and application-version dialog. Configure the intended canonical address, `rcforge.adithyask.com`.
- Document the first-contribution workflow, release process, static hosting and transfer of aircraft between browser origins.
- Add FPV camera components with an interactive mount editor, surface picking and live lens preview.
- Add configurable control response rates and surface mixers, with live control tests in the aircraft editor.
- Add the Vortex RC Simple Trainer with documented source dimensions and estimated component/aerodynamic assumptions.

**Compatibility:** aircraft definitions remain format 1. Optional `credit` metadata is accepted by the current reader; older strict readers may reject new files containing it. VTOL adds `vehicleType: "vtol"` and a validated optional `vtol` block; older strict readers reject those definitions. Physics/recording compatibility advances to **0.8.0** for VTOL state and command replay. Recordings from another simulation version are rejected; use the original engine or make a new recording. Local history begins at format 1 and does not change the shared aircraft JSON format. Presets remain engineering approximations, not flight-test-calibrated aircraft.
