# Manisa flying site

The Manisa site is a procedural model of the concrete runway, hangar and club
buildings of Manisa Havacılık Sporları Tesisi in western Turkey. Its layout was
measured from aerial screenshots supplied by a contributor. No aerial imagery,
photograph or map tile is copied into RCForge.

## Fly it

1. Open **Flight setup → Field** and choose **Manisa · concrete**.
2. Pick a launch mode. A ground start sits where the taxiway joins the runway
   and takes off towards runway 10 (true heading 103°). The runway extends 199 m
   ahead of you and about 200 m behind.
3. The pilot stands on the north side, between the runway and the buildings.

The minimap and position map stay runway-aligned. Their corner label reads
**↑ 103°** rather than **↑ N**, and the heading readout shows true heading. The
**North** and **East** placement fields are local runway axes on this site:
North means along runway 10, and East means 90° to its right (true 193°).

## How the layout was measured

| Quantity                  | Value                          | Source                                                  |
| ------------------------- | ------------------------------ | ------------------------------------------------------- |
| Reference point           | 38.7017° N, 27.4546° E, ≈ 24 m | Screenshot status bar and elevation profile             |
| Image scale               | ≈ 0.357 m per screen pixel     | Two on-screen distance measurements (21.5 m, 29.3 m)    |
| Screen rotation           | ≈ 16° from north               | Measured bearings (62.7°, 15.9°) against pixel angles   |
| Runway bearing            | 103° / 283° (10/28)            | Concrete edge detection along the strip                 |
| Runway width              | ≈ 16 m                         | Edge detection, perpendicular to the strip              |
| Taxiway to access road    | ≈ 29–32 m, 7 m wide            | On-screen measurement and edge detection                |
| Hangar                    | ≈ 28 × 24 m                    | Roof outline; height estimated (6 m walls, 2.4 m arch)  |
| Clubhouse                 | ≈ 17 × 16 m                    | Roof outline; height estimated                          |
| Red-roofed buildings      | ≈ 22 × 13 m and 15 × 18 m      | Roof outlines inside the fenced concrete compound       |
| Access road and main road | 6 m and 7 m wide               | On-screen measurement (7.9 m including verge) and image |

Local coordinates have their origin where the taxiway centre line meets the runway
centre line. Buildings, roads and fences are placed from the measured pixel
positions with this transform. Their footprints are approximate to a few metres.

## Assumptions to check

- **Runway length.** The east end is visible 199 m from the taxiway. The west end
  is outside every supplied screenshot, so the model assumes a 400 m runway. A
  measurement of the west end should replace `runway` in `src/core/scenery.ts`.
- **Heights and roof shapes** are estimates from roof outlines, not measurements.
- **Conditions.** The 24 °C, 24 m elevation preset gives 1.185 kg/m³ air. The
  temperature and sun direction are authored choices, not a weather record.
- **Surroundings.** Field colours, the tree row along the main road and the
  distant hills are illustrative. The south compound and its boundary fence are
  simplified.

## Collision and physics

Buildings collide through 4 m axis-aligned cells that cover each rotated
footprint. Because each cell's box encloses the turned cell, a box can extend up
to about 0.7 m beyond the real wall. Fence posts collide; wire mesh and roads are
visual only. The flight surface is still the flat plane at zero height, with
paved (asphalt) friction everywhere on this site. The runway's concrete joints
are texture only.

Edit `src/view/manisa-site.ts` for buildings, roads and fields, and the
`manisa` entry in `src/core/scenery.ts` for runway, conditions and tree
positions. Run `npm test` afterwards. The field collision test checks the
pilot position, hand-launch point and both runway directions for obstacles.
