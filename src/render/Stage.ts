import * as THREE from 'three';
import { WORLD_H, WORLD_W } from '../geo/geography';
import type { MapData } from '../world/heightmap';
import { sampleHeight } from '../world/heightmap';
import { Terrain, createSky } from '../world/Terrain';
import { Particles } from '../fx/particles';
import { Decals } from '../fx/decals';
import { CameraRig } from './CameraRig';
import type { Quality } from '../meta/settings';

const SUN_DIR = new THREE.Vector3(-0.5, 0.85, 0.35).normalize();
const FOG_CLEAR = new THREE.Color(0xd9c7a3);
const FOG_STORM = new THREE.Color(0xc08a52);

/** Owns renderer, scene, camera, lighting and shared visual systems. */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly rig: CameraRig;
  readonly terrain: Terrain;
  readonly particles: Particles;
  readonly decals: Decals;
  readonly sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private sky: THREE.Mesh;
  private fog: THREE.FogExp2;
  quality: Quality;
  width = 1;
  height = 1;
  private raycaster = new THREE.Raycaster();
  storm = 0;

  constructor(readonly canvas: HTMLCanvasElement, readonly map: MapData, quality: Quality) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 3000);
    this.rig = new CameraRig(this.camera, (x, z) => sampleHeight(map, x, z));

    this.fog = new THREE.FogExp2(FOG_CLEAR.getHex(), 0.0018);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(0xd9c7a3);

    this.hemi = new THREE.HemisphereLight(0xfff3dd, 0x8a6f4a, 1.25);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
    this.sun.position.copy(SUN_DIR).multiplyScalar(200);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.sky = createSky(SUN_DIR);
    this.scene.add(this.sky);
    // Image-based lighting from the sky dome: gives metal, oil and water real reflections.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(this.sky.geometry, this.sky.material));
    this.scene.environment = pmrem.fromScene(envScene, 0, 1, 3000).texture;
    this.scene.environmentIntensity = 0.45;
    pmrem.dispose();

    this.terrain = new Terrain(map);
    this.scene.add(this.terrain.group);
    this.terrain.buildLabels();

    this.particles = new Particles();
    this.scene.add(this.particles.group);
    this.decals = new Decals();
    this.scene.add(this.decals.group);

    this.applyQuality(quality);
    this.resize();
  }

  applyQuality(q: Quality) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'low' ? Math.min(dpr, 1) : q === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2));
    const shadows = q !== 'low';
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    if (shadows) {
      const size = q === 'high' ? 2048 : 1024;
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.particles.density = q === 'low' ? 0.45 : q === 'medium' ? 0.75 : 1;
    // Materials need recompiling when shadow state changes
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.particles.setViewportHeight(h * this.renderer.getPixelRatio());
  }

  update(dt: number, time: number) {
    this.rig.update(dt);
    this.terrain.update(time);
    this.particles.update(dt);
    this.decals.update(dt);
    // Shadow camera follows the view focus
    const t = this.rig.target;
    const span = Math.min(140, this.rig.distance * 1.1 + 20);
    this.sun.position.set(t.x + SUN_DIR.x * 200, t.y + SUN_DIR.y * 200, t.z + SUN_DIR.z * 200);
    this.sun.target.position.copy(t);
    const sc = this.sun.shadow.camera;
    if (sc.right !== span) {
      sc.left = -span;
      sc.right = span;
      sc.top = span;
      sc.bottom = -span;
      sc.near = 10;
      sc.far = 500;
      sc.updateProjectionMatrix();
    }
    // Atmosphere: sandstorm thickens the fog and tints everything orange.
    this.fog.color.copy(FOG_CLEAR).lerp(FOG_STORM, this.storm);
    this.fog.density = 0.0016 + this.storm * 0.011 + Math.max(0, (this.rig.distance - 120) * -0.000004);
    (this.scene.background as THREE.Color).copy(this.fog.color);
    (this.sky.material as THREE.ShaderMaterial).uniforms.haze.value = this.storm * 0.85;
    this.sky.position.copy(this.camera.position);
    this.sun.intensity = 2.6 - this.storm * 1.4;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** Screen (client px) -> world ground point via heightmap ray-march. */
  pickGround(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const { origin, direction } = this.raycaster.ray;
    const h = (x: number, z: number) => Math.max(0, sampleHeight(this.map, x, z));
    let prevT = 0;
    const maxT = 2500;
    let step = 1.5;
    for (let t = 1; t < maxT; t += step) {
      const x = origin.x + direction.x * t;
      const y = origin.y + direction.y * t;
      const z = origin.z + direction.z * t;
      if (y <= h(x, z)) {
        // refine
        let lo = prevT;
        let hi = t;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          const mx = origin.x + direction.x * mid;
          const my = origin.y + direction.y * mid;
          const mz = origin.z + direction.z * mid;
          if (my <= h(mx, mz)) hi = mid;
          else lo = mid;
        }
        const p = new THREE.Vector3().copy(origin).addScaledVector(direction, hi);
        p.x = THREE.MathUtils.clamp(p.x, 0, WORLD_W);
        p.z = THREE.MathUtils.clamp(p.z, 0, WORLD_H);
        return p;
      }
      prevT = t;
      step = Math.min(6, 1.5 + t * 0.01);
    }
    return null;
  }

  /** World -> screen (client px). Returns null if behind camera. */
  project(v: THREE.Vector3): { x: number; y: number } | null {
    const p = v.clone().project(this.camera);
    if (p.z > 1) return null;
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  }
}
