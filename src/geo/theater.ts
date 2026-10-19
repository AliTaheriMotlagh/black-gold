/**
 * Real-world theater data baked by scripts/bake-geo.ts. Pure data + deterministic
 * queries; used by both the simulation and the renderer.
 */

export interface Localized {
  en: string;
  fa: string;
}

export interface CountryMeta {
  idx: number; // 1-based, matches the country layer
  iso: string;
  name: Localized;
  color: string;
  playable: boolean;
  capital?: number; // index into cities
}

export interface CityMeta {
  name: Localized;
  x: number;
  z: number;
  pop: number;
  capital: boolean;
  country: number;
  port: boolean;
}

export interface OilMeta {
  name: string;
  x: number;
  z: number;
  rich: number;
  gas: boolean;
  offshore: boolean;
}

export interface TheaterMeta {
  version: number;
  grid: { w: number; h: number; cell: number };
  world: { w: number; h: number };
  bounds: { lonMin: number; lonMax: number; latMin: number; latMax: number };
  flags: { river: number; road: number; coast: number };
  lakes: { id: number; name: string; level: number }[];
  countries: CountryMeta[];
  cities: CityMeta[];
  oil: OilMeta[];
  borders: number[][];
  rivers: { name: string; w: number; pts: number[] }[];
  roads: { t: number; pts: number[] }[];
  attribution: string;
}

export enum Cover {
  Sea = 0,
  Lake = 1,
  Sand = 2,
  Arid = 3,
  Steppe = 4,
  Farmland = 5,
  Forest = 6,
  Rock = 7,
  Snow = 8,
  Urban = 9,
  Wetland = 10,
}

/** Land speed multiplier per cover class. */
const COVER_SPEED = [0, 0, 0.62, 0.9, 1, 0.85, 0.6, 0.45, 0.35, 0.8, 0.4];

export const FLAG_RIVER = 1;
export const FLAG_ROAD = 2;
export const FLAG_COAST = 4;

export class Theater {
  readonly w: number;
  readonly h: number;
  readonly cell: number;
  readonly worldW: number;
  readonly worldH: number;
  readonly height: Int16Array;
  readonly cover: Uint8Array;
  readonly water: Uint8Array;
  readonly country: Uint8Array;
  readonly flags: Uint8Array;
  /** Land speed multiplier ×100 (0 = impassable). */
  readonly landSpeed: Uint8Array;
  /** 1 where ships can sail. */
  readonly seaPass: Uint8Array;
  /** City index whose territory contains this land cell (-1 none). */
  readonly region: Int16Array;

  constructor(
    readonly meta: TheaterMeta,
    layers: { height: Int16Array; cover: Uint8Array; water: Uint8Array; country: Uint8Array; flags: Uint8Array },
  ) {
    this.w = meta.grid.w;
    this.h = meta.grid.h;
    this.cell = meta.grid.cell;
    this.worldW = meta.world.w;
    this.worldH = meta.world.h;
    this.height = layers.height;
    this.cover = layers.cover;
    this.water = layers.water;
    this.country = layers.country;
    this.flags = layers.flags;
    const n = this.w * this.h;
    this.landSpeed = new Uint8Array(n);
    this.seaPass = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (this.water[i]) {
        this.seaPass[i] = 1;
        continue;
      }
      let s = COVER_SPEED[this.cover[i]];
      const x = i % this.w;
      const z = (i - x) / this.w;
      const hx = this.h0(x + 1, z) - this.h0(x - 1, z);
      const hz = this.h0(x, z + 1) - this.h0(x, z - 1);
      const slope = Math.sqrt(hx * hx + hz * hz) / (this.cell * 2000);
      s *= 1 - Math.min(0.6, slope * 6);
      if (this.flags[i] & FLAG_RIVER) s *= 0.6;
      if (this.flags[i] & FLAG_ROAD) s = Math.max(s, 1.7);
      this.landSpeed[i] = Math.max(1, Math.min(255, Math.round(s * 100)));
    }
    this.region = this.computeRegions();
  }

  private h0(x: number, z: number) {
    x = x < 0 ? 0 : x >= this.w ? this.w - 1 : x;
    z = z < 0 ? 0 : z >= this.h ? this.h - 1 : z;
    return this.height[z * this.w + x];
  }

  /** Multi-source BFS from each city over land of the same country. */
  private computeRegions(): Int16Array {
    const n = this.w * this.h;
    const region = new Int16Array(n).fill(-1);
    let frontier: number[] = [];
    this.meta.cities.forEach((c, i) => {
      const cell = this.cellIndex(c.x, c.z);
      if (cell >= 0 && region[cell] === -1 && !this.water[cell]) {
        region[cell] = i;
        frontier.push(cell);
      }
    });
    while (frontier.length) {
      const next: number[] = [];
      for (const c of frontier) {
        const x = c % this.w;
        const owner = this.country[c];
        const r = region[c];
        if (x > 0) this.claim(c - 1, owner, r, region, next);
        if (x < this.w - 1) this.claim(c + 1, owner, r, region, next);
        if (c >= this.w) this.claim(c - this.w, owner, r, region, next);
        if (c < n - this.w) this.claim(c + this.w, owner, r, region, next);
      }
      frontier = next;
    }
    return region;
  }

  private claim(c: number, owner: number, r: number, region: Int16Array, next: number[]) {
    if (region[c] !== -1 || this.water[c] || this.country[c] !== owner) return;
    region[c] = r;
    next.push(c);
  }

  cellIndex(x: number, z: number): number {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) return -1;
    return cz * this.w + cx;
  }

  inBounds(x: number, z: number) {
    return x >= 0 && z >= 0 && x < this.worldW && z < this.worldH;
  }

  /** Elevation in metres, bilinear. Deterministic. */
  heightAt(x: number, z: number): number {
    const fx = x / this.cell - 0.5;
    const fz = z / this.cell - 0.5;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;
    const a = this.h0(x0, z0);
    const b = this.h0(x0 + 1, z0);
    const c = this.h0(x0, z0 + 1);
    const d = this.h0(x0 + 1, z0 + 1);
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  isWater(x: number, z: number) {
    const c = this.cellIndex(x, z);
    return c < 0 || this.water[c] !== 0;
  }

  countryAt(x: number, z: number): number {
    const c = this.cellIndex(x, z);
    return c < 0 ? 0 : this.country[c];
  }

  /** Land speed multiplier at a point (0 = impassable). */
  speedAt(x: number, z: number): number {
    const c = this.cellIndex(x, z);
    return c < 0 ? 0 : this.landSpeed[c] / 100;
  }

  waterLevel(id: number): number {
    if (id <= 1) return 0;
    return this.meta.lakes.find((l) => l.id === id)?.level ?? 0;
  }
}

/** Fetch + decompress + parse theater.bin.gz. */
export async function loadTheater(url: string, onProgress?: (f: number) => void): Promise<Theater> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Failed to load map data (${res.status})`);
  const total = Number(res.headers.get('content-length') ?? 0);
  let loaded = 0;
  const counted = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctl) {
        loaded += chunk.byteLength;
        if (total && onProgress) onProgress(Math.min(1, loaded / total));
        ctl.enqueue(chunk);
      },
    }),
  );
  // Some hosts transparently gunzip .gz with Content-Encoding; detect the magic bytes.
  const raw = new Uint8Array(await new Response(counted).arrayBuffer());
  const bytes = raw[0] === 0x1f && raw[1] === 0x8b ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()) : raw;
  return parseTheater(bytes);
}

export function parseTheater(bytes: Uint8Array): Theater {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLen = view.getUint32(0, true);
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + jsonLen))) as TheaterMeta;
  const n = meta.grid.w * meta.grid.h;
  let o = 4 + jsonLen;
  const copy = (len: number) => {
    const out = bytes.slice(o, o + len);
    o += len;
    return out;
  };
  const height = new Int16Array(copy(n * 2).buffer);
  return new Theater(meta, { height, cover: copy(n), water: copy(n), country: copy(n), flags: copy(n) });
}
