/**
 * Bakes the real-world theater into game data.
 *
 *   npx tsx scripts/bake-geo.ts
 *
 * Sources (all public domain / open):
 *  - Elevation + bathymetry: AWS Terrain Tiles (Terrarium encoding, Mapzen/SRTM/GEBCO)
 *  - Imagery: NASA Blue Marble Next Generation via NASA GIBS
 *  - Countries, land, lakes, rivers, roads, populated places: Natural Earth 10m
 *
 * Outputs:
 *  - public/data/theater.bin.gz  gzip of: header(u32 json length) + JSON meta + layers (see src/geo/theater.ts)
 *  - public/data/base.jpg      world-aligned imagery 4096 px wide
 *  - public/data/base-2k.jpg   2048 px variant for low-end devices
 *  - public/data/mini.webp     512 px minimap backdrop
 * Downloads are cached in .cache/geo.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import zlib from 'node:zlib';
import { CELL, GRID_H, GRID_W, LAT_MAX, LAT_MIN, LON_MAX, LON_MIN, WORLD_H, WORLD_W, lonLatToWorld, worldToLonLat } from '../src/geo/projection';
import { OIL_FIELDS_SRC, PLAYABLE, COUNTRY_STYLE, FA_FALLBACK } from './geo-sources';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, '.cache/geo');
const OUT = path.join(ROOT, 'public/data');
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';

async function fetchCached(url: string, name: string): Promise<Buffer> {
  const file = path.join(CACHE, name);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(file, buf);
      return buf;
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw new Error('unreachable');
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

// ---------------------------------------------------------------------------
// Slippy tile mosaics

function lonToTileX(lon: number, z: number) {
  return ((lon + 180) / 360) * 2 ** z;
}
function latToTileY(lat: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

interface Mosaic {
  zoom: number;
  tx0: number;
  ty0: number;
  w: number;
  h: number;
  channels: number;
  data: Uint8Array;
}

async function mosaic(zoom: number, urlFor: (z: number, x: number, y: number) => string, ext: string, tag: string): Promise<Mosaic> {
  const tx0 = Math.floor(lonToTileX(LON_MIN, zoom));
  const tx1 = Math.floor(lonToTileX(LON_MAX, zoom));
  const ty0 = Math.floor(latToTileY(LAT_MAX, zoom));
  const ty1 = Math.floor(latToTileY(LAT_MIN, zoom));
  const nx = tx1 - tx0 + 1;
  const ny = ty1 - ty0 + 1;
  const w = nx * 256;
  const h = ny * 256;
  const channels = 3;
  const data = new Uint8Array(w * h * channels);
  const jobs: [number, number][] = [];
  for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) jobs.push([x, y]);
  let done = 0;
  await pool(jobs, 12, async ([x, y]) => {
    const buf = await fetchCached(urlFor(zoom, x, y), `${tag}-${zoom}-${x}-${y}.${ext}`);
    const { data: px, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== 256 || info.height !== 256) throw new Error(`tile size ${info.width}`);
    const ox = (x - tx0) * 256;
    const oy = (y - ty0) * 256;
    for (let r = 0; r < 256; r++) data.set(px.subarray(r * 256 * 3, (r + 1) * 256 * 3), ((oy + r) * w + ox) * 3);
    if (++done % 50 === 0) process.stdout.write(`  ${tag} ${done}/${jobs.length}\r`);
  });
  console.log(`  ${tag}: ${jobs.length} tiles, ${w}x${h}`);
  return { zoom, tx0, ty0, w, h, channels, data };
}

/** Mosaic pixel coordinates for a world point. */
function mosaicPx(m: Mosaic, x: number, z: number) {
  const { lon, lat } = worldToLonLat(x, z);
  return { px: (lonToTileX(lon, m.zoom) - m.tx0) * 256, py: (latToTileY(lat, m.zoom) - m.ty0) * 256 };
}

// ---------------------------------------------------------------------------
// Geometry helpers

type Ring = [number, number][]; // world km
type Poly = Ring[]; // outer + holes

function projectRing(ring: number[][]): Ring {
  return ring.map(([lon, lat]) => {
    const w = lonLatToWorld(lon, Math.max(-85, Math.min(85, lat)));
    return [w.x, w.z];
  });
}

function geomPolys(g: { type: string; coordinates: unknown }): Poly[] {
  if (g.type === 'Polygon') return [(g.coordinates as number[][][]).map(projectRing)];
  if (g.type === 'MultiPolygon') return (g.coordinates as number[][][][]).map((p) => p.map(projectRing));
  return [];
}

function geomLines(g: { type: string; coordinates: unknown }): Ring[] {
  if (g.type === 'LineString') return [projectRing(g.coordinates as number[][])];
  if (g.type === 'MultiLineString') return (g.coordinates as number[][][]).map(projectRing);
  return [];
}

/** Even-odd scanline fill of polygons onto the cell grid; calls set(cellIndex). */
function rasterize(polys: Poly[], set: (c: number) => void) {
  const rows: number[][][] = [];
  for (const poly of polys)
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const zmin = Math.min(a[1], b[1]);
        const zmax = Math.max(a[1], b[1]);
        const r0 = Math.max(0, Math.ceil(zmin / CELL - 0.5));
        const r1 = Math.min(GRID_H - 1, Math.floor(zmax / CELL - 0.5));
        for (let r = r0; r <= r1; r++) {
          const zc = (r + 0.5) * CELL;
          if (zc < zmin || zc >= zmax) continue;
          const t = (zc - a[1]) / (b[1] - a[1]);
          (rows[r] ??= [[]])[0].push(a[0] + (b[0] - a[0]) * t);
        }
      }
    }
  for (let r = 0; r < GRID_H; r++) {
    const xs = rows[r]?.[0];
    if (!xs) continue;
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const c0 = Math.max(0, Math.ceil(xs[i] / CELL - 0.5));
      const c1 = Math.min(GRID_W - 1, Math.floor(xs[i + 1] / CELL - 0.5));
      for (let c = c0; c <= c1; c++) set(r * GRID_W + c);
    }
  }
}

function simplify(pts: Ring, tol: number): Ring {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    const [ax, az] = pts[i0];
    const [bx, bz] = pts[i1];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz) || 1e-9;
    let best = -1;
    let bestD = tol;
    for (let i = i0 + 1; i < i1; i++) {
      const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / len;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([i0, best], [best, i1]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Clip a polyline to the world rect (+margin); returns pieces inside. */
function clipLine(line: Ring, margin = 20): Ring[] {
  const inside = (p: [number, number]) => p[0] >= -margin && p[1] >= -margin && p[0] <= WORLD_W + margin && p[1] <= WORLD_H + margin;
  const out: Ring[] = [];
  let cur: Ring = [];
  for (const p of line) {
    if (inside(p)) cur.push(p);
    else if (cur.length) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out.filter((l) => l.length > 1);
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const flat = (l: Ring) => l.flatMap(([x, z]) => [round1(x), round1(z)]);

// ---------------------------------------------------------------------------

interface Feature {
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown } | null;
}
async function ne(name: string): Promise<Feature[]> {
  const buf = await fetchCached(`${NE}${name}.geojson`, `${name}.geojson`);
  return (JSON.parse(buf.toString('utf8')) as { features: Feature[] }).features;
}

const P = (f: Feature, k: string) => (f.properties[k] ?? f.properties[k.toLowerCase()] ?? f.properties[k.toUpperCase()]) as string | number | undefined;

async function main() {
  const N = GRID_W * GRID_H;
  console.log(`Grid ${GRID_W}x${GRID_H} cells of ${CELL} km, world ${WORLD_W.toFixed(0)}x${WORLD_H.toFixed(0)} km`);

  // --- Elevation -----------------------------------------------------------
  console.log('Elevation…');
  const elev = await mosaic(7, (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, 'png', 'terrarium');
  const elevAt = (px: number, py: number) => {
    const ix = Math.max(0, Math.min(elev.w - 1, Math.floor(px)));
    const iy = Math.max(0, Math.min(elev.h - 1, Math.floor(py)));
    const o = (iy * elev.w + ix) * 3;
    return elev.data[o] * 256 + elev.data[o + 1] + elev.data[o + 2] / 256 - 32768;
  };
  const height = new Int16Array(N);
  const heightMax = new Int16Array(N);
  for (let r = 0; r < GRID_H; r++)
    for (let c = 0; c < GRID_W; c++) {
      const a = mosaicPx(elev, c * CELL, r * CELL);
      const b = mosaicPx(elev, (c + 1) * CELL, (r + 1) * CELL);
      let sum = 0;
      let n = 0;
      let mx = -1e9;
      for (let py = Math.floor(a.py); py <= Math.floor(b.py); py++)
        for (let px = Math.floor(a.px); px <= Math.floor(b.px); px++) {
          const h = elevAt(px, py);
          sum += h;
          n++;
          if (h > mx) mx = h;
        }
      height[r * GRID_W + c] = Math.round(sum / n);
      heightMax[r * GRID_W + c] = Math.round(mx);
    }

  // --- Imagery ---------------------------------------------------------------
  console.log('Imagery…');
  const img = await mosaic(
    7,
    (z, x, y) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/${z}/${y}/${x}.jpeg`,
    'jpg',
    'bmng',
  );
  const a = mosaicPx(img, 0, 0);
  const b = mosaicPx(img, WORLD_W, WORLD_H);
  const crop = { left: Math.round(a.px), top: Math.round(a.py), width: Math.round(b.px - a.px), height: Math.round(b.py - a.py) };
  const full = sharp(Buffer.from(img.data), { raw: { width: img.w, height: img.h, channels: 3 } }).extract(crop);
  const cropped = await full.raw().toBuffer();
  const mk = (w: number) => sharp(cropped, { raw: { width: crop.width, height: crop.height, channels: 3 } }).resize(w, Math.round((w * WORLD_H) / WORLD_W), { kernel: 'lanczos3' });
  await mk(4096).jpeg({ quality: 84, mozjpeg: true }).toFile(path.join(OUT, 'base.jpg'));
  await mk(2048).jpeg({ quality: 82, mozjpeg: true }).toFile(path.join(OUT, 'base-2k.jpg'));
  await mk(512).webp({ quality: 80 }).toFile(path.join(OUT, 'mini.webp'));
  // Imagery colour per cell, used for land-cover classification.
  const cellImg = await sharp(cropped, { raw: { width: crop.width, height: crop.height, channels: 3 } }).resize(GRID_W, GRID_H, { kernel: 'cubic' }).raw().toBuffer();

  // --- Land / water ---------------------------------------------------------
  console.log('Land, lakes, countries…');
  const land = new Uint8Array(N);
  rasterize((await ne('ne_10m_land')).flatMap((f) => (f.geometry ? geomPolys(f.geometry) : [])), (c) => (land[c] = 1));
  const water = new Uint8Array(N); // 0 land, 1 sea, 2+ lake id
  for (let i = 0; i < N; i++) water[i] = land[i] ? 0 : 1;
  const lakes: { id: number; name: string; level: number }[] = [];
  const lakeFeats = (await ne('ne_10m_lakes')).filter((f) => f.geometry && Number(P(f, 'scalerank') ?? 9) <= 6);
  for (const f of lakeFeats) {
    const id = lakes.length + 2;
    if (id > 250) break;
    const cells: number[] = [];
    rasterize(geomPolys(f.geometry!), (c) => cells.push(c));
    if (cells.length < 3) continue;
    const name = String(P(f, 'name') ?? '');
    // A lake inside the "sea" area (e.g. the Caspian) is still a separate body with its own level.
    const hs = cells.map((c) => height[c]).sort((p, q) => p - q);
    const level = name.includes('Caspian') ? -28 : hs[Math.floor(hs.length * 0.15)];
    for (const c of cells) water[c] = id;
    lakes.push({ id, name, level });
  }
  // Sea cells that are below the Caspian depression but disconnected from the ocean: treat
  // any non-land cell not reachable from the map edge as part of the nearest lake.
  {
    const seen = new Uint8Array(N);
    const q: number[] = [];
    for (let c = 0; c < GRID_W; c++) q.push(c, (GRID_H - 1) * GRID_W + c);
    for (let r = 0; r < GRID_H; r++) q.push(r * GRID_W, r * GRID_W + GRID_W - 1);
    for (const c of q) seen[c] = 1;
    while (q.length) {
      const c = q.pop()!;
      if (water[c] !== 1) continue;
      const x = c % GRID_W;
      const y = (c - x) / GRID_W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
        const n = ny * GRID_W + nx;
        if (!seen[n]) {
          seen[n] = 1;
          q.push(n);
        }
      }
    }
    let caspian = lakes.find((l) => l.name.includes('Caspian'));
    if (!caspian) {
      caspian = { id: lakes.length + 2, name: 'Caspian Sea', level: -28 };
      lakes.push(caspian);
    }
    let fixed = 0;
    for (let i = 0; i < N; i++) {
      if (water[i] !== 1) continue;
      const x = i % GRID_W;
      const { lon, lat } = worldToLonLat((x + 0.5) * CELL, ((i - x) / GRID_W + 0.5) * CELL);
      // The Caspian touches the map's north edge, so flood fill alone can't separate it.
      const inCaspianBox = lon > 46.5 && lon < 55.5 && lat > 36.4;
      if (!seen[i] || inCaspianBox) {
        water[i] = caspian.id;
        fixed++;
      }
    }
    if (fixed) console.log(`  ${fixed} enclosed sea cells assigned to ${caspian?.name}`);
  }

  // --- Countries ------------------------------------------------------------
  const countryFeats = (await ne('ne_10m_admin_0_countries')).filter((f) => f.geometry);
  const country = new Uint8Array(N);
  const countries: {
    idx: number;
    iso: string;
    name: { en: string; fa: string };
    color: string;
    playable: boolean;
    capital?: number;
    cells: number;
  }[] = [];
  const isoOf = (f: Feature) => {
    const iso = String(P(f, 'ADM0_A3') ?? P(f, 'ISO_A3'));
    return iso === 'SDS' ? 'SSD' : ({ ESB: 'CYP', WSB: 'CYP', CNM: 'CYP' } as Record<string, string>)[iso] ?? iso;
  };
  for (const f of countryFeats) {
    const iso = isoOf(f);
    if (iso === 'BRT') continue; // Bir Tawil: unclaimed
    const existing = countries.find((c) => c.iso === iso);
    const cells: number[] = [];
    rasterize(geomPolys(f.geometry!), (c) => {
      if (water[c] === 0) cells.push(c);
    });
    if (existing) {
      for (const c of cells) country[c] = existing.idx;
      existing.cells += cells.length;
      continue;
    }
    if (cells.length < 4) continue;
    const idx = countries.length + 1;
    for (const c of cells) country[c] = idx;
    const style = COUNTRY_STYLE[iso];
    countries.push({
      idx,
      iso,
      name: { en: String(P(f, 'NAME_EN') ?? P(f, 'NAME')), fa: String(P(f, 'NAME_FA') ?? FA_FALLBACK[iso] ?? P(f, 'NAME')) },
      color: style ?? '#8a8f98',
      playable: PLAYABLE.includes(iso),
      cells: cells.length,
    });
  }
  // Fill land cells left unassigned (rasterization gaps along coasts) from neighbours.
  for (let pass = 0; pass < 6; pass++)
    for (let i = 0; i < N; i++)
      if (!water[i] && !country[i]) {
        const x = i % GRID_W;
        for (const n of [i - 1, i + 1, i - GRID_W, i + GRID_W]) {
          if (n < 0 || n >= N || (n === i - 1 && x === 0) || (n === i + 1 && x === GRID_W - 1)) continue;
          if (country[n]) {
            country[i] = country[n];
            break;
          }
        }
      }
  console.log(`  ${countries.length} countries, ${countries.filter((c) => c.playable).length} playable`);

  // --- Rivers, roads ------------------------------------------------------
  console.log('Rivers, roads…');
  const FLAG_RIVER = 1;
  const FLAG_ROAD = 2;
  const FLAG_COAST = 4;
  const flags = new Uint8Array(N);
  const stampLine = (l: Ring, bit: number) => {
    for (let i = 0; i + 1 < l.length; i++) {
      const [ax, az] = l[i];
      const [bx, bz] = l[i + 1];
      const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / (CELL * 0.5)) + 1;
      for (let s = 0; s <= steps; s++) {
        const x = ax + ((bx - ax) * s) / steps;
        const z = az + ((bz - az) * s) / steps;
        const cx = Math.floor(x / CELL);
        const cz = Math.floor(z / CELL);
        if (cx >= 0 && cz >= 0 && cx < GRID_W && cz < GRID_H) flags[cz * GRID_W + cx] |= bit;
      }
    }
  };
  const rivers: { name: string; w: number; pts: number[] }[] = [];
  for (const f of await ne('ne_10m_rivers_lake_centerlines')) {
    if (!f.geometry || Number(P(f, 'scalerank') ?? 99) > 7) continue;
    if (String(P(f, 'featurecla')).includes('Lake')) continue;
    for (const l of geomLines(f.geometry))
      for (const piece of clipLine(l)) {
        const s = simplify(piece, 1.2);
        if (s.length < 2) continue;
        stampLine(s, FLAG_RIVER);
        const sr = Number(P(f, 'scalerank') ?? 6);
        rivers.push({ name: String(P(f, 'name') ?? ''), w: sr <= 2 ? 1.4 : sr <= 4 ? 0.9 : 0.6, pts: flat(s) });
      }
  }
  const roads: { t: number; pts: number[] }[] = [];
  for (const f of await ne('ne_10m_roads')) {
    if (!f.geometry) continue;
    const type = String(P(f, 'type') ?? '');
    const sr = Number(P(f, 'scalerank') ?? 99);
    if (sr > 8 || type === 'Ferry Route' || type === 'Unknown') continue;
    const t = type === 'Major Highway' ? 0 : type === 'Secondary Highway' ? 1 : 2;
    for (const l of geomLines(f.geometry))
      for (const piece of clipLine(l, 0)) {
        const s = simplify(piece, 0.8);
        if (s.length < 2) continue;
        stampLine(s, FLAG_ROAD);
        roads.push({ t, pts: flat(s) });
      }
  }
  // Coast flag: land next to sea (ports, naval landings, shipyard placement)
  for (let i = 0; i < N; i++) {
    if (water[i]) continue;
    const x = i % GRID_W;
    for (const n of [i - 1, i + 1, i - GRID_W, i + GRID_W]) {
      if (n < 0 || n >= N || (n === i - 1 && x === 0) || (n === i + 1 && x === GRID_W - 1)) continue;
      if (water[n]) {
        flags[i] |= FLAG_COAST;
        break;
      }
    }
  }

  // --- Borders (render) ---------------------------------------------------
  const borders: number[][] = [];
  for (const f of await ne('ne_10m_admin_0_boundary_lines_land')) {
    if (!f.geometry) continue;
    for (const l of geomLines(f.geometry)) for (const piece of clipLine(l, 2)) borders.push(flat(simplify(piece, 0.6)));
  }

  // --- Land cover ---------------------------------------------------------
  // 0 sea 1 lake 2 sand 3 arid 4 steppe 5 farmland 6 forest 7 rock 8 snow 9 urban 10 wetland
  console.log('Land cover…');
  const cover = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (water[i] === 1) {
      cover[i] = 0;
      continue;
    }
    if (water[i] > 1) {
      cover[i] = 1;
      continue;
    }
    const r = cellImg[i * 3];
    const g = cellImg[i * 3 + 1];
    const bl = cellImg[i * 3 + 2];
    const h = height[i];
    const x = i % GRID_W;
    const y = (i - x) / GRID_W;
    const hx = height[y * GRID_W + Math.min(GRID_W - 1, x + 1)] - height[y * GRID_W + Math.max(0, x - 1)];
    const hz = height[Math.min(GRID_H - 1, y + 1) * GRID_W + x] - height[Math.max(0, y - 1) * GRID_W + x];
    const slope = Math.hypot(hx, hz) / (CELL * 2000); // rise/run
    const bright = (r + g + bl) / 3;
    const green = g - (r + bl) / 2;
    const { lat } = worldToLonLat(x * CELL, y * CELL);
    if (bright > 200 && heightMax[i] > 2800) cover[i] = 8;
    else if (heightMax[i] > 4200 || (heightMax[i] > 3300 && lat > 36)) cover[i] = 8;
    else if (slope > 0.06 || heightMax[i] - h > 900) cover[i] = 7;
    else if (bright < 60 && green > 12) cover[i] = 6;
    else if (bright < 100 && green > 9) cover[i] = 5;
    else if (flags[i] & FLAG_RIVER && bright < 130 && h < 1200) cover[i] = 5;
    else if (bright < 136) cover[i] = 4;
    else if (bright > 145 && r - bl > 60) cover[i] = 2;
    else cover[i] = 3;
    if (h < 12 && bright < 110 && green > 4 && flags[i] & (FLAG_RIVER | FLAG_COAST)) cover[i] = 10;
  }

  // --- Cities -----------------------------------------------------------------
  console.log('Cities…');
  const cityFeats = (await ne('ne_10m_populated_places')).filter((f) => f.geometry);
  type City = { name: { en: string; fa: string }; x: number; z: number; pop: number; capital: boolean; country: number; port: boolean };
  let cities: City[] = [];
  for (const f of cityFeats) {
    const [lon, lat] = (f.geometry!.coordinates as number[]).slice(0, 2);
    if (lon < LON_MIN + 0.3 || lon > LON_MAX - 0.3 || lat < LAT_MIN + 0.3 || lat > LAT_MAX - 0.3) continue;
    const pop = Number(P(f, 'POP_MAX') ?? 0);
    const cla = String(P(f, 'FEATURECLA') ?? '');
    const capital = cla.startsWith('Admin-0 capital') && !cla.includes('alt');
    if (pop < 250_000 && !capital) continue;
    const w = lonLatToWorld(lon, lat);
    let ci = Math.floor(w.z / CELL) * GRID_W + Math.floor(w.x / CELL);
    if (water[ci]) {
      // Snap coastal cities onto land.
      let best = -1;
      let bd = 1e9;
      for (let dz = -3; dz <= 3; dz++)
        for (let dx = -3; dx <= 3; dx++) {
          const n = ci + dz * GRID_W + dx;
          if (n >= 0 && n < N && !water[n] && dx * dx + dz * dz < bd) {
            bd = dx * dx + dz * dz;
            best = n;
          }
        }
      if (best < 0) continue;
      ci = best;
      w.x = ((ci % GRID_W) + 0.5) * CELL;
      w.z = (Math.floor(ci / GRID_W) + 0.5) * CELL;
    }
    const en = String(P(f, 'NAME_EN') ?? P(f, 'NAME'));
    cities.push({
      name: { en, fa: String(P(f, 'NAME_FA') ?? en) },
      x: round1(w.x),
      z: round1(w.z),
      pop,
      capital,
      country: country[ci],
      port: !!(flags[ci] & FLAG_COAST),
    });
  }
  // De-duplicate near-coincident cities (keep the larger) and cap the count.
  cities.sort((p, q) => Number(q.capital) - Number(p.capital) || q.pop - p.pop);
  const kept: City[] = [];
  for (const c of cities) {
    if (kept.some((k) => Math.hypot(k.x - c.x, k.z - c.z) < (c.capital ? 8 : 40))) continue;
    kept.push(c);
    if (kept.length >= 170) break;
  }
  cities = kept;
  for (const co of countries) {
    const cap = cities.findIndex((c) => c.capital && c.country === co.idx);
    if (cap >= 0) co.capital = cap;
    else {
      // Countries whose capital is off-map: promote their largest in-theater city.
      const big = cities.findIndex((c) => c.country === co.idx);
      if (big >= 0) co.capital = big;
    }
    if (co.playable && co.capital === undefined) co.playable = false;
  }

  // --- Oil fields -------------------------------------------------------------
  const oil: { name: string; x: number; z: number; rich: number; gas: boolean; offshore: boolean }[] = [];
  for (const o of OIL_FIELDS_SRC) {
    const w = lonLatToWorld(o.ll[0], o.ll[1]);
    const ci = Math.floor(w.z / CELL) * GRID_W + Math.floor(w.x / CELL);
    oil.push({ name: o.name, x: round1(w.x), z: round1(w.z), rich: o.rich, gas: !!o.gas, offshore: water[ci] !== 0 });
  }

  // --- Write ------------------------------------------------------------------
  const meta = {
    version: 1,
    grid: { w: GRID_W, h: GRID_H, cell: CELL },
    world: { w: WORLD_W, h: WORLD_H },
    bounds: { lonMin: LON_MIN, lonMax: LON_MAX, latMin: LAT_MIN, latMax: LAT_MAX },
    layers: ['height:i16', 'cover:u8', 'water:u8', 'country:u8', 'flags:u8'],
    flags: { river: FLAG_RIVER, road: FLAG_ROAD, coast: FLAG_COAST },
    lakes,
    countries: countries.map(({ cells: _c, ...rest }) => rest),
    cities,
    oil,
    borders,
    rivers,
    roads,
    attribution: 'Elevation: AWS Terrain Tiles (SRTM, GMTED, ETOPO1). Imagery: NASA Blue Marble NG (GIBS). Vector data: Natural Earth.',
  };
  const json = Buffer.from(JSON.stringify(meta), 'utf8');
  const pad = (4 - ((4 + json.length) % 4)) % 4;
  const head = Buffer.alloc(4);
  head.writeUInt32LE(json.length + pad);
  const parts = [head, json, Buffer.alloc(pad, 32), Buffer.from(height.buffer), Buffer.from(cover), Buffer.from(water), Buffer.from(country), Buffer.from(flags)];
  // Pre-compressed: static hosts do not reliably compress application/octet-stream.
  fs.writeFileSync(path.join(OUT, 'theater.bin.gz'), zlib.gzipSync(Buffer.concat(parts), { level: 9 }));
  const kb = (f: string) => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0) + ' KB';
  console.log(`theater.bin.gz ${kb('theater.bin.gz')} (json ${(json.length / 1024).toFixed(0)} KB), base.jpg ${kb('base.jpg')}, base-2k.jpg ${kb('base-2k.jpg')}`);
  console.log(`${cities.length} cities, ${oil.length} oil fields, ${rivers.length} river lines, ${roads.length} road lines, ${borders.length} border lines, ${lakes.length} lakes`);
  console.log('Playable:', countries.filter((c) => c.playable).map((c) => c.iso).join(' '));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
