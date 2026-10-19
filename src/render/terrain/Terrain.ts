/**
 * Quadtree LOD terrain over Web Mercator tiles.
 *
 * Coarse levels use the baked 4 km theater grid and base imagery (works offline).
 * Closer levels stream real elevation (AWS Terrarium) and imagery tiles. Every node is
 * a 32×32 grid with skirts; nodes split by screen-space error. The shader adds
 * procedural close-range detail, the political territory tint, and fog of war.
 */
import * as THREE from 'three';
import type { Theater } from '../../geo/theater';
import { tileToWorldRect, worldToTile } from '../../geo/projection';
import { VEX } from '../Stage';
import { ELEVATION_MAX_ZOOM, TileSource } from './TileSource';

const N = 32;
const ROOT_ZOOM = 5;
const MIN_STREAM_ZOOM = 7;

interface Node {
  z: number;
  x: number;
  y: number;
  /** Clipped world rect. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Full tile rect (for tile-texture UVs). */
  tx0: number;
  tz0: number;
  tx1: number;
  tz1: number;
  parent: Node | null;
  children: Node[] | null;
  mesh: THREE.Mesh | null;
  heights: Float32Array | null;
  elevZoom: number;
  imgKey: string;
  minY: number;
  maxY: number;
  used: number;
  uniforms: { uTile: { value: THREE.Texture | null }; uTileRect: { value: THREE.Vector4 }; uUseTile: { value: number } };
}

export class Terrain {
  readonly group = new THREE.Group();
  readonly source = new TileSource();
  private roots: Node[] = [];
  private template: THREE.MeshStandardMaterial;
  readonly shared: Record<string, THREE.IUniform>;
  readonly fogTex: THREE.DataTexture;
  readonly territoryTex: THREE.DataTexture;
  private texCache = new Map<string, THREE.Texture>();
  private frame = 0;
  private dirty = true;
  lod = 1.4;
  maxZoom = 12;
  private rendered: Node[] = [];

  constructor(
    readonly theater: Theater,
    baseTexture: THREE.Texture,
  ) {
    const t = theater;
    this.fogTex = new THREE.DataTexture(new Uint8Array(t.w * t.h).fill(255), t.w, t.h, THREE.RedFormat);
    this.fogTex.magFilter = THREE.LinearFilter;
    this.fogTex.minFilter = THREE.LinearFilter;
    this.fogTex.needsUpdate = true;
    this.territoryTex = new THREE.DataTexture(new Uint8Array(t.w * t.h * 4), t.w, t.h, THREE.RGBAFormat);
    this.territoryTex.magFilter = THREE.NearestFilter;
    this.territoryTex.minFilter = THREE.NearestFilter;
    this.territoryTex.needsUpdate = true;
    baseTexture.flipY = false;
    baseTexture.colorSpace = THREE.SRGBColorSpace;
    baseTexture.anisotropy = 8;
    baseTexture.needsUpdate = true;
    this.shared = {
      uBase: { value: baseTexture },
      uWorldSize: { value: new THREE.Vector2(t.worldW, t.worldH) },
      uFog: { value: this.fogTex },
      uTerritory: { value: this.territoryTex },
      uTerritoryAlpha: { value: 0 },
      uTime: { value: 0 },
      uDetail: { value: 1 },
      uGrid: { value: new THREE.Vector2(t.w, t.h) },
    };
    this.template = new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0, color: 0xffffff, side: THREE.DoubleSide });
    this.source.onLoad = () => (this.dirty = true);
    this.buildRoots();
    this.buildBackdrop();
    this.group.name = 'terrain';
  }

  private buildRoots() {
    const t = this.theater;
    const a = worldToTile(0, 0, ROOT_ZOOM);
    const b = worldToTile(t.worldW - 0.01, t.worldH - 0.01, ROOT_ZOOM);
    for (let y = Math.floor(a.ty); y <= Math.floor(b.ty); y++)
      for (let x = Math.floor(a.tx); x <= Math.floor(b.tx); x++) {
        const n = this.makeNode(ROOT_ZOOM, x, y, null);
        if (n) this.roots.push(n);
      }
  }

  private makeNode(z: number, x: number, y: number, parent: Node | null): Node | null {
    const r = tileToWorldRect(x, y, z);
    const t = this.theater;
    const x0 = Math.max(0, r.x0);
    const z0 = Math.max(0, r.z0);
    const x1 = Math.min(t.worldW, r.x1);
    const z1 = Math.min(t.worldH, r.z1);
    if (x1 - x0 < 1e-3 || z1 - z0 < 1e-3) return null;
    return {
      z,
      x,
      y,
      x0,
      z0,
      x1,
      z1,
      tx0: r.x0,
      tz0: r.z0,
      tx1: r.x1,
      tz1: r.z1,
      parent,
      children: null,
      mesh: null,
      heights: null,
      elevZoom: -1,
      imgKey: '',
      minY: -1,
      maxY: 4,
      used: 0,
      uniforms: { uTile: { value: null }, uTileRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uUseTile: { value: 0 } },
    };
  }

  private buildBackdrop() {
    // Dark sea beyond the theater edge so the map never ends in a void.
    const g = new THREE.PlaneGeometry(40000, 40000);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({ color: 0x0b1a26 });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(this.theater.worldW / 2, -0.4, this.theater.worldH / 2);
    mesh.renderOrder = -10;
    this.group.add(mesh);
  }

  // ---------------------------------------------------------------------------
  // Height sampling

  /** Best decoded elevation tile covering node (own zoom or an ancestor). */
  private elevationFor(n: Node): { data: Float32Array; z: number; rect: { x0: number; z0: number; x1: number; z1: number } } | null {
    for (let z = Math.min(n.z, ELEVATION_MAX_ZOOM); z >= MIN_STREAM_ZOOM; z--) {
      const s = n.z - z;
      const tx = n.x >> s;
      const ty = n.y >> s;
      const d = this.source.getElevation(z, tx, ty);
      if (d) return { data: d, z, rect: tileToWorldRect(tx, ty, z) };
    }
    return null;
  }

  /**
   * Render heights on an (N+3)² grid: the visible (N+1)² vertices plus a one-vertex
   * border so normals match across tile edges (no lighting seams).
   */
  private buildHeights(n: Node): Float32Array {
    const src = this.elevationFor(n);
    n.elevZoom = src ? src.z : 0;
    const M = N + 3;
    const h = new Float32Array(M * M);
    const t = this.theater;
    const sx = (n.x1 - n.x0) / N;
    const sz = (n.z1 - n.z0) / N;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let j = 0; j < M; j++) {
      const wz = n.z0 + sz * (j - 1);
      for (let i = 0; i < M; i++) {
        const wx = n.x0 + sx * (i - 1);
        let m: number;
        if (src) {
          const u = ((wx - src.rect.x0) / (src.rect.x1 - src.rect.x0)) * 256 - 0.5;
          const v = ((wz - src.rect.z0) / (src.rect.z1 - src.rect.z0)) * 256 - 0.5;
          m = bilinear(src.data, 256, u, v);
        } else m = t.heightAt(wx, wz);
        let y = m * VEX;
        // Push lake/sea floors down so they never z-fight the water surface. The water
        // mask is sampled bilinearly so the transition is smooth (no 4 km stair-steps).
        const wm = this.waterMask(wx, wz);
        if (wm.f > 0 && m < wm.level) y = y + (wm.level * VEX + (m - wm.level) * VEX * 2.5 - 0.04 - y) * wm.f;
        h[j * M + i] = y;
        if (i > 0 && j > 0 && i < M - 1 && j < M - 1) {
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    n.minY = minY;
    n.maxY = maxY;
    return h;
  }

  /** Fraction of water around a point (bilinear over cells) and that water's level. */
  private waterMask(x: number, z: number): { f: number; level: number } {
    const t = this.theater;
    const fx = Math.min(t.w - 1.001, Math.max(0, x / t.cell - 0.5));
    const fz = Math.min(t.h - 1.001, Math.max(0, z / t.cell - 0.5));
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;
    const i = z0 * t.w + x0;
    const a = t.water[i];
    const b = t.water[i + 1];
    const c = t.water[i + t.w];
    const d = t.water[i + t.w + 1];
    const f = (a ? 1 : 0) * (1 - tx) * (1 - tz) + (b ? 1 : 0) * tx * (1 - tz) + (c ? 1 : 0) * (1 - tx) * tz + (d ? 1 : 0) * tx * tz;
    const id = a || b || c || d;
    return { f: Math.min(1, f * 1.6), level: id ? t.waterLevel(id) : 0 };
  }

  private buildMesh(n: Node) {
    const M = N + 3;
    const ext = this.buildHeights(n);
    const inner = new Float32Array((N + 1) * (N + 1));
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) inner[j * (N + 1) + i] = ext[(j + 1) * M + i + 1];
    n.heights = inner;
    const geo = n.mesh ? (n.mesh.geometry as THREE.BufferGeometry) : this.gridGeometry();
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
    const w = n.x1 - n.x0;
    const d = n.z1 - n.z0;
    const sx = w / N;
    const sz = d / N;
    let k = 0;
    for (let j = 0; j <= N; j++)
      for (let i = 0; i <= N; i++) {
        pos.setXYZ(k, sx * i, inner[k], sz * j);
        const e = (j + 1) * M + i + 1;
        const nx = (ext[e - 1] - ext[e + 1]) / (2 * sx);
        const nz = (ext[e - M] - ext[e + M]) / (2 * sz);
        const l = Math.sqrt(nx * nx + 1 + nz * nz);
        nrm.setXYZ(k, nx / l, 1 / l, nz / l);
        k++;
      }
    // Skirts hang below the edge vertices to hide LOD cracks.
    const skirt = Math.max(0.05, w * 0.02);
    const edge = edgeIndices();
    for (let e = 0; e < edge.length; e++) {
      const src = edge[e];
      pos.setXYZ(k + e, pos.getX(src), pos.getY(src) - skirt, pos.getZ(src));
      nrm.setXYZ(k + e, nrm.getX(src), nrm.getY(src), nrm.getZ(src));
    }
    pos.needsUpdate = true;
    nrm.needsUpdate = true;
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    if (!n.mesh) {
      const mat = this.template.clone();
      const uniforms = n.uniforms;
      const shared = this.shared;
      mat.customProgramCacheKey = () => 'terrain-v1';
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, shared, uniforms);
        injectTerrainShader(shader);
      };
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(n.x0, 0, n.z0);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.visible = false;
      n.mesh = mesh;
      this.group.add(mesh);
    }
    this.assignImagery(n);
  }

  private gridGeometry(): THREE.BufferGeometry {
    const verts = (N + 1) * (N + 1);
    const edge = edgeIndices();
    const total = verts + edge.length;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(total * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(total * 3), 3));
    const uv = new Float32Array(total * 2);
    for (let j = 0; j <= N; j++)
      for (let i = 0; i <= N; i++) {
        uv[(j * (N + 1) + i) * 2] = i / N;
        uv[(j * (N + 1) + i) * 2 + 1] = j / N;
      }
    for (let e = 0; e < edge.length; e++) {
      uv[(verts + e) * 2] = uv[edge[e] * 2];
      uv[(verts + e) * 2 + 1] = uv[edge[e] * 2 + 1];
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(gridIndex());
    return geo;
  }

  private assignImagery(n: Node) {
    const maxZ = this.source.imageryMaxZoom;
    let found = '';
    let tex: THREE.Texture | null = null;
    let rect = new THREE.Vector4(0, 0, 1, 1);
    if (maxZ > 0) {
      for (let z = Math.min(n.z, maxZ); z >= 6; z--) {
        const s = n.z - z;
        const tx = n.x >> s;
        const ty = n.y >> s;
        const bmp = this.source.getImagery(z, tx, ty);
        if (!bmp) continue;
        const key = `${this.source.imagery}/${z}/${tx}/${ty}`;
        tex = this.texCache.get(key) ?? null;
        if (!tex) {
          tex = new THREE.Texture(bmp);
          tex.flipY = false;
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 4;
          tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.needsUpdate = true;
          this.texCache.set(key, tex);
          if (this.texCache.size > 220) {
            const first = this.texCache.keys().next().value as string;
            this.texCache.get(first)?.dispose();
            this.texCache.delete(first);
          }
        }
        const r = tileToWorldRect(tx, ty, z);
        rect = new THREE.Vector4((n.x0 - r.x0) / (r.x1 - r.x0), (n.z0 - r.z0) / (r.z1 - r.z0), (n.x1 - r.x0) / (r.x1 - r.x0), (n.z1 - r.z0) / (r.z1 - r.z0));
        found = key;
        break;
      }
    }
    n.imgKey = found;
    n.uniforms.uTile.value = tex;
    n.uniforms.uTileRect.value = rect;
    n.uniforms.uUseTile.value = tex ? 1 : 0;
  }

  // ---------------------------------------------------------------------------
  // LOD selection

  update(camera: THREE.PerspectiveCamera, dt: number) {
    this.frame++;
    this.shared.uTime.value += dt;
    const cam = camera.position;
    const rendered: Node[] = [];
    let builds = 0;
    const budget = 10;
    const wantImg = this.source.imageryMaxZoom > 0;
    const visit = (n: Node) => {
      n.used = this.frame;
      const size = n.x1 - n.x0;
      const dx = Math.max(n.x0 - cam.x, 0, cam.x - n.x1);
      const dz = Math.max(n.z0 - cam.z, 0, cam.z - n.z1);
      const dy = Math.max(n.minY - cam.y, 0, cam.y - n.maxY);
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const split = n.z < this.maxZoom && size / Math.max(d, 0.001) > this.lod;
      if (split) {
        if (!n.children) n.children = this.split(n);
        let ready = true;
        for (const c of n.children) {
          if (!c.mesh) {
            if (builds < budget) {
              this.buildMesh(c);
              builds++;
            } else ready = false;
          }
        }
        if (ready) {
          for (const c of n.children) visit(c);
          return;
        }
      }
      if (!n.mesh) {
        this.buildMesh(n);
        builds++;
      }
      rendered.push(n);
      // Streaming requests, nearest first.
      if (n.z >= MIN_STREAM_ZOOM) {
        const ez = Math.min(n.z, ELEVATION_MAX_ZOOM);
        const s = n.z - ez;
        this.source.requestElevation(ez, n.x >> s, n.y >> s, d);
      }
      if (wantImg && n.z >= 6) {
        const iz = Math.min(n.z, this.source.imageryMaxZoom);
        const s = n.z - iz;
        this.source.requestImagery(iz, n.x >> s, n.y >> s, d + 1);
      }
    };
    for (const r of this.roots) visit(r);

    // Refresh nodes that can now use better data.
    if (this.dirty) {
      this.dirty = false;
      let refreshed = 0;
      for (const n of rendered) {
        if (refreshed > 12) {
          this.dirty = true;
          break;
        }
        const src = this.elevationFor(n);
        if ((src ? src.z : 0) > n.elevZoom) {
          this.buildMesh(n);
          refreshed++;
        } else if (wantImg) {
          const before = n.imgKey;
          this.assignImagery(n);
          if (n.imgKey !== before) refreshed++;
        }
      }
    }
    for (const n of this.rendered) if (n.mesh) n.mesh.visible = false;
    for (const n of rendered) n.mesh!.visible = true;
    this.rendered = rendered;
    if (this.frame % 120 === 0) this.prune();
  }

  private split(n: Node): Node[] {
    const out: Node[] = [];
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const c = this.makeNode(n.z + 1, n.x * 2 + dx, n.y * 2 + dy, n);
        if (c) out.push(c);
      }
    return out;
  }

  /** Free subtrees unused for a while. */
  private prune() {
    const stale = this.frame - 240;
    const walk = (n: Node) => {
      if (!n.children) return;
      if (n.children.every((c) => c.used < stale)) {
        for (const c of n.children) this.dispose(c);
        n.children = null;
        return;
      }
      for (const c of n.children) walk(c);
    };
    for (const r of this.roots) walk(r);
  }

  private dispose(n: Node) {
    if (n.children) for (const c of n.children) this.dispose(c);
    if (n.mesh) {
      this.group.remove(n.mesh);
      n.mesh.geometry.dispose();
      (n.mesh.material as THREE.Material).dispose();
      n.mesh = null;
    }
  }

  setImagery(provider: TileSource['imagery']) {
    if (this.source.imagery === provider) return;
    this.source.imagery = provider;
    for (const n of this.rendered) this.assignImagery(n);
    this.dirty = true;
  }

  // ---------------------------------------------------------------------------

  /** Rendered ground height (world y) — matches the visible mesh. */
  heightAt(x: number, z: number): number {
    let node: Node | null = null;
    for (const r of this.roots) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) node = r;
    if (!node) return Math.max(0, this.theater.heightAt(x, z)) * VEX;
    for (;;) {
      if (!node.children) break;
      let next: Node | null = null;
      for (const c of node.children) if (c.heights && x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1) next = c;
      if (!next) break;
      node = next;
    }
    if (!node.heights) return this.theater.heightAt(x, z) * VEX;
    const u = ((x - node.x0) / (node.x1 - node.x0)) * N;
    const v = ((z - node.z0) / (node.z1 - node.z0)) * N;
    return bilinear(node.heights, N + 1, u, v);
  }

  /** Height clamped to the water surface (for placing units and effects). */
  surfaceAt(x: number, z: number): number {
    const h = this.heightAt(x, z);
    const c = this.theater.cellIndex(x, z);
    if (c >= 0 && this.theater.water[c]) return Math.max(h, this.theater.waterLevel(this.theater.water[c]) * VEX);
    return h;
  }

  /** Ray–terrain intersection by marching the height field. */
  raycast(ray: THREE.Ray, maxDist = 20000): THREE.Vector3 | null {
    const p = new THREE.Vector3();
    let t = 0;
    let step = Math.max(0.01, ray.origin.y * 0.02);
    let prevAbove = true;
    let prevT = 0;
    for (let i = 0; i < 600 && t < maxDist; i++) {
      ray.at(t, p);
      const h = Math.max(this.heightAt(p.x, p.z), this.waterAt(p.x, p.z));
      const above = p.y > h;
      if (!above && prevAbove && i > 0) {
        // Refine by bisection.
        let a = prevT;
        let b = t;
        for (let k = 0; k < 12; k++) {
          const m = (a + b) / 2;
          ray.at(m, p);
          if (p.y > Math.max(this.heightAt(p.x, p.z), this.waterAt(p.x, p.z))) a = m;
          else b = m;
        }
        ray.at(b, p);
        return p;
      }
      prevAbove = above;
      prevT = t;
      t += step;
      step = Math.max(0.005, Math.min(step * 1.05, (p.y - h) * 0.5 + 0.005));
    }
    // Fallback: plane y = 0.
    if (ray.direction.y < 0) {
      const tt = -ray.origin.y / ray.direction.y;
      return ray.at(tt, p);
    }
    return null;
  }

  private waterAt(x: number, z: number) {
    const c = this.theater.cellIndex(x, z);
    if (c < 0 || !this.theater.water[c]) return -1e9;
    return this.theater.waterLevel(this.theater.water[c]) * VEX;
  }
}

// ---------------------------------------------------------------------------

function bilinear(data: Float32Array, size: number, u: number, v: number) {
  const max = size - 1;
  u = u < 0 ? 0 : u > max ? max : u;
  v = v < 0 ? 0 : v > max ? max : v;
  const x0 = Math.min(max - 1, Math.floor(u));
  const y0 = Math.min(max - 1, Math.floor(v));
  const tx = u - x0;
  const ty = v - y0;
  const a = data[y0 * size + x0];
  const b = data[y0 * size + x0 + 1];
  const c = data[(y0 + 1) * size + x0];
  const d = data[(y0 + 1) * size + x0 + 1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

let _edge: number[] | null = null;
function edgeIndices(): number[] {
  if (_edge) return _edge;
  const e: number[] = [];
  for (let i = 0; i <= N; i++) e.push(i); // top
  for (let j = 0; j <= N; j++) e.push(j * (N + 1) + N); // right
  for (let i = N; i >= 0; i--) e.push(N * (N + 1) + i); // bottom
  for (let j = N; j >= 0; j--) e.push(j * (N + 1)); // left
  return (_edge = e);
}

let _index: THREE.BufferAttribute | null = null;
function gridIndex(): THREE.BufferAttribute {
  if (_index) return _index;
  const idx: number[] = [];
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i;
      const b = a + 1;
      const c = a + N + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  // Skirt strips
  const base = (N + 1) * (N + 1);
  const edge = edgeIndices();
  for (let e = 0; e < edge.length - 1; e++) {
    const a = edge[e];
    const b = edge[e + 1];
    const as = base + e;
    const bs = base + e + 1;
    idx.push(a, as, b, b, as, bs);
  }
  _index = new THREE.BufferAttribute(new Uint32Array(idx), 1);
  return _index;
}

function injectTerrainShader(shader: { vertexShader: string; fragmentShader: string }) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;\nvarying vec2 vLocal;')
    .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvLocal = uv;');
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
varying vec3 vWorldPos;
varying vec2 vLocal;
uniform sampler2D uBase;
uniform sampler2D uTile;
uniform vec4 uTileRect;
uniform float uUseTile;
uniform vec2 uWorldSize;
uniform vec2 uGrid;
uniform sampler2D uFog;
uniform sampler2D uTerritory;
uniform float uTerritoryAlpha;
uniform float uDetail;
float fowK = 1.0;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y); }
`,
    )
    .replace(
      '#include <map_fragment>',
      `vec2 wuv = vWorldPos.xz / uWorldSize;
vec3 col = texture2D(uBase, wuv).rgb;
if (uUseTile > 0.5) col = texture2D(uTile, mix(uTileRect.xy, uTileRect.zw, vLocal)).rgb;
// Lift Blue Marble's dark tones a touch and add procedural micro-detail up close.
col = pow(col, vec3(0.92)) * 1.06;
float camD = length(cameraPosition - vWorldPos);
float fade = (1.0 - smoothstep(2.0, 30.0, camD)) * uDetail;
if (fade > 0.001) {
  float n = vnoise(vWorldPos.xz * 9.0) * 0.5 + vnoise(vWorldPos.xz * 37.0) * 0.3 + vnoise(vWorldPos.xz * 140.0) * 0.2;
  col *= mix(1.0, 0.8 + 0.4 * n, fade * 0.75);
}
// Political tint (strategic zoom); occupied land is hatched.
vec4 terr = texture2D(uTerritory, wuv);
if (terr.a > 0.01 && uTerritoryAlpha > 0.001) {
  float hatch = terr.a < 0.75 ? step(0.5, fract((vWorldPos.x + vWorldPos.z) / max(1.0, camD * 0.012))) : 1.0;
  col = mix(col, terr.rgb, uTerritoryAlpha * (0.55 + 0.45 * hatch));
}
// Fog of war: unexplored is near-black, explored-but-unseen is dim.
float fv = texture2D(uFog, wuv).r;
fowK = mix(0.4, 1.0, smoothstep(0.05, 0.45, fv)) * mix(0.72, 1.0, smoothstep(0.55, 0.95, fv));
diffuseColor.rgb *= col;`,
    )
    .replace('#include <fog_fragment>', 'gl_FragColor.rgb *= fowK;\n#include <fog_fragment>');
}
