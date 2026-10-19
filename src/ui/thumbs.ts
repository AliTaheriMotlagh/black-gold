/**
 * Renders every unit and building model into small portraits for the HUD (once,
 * using the main renderer and an offscreen target).
 */
import * as THREE from 'three';
import { UNIT_MODELS } from '../render/models/units';
import { BUILDING_MODELS } from '../render/models/buildings';
import { modelMaterial } from '../render/models/kit';
import { BUILDINGS } from '../sim/defs';

const cache = new Map<string, string>();

export function thumb(key: string): string {
  return cache.get(key) ?? '';
}

export function renderThumbs(renderer: THREE.WebGLRenderer, team: string, camo: number) {
  const size = 128;
  const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4, colorSpace: THREE.SRGBColorSpace });
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xe6eef8, 0x4a3f33, 1.6));
  const sun = new THREE.DirectionalLight(0xfff2e0, 2.8);
  sun.position.set(-2, 3, 2.5);
  scene.add(sun);
  const cam = new THREE.PerspectiveCamera(28, 1, 0.001, 100);
  const mat = modelMaterial();
  const camoC = new THREE.Color(camo).convertSRGBToLinear();
  const teamC = new THREE.Color(team);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const px = new Uint8Array(size * size * 4);
  const img = ctx.createImageData(size, size);
  const prevTarget = renderer.getRenderTarget();
  const prevTone = renderer.toneMapping;
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.toneMapping = THREE.AgXToneMapping;

  const shoot = (key: string, parts: { geo: THREE.BufferGeometry; pivot: THREE.Vector3 }[], radius: number) => {
    const group = new THREE.Group();
    for (const p of parts) {
      const g = p.geo.clone();
      const n = g.getAttribute('position').count;
      g.setAttribute('aCamo', new THREE.InstancedBufferAttribute(new Float32Array([camoC.r, camoC.g, camoC.b]), 3));
      const m = new THREE.InstancedMesh(g, mat, 1);
      m.setMatrixAt(0, new THREE.Matrix4().makeTranslation(p.pivot.x, p.pivot.y, p.pivot.z));
      m.setColorAt(0, teamC);
      group.add(m);
      void n;
    }
    const box = new THREE.Box3().setFromObject(group);
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(box.getSize(new THREE.Vector3()).length() * 0.5, radius * 0.6, 0.02);
    group.position.sub(c);
    group.rotation.y = -0.65;
    scene.add(group);
    const d = r / Math.sin(THREE.MathUtils.degToRad(14));
    cam.position.set(0, d * 0.5, d * 0.86);
    cam.lookAt(0, 0, 0);
    cam.near = d * 0.05;
    cam.far = d * 4;
    cam.updateProjectionMatrix();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
    // Flip vertically into the canvas.
    for (let y = 0; y < size; y++) img.data.set(px.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
    ctx.putImageData(img, 0, 0);
    cache.set(key, canvas.toDataURL('image/png'));
    scene.remove(group);
    for (const m of group.children) (m as THREE.InstancedMesh).geometry.dispose();
  };

  for (const [id, f] of Object.entries(UNIT_MODELS)) {
    const def = f();
    shoot(`unit.${id}`, def.parts, def.radius);
  }
  for (const [id, f] of Object.entries(BUILDING_MODELS)) {
    const def = f(BUILDINGS[id].size);
    shoot(`bld.${id}`, def.parts, def.radius);
  }
  renderer.setRenderTarget(prevTarget);
  renderer.toneMapping = prevTone;
  renderer.setClearColor(prevClear, prevAlpha);
  rt.dispose();
  mat.dispose();
}
