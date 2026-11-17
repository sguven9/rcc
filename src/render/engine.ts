/**
 * The render layer's entry point. Owns the WebGL2 renderer, the physical
 * sky and its image-based lighting, cascaded sun shadows, height fog, the
 * post-processing chain, quality presets and dynamic resolution.
 *
 * Boundary: the engine reads presentation inputs (camera, time of day, wind,
 * frame time) and never writes simulation state. view/scene.ts builds the
 * scene graph and calls `frame` once per displayed frame.
 */
import * as T from "three";
import { backendMessage, chooseBackend, type Backend } from "./backend";
import { installHeightFog } from "./fog";
import { SkyEnvironment } from "./environment";
import { PostChain } from "./post";
import {
  DynamicResolution,
  detectQuality,
  isQualityLevel,
  pixelRatioFor,
  presetFor,
} from "./quality";
import {
  QUALITY_PRESETS,
  RENDER_CONFIG,
  type QualityLevel,
} from "./render-config";
import { SunShadows } from "./shadows";
import { SkySystem, exposureFor, hazeColor, sunColor } from "./sky";
import { daylight, sunPosition } from "./solar";

export interface RenderSettings {
  /** "auto" picks a preset from the device; otherwise a fixed preset. */
  quality: QualityLevel | "auto";
  /** Local solar time, hours. */
  hour: number;
  dynamicResolution: boolean;
  vignette: boolean;
}
export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  quality: "auto",
  hour: RENDER_CONFIG.site.defaultHour,
  dynamicResolution: true,
  vignette: true,
};

export function parseRenderSettings(text: string | null): RenderSettings {
  try {
    const v = text ? JSON.parse(text) : null;
    if (!v || typeof v !== "object") return { ...DEFAULT_RENDER_SETTINGS };
    return {
      quality:
        v.quality === "auto" || isQualityLevel(v.quality) ? v.quality : "auto",
      hour:
        typeof v.hour === "number" && v.hour >= 0 && v.hour <= 24
          ? v.hour
          : DEFAULT_RENDER_SETTINGS.hour,
      dynamicResolution: v.dynamicResolution !== false,
      vignette: v.vignette !== false,
    };
  } catch {
    return { ...DEFAULT_RENDER_SETTINGS };
  }
}

export interface FrameInput {
  scene: T.Scene;
  camera: T.Camera;
  /** Seconds since the previous displayed frame. */
  dt: number;
  /** Surface wind in scene x/z, m/s (cloud drift). */
  wind: [number, number];
  /** Something moves (flight, camera): dynamic resolution may adapt. */
  active: boolean;
}

export class RenderEngine {
  readonly renderer: T.WebGLRenderer;
  readonly backend: Backend;
  readonly sky: SkySystem;
  level: QualityLevel = "medium";
  settings: RenderSettings = { ...DEFAULT_RENDER_SETTINGS };
  readonly sunDirection = new T.Vector3(0, 1, 0);
  readonly sunLightColor = new T.Color();
  sunElevation = Math.PI / 4;
  private scene?: T.Scene;
  private camera?: T.PerspectiveCamera;
  private env?: SkyEnvironment;
  private shadows?: SunShadows;
  private post?: PostChain;
  private dynamic = new DynamicResolution();
  private studio = false;
  private size = new T.Vector2(1, 1);
  private headingOffsetDeg = 0;
  /** Called when the preset changes (e.g. grass density). */
  onQualityChange?: (level: QualityLevel) => void;
  /** CPU milliseconds of the last frame's stages (profiling aid). */
  readonly timings = { shadows: 0, post: 0, total: 0 };
  constructor(container: HTMLElement, webgpuAvailable = false) {
    let webgl2 = false;
    try {
      webgl2 = !!document.createElement("canvas").getContext("webgl2");
    } catch {
      webgl2 = false;
    }
    const caps = { webgl2, webgpu: webgpuAvailable };
    this.backend = chooseBackend(caps);
    if (this.backend === "none") throw new Error(backendMessage(caps));
    installHeightFog();
    this.renderer = new T.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance",
      // Linear depth: GTAO and polygon offsets need it; near planes are set per view.
      logarithmicDepthBuffer: false,
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFShadowMap;
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    // The post chain renders many passes; counters cover the whole frame.
    this.renderer.info.autoReset = false;
    container.append(this.renderer.domElement);
    this.sky = new SkySystem();
  }

  /** Coarse device hints for the automatic preset. */
  deviceHints() {
    const gl = this.renderer.getContext();
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const nav = navigator as Navigator & { deviceMemory?: number };
    return {
      cores: nav.hardwareConcurrency || 4,
      memoryGb: nav.deviceMemory,
      maxTextureSize: this.renderer.capabilities.maxTextureSize,
      renderer: info
        ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
        : undefined,
      mobile: matchMedia?.("(pointer: coarse)").matches ?? false,
    };
  }

  /** Wire the flight scene: sky, IBL, shadows, fog and post chain. */
  attach(
    scene: T.Scene,
    camera: T.PerspectiveCamera,
    settings: RenderSettings,
    headingOffsetDeg = 0,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.headingOffsetDeg = headingOffsetDeg;
    camera.far = RENDER_CONFIG.camera.far;
    scene.add(this.sky.mesh);
    this.env = new SkyEnvironment(this.renderer, this.sky.mesh);
    this.settings = { ...settings };
    this.applyQuality(
      settings.quality === "auto"
        ? detectQuality(this.deviceHints())
        : settings.quality,
    );
    this.setHour(settings.hour);
  }

  /** Switch preset: shadows, post chain, resolution and density follow. */
  applyQuality(level: QualityLevel) {
    if (!this.scene || !this.camera) return;
    this.level = level;
    const preset = presetFor(level);
    this.shadows?.dispose();
    this.shadows = new SunShadows(
      this.scene,
      this.camera,
      preset,
      this.sunDirection,
    );
    this.shadows.prepare(this.scene);
    // Alpha-to-coverage needs MSAA; without it partial alpha would reach
    // FXAA (which reads alpha) as bright fringes, so cutouts use alpha test.
    const msaa = preset.antialias === "smaa";
    this.scene.traverse((o) => {
      const mesh = o as T.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material])
        if (m.alphaTest > 0 && m.alphaToCoverage !== msaa) {
          m.alphaToCoverage = msaa;
          m.needsUpdate = true;
        }
    });
    this.post?.dispose();
    this.post = new PostChain(
      this.renderer,
      this.scene,
      this.camera,
      preset,
      this.size.x,
      this.size.y,
    );
    this.post.setVignette(this.settings.vignette);
    this.sky.setClouds(preset.clouds);
    this.dynamic.reset();
    this.resize(this.size.x, this.size.y);
    this.updateEnvironment(true);
    this.onQualityChange?.(level);
  }
  setSettings(settings: RenderSettings) {
    const level =
      settings.quality === "auto"
        ? detectQuality(this.deviceHints())
        : settings.quality;
    const qualityChanged = level !== this.level;
    this.settings = { ...settings };
    if (qualityChanged) this.applyQuality(level);
    this.post?.setVignette(settings.vignette);
    this.setHour(settings.hour);
    if (!settings.dynamicResolution) {
      this.dynamic.reset();
      this.resize(this.size.x, this.size.y);
    }
  }

  /** Time of day at the field: sun position, light colour, exposure, IBL. */
  setHour(hour: number) {
    this.settings.hour = hour;
    const sun = sunPosition(
      hour,
      RENDER_CONFIG.site.dayOfYear,
      RENDER_CONFIG.site.latitudeDeg,
    );
    const h = (this.headingOffsetDeg * Math.PI) / 180;
    const [north, east, up] = sun.direction;
    // True north/east → runway-aligned local x/y; scene = (x, up, y).
    this.sunDirection
      .set(
        north * Math.cos(h) + east * Math.sin(h),
        up,
        -north * Math.sin(h) + east * Math.cos(h),
      )
      .normalize();
    this.sunElevation = sun.elevation;
    this.sky.setSun(this.sunDirection);
    sunColor(sun.elevation, this.sunLightColor);
    const light =
      RENDER_CONFIG.sun.intensity *
      daylight(sun.elevation, RENDER_CONFIG.sun.twilightDeg);
    this.shadows?.set(this.sunDirection, this.sunLightColor, light);
    this.renderer.toneMappingExposure = exposureFor(sun.elevation);
    this.updateEnvironment(false);
  }
  private updateEnvironment(force: boolean) {
    if (!this.scene || !this.env) return;
    const texture = this.env.update(
      this.sky.mesh,
      this.sunDirection,
      0.01,
      force,
      presetFor(this.level).envMapSize,
    );
    this.scene.environment = texture;
    this.scene.environmentIntensity =
      RENDER_CONFIG.environmentIntensity *
      Math.max(
        0.08,
        daylight(this.sunElevation, RENDER_CONFIG.sun.twilightDeg),
      );
  }
  /** Lit materials added after attach (aircraft, debris) need shadow setup. */
  prepare(root: T.Object3D) {
    this.shadows?.prepare(root);
  }
  /** Editor studio: plain lighting, no sky, fog or post. */
  setStudio(on: boolean) {
    this.studio = on;
    this.sky.mesh.visible = !on;
    this.shadows?.setVisible(!on);
  }
  /** The fog the flight scene should use (height fog, sky-matched colour). */
  fog() {
    const fog = new T.FogExp2(
      hazeColor(this.sunElevation).getHex(),
      RENDER_CONFIG.fog.density,
    );
    return fog;
  }

  resize(width: number, height: number) {
    if (!(width > 0 && height > 0)) return;
    this.size.set(width, height);
    const ratio = pixelRatioFor(
      width,
      height,
      devicePixelRatio || 1,
      this.level,
      this.settings.dynamicResolution ? this.dynamic.scale : 1,
    );
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.post?.setSize(width, height, ratio);
  }

  /** Draw one frame. Studio frames bypass the flight pipeline. */
  frame(input: FrameInput) {
    const start = performance.now();
    this.renderer.info.reset();
    if (this.studio || !this.post || !this.shadows) {
      this.renderer.render(input.scene, input.camera);
      this.timings.total = performance.now() - start;
      return;
    }
    this.sky.update(input.camera, input.dt, input.wind);
    const s0 = performance.now();
    if (input.camera === this.camera) {
      // Cascades are fitted to this frame's camera, not last frame's.
      input.camera.updateMatrixWorld();
      this.shadows.update();
    }
    this.timings.shadows = performance.now() - s0;
    this.post.setCamera(input.camera);
    const p0 = performance.now();
    this.post.render(input.dt);
    this.timings.post = performance.now() - p0;
    this.timings.total = performance.now() - start;
    if (
      input.active &&
      this.settings.dynamicResolution &&
      this.dynamic.update(input.dt)
    )
      this.resize(this.size.x, this.size.y);
  }

  stats() {
    const info = this.renderer.info.render;
    return {
      backend: this.backend,
      quality: this.level,
      resolutionScale: this.dynamic.scale,
      pixelRatio: this.renderer.getPixelRatio(),
      calls: info.calls,
      triangles: info.triangles,
      stages: this.post?.stages ?? [],
      cascades: QUALITY_PRESETS[this.level].shadowCascades,
      timings: { ...this.timings },
    };
  }

  dispose() {
    this.post?.dispose();
    this.shadows?.dispose();
    this.env?.dispose();
    this.sky.mesh.geometry.dispose();
    this.sky.mesh.material.dispose();
    this.renderer.dispose();
  }
}
