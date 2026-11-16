/**
 * On-screen display in the style of the reference FPV goggles footage: white,
 * widely spaced monospace characters with a thin dark outline, laid out like
 * the photographed OSD (position top left, home arrow top centre, timer top
 * right, battery column left, speeds and wind left of centre, altitude right,
 * crosshair and dashed horizon in the centre, mode and compass strip at the
 * bottom). Values come from `readInstruments`; layout only, no branding.
 *
 * The OSD box leaves the bottom-left minimap and the key guide uncovered.
 */
import type { InstrumentReadings, OsdText } from "../core/instruments";
import { horizonOffset } from "../core/instruments";

export function osdMarkup() {
  return `<div id="osd" class="osd" hidden aria-hidden="true">
  <div class="osd-pos osd-tl"><span>LON <b id="osd-lon"></b></span><span>LAT <b id="osd-lat"></b></span></div>
  <div class="osd-pos osd-tc"><span class="osd-arrow" id="osd-home-arrow">➤</span> <b id="osd-home"></b></div>
  <div class="osd-pos osd-tr"><span>⏱ <b id="osd-time"></b></span></div>
  <div class="osd-pos osd-batt"><b id="osd-volt"></b><b id="osd-used"></b><b id="osd-amps"></b></div>
  <div class="osd-pos osd-speed"><span>AS <b id="osd-as"></b></span><span>GS <b id="osd-gs"></b></span></div>
  <div class="osd-pos osd-wind"><span class="osd-arrow" id="osd-wind-arrow">↑</span> <b id="osd-wind"></b></div>
  <div class="osd-pos osd-alt"><span>ALT <b id="osd-alt"></b></span><span>VS <b id="osd-vs"></b></span></div>
  <div class="osd-pos osd-pwr"><span>THR <b id="osd-thr"></b></span><span><b id="osd-rpm"></b></span></div>
  <div class="osd-pos osd-hdg"><b id="osd-hdg-num"></b></div>
  <div class="osd-horizon" id="osd-horizon"></div>
  <div class="osd-cross" id="osd-cross">+</div>
  <div class="osd-pos osd-mode"><b id="osd-mode">ACRO</b></div>
  <canvas class="osd-compass" id="osd-compass" width="420" height="34"></canvas>
  <div class="osd-pos osd-odo"><b id="osd-odo"></b></div>
</div>`;
}

const $ = (id: string) => document.getElementById(id)!;

export class Osd {
  private odometerM = 0;
  private lastTime = 0;
  reset() {
    this.odometerM = 0;
    this.lastTime = 0;
  }
  /** User toggle (Field panel / O key). */
  private on = true;
  /** True only in the FPV camera: the OSD is the goggles' overlay. */
  private fpv = true;
  get visible() {
    return this.on && this.fpv;
  }
  set enabled(value: boolean) {
    this.on = value;
    $("osd").hidden = !this.visible;
  }
  get enabled() {
    return this.on;
  }
  set active(value: boolean) {
    this.fpv = value;
    $("osd").hidden = !this.visible;
  }
  update(
    r: InstrumentReadings,
    text: OsdText,
    options: {
      mode: string;
      verticalFovDeg: number;
      odometerFactor: number;
      odometerLabel: string;
      /** Screen rectangle of the 3D view (for the boresight). */
      viewRect: DOMRect;
    },
  ) {
    if (r.flightTimeS > this.lastTime)
      this.odometerM += r.groundSpeedMps * (r.flightTimeS - this.lastTime);
    this.lastTime = r.flightTimeS;
    const set = (id: string, v: string) => {
      const el = $(id);
      if (el.textContent !== v) el.textContent = v;
    };
    set("osd-lon", text.longitude);
    set("osd-lat", text.latitude);
    set("osd-home", text.home);
    set("osd-time", text.time);
    set("osd-volt", text.battery);
    set("osd-used", text.used);
    set("osd-amps", text.current);
    set("osd-as", text.speed);
    set("osd-gs", text.groundSpeed);
    set("osd-wind", text.wind);
    set("osd-alt", text.altitude);
    set("osd-vs", text.verticalSpeed);
    set("osd-thr", text.throttle);
    set("osd-rpm", text.rpm);
    set("osd-hdg-num", String(Math.round(r.headingDeg) % 360).padStart(3, "0"));
    set("osd-mode", options.mode);
    set(
      "osd-odo",
      `${((this.odometerM * options.odometerFactor) / 1000).toFixed(3)} ${options.odometerLabel}`,
    );
    ($("osd-home-arrow") as HTMLElement).style.transform =
      `rotate(${text.homeArrowDeg - 90}deg)`;
    ($("osd-wind-arrow") as HTMLElement).style.transform =
      `rotate(${text.windArrowDeg}deg)`;
    // Crosshair and dashed horizon are centred on the camera boresight (the
    // 3D view's centre), not on the OSD box; the horizon rolls opposite to
    // the aircraft and moves with pitch for the camera's vertical FOV.
    const box = $("osd").getBoundingClientRect(),
      view = options.viewRect;
    const centreY = view.top + view.height / 2 - box.top;
    const dy = horizonOffset(
      r.pitchDeg,
      options.verticalFovDeg,
      view.height || 1,
    );
    const horizon = $("osd-horizon") as HTMLElement,
      cross = $("osd-cross") as HTMLElement;
    horizon.style.top = cross.style.top = `${centreY.toFixed(1)}px`;
    horizon.style.transform = `translate(-50%, ${dy.toFixed(1)}px) rotate(${(-r.rollDeg).toFixed(1)}deg)`;
    this.compass(r.headingDeg);
  }
  private compass(heading: number) {
    const canvas = $("osd-compass") as HTMLCanvasElement,
      ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width,
      h = canvas.height,
      pxPerDeg = w / 120;
    ctx.clearRect(0, 0, w, h);
    ctx.font = "bold 14px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    for (let d = Math.ceil((heading - 60) / 5) * 5; d <= heading + 60; d += 5) {
      const x = w / 2 + (d - heading) * pxPerDeg,
        major = d % 45 === 0;
      for (const [color, width] of [
        ["rgba(0,0,0,0.75)", 3],
        ["#ffffff", 1.2],
      ] as const) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(x, h * 0.05);
        ctx.lineTo(x, h * (major ? 0.35 : d % 15 ? 0.15 : 0.25));
        ctx.stroke();
      }
      const label = { 0: "N", 90: "E", 180: "S", 270: "W" }[
        ((d % 360) + 360) % 360
      ];
      if (label) {
        ctx.strokeStyle = "rgba(0,0,0,0.8)";
        ctx.strokeText(label, x, h * 0.9);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(label, x, h * 0.9);
      }
    }
  }
}
