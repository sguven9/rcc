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

`tests/physics-verification.test.ts` (12 tests) and
`tests/propeller-gust.test.ts` (34 tests, second table)
run in `npm test`:

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

Propeller and gust checks (`tests/propeller-gust.test.ts`):

| Check                                               | Requirement                                               | Result |
| --------------------------------------------------- | --------------------------------------------------------- | ------ |
| 1. Zero rpm                                         | M_gyro and M_p exactly 0                                  | Pass   |
| 2. Gyroscopic moment, tilted axis and in-sim        | hand-computed −ω×H within 1 %                             | Pass   |
| 3. Precession sign                                  | CW + pitch-up → yaw right; yaw right → pitch down         | Pass   |
| 4. P-factor                                         | 0 at α_p = 0; one-way growth; \|Δ\| = k_p·sin α_p·R       | Pass   |
| Reaction torque                                     | M_x = −T·`torquePerThrustM` for CW                        | Pass   |
| 5. Slipstream                                       | v_i = √(T/(2ρA_p)) at V = 0; T ≤ 0 and NaN safe           | Pass   |
| 6. Gust profile and seeding                         | 0 at ends, W_g mid; same seed → same series; Poisson rate | Pass   |
| 7. dt convergence with propeller effects and a gust | error ratio 3–5.5                                         | Pass   |
| 8. No parameters                                    | identical to explicit zeros; 0.10.0 recordings replay     | Pass   |
| 9. 1000 randomized flights with 8 m/s gusts         | finite, no tunnelling, speed < 150 m/s, rate < 100 rad/s  | Pass   |

The [JSBSim comparison](physics-reference.md) passes 92 cases and 1012 checks.
Before the presets gained propeller parameters, every metric was bit-identical
to 0.10.0. The adapter now mirrors the gyroscopic and P-factor moments, and its
propulsion cases add body rates. With the mirror removed, nine propulsion cases
fail by 0.05–0.56 N·m against a 1·10⁻⁸ N·m limit, so the comparison exercises
the new terms. `npm run physics:validate` passes unchanged.

## Debug overlay

Tick **Flight setup → Field → Physics debug** or press <kbd>G</kbd> in flight:

- **Arrows at the CG:** ground velocity (white) and wind (cyan) use 0.06 m per
  m/s. Thrust (orange), wing-and-tail aerodynamics (green), body drag (red) and
  weight (purple) are scaled so weight is half the wingspan. Yellow arrows show
  each surface's load.
- **Energy graph:** kinetic, potential and total mechanical energy (J) over the
  last 20 s. With power off in calm air, the total falls only through drag.
- **Minimap wind arrow:** the live wind speed and direction at the aircraft.

## Propeller side effects (0.11.0)

All four effects live in `src/core/propeller-effects.ts` and
`src/core/propwash.ts`. They are evaluated per motor at each RK2 stage and
summed. `Forces.propellerGyro` and `Forces.pFactor` report the totals.

**Spin convention.** This is unchanged from the reaction torque. A fixed-wing
`"cw"` propeller turns clockwise seen from the cockpit, so its angular velocity
direction ŝ is along the thrust axis ê. A multirotor or VTOL `"cw"` rotor turns
clockwise seen from above, so ŝ = −ê. The tilted thrust line from
`downThrustDeg`/`rightThrustDeg` is used for ê.

| Effect            | Formula                                                                           | Inputs (motor fields, units)                                                       |
| ----------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Gyroscopic moment | H = I_p·Ω·ŝ, M_gyro = −ω × H                                                      | `propInertiaKgM2` I_p (kg·m²); `maxRpm` (rev/min); Ω = maxRpm·2π/60·(n/n_max)      |
| P-factor          | Δ = k_p·R·(v_⊥ × ŝ)/max(\|v_p\|, v_fade), so \|Δ\| = k_p·R·sin α_p; M_p = Δ × T·ê | `pFactor` k_p (–, 0–0.5); R = `propDiameterM`/2 (m); T after the speed falloff (N) |
| Reaction torque   | M = −Q·ŝ with Q = T·`torquePerThrustM` (existing, about body X for fixed-wing)    | `torquePerThrustM` (m)                                                             |
| Slipstream        | v_i = −V/2 + √((V/2)² + T/(2ρA_p)), over the wing root and tail (existing)        | `propDiameterM`, thrust                                                            |

- **Gyroscopic.** n/n_max is the powertrain's shaft-speed ratio, the same
  value that drives thrust unloading. A CW propeller yaws the nose right in a
  pitch-up and pitches it down in a right yaw. Counter-rotating rotors at equal
  speed cancel.
- **P-factor.** v_p = v + ω × r is the propeller's velocity relative to the
  air, and v_⊥ is its part in the disk plane. The blade whose tangential
  velocity adds to v_⊥ carries more thrust, so for a CW propeller at positive
  α the thrust centre moves right and the nose yaws left. v_fade = max(3 m/s,
  0.1·Ω·R). Above it this is exactly the k_p·sin α_p·R law. Below it, at taxi
  and launch speed or at rest, the shift grows with the in-plane advance ratio
  v_⊥/(Ω·R), as blade-element theory gives. It is never singular, and it is
  exactly zero at zero thrust or zero cross-flow. Negative (braking) thrust
  gives no P-factor.
- **Reaction torque** was already present and is only verified. A CW
  fixed-wing propeller rolls the aircraft left by exactly T·`torquePerThrustM`.
  No preset declared `spin` before 0.11.0, so the reaction torque had never
  acted on a fixed-wing preset.
- **Slipstream** was already present. `diskInducedVelocity` returns
  √(T/(2ρA_p)) at V = 0 and 0 for T ≤ 0 or non-finite input. With power at
  zero airspeed, the elevator produces a pitching moment, which tests check.

**Presets.** The single-motor presets ef-apprentice-sts, ef-night-radian,
ft-22-raptor, ft-explorer, ft-mighty-mini-arrow, ft-simple-cub, ft-spitfire,
ft-tiny-trainer and vt-simple-trainer now declare `spin: "cw"`, k_p = 0.3 and:

- I_p = m_prop·D²/16, from their propeller part mass (a two-blade estimate);
- `maxRpm` from the zero-thrust speed and propeller pitch, cross-checked against
  KV × 11.1 V × 0.75.

These are engineering estimates, not measurements. Twins, quads and the
tiltrotor keep no propeller parameters.

**Trim.** A real model needs aileron or rudder trim against propeller torque.
`findTrim` now solves those offsets so that roll and yaw moments are zero in
wings-level flight. A rudder-only model has no aileron, so it is trimmed with
rudder plus a small sideslip, which its dihedral turns into a rolling moment.
Symmetric aircraft keep exactly zero lateral trim. The browser applies the
solved trims like the elevator trim. With power added hands-off, a trimmed
CW-propeller model first yaws slightly right while it pitches up (gyroscopic),
then turns gently left (torque and P-factor). This is the familiar "right
rudder with power".

## Dynamic shaft speed (0.12.0)

`src/core/rotor-dynamics.ts` makes each propeller's shaft speed Ω (rad/s) a
state, for motors that declare `motorPowerW` together with `spin`,
`propInertiaKgM2` and `maxRpm`. Other motors keep the quasi-static rpm law and
give bit-identical results to 0.11.0.

    I_tot·dΩ/dt = Q_motor(c, Ω) − Q_prop(Ω, V, ρ) − Q_friction(Ω)

| Term       | Model                                                                                                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I_tot      | `propInertiaKgM2` + `motorInertiaKgM2` (kg·m²)                                                                                                                                               |
| Q_motor    | P(c)·η(ρ)/max(Ω, 0.05·Ω_max), faded to zero over the last 3 % below redline. η = 1 for `engine: "electric"` (default), ρ/ρ_ref for `"piston"`                                                |
| P(c)       | The shaft power that holds the existing quasi-static rpm Ω_c of the command at rest: (A_q·ρ_ref·Ω_c² + Q_f(Ω_c))·Ω_c. The bench static thrust curve is therefore reproduced exactly          |
| Q_prop     | C_q(J)·ρ·n²·D⁵ with C_q = C_q0·(1 − J/J_max), J_max = 1.2·J0: Q = A_q·ρ·Ω·(g·Ω − Ω_max·V/(1.2·V0)). Negative when windmilling                                                                |
| A_q (C_q0) | Calibrated from `motorPowerW` = (A_q·ρ_ref·Ω_max² + Q_f(Ω_max))·Ω_max                                                                                                                        |
| Q_friction | c0·Ω/(Ω + 0.02·Ω_max) + c1·Ω, with c0 = 1 % and c1 = 2 % of the rated power (no sign jump at Ω = 0)                                                                                          |
| Thrust     | C_t(J)·ρ·n²·D⁴ with C_t = C_t0·(1 − J/J0). This is exactly the existing law T_max·ρ/ρ_ref·r²·(1 − V/(V0·r)) with r = Ω/Ω_max, so thrust is still computed in one place                       |
| Redline    | `redlineRpm`, default 1.3 × `maxRpm`. Ω stays within [0, redline] every step                                                                                                                 |
| Governor   | `propGovernor: true` (fixed-wing only): pitch factor g = g_i + 1.5·e, g_i' = 6·e, e = (Ω − Ω_max)/Ω_max, g ∈ [0.4, 1.8]. g scales C_t0, C_q0, J0 and J_max: a crude stand-in for a pitch map |

**Airframe torque.** The shaft pushes back on the airframe with
−(Q_motor − Q_friction)·ŝ. This equals the propeller load plus the spin-up
torque I_tot·dΩ/dt, so `torquePerThrustM` is not added on top. The gyroscopic
moment uses H = I_tot·Ω(t)·ŝ: the motor's rotating bell spins with the
propeller. Airframe plus rotor angular momentum is conserved within 1 % in
vacuum (test 6).

**Integration.** Ω is integrated inside the existing midpoint step, so every
stage reads Ω at its own time:

- k1 uses Ω_n.
- The midpoint takes a linearly implicit half step,
  Ω_mid = Ω_n + (dt/2)·f₁/(1 − (dt/2)·J₁), with J = ∂Ω̇/∂Ω (analytical).
- k2 uses Ω_mid.
- The update is the linearly implicit midpoint rule,
  Δ = dt·[f₂ + J₂(Ω_n − Ω_mid)]/(1 − dt·J₂/2).

This is second order and A-stable, so a very light propeller cannot blow up.
When dt·|J| > 2 (faster than the step resolves) the L-stable form is used.
Positive slopes are treated explicitly. The governor integral uses the
explicit midpoint. At construction, a state without Ω starts at the steady
speed, so a trimmed launch is in rotor equilibrium.

**Swirl.** Dynamic-rotor motors give their slipstream a swirl,
ω_s = 0.5·Q_prop/(ρ·A_p·(V + v_i)·r_eff²) with r_eff = 0.7·R. A tail surface off
the propeller axis meets the tangential flow u = ω_s·ŝ × r_⊥. It is weighted by
the slipstream coverage and capped at 30 % of V + v_i. For a CW propeller the
fin above the axis is pushed right, which yaws the nose left. On the
presets this is about 1–2.5° at the fin, and 7–20 % rudder cancels it
at take-off power. `PHYSICS.swirl.enabled` turns it off.

**Presets.** The nine single-motor presets with propeller parameters gain
the following values, all **estimates**, not measurements:

- `motorPowerW` = 0.75 × full-command current × reference voltage;
- `motorInertiaKgM2` ≈ 0.35·m_motor·r_motor², for the outrunner bell;
- `redlineRpm` = 1.3 × `maxRpm`;
- `engine: "electric"`.

The implied C_t0 ≈ 0.11–0.12 and C_p ≈ 0.05 match typical 9×4.5-class
propellers. The FT-22 Raptor (C_t 0.044) and Simple Trainer (0.067) come out
low because their 0.11.0 `maxRpm` estimates are high. Those were kept so
0.11.0 behaviour stays traceable. Spin-up from rest takes about 0.2 s. In
cruise the shaft runs at 55–70 % of `maxRpm`, rises in a dive and falls in a
climb.

**Corrections to the requested formulas.**

- **Swirl mass flow.** The requested ω_s ≈ Q/(ρ·A_p·v_i·r²) uses v_i where the
  angular-momentum flux needs the mass flow ρ·A_p·(V + v_i). In cruise v_i is
  small, so the requested form overestimated swirl about eight times: 17° at
  the fin, which drove the trim to its limits.
- **Swirl on wings.** Swirl is applied to tail surfaces only. Over a wing root
  it is up on one side and down on the other, and a single centre-point
  velocity turned that into a false 0.14 N·m roll on polyhedral wings.
- **C_q floor.** The requested C_q ≥ 0 clamp would make windmilling
  impossible: with no drive, friction would stop the propeller. The linear law
  is kept. It stays bounded because Q ∝ Ω·(gΩ − Ω_V).
- **Rotor inertia.** H and the spin-up torque use I_tot, not I_p, because the
  motor's rotor turns too.

**Trim.** Sideslip trims now also bank the wings so that the lift balances the
side force, which makes trimmed flight straight as well as moment-free.

## Discrete gusts (0.11.0)

`src/core/discrete-gust.ts` adds gusts on top of the mean wind and Dryden
turbulence:

- **Profile:** `w(τ) = (W_g/2)·(1 − cos(2π·τ/t_g))` for 0 ≤ τ ≤ t_g.
- **Onsets:** a Poisson process with mean interval `meanIntervalS`, using
  exponential waiting times from a seeded mulberry32 stream separate from
  Dryden. Overlapping gusts add up, at most 4 at once.
- **Peak** `amplitudeMps` (m/s) is set by the user.
- **Length** t_g is drawn uniformly from 1–3 s.
- **Direction:** uniform azimuth, elevation within ±20°.

The gust is evaluated at each integrator stage time, so the scheme stays second
order. A run with the same seed, timestep and control frames is identical.

**Profile correction.** The requested profile (W_g/2)(1 − cos(π·t/t_g))
reaches W_g at t_g and does not return to zero, which contradicts the
requirement that the gust be zero at both ends and peak in the middle. The
full-wave form with 2π satisfies that requirement and is the certification
"1−cos" discrete gust.

**UI.** The Field panel gains:

- a discrete-gust rate slider, 0–6 per minute (0 is off);
- a gust peak slider, 0.5–8 m/s;
- **Trigger a gust now** (key <kbd>U</kbd>).

A manual trigger is recorded as `gust: true` in that step's control frame, so
replay reproduces it. The minimap wind arrow includes the gust, turns orange
and reads "gust" while one blows.

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
- **Magnus effect.** There is no spinning sphere. The aircraft analogues,
  propeller gyroscopic precession and P-factor, are modeled from 0.11.0.
- **Propeller limits.** Since 0.12.0, dynamic-rotor motors model the spin-up
  torque, slipstream swirl and shaft speed changes in flight. The following
  are still not modeled:
  - a real propeller pitch map (linear C_t(J), C_q(J));
  - torsional vibration;
  - motor electrical dynamics: battery current still follows the command
    curve, and P(c) scales with the voltage ratio through Ω_c;
  - tiltrotor VTOL shaft dynamics (rejected by the schema);
  - gust gradients along the airframe.

  `responseSeconds` now acts as the ESC command smoothing in front of the
  inertial spin-up.

  The reaction torque stays about body X for fixed-wing aircraft, as before.
  k_p and I_p are estimates.

- **Wind profile.** The near-ground profile is logarithmic (neutral boundary
  layer) rather than the power law `(h/h_ref)^α`. Both describe the same
  gradient, and the logarithmic form is standard below about 100 m.
