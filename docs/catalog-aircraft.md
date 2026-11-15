# Generated catalog aircraft

Six presets are built by `scripts/generate-catalog-aircraft.ts` from published
specifications instead of traced plans. Each one is an engineering estimate
with its sources recorded in its JSON `provenance`. None is flight calibrated.

| Aircraft             | Type                                        | Span    | Mass   | Power system (3S)                 |
| -------------------- | ------------------------------------------- | ------- | ------ | --------------------------------- |
| FT Simple Cub        | High-wing taildragger; rudder and elevator  | 956 mm  | 388 g  | Power Pack B: 2212 1050 KV, 9×4.5 |
| FT Explorer          | Pod-and-boom; ailerons, rudder and elevator | 1447 mm | 595 g  | Power Pack B: 2212 1050 KV, 9×4.5 |
| FT Spitfire          | Low-wing warbird taildragger; four channels | 1080 mm | 607 g  | Power Pack C: 2218 1180 KV, 9×4.7 |
| FT Mighty Mini Arrow | Swept flying wing; pusher motor, elevons    | 736 mm  | 245 g  | 2205 2300 KV, 6×4.5               |
| Night Radian 2.0 m   | Powered sailplane; rudder and elevator      | 2000 mm | 1200 g | 3533 960 KV, 9.75×7.5 folding     |
| Apprentice STS 1.5 m | Tricycle trainer; four channels             | 1500 mm | 1390 g | BL15 840 KV, 11×8                 |

Flite Test designs credit Flite Test; the Apprentice STS and Night Radian credit
E-flite / Horizon Hobby. Their stabilization systems (AS3X, SAFE) are not
simulated.

## What comes from sources

Span, wing area where listed, length, mass, the CG station where listed, the
motor, propeller and battery choice, and the control layout. Each source URL is in
the aircraft's `provenance` (`publishedDimensions`, `powerPack` or
`equipment`). Where a listing gives a dry mass, a typical battery mass for the
recommended pack is added.

## What is calculated

- **Mass ledger and balance.** Motor, ESC, servos, receiver and battery have
  typical masses for the listed parts. Structure fills the remaining published
  mass by fixed fractions. The battery station is solved to reach the CG: the
  listed CG when one is published, otherwise a stated fraction of the mean chord.
- **Tail size.** The horizontal and vertical tail areas come from volume
  coefficients typical for the aircraft class, at an estimated tail arm.
- **Wing.** Rectangular-equivalent panels use the mean chord. The lift slope is
  `2π/(1 + 2/(e·AR))`, with estimated efficiency, zero-lift angle, stall angle,
  CD0 and CM. Polyhedral (Night Radian) and sweep (Arrow) are represented by
  panel roll and aerodynamic-centre placement.
- **Power.** A first-order DC motor model (KV, effective series resistance,
  no-load current) drives the propeller with static coefficients typical of
  UIUC measurements. Motor torque is matched to propeller torque at each
  throttle duty to give the thrust and current table. The zero-thrust speed is
  the pitch speed at full rpm.
- **Thrust line.** The motor sits at the CG height. Its down-thrust is solved so
  that full power leaves the pitching moment unchanged at the trim speed, which is
  how builders set motor angles. The result is 1.5–4.1° for the tractor models
  and 0° for the pusher Arrow. These are not the kits' published angles.

### Motor-model calibration

The effective resistance per motor size was chosen so that comparable published
bench points fall within ±25 %. The generator stops with an error if they drift:

| Comparable motor / prop               | Published        | Model                 |
| ------------------------------------- | ---------------- | --------------------- |
| 2826 1000 KV, 9×4.7, 3S               | 632 g, 10.2 A    | +17 % thrust, +13 % A |
| EMAX GT2218 1100 KV, 10×4.7, 3S       | 1290 g, 24 A     | −6 % thrust, −8 % A   |
| E-flite Power 15 950 KV, 11×7, 10.4 V | 8200 rpm, 27.8 A | −4 % rpm, +8 % A      |

These are similar motors, not the exact installed ones. Treat each preset's
thrust as accurate to roughly a quarter.

## How they fly

At their trim throttle all six are statically stable. They also damp a pitch
disturbance back to level flight; the Night Radian's glide oscillation decays
slowly, as expected from a low-drag sailplane.

Their listed power systems give a static thrust-to-weight ratio between 1.05
(Night Radian) and about 3.5 (Mighty Mini Arrow). Full throttle with the elevator
left at cruise trim therefore climbs steeply and, held long enough, carries each
of them over the top. The down-thrust removes the power-induced pitching moment
but not the excess thrust. Manage throttle and pitch together, as with the real
aircraft. See
[full throttle with the trim held](component-models.md#full-throttle-with-the-trim-held).

## Regenerate or change one

1. Edit its specification in `scripts/generate-catalog-aircraft.ts`.
2. Regenerate the files, then format them:

```sh
npx tsx scripts/generate-catalog-aircraft.ts
npm run format
```

3. Check the result:

```sh
npm run aircraft:validate -- aircraft/ft-simple-cub.json
npm run physics:validate -- aircraft/ft-simple-cub.json
npm run physics:envelope -- aircraft/ft-simple-cub.json
npm test
```

Measured mass, CG, thrust or control throws should replace the estimates in the
specification and be recorded as `sourced` or `calibrated` in the provenance.
