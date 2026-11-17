/**
 * First-run RC transmitter setup wizard (full screen). Steps: connect,
 * stick mode, centre, endpoints, channel detection, optional switches, live
 * test with a throttle-idle check, summary. The measurements and the channel
 * logic live in input/calibration.ts; this module only drives the DOM and
 * polls the Gamepad API (via the shared InputManager device list).
 */
import { BRAND } from "../config/brand";
import {
  CHANNEL_PROMPTS,
  MODE_LAYOUT,
  RangeTracker,
  THROTTLE_SAFE_MAX,
  buildCalibration,
  centerStats,
  checkPrompt,
  detectAxis,
  detectSwitch,
  promptText,
  suggestDeadzone,
  throttleSafe,
  type Calibration,
  type StickMode,
  type SwitchBinding,
} from "../input/calibration";
import {
  channels,
  mapGamepad,
  type Channel,
  type InputDevice,
} from "../input/controls";
import { applyExpo, type ExpoSettings } from "../core/pilot-response";
import { escape } from "./dom";

const STEPS = [
  "Connect",
  "Stick mode",
  "Centre",
  "Endpoints",
  "Channels",
  "Switches",
  "Test",
  "Save",
] as const;
const CENTER_SECONDS = 1.5,
  HOLD_MS = 250,
  SETTLE_MS = 400;
const label: Record<Channel, string> = {
  throttle: "Throttle",
  roll: "Aileron (roll)",
  pitch: "Elevator (pitch)",
  yaw: "Rudder (yaw)",
};

export interface SetupWizardDeps {
  devices: () => InputDevice[];
  expo: () => ExpoSettings;
  onSave: (calibration: Calibration, deviceIndex: number) => void;
  onSkip: () => void;
  /** Animation-frame scheduler (overridable in tests). */
  frame?: (cb: (t: number) => void) => number;
  now?: () => number;
}

type Assigned = Partial<Record<Channel, { axis: number; sign: 1 | -1 }>>;

export class SetupWizard {
  private root: HTMLElement | null = null;
  private step = 0;
  private deviceIndex = -1;
  private mode: StickMode = 2;
  private centers: number[] = [];
  private noise: number[] = [];
  private measuring: { until: number; samples: number[][] } | null = null;
  private range = new RangeTracker();
  private prompt = 0;
  private assigned: Assigned = {};
  private baseline: number[] | null = null;
  private settle: { since: number; last: number[] } | null = null;
  private hold: { axis: number; since: number } | null = null;
  private error = "";
  private switches: { arm?: SwitchBinding; flightMode?: SwitchBinding } = {};
  private switchWatch: {
    key: "arm" | "flightMode";
    before: { axes: number[]; buttons: number[] };
  } | null = null;
  private running = false;
  constructor(private deps: SetupWizardDeps) {}

  get isOpen() {
    return !!this.root;
  }

  open() {
    if (this.root) return;
    this.reset();
    const root = document.createElement("div");
    root.id = "setup-wizard";
    root.className = "wizard";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "wizard-title");
    root.innerHTML = `<div class="wizard-shell">
  <header class="wizard-header"><img src="/brand/mark.svg" width="36" height="36" alt=""><div><strong>${escape(BRAND.name)}</strong><span>Transmitter setup</span></div>
  <ol class="wizard-steps" aria-label="Setup steps">${STEPS.map((s, i) => `<li data-step="${i}"><span>${i + 1}</span>${s}</li>`).join("")}</ol></header>
  <main class="wizard-body"><p class="wizard-count" id="wizard-count"></p><h1 id="wizard-title" tabindex="-1"></h1><div id="wizard-content"></div><p id="wizard-error" class="wizard-error" role="alert"></p></main>
  <footer class="wizard-footer"><button id="wizard-skip" class="wizard-link">Skip setup (default mapping)</button><span></span><button id="wizard-back">Back</button><button id="wizard-next" class="primary">Next</button></footer>
</div>`;
    document.body.append(root);
    this.root = root;
    this.q("#wizard-back").onclick = () => this.go(this.step - 1);
    this.q("#wizard-next").onclick = () => this.next();
    this.q("#wizard-skip").onclick = () => {
      this.close();
      this.deps.onSkip();
    };
    this.go(0);
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      this.update();
      (this.deps.frame ?? requestAnimationFrame)(tick);
    };
    (this.deps.frame ?? requestAnimationFrame)(tick);
  }

  close() {
    this.running = false;
    this.root?.remove();
    this.root = null;
  }

  private reset() {
    this.step = 0;
    this.deviceIndex = -1;
    this.centers = [];
    this.noise = [];
    this.measuring = null;
    this.range = new RangeTracker();
    this.resetChannels();
    this.switches = {};
    this.switchWatch = null;
  }
  private resetChannels() {
    this.prompt = 0;
    this.assigned = {};
    this.baseline = null;
    this.settle = null;
    this.hold = null;
    this.error = "";
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string) {
    return this.root!.querySelector<T>(sel)!;
  }
  private now() {
    return this.deps.now?.() ?? performance.now();
  }
  private device(): InputDevice | undefined {
    const list = this.deps.devices();
    return (
      list.find((d) => d.index === this.deviceIndex) ??
      (this.deviceIndex === -1 ? list[0] : undefined)
    );
  }

  /* Navigation --------------------------------------------------------- */
  private go(step: number) {
    this.step = Math.max(0, Math.min(STEPS.length - 1, step));
    this.error = "";
    if (this.step === 4) this.resetChannels();
    this.root!.querySelectorAll<HTMLElement>("[data-step]").forEach((li) => {
      const i = Number(li.dataset.step);
      li.classList.toggle("done", i < this.step);
      li.classList.toggle("current", i === this.step);
      if (i === this.step) li.setAttribute("aria-current", "step");
      else li.removeAttribute("aria-current");
    });
    this.q("#wizard-count").textContent =
      `Step ${this.step + 1} of ${STEPS.length}`;
    this.q("#wizard-back").hidden = this.step === 0;
    this.q("#wizard-skip").hidden = this.step === STEPS.length - 1;
    this.q("#wizard-next").textContent =
      this.step === STEPS.length - 1 ? "Save and start flying" : "Next";
    this.render();
    this.q("#wizard-title").focus();
  }
  private next() {
    if (!this.canAdvance()) return;
    if (this.step === STEPS.length - 1) {
      const d = this.device();
      if (!d) return;
      this.close();
      this.deps.onSave(this.calibration(d.id), d.index);
      return;
    }
    this.go(this.step + 1);
  }
  private canAdvance() {
    const d = this.device();
    switch (this.step) {
      case 0:
        return !!d && d.axes.length >= 4;
      case 2:
        return this.centers.length > 0 && !this.measuring;
      case 3:
        return this.range.moved().length >= 4;
      case 4:
        return channels.every((c) => this.assigned[c]);
      case 6:
        return !!d && throttleSafe(this.mapped(d).throttle);
      default:
        return true;
    }
  }

  private calibration(deviceId: string): Calibration {
    return buildCalibration({
      deviceId,
      mode: this.mode,
      centers: this.centers,
      noise: this.noise,
      range: this.range,
      assigned: this.assigned as Required<Assigned>,
      switches: this.switches,
    });
  }
  private mapped(d: InputDevice) {
    return mapGamepad(d.axes, this.calibration(d.id));
  }

  /* Rendering -------------------------------------------------------- */
  private render() {
    const content = this.q("#wizard-content"),
      title = this.q("#wizard-title");
    const step = this.step;
    if (step === 0) {
      title.textContent = "Connect your transmitter";
      content.innerHTML = `<p>Connect the transmitter with its USB cable (or a USB simulator adapter) and switch on its <b>simulator / USB joystick</b> mode. Then move a stick or press a button: browsers only reveal a controller after you touch it.</p>
<div id="wizard-device" class="wizard-device" role="status"></div>
<details class="wizard-help"><summary>Nothing appears?</summary><ul><li>Use a data USB cable, not a charge-only one.</li><li>On the radio, choose the USB joystick / simulator mode (for example FlySky: <i>USB HID</i>).</li><li>Click this page once, then move a stick.</li><li>Close other apps that might hold the device.</li></ul></details>`;
    } else if (step === 1) {
      title.textContent = "Which stick mode do you fly?";
      content.innerHTML = `<p>The mode says which stick carries throttle and elevator. Most pilots fly <b>Mode 2</b>.</p><div class="wizard-modes" role="radiogroup" aria-label="Stick mode">${([1, 2, 3, 4] as StickMode[]).map((m) => `<label class="wizard-mode"><input type="radio" name="wizard-mode" value="${m}" ${m === this.mode ? "checked" : ""}><span class="wizard-mode-name">Mode ${m}</span>${modeDiagram(m)}</label>`).join("")}</div>`;
      content
        .querySelectorAll<HTMLInputElement>("input[name=wizard-mode]")
        .forEach(
          (r) =>
            (r.onchange = () => {
              this.mode = Number(r.value) as StickMode;
            }),
        );
    } else if (step === 2) {
      title.textContent = "Let the sticks rest in the centre";
      content.innerHTML = `<p>Release both sticks so the self-centring ones return to the middle (the throttle can stay where it is). Keep the transmitter still, then measure. This records each axis centre and its noise, and suggests a deadzone.</p>
<button id="wizard-measure" class="wizard-action">Measure centre</button><div class="wizard-meter" aria-hidden="true"><i id="wizard-measure-bar"></i></div><div id="wizard-center-result" role="status"></div>`;
      this.q("#wizard-measure").onclick = () => {
        this.measuring = {
          until: this.now() + CENTER_SECONDS * 1000,
          samples: [],
        };
      };
      this.renderCenterResult();
    } else if (step === 3) {
      title.textContent = "Move both sticks to every end";
      content.innerHTML = `<p>Move both sticks slowly around the full circle, into every corner, a few times. Each bar fills as its axis reaches its ends.</p><div id="wizard-axes" class="wizard-axes"></div><p class="wizard-hint" id="wizard-range-hint"></p>`;
    } else if (step === 4) {
      title.textContent = "Tell us which stick is which";
      content.innerHTML = `<div class="wizard-prompt"><p id="wizard-prompt-text" class="wizard-prompt-text" aria-live="polite"></p><p id="wizard-prompt-state" class="wizard-hint"></p></div><ol id="wizard-channel-list" class="wizard-channel-list"></ol><button id="wizard-redo" class="wizard-link">Start the channel step again</button>`;
      this.q("#wizard-redo").onclick = () => {
        this.resetChannels();
        this.renderChannels();
      };
      this.renderChannels();
    } else if (step === 5) {
      title.textContent = "Switches (optional)";
      content.innerHTML = `<p>If your transmitter has a switch you use to <b>arm</b> the motor, or to change the <b>flight mode</b> (ACRO / MANUAL), assign it here. Otherwise press Next.</p>
<div class="wizard-switches">${(["arm", "flightMode"] as const).map((k) => `<div class="wizard-switch"><strong>${k === "arm" ? "Arm / disarm" : "Flight mode (ACRO / MANUAL)"}</strong><span id="wizard-switch-${k}" role="status"></span><button data-switch="${k}">Detect</button><button data-switch-clear="${k}" class="wizard-link">Skip</button></div>`).join("")}</div>`;
      content.querySelectorAll<HTMLButtonElement>("[data-switch]").forEach(
        (b) =>
          (b.onclick = () => {
            const d = this.device();
            if (!d) return;
            this.switchWatch = {
              key: b.dataset.switch as "arm" | "flightMode",
              before: {
                axes: [...d.axes],
                buttons: d.buttons.map((x) => x.value),
              },
            };
            this.renderSwitches();
          }),
      );
      content
        .querySelectorAll<HTMLButtonElement>("[data-switch-clear]")
        .forEach(
          (b) =>
            (b.onclick = () => {
              delete this.switches[
                b.dataset.switchClear as "arm" | "flightMode"
              ];
              this.switchWatch = null;
              this.renderSwitches();
            }),
        );
      this.renderSwitches();
    } else if (step === 6) {
      title.textContent = "Test your sticks";
      content.innerHTML = `<p>Move each stick and check that the bars follow: aileron right, elevator <b>pulled back = nose up</b>, rudder right and throttle up all read positive. The second bar of each pair shows the value after your expo setting.</p>
<div class="wizard-test"><div class="wizard-sticks">${["left", "right"].map((s) => `<div class="wizard-stick" aria-hidden="true"><i id="wizard-dot-${s}"></i><span>${s} stick</span></div>`).join("")}</div><div id="wizard-bars" class="wizard-bars"></div></div>
<p id="wizard-throttle-check" class="wizard-check" role="status"></p>`;
    } else {
      title.textContent = "Save your setup";
      const d = this.device();
      const cal = d ? this.calibration(d.id) : undefined;
      content.innerHTML = cal
        ? `<p>Everything is stored only in this browser. You can run this setup again from <b>Controllers → Run setup wizard</b>.</p><dl class="wizard-summary"><dt>Transmitter</dt><dd>${escape(d!.id)}</dd><dt>Stick mode</dt><dd>Mode ${cal.mode}</dd>${channels.map((c) => `<dt>${label[c]}</dt><dd>Axis ${cal.bindings[c].axis + 1}${cal.bindings[c].reversed ? " · reversed" : ""}${c === "throttle" ? "" : ` · deadzone ${Math.round(cal.bindings[c].deadzone * 100)}%`}</dd>`).join("")}<dt>Arm switch</dt><dd>${describeSwitch(cal.switches?.arm)}</dd><dt>Flight-mode switch</dt><dd>${describeSwitch(cal.switches?.flightMode)}</dd></dl>`
        : "<p>The transmitter is disconnected. Reconnect it to save.</p>";
    }
  }

  private renderCenterResult() {
    const out = this.root?.querySelector("#wizard-center-result");
    if (!out) return;
    out.innerHTML = this.centers.length
      ? `<table class="wizard-table"><thead><tr><th>Axis</th><th>Centre</th><th>Noise</th><th>Deadzone</th></tr></thead><tbody>${this.centers
          .map(
            (c, i) =>
              `<tr><td>${i + 1}</td><td>${c.toFixed(3)}</td><td>${this.noise[i].toFixed(3)}</td><td>${Math.round(suggestDeadzone(this.noise[i]) * 100)}%</td></tr>`,
          )
          .join("")}</tbody></table>`
      : "";
  }

  private renderChannels() {
    const list = this.root?.querySelector("#wizard-channel-list");
    if (!list) return;
    list.innerHTML = channels
      .slice()
      .sort(
        (a, b) =>
          CHANNEL_PROMPTS.findIndex((p) => p.channel === a) -
          CHANNEL_PROMPTS.findIndex((p) => p.channel === b),
      )
      .map((c) => {
        const done =
          this.assigned[c] &&
          CHANNEL_PROMPTS.findIndex((p) => p.channel === c && !p.first) <
            this.prompt;
        return `<li class="${done ? "done" : ""}"><span>${label[c]}</span><b>${done ? `Axis ${this.assigned[c]!.axis + 1} ✓` : "—"}</b></li>`;
      })
      .join("");
    const prompt = CHANNEL_PROMPTS[this.prompt];
    this.q("#wizard-prompt-text").textContent = prompt
      ? promptText(prompt, this.mode)
      : "All four channels are mapped. Press Next.";
  }

  private renderSwitches() {
    for (const k of ["arm", "flightMode"] as const) {
      const el = this.root?.querySelector(`#wizard-switch-${k}`);
      if (!el) continue;
      el.textContent =
        this.switchWatch?.key === k
          ? "Flip the switch now…"
          : describeSwitch(this.switches[k]);
    }
  }

  /* Per-frame update ---------------------------------------------------- */
  private update() {
    if (!this.root) return;
    const d = this.device(),
      now = this.now();
    const next = this.q<HTMLButtonElement>("#wizard-next");
    if (this.step === 0) {
      const devices = this.deps.devices();
      const box = this.q("#wizard-device");
      const signature = devices.map((x) => `${x.index}:${x.id}`).join("|");
      if (box.dataset.signature !== signature) {
        box.dataset.signature = signature;
        box.innerHTML = devices.length
          ? `<span class="wizard-ok">●</span> Found <b>${escape(devices[0].id)}</b>${devices.length > 1 ? `<label>Use<select id="wizard-device-select">${devices.map((x) => `<option value="${x.index}">${escape(x.id)}</option>`).join("")}</select></label>` : ""}${devices[0].axes.length < 4 ? `<p class="wizard-error">This device reports ${devices[0].axes.length} axes; a transmitter needs at least 4.</p>` : ""}`
          : `<span class="wizard-wait" aria-hidden="true"></span> Waiting for a transmitter… move a stick or press a button.`;
        const select = box.querySelector<HTMLSelectElement>("select");
        if (select) {
          select.value = String(d?.index ?? devices[0].index);
          select.onchange = () => (this.deviceIndex = Number(select.value));
        }
      }
    }
    if (this.step === 2 && this.measuring && d) {
      this.measuring.samples.push([...d.axes]);
      const left = Math.max(0, this.measuring.until - now);
      this.q("#wizard-measure-bar").style.width =
        `${(1 - left / (CENTER_SECONDS * 1000)) * 100}%`;
      if (left === 0) {
        const stats = centerStats(this.measuring.samples);
        this.centers = stats.center;
        this.noise = stats.noise;
        this.measuring = null;
        this.renderCenterResult();
      }
    }
    if (this.step === 3 && d) {
      this.range.add(d.axes);
      this.q("#wizard-axes").innerHTML = d.axes
        .map((v, i) => {
          const lo = this.range.min[i] ?? v,
            hi = this.range.max[i] ?? v;
          const pct = (x: number) => ((x + 1) / 2) * 100;
          const full = this.range.span(i) >= 1.2;
          return `<div class="wizard-axis${full ? " full" : ""}"><span>Axis ${i + 1}</span><div class="wizard-track"><i style="left:${pct(lo)}%;width:${pct(hi) - pct(lo)}%"></i><b style="left:${pct(v)}%"></b></div><small>${full ? "✓" : ""}</small></div>`;
        })
        .join("");
      const moved = this.range.moved().length;
      this.q("#wizard-range-hint").textContent =
        moved >= 4
          ? `${moved} axes reached their ends. Press Next when you are done.`
          : `${moved} of 4 stick axes have reached their ends.`;
    }
    if (this.step === 4 && d) this.updateChannels(d, now);
    if (this.step === 5 && d && this.switchWatch) {
      const found = detectSwitch(
        this.switchWatch.before,
        { axes: [...d.axes], buttons: d.buttons.map((b) => b.value) },
        channels.map((c) => this.assigned[c]?.axis ?? -1),
      );
      if (found) {
        this.switches[this.switchWatch.key] = found;
        this.switchWatch = null;
        this.renderSwitches();
      }
    }
    if (this.step === 6 && d) this.updateTest(d);
    this.q("#wizard-error").textContent = this.error;
    next.disabled = !this.canAdvance();
  }

  private updateChannels(d: InputDevice, now: number) {
    const prompt = CHANNEL_PROMPTS[this.prompt];
    const state = this.q("#wizard-prompt-state");
    if (!prompt) {
      state.textContent = "";
      return;
    }
    const axes = [...d.axes];
    if (!this.baseline) {
      // Wait for the sticks to stop moving, then take the reference.
      const still =
        this.settle &&
        axes.every((v, i) => Math.abs(v - this.settle!.last[i]) < 0.03);
      if (!still) this.settle = { since: now, last: axes };
      else if (now - this.settle!.since >= SETTLE_MS) {
        this.baseline = axes;
        this.settle = null;
      }
      state.textContent = "Hold still…";
      return;
    }
    state.textContent = "Waiting for the movement…";
    const found = detectAxis(this.baseline, axes, 0.5);
    if (!found) {
      this.hold = null;
      return;
    }
    if (!this.hold || this.hold.axis !== found.axis)
      this.hold = { axis: found.axis, since: now };
    if (now - this.hold.since < HOLD_MS) return;
    const result = checkPrompt(prompt, found, this.assigned);
    this.hold = null;
    this.baseline = null;
    if (!result.ok) {
      this.error = result.error;
      return;
    }
    this.error = "";
    if (prompt.first)
      this.assigned[prompt.channel] = { axis: result.axis, sign: result.sign };
    this.prompt++;
    this.renderChannels();
  }

  private updateTest(d: InputDevice) {
    const raw = this.mapped(d),
      shaped = applyExpo(raw, this.deps.expo());
    const layout = MODE_LAYOUT[this.mode];
    const stick = (side: "left" | "right") => {
      const horizontal = channels.find(
          (c) => (c === "roll" || c === "yaw") && layout[c] === side,
        )!,
        vertical = channels.find(
          (c) => (c === "throttle" || c === "pitch") && layout[c] === side,
        )!;
      const x = raw[horizontal];
      const y = vertical === "throttle" ? raw.throttle * 2 - 1 : -raw.pitch; // stick up = nose down
      this.q(`#wizard-dot-${side}`).style.transform =
        `translate(${x * 42}px, ${-y * 42}px)`;
    };
    stick("left");
    stick("right");
    this.q("#wizard-bars").innerHTML = channels
      .map((c) => {
        const bar = (v: number, cls: string) => {
          const lo = c === "throttle" ? 0 : 50,
            w = c === "throttle" ? v * 100 : Math.abs(v) * 50;
          const left = c === "throttle" ? 0 : v < 0 ? 50 - w : 50;
          return `<div class="wizard-bar ${cls}"><i style="left:${left}%;width:${w}%"></i>${lo ? "<b></b>" : ""}</div>`;
        };
        return `<div class="wizard-bar-row"><span>${label[c]}</span>${bar(raw[c], "raw")}${bar(shaped[c], "shaped")}<output>${(raw[c] * 100).toFixed(0)}%</output></div>`;
      })
      .join("");
    const safe = throttleSafe(raw.throttle);
    const check = this.q("#wizard-throttle-check");
    check.classList.toggle("ok", safe);
    check.textContent = safe
      ? "✓ Throttle is fully down. A flight only starts with the throttle at idle."
      : `Lower the throttle fully (now ${Math.round(raw.throttle * 100)}%, needs ≤ ${Math.round(THROTTLE_SAFE_MAX * 100)}%). A flight will not start with the throttle up.`;
  }
}

function describeSwitch(s?: SwitchBinding) {
  return s
    ? `${s.kind === "button" ? "Button" : "Axis"} ${s.index + 1}`
    : "Not assigned";
}

/** Two sticks with the channel names for a mode (vertical / horizontal). */
function modeDiagram(mode: StickMode) {
  const layout = MODE_LAYOUT[mode];
  const name = (side: "left" | "right", vertical: boolean) => {
    const c = channels.find(
      (ch) =>
        layout[ch] === side &&
        (vertical
          ? ch === "throttle" || ch === "pitch"
          : ch === "roll" || ch === "yaw"),
    )!;
    return { throttle: "THR", pitch: "ELE", roll: "AIL", yaw: "RUD" }[c];
  };
  const stick = (x: number, side: "left" | "right") =>
    `<g transform="translate(${x} 0)"><rect x="4" y="6" width="56" height="56" rx="10" class="wm-box"/><path d="M32 14v40M12 34h40" class="wm-axis"/><circle cx="32" cy="34" r="6" class="wm-dot"/><text x="32" y="11" class="wm-label">${name(side, true)}</text><text x="32" y="74" class="wm-label">${name(side, false)}</text></g>`;
  return `<svg class="wizard-mode-diagram" viewBox="0 0 140 80" aria-hidden="true">${stick(0, "left")}${stick(76, "right")}</svg>`;
}
