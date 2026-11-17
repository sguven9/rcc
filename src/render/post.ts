/**
 * Post-processing chain (HDR, half-float): scene → ambient occlusion (GTAO)
 * → bloom → tone mapping + sRGB (ACES, OutputPass) → vignette →
 * anti-aliasing (FXAA or SMAA; MSAA ×4 on the scene target at High/Ultra).
 * Each stage follows the active quality preset.
 */
import * as T from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { FXAAPass } from "three/examples/jsm/postprocessing/FXAAPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { VignetteShader } from "three/examples/jsm/shaders/VignetteShader.js";
import { RENDER_CONFIG, type QualityPreset } from "./render-config";

export class PostChain {
  readonly composer: EffectComposer;
  private renderPass: RenderPass;
  private ao?: GTAOPass;
  private bloom?: UnrealBloomPass;
  private vignette?: ShaderPass;
  private aa?: FXAAPass | SMAAPass;
  constructor(
    renderer: T.WebGLRenderer,
    scene: T.Scene,
    camera: T.Camera,
    preset: QualityPreset,
    width: number,
    height: number,
  ) {
    const msaa = preset.antialias === "smaa" ? 4 : 0;
    // The scene depth is kept so ambient occlusion sees alpha-tested foliage
    // and the sky (depth 1) exactly as drawn.
    const target = new T.WebGLRenderTarget(width, height, {
      type: T.HalfFloatType,
      samples: msaa,
      depthTexture: new T.DepthTexture(width, height),
    });
    this.composer = new EffectComposer(renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    if (preset.ao) {
      this.ao = new GTAOPass(scene, camera, width, height);
      // Normals are reconstructed from the shared depth (no override pass).
      this.ao.setGBuffer(this.composer.readBuffer.depthTexture!);
      this.ao.updateGtaoMaterial({
        radius: RENDER_CONFIG.ao.radius,
        distanceExponent: RENDER_CONFIG.ao.distanceExponent,
        thickness: RENDER_CONFIG.ao.thickness,
        scale: RENDER_CONFIG.ao.scale,
      });
      this.ao.blendIntensity = 0.85;
      this.composer.addPass(this.ao);
    }
    if (preset.bloom) {
      this.bloom = new UnrealBloomPass(
        new T.Vector2(width, height),
        RENDER_CONFIG.bloom.strength,
        RENDER_CONFIG.bloom.radius,
        RENDER_CONFIG.bloom.threshold,
      );
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
    if (preset.vignette) {
      this.vignette = new ShaderPass(VignetteShader);
      this.vignette.uniforms.offset.value = RENDER_CONFIG.vignette.offset;
      this.vignette.uniforms.darkness.value = RENDER_CONFIG.vignette.darkness;
      this.composer.addPass(this.vignette);
    }
    if (preset.antialias === "fxaa") this.aa = new FXAAPass();
    else if (preset.antialias === "smaa") this.aa = new SMAAPass();
    if (this.aa) this.composer.addPass(this.aa);
  }
  /** Stage names in order (for profiling and tests). */
  get stages() {
    return this.composer.passes.map((p) => p.constructor.name);
  }
  setCamera(camera: T.Camera) {
    this.renderPass.camera = camera;
    if (this.ao) this.ao.camera = camera;
  }
  setVignette(on: boolean) {
    if (this.vignette) this.vignette.enabled = on;
  }
  setSize(width: number, height: number, pixelRatio: number) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }
  render(dt: number) {
    // RenderPass draws into the current read buffer; AO samples its depth.
    if (this.ao && this.composer.readBuffer.depthTexture)
      this.ao.setGBuffer(this.composer.readBuffer.depthTexture);
    this.composer.render(dt);
  }
  dispose() {
    this.ao?.dispose();
    this.bloom?.dispose();
    this.aa?.dispose();
    this.composer.dispose();
  }
}
