/**
 * Scale-cockpit instrument panel drawn over the cockpit camera view, modelled
 * on the reference FPV footage: a black glare shield and panel, three glass
 * displays, green knobs and small round instruments. Every needle and tape is
 * driven by `readInstruments` (smoothed by `GaugeSmoother`); the drawing is
 * original and carries no branding.
 */
import type {
  InstrumentReadings,
  SpeedUnit,
  AltitudeUnit,
} from "../core/instruments";
import { ALTITUDE_UNITS, SPEED_UNITS } from "../core/instruments";

const TAU = Math.PI * 2;
const rad = (d: number) => (d * Math.PI) / 180;

export class CockpitPanel {
  private ctx: CanvasRenderingContext2D;
  private jitter = 0;
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }
  /** Match the canvas to its CSS box at device resolution. */
  private fit() {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(this.canvas.clientWidth * ratio),
      h = Math.round(this.canvas.clientHeight * ratio);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return { w, h };
  }
  draw(
    r: InstrumentReadings,
    units: { speed: SpeedUnit; altitude: AltitudeUnit },
    maxSpeedMps = 30,
  ) {
    const { w, h } = this.fit();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // Engine vibration: sub-pixel jitter scaled with shaft speed.
    this.jitter = (this.jitter * 9301 + 49297) % 233280;
    const shake = ((this.jitter / 233280 - 0.5) * (r.rpm ?? 0)) / 20000;
    ctx.translate(shake, shake * 0.6);
    // Panel: trapezoid seen from behind and above, glare shield on top.
    const top = h * 0.12,
      inset = w * 0.17;
    ctx.fillStyle = "#151618";
    ctx.beginPath();
    ctx.moveTo(inset, top);
    ctx.quadraticCurveTo(w / 2, top - h * 0.1, w - inset, top);
    ctx.lineTo(w - w * 0.04, h);
    ctx.lineTo(w * 0.04, h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#0d0e0f";
    ctx.beginPath();
    ctx.moveTo(inset, top);
    ctx.quadraticCurveTo(w / 2, top - h * 0.1, w - inset, top);
    ctx.lineTo(w - inset - w * 0.02, top + h * 0.07);
    ctx.quadraticCurveTo(
      w / 2,
      top - h * 0.02,
      inset + w * 0.02,
      top + h * 0.07,
    );
    ctx.closePath();
    ctx.fill();
    // Knobs and switches along the glare shield (green and orange, as photographed).
    for (const [x, color] of [
      [0.46, "#2fae78"],
      [0.5, "#e3a02a"],
      [0.54, "#2fae78"],
    ] as const) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(w * x, top + h * 0.02, h * 0.022, 0, TAU);
      ctx.fill();
    }
    const sy = top + h * 0.12,
      sh = h * 0.56;
    const screens = {
      left: [w * 0.335, sy + sh * 0.06, w * 0.1, sh * 0.88],
      centre: [w * 0.445, sy, w * 0.11, sh],
      right: [w * 0.565, sy + sh * 0.06, w * 0.1, sh * 0.88],
    } as const;
    for (const [x, y, sw, shh] of Object.values(screens)) {
      ctx.fillStyle = "#2a2c30";
      ctx.fillRect(x - 4, y - 4, sw + 8, shh + 8);
      ctx.fillStyle = "#06090c";
      ctx.fillRect(x, y, sw, shh);
    }
    const speed = SPEED_UNITS[units.speed],
      altitude = ALTITUDE_UNITS[units.altitude];
    this.pfd(screens.centre, r, speed, altitude);
    const [lx, ly, lw, lh] = screens.left;
    this.dial(lx + lw / 2, ly + lh * 0.3, Math.min(lw, lh) * 0.27, {
      value: r.airspeedMps / maxSpeedMps,
      label: speed.label,
      text: (r.airspeedMps * speed.factor).toFixed(0),
      start: rad(135),
      sweep: rad(270),
    });
    this.dial(lx + lw / 2, ly + lh * 0.74, Math.min(lw, lh) * 0.22, {
      value: Math.max(-1, Math.min(1, r.verticalSpeedMps / 10)) / 2 + 0.5,
      label: "VS",
      text: (r.verticalSpeedMps * altitude.factor).toFixed(1),
      start: rad(180),
      sweep: rad(360),
      zeroAtStart: false,
    });
    const [rx, ry, rw, rh] = screens.right;
    this.compass(
      rx + rw / 2,
      ry + rh * 0.32,
      Math.min(rw, rh) * 0.28,
      r.headingDeg,
    );
    this.bar(
      rx + rw * 0.12,
      ry + rh * 0.66,
      rw * 0.76,
      rh * 0.06,
      r.throttle,
      "#e3a02a",
      `PWR ${Math.round(r.throttle * 100)}%`,
    );
    this.bar(
      rx + rw * 0.12,
      ry + rh * 0.8,
      rw * 0.76,
      rh * 0.06,
      r.rpm === undefined ? 0 : Math.min(1, r.rpm / 25000),
      "#2fae78",
      r.rpm === undefined ? "RPM —" : `RPM ${Math.round(r.rpm)}`,
    );
    if (r.voltageV !== undefined)
      this.label(
        rx + rw * 0.12,
        ry + rh * 0.95,
        `${r.voltageV.toFixed(1)} V  ${r.currentA?.toFixed(1)} A`,
        rh * 0.06,
      );
    // Small round instruments on the panel wings: turn coordinator and clock.
    this.turnCoordinator(w * 0.29, sy + sh * 0.5, h * 0.11, r);
    this.clock(w * 0.71, sy + sh * 0.5, h * 0.11, r.flightTimeS);
    // Faint reflection across the glass.
    const glare = ctx.createLinearGradient(0, sy, w, sy + sh);
    glare.addColorStop(0, "rgba(255,255,255,0)");
    glare.addColorStop(0.45, "rgba(255,255,255,0.06)");
    glare.addColorStop(0.55, "rgba(255,255,255,0)");
    ctx.fillStyle = glare;
    for (const [x, y, sw, shh] of Object.values(screens))
      ctx.fillRect(x, y, sw, shh);
  }
  private label(
    x: number,
    y: number,
    text: string,
    size: number,
    color = "#e8f0f2",
    align: CanvasTextAlign = "left",
  ) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.font = `600 ${Math.max(8, size)}px ui-monospace, monospace`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
  }
  /** Primary flight display: horizon, pitch ladder, speed and altitude tapes. */
  private pfd(
    [x, y, w, h]: readonly number[],
    r: InstrumentReadings,
    speed: { factor: number; label: string },
    altitude: { factor: number; label: string },
  ) {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    const cx = x + w / 2,
      cy = y + h * 0.45,
      pxPerDeg = h / 60;
    ctx.translate(cx, cy);
    ctx.rotate(-rad(r.rollDeg));
    ctx.translate(0, r.pitchDeg * pxPerDeg);
    ctx.fillStyle = "#2f6db2";
    ctx.fillRect(-w * 2, -h * 3, w * 4, h * 3);
    ctx.fillStyle = "#8a5a2c";
    ctx.fillRect(-w * 2, 0, w * 4, h * 3);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-w * 2, 0);
    ctx.lineTo(w * 2, 0);
    ctx.stroke();
    ctx.lineWidth = 1;
    for (let p = -30; p <= 30; p += 10) {
      if (!p) continue;
      const yy = -p * pxPerDeg,
        half = w * (p % 20 ? 0.1 : 0.16);
      ctx.beginPath();
      ctx.moveTo(-half, yy);
      ctx.lineTo(half, yy);
      ctx.stroke();
    }
    ctx.restore();
    // Fixed aircraft symbol.
    ctx.strokeStyle = "#ffd23a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.22, cy);
    ctx.lineTo(cx - w * 0.07, cy);
    ctx.lineTo(cx, cy + h * 0.03);
    ctx.lineTo(cx + w * 0.07, cy);
    ctx.lineTo(cx + w * 0.22, cy);
    ctx.stroke();
    // Tapes.
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x, y + h * 0.3, w * 0.24, h * 0.3);
    ctx.fillRect(x + w * 0.76, y + h * 0.3, w * 0.24, h * 0.3);
    const size = h * 0.07;
    this.label(
      x + w * 0.12,
      cy,
      (r.airspeedMps * speed.factor).toFixed(0),
      size,
      "#ffffff",
      "center",
    );
    this.label(
      x + w * 0.12,
      y + h * 0.56,
      speed.label,
      size * 0.6,
      "#9fd3ff",
      "center",
    );
    this.label(
      x + w * 0.88,
      cy,
      (r.altitudeM * altitude.factor).toFixed(0),
      size,
      "#ffffff",
      "center",
    );
    this.label(
      x + w * 0.88,
      y + h * 0.56,
      altitude.label,
      size * 0.6,
      "#9fd3ff",
      "center",
    );
    // Heading box.
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(x + w * 0.35, y + h * 0.84, w * 0.3, h * 0.12);
    this.label(
      cx,
      y + h * 0.9,
      `${String(Math.round(r.headingDeg) % 360).padStart(3, "0")}°`,
      size,
      "#ffffff",
      "center",
    );
  }
  private dial(
    cx: number,
    cy: number,
    radius: number,
    o: {
      value: number;
      label: string;
      text: string;
      start: number;
      sweep: number;
      zeroAtStart?: boolean;
    },
  ) {
    const ctx = this.ctx;
    ctx.fillStyle = "#0f1317";
    ctx.strokeStyle = "#5a6066";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#cfd6da";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      const a = o.start + (o.sweep * i) / 10;
      ctx.beginPath();
      ctx.moveTo(
        cx + Math.cos(a) * radius * 0.8,
        cy + Math.sin(a) * radius * 0.8,
      );
      ctx.lineTo(
        cx + Math.cos(a) * radius * 0.95,
        cy + Math.sin(a) * radius * 0.95,
      );
      ctx.stroke();
    }
    const a = o.start + o.sweep * Math.max(0, Math.min(1, o.value));
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(
      cx + Math.cos(a) * radius * 0.78,
      cy + Math.sin(a) * radius * 0.78,
    );
    ctx.stroke();
    this.label(
      cx,
      cy + radius * 0.45,
      o.text,
      radius * 0.3,
      "#ffffff",
      "center",
    );
    this.label(
      cx,
      cy - radius * 0.4,
      o.label,
      radius * 0.22,
      "#9fd3ff",
      "center",
    );
  }
  private compass(cx: number, cy: number, radius: number, heading: number) {
    const ctx = this.ctx;
    ctx.fillStyle = "#0f1317";
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-rad(heading));
    ctx.strokeStyle = "#cfd6da";
    for (let d = 0; d < 360; d += 10) {
      const a = rad(d) - Math.PI / 2,
        inner = d % 30 ? 0.86 : 0.76;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * radius * inner, Math.sin(a) * radius * inner);
      ctx.lineTo(Math.cos(a) * radius * 0.96, Math.sin(a) * radius * 0.96);
      ctx.stroke();
    }
    for (const [d, t] of [
      [0, "N"],
      [90, "E"],
      [180, "S"],
      [270, "W"],
    ] as const) {
      const a = rad(d) - Math.PI / 2;
      this.label(
        Math.cos(a) * radius * 0.6,
        Math.sin(a) * radius * 0.6,
        t,
        radius * 0.2,
        d ? "#ffffff" : "#ff8a5c",
        "center",
      );
    }
    ctx.restore();
    ctx.strokeStyle = "#ffd23a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - radius * 0.5);
    ctx.lineTo(cx, cy + radius * 0.4);
    ctx.moveTo(cx - radius * 0.25, cy);
    ctx.lineTo(cx + radius * 0.25, cy);
    ctx.stroke();
  }
  private bar(
    x: number,
    y: number,
    w: number,
    h: number,
    value: number,
    color: string,
    text: string,
  ) {
    const ctx = this.ctx;
    ctx.fillStyle = "#1f252a";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * Math.max(0, Math.min(1, value)), h);
    this.label(x, y - h * 0.9, text, h * 1.1);
  }
  /** Standard-rate marks at ±3°/s; the ball shows slip. */
  private turnCoordinator(
    cx: number,
    cy: number,
    radius: number,
    r: InstrumentReadings,
  ) {
    const ctx = this.ctx;
    ctx.fillStyle = "#0f1317";
    ctx.strokeStyle = "#4b5157";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.fill();
    ctx.stroke();
    const bank = Math.max(-1.6, Math.min(1.6, r.turnRateDegS / 3)) * rad(20);
    ctx.save();
    ctx.translate(cx, cy - radius * 0.1);
    ctx.rotate(bank);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-radius * 0.6, 0);
    ctx.lineTo(radius * 0.6, 0);
    ctx.moveTo(0, -radius * 0.18);
    ctx.lineTo(0, radius * 0.05);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "#2a3035";
    ctx.fillRect(
      cx - radius * 0.45,
      cy + radius * 0.4,
      radius * 0.9,
      radius * 0.18,
    );
    ctx.fillStyle = "#f2f2ee";
    ctx.beginPath();
    ctx.arc(
      cx + Math.max(-1, Math.min(1, r.slip * 4)) * radius * 0.38,
      cy + radius * 0.49,
      radius * 0.08,
      0,
      TAU,
    );
    ctx.fill();
    this.label(
      cx,
      cy + radius * 0.78,
      "TURN",
      radius * 0.16,
      "#9fd3ff",
      "center",
    );
  }
  private clock(cx: number, cy: number, radius: number, seconds: number) {
    const ctx = this.ctx;
    ctx.fillStyle = "#0f1317";
    ctx.strokeStyle = "#4b5157";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.fill();
    ctx.stroke();
    const a = (seconds / 60) * TAU - Math.PI / 2;
    ctx.strokeStyle = "#ff8a5c";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(
      cx + Math.cos(a) * radius * 0.8,
      cy + Math.sin(a) * radius * 0.8,
    );
    ctx.stroke();
    const m = Math.floor(seconds / 60),
      s = Math.floor(seconds % 60);
    this.label(
      cx,
      cy + radius * 0.5,
      `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`,
      radius * 0.24,
      "#ffffff",
      "center",
    );
  }
}
