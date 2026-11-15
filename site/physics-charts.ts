/** Documentation charts computed from the simulator's own atmosphere functions.
 * Coordinates are rounded so `docs:check` stays byte-stable across platforms.
 * These plot the implemented equations; they are not measured data.
 */
import {
  DrydenTurbulence,
  drydenParameters,
  groundEffectLiftRatio,
  rotorGroundEffect,
  shearFactor,
  wingGroundEffect,
} from "../src/core/atmosphere";

const c = {
  bg: "#111419",
  panel: "#171c21",
  frame: "#303941",
  ink: "#f1f2f5",
  muted: "#a1a5b0",
  faint: "#737c89",
  a: "#eac275",
  b: "#87c8d5",
  d: "#a5c6a7",
  e: "#ed938b",
};
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[ch]!,
  );
const r1 = (n: number) => Math.round(n * 10) / 10;
const text = (
  x: number,
  y: number,
  s: string,
  size = 14,
  fill = c.ink,
  anchor = "start",
) =>
  `<text x="${r1(x)}" y="${r1(y)}" font-size="${size}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;

function frame(title: string, desc: string, height: number, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="${height}" viewBox="0 0 960 ${height}" role="img" aria-labelledby="title desc"><title id="title">${esc(title)}</title><desc id="desc">${esc(desc)}</desc><style>text{font-family:Arial,Helvetica,sans-serif}</style><rect width="960" height="${height}" rx="16" fill="${c.bg}"/>${text(32, 42, title, 26)}${text(32, 69, desc, 14, c.muted)}${body}${text(32, height - 18, "RCFORGE  /  IMPLEMENTED EQUATIONS, NOT MEASUREMENTS", 11, c.faint)}</svg>\n`;
}

type Series = { points: [number, number][]; color: string; dash?: boolean };
/** A framed line plot. Ticks are given in data units. */
function plot(
  box: { x: number; y: number; w: number; h: number },
  xr: [number, number],
  yr: [number, number],
  xTicks: number[],
  yTicks: number[],
  xLabel: string,
  yLabel: string,
  series: Series[],
  format = (n: number) => String(n),
) {
  const px = (v: number) => box.x + ((v - xr[0]) / (xr[1] - xr[0])) * box.w;
  const py = (v: number) =>
    box.y + box.h - ((v - yr[0]) / (yr[1] - yr[0])) * box.h;
  let out = `<rect x="${box.x - 16}" y="${box.y - 16}" width="${box.w + 32}" height="${box.h + 32}" rx="8" fill="${c.panel}" stroke="${c.frame}"/>`;
  for (const t of xTicks)
    out +=
      `<path d="M${r1(px(t))} ${box.y}V${box.y + box.h}" stroke="${c.frame}" stroke-width="1"/>` +
      text(px(t), box.y + box.h + 34, format(t), 12, c.muted, "middle");
  for (const t of yTicks)
    out +=
      `<path d="M${box.x} ${r1(py(t))}H${box.x + box.w}" stroke="${c.frame}" stroke-width="1"/>` +
      text(box.x - 8, py(t) + 4, format(t), 12, c.muted, "end");
  out += text(
    box.x + box.w / 2,
    box.y + box.h + 58,
    xLabel,
    13,
    c.ink,
    "middle",
  );
  out += text(box.x, box.y - 26, yLabel, 13, c.ink);
  for (const s of series) {
    const d = s.points
      .map(([x, y], i) => `${i ? "L" : "M"}${r1(px(x))} ${r1(py(y))}`)
      .join("");
    out += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ' stroke-dasharray="7 6"' : ""}/>`;
  }
  return out;
}
const range = (from: number, to: number, n: number) =>
  Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);
const legend = (x: number, y: number, items: [string, string][]) =>
  items
    .map(
      ([label, color], i) =>
        `<path d="M${x} ${y + i * 24 - 5}h26" stroke="${color}" stroke-width="3"/>` +
        text(x + 36, y + i * 24, label, 13, c.ink),
    )
    .join("");

/** Wing (McCormick) and rotor (Cheeseman–Bennett) ground-effect factors. */
function groundEffect() {
  const ar = 6,
    e = 0.9,
    slope = 4.6;
  const hb = range(0, 1.2, 240);
  let body = plot(
    { x: 92, y: 140, w: 360, h: 300 },
    [0, 1.2],
    [0, 1.4],
    [0, 0.25, 0.5, 0.75, 1],
    [0, 0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.4],
    "Height above ground ÷ span (h/b)",
    "WING · factor relative to free air",
    [
      {
        points: hb.map((h) => [h, wingGroundEffect(h, 1)]),
        color: c.a,
      },
      {
        points: hb.map((h) => [
          h,
          groundEffectLiftRatio(slope, ar, e, wingGroundEffect(h, 1)),
        ]),
        color: c.b,
      },
    ],
  );
  body += legend(220, 300, [
    ["Induced drag × φ", c.a],
    ["Lift slope × (AR 6)", c.b],
  ]);
  const zr = range(0.25, 4.5, 170);
  body += plot(
    { x: 560, y: 140, w: 360, h: 300 },
    [0, 4.5],
    [0.9, 1.4],
    [0, 1, 2, 3, 4],
    [0.9, 1, 1.1, 1.2, 1.3, 1.4],
    "Rotor-to-ground distance ÷ radius (z/R)",
    "ROTOR · hover thrust ratio at equal power",
    [
      { points: zr.map((z) => [z, rotorGroundEffect(z, 1)]), color: c.d },
      {
        points: [
          [0, 1],
          [4.5, 1],
        ],
        color: c.faint,
        dash: true,
      },
    ],
  );
  body += text(740, 210, "Clamped below z/R = 0.5", 12, c.muted, "middle");
  return frame(
    "Ground effect near the runway",
    "Wing factors fade to exactly 1 above two spans; rotor gain fades out between 2R and 4R.",
    540,
    body,
  );
}

/** Logarithmic mean-wind profile for three roughness lengths. */
function windGradient() {
  const heights = range(0.05, 40, 400);
  const cases: [number, string, string][] = [
    [0.0002, c.b, "Smooth paving · z0 0.0002 m"],
    [0.03, c.a, "Open grass (default) · z0 0.03 m"],
    [0.1, c.e, "Crops / ploughed · z0 0.1 m"],
  ];
  let body = plot(
    { x: 110, y: 140, w: 560, h: 320 },
    [0, 1.3],
    [0, 40],
    [0, 0.25, 0.5, 0.75, 1, 1.25],
    [0, 10, 20, 30, 40],
    "Wind speed ÷ wind entered at 10 m",
    "HEIGHT · m",
    cases.map(([z0, color]) => ({
      points: heights
        .filter((h) => h > z0)
        .map((h) => [
          shearFactor(h, { referenceHeightM: 10, roughnessLengthM: z0 }),
          h,
        ]),
      color,
    })),
  );
  body += legend(
    706,
    170,
    cases.map(([, color, label]) => [label, color]),
  );
  body +=
    text(706, 270, "At 1 m above grass the wind", 13, c.muted) +
    text(706, 290, "is 60% of the 10 m value.", 13, c.muted) +
    text(706, 320, "Only the horizontal mean wind", 13, c.muted) +
    text(706, 340, "is scaled; gusts are separate.", 13, c.muted);
  return frame(
    "Wind weakens towards the ground",
    "Neutral logarithmic profile, U(h) = U(10 m) · ln(h/z0) / ln(10/z0).",
    560,
    body,
  );
}

/** One seeded Dryden sample with ±σ bands, exactly as the simulator steps it. */
function dryden() {
  const height = 30,
    wind: [number, number, number] = [6, 0, 0],
    airspeed = 15,
    dt = 1 / 120,
    seconds = 20;
  const t = new DrydenTurbulence(2026);
  t.initialize(height, wind);
  const samples: [number, number, number, number][] = [];
  for (let i = 0; i <= seconds * 120; i++) {
    const g = i ? t.advance(dt, airspeed, height, wind) : t.gust;
    if (i % 6 === 0) samples.push([i * dt, g[0], g[1], g[2]]);
  }
  const { sigma, scaleLength } = drydenParameters(height, 6);
  const axes: [number, string, string][] = [
    [1, c.a, "u · along the wind"],
    [3, c.b, "w · vertical"],
  ];
  let body = "";
  axes.forEach(([k, color, label], row) => {
    const s = sigma[k - 1],
      y = 150 + row * 210;
    body += plot(
      { x: 118, y, w: 794, h: 140 },
      [0, seconds],
      [-3.2, 3.2],
      row ? [0, 5, 10, 15, 20] : [],
      [-3, 0, 3],
      row ? "Time · s (15 m/s airspeed, 30 m height, 6 m/s wind at 20 ft)" : "",
      `${label.toUpperCase()} · m/s   σ = ${s.toFixed(2)} m/s, L = ${Math.round(scaleLength[k - 1])} m`,
      [
        {
          points: [
            [0, s],
            [seconds, s],
          ],
          color: c.faint,
          dash: true,
        },
        {
          points: [
            [0, -s],
            [seconds, -s],
          ],
          color: c.faint,
          dash: true,
        },
        { points: samples.map((p) => [p[0], p[k]]), color },
      ],
    );
  });
  return frame(
    "Dryden turbulence, one seeded sample",
    "MIL-F-8785C low-altitude intensities and scale lengths; dashed lines show ±σ. The same seed replays exactly.",
    640,
    body,
  );
}

export function physicsCharts(): Record<string, string> {
  return {
    "chart-ground-effect.svg": groundEffect(),
    "chart-wind-gradient.svg": windGradient(),
    "chart-dryden.svg": dryden(),
  };
}
