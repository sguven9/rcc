/** Search metadata describes capabilities, never unmeasured flight fidelity. */
import type { DocPage } from "./config.ts";
import { docUrl, escapeHtml as e } from "./markdown.ts";
import { BRAND } from "../src/config/brand.ts";

const N = BRAND.name,
  SITE = BRAND.siteUrl;
export const siteTitle = `${N} — ${BRAND.tagline}`;
export const siteDescription = BRAND.description;
export const socialImage = `${SITE}/brand/social.png`;
export const socialImageAlt = `${N}: ${BRAND.tagline}.`;

// Production uses clean URLs without a trailing slash (except the site root).
export function canonicalUrl(path: string) {
  return SITE + (path === "/" ? path : path.replace(/\/$/, ""));
}
/** Canonical link only when the deployed origin is configured in BRAND. */
const canonicalLink = (url: string) =>
  SITE ? `<link rel="canonical" href="${url}">` : "";
export function jsonLd(value: unknown) {
  return `<script type="application/ld+json">${JSON.stringify(value).replace(/</g, "\\u003c")}</script>`;
}
export function socialTags(title: string, description: string, url: string) {
  return `<meta property="og:type" content="website">
<meta property="og:site_name" content="${e(N)}">
<meta property="og:locale" content="en_US">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(description)}">
<meta property="og:url" content="${e(url)}">
<meta property="og:image" content="${socialImage}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${socialImageAlt}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${e(title)}">
<meta name="twitter:description" content="${e(description)}">
<meta name="twitter:image" content="${socialImage}">
<meta name="twitter:image:alt" content="${socialImageAlt}">`;
}
const descriptions: Record<string, string> = {
  "": siteDescription,
  "getting-started": `Start flying ${N} for free in your browser or run it locally. Learn keyboard controls, launch, pause and reset your first RC aircraft flight.`,
  "flight-guide": `Set up your ${N} flight: choose scenery, place the aircraft and pilot, adjust wind, and switch between pilot, chase and FPV camera views.`,
  troubleshooting: `Fix ${N} launch, aircraft, browser and controller issues. Check mapping, calibration, USB serial connections and signal-loss recovery.`,
  controllers: `Fly ${N} with a keyboard, gamepad, flight stick or RC transmitter. Map axes, calibrate endpoints and check input before flying.`,
  "radio-setup": `Connect your RC transmitter to ${N} with a USB simulator adapter or Arduino PPM bridge. Compare routes, wiring, firmware and test status.`,
  "trainer-nano":
    "Connect a FlySky FS-i6 trainer PPM output to a classic Arduino Nano. Follow the wiring diagram, load firmware and verify the CH6 RUN guard.",
  "fs-i6-ia6b-nano-setup": `FS-i6 and FS-iA6B receiver-to-Nano setup guide: binding, PPM/PWM wiring and ${N} firmware. Receiver connections still need hardware testing.`,
  "flysky-fs-i6": `FlySky FS-i6 wiring and ${N} bridge reference: trainer PPM, receiver PPM/PWM, Arduino firmware, RCF1 serial protocol and signal-loss checks.`,
  "aircraft-editor": `Customize RC aircraft in ${N}. Change components, move the center of gravity, inspect balance and save or export local aircraft versions.`,
  "fpv-and-control-setup": `Place an FPV camera and tune ${N} control rates, expo, servo travel and mixing. Preview control surfaces before applying changes to flight.`,
  plans: `Find original RC aircraft plans, designer websites and credits for ${N} presets. Learn how reference geometry becomes an editable aircraft model.`,
  validation: `Understand ${N}'s flight-model assumptions, unmeasured parameters and known limits. Software tests are not evidence of real-aircraft equivalence.`,
  "physics-validation": `Run deterministic ${N} physics experiments, inspect trim and flight envelopes, and compare telemetry when changing aircraft definitions.`,
  benchmarks: `Read ${N}'s simulation benchmarks: gravity checks, JSBSim comparisons, NASA rotation references, unsolved trim conditions and remaining realism limits.`,
  "physics-engine": `Audit of ${N}'s flight engine: fixed timestep, integration, contacts, friction, drag and wind, with defects fixed and analytical verification tests.`,
  "catalog-aircraft": `How ${N} builds its Simple Cub, Explorer, Spitfire, Arrow, Night Radian and Apprentice presets from published specs, with a calibrated motor model.`,
  "manisa-field": `Fly ${N}'s Manisa site: a measured, procedural model of the 10/28 concrete runway, hangar and club buildings, with sources and assumptions.`,
  "atmosphere-and-ground-effect": `How ${N} models MIL-F-8785C Dryden turbulence, the near-ground wind gradient, and wing and rotor ground effect, with equations, sources and limits.`,
  "physics-reference": `Compare ${N} with native JSBSim using repeatable mass, force and flight-path tests. Inspect numerical errors, source versions and coverage limits.`,
  "aircraft-authoring": `Bring your aircraft design to ${N} with validated JSON definitions: geometry, components, mass, inertia, controls and source attribution.`,
  "component-models": `How ${N} models aircraft components: batteries, motors, propellers, servos, mass, center of gravity and inertia. Separate estimates from measurements.`,
  "component-catalog": `Browse the sources and assumptions behind ${N}'s RC component catalog, including batteries, motors, propellers and servos.`,
  "flite-test-reconstruction": `References and assumptions for ${N}'s Flite Test aircraft models, including Tiny Trainer, FT-22 and Bronco geometry and control surfaces.`,
  "vortex-simple-trainer": `Source references, geometry and modeling assumptions for the Vortex RC Simple Trainer preset in ${N}'s free RC flight simulator.`,
  "realism-plan": `${N}'s physics research plan: evidence, aerodynamic modeling, parameter uncertainty and validation work needed to improve the simulator.`,
  rendering: `How ${N} draws its flying field: physically based sky, lighting, shadows and post effects, quality presets, budgets and measured cost.`,
  "scenery-rendering": `How ${N} renders flying fields, terrain, vegetation and sky efficiently in the browser. Learn the boundaries for customizing environments.`,
  contributing: `Contribute to ${N}, the RC flight simulator. Fork the code, run checks and submit aircraft, controls, scenery or documentation changes.`,
  "agent-workflow": `Use your coding agent to contribute to ${N}: inspect the architecture, edit aircraft or components, validate changes and preserve source attribution.`,
  architecture: `Explore ${N}'s TypeScript architecture: flight dynamics, aircraft schema, controller input, Three.js rendering, browser workbench and CLI tools.`,
  versioning: `Understand ${N} releases, aircraft format versions, recording compatibility and local aircraft history. Follow the maintainer release workflow.`,
  deployment: `Build and self-host the ${N} simulator and documentation. The workbench runs without accounts, API keys or a backend.`,
  documentation: `Edit and publish ${N}'s versioned documentation: Markdown guides, visual diagrams, source links, static HTML generation and link checks.`,
  roadmap: `Explore ${N}'s development priorities and open work for its customizable, RC aircraft simulation workbench.`,
  changelog: `Read ${N} release notes and changes to aircraft editing, controls, simulation, documentation and compatibility.`,
  "scenery-assets": `Source credits and licenses for ${N} scenery assets. Check provenance and reuse requirements before contributing terrain, trees or textures.`,
  credits: `${N} third-party credits and licenses for aircraft references, software, fonts and scenery assets. Original creators retain their respective rights.`,
  "agent-contract": `Instructions for coding agents contributing to ${N}: repository boundaries, physical units, data validation, testing and documentation requirements.`,
  "code-of-conduct": `${N} community standards for respectful participation, constructive contributions and reporting unacceptable behavior.`,
  security: `Report a security issue in ${N} responsibly. Learn the project's disclosure process and how to share a useful reproduction privately.`,
};
export function docsMetadata(
  page: DocPage,
  id: string,
  version: string,
  frozen: boolean,
) {
  const title = `${page.slug ? page.title : BRAND.tagline} · ${N} docs${frozen ? ` · ${version}` : ""}`;
  const description =
    descriptions[page.slug] ?? `${N} documentation: ${page.title}.`;
  const url = canonicalUrl(docUrl(id, page.slug));
  if (page.slug === "not-found")
    return `<title>Page not found · ${e(N)}</title><meta name="robots" content="noindex, follow">`;
  return `<title>${e(title)}</title><meta name="description" content="${e(description)}"><meta name="robots" content="index, follow, max-image-preview:large">${canonicalLink(url)}${socialTags(title, description, url)}${jsonLd(
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: title,
      description,
      url,
      isPartOf: { "@type": "WebSite", name: N, url: `${SITE}/` },
      breadcrumb: {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: N,
            item: `${SITE}/`,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Documentation",
            item: canonicalUrl(docUrl(id)),
          },
          ...(page.slug
            ? [
                {
                  "@type": "ListItem",
                  position: 3,
                  name: page.title,
                  item: url,
                },
              ]
            : []),
        ],
      },
    },
  )}`;
}
export const applicationSchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE}/#website`,
      name: N,
      url: `${SITE}/`,
      description: siteDescription,
    },
    {
      "@type": "WebApplication",
      "@id": `${SITE}/#simulator`,
      name: N,
      url: `${SITE}/`,
      description: siteDescription,
      applicationCategory: "GameApplication",
      operatingSystem: "Web browser",
      browserRequirements: "JavaScript and WebGL2 support required",
      isAccessibleForFree: true,
      image: socialImage,
      featureList: [
        "Fixed-wing aircraft definitions",
        "Component mass and center of gravity",
        "RC transmitter input with a setup wizard",
        "FPV camera with on-screen display",
        "Local aircraft history",
      ],
    },
  ],
};
export function indexMetadata() {
  return `<title>${e(siteTitle)}</title><meta name="description" content="${e(siteDescription)}">${canonicalLink(`${SITE}/`)}<meta name="robots" content="index, follow, max-image-preview:large">${socialTags(siteTitle, siteDescription, `${SITE}/`)}${jsonLd(applicationSchema)}`;
}
