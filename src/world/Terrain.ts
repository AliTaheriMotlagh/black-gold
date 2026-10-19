import * as THREE from 'three';
import { CELL, GRID_H, GRID_W, LAT_MAX, LON_MIN, RIVERS, SEAS, SEA_LABELS, WORLD_H, WORLD_W, lonLatToWorld } from '../geo/geography';
import type { MapData } from './heightmap';
import { sampleHeight } from './heightmap';
import { fbm } from './noise';
import { groundText } from '../fx/labels';
import { loc } from '../i18n';

const srgb = (v: number) => Math.pow(v, 2.2);

/** Renders terrain, water, sky, rivers and map lettering. */
export class Terrain {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  readonly water: THREE.Mesh;
  readonly fogOverlay: THREE.Mesh;
  readonly fogTexture: THREE.DataTexture;
  readonly fogData: Uint8Array;
  private labels = new THREE.Group();
  private waterNormal: THREE.Texture;
  readonly minimapImage: HTMLCanvasElement;

  constructor(readonly map: MapData) {
    const geo = this.buildGeometry();
    const detail = makeDetailTexture();
    detail.repeat.set(GRID_W / 2, GRID_H / 2);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, map: detail });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain';
    this.group.add(this.mesh);

    // Water
    this.waterNormal = makeWaterNormal();
    this.waterNormal.repeat.set(40, 32);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x1f6f86,
      roughness: 0.12,
      metalness: 0.2,
      transparent: true,
      opacity: 0.78,
      normalMap: this.waterNormal,
      normalScale: new THREE.Vector2(0.6, 0.6),
    });
    const margin = 260;
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_W + margin * 2, WORLD_H + margin * 2), waterMat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(WORLD_W / 2, 0, WORLD_H / 2);
    this.water.receiveShadow = true;
    this.water.renderOrder = 1;
    this.group.add(this.water);

    this.group.add(this.buildRivers());

    // Fog of war overlay shares the terrain topology (lifted to water level over seas).
    this.fogData = new Uint8Array(GRID_W * GRID_H * 4);
    this.fogTexture = new THREE.DataTexture(this.fogData, GRID_W, GRID_H, THREE.RGBAFormat);
    this.fogTexture.magFilter = THREE.LinearFilter;
    this.fogTexture.minFilter = THREE.LinearFilter;
    this.fogTexture.needsUpdate = true;
    const fogGeo = geo.clone();
    const fp = fogGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < fp.count; i++) fp.setY(i, Math.max(fp.getY(i), 0) + 0.12);
    fogGeo.deleteAttribute('color');
    fogGeo.deleteAttribute('normal');
    this.fogOverlay = new THREE.Mesh(
      fogGeo,
      new THREE.MeshBasicMaterial({ color: 0x06080a, transparent: true, alphaMap: this.fogTexture, depthWrite: false, fog: false }),
    );
    this.fogOverlay.renderOrder = 3;
    this.group.add(this.fogOverlay);

    this.group.add(this.labels);
    this.minimapImage = this.renderMinimap();
  }

  private buildGeometry(): THREE.BufferGeometry {
    const { vw, vh, vHeight, vFertile, vDune, vRock, vRiver, res } = this.map;
    const step = CELL / res;
    const n = vw * vh;
    const pos = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    for (let j = 0; j < vh; j++) {
      for (let i = 0; i < vw; i++) {
        const k = j * vw + i;
        pos[k * 3] = i * step;
        pos[k * 3 + 1] = vHeight[k];
        pos[k * 3 + 2] = j * step;
        uv[k * 2] = (i * step) / WORLD_W;
        uv[k * 2 + 1] = (j * step) / WORLD_H;
      }
    }
    const idx = new Uint32Array((vw - 1) * (vh - 1) * 6);
    let p = 0;
    for (let j = 0; j < vh - 1; j++) {
      for (let i = 0; i < vw - 1; i++) {
        const a = j * vw + i;
        const b = a + 1;
        const c = a + vw;
        const d = c + 1;
        idx[p++] = a;
        idx[p++] = c;
        idx[p++] = b;
        idx[p++] = b;
        idx[p++] = c;
        idx[p++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const normals = geo.attributes.normal as THREE.BufferAttribute;

    const col = new Float32Array(n * 3);
    const stepDeg = 1 / (res * 5);
    for (let j = 0; j < vh; j++) {
      const lat = LAT_MAX - j * stepDeg;
      for (let i = 0; i < vw; i++) {
        const lon = LON_MIN + i * stepDeg;
        const k = j * vw + i;
        const h = vHeight[k];
        let r: number, g: number, b: number;
        if (h < 0.02) {
          const depth = Math.min(1, Math.max(0, -h) / 5);
          r = 0.62 - depth * 0.5;
          g = 0.7 - depth * 0.45;
          b = 0.6 - depth * 0.2;
        } else {
          const nv = fbm(lon * 4, lat * 4, 3, 21);
          const nv2 = fbm(lon * 14, lat * 14, 2, 23);
          // Base desert sand, warmer in the south.
          const warm = Math.max(0, Math.min(1, (34 - lat) / 14));
          r = 0.82 + warm * 0.06;
          g = 0.7 + warm * 0.02;
          b = 0.5 - warm * 0.06;
          // Dunes: orange-red sand
          const dune = vDune[k];
          r = r * (1 - dune * 0.2) + 0.9 * dune * 0.2;
          g = g * (1 - dune * 0.25) + 0.56 * dune * 0.25;
          b = b * (1 - dune * 0.3) + 0.32 * dune * 0.3;
          // Fertile land
          const fert = Math.min(1, vFertile[k] * (0.7 + nv * 0.6));
          r = r * (1 - fert) + 0.42 * fert;
          g = g * (1 - fert) + 0.53 * fert;
          b = b * (1 - fert) + 0.27 * fert;
          // Rock on slopes & ridges
          const ny = normals.getY(k);
          const rock = Math.max(vRock[k] * 0.7, Math.min(1, (0.93 - ny) * 6));
          const rk = Math.max(0, Math.min(1, rock));
          r = r * (1 - rk) + 0.5 * rk;
          g = g * (1 - rk) + 0.42 * rk;
          b = b * (1 - rk) + 0.35 * rk;
          // Snow caps
          const snow = Math.max(0, Math.min(1, (h - 11.5) / 3)) * (ny > 0.6 ? 1 : 0.5);
          r = r * (1 - snow) + 0.96 * snow;
          g = g * (1 - snow) + 0.96 * snow;
          b = b * (1 - snow) + 0.98 * snow;
          // Beaches
          const beach = h < 0.55 ? (0.55 - h) / 0.55 : 0;
          r = r * (1 - beach * 0.5) + 0.94 * beach * 0.5;
          g = g * (1 - beach * 0.5) + 0.88 * beach * 0.5;
          b = b * (1 - beach * 0.5) + 0.7 * beach * 0.5;
          // Rivers
          if (vRiver[k] < 0.09) {
            const t = 1 - vRiver[k] / 0.09;
            r = r * (1 - t) + 0.2 * t;
            g = g * (1 - t) + 0.42 * t;
            b = b * (1 - t) + 0.4 * t;
          }
          const v = 0.88 + nv * 0.18 + (nv2 - 0.5) * 0.08;
          r *= v;
          g *= v;
          b *= v;
        }
        col[k * 3] = srgb(Math.max(0, Math.min(1, r)));
        col[k * 3 + 1] = srgb(Math.max(0, Math.min(1, g)));
        col[k * 3 + 2] = srgb(Math.max(0, Math.min(1, b)));
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
  }

  private buildRivers(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x3b7f86, roughness: 0.2, metalness: 0.15, normalMap: this.waterNormal, polygonOffset: true, polygonOffsetFactor: -1 });
    for (const river of RIVERS) {
      const pts = river.path.map(([lon, lat]) => {
        const w = lonLatToWorld(lon, lat);
        return new THREE.Vector2(w.x, w.z);
      });
      // Densify path
      const dense: THREE.Vector2[] = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const steps = Math.max(1, Math.ceil(a.distanceTo(b) / 1.5));
        for (let s = 0; s < steps; s++) dense.push(a.clone().lerp(b, s / steps));
      }
      dense.push(pts[pts.length - 1]);
      const width = river.width * 4.5;
      const positions: number[] = [];
      const indices: number[] = [];
      for (let i = 0; i < dense.length; i++) {
        const prev = dense[Math.max(0, i - 1)];
        const next = dense[Math.min(dense.length - 1, i + 1)];
        const dir = next.clone().sub(prev).normalize();
        const nx = -dir.y;
        const nz = dir.x;
        const taper = Math.min(1, 0.4 + (i / dense.length) * 1.2);
        const w = width * taper;
        const p = dense[i];
        for (const s of [-1, 1]) {
          const x = p.x + nx * w * s;
          const z = p.y + nz * w * s;
          positions.push(x, Math.min(0.35, Math.max(0.04, sampleHeight(this.map, p.x, p.y))) + 0.1, z);
        }
        if (i > 0) {
          const a = (i - 1) * 2;
          indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const uvs: number[] = [];
      for (let i = 0; i < positions.length / 3; i++) uvs.push((i % 2) * 0.1, i * 0.05);
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true;
      g.add(m);
    }
    return g;
  }

  /** (Re)build localised sea labels. */
  buildLabels() {
    this.labels.clear();
    const all = [...SEAS.map((s) => ({ name: s.name, label: s.label, labelSize: s.labelSize })), ...SEA_LABELS];
    for (const s of all) {
      const w = lonLatToWorld(s.label[0], s.label[1]);
      const m = groundText(loc(s.name), 7 * s.labelSize, { size: 64, color: 'rgba(225,240,245,0.95)', stroke: 'rgba(10,40,60,0.55)', italic: true, weight: 600 });
      m.position.set(w.x, 0.3, w.z);
      this.labels.add(m);
    }
  }

  setLabelsVisible(v: boolean) {
    this.labels.visible = v;
  }

  update(time: number) {
    this.waterNormal.offset.set(time * 0.006, time * 0.004);
  }

  private renderMinimap(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = GRID_W;
    c.height = GRID_H;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(GRID_W, GRID_H);
    const colors = this.mesh.geometry.attributes.color as THREE.BufferAttribute;
    const { vw, res } = this.map;
    for (let z = 0; z < GRID_H; z++) {
      for (let x = 0; x < GRID_W; x++) {
        const k = (z * res + (res >> 1)) * vw + (x * res + (res >> 1));
        const o = (z * GRID_W + x) * 4;
        const water = this.map.cellWater[z * GRID_W + x];
        if (water) {
          img.data[o] = 28;
          img.data[o + 1] = 84;
          img.data[o + 2] = 104;
        } else {
          img.data[o] = Math.pow(colors.getX(k), 1 / 2.2) * 255;
          img.data[o + 1] = Math.pow(colors.getY(k), 1 / 2.2) * 255;
          img.data[o + 2] = Math.pow(colors.getZ(k), 1 / 2.2) * 255;
        }
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }
}

function makeDetailTexture(): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Tileable noise via sum of periodic sines
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;
      const n =
        Math.sin(u * 3 + Math.sin(v * 2) * 1.5) * 0.3 +
        Math.sin(v * 5 + u * 2) * 0.2 +
        Math.sin(u * 11 + v * 7) * 0.12 +
        Math.sin(u * 17 - v * 13) * 0.08;
      const grain = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
      const val = 225 + n * 22 + Math.abs(grain) * 14;
      const o = (y * size + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.max(0, Math.min(255, val));
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function makeWaterNormal(): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const waves = [
    [2, 1, 0.0],
    [-1, 3, 1.3],
    [4, -2, 2.1],
    [5, 5, 0.7],
    [-7, 3, 2.9],
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0;
      let dy = 0;
      for (const [kx, ky, ph] of waves) {
        const a = ((kx * x + ky * y) / size) * Math.PI * 2 + ph;
        const amp = 1 / Math.hypot(kx, ky);
        dx += Math.cos(a) * kx * amp;
        dy += Math.cos(a) * ky * amp;
      }
      const nx = -dx * 0.25;
      const ny = -dy * 0.25;
      const len = Math.hypot(nx, ny, 1);
      const o = (y * size + x) * 4;
      img.data[o] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[o + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[o + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Gradient sky dome with sun glow. */
export function createSky(sunDir: THREE.Vector3): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x4f86c6) },
      horizon: { value: new THREE.Color(0xf0dcb4) },
      sunDir: { value: sunDir.clone().normalize() },
      haze: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform float haze;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 col = mix(horizon, top, pow(h, 0.55));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        col += vec3(1.0, 0.85, 0.6) * (pow(s, 300.0) * 3.0 + pow(s, 8.0) * 0.25);
        col = mix(col, vec3(0.85, 0.6, 0.35), haze);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), mat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  return sky;
}
