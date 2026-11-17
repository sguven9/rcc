<p align="center"><img src="public/brand/mark.svg" width="76" height="76" alt="" /></p>

# Fixed-wing RC flight simulator

Fly fixed-wing RC aircraft over the Manisa field in your browser, with your own RC
transmitter. The product name, tagline and colours live in one place:
[`src/config/brand.ts`](src/config/brand.ts) and
[`src/theme/theme.css`](src/theme/theme.css).

- **Aircraft:** fixed-wing presets (FT Bronco, Tiny Trainer, FT-22, Simple
  Trainer, Simple Cub, Explorer, Spitfire, Mighty Mini Arrow, Night Radian,
  Apprentice STS) defined as editable JSON with components, mass and balance.
- **Your transmitter:** a first-run setup wizard detects the radio, its stick
  mode, centres, endpoints and channel directions.
- **Flight:** FPV with an on-screen display or the pilot's view from the field,
  ACRO (gyro) or MANUAL flight-controller modes, wind, gusts and turbulence.

> **Experimental software.** Aircraft presets are not calibrated against real
> flight data. Numerical checks establish implementation behavior, not safe or
> equivalent real-world flight. Read the [model limits](docs/validation.md).

## Get started

Use Node.js 24 and npm. Supported versions are declared in [package.json](package.json).

```sh
npm ci
npm run dev
```

Open the URL Vite prints. The simulator runs at the root and the documentation
at `/docs/` on the same address. `npm run build` builds both; `npm run preview`
serves the production output. Follow [Install & first flight](docs/getting-started.md)
for the complete workflow.

## Checks

```sh
npm run check             # Definitions, tests, typecheck and production build
npm run docs:check        # Source links, commands and generated documentation
npm run references:check  # Credits and optional local plan checksums; no network
npm run format:check
```

For physics changes, also run `npm run physics:validate` and
`npm run physics:envelope`. The optional `npm run physics:reference` compares
matched cases against native JSBSim; see its [setup guide](docs/physics-reference.md).

| Path                                  | Responsibility                                          |
| ------------------------------------- | ------------------------------------------------------- |
| `aircraft/`, `components/`            | Definitions, component catalog and provenance           |
| `src/config/`, `src/theme/`           | Product identity and colour/typography tokens           |
| `src/core/`                           | Pure dynamics, schema, mass properties and recordings   |
| `src/input/`, `src/view/`, `src/app/` | Input, rendering and workbench workflows                |
| `site/`, `docs/`                      | Static documentation renderer and canonical guides      |
| `references/`                         | Source manifest and optional, verified local plan cache |
| `scripts/`, `hardware/`               | Shared-core CLI tools and Arduino bridge                |

Read [architecture](docs/architecture.md) before changing runtime behavior and
[AGENTS.md](AGENTS.md) when working with a coding agent.

## License and credits

This code is derived from an MIT-licensed project. The original copyright notice
and permission notice are kept in [LICENSE](LICENSE), as the MIT license
requires, and must stay in every copy or substantial portion of the code. They
are not shown in the app. Upstream designs, artwork, trademarks and bundled
assets retain their own rights; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
