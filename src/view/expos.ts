/**
 * "Expos" page: per-channel stick expo for the RC transmitter, with a live
 * curve preview and reset. Settings persist in this browser.
 */
import {
  DEFAULT_EXPO,
  EXPO_CHANNELS,
  ExpoSchema,
  expo,
  type ExpoSettings,
} from "../core/pilot-response";

const LABELS = {
  roll: "Roll (aileron)",
  pitch: "Pitch (elevator)",
  yaw: "Yaw (rudder)",
  throttle: "Throttle",
} as const;
const STORAGE_KEY = "rcforge.expo";

export function exposMarkup() {
  return `<div class="page-heading"><div><span class="eyebrow">TRANSMITTER</span><h1>Expos</h1><p>Softer stick centre without losing full deflection: out = (1 − e)·x + e·x³.</p></div><div class="heading-actions"><button id="expo-reset">Reset to defaults</button></div></div>
<div class="expo-grid">${EXPO_CHANNELS.map(
    (ch) =>
      `<div class="card expo-card"><label for="expo-${ch}">${LABELS[ch]} <output id="expo-${ch}-value"></output></label><input id="expo-${ch}" type="range" min="0" max="100" step="1"/><canvas id="expo-${ch}-curve" width="220" height="140" aria-label="${LABELS[ch]} expo curve"></canvas></div>`,
  ).join("")}</div>`;
}

export function loadExpo(): ExpoSettings {
  try {
    const parsed = ExpoSchema.safeParse(
      JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"),
    );
    if (parsed.success) return parsed.data;
  } catch {
    /* Storage unavailable: defaults. */
  }
  return { ...DEFAULT_EXPO };
}

function drawCurve(canvas: HTMLCanvasElement, e: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width,
    h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(150,160,170,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.moveTo(0, h);
  ctx.lineTo(w, 0);
  ctx.stroke();
  ctx.strokeStyle = "#f0a33c";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i <= 64; i++) {
    const x = -1 + (2 * i) / 64,
      y = expo(x, e);
    const px = ((x + 1) / 2) * w,
      py = h - ((y + 1) / 2) * h;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.stroke();
}

/** Wire the page; returns a getter for the current settings. */
export function setupExpos(onChange: (s: ExpoSettings) => void) {
  let settings = loadExpo();
  const $ = <T extends HTMLElement>(id: string) =>
    document.getElementById(id) as T;
  const render = () => {
    for (const ch of EXPO_CHANNELS) {
      const value = Math.round(settings[ch] * 100);
      $<HTMLInputElement>(`expo-${ch}`).value = String(value);
      $(`expo-${ch}-value`).textContent = `${value}%`;
      drawCurve($<HTMLCanvasElement>(`expo-${ch}-curve`), settings[ch]);
    }
  };
  const save = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* Persistence is optional. */
    }
    onChange(settings);
  };
  for (const ch of EXPO_CHANNELS)
    $<HTMLInputElement>(`expo-${ch}`).oninput = () => {
      settings = {
        ...settings,
        [ch]: Number($<HTMLInputElement>(`expo-${ch}`).value) / 100,
      };
      render();
      save();
    };
  $("expo-reset").onclick = () => {
    settings = { ...DEFAULT_EXPO };
    render();
    save();
  };
  render();
  return () => settings;
}
