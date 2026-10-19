/**
 * Renderer, scene graph root, lighting, post-processing and quality management.
 * World units are kilometres; heights are exaggerated by VEX for readability.
 */
import * as THREE from 'three';
import { BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing';

export type Quality = 'low' | 'medium' | 'high';

export interface QualityProfile {
  pixelRatio: number;
  shadows: number;
  post: boolean;
  bloom: boolean;
  lod: number;
  maxZoom: number;
  particles: number;
  cityDetail: number;
}

export const QUALITY: Record<Quality, QualityProfile> = {
  low: { pixelRatio: 1, shadows: 0, post: false, bloom: false, lod: 0.9, maxZoom: 10, particles: 0.45, cityDetail: 0.35 },
  medium: { pixelRatio: 1.5, shadows: 1024, post: true, bloom: true, lod: 1.25, maxZoom: 12, particles: 0.75, cityDetail: 0.7 },
  high: { pixelRatio: 2, shadows: 2048, post: true, bloom: true, lod: 2.1, maxZoom: 14, particles: 1, cityDetail: 1 },
};

/** Vertical exaggeration: metres of elevation → km of world height. */
export const VEX = 0.0022;

export function autoQuality(): Quality {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (coarse) return mem >= 6 && cores >= 6 ? 'medium' : 'low';
  return mem >= 4 && cores >= 4 ? 'high' : 'medium';
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sunDir = new THREE.Vector3(-0.45, 0.78, 0.42).normalize();
  profile: QualityProfile;
  private composer: EffectComposer | null = null;
  private bloom: BloomEffect | null = null;
  private dynScale = 1;
  private frameTimes: number[] = [];
  readonly fog: THREE.Fog;
  readonly skyColor = new THREE.Color(0x9fb8cf);
  readonly hazeColor = new THREE.Color(0xc9d3dc);

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly quality: Quality,
  ) {
    this.profile = QUALITY[quality];
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !this.profile.post,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = this.profile.post ? THREE.NoToneMapping : THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = this.profile.shadows > 0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(this.skyColor);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.01, 20000);
    this.fog = new THREE.Fog(this.hazeColor, 1000, 8000);
    this.scene.fog = this.fog;
    this.scene.background = this.skyColor;

    this.hemi = new THREE.HemisphereLight(0xd8e6f5, 0x6b5a45, 1.05);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.sun.position.copy(this.sunDir).multiplyScalar(50);
    this.scene.add(this.sun, this.sun.target);
    if (this.profile.shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(this.profile.shadows, this.profile.shadows);
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.02;
    }

    if (this.profile.post) {
      this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      const effects = [];
      if (this.profile.bloom) {
        this.bloom = new BloomEffect({ intensity: 0.9, luminanceThreshold: 0.92, luminanceSmoothing: 0.12, mipmapBlur: true, radius: 0.7 });
        effects.push(this.bloom);
      }
      effects.push(new SMAAEffect());
      effects.push(new ToneMappingEffect({ mode: ToneMappingMode.AGX }));
      effects.push(new VignetteEffect({ darkness: 0.32, offset: 0.32 }));
      this.composer.addPass(new EffectPass(this.camera, ...effects));
    }
    this.resize();
  }

  resize() {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const pr = Math.min(window.devicePixelRatio || 1, this.profile.pixelRatio) * this.dynScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Keep the shadow camera tight around what the player is looking at. */
  updateLighting(target: THREE.Vector3, distance: number) {
    const span = Math.min(60, Math.max(2, distance * 0.9));
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(this.sunDir, span * 3);
    if (this.sun.castShadow) {
      const cam = this.sun.shadow.camera;
      cam.left = -span;
      cam.right = span;
      cam.top = span;
      cam.bottom = -span;
      cam.near = 0.1;
      cam.far = span * 8;
      cam.updateProjectionMatrix();
      // Shadows only matter (and are only sharp enough) at tactical zoom.
      this.sun.castShadow = distance < 40;
    }
    // Aerial perspective: haze starts beyond the focus and thickens with altitude.
    this.fog.near = distance * 1.6;
    this.fog.far = distance * 7 + 400;
  }

  render(dt: number) {
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.adapt(dt);
  }

  /** Dynamic resolution: trade pixels for frame rate when the GPU struggles. */
  private adapt(dt: number) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    let next = this.dynScale;
    if (avg > 1 / 40 && this.dynScale > 0.6) next = Math.max(0.6, this.dynScale - 0.1);
    else if (avg < 1 / 57 && this.dynScale < 1) next = Math.min(1, this.dynScale + 0.05);
    if (next !== this.dynScale) {
      this.dynScale = next;
      this.resize();
    }
  }

  setBloom(intensity: number) {
    if (this.bloom) this.bloom.intensity = intensity;
  }
}
