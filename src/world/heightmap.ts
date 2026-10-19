import {
  CELL,
  DUNE_SEAS,
  GRID_H,
  GRID_W,
  LAT_MAX,
  LON_MIN,
  PLATEAUS,
  RIDGES,
  RIVERS,
  CELLS_PER_DEG,
  distToPolyline,
  isSea,
} from '../geo/geography';
import { fbm } from './noise';

/**
 * Terrain data at two resolutions:
 *  - vertex grid (RES x finer than the gameplay grid) used for rendering
 *  - cell grid (GRID_W x GRID_H) used for pathfinding & gameplay
 */
export interface MapData {
  /** Vertex grid dimensions = GRID * RES + 1 */
  vw: number;
  vh: number;
  res: number;
  /** Heights in world units (y), sea level = 0. */
  vHeight: Float32Array;
  /** 0..1 fertile (river valleys, northern coasts). */
  vFertile: Float32Array;
  /** 0..1 dune intensity. */
  vDune: Float32Array;
  /** 0..1 ridge/rock intensity. */
  vRock: Float32Array;
  /** 1 if sea. */
  vWater: Uint8Array;
  /** Distance to the nearest river (degrees), for rendering river water. */
  vRiver: Float32Array;

  w: number;
  h: number;
  cellHeight: Float32Array;
  cellWater: Uint8Array;
  /** 1 = ground units can traverse. */
  cellPassable: Uint8Array;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function generateMap(res = 2): MapData {
  const vw = GRID_W * res + 1;
  const vh = GRID_H * res + 1;
  const n = vw * vh;
  const step = 1 / (CELLS_PER_DEG * res); // degrees per vertex
  const vWater = new Uint8Array(n);
  const vHeight = new Float32Array(n);
  const vFertile = new Float32Array(n);
  const vDune = new Float32Array(n);
  const vRock = new Float32Array(n);
  const vRiver = new Float32Array(n);
  const vRiverW = new Float32Array(n).fill(0.15);
  const riverWidthAt = (k: number) => vRiverW[k];

  // 1) Sea mask
  for (let j = 0; j < vh; j++) {
    const lat = LAT_MAX - j * step;
    for (let i = 0; i < vw; i++) {
      const lon = LON_MIN + i * step;
      vWater[j * vw + i] = isSea(lon, lat) ? 1 : 0;
    }
  }

  // 2) Distance to coast (in vertices) via two-pass chamfer transform, separately for land and water.
  const distLand = chamfer(vWater, vw, vh, 1); // distance from water for land cells
  const distSea = chamfer(vWater, vw, vh, 0); // distance from land for sea cells

  // 3) Heights
  const vPerDeg = CELLS_PER_DEG * res;
  for (let j = 0; j < vh; j++) {
    const lat = LAT_MAX - j * step;
    for (let i = 0; i < vw; i++) {
      const lon = LON_MIN + i * step;
      const k = j * vw + i;
      if (vWater[k]) {
        const d = distSea[k] / vPerDeg; // degrees from shore
        vHeight[k] = -0.35 - Math.min(d * 9, 5.5) - fbm(lon * 2, lat * 2, 2, 9) * 0.4;
        continue;
      }
      const coast = smoothstep(0, 0.9, distLand[k] / vPerDeg);

      let plateau = 0;
      for (const p of PLATEAUS) {
        const dx = (lon - p.center[0]) / p.radius[0];
        const dy = (lat - p.center[1]) / p.radius[1];
        const r2 = dx * dx + dy * dy;
        plateau = Math.max(plateau, p.height * smoothstep(1.2, 0.55, Math.sqrt(r2)));
      }

      let ridge = 0;
      let rock = 0;
      for (const r of RIDGES) {
        const d = distToPolyline(lon, lat, r.path);
        if (d > r.width * 3) continue;
        const ridged = 1 - Math.abs(fbm(lon * 3.1, lat * 3.1, 3, 5) * 2 - 1); // crest variation
        const g = Math.exp(-((d / r.width) ** 2));
        ridge += r.height * g * (0.65 + 0.55 * ridged);
        rock = Math.max(rock, g);
      }

      let dune = 0;
      for (const ds of DUNE_SEAS) {
        const dx = (lon - ds.center[0]) / ds.radius[0];
        const dy = (lat - ds.center[1]) / ds.radius[1];
        dune = Math.max(dune, ds.height * smoothstep(1.1, 0.5, Math.sqrt(dx * dx + dy * dy)));
      }
      const dunePattern = dune > 0 ? dune * Math.pow(Math.abs(Math.sin(lon * 9 + Math.sin(lat * 4) * 1.6 + lat * 2.2)), 3) : 0;

      let riverD = Infinity;
      let riverW = 0.15;
      for (const rv of RIVERS) {
        const d = distToPolyline(lon, lat, rv.path);
        if (d < riverD) {
          riverD = d;
          riverW = rv.width;
        }
      }
      vRiver[k] = riverD;
      vRiverW[k] = riverW;
      const valley = Math.exp(-((riverD / (riverW * 4)) ** 2));

      const noise = (fbm(lon * 1.3, lat * 1.3, 4, 3) - 0.5) * 1.6 + (fbm(lon * 6, lat * 6, 2, 11) - 0.5) * 0.5;
      let h = 0.35 + coast * (0.8 + plateau + ridge + noise + dunePattern * 0.9);
      h = h - valley * Math.min(h * 0.5, 1.6);
      vHeight[k] = Math.max(0.05, h);

      // Fertility: rivers, Levant & Anatolia & Caspian coasts (wetter north).
      const north = smoothstep(35.5, 39.5, lat);
      const caspian = lat > 36 && lon > 48.5 && lon < 54.5 ? smoothstep(0.9, 0.1, distLand[k] / vPerDeg) * 0.9 : 0;
      const levant = lon < 36.6 && lat > 31.3 && lat < 37 ? smoothstep(1.1, 0.1, distLand[k] / vPerDeg) * 0.6 : 0;
      vFertile[k] = Math.min(1, valley * 1.15 + north * 0.55 + caspian + levant);
      vDune[k] = dune;
      vRock[k] = Math.min(1, rock * 1.2);
    }
  }

  // 3b) Smooth the heightfield (soft coastlines & ridges), then carve river beds.
  blur(vHeight, vw, vh, 2);
  for (let k = 0; k < n; k++) {
    if (vWater[k]) continue;
    const rw = riverWidthAt(k);
    if (vRiver[k] < rw * 1.1) {
      const t = smoothstep(rw * 1.1, rw * 0.55, vRiver[k]);
      vHeight[k] = vHeight[k] * (1 - t) + 0.04 * t;
    }
  }

  // 4) Gameplay cells
  const w = GRID_W;
  const h = GRID_H;
  const cellHeight = new Float32Array(w * h);
  const cellWater = new Uint8Array(w * h);
  const cellPassable = new Uint8Array(w * h);
  for (let cz = 0; cz < h; cz++) {
    for (let cx = 0; cx < w; cx++) {
      let water = 0;
      let maxH = -Infinity;
      let minH = Infinity;
      let sum = 0;
      for (let dz = 0; dz <= res; dz++) {
        for (let dx = 0; dx <= res; dx++) {
          const k = (cz * res + dz) * vw + (cx * res + dx);
          const hv = vHeight[k];
          sum += hv;
          if (hv > maxH) maxH = hv;
          if (hv < minH) minH = hv;
        }
      }
      const center = (cz * res + (res >> 1)) * vw + (cx * res + (res >> 1));
      water = vWater[center];
      const c = cz * w + cx;
      cellWater[c] = water;
      cellHeight[c] = sum / ((res + 1) * (res + 1));
      const slope = (maxH - minH) / CELL;
      cellPassable[c] = !water && slope < 1.05 && maxH < 15 ? 1 : 0;
    }
  }

  keepLargestRegion(cellPassable, w, h);

  return { vw, vh, res, vHeight, vFertile, vDune, vRock, vWater, vRiver, w, h, cellHeight, cellWater, cellPassable };
}

/** Mark every passable cell outside the largest 8-connected region as impassable (no stranded pockets). */
function keepLargestRegion(pass: Uint8Array, w: number, h: number) {
  const comp = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < pass.length; s++) {
    if (!pass[s] || comp[s] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    comp[s] = id;
    stack.push(s);
    while (stack.length) {
      const c = stack.pop()!;
      size++;
      const x = c % w;
      const z = (c / w) | 0;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
          const k = nz * w + nx;
          if (pass[k] && comp[k] < 0) {
            comp[k] = id;
            stack.push(k);
          }
        }
    }
    sizes.push(size);
  }
  const main = sizes.indexOf(Math.max(...sizes));
  for (let i = 0; i < pass.length; i++) if (pass[i] && comp[i] !== main) pass[i] = 0;
}

/** In-place separable box blur (radius 1) repeated `passes` times. */
function blur(a: Float32Array, w: number, h: number, passes: number) {
  const tmp = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        const l = i > 0 ? a[k - 1] : a[k];
        const r = i < w - 1 ? a[k + 1] : a[k];
        tmp[k] = (l + a[k] * 2 + r) / 4;
      }
    }
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        const u = j > 0 ? tmp[k - w] : tmp[k];
        const d = j < h - 1 ? tmp[k + w] : tmp[k];
        a[k] = (u + tmp[k] * 2 + d) / 4;
      }
    }
  }
}

/** Two-pass chamfer distance (in grid steps) from cells where mask != target. */
function chamfer(mask: Uint8Array, w: number, h: number, target: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let k = 0; k < w * h; k++) d[k] = mask[k] === target ? 0 : INF;
  // For land distance (target=1 means water cells are sources) we need sources = cells whose mask == target.
  const D1 = 1;
  const D2 = Math.SQRT2;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      let v = d[k];
      if (v === 0) continue;
      if (i > 0) v = Math.min(v, d[k - 1] + D1);
      if (j > 0) {
        v = Math.min(v, d[k - w] + D1);
        if (i > 0) v = Math.min(v, d[k - w - 1] + D2);
        if (i < w - 1) v = Math.min(v, d[k - w + 1] + D2);
      }
      d[k] = v;
    }
  }
  for (let j = h - 1; j >= 0; j--) {
    for (let i = w - 1; i >= 0; i--) {
      const k = j * w + i;
      let v = d[k];
      if (v === 0) continue;
      if (i < w - 1) v = Math.min(v, d[k + 1] + D1);
      if (j < h - 1) {
        v = Math.min(v, d[k + w] + D1);
        if (i < w - 1) v = Math.min(v, d[k + w + 1] + D2);
        if (i > 0) v = Math.min(v, d[k + w - 1] + D2);
      }
      d[k] = v;
    }
  }
  return d;
}

/** Bilinear height sample at world position. */
export function sampleHeight(map: MapData, x: number, z: number): number {
  const fx = (x / CELL) * map.res;
  const fz = (z / CELL) * map.res;
  const i = Math.max(0, Math.min(map.vw - 2, Math.floor(fx)));
  const j = Math.max(0, Math.min(map.vh - 2, Math.floor(fz)));
  const tx = Math.max(0, Math.min(1, fx - i));
  const tz = Math.max(0, Math.min(1, fz - j));
  const k = j * map.vw + i;
  const a = map.vHeight[k];
  const b = map.vHeight[k + 1];
  const c = map.vHeight[k + map.vw];
  const d = map.vHeight[k + map.vw + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

/** Ground height clamped at sea level (for units/buildings). */
export function groundHeight(map: MapData, x: number, z: number): number {
  return Math.max(0, sampleHeight(map, x, z));
}

export function worldToCell(x: number, z: number): { cx: number; cz: number } {
  return { cx: Math.floor(x / CELL), cz: Math.floor(z / CELL) };
}

export function cellCenter(cx: number, cz: number): { x: number; z: number } {
  return { x: (cx + 0.5) * CELL, z: (cz + 0.5) * CELL };
}

/** Find nearest passable cell (spiral search). */
export function nearestPassable(map: MapData, cx: number, cz: number, blocked?: (c: number) => boolean): { cx: number; cz: number } {
  const ok = (x: number, z: number) =>
    x >= 0 && z >= 0 && x < map.w && z < map.h && map.cellPassable[z * map.w + x] === 1 && !(blocked && blocked(z * map.w + x));
  if (ok(cx, cz)) return { cx, cz };
  for (let r = 1; r < 60; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        if (ok(cx + dx, cz + dz)) return { cx: cx + dx, cz: cz + dz };
      }
    }
  }
  return { cx, cz };
}
