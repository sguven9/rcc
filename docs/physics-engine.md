# Physics engine: audit, fixes and verification

This page records a full audit of the flight engine against a general
physics-engine checklist: frame-rate dependence, tunnelling, NaN, energy
behaviour, resting contacts, units and penetration. It lists each defect with
its cause, the fix and the test that covers it. All constants live in
`src/core/physics-config.ts`.

RCForge simulates one rigid aircraft (6 degrees of freedom) with wheel, skid
and airframe contacts on a flat field, plus scenery obstacles. Checklist items
written for many interacting bodies are adapted: stacking, sleeping piles and
"1000 bodies" become resting-contact and 1000-flight stress tests. See
[Adaptations](#adaptations-and-assumptions).

## Architecture

| Topic       | Implementation                                                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Units       | SI throughout: m, kg, s, N, rad. Fields ending in `Deg` are degrees and are converted once. Scene coordinates are converted only in the renderer (`toWorld`).                                                            |
| Time step   | Fixed `dt = 1/120 s`. `FlightClock` accumulates browser time into whole steps and pauses flight after a long stall instead of a catch-up burst. `Simulation.step` rejects `dt ≤ 0`, non-finite or `> 1/30 s`.            |
| Integration | Explicit midpoint (RK2) for translation and rotation, including the gyroscopic `ω × Iω` term. Quaternions use an exponential update and are renormalised. Second order: halving `dt` cuts the error about four times.    |
| Forces      | Recomputed from scratch at each stage (`Simulation.forces`), never accumulated across steps. They include gravity, surface lift, drag and moment, propeller thrust and slipstream, body drag, damping and ground effect. |
| Contacts    | Sequential impulses on flat ground, with Coulomb friction, position projection and a resting snap.                                                                                                                       |
| Obstacles   | Swept (continuous) collision of every installed part's envelope against boxes and ellipsoids, so a fast aircraft cannot skip a thin wall.                                                                                |

## Defects found and fixed

| #   | Defect                                                                                                                                                                     | Cause                                                                                                                                     | Fix                                                                                                                                                                                                 | Test                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1   | **Creep under static friction.** A force at 60 % of break-away (wind, idle thrust) slid a stopped aircraft about 1.2 cm/s.                                                 | The midpoint position update used the pre-contact velocity. Impulses then zeroed the velocity but not the displacement, ½·a·dt² per step. | Half of each contact's velocity change is also applied to position and attitude for that step. Creep falls from 1·10⁻⁴ to 4·10⁻⁹ m per step.                                                        | `physics-verification` §3: holds below μ_s·N              |
| 2   | **Residual velocity at rest.** A parked aircraft reported a constant 6 mm/s upward velocity.                                                                               | Baumgarte bias injected penetration recovery as velocity, then position projection cancelled the motion.                                  | Split impulse: the velocity solve has no bias. Penetration beyond a 0.5 mm slop is removed by position projection (80 %/step). An unpowered aircraft below 2 mm/s and 0.002 rad/s is snapped still. | `physics-verification`: parked aircraft keeps `[0, 0, 0]` |
| 3   | **Actuators made the integrator first order.** With servo/motor dynamics, halving `dt` only halved the error. A 3 s manoeuvre differed by 63 mm from the converged answer. | Servo and motor states were advanced first, then used in both RK2 stages, so the model read them half a step early.                       | Stage k1 uses the start-of-step actuator state and k2 the midpoint average. The error falls to 7.6 mm, with a ratio of 3.9–4.1 per halving.                                                         | `physics-verification` §6                                 |
| 4   | **Possible drag reversal.** The schema allows a very light body with 2 m² drag area. Explicit drag could then reverse velocity in one step.                                | Explicit force with no bound.                                                                                                             | Body drag may remove at most 90 % of the matching air-relative velocity component per step. Normal aircraft never reach the bound.                                                                  | `physics-verification` §2: monotonic, never reverses      |
| 5   | **One sliding coefficient** for every contact, with no static/kinetic distinction. A plastic skid gripped like a tyre.                                                     | Single μ table per surface.                                                                                                               | μ = √(μ_contact·μ_surface); μ_k = 0.8·μ_s above 0.05 m/s slip. The tyre values reproduce the earlier coefficients.                                                                                  | `physics-verification` §3                                 |

No NaN, tunnelling, energy gain or unit mix-up was found. The checks for them
are now permanent tests:

- **NaN.** `unit(0)` returns a zero vector rather than NaN. A step with any
  non-finite state throws instead of propagating. 1000 randomized extreme flights
  (all aircraft, any attitude, ±30 m/s, ±20 rad/s, Dryden wind) stay finite.
- **Tunnelling.** The ground is a half-space, so it cannot be skipped. A 59 m/s
  vertical dive is caught as a crash at contact height. Obstacles use swept tests.
- **Energy.** A torque-free tumbling, drag-free ballistic body drifts by
  6·10⁻⁶ % over 4 s.

## Forces and formulas

- **Gravity:** `F = m·g`, g = 9.80665 m/s² (standard gravity).
- **Air density:** the field density comes from temperature and elevation. In
  the browser it decreases with height above the field, `ρ(h) = ρ_field·e^(−h/8500 m)`
  (`Environment.densityScaleHeightM`). Headless runs keep uniform density
  unless they set it.
- **Body drag (quadratic, per body axis):**
  `F_i = −½·ρ·(C_d·A)_i·|v_rel,i|·v_rel,i` with `v_rel = v − v_wind`, plus the
  stability bound above. Lifting surfaces use their own lift/drag polars,
  [stall model](component-models.md#stall-break-and-tail-downwash-092) and
  [slipstream](component-models.md#propeller-slipstream-and-thrust-line-091).
  Terminal velocity `v_t = √(2mg/(ρ·C_d·A))` is verified to 1 %.
- **Wind:** the mean wind `W·(cos θ, sin θ)` is set from speed and a 15°-step
  direction relative to the runway. Options add the near-ground logarithmic
  gradient, deterministic sinusoidal gusts, and seeded MIL-F-8785C Dryden
  turbulence with an intensity multiplier of 0–2×. The minimap arrow shows the
  live wind at the aircraft. See [turbulence and ground effect](atmosphere-and-ground-effect.md).
- **Friction:** Coulomb cone `|j_t| ≤ μ·j_n` on accumulated impulses, so friction
  stops relative motion but never reverses it. Static μ_s applies below the slip
  speed and kinetic μ_k above. Free-rolling tyres have rolling resistance
  `C_rr·N` (asphalt 0.025, grass 0.09, dirt 0.055).
- **Rotation damping:** surfaces produce aerodynamic damping through `ω × r`.
  A small empirical `τ = −c·ω·(1 + 0.1·V)` remains.
- **Collisions:** wheel and skid normal impulses are inelastic (e = 0), which
  removes bounce jitter. A hard sink (> 4 m/s on wheels, > 2.2 m/s on the airframe)
  or an airframe contact above 3 m/s ends the flight as a crash. A gentle
  upright airframe contact is a landing.

## Verification tests

`tests/physics-verification.test.ts` (12 tests) runs in `npm test`:

| Check                                       | Requirement                                        | Result               |
| ------------------------------------------- | -------------------------------------------------- | -------------------- |
| 1. Free fall in vacuum                      | `y = ½·g·t²` within 0.1 %                          | Pass (exact for RK2) |
| 2. Terminal velocity                        | within 1 % of `√(2mg/(ρ·C_d·A))`                   | Pass                 |
| 2b. Light draggy body                       | velocity never reverses                            | Pass                 |
| 3. Kinetic slide                            | stop distance `v₀²/(2μ_k·g)` ±3 %                  | Pass                 |
| 3b. Static hold and break-away              | still at 0.6·μ_s·N; `a = F/m − μ_k·g` at 1.4·μ_s·N | Pass                 |
| 4. Horizontal wind                          | matches `W − 1/(1/W + k·t)` ±1 %                   | Pass                 |
| 5. Energy, drag- and friction-free tumbling | drift < 1 % over 10 s                              | Pass                 |
| 6. Timestep convergence with actuators      | error ratio 3–5.5 per halving                      | Pass (≈4)            |
| 7. 1000 randomized flights + thin wall      | finite, no ground/wall tunnelling                  | Pass                 |
| Parked aircraft                             | zero velocity, < 0.1 mm drift                      | Pass                 |
| Density lapse                               | `ρ_field·e^(−h/H)`                                 | Pass                 |

The [JSBSim comparison](physics-reference.md) still passes 92 cases and 1012
checks with these changes.

## Debug overlay

Tick **Flight setup → Field → Physics debug** or press <kbd>G</kbd> in flight:

- **Arrows at the CG:** ground velocity (white) and wind (cyan) use 0.06 m per
  m/s. Thrust (orange), wing-and-tail aerodynamics (green), body drag (red) and
  weight (purple) are scaled so weight is half the wingspan. Yellow arrows show
  each surface's load.
- **Energy graph:** kinetic, potential and total mechanical energy (J) over the
  last 20 s. With power off in calm air, the total falls only through drag.
- **Minimap wind arrow:** the live wind speed and direction at the aircraft.

## Adaptations and assumptions

- **Inclined plane.** The field is flat. The friction law is verified with the
  equivalent horizontal force: `a = (F − μ_k·N)/m`, and no motion while
  `F < μ_s·N`. This is the same Coulomb relation as `a = g(sin α − μ_k·cos α)`.
- **Bouncing energy.** Wheels are inelastic by design, and an airframe impact ends
  the flight, so energy conservation is verified on drag-free tumbling and
  ballistic flight instead of an elastic bounce.
- **Stacks, sleep and 1000 bodies.** There is a single rigid body. Resting stability
  is tested on the parked aircraft. The resting snap is the sleep equivalent:
  any thrust or a velocity above the threshold wakes it. Stress uses 1000
  randomized flights.
- **Magnus effect.** There is no spinning sphere. Propeller gyroscopic precession
  and P-factor, the aircraft analogues, are not modeled yet.
- **Wind profile.** The near-ground profile is logarithmic (neutral boundary
  layer) rather than the power law `(h/h_ref)^α`. Both describe the same
  gradient, and the logarithmic form is standard below about 100 m.
