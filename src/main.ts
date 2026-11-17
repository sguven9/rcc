import {
  hostAllows,
  requireHostAccess,
  onHostAccessChange,
  mountHost,
} from "./app/host";
import { ComponentPlacementDialog } from "./app/component-placement";
import { FlightClock } from "./app/flight-clock";
import { bundledAircraft } from "./app/bundled-aircraft";
import { setupAircraftHistory } from "./app/aircraft-history";
import {
  saveAircraftRevision,
  importAircraftHistory,
} from "./app/aircraft-history-storage";
import {
  MAX_HISTORY_BYTES,
  parseAircraftHistory,
  sameAircraft,
} from "./core/aircraft-history";
import { ControlPreview } from "./core/control-preview";
import { FpvPlacementDialog } from "./app/fpv-placement";
import { renderControlTest, updateControlTest } from "./app/control-test";
import { applyExpo, withTrim } from "./core/pilot-response";
import { setupExpos } from "./view/expos";
import { setImmersive as setImmersiveMode, osdShown } from "./app/immersive";
import "./view/flight-navigation.css";
import {
  createFlightNavigation,
  setNavigationField,
  setNavigationWind,
} from "./view/flight-navigation";
import { setupArduino } from "./app/arduino";
import { renderBudget } from "./view/render-budget";
import {
  sceneries,
  airDensity,
  airKinematicViscosity,
  type SceneryId,
  type Scenery,
  DEFAULT_SCENERY,
} from "./core/scenery";
import { powertrain } from "./core/powertrain";
import { batteryUsage } from "./core/components";
import { setupCatalog } from "./app/catalog";
import {
  importedAircraft,
  preferredAircraft,
  rememberAircraft,
  saveAppliedAircraft,
  savedAircraft,
} from "./app/aircraft-storage";
import { ControllerActions, navigateSetting } from "./app/controller-actions";
import { rotate } from "./core/math";
import { defaultWindProfile } from "./core/atmosphere";
import { placedLaunch, type Placement } from "./core/placement";
import { placementUI } from "./app/placement";
import "./theme/theme.css";
import "./style.css";
import "./workbench.css";
import "./view/editor-workspace.css";
import "./view/light-theme.css";
import { setupEditorWorkspace } from "./app/editor-workspace";
import "./view/position-panel.css";
import "./view/physics-debug.css";
import {
  EnergyGraph,
  PHYSICS_DEBUG_LEGEND,
  rotorDebugLines,
} from "./view/physics-debug";
import "./view/osd.css";
import { Osd } from "./view/osd";
import {
  ALTITUDE_UNITS,
  SPEED_UNITS,
  formatOsd,
  readInstruments,
  type AltitudeUnit,
  type SpeedUnit,
} from "./core/instruments";
import { PHYSICS } from "./core/physics-config";
import { setPositionField } from "./view/position-panel";
import "./view/flight-feedback.css";
import "./view/setup-wizard.css";
import "./theme/components.css";
import { ZodError } from "zod";
import { aircraftCredit } from "./app/aircraft-credit";
import { workbenchMarkup } from "./view/workbench";
import { FlightScene, type CameraMode } from "./view/scene";
import { FlightAudio } from "./view/audio";
import { parseAircraft, type Aircraft } from "./core/schema";
import {
  Simulation,
  calmEnvironment,
  FIXED_DT,
  cleanControls,
  type Controls,
} from "./core/simulation";
import { massProperties } from "./core/aircraft";
import { findTrim } from "./core/trim";
import {
  fitLandingGear,
  launchState,
  launchTrim,
  launchAirspeed,
  type LaunchMode,
} from "./core/launch";
import { aircraftChannels, keyboardTurnAxis } from "./app/aircraft-channels";
import {
  createRecording,
  parseRecording,
  sample,
  type Recording,
} from "./core/experiment";
import { InputManager } from "./input/controls";
import { ControllerPage } from "./app/controllers";
import { AircraftEditor } from "./app/editor";
import { $, escape, download } from "./app/dom";
import { ownsKeyboard } from "./input/ui-focus";
import {
  flightAction,
  flightFeedback,
  flightModelNote,
} from "./app/flight-session";
import { setupTabs } from "./app/tabs";
import { storageKey } from "./config/brand";
import { bootDone, bootProgress } from "./app/boot";
import { SetupWizard } from "./app/setup-wizard";
import {
  needsRecalibration,
  parseSetupState,
  shouldOpenWizard,
  switchOn,
  throttleSafe,
  type SetupState,
} from "./input/calibration";
import { mapGamepad, saveProfile } from "./input/controls";
bootProgress(0.45, "Preparing the workbench…");
$("app").innerHTML = workbenchMarkup();
const flightOverlaySizes = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const variable = entry.target.classList.contains("flight-bottom")
      ? "--flight-hud-height"
      : "--flight-guide-height";
    $("page-fly").style.setProperty(
      variable,
      `${entry.target.getBoundingClientRect().height}px`,
    );
  }
});
for (const selector of [".flight-bottom", ".flight-key-guide"])
  flightOverlaySizes.observe(document.querySelector(selector)!);
const originals = [...bundledAircraft];
const bundledIds = new Set(originals.map((a) => a.id));
originals.push(...importedAircraft(originals));
let baseline = preferredAircraft(
    originals.filter((a) => hostAllows({ kind: "aircraft", id: a.id })),
  ),
  aircraft = structuredClone(baseline),
  // The browser applies the isothermal density lapse above the field.
  environment: ReturnType<typeof calmEnvironment> = {
    ...calmEnvironment(),
    densityScaleHeightM: PHYSICS.densityScaleHeightM,
  },
  mode: LaunchMode = "ground",
  page = "fly",
  running = false,
  started = false,
  replay: Recording | null = null,
  replayIndex = 0,
  pitchTrim = 0,
  // Aileron/rudder trim from the trim solver (propeller torque, P-factor).
  lateralTrim = { roll: 0, yaw: 0 },
  // Set by the "Trigger gust" button; consumed by the next control frame.
  gustRequested = false,
  releaseTrimConverged = true;
const flightClock = new FlightClock(FIXED_DT);
let placement: Placement | null = null;
const initialAircraft = physicalAircraft();
let sim = new Simulation(
    initialAircraft,
    environment,
    launchState(initialAircraft, mode),
  ),
  controls: Controls = { roll: 0, pitch: 0, yaw: 0, throttle: 0 },
  recording = createRecording(sim),
  editorSim = sim;
let scene: FlightScene | undefined;
/** FPV (pre-mounted on every aircraft, the default) or the pilot on the ground. */
type FlightCamera = "ground" | "fpv";
let flightCamera: FlightCamera = "fpv";
let locatorUntil = 0;
const audio = new FlightAudio();
let pauseReason = "";
let notificationTimer: ReturnType<typeof setTimeout> | undefined;
function dismissNotification() {
  clearTimeout(notificationTimer);
  $("notification").hidden = true;
}
function message(text: string, persistent = false) {
  clearTimeout(notificationTimer);
  $("notification-text").textContent = text;
  $("notification").hidden = false;
  if (!persistent) notificationTimer = setTimeout(dismissNotification, 10000);
}
$("dismiss-notification").onclick = dismissNotification;
function errorText(e: unknown) {
  return e instanceof ZodError
    ? e.issues
        .slice(0, 3)
        .map((v) => v.path.join(".") + ": " + v.message)
        .join("; ")
    : e instanceof Error
      ? e.message
      : String(e);
}
/**
 * Immersive flight: on start the page goes full screen (requested from the
 * user's click or key press, as browsers require) and every panel hides; only
 * the FPV OSD and essential warnings stay. Leaving full screen (Esc) or
 * pausing brings the interface back.
 */
function setImmersive(on: boolean) {
  setImmersiveMode(document, on);
  osd.inFlight = on;
}
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && running)
    pause("Paused — full screen closed.");
});
function pause(reason?: string) {
  const wasRunning = running;
  running = false;
  setImmersive(false);
  flightClock.reset();
  document.body.dataset.running = "false";
  $("toggle-flight-setup").setAttribute(
    "aria-expanded",
    String(!$("page-fly").classList.contains("setup-collapsed")),
  );
  if (wasRunning) pauseReason = reason ?? "";
  audio.update(0, 0, false);
}
// Stick expo per channel (Expos page); the only shaping before trim.
const expoSettings = setupExpos(() => controlPreview?.reset());
let controlPreview = new ControlPreview(aircraft);
const previewClock = new FlightClock(FIXED_DT);
let previewPitchTrim = 0;
let previewStatus = "Enable Test sticks to move the controls.";
renderControlTest(controlPreview);
const input = new InputManager(
  (reason) => pause(reason),
  () => hostAllows({ kind: "input", id: "controller" }),
);
const controller = new ControllerPage(input, () => pause(), message);
const arduino = setupArduino(input, controller, pause);
/**
 * First-run transmitter setup wizard. Its state (completed / skipped, the
 * calibrated device and a pending first-flight throttle check) is stored
 * apart from the calibration itself, which is the saved controller profile.
 */
const SETUP_STATE_KEY = storageKey("setup.v1");
let setupState: SetupState | null = null;
try {
  setupState = parseSetupState(localStorage.getItem(SETUP_STATE_KEY));
} catch {
  /* Preferences are optional. */
}
function saveSetupState(state: SetupState) {
  setupState = state;
  try {
    localStorage.setItem(SETUP_STATE_KEY, JSON.stringify(state));
  } catch {
    /* The calibration still applies for this session. */
  }
}
function hasSavedCalibration() {
  try {
    for (let i = 0; i < localStorage.length; i++)
      if (localStorage.key(i)?.startsWith(storageKey("controller.")))
        return true;
  } catch {
    /* No storage: treat as not calibrated. */
  }
  return false;
}
const wizard = new SetupWizard({
  devices: () => input.devices(),
  expo: () => expoSettings(),
  onSave: (calibration, deviceIndex) => {
    input.deviceIndex = deviceIndex;
    input.profile = calibration;
    saveProfile(calibration);
    saveSetupState({
      completed: true,
      skipped: false,
      deviceId: calibration.deviceId,
      firstFlightPending: true,
    });
    controller.refresh();
    message(
      "Transmitter calibrated. Lower the throttle and start your flight.",
    );
    location.hash = "/fly";
  },
  onSkip: () => {
    saveSetupState({ completed: false, skipped: true });
    message(
      "Setup skipped: the default channel mapping is in use. Run the setup wizard from Controllers at any time.",
    );
  },
});
for (const id of ["open-setup-wizard", "open-setup-wizard-flight"])
  $(id).onclick = () => {
    pause();
    wizard.open();
  };
let recalibrationSuggested = "";
/** A different transmitter than the calibrated one: offer the wizard. */
function suggestRecalibration() {
  const d = input.selected();
  if (
    !d ||
    wizard.isOpen ||
    recalibrationSuggested === d.id ||
    !needsRecalibration(setupState, d.id)
  )
    return;
  recalibrationSuggested = d.id;
  const box = document.createElement("div");
  box.className = "setup-suggestion";
  box.setAttribute("role", "status");
  box.innerHTML = `<span>A different transmitter is connected. Calibrate it?</span><button class="primary">Calibrate</button><button>Later</button>`;
  const [calibrate, later] = box.querySelectorAll("button");
  calibrate.onclick = () => {
    box.remove();
    pause();
    wizard.open();
  };
  later.onclick = () => box.remove();
  document.body.append(box);
}
function physicalAircraft() {
  return mode === "ground" ? fitLandingGear(aircraft) : aircraft;
}
function updateFlightInfo() {
  const a = physicalAircraft();
  document.querySelectorAll<HTMLButtonElement>("[data-launch]").forEach((b) => {
    b.classList.toggle("active", b.dataset.launch === mode);
    b.setAttribute("aria-pressed", String(b.dataset.launch === mode));
  });
  const note = flightModelNote({
    handLaunch: mode === "hand",
    trimSpeedMps: launchAirspeed(a, mode),
    converged: releaseTrimConverged,
    pitchTrim,
  });
  $("flight-control-note").textContent = note.text;
  $("flight-control-note").classList.toggle("trim-limited", note.limited);
  $("launch-description").textContent =
    mode === "ground"
      ? "Start stationary on the ground. Build airspeed, then rotate."
      : mode === "hand"
        ? `Release at ${placement?.altitudeM ?? 1.7} m and 8.5 m/s${releaseTrimConverged ? ", trimmed for a gentle climb" : ""}.`
        : `Start at ${placement?.altitudeM ?? 22} m and ${launchAirspeed(a, mode)} m/s${releaseTrimConverged ? " with calculated trim" : ""}.`;
  $("flight-mass").textContent =
    (massProperties(a).mass * 1000).toFixed(0) + " g";
  $("flight-model-info").textContent =
    `${a.name} · ${(a.reference.spanM * 1000).toFixed(0)} mm span · ${a.motors.length === 2 ? "Twin motor" : "Single motor"}`;
  $("flight-aircraft-credit").innerHTML = aircraftCredit(a);
  $("flight-gear").textContent = aircraft.contactPoints.some(
    (p) => p.kind === "wheel",
  )
    ? `${aircraft.contactPoints.filter((p) => p.kind === "wheel").length} installed wheels${aircraft.contactPoints.some((p) => p.kind === "skid") ? " + tail skid" : ""}`
    : mode === "ground"
      ? "Removable tricycle (+45 g)"
      : "Belly landing";
}
function showScenery(env: typeof environment) {
  const id = (
    env.sceneryId && Object.hasOwn(sceneries, env.sceneryId)
      ? env.sceneryId
      : DEFAULT_SCENERY
  ) as SceneryId;
  const site = sceneries[id];
  scene?.setScenery(id);
  $("scenery-label").textContent = site.name.toUpperCase();
  $("scenery-conditions").textContent =
    `${site.temperatureC} °C · ${site.elevationM} m elevation · ${env.densityKgM3.toFixed(3)} kg/m³`;
  setNavigationField(site);
  setPositionField(site);
}
// Physics debug overlay: force arrows in the scene plus a rolling energy graph.
const energyGraph = new EnergyGraph($<HTMLCanvasElement>("energy-graph"));
// On-screen display (FPV only), fed by readInstruments().
const osd = new Osd();
let osdHome: [number, number] = [0, 0];
const osdUnits = (): { speed: SpeedUnit; altitude: AltitudeUnit } => ({
  speed: $<HTMLSelectElement>("osd-speed-unit").value as SpeedUnit,
  altitude: $<HTMLSelectElement>("osd-alt-unit").value as AltitudeUnit,
});
/** v2: the first OSD build saved "off" for everyone at start-up; ignore it. */
const OSD_STORAGE_KEY = storageKey("osd.v2");
function applyOsdSettings() {
  osd.enabled = $<HTMLInputElement>("osd-toggle").checked;
  try {
    localStorage.setItem(
      OSD_STORAGE_KEY,
      JSON.stringify({ on: osd.enabled, ...osdUnits() }),
    );
  } catch {
    /* Preferences are optional. */
  }
}
try {
  const saved = JSON.parse(localStorage.getItem(OSD_STORAGE_KEY) ?? "null");
  if (saved) {
    $<HTMLInputElement>("osd-toggle").checked = !!saved.on;
    if (saved.speed in SPEED_UNITS)
      $<HTMLSelectElement>("osd-speed-unit").value = saved.speed;
    if (saved.altitude in ALTITUDE_UNITS)
      $<HTMLSelectElement>("osd-alt-unit").value = saved.altitude;
  }
} catch {
  /* Ignore unreadable preferences. */
}
for (const id of ["osd-toggle", "osd-speed-unit", "osd-alt-unit"])
  $(id).onchange = applyOsdSettings;
applyOsdSettings();
/**
 * Fixed-wing flight-controller mode. ACRO (default, like the reference
 * aircraft's iNav board) feeds stick rate commands to the gyro loop in
 * core/flight-controller.ts; MANUAL sends the sticks straight to the servos.
 */
const FC_MODE_STORAGE_KEY = storageKey("fc-mode");
let fcMode: "acro" | "manual" = "acro";
try {
  if (localStorage.getItem(FC_MODE_STORAGE_KEY) === "manual") fcMode = "manual";
} catch {
  /* Preferences are optional. */
}
$<HTMLSelectElement>("fc-mode").value = fcMode;
/** Arm state from the optional arm switch (always armed without one). */
let armed = true;
/**
 * Optional transmitter switches from the setup wizard: a disarmed arm switch
 * holds the motor at zero; the flight-mode switch selects ACRO or MANUAL.
 */
function applySwitches(raw: { throttle: number }) {
  const d = input.selected(),
    s = input.profile.switches;
  if (!d || !s) {
    armed = true;
    return;
  }
  armed = s.arm ? switchOn(s.arm, d) : true;
  if (!armed) raw.throttle = 0;
  if (s.flightMode) {
    const wanted = switchOn(s.flightMode, d) ? "acro" : "manual";
    if (wanted !== fcMode) {
      fcMode = wanted;
      $<HTMLSelectElement>("fc-mode").value = fcMode;
      seedFlightController();
    }
  }
}
/** ACRO applies only to aircraft whose surfaces the controller can drive. */
const acroActive = () => fcMode === "acro" && !!sim.controlPower;
/** Seed the ACRO integrators with the trim so the hand-off is bumpless. */
function seedFlightController() {
  if (!acroActive()) return;
  sim.state.fcIntegral = [lateralTrim.roll, pitchTrim, lateralTrim.yaw];
  sim.state.fcAttitude = [0, 0, 0];
}
$("fc-mode").onchange = () => {
  fcMode =
    $<HTMLSelectElement>("fc-mode").value === "manual" ? "manual" : "acro";
  try {
    localStorage.setItem(FC_MODE_STORAGE_KEY, fcMode);
  } catch {
    /* Preferences are optional. */
  }
  seedFlightController();
};
/** OSD in FPV only (goggle overlay), fed by readInstruments(). */
function updateOsd() {
  if (!osd.visible) return;
  const site = sceneries[
    (environment.sceneryId ?? DEFAULT_SCENERY) as SceneryId
  ] as Scenery;
  const readings = readInstruments(sim, {
    headingOffsetDeg: site.headingOffsetDeg ?? 0,
    home: osdHome,
    location: site.location,
  });
  osd.update(readings, formatOsd(readings, osdUnits()), {
    mode: (acroActive() ? "ACRO" : "MANUAL") + (armed ? "" : " · DISARMED"),
    verticalFovDeg: scene?.camera.fov ?? 50,
    odometerFactor: 1,
    odometerLabel: "km",
    viewRect: $("viewport").getBoundingClientRect(),
  });
}
$("physics-debug-legend").innerHTML = PHYSICS_DEBUG_LEGEND.map(
  (v) =>
    `<li><i style="background:#${v.color.toString(16).padStart(6, "0")}"></i>${v.label}</li>`,
).join("");
function setPhysicsDebug(on: boolean) {
  scene?.setPhysicsDebug(on);
  $("physics-debug-panel").hidden = !on;
  energyGraph.reset();
}
$("physics-debug").onchange = () =>
  setPhysicsDebug($<HTMLInputElement>("physics-debug").checked);
function reset() {
  energyGraph.reset();
  osd.reset();
  const cameraMode = flightCamera;
  showScenery(environment);
  environment = { ...environment, obstacles: scene?.fieldObstacles ?? [] };
  pause();
  started = false;
  replay = null;
  replayIndex = 0;
  input.clear();
  const a = physicalAircraft(),
    trim = launchTrim(a, mode, environment);
  pitchTrim = trim.controls.pitch;
  lateralTrim = { roll: trim.controls.roll, yaw: trim.controls.yaw };
  gustRequested = false;
  releaseTrimConverged = trim.converged;
  sim = new Simulation(
    a,
    environment,
    placedLaunch(a, mode, placement, environment),
  );
  seedFlightController();
  controls = {
    roll: lateralTrim.roll,
    pitch: pitchTrim,
    yaw: lateralTrim.yaw,
    throttle: mode === "ground" ? 0 : trim.controls.throttle,
  };
  input.throttle = controls.throttle;
  sim.lastForces = sim.forces(sim.state, controls);
  recording = createRecording(sim);
  osdHome = [sim.state.position[0], sim.state.position[1]];
  scene?.setAircraft(page === "aircraft" ? editor.draft : a);
  if (page === "aircraft") scene?.setCamera("orbit");
  else setFlightCamera(cameraMode);
  $<HTMLInputElement>("pitch-trim").value = String(Math.round(pitchTrim * 100));
  $("pitch-trim-value").textContent = Math.round(pitchTrim * 100) + "%";
  $("pause").hidden = false;
  $("launch").innerHTML = "Start flight";
  $("notification").hidden = true;
  $("throttle").toggleAttribute("disabled", input.source === "controller");
  updateFlightInfo();
  stats();
}
async function launch() {
  if (!requireHostAccess({ kind: "aircraft", id: sim.aircraft.id })) return;
  if (!requireHostAccess({ kind: "input", id: controller.type })) return;
  if (!scene) {
    message("WebGL is unavailable. Enable hardware acceleration to fly.");
    return;
  }
  if (!replay && !controller.ready()) {
    if (!setupState?.completed && !setupState?.skipped) wizard.open();
    else location.hash = "/controllers";
    return;
  }
  if (!replay) {
    const d = input.selected();
    // Like an ESC that will not arm: no flight starts with the throttle up.
    if (d && !throttleSafe(mapGamepad(d.axes, input.profile).throttle)) {
      message(
        "The throttle stick is up. Lower it fully, then start the flight.",
      );
      return;
    }
    if (!setupState?.completed)
      message(
        "Transmitter not set up: the default channel mapping is in use. Run the setup wizard (Controllers) for checked directions.",
      );
    if (setupState?.firstFlightPending)
      saveSetupState({ ...setupState, firstFlightPending: false });
  }
  if (!replay && recording.frames.length >= 36000) {
    message("Recording limit reached. Export and reset.");
    return;
  }
  if (
    replay &&
    (replayIndex >= replay.frames.length ||
      sim.state.status === "crashed" ||
      sim.state.status === "landed")
  ) {
    sim = new Simulation(
      replay.aircraft,
      replay.environment,
      replay.initialState,
    );
    replayIndex = 0;
  } else if (
    !replay &&
    (sim.state.status === "crashed" || sim.state.status === "landed")
  )
    reset();
  positioning.close(false);
  running = true;
  setImmersive(page === "fly");
  started = true;
  flightClock.reset(performance.now());
  input.clear();
  document.body.dataset.running = "true";
  $("page-fly").classList.add("setup-collapsed");
  $("pause").hidden = false;
  $("toggle-flight-setup").setAttribute("aria-expanded", "false");
  stats();
  $("notification").hidden = true;
  scene.renderer.domElement.focus();
  await audio.start();
}
function loadAircraft(a: Aircraft) {
  if (!requireHostAccess({ kind: "aircraft", id: a.id })) {
    fillSelects();
    return;
  }
  baseline = originals.find((v) => v.id === a.id) ?? a;
  aircraft = hostAllows({ kind: "workspace", id: "aircraft" })
    ? savedAircraft(a)
    : structuredClone(a);
  if (hostAllows({ kind: "workspace", id: "aircraft" }))
    rememberAircraft(aircraft.id);
  editor.switchTo(aircraft);
  reset();
  fillSelects();
}
function fillSelects() {
  for (const id of ["flight-aircraft", "editor-aircraft"]) {
    $(id).innerHTML = originals
      .map(
        (a) =>
          `<option value="${a.id}">${escape(a.name)}${hostAllows({ kind: "aircraft", id: a.id }) ? "" : " · Sign in"}</option>`,
      )
      .join("");
    $<HTMLSelectElement>(id).value = aircraft.id;
  }
}
let editorComponent: Aircraft["parts"][number] | undefined;
let componentsWorkspace = false;
let cameraPlacer: FpvPlacementDialog | undefined;
let componentPlacer: ComponentPlacementDialog | undefined;
const editor = new AircraftEditor(
  aircraft,
  (a) => {
    const unapplied =
      editor.hasPending || JSON.stringify(a) !== JSON.stringify(aircraft);
    $("editor-state").textContent = unapplied
      ? "Unapplied changes"
      : "Applied to flight";
    $("editor-state").classList.toggle("pending", unapplied);
    previewPitchTrim = launchTrim(a, mode, environment).controls.pitch;
    controlPreview = new ControlPreview(a);
    renderControlTest(controlPreview);
    const studioTrim = findTrim(a);
    editorSim = new Simulation(a, calmEnvironment(), studioTrim.state);
    editorSim.lastForces = editorSim.forces(
      editorSim.state,
      studioTrim.controls,
    );
    if (page === "aircraft") scene?.setAircraft(a);
  },
  message,
  (part) => {
    editorComponent = part;
    scene?.setComponentInspection(part, componentsWorkspace);
  },
);
editor.onPlaceComponent = (id) => {
  try {
    editor.commitPending();
    if (!scene) throw new Error("3D rendering is unavailable.");
    const wasTesting = input.testBench;
    enableControlTest(false);
    componentPlacer = new ComponentPlacementDialog(
      scene,
      (id, p) => editor.placeComponent(id, p),
      () => {
        enableControlTest(wasTesting);
        scene?.setComponentInspection(editorComponent, componentsWorkspace);
      },
    );
    componentPlacer.open(editor.draft, id);
  } catch (e) {
    message(errorText(e));
  }
};
editor.onPlaceCamera = () => {
  try {
    editor.commitPending();
    if (!scene) throw new Error("3D rendering is unavailable.");
    const wasTesting = input.testBench;
    enableControlTest(false);
    cameraPlacer = new FpvPlacementDialog(
      scene,
      (pose) => editor.placeCamera(pose),
      () => {
        enableControlTest(wasTesting);
        scene?.setComponentInspection(editorComponent, componentsWorkspace);
      },
    );
    cameraPlacer.open(editor.draft);
  } catch (e) {
    message(errorText(e));
  }
};
function enableControlTest(enabled: boolean) {
  $<HTMLInputElement>("test-sticks").checked = enabled;
  input.clear();
  controlPreview.reset();
  previewClock.reset(performance.now());
  input.testBench = enabled && page === "aircraft";
  input.active = page === "fly" || page === "controllers" || input.testBench;
}
$("test-sticks").onchange = () =>
  enableControlTest($<HTMLInputElement>("test-sticks").checked);
setupEditorWorkspace((components, test) => {
  if (test) enableControlTest(true);
  componentsWorkspace = components;
  scene?.setComponentInspection(editorComponent, components);
});
function route() {
  cameraPlacer?.close(false);
  componentPlacer?.close(false);
  positioning.close(false);
  let next = location.hash.replace(/^#\//, "") || "fly";
  if (
    next === "aircraft" &&
    !requireHostAccess({ kind: "workspace", id: next })
  ) {
    next = "fly";
    history.replaceState(null, "", "#/fly");
  }
  window.scrollTo(0, 0);
  page = ["fly", "aircraft", "controllers", "expos"].includes(next)
    ? next
    : "fly";
  pause();
  input.clear();
  input.testBench =
    page === "aircraft" && $<HTMLInputElement>("test-sticks").checked;
  input.active = page === "fly" || page === "controllers" || input.testBench;
  controlPreview.reset();
  previewClock.reset(performance.now());
  for (const id of ["fly", "aircraft", "controllers", "expos"])
    $("page-" + id).hidden = id !== page;
  document.querySelectorAll<HTMLAnchorElement>("[data-route]").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === page);
    if (a.dataset.route === page) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  if (page === "fly") {
    $("flight-stage").append($("viewport"));
    scene?.setStudio(false);
    scene?.setAircraft(sim.aircraft);
    setFlightCamera(flightCamera);
  }
  if (page === "aircraft") {
    previewPitchTrim = launchTrim(editor.draft, mode, environment).controls
      .pitch;
    $("editor-stage").append($("viewport"));
    scene?.setStudio(true);
    scene?.setAircraft(editor.draft);
    scene?.setComponentInspection(editorComponent, componentsWorkspace);
    if (scene) scene.showCG = $<HTMLInputElement>("show-cg").checked;
  }
  if (page === "controllers") controller.refresh();
}
window.addEventListener("hashchange", route);
const positioning = placementUI({
  get: () => {
    const forward = rotate(sim.state.orientation, [1, 0, 0]);
    return {
      mode,
      position: sim.state.position,
      headingDeg:
        ((Math.atan2(forward[1], forward[0]) * 180) / Math.PI + 360) % 360,
      pilot: scene?.pilotMapPosition ?? { x: -8, z: -14 },
      pilotHeadingDeg: scene?.pilotHeadingDeg ?? 0,
      camera: scene?.mode ?? "ground",
      surface:
        sceneries[(environment.sceneryId ?? DEFAULT_SCENERY) as SceneryId]
          .surface,
    };
  },
  apply: (p) => {
    placement = p;
    reset();
  },
  defaults: () => {
    const state = launchState(physicalAircraft(), mode, environment);
    return {
      northM: state.position[0],
      eastM: state.position[1],
      altitudeM: Math.max(0.3, -state.position[2]),
      headingDeg: 0,
    };
  },
  movePilot: (north, east) => {
    scene?.movePilotTo(north, east);
    setFlightCamera("ground");
  },
  pause: () => {
    pause();
    input.clear();
  },
  preview: (p) => scene?.previewPosition(p, mode === "ground"),
  focusView: () => scene?.renderer.domElement.focus(),
});
const updateNavigation = createFlightNavigation(() => {
  if (!positioning.isOpen()) positioning.open();
});
setupTabs($("flight-setup-tabs"), (id) => {
  document
    .querySelectorAll<HTMLElement>("[data-setup-panel]")
    .forEach((panel) => {
      panel.hidden = panel.dataset.setupPanel !== id;
    });
});
$("toggle-flight-setup").onclick = () => {
  positioning.close(false);
  const wasRunning = running;
  if (wasRunning) pause();
  const closed = wasRunning
    ? false
    : !$("page-fly").classList.contains("setup-collapsed");
  $("page-fly").classList.toggle("setup-collapsed", closed);
  $("toggle-flight-setup").setAttribute("aria-expanded", String(!closed));
};
function closeFlightSetup() {
  $("page-fly").classList.add("setup-collapsed");
  $("toggle-flight-setup").setAttribute("aria-expanded", "false");
  scene?.renderer.domElement.focus();
}
$("close-flight-setup").onclick = closeFlightSetup;
document.querySelectorAll<HTMLButtonElement>("[data-controller-tab]").forEach(
  (button) =>
    (button.onclick = () => {
      document.querySelector<HTMLElement>(
        ".controller-layout",
      )!.dataset.section = button.dataset.controllerTab;
      document
        .querySelectorAll<HTMLButtonElement>("[data-controller-tab]")
        .forEach((b) => {
          b.classList.toggle("active", b === button);
          b.setAttribute("aria-pressed", String(b === button));
        });
    }),
);
$("launch").onclick = () => void launch();
$("pause").onclick = () => {
  if (running) {
    pause();
    scene?.renderer.domElement.focus();
  } else void launch();
};
$("reset").onclick = () => {
  positioning.close(false);
  reset();
  scene?.renderer.domElement.focus();
};
document.querySelectorAll<HTMLButtonElement>("[data-launch]").forEach(
  (b) =>
    (b.onclick = () => {
      const next = b.dataset.launch as LaunchMode;
      if (next !== mode && placement) {
        const start = launchState(
          next === "ground" ? fitLandingGear(aircraft) : aircraft,
          next,
          environment,
        );
        placement = {
          ...placement,
          altitudeM: Math.max(0.3, -start.position[2]),
        };
      }
      mode = next;
      reset();
    }),
);
for (const id of ["flight-aircraft", "editor-aircraft"])
  $(id).onchange = () =>
    loadAircraft(
      originals.find((a) => a.id === $<HTMLSelectElement>(id).value)!,
    );
setupCatalog(
  () =>
    originals.map((a) => {
      if (a.id === aircraft.id) return aircraft;
      return savedAircraft(a);
    }),
  () => aircraft.id,
  () => {
    pause();
    input.clear();
  },
  loadAircraft,
);
function applyDraft() {
  if (!requireHostAccess({ kind: "workspace", id: "aircraft" })) return false;
  try {
    editor.commitPending();
    const next = parseAircraft(editor.draft);
    findTrim(next);
    let historyError = "";
    try {
      saveAircraftRevision(next, { kind: "applied", previous: aircraft });
    } catch (e) {
      historyError = errorText(e);
    }
    aircraft = next;
    rememberAircraft(aircraft.id);
    const stored = saveAppliedAircraft(
      aircraft,
      bundledIds.has(aircraft.id) ? undefined : baseline,
    );
    $("editor-state").textContent = "Applied to flight";
    $("editor-state").classList.remove("pending");
    reset();
    if (page === "aircraft") {
      scene?.setStudio(true);
      scene?.setAircraft(editor.draft);
      scene?.setComponentInspection(editorComponent, componentsWorkspace);
    }
    message(
      !stored
        ? "Aircraft applied, but could not be saved locally. Export JSON to keep your changes."
        : historyError
          ? `Aircraft applied. History could not be saved: ${historyError} Export JSON to keep a backup.`
          : "Aircraft saved locally with a version and applied to flight.",
      !stored || Boolean(historyError),
    );
    return true;
  } catch (e) {
    message(errorText(e), true);
    return false;
  }
}
$("save-aircraft").onclick = () => {
  applyDraft();
};
$("apply-and-fly").onclick = () => {
  if (applyDraft()) location.hash = "/fly";
};
setupAircraftHistory({
  getDraft: () => {
    editor.commitPending();
    return editor.draft;
  },
  getApplied: () => aircraft,
  restore: (snapshot) => editor.set(snapshot),
  notify: message,
});
$("restore-aircraft").onclick = () => {
  try {
    // A deliberate reset can also recover from invalid, uncommitted input.
    if (!sameAircraft(editor.draft, baseline))
      saveAircraftRevision(editor.draft, {
        name: "Before restoring original",
        previous: aircraft,
      });
    editor.set(baseline);
    message("Original restored to draft. Apply to flight when ready.");
  } catch (e) {
    message(errorText(e), true);
  }
};
$("export-aircraft").onclick = () => {
  try {
    editor.commitPending();
    download(editor.draft.id + ".json", JSON.stringify(editor.draft, null, 2));
  } catch (e) {
    message(errorText(e), true);
  }
};
$("import-aircraft-button").onclick = () => $("import-aircraft").click();
$<HTMLInputElement>("import-aircraft").onchange = async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file || !requireHostAccess({ kind: "workspace", id: "aircraft" }))
    return;
  try {
    if (file.size > MAX_HISTORY_BYTES)
      throw new Error("Import exceeds the 1.8 MB limit.");
    const text = await file.text(),
      data: unknown = JSON.parse(text);
    if (!requireHostAccess({ kind: "workspace", id: "aircraft" })) return;
    const archive =
      data &&
      typeof data === "object" &&
      "format" in data &&
      typeof data.format === "string" &&
      /(^|-)aircraft-history$/.test(data.format)
        ? parseAircraftHistory(text)
        : undefined;
    if (archive && !archive.entries.length)
      throw new Error("This history has no aircraft versions to import.");
    if (!archive && file.size > 1_000_000)
      throw new Error("Aircraft file exceeds 1 MB.");
    const a = archive ? archive.entries.at(-1)!.aircraft : parseAircraft(data);
    findTrim(a);
    if (!sameAircraft(editor.draft, aircraft))
      saveAircraftRevision(editor.draft, {
        name: "Before importing aircraft",
        previous: aircraft,
      });
    if (archive) importAircraftHistory(text);
    const source = archive?.entries[0].aircraft ?? a;
    const index = originals.findIndex((v) => v.id === a.id);
    if (index < 0) originals.push(source);
    else if (!bundledIds.has(a.id)) originals[index] = source;
    baseline = originals.find((v) => v.id === a.id) ?? source;
    aircraft = structuredClone(a);
    editor.set(a);
    fillSelects();
    reset();
    scene?.setStudio(true);
    scene?.setAircraft(a);
    message(
      archive
        ? "History imported. Latest backup version opened for review; Apply to flight to save this aircraft locally."
        : "Aircraft imported for this session. Apply to flight to save it locally; export JSON to keep a file.",
    );
  } catch (e) {
    message(errorText(e), true);
  }
  (e.target as HTMLInputElement).value = "";
};
const windDirectionLabel = (deg: number) =>
  `${deg}° ${
    deg === 0
      ? "headwind"
      : deg === 180
        ? "tailwind"
        : deg === 90 || deg === 270
          ? "crosswind"
          : deg < 90 || deg > 270
            ? "quartering head"
            : "quartering tail"
  }`;
$("wind-direction").oninput = () => {
  $("wind-direction-value").textContent = windDirectionLabel(
    Number($<HTMLInputElement>("wind-direction").value),
  );
};
/** Discrete-gust settings from the Field panel. */
function gustSettings() {
  const perMinute = Number($<HTMLInputElement>("gust-rate").value),
    peak = Number($<HTMLInputElement>("gust-strength").value);
  // A zero interval disables automatic gusts; the peak still sizes manual ones.
  return {
    meanIntervalS: perMinute > 0 ? 60 / perMinute : 0,
    amplitudeMps: peak,
  };
}
const gustRateLabel = (perMinute: number) =>
  perMinute > 0 ? `${perMinute.toFixed(1)}/min` : "off";
$("gust-rate").oninput = () => {
  $("gust-rate-value").textContent = gustRateLabel(
    Number($<HTMLInputElement>("gust-rate").value),
  );
};
$("gust-strength").oninput = () => {
  $("gust-strength-value").textContent =
    `${Number($<HTMLInputElement>("gust-strength").value).toFixed(1)} m/s`;
};
/** Queue a one-shot discrete gust; it is recorded with the next control frame. */
function triggerGust() {
  if (!running || replay) {
    message("Start flying to trigger a gust.");
    return;
  }
  gustRequested = true;
}
$("trigger-gust").onclick = triggerGust;
$("turbulence-intensity").oninput = () => {
  $("turbulence-intensity-value").textContent =
    `${Number($<HTMLInputElement>("turbulence-intensity").value).toFixed(1)}×`;
};
for (const id of [
  "wind-speed",
  "wind-direction",
  "gusts",
  "turbulence",
  "turbulence-intensity",
  "wind-gradient",
  "gust-rate",
  "gust-strength",
])
  $(id).onchange = () => {
    const speed = Number($<HTMLInputElement>("wind-speed").value),
      angle =
        (Number($<HTMLInputElement>("wind-direction").value) * Math.PI) / 180;
    const turbulent = $<HTMLInputElement>("turbulence").checked;
    $<HTMLInputElement>("turbulence-intensity").disabled = !turbulent;
    if (!Number.isFinite(speed) || speed < 0 || speed > 12) {
      message("Wind speed must be between 0 and 12 m/s.");
      return;
    }
    environment = {
      ...environment,
      windMps: [-speed * Math.cos(angle), speed * Math.sin(angle), 0],
      gustMps: $<HTMLInputElement>("gusts").checked ? 1 : 0,
      turbulence: turbulent ? "dryden" : undefined,
      turbulenceIntensity: turbulent
        ? Number($<HTMLInputElement>("turbulence-intensity").value)
        : undefined,
      windProfile: $<HTMLInputElement>("wind-gradient").checked
        ? defaultWindProfile()
        : undefined,
      discreteGusts: gustSettings(),
    };
    reset();
  };
function setFlightCamera(camera: FlightCamera) {
  flightCamera = camera;
  if (camera !== "ground") {
    input.walking = false;
    if (scene) scene.walking = false;
    $<HTMLInputElement>("walk-mode").checked = false;
  }
  $("locate-aircraft").hidden = camera === "fpv";
  osd.active = osdShown(true, camera);
  $("aircraft-locator").hidden = true;
  locatorUntil = 0;
  scene?.setCamera(camera);
  document
    .querySelectorAll<HTMLButtonElement>("[data-camera]")
    .forEach((button) => {
      const selected = button.dataset.camera === camera;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  $("camera-description").textContent =
    camera === "fpv"
      ? `Onboard FPV · ${sim.aircraft.fpv?.fovDeg ?? sim.aircraft.viewpoint?.fovDeg ?? 90}° vertical view`
      : "Pilot view · eye height 1.7 m";
}
function cycleFlightCamera() {
  setFlightCamera(flightCamera === "fpv" ? "ground" : "fpv");
}
function openFpvEditor() {
  if (!requireHostAccess({ kind: "workspace", id: "aircraft" })) return;
  pause();
  location.hash = "#/aircraft";
  route();
  editor.editFpv();
}
function locateAircraft() {
  if (flightCamera === "fpv") setFlightCamera("ground");
  if (!scene) return;
  scene.locateAircraft();
  $<HTMLInputElement>("track-plane").checked = true;
  locatorUntil = performance.now() + 5000;
  scene.renderer.domElement.focus();
}
$("locate-aircraft").onclick = locateAircraft;
document
  .querySelectorAll<HTMLButtonElement>("[data-camera]")
  .forEach((button) => {
    button.onclick = (event) => {
      setFlightCamera(button.dataset.camera as FlightCamera);
      // Pointer users can keep flying immediately; keyboard activation keeps native focus.
      if (event.detail > 0) scene?.renderer.domElement.focus();
    };
  });
document.querySelectorAll<HTMLButtonElement>("[data-inspect]").forEach(
  (b) =>
    (b.onclick = () => {
      scene?.setInspectionView(
        b.dataset.inspect as "top" | "side" | "perspective",
      );
      document
        .querySelectorAll<HTMLButtonElement>("[data-inspect]")
        .forEach((v) => v.classList.toggle("active", v === b));
    }),
);
$("walk-mode").onchange = () => {
  input.walking = $<HTMLInputElement>("walk-mode").checked;
  if (scene) scene.walking = input.walking;
  input.clear();
};
$("focus-plane").onchange = () => {
  if (scene) scene.focusAircraft = $<HTMLInputElement>("focus-plane").checked;
};
$("track-plane").onchange = () => {
  if (scene) scene.trackAircraft = $<HTMLInputElement>("track-plane").checked;
};
$("show-cg").onchange = () => {
  if (scene) scene.showCG = $<HTMLInputElement>("show-cg").checked;
};
$("pilot-fov").oninput = () => {
  if (scene) {
    const value = Number($<HTMLInputElement>("pilot-fov").value);
    if (scene.mode === "ground") scene.pilotFov = value;
  }
};
$("sound").onchange = () =>
  (audio.enabled = $<HTMLInputElement>("sound").checked);
$("throttle").oninput = () =>
  (input.throttle = Number($<HTMLInputElement>("throttle").value) / 100);
$("pitch-trim").oninput = () => {
  pitchTrim = Number($<HTMLInputElement>("pitch-trim").value) / 100;
  $("pitch-trim-value").textContent = Math.round(pitchTrim * 100) + "%";
  updateFlightInfo();
};
$("help-button").onclick = () => {
  pause();
  $<HTMLDialogElement>("help").showModal();
};
$("close-help").onclick = () => $<HTMLDialogElement>("help").close();
window.addEventListener("keydown", (e) => {
  if (e.defaultPrevented) return;
  if (e.code === "Escape" && positioning.isOpen()) {
    e.preventDefault();
    positioning.close();
    return;
  }
  // Esc during an immersive flight pauses and brings the menus back.
  if (page === "fly" && e.code === "Escape" && running) {
    e.preventDefault();
    pause("Paused — Esc.");
    return;
  }
  if (
    page === "fly" &&
    e.code === "Escape" &&
    !document.querySelector("dialog[open]")
  ) {
    e.preventDefault();
    closeFlightSetup();
    return;
  }
  if (page !== "fly" || ownsKeyboard(e.target)) return;
  if (e.code === "KeyF" && !e.repeat) locateAircraft();
  if (e.code === "KeyG" && !e.repeat) {
    const box = $<HTMLInputElement>("physics-debug");
    box.checked = !box.checked;
    setPhysicsDebug(box.checked);
  }
  if (e.code === "KeyV" && !e.repeat) cycleFlightCamera();
  if (e.code === "KeyU" && !e.repeat) triggerGust();
  if (e.code === "KeyO" && !e.repeat) {
    const box = $<HTMLInputElement>("osd-toggle");
    box.checked = !box.checked;
    applyOsdSettings();
  }
  if (e.code === "KeyP" && !e.repeat) {
    e.preventDefault();
    if (running) pause();
    else void launch();
  }
  if (
    !e.repeat &&
    (["KeyI", "KeyJ", "KeyK", "KeyL"].includes(e.code) ||
      (input.walking && ["KeyW", "KeyA", "KeyS", "KeyD"].includes(e.code)))
  )
    scene?.moveObserver(new Set([e.code]), 1 / 30);
  if (e.code === "Enter" && !e.repeat) {
    e.preventDefault();
    if (!running) void launch();
  }
  if (e.code === "KeyX" && false) input.throttle = 0;
  if (e.code === "KeyR" && !e.repeat) {
    positioning.close(false);
    reset();
  }
});
/** Apply the Manisa site's air and surface to the environment. */
function applySite() {
  const id = DEFAULT_SCENERY;
  const site = sceneries[id];
  environment = {
    ...environment,
    sceneryId: id,
    surface: site.surface,
    surfaceZones: true,
    densityKgM3: airDensity(site.temperatureC, site.elevationM),
    kinematicViscosityM2S: airKinematicViscosity(
      site.temperatureC,
      airDensity(site.temperatureC, site.elevationM),
    ),
  };
  reset();
}
function stats() {
  const session = {
    running,
    started,
    status: sim.state.status,
    replay: !!replay,
    replayComplete: !!replay && replayIndex >= replay.frames.length,
    inputReady: false || !!input.selected(),
  };
  const action = flightAction(session);
  const feedback = flightFeedback({
    ...session,
    mode,
    keyboard: false,
    pauseReason,
  });
  $("flight-feedback").dataset.tone = feedback.tone;
  for (const [id, value] of [
    ["flight-cue-title", feedback.title],
    ["flight-cue-detail", feedback.detail],
    ["flight-model-label", sim.aircraft.name],
  ]) {
    if ($(id).textContent !== value) $(id).textContent = value;
  }
  $("flight-cue-detail").hidden = !feedback.detail;
  const hint = false
    ? running
      ? "P"
      : "Enter"
    : controllerActions.hint("toggle");
  for (const id of ["pause", "launch"]) {
    const button = $(id);
    const label = `${action}${hint ? ` <kbd>${escape(hint)}</kbd>` : ""}`;
    if (button.innerHTML !== label) button.innerHTML = label;
    button.setAttribute("aria-label", action);
  }
  $("pause").classList.toggle("primary", !running);
  $("flight-input-status").textContent = false
    ? "Ready · Space raises power, Shift lowers it."
    : input.selected()
      ? "Connected · Check mapping before launch."
      : "No transmitter detected. Connect it by USB and move a stick.";
  const power = powertrain(
    sim.aircraft,
    sim.state.motors,
    sim.state.batterySoc,
    sim.environment.densityKgM3,
  );
  $("battery-telemetry").hidden = !sim.aircraft.battery;
  $("battery-hud").hidden = !sim.aircraft.battery;
  $("battery-hud-soc").textContent = `${(power.soc * 100).toFixed(0)}%`;
  $("battery-hud-voltage").textContent =
    `${power.voltage.toFixed(1)} V · ${power.current.toFixed(1)} A`;
  $("battery-hud").classList.toggle("low-battery", power.soc < 0.2);
  const usage = batteryUsage(sim.aircraft, power.soc, power.current);
  $("battery-hud").title = usage
    ? `${usage.usedMah.toFixed(0)} mAh used · ${usage.remainingMah.toFixed(0)} mAh remaining${usage.minutesToReserve === null ? "" : ` · about ${usage.minutesToReserve.toFixed(1)} min to 20% at this current`}. Model estimate; load changes in flight.`
    : "";
  if (sim.aircraft.battery)
    $("battery-telemetry").textContent =
      `${sim.aircraft.battery.cells}S ${sim.aircraft.battery.chemistry} · ${(power.soc * 100).toFixed(0)}% · ${power.voltage.toFixed(1)} V · ${power.current.toFixed(1)} A · ${usage!.usedMah.toFixed(0)} / ${sim.aircraft.battery.capacityMah} mAh used`;

  const s = sim.state;
  $("speed").textContent = sim.lastForces.airspeed.toFixed(1);
  $("altitude").textContent = (-s.position[2]).toFixed(1);
  $("distance").textContent = Math.hypot(
    s.position[0] - (scene?.pilotPosition.x ?? -8),
    s.position[1] - (scene?.pilotPosition.z ?? -14),
    -s.position[2] - (scene?.pilotPosition.y ?? 1.7),
  ).toFixed(0);
  $("vertical-speed").textContent = (-s.velocity[2]).toFixed(1);
  $("throttle-value").textContent =
    Math.round(
      (running || replay || input.source === "controller"
        ? controls.throttle
        : input.throttle) * 100,
    ) + "%";
  $<HTMLInputElement>("throttle").value = String(
    (running || replay || input.source === "controller"
      ? controls.throttle
      : input.throttle) * 100,
  );
  $("flight-clock").textContent = `${Math.floor(s.time / 60)
    .toString()
    .padStart(2, "0")}:${(s.time % 60).toFixed(1).padStart(4, "0")}`;
  $("flight-status").textContent =
    s.status === "crashed"
      ? "IMPACT"
      : s.status === "landed"
        ? "LANDED"
        : running
          ? replay
            ? "REPLAY"
            : s.status === "grounded"
              ? "GROUND ROLL"
              : "IN FLIGHT"
          : started
            ? "PAUSED"
            : "READY";
  $("stall-warning").hidden =
    !running ||
    s.status !== "flying" ||
    sim.lastForces.airspeed < 3 ||
    !sim.lastForces.surfaces.some((f) => f.kind === "wing" && f.stalled);
  if (scene) {
    const fpv = scene.mode === "fpv",
      slider = $<HTMLInputElement>("pilot-fov");
    slider.disabled = fpv;
    $("view-range-label").textContent = fpv
      ? "FPV lens (set in the aircraft file)"
      : "View angle";
    $("fov-value").textContent = fpv
      ? `${sim.aircraft.fpv?.fovDeg ?? sim.aircraft.viewpoint?.fovDeg ?? 90}°`
      : Math.round(scene.pilotFov) + "°";
    slider.value = String(scene.pilotFov);
  }
}
$("quick-input").onclick = () => {
  positioning.close(false);
  pause();
  $("page-fly").classList.remove("setup-collapsed");
  $("toggle-flight-setup").setAttribute("aria-expanded", "true");
  $<HTMLButtonElement>("setup-tab-input").click();
  $("flight-input-type").focus();
};
$("quick-guide").onclick = () => $("help-button").click();
$("flight-input-type").onchange = () => {
  pause();
  input.clear();
  controller.selectType(
    $<HTMLSelectElement>("flight-input-type")
      .value as import("./app/controllers").InputType,
  );
};
const controllerActions = new ControllerActions(input, (action) => {
  if (
    ["next", "previous", "activate", "decrease", "increase"].includes(action)
  ) {
    navigateSetting(action);
    return;
  }
  if (controller.calibrating || document.querySelector("dialog[open]")) return;
  if (action === "settings") {
    pause();
    location.hash = page === "controllers" ? "#/fly" : "#/controllers";
    return;
  }
  if (page !== "fly" || (positioning.isOpen() && action !== "camera")) return;
  if (action === "reset") reset();
  if (action === "toggle") {
    if (running) pause();
    else void launch();
  }
  if (action === "camera") cycleFlightCamera();
});
let previous = 0,
  lastDraw = 0,
  drawAccumulator = 0,
  lastUI = 0;
function frame(now: number) {
  const dt = Math.min((now - previous) / 1000 || 0, 0.05);
  previous = now;
  try {
    arduino.poll();
    const inputAircraft = page === "aircraft" ? editor.draft : aircraft;
    const turnAxis = keyboardTurnAxis(inputAircraft);
    input.setKeyboardTurnAxis(turnAxis);
    controllerActions.update(document.hasFocus(), {
      turnAxis,
      yaw: aircraftChannels(inputAircraft).includes("yaw"),
      walking: input.walking,
    });
    if (!running && page === "fly" && false && !replay) input.read(dt);
    if (running && page === "fly") {
      // Use the same monotonic clock as launch(): an action can resume flight
      // inside this callback, after its requestAnimationFrame timestamp.
      const timing = flightClock.advance(performance.now());
      if (timing.interrupted) {
        input.clear();
        pause("Flight paused after a long frame delay — resume when ready.");
      }
      for (let step = 0; step < timing.steps && running; step++) {
        if (replay) {
          if (replayIndex >= replay.frames.length) {
            pause();
            message("Replay complete. Begin flight to replay again, or reset.");
            break;
          }
          controls = replay.frames[replayIndex++];
        } else {
          const raw = input.read(FIXED_DT);
          if (!running) break;
          applySwitches(raw);
          // ACRO: centred sticks mean "hold this attitude"; the controller
          // finds the surface trim itself, so the stick trim is not added.
          controls = acroActive()
            ? cleanControls({
                ...applyExpo(raw, expoSettings()),
                fcMode: "acro",
              })
            : cleanControls(
                withTrim(applyExpo(raw, expoSettings()), {
                  roll: lateralTrim.roll,
                  pitch: pitchTrim,
                  yaw: lateralTrim.yaw,
                }),
              );
          if (gustRequested) {
            controls.gust = true;
            gustRequested = false;
          }
        }
        scene?.captureImpactVelocity(sim.state.velocity);
        sim.step(controls);
        if (!replay) {
          recording.frames.push({ ...controls });
          if (recording.frames.length % 12 === 0)
            recording.samples.push(sample(sim, controls));
          if (recording.frames.length >= 36000) {
            pause();
            message("Recording limit reached. Export and reset.");
          }
        }
        if (["crashed", "landed"].includes(sim.state.status)) {
          pause();
        }
      }
    }
    if (page === "aircraft" && input.testBench) {
      const device = input.selected();
      const connected =
        false ||
        (device &&
          device.id === input.profile.deviceId &&
          Object.values(input.profile.bindings).every(
            (b) => b.axis < device.axes.length,
          ));
      previewStatus = !connected
        ? "Controller unavailable. Connect it in Input setup; motors off."
        : false
          ? `${aircraftChannels(editor.draft).includes("roll") ? "Arrow keys: pitch / roll" : "↑ / ↓: pitch · ← / →: rudder"}${aircraftChannels(editor.draft).includes("yaw") ? " · Q / E: yaw" : ""}. Click the model to test. Motors off.`
          : "Live controller · motors off · deflections after rates and servo limits";
      const trim = $<HTMLInputElement>("test-trim").checked
        ? previewPitchTrim
        : 0;
      const timing = previewClock.advance(performance.now());
      if (timing.interrupted) input.clear();
      for (let step = 0; step < timing.steps; step++) {
        const raw =
          connected && document.hasFocus()
            ? input.read(FIXED_DT)
            : { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
        controlPreview.step(raw, expoSettings(), trim);
      }
    } else if (page === "aircraft")
      previewStatus = "Enable Test sticks to move the controls.";
    if (page === "fly") scene?.moveObserver(input.keys, dt);
    const activeView =
      running ||
      (page === "aircraft" && controlPreview.moving) ||
      input.keys.size > 0 ||
      scene?.needsSmoothMotion;
    const renderInterval =
      1000 / (activeView ? 60 : renderBudget.idleFramesPerSecond);
    drawAccumulator += dt * 1000;
    if (drawAccumulator >= renderInterval - 0.5) {
      const viewDt = Math.min((now - lastDraw) / 1000, 0.1);
      if (page === "fly") {
        scene?.render(sim, controls, viewDt);
        updateOsd();
        const target =
          now < locatorUntil
            ? scene?.aircraftScreenPoint(sim.state.position)
            : null;
        $("aircraft-locator").hidden = !target;
        if (target) {
          $("aircraft-locator").style.left = `${target.x}%`;
          $("aircraft-locator").style.top = `${target.y}%`;
          $("locator-distance").textContent = `${target.distance.toFixed(0)} m`;
        }
      } else if (page === "aircraft")
        scene?.render(
          editorSim,
          controlPreview.controls,
          viewDt,
          controlPreview.deflections,
        );
      drawAccumulator =
        Math.max(0, drawAccumulator - renderInterval) % renderInterval;
      lastDraw = now;
    }
    audio.update(
      controls.throttle,
      Math.hypot(
        sim.state.position[0] - (scene?.camera.position.x ?? -8),
        sim.state.position[1] - (scene?.camera.position.z ?? -14),
      ),
      running && page === "fly",
    );
    if (now - lastUI > 100) {
      stats();
      if (page === "aircraft") updateControlTest(controlPreview, previewStatus);
      positioning.update();
      if (page === "fly") {
        updateNavigation(sim.state, scene?.pilotPosition ?? { x: -8, z: -14 });
        setNavigationWind(
          sim.airVelocity(sim.state),
          Math.hypot(...sim.gusts.velocity(sim.state.time)),
        );
        if (!$("physics-debug-panel").hidden) {
          energyGraph.push(sim);
          energyGraph.draw();
          const rotorLines = rotorDebugLines(sim);
          $("rotor-debug").hidden = !rotorLines.length;
          $("rotor-debug").textContent = rotorLines.join("\n");
        }
      }
      const hardware = input.source === "controller";
      const source = "RC transmitter";
      $("quick-input").textContent =
        `${source}${hardware && !input.selected() ? " · disconnected" : ""} ▾`;
      $("quick-input").classList.toggle(
        "input-offline",
        hardware && !input.selected(),
      );
      const editingControls =
        !hardware && running && ownsKeyboard(document.activeElement);
      const bindings = editingControls
        ? '<span class="power-hint">Editing controls · <kbd>Esc</kbd> back to flight</span>'
        : hardware
          ? !input.selected()
            ? "<span>Connect your transmitter by USB and move a stick.</span>"
            : aircraftChannels(aircraft)
                .map(
                  (ch) =>
                    `<span><kbd>A${input.profile.bindings[ch].axis + 1}</kbd> ${ch}</span>`,
                )
                .join("")
          : aircraftChannels(aircraft)
              .map(
                (ch) =>
                  ({
                    pitch: "<span><kbd>↑ ↓</kbd> Pitch</span>",
                    roll: "<span><kbd>← →</kbd> Roll</span>",
                    yaw:
                      keyboardTurnAxis(aircraft) === "yaw"
                        ? "<span><kbd>← →</kbd> / <kbd>Q E</kbd> Rudder</span>"
                        : "<span><kbd>Q E</kbd> Yaw</span>",
                    throttle:
                      '<span class="power-hint"><kbd>Space</kbd> Power + <kbd>Shift</kbd> −</span>',
                  })[ch],
              )
              .join("");
      if ($("flight-input-guide").innerHTML !== bindings)
        $("flight-input-guide").innerHTML = bindings;
      const resetHint = hardware ? controllerActions.hint("reset") : "R";
      const resetLabel = `Reset${resetHint ? ` <kbd>${escape(resetHint)}</kbd>` : ""}`;
      if ($("reset").innerHTML !== resetLabel)
        $("reset").innerHTML = resetLabel;
      $("reset").setAttribute("aria-label", "Reset flight");
      if (page === "controllers") controller.update();
      suggestRecalibration();
      lastUI = now;
    }
  } catch (e) {
    pause();
    message(errorText(e), true);
  }
  // The first drawn frame ends the loading screen.
  bootDone();
  requestAnimationFrame(frame);
}
try {
  bootProgress(0.7, "Building the Manisa field…");
  scene = new FlightScene($("viewport"));
  // Development-only handle for scripted screenshots and inspection.
  if (import.meta.env.DEV)
    Object.assign(window, {
      __sim: {
        get scene() {
          return scene;
        },
        get sim() {
          return sim;
        },
      },
    });
  const applyTheme = () =>
    scene?.setTheme(document.documentElement.dataset.theme === "light");
  applyTheme();
  window.addEventListener("app-themechange", applyTheme);
  scene.onInspectionView = (view) => {
    cameraPlacer?.inspectionView(view);
    document
      .querySelectorAll<HTMLButtonElement>("[data-inspect]")
      .forEach((button) => {
        const selected = button.dataset.inspect === view;
        button.classList.toggle("active", selected);
        button.setAttribute("aria-pressed", String(selected));
      });
  };
  scene.onGroundPick = (north, east) => positioning.pickGround(north, east);
} catch (e) {
  message("3D rendering unavailable: " + errorText(e), true);
}
fillSelects();
loadAircraft(baseline);
applySite();
// Start beside the parked aircraft, before the first rendered frame.
scene?.pilotPosition.set(
  sim.state.position[0] - 2,
  1.7,
  sim.state.position[1] - 3,
);
route();
controller.selectType("transmitter");
requestAnimationFrame(frame);

// Access changes pause immediately and retain drafts/history; never silently resume.
onHostAccessChange(() => {
  pause("Account access changed — resume when ready.");
  input.clear();
  if (!hostAllows({ kind: "input", id: controller.type })) {
    void arduino.disconnect();
  }
  if (!hostAllows({ kind: "workspace", id: "aircraft" })) {
    const available = originals.filter((a) =>
      hostAllows({ kind: "aircraft", id: a.id }),
    );
    if (available.length) loadAircraft(available[0]);
  }
  fillSelects();
  // Losing access is a state change, not a fresh request to sign in.
  const requestedPage = location.hash.replace(/^#\//, "");
  if (
    requestedPage === "aircraft" &&
    !hostAllows({ kind: "workspace", id: requestedPage })
  )
    history.replaceState(null, "", "#/fly");
  route();
});
mountHost({
  prepareToLeave() {
    pause();
    input.clear();
    try {
      if (hostAllows({ kind: "workspace", id: "aircraft" })) {
        editor.commitPending();
        if (!sameAircraft(editor.draft, aircraft))
          saveAircraftRevision(editor.draft, {
            name: "Before account change",
            previous: aircraft,
          });
      }
      return true;
    } catch (error) {
      message("Keep your work before continuing: " + errorText(error), true);
      return false;
    }
  },
  open(request) {
    if (request.kind === "aircraft") {
      const model = originals.find((a) => a.id === request.id);
      if (model) loadAircraft(model);
      location.hash = "/fly";
    } else if (request.kind === "input") {
      location.hash = "/controllers";
      if (
        ["keyboard", "gamepad", "joystick", "transmitter"].includes(request.id)
      )
        controller.selectType(request.id as typeof controller.type);
    } else location.hash = "/" + request.id;
  },
});
// First visit, or no calibration saved yet: open the transmitter wizard.
if (shouldOpenWizard(setupState, hasSavedCalibration())) wizard.open();
