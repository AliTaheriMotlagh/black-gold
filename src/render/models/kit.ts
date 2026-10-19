/**
 * Procedural model kit. Models are assembled from primitives into a few merged parts
 * (hull, turret, rotor…) so each part renders as one InstancedMesh draw call.
 *
 * Vertex attribute `mask` selects how instance colours apply:
 *   0 fixed colour · 1 country colour (markings) · 2 camouflage × shade · 3 emissive light
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const FIXED = 0;
export const TEAM = 1;
export const CAMO = 2;
export const GLOW = 3;

export type Anim = 'none' | 'turret' | 'spin' | 'rock' | 'pitch';

export interface ModelPart {
  geo: THREE.BufferGeometry;
  pivot: THREE.Vector3;
  anim: Anim;
  axis: 'x' | 'y' | 'z';
  speed: number;
}

export interface ModelDef {
  parts: ModelPart[];
  /** Height of the model (for health bars). */
  height: number;
  /** Footprint radius (selection ring). */
  radius: number;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();

export interface Xf {
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

export class Part {
  private geos: THREE.BufferGeometry[] = [];

  add(geo: THREE.BufferGeometry, color: number, mask = FIXED, xf: Xf = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    tmpE.set(xf.rx ?? 0, xf.ry ?? 0, xf.rz ?? 0);
    tmpQ.setFromEuler(tmpE);
    tmpM.compose(new THREE.Vector3(xf.x ?? 0, xf.y ?? 0, xf.z ?? 0), tmpQ, new THREE.Vector3(xf.sx ?? 1, xf.sy ?? 1, xf.sz ?? 1));
    g.applyMatrix4(tmpM);
    const n = g.getAttribute('position').count;
    const c = new THREE.Color(color);
    // Colours are authored in sRGB; vertex colours are linear.
    c.convertSRGBToLinear();
    const col = new Float32Array(n * 3);
    const msk = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
      msk[i] = mask;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('mask', new THREE.BufferAttribute(msk, 1));
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color' && k !== 'mask') g.deleteAttribute(k);
    this.geos.push(g);
    return this;
  }

  box(w: number, h: number, d: number, color: number, mask = FIXED, xf: Xf = {}) {
    return this.add(new THREE.BoxGeometry(w, h, d), color, mask, xf);
  }

  /** Box with a chamfered top/front, built as an extruded side profile (x = length axis z). */
  hull(len: number, w: number, h: number, frontSlope: number, rearSlope: number, color: number, mask = CAMO, xf: Xf = {}) {
    const s = new THREE.Shape();
    const L = len / 2;
    s.moveTo(-L, 0);
    s.lineTo(L, 0);
    s.lineTo(L, h * (1 - frontSlope));
    s.lineTo(L - len * frontSlope * 0.6, h);
    s.lineTo(-L + len * rearSlope * 0.4, h);
    s.lineTo(-L, h * (1 - rearSlope));
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
    g.translate(0, 0, -w / 2);
    g.rotateY(-Math.PI / 2);
    return this.add(g, color, mask, xf);
  }

  cyl(rTop: number, rBot: number, h: number, color: number, mask = FIXED, xf: Xf = {}, seg = 10) {
    return this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg), color, mask, xf);
  }

  /** Cylinder lying along +z (barrels, missiles, fuselages). */
  tube(r: number, len: number, color: number, mask = FIXED, xf: Xf = {}, seg = 8, rEnd = r) {
    const g = new THREE.CylinderGeometry(rEnd, r, len, seg);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, len / 2);
    return this.add(g, color, mask, xf);
  }

  sphere(r: number, color: number, mask = FIXED, xf: Xf = {}, seg = 8) {
    return this.add(new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2)), color, mask, xf);
  }

  cone(r: number, h: number, color: number, mask = FIXED, xf: Xf = {}, seg = 8) {
    return this.add(new THREE.ConeGeometry(r, h, seg), color, mask, xf);
  }

  /** Flat polygon (top view, points in x/z) extruded upward by `h`. */
  slab(pts: [number, number][], h: number, color: number, mask = FIXED, xf: Xf = {}) {
    const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    return this.add(g, color, mask, xf);
  }

  get empty() {
    return this.geos.length === 0;
  }

  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.geos, false)!;
    for (const x of this.geos) x.dispose();
    g.computeBoundingSphere();
    return g;
  }
}

export function part(build: (p: Part) => void, anim: Anim = 'none', pivot = new THREE.Vector3(), axis: 'x' | 'y' | 'z' = 'y', speed = 0): ModelPart {
  const p = new Part();
  build(p);
  return { geo: p.build(), pivot, anim, axis, speed };
}

/** Shared material for every instanced model part. */
export function modelMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.18 });
  m.customProgramCacheKey = () => 'model-v1';
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float mask;\nattribute vec3 aCamo;\nvarying float vGlow;')
      .replace(
        '#include <color_vertex>',
        `vColor = vec3(1.0);
vColor *= color;
#ifdef USE_INSTANCING_COLOR
vec3 team = instanceColor.xyz;
#else
vec3 team = vec3(1.0);
#endif
vGlow = mask > 2.5 ? 1.0 : 0.0;
if (mask > 2.5) vColor *= team;
else if (mask > 1.5) vColor *= aCamo;
else if (mask > 0.5) vColor *= team;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor * vGlow * 3.0;');
  };
  return m;
}
