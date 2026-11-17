import { landscapeSurfaceHeight } from "./landscape";
import { ImpactDebris } from "./impact-debris";
import { focusedPilotFov } from "./pilot-focus";
import { ComponentPlacementView } from "./component-placement";
import { fpvMount, placeFpvCamera } from "./fpv-camera";
import { powertrain } from "../core/powertrain";
import { sceneries, type Scenery, type SceneryId } from "../core/scenery";
import { surfaceCommand } from "../core/surface-control";
import * as T from "three";
import { PhysicsDebugArrows } from "./physics-debug";
import type { Aircraft } from "../core/schema";
import type { Simulation, Controls } from "../core/simulation";
import { massProperties } from "../core/aircraft";
import { type Vec3 } from "../core/math";
import { buildAircraft, disposeAircraft, type AircraftVisual } from "./model";
import { createField } from "./field";
import type { Placement } from "../core/placement";
import { renderBudget } from "./render-budget";
import { RenderEngine, type RenderSettings } from "../render/engine";
import { lodLevel } from "../render/quality";
import { QUALITY_PRESETS, RENDER_CONFIG } from "../render/render-config";
import type { RenderSnapshot } from "../render/interpolation";
import { propellerDiscs, upgradeAircraftMaterials } from "../render/materials";
import { followAircraftShadow } from "./aircraft-shadow";
import {
  fitInspectionCamera,
  inspectionDistance,
  type InspectionView,
} from "./inspection-camera";
import { ComponentFocus } from "./component-focus";
import { CameraPlacementView } from "./camera-placement";
const studioSun: [number, number, number] = [-3, 6, 4];
const toWorld = (v: Vec3) => new T.Vector3(v[0], -v[2], v[1]);
const conversion = new T.Quaternion().setFromAxisAngle(
  new T.Vector3(1, 0, 0),
  Math.PI / 2,
);
/** Flight cameras: pilot on the ground and the aircraft's FPV; orbit is the editor. */
export type CameraMode = "ground" | "fpv" | "orbit";
/** Fixed physical pilot position; head tracking uses bounded optical focus at distance. */
export class FlightScene {
  renderer: T.WebGLRenderer;
  /** The render layer (sky, IBL, shadows, fog, post, quality). */
  readonly engine: RenderEngine;
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(
    55,
    1,
    RENDER_CONFIG.camera.pilotNear,
    RENDER_CONFIG.camera.far,
  );
  private discs?: ReturnType<typeof propellerDiscs>;
  /** Aircraft level of detail (render/quality `lodLevel`); 2 = far. */
  private aircraftLod = 0;
  private drawingCamera = new T.OrthographicCamera();
  private inspectionView: InspectionView = "perspective";
  private modelSize = new T.Vector3(1, 1, 1);
  private modelCenter = new T.Vector3();
  private componentFocus = new ComponentFocus();
  private componentFocusLabel = document.createElement("div");
  private selectedComponent?: Aircraft["parts"][number];
  private inspectComponents = false;
  private cameraPlacement?: CameraPlacementView;
  private componentPlacement?: ComponentPlacementView;
  private componentInspection?: InspectionView;
  private savedInspection?: {
    view: InspectionView;
    yaw: number;
    pitch: number;
    zoom: number;
  };
  onInspectionView?: (view: InspectionView) => void;
  mode: CameraMode = "ground";
  showForces = false;
  showCG = false;
  pilotFov = 55;
  walking = false;
  trackAircraft = true;
  focusAircraft = true;
  private lookYaw = 0;
  private lookPitch = 0;
  readonly pilotPosition = new T.Vector3(-8, 1.7, -14);
  private pilotDestination: T.Vector3 | null = null;
  private placementMarker = new T.Group();
  private placementArrow = new T.ArrowHelper(
    new T.Vector3(1, 0, 0),
    new T.Vector3(),
    2,
    0xe9b567,
    0.35,
    0.18,
  );
  private placementRing = new T.Mesh(
    new T.RingGeometry(1.1, 1.18, 48),
    new T.MeshBasicMaterial({
      color: 0xe9b567,
      side: T.DoubleSide,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    }),
  );
  onGroundPick?: (north: number, east: number) => void;
  private visual?: AircraftVisual;
  private debris = new ImpactDebris((x, z) =>
    Math.max(0, landscapeSurfaceHeight(x, z, sceneries[this.scenery])),
  );
  private impactVelocity = new T.Vector3();
  private focusFov = 55;
  private fpv?: ReturnType<typeof fpvMount>;
  private cg: Vec3 = [0, 0, 0];
  private span = 1.086;
  private shadowRadius = 1;
  private studio = false;
  private axisGuide = document.createElement("div");
  private scenery: SceneryId = "manisa";
  private sun = new T.DirectionalLight();
  private hemisphere = new T.HemisphereLight("#d6e3f1", "#788266", 2.1);
  private studioFloorHeight = -0.27;
  private field: ReturnType<typeof createField>;
  private studioGroup = new T.Group();
  private lightTheme = false;
  private arrows: T.ArrowHelper[] = [];
  private forces = new T.Group();
  /** Physics debug overlay: total force and velocity arrows at the CG. */
  readonly physicsDebug = new PhysicsDebugArrows();
  private physicsDebugEnabled = false;
  private orbitYaw = 0.65;
  private orbitPitch = 0.35;
  private orbitZoom = 1;
  private dragging = false;
  private snap = true;
  private heading = new T.Vector3(0, 0, 1);
  private observer: ResizeObserver;
  constructor(private container: HTMLElement) {
    this.engine = new RenderEngine(container);
    this.renderer = this.engine.renderer;
    const canvas = this.renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "Interactive 3D aircraft view");
    this.axisGuide.className = "axis-guide";
    this.axisGuide.setAttribute(
      "aria-label",
      "Aircraft axes: X forward, Y right, Z down",
    );
    this.axisGuide.innerHTML = `<svg viewBox="0 0 146 86" role="img" aria-label="Aircraft orientation axes">${["X", "Y", "Z"].map((a, i) => `<g stroke="${["#ef8c84", "#a7d08d", "#8ebfec"][i]}"><line id="axis-line-${a}" x1="73" y1="43"/><text id="axis-text-${a}" fill="${["#ef8c84", "#a7d08d", "#8ebfec"][i]}" stroke="none">${a}</text></g>`).join("")}<circle cx="73" cy="43" r="2" fill="#dce4e8"/></svg><small>X Forward · Y Right · Z Down</small>`;
    container.append(this.axisGuide);
    this.componentFocusLabel.className = "component-focus-label";
    this.componentFocusLabel.hidden = true;
    container.append(this.componentFocusLabel);
    this.scene.add(this.componentFocus.group);
    this.scene.add(this.hemisphere);
    const sun = (this.sun = new T.DirectionalLight("#fff4dc", 3.2));
    sun.position.set(25, 60, -35);
    sun.castShadow = true;
    sun.shadow.mapSize.set(renderBudget.shadowSize, renderBudget.shadowSize);
    sun.shadow.normalBias = 0.006;
    this.scene.add(sun, sun.target);
    this.field = createField(this.scene);
    this.engine.onQualityChange = (level) =>
      this.field.grass.setDensity(QUALITY_PRESETS[level].grassDensity);
    this.scene.add(
      this.forces,
      this.studioGroup,
      this.debris.group,
      this.physicsDebug.group,
    );
    this.placementMarker.visible = false;
    this.placementRing.rotation.x = -Math.PI / 2;
    this.placementMarker.add(this.placementRing, this.placementArrow);
    this.scene.add(this.placementMarker);
    const floor = new T.Mesh(
      new T.PlaneGeometry(200, 200),
      new T.MeshStandardMaterial({ color: "#252627", roughness: 0.94 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.27;
    floor.receiveShadow = true;
    this.studioGroup.add(floor);
    const grid = new T.GridHelper(8, 40, "#44474a", "#2e3134");
    grid.position.y = -0.268;
    this.studioGroup.add(grid);
    canvas.addEventListener("pointerdown", (e) => {
      if (
        this.cameraPlacement?.pointerDown(e) ||
        this.componentPlacement?.pointerDown(e)
      )
        return;
      if (this.mode === "orbit" || this.mode === "ground") {
        this.dragging = true;
        canvas.setPointerCapture(e.pointerId);
      }
    });
    canvas.addEventListener("pointermove", (e) => {
      if (
        this.componentPlacement?.dragging ||
        this.cameraPlacement?.dragging ||
        this.componentPlacement?.dragging
      )
        return;
      // Capture can be lost to a panel, tab switch or system gesture without pointerup.
      if (e.buttons === 0) this.dragging = false;
      if (this.dragging && this.mode === "ground") {
        this.lookYaw -= e.movementX * 0.004;
        this.lookPitch = T.MathUtils.clamp(
          this.lookPitch - e.movementY * 0.004,
          -1.2,
          1.2,
        );
      }
      if (this.dragging && this.mode === "orbit") {
        if (
          this.inspectionView !== "perspective" &&
          (e.movementX || e.movementY)
        ) {
          this.inspectionView = "perspective";
          this.onInspectionView?.("perspective");
        }
        this.orbitYaw -= e.movementX * 0.006;
        this.orbitPitch = T.MathUtils.clamp(
          this.orbitPitch + e.movementY * 0.004,
          -0.08,
          1.35,
        );
      }
    });
    canvas.addEventListener("pointerup", () => (this.dragging = false));
    canvas.addEventListener("pointercancel", () => (this.dragging = false));
    canvas.addEventListener(
      "lostpointercapture",
      () => (this.dragging = false),
    );
    canvas.addEventListener("dblclick", (e) => {
      if (this.studio || !this.onGroundPick) return;
      const rect = canvas.getBoundingClientRect();
      const ray = new T.Raycaster();
      ray.setFromCamera(
        new T.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          1 - ((e.clientY - rect.top) / rect.height) * 2,
        ),
        this.camera,
      );
      const point = ray.ray.intersectPlane(
        new T.Plane(new T.Vector3(0, 1, 0), 0),
        new T.Vector3(),
      );
      if (point) this.onGroundPick(point.x, point.z);
    });
    canvas.addEventListener("contextmenu", (e) => {
      if (this.cameraPlacement) e.preventDefault();
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (this.mode === "orbit")
          this.orbitZoom = T.MathUtils.clamp(
            this.orbitZoom + e.deltaY * 0.001,
            0.45,
            2.4,
          );
        else if (this.mode === "ground")
          this.pilotFov = T.MathUtils.clamp(
            this.pilotFov + e.deltaY * 0.025,
            20,
            80,
          );
      },
      { passive: false },
    );
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    this.engine.attach(
      this.scene,
      this.camera,
      this.engine.settings,
      sceneries[this.scenery].headingOffsetDeg ?? 0,
    );
    this.updateStudioBackground();
  }
  /** Graphics settings (quality, time of day); never part of a recording. */
  setRenderSettings(settings: RenderSettings) {
    this.engine.setSettings(settings);
    this.updateStudioBackground();
  }
  get needsSmoothMotion() {
    return (
      this.debris.moving ||
      this.dragging ||
      this.componentPlacement?.dragging ||
      this.cameraPlacement?.dragging ||
      !!this.pilotDestination ||
      Math.abs(this.lookYaw) + Math.abs(this.lookPitch) > 0.002
    );
  }
  private resize() {
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    if (!w || !h) return;
    this.engine.resize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  /**
   * Far away (LOD 2) the aircraft's shadow is under a pixel: it stops casting
   * so its meshes leave every shadow cascade's draw list.
   */
  private setAircraftLod(level: number) {
    if (!this.visual || level === this.aircraftLod) return;
    const far = level >= 2,
      wasFar = this.aircraftLod >= 2;
    this.aircraftLod = level;
    if (far === wasFar) return;
    this.visual.group.traverse((o) => {
      const mesh = o as T.Mesh;
      if (!mesh.isMesh) return;
      if (far) {
        mesh.userData.lodCastShadow = mesh.castShadow;
        mesh.castShadow = false;
      } else if (typeof mesh.userData.lodCastShadow === "boolean")
        mesh.castShadow = mesh.userData.lodCastShadow;
    });
  }

  private disposeVisual() {
    this.debris.clear();
    this.impactVelocity.set(0, 0, 0);
    this.discs?.dispose();
    this.discs = undefined;
    this.aircraftLod = 0;
    if (!this.visual) return;
    this.scene.remove(this.visual.group);
    disposeAircraft(this.visual.group);
  }
  setAircraft(a: Aircraft, editablePartId?: string) {
    this.endComponentPlacement();
    this.endCameraPlacement();
    this.disposeVisual();
    this.visual = buildAircraft(a, editablePartId);
    upgradeAircraftMaterials(this.visual.group);
    this.discs = propellerDiscs(
      this.visual.propellers,
      a.motors.map((m) => m.propDiameterM),
    );
    this.scene.add(this.visual.group);
    this.engine.prepare(this.scene);
    const bounds = new T.Box3().setFromObject(this.visual.group);
    this.shadowRadius =
      Math.max(bounds.min.length(), bounds.max.length()) + 0.25;
    this.cg = massProperties(a).cg;
    this.fpv = fpvMount(a, this.cg);
    this.setComponentInspection(
      a.parts.find((p) => p.id === this.selectedComponent?.id),
      this.inspectComponents,
    );
    // The rotor diagonal excludes propeller tips; frame the full rendered model.
    const size = bounds.getSize(new T.Vector3());
    this.modelSize.copy(size);
    const center = bounds.getCenter(new T.Vector3());
    this.modelCenter.set(center.x, -center.z, center.y);
    this.studioFloorHeight = -bounds.max.z - 0.02;
    this.studioGroup.children[0].position.y = this.studioFloorHeight;
    this.studioGroup.children[1].position.y = this.studioFloorHeight + 0.002;
    this.span = Math.max(a.reference.spanM, size.x, size.y, size.z);
    this.arrows.forEach((arrow) => arrow.dispose());
    this.forces.clear();
    this.arrows = a.surfaces.map(() => {
      const arrow = new T.ArrowHelper(
        new T.Vector3(0, 1, 0),
        new T.Vector3(),
        0.1,
        0xf3bb68,
        0.02,
        0.01,
      );
      this.forces.add(arrow);
      return arrow;
    });
    this.snap = true;
  }
  setComponentInspection(
    part: Aircraft["parts"][number] | undefined,
    active: boolean,
  ) {
    this.selectedComponent = part;
    this.inspectComponents = active;
    this.componentFocus.set(part, this.cg);
    this.componentFocusLabel.textContent = part
      ? `${part.id.replaceAll("-", " ")} · ${(part.massKg * 1000).toFixed(1)} g · installation envelope`
      : "";
  }
  beginComponentPlacement(a: Aircraft, partId: string) {
    if (!this.studio || !this.visual)
      throw new Error("Open the aircraft editor first.");
    this.endCameraPlacement();
    this.endComponentPlacement();
    this.setAircraft(a, partId);
    this.componentInspection = this.inspectionView;
    this.setInspectionView("perspective");
    this.componentPlacement = new ComponentPlacementView(
      this.scene,
      this.renderer.domElement,
      this.camera,
      this.visual,
      a,
      partId,
    );
    return this.componentPlacement;
  }
  endComponentPlacement() {
    this.componentPlacement?.dispose();
    this.componentPlacement = undefined;
    if (this.componentInspection)
      this.setInspectionView(this.componentInspection);
    this.componentInspection = undefined;
  }
  beginCameraPlacement(a: Aircraft) {
    this.endComponentPlacement();
    if (!this.studio || !this.visual || !a.fpv)
      throw new Error(
        "Open an aircraft with an FPV camera in the editor first.",
      );
    this.endCameraPlacement();
    this.savedInspection = {
      view: this.inspectionView,
      yaw: this.orbitYaw,
      pitch: this.orbitPitch,
      zoom: this.orbitZoom,
    };
    this.setInspectionView("perspective");
    this.orbitZoom = 0.9;
    this.cameraPlacement = new CameraPlacementView(
      this.scene,
      this.renderer,
      this.camera,
      this.visual,
      a,
      this.cg,
      this.container,
    );
    return this.cameraPlacement;
  }
  endCameraPlacement() {
    this.cameraPlacement?.dispose();
    this.cameraPlacement = undefined;
    if (this.savedInspection) {
      const saved = this.savedInspection;
      this.setInspectionView(saved.view);
      this.orbitYaw = saved.yaw;
      this.orbitPitch = saved.pitch;
      this.orbitZoom = saved.zoom;
      this.savedInspection = undefined;
    }
    this.dragging = false;
  }
  setCamera(mode: CameraMode) {
    this.mode = mode === "fpv" && !this.fpv ? "ground" : mode;
    this.dragging = false;
    this.snap = true;
  }
  locateAircraft() {
    this.trackAircraft = true;
    this.lookYaw = this.lookPitch = 0;
    this.snap = true;
  }
  aircraftScreenPoint(position: Vec3) {
    const point = toWorld(position);
    const distance = point.distanceTo(this.camera.position);
    point.project(this.camera);
    if (
      point.z < -1 ||
      point.z > 1 ||
      Math.abs(point.x) > 1 ||
      Math.abs(point.y) > 1
    )
      return null;
    return { x: (point.x + 1) * 50, y: (1 - point.y) * 50, distance };
  }
  /** Development only: render from a fixed scene-space viewpoint. */
  debugView?: {
    position: [number, number, number];
    target: [number, number, number];
    fov?: number;
  };
  get fieldObstacles() {
    return this.field.obstacles;
  }
  /** Show per-surface loads plus total force/velocity arrows (rendering only). */
  setPhysicsDebug(on: boolean) {
    this.physicsDebugEnabled = on;
    this.showForces = on;
  }
  /** Manisa is the only site: the field is built once; this applies its light. */
  setScenery(id: SceneryId) {
    this.scenery = id;
    const p: Scenery = sceneries[id];
    this.sun.position.set(...p.sun);
    this.sun.color.set(p.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.setStudio(this.studio);
  }
  setTheme(light: boolean) {
    this.lightTheme = light;
    const floor = this.studioGroup.children[0] as T.Mesh<
      T.PlaneGeometry,
      T.MeshStandardMaterial
    >;
    floor.material.color.set(light ? "#c6cdd4" : "#252627");
    const grid = this.studioGroup.children[1] as T.GridHelper;
    const colors = grid.geometry.getAttribute("color");
    const central = new T.Color(light ? "#939fa9" : "#44474a");
    const ordinary = new T.Color(light ? "#b0b9c2" : "#2e3134");
    for (let i = 0; i < colors.count; i++) {
      const color = Math.floor(i / 4) === 20 ? central : ordinary;
      colors.setXYZ(i, color.r, color.g, color.b);
    }
    colors.needsUpdate = true;
    for (const material of Array.isArray(grid.material)
      ? grid.material
      : [grid.material]) {
      material.transparent = light;
      material.opacity = light ? 0.45 : 1;
      material.depthWrite = !light;
      material.needsUpdate = true;
    }
    this.updateStudioBackground();
  }
  private updateStudioBackground() {
    const color = this.lightTheme ? "#e2e7ed" : "#1d2024";
    this.scene.background = this.studio ? new T.Color(color) : null;
    this.scene.fog = this.studio ? new T.Fog(color, 8, 50) : this.engine.fog();
  }
  setStudio(value: boolean) {
    this.studio = value;
    this.field.field.visible = !value;
    this.debris.group.visible = !value;
    this.engine.setStudio(value);
    // The flight scene is lit by the engine's cascaded sun and sky IBL.
    this.sun.visible = value;
    this.studioGroup.visible = value;
    const site = sceneries[this.scenery];
    this.sun.color.set(value ? "#ffffff" : site.sunColor);
    this.sun.intensity = value ? 2.6 : site.sunIntensity;
    this.sun.shadow.intensity = value ? 0.45 : 1;
    this.sun.shadow.normalBias = value ? 0.001 : 0.006;
    this.hemisphere.color.set(value ? "#e7edf5" : "#d6e3f1");
    this.hemisphere.groundColor.set(value ? "#73777d" : "#596348");
    this.hemisphere.intensity = value ? 3 : 0.35;
    this.updateStudioBackground();
    if (value) this.setCamera("orbit");
    this.resize();
  }
  setInspectionView(view: InspectionView) {
    this.dragging = false;
    this.inspectionView = view;
    this.onInspectionView?.(view);
    this.mode = "orbit";
    this.orbitYaw = view === "side" ? Math.PI / 2 : 0.65;
    this.orbitPitch = view === "top" ? 1.35 : view === "side" ? 0.02 : 0.35;
    this.snap = true;
  }
  get pilotMapPosition() {
    return this.pilotDestination ?? this.pilotPosition;
  }
  get pilotHeadingDeg() {
    const forward = this.camera.getWorldDirection(new T.Vector3());
    return ((Math.atan2(forward.z, forward.x) * 180) / Math.PI + 360) % 360;
  }
  movePilotTo(north: number, east: number) {
    if (![north, east].every(Number.isFinite)) return;
    this.pilotDestination = new T.Vector3(
      T.MathUtils.clamp(north, -2000, 2000),
      1.7,
      T.MathUtils.clamp(east, -2000, 2000),
    );
    if (this.mode !== "ground") this.setCamera("ground");
  }
  previewPosition(p: Placement | null, ground: boolean) {
    this.placementMarker.visible = !!p && !this.studio;
    if (!p) return;
    const angle = (p.headingDeg * Math.PI) / 180;
    this.placementRing.position.set(p.northM, 0.035, p.eastM);
    this.placementArrow.position.set(
      p.northM,
      ground ? 0.22 : p.altitudeM,
      p.eastM,
    );
    this.placementArrow.setDirection(
      new T.Vector3(Math.cos(angle), 0, Math.sin(angle)),
    );
  }
  moveObserver(keys: Set<string>, dt: number) {
    if (this.studio || this.mode !== "ground") return;
    const has = (key: string) => (keys.has(key) ? 1 : 0);
    const f =
        has("KeyI") -
        has("KeyK") +
        (this.walking ? has("KeyW") - has("KeyS") : 0),
      r =
        has("KeyL") -
        has("KeyJ") +
        (this.walking ? has("KeyD") - has("KeyA") : 0);
    const forward = new T.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new T.Vector3().crossVectors(forward, new T.Vector3(0, 1, 0));
    const motion = forward.multiplyScalar(f).addScaledVector(right, r);
    if (motion.lengthSq() > 0) {
      this.pilotDestination = null;
      this.pilotPosition.add(motion.normalize().multiplyScalar(2.2 * dt));
    }
    this.pilotPosition.y = 1.7;
  }
  captureImpactVelocity(velocity: Vec3) {
    this.impactVelocity.set(velocity[0], -velocity[2], velocity[1]);
  }
  clearTrail() {} // Retained call compatibility; trails are intentionally absent in pilot flight.
  render(
    sim: Simulation,
    c: Controls,
    dt: number,
    previewDeflections?: readonly number[],
    /** Pose blended between physics steps (render/interpolation.ts). */
    view?: RenderSnapshot,
  ) {
    if (!this.visual) return;
    if (!this.studio && this.pilotDestination) {
      this.pilotPosition.lerp(this.pilotDestination, 1 - Math.exp(-dt * 10));
      if (
        this.pilotPosition.distanceToSquared(this.pilotDestination) < 0.0001
      ) {
        this.pilotPosition.copy(this.pilotDestination);
        this.pilotDestination = null;
      }
    }
    this.resizeIfNeeded();
    const s = sim.state,
      pose = view ?? s,
      pos = this.studio ? new T.Vector3(0, 0, 0) : toWorld(pose.position);
    this.visual.group.position.copy(pos);
    this.physicsDebug.group.visible = this.physicsDebugEnabled && !this.studio;
    this.physicsDebug.update(sim, pos);
    followAircraftShadow(
      this.sun,
      pos,
      this.studio ? studioSun : sceneries[this.scenery].sun,
      this.shadowRadius,
      this.studio ? this.studioFloorHeight : 0,
      this.studio ? 1 : 16,
    );
    this.visual.group.quaternion
      .copy(conversion)
      .multiply(
        this.studio
          ? new T.Quaternion()
          : new T.Quaternion(...pose.orientation),
      );
    this.visual.cg.visible =
      this.showCG && this.studio && !this.cameraPlacement;
    for (const v of this.visual.controls) {
      const index = sim.aircraft.surfaces.findIndex(
        (s) => s.id === v.surfaceId,
      );
      const deflection =
        (this.studio && previewDeflections
          ? previewDeflections[index]
          : !this.studio && pose.surfaceCommands?.[index] !== undefined
            ? pose.surfaceCommands[index]
            : surfaceCommand(v.control, c)) * v.max;
      if (v.hingeAxis)
        v.pivot.quaternion.setFromAxisAngle(v.hingeAxis, deflection);
      else v.pivot.rotation.y = deflection;
    }
    const rotorPower = powertrain(
      sim.aircraft,
      s.motors,
      s.batterySoc,
      sim.environment.densityKgM3,
    );
    const spin = this.visual.propellers.map((_, i) =>
      this.studio
        ? 0
        : Math.sqrt(rotorPower.thrust[i] / sim.aircraft.motors[i].maxThrustN) ||
          0,
    );
    this.visual.propellers.forEach(
      (p, i) =>
        (p.rotation.x +=
          dt *
          spin[i] *
          260 *
          (sim.aircraft.motors[i].spin === "ccw" ? -1 : 1)),
    );
    this.discs?.update(spin);
    if (!this.studio && s.status === "crashed") {
      if (!this.debris.active) {
        this.visual.cg.visible = false;
        this.debris.start(this.visual.group, sim.aircraft, this.impactVelocity);
      }
      this.visual.group.visible = !this.debris.active;
      this.debris.update(dt);
    } else {
      this.debris.clear();
      this.visual.group.visible = true;
    }
    let desired: T.Vector3,
      target = this.studio ? this.modelCenter.clone() : pos.clone();
    if (this.mode === "ground") {
      desired = this.pilotPosition;
      this.camera.position.copy(desired);
      const focused = focusedPilotFov(
        this.pilotFov,
        this.span,
        pos.distanceTo(desired),
        this.trackAircraft &&
          this.focusAircraft &&
          !this.dragging &&
          Math.abs(this.lookYaw) < 0.1 &&
          Math.abs(this.lookPitch) < 0.1,
      );
      this.focusFov = this.snap
        ? this.pilotFov
        : T.MathUtils.lerp(this.focusFov, focused, 1 - Math.exp(-dt * 1.5));
      this.camera.fov = this.focusFov;
      const direction = this.trackAircraft
        ? pos.clone().sub(desired).normalize()
        : this.heading.clone();
      this.heading
        .lerp(direction, this.snap ? 1 : 1 - Math.exp(-dt * 9))
        .normalize();
      const look = this.heading
        .clone()
        .applyAxisAngle(new T.Vector3(0, 1, 0), this.lookYaw);
      const right = new T.Vector3()
        .crossVectors(look, new T.Vector3(0, 1, 0))
        .normalize();
      look.applyAxisAngle(right, this.lookPitch);
      target = desired.clone().add(look);
      if (!this.dragging && this.trackAircraft) {
        this.lookYaw *= Math.exp(-dt * 3);
        this.lookPitch *= Math.exp(-dt * 3);
      }
    } else {
      const backward = new T.Vector3(
        Math.cos(this.orbitYaw) * Math.cos(this.orbitPitch),
        Math.sin(this.orbitPitch),
        Math.sin(this.orbitYaw) * Math.cos(this.orbitPitch),
      );
      const distance = this.studio
        ? inspectionDistance(this.modelSize, backward, this.camera.aspect) *
          this.orbitZoom
        : this.span *
          2.1 *
          this.orbitZoom *
          Math.max(1, 0.85 / this.camera.aspect);
      desired = target.clone().add(backward.multiplyScalar(distance));
      this.camera.position.copy(desired);
      this.camera.fov = 42;
    }
    if (this.mode === "fpv" && this.fpv && !this.studio) {
      placeFpvCamera(this.camera, this.fpv, pos, this.visual.group.quaternion);
    } else {
      this.camera.near = RENDER_CONFIG.camera.pilotNear;
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(target);
    }
    // Development screenshot hook: a fixed world-space viewpoint.
    if (this.debugView) {
      this.camera.position.set(...this.debugView.position);
      this.camera.up.set(0, 1, 0);
      this.camera.fov = this.debugView.fov ?? 50;
      this.camera.lookAt(new T.Vector3(...this.debugView.target));
    }
    this.camera.updateProjectionMatrix();
    this.setAircraftLod(lodLevel(this.camera.position.distanceTo(pos)));
    let viewCamera: T.Camera = this.camera;
    if (this.studio && this.inspectionView !== "perspective") {
      fitInspectionCamera(
        this.drawingCamera,
        this.inspectionView,
        this.modelSize,
        this.modelCenter,
        this.camera.aspect,
        this.orbitZoom,
      );
      viewCamera = this.drawingCamera;
    }
    this.snap = false;
    this.forces.visible = this.showForces;
    sim.lastForces.surfaces.forEach((f, i) => {
      const arrow = this.arrows[i];
      if (!arrow) return;
      const v = new T.Vector3(...f.force).applyQuaternion(
        this.visual!.group.quaternion,
      );
      arrow.visible = v.length() > 0.02;
      arrow.position
        .set(...f.position)
        .sub(new T.Vector3(...this.cg))
        .applyQuaternion(this.visual!.group.quaternion)
        .add(pos);
      arrow.setDirection(v.clone().normalize());
      arrow.setLength(
        Math.max(0.01, Math.min(1, v.length() * 0.045)),
        0.035,
        0.02,
      );
      arrow.setColor(f.stalled ? 0xef6c53 : 0xf3bb68);
    });
    const wind = sim.environment.windMps;
    this.field.sock.rotation.y = -Math.atan2(wind[1] || 0.1, wind[0] || 0.5);
    this.field.sock.rotation.z = Math.max(
      -0.9,
      -0.6 + Math.hypot(...wind) * 0.12,
    );
    if (this.studio) {
      const inverseView = viewCamera.quaternion.clone().invert();
      [
        new T.Vector3(1, 0, 0),
        new T.Vector3(0, 1, 0),
        new T.Vector3(0, 0, 1),
      ].forEach((v, i) => {
        v.applyQuaternion(this.visual!.group.quaternion).applyQuaternion(
          inverseView,
        );
        const key = ["X", "Y", "Z"][i],
          x = 73 + v.x * 31,
          y = 43 - v.y * 31;
        const line = this.axisGuide.querySelector(`#axis-line-${key}`)!,
          label = this.axisGuide.querySelector(`#axis-text-${key}`)!;
        line.setAttribute("x2", String(x));
        line.setAttribute("y2", String(y));
        label.setAttribute("x", String(x + 4));
        label.setAttribute("y", String(y - 3));
      });
    }
    this.componentFocus.group.visible =
      this.studio &&
      this.inspectComponents &&
      !!this.selectedComponent &&
      !this.cameraPlacement &&
      !this.componentPlacement;
    this.componentFocusLabel.hidden = !this.componentFocus.group.visible;
    this.axisGuide.hidden = !this.studio || !!this.cameraPlacement;
    this.axisGuide.style.right = this.studio ? "14px" : "auto";
    this.axisGuide.style.left = this.studio ? "auto" : "14px";
    this.axisGuide.style.top = this.studio ? "58px" : "90px";
    if (!this.studio) {
      // Grass sways with the simulated wind at the aircraft (NED → scene x/z).
      const air = sim.airVelocity(sim.state);
      this.field.update(this.camera, [air[0], air[1]], sim.state.time);
    }
    this.cameraPlacement?.prepare(viewCamera);
    this.componentPlacement?.prepare(viewCamera);
    const surfaceAir = sim.airVelocity(sim.state);
    this.engine.frame({
      scene: this.scene,
      camera: viewCamera,
      dt,
      wind: [surfaceAir[0], surfaceAir[1]],
      active: this.needsSmoothMotion || sim.state.status === "flying",
    });
    this.cameraPlacement?.renderPreview();
  }
  private resizeIfNeeded() {
    const size = this.renderer.getSize(new T.Vector2());
    if (
      size.x !== this.container.clientWidth ||
      size.y !== this.container.clientHeight
    )
      this.resize();
  }
  dispose() {
    this.endComponentPlacement();
    this.endCameraPlacement();
    this.observer.disconnect();
    this.disposeVisual();
    this.field.dispose();
    this.componentFocus.dispose();
    this.componentFocusLabel.remove();
    this.placementRing.geometry.dispose();
    this.placementRing.material.dispose();
    this.placementArrow.dispose();
    this.arrows.forEach((arrow) => arrow.dispose());
    this.sun.shadow.dispose();
    this.renderer.dispose();
  }
}
