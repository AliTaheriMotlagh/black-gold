/**
 * Streams slippy-map tiles (elevation + imagery) with bounded concurrency, priority
 * ordering, de-duplication and LRU eviction. Failures (offline, 404, CORS) are cached
 * as misses so the terrain silently falls back to baked data.
 */

export type ImageryProvider = 'base' | 'gibs' | 's2';

export const IMAGERY: Record<ImageryProvider, { url?: (z: number, x: number, y: number) => string; maxZoom: number; attribution: string }> = {
  base: { maxZoom: 0, attribution: 'NASA Blue Marble' },
  gibs: {
    url: (z, x, y) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/${z}/${y}/${x}.jpeg`,
    maxZoom: 8,
    attribution: 'NASA Blue Marble NG (GIBS)',
  },
  s2: {
    url: (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${z}/${y}/${x}.jpg`,
    maxZoom: 14,
    attribution: 'Sentinel-2 cloudless by EOX (CC BY-NC-SA 4.0, contains modified Copernicus data)',
  },
};

export const ELEVATION_MAX_ZOOM = 11;
const ELEVATION_URL = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

interface Job {
  key: string;
  url: string;
  priority: number;
  kind: 'elev' | 'img';
  resolve: (v: Float32Array | ImageBitmap | null) => void;
}

export class TileSource {
  private elev = new Map<string, Float32Array | null>();
  private img = new Map<string, ImageBitmap | null>();
  private pending = new Map<string, Promise<unknown>>();
  private queue: Job[] = [];
  private active = 0;
  private canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
  imagery: ImageryProvider = 's2';
  streamElevation = true;
  maxConcurrent = 6;
  online = navigator.onLine !== false;
  /** Called when a tile finishes loading (terrain refreshes meshes). */
  onLoad: () => void = () => {};

  get imageryMaxZoom() {
    return IMAGERY[this.imagery].maxZoom;
  }

  getElevation(z: number, x: number, y: number): Float32Array | null | undefined {
    return this.elev.get(`${z}/${x}/${y}`);
  }

  getImagery(z: number, x: number, y: number): ImageBitmap | null | undefined {
    return this.img.get(`${this.imagery}/${z}/${x}/${y}`);
  }

  requestElevation(z: number, x: number, y: number, priority: number) {
    if (!this.streamElevation || !this.online) return;
    const key = `${z}/${x}/${y}`;
    if (this.elev.has(key) || this.pending.has(key)) return this.bump(key, priority);
    this.enqueue({ key, url: ELEVATION_URL(z, x, y), priority, kind: 'elev', resolve: () => {} });
  }

  requestImagery(z: number, x: number, y: number, priority: number) {
    const p = IMAGERY[this.imagery];
    if (!p.url || !this.online) return;
    const key = `${this.imagery}/${z}/${x}/${y}`;
    if (this.img.has(key) || this.pending.has(key)) return this.bump(key, priority);
    this.enqueue({ key, url: p.url(z, x, y), priority, kind: 'img', resolve: () => {} });
  }

  private bump(key: string, priority: number) {
    const j = this.queue.find((q) => q.key === key);
    if (j && priority < j.priority) j.priority = priority;
  }

  private enqueue(job: Job) {
    this.pending.set(job.key, Promise.resolve());
    this.queue.push(job);
    this.pump();
  }

  /** Drop queued (not started) requests: the camera moved on. */
  pruneQueue(keep: (key: string) => boolean) {
    this.queue = this.queue.filter((j) => {
      if (keep(j.key)) return true;
      this.pending.delete(j.key);
      return false;
    });
  }

  private pump() {
    while (this.active < this.maxConcurrent && this.queue.length) {
      let bi = 0;
      for (let i = 1; i < this.queue.length; i++) if (this.queue[i].priority < this.queue[bi].priority) bi = i;
      const job = this.queue.splice(bi, 1)[0];
      this.active++;
      this.run(job).finally(() => {
        this.active--;
        this.pending.delete(job.key);
        this.pump();
      });
    }
  }

  private async run(job: Job) {
    try {
      const res = await fetch(job.url, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const bmp = await createImageBitmap(blob);
      if (job.kind === 'img') {
        this.img.set(job.key, bmp);
        this.evict(this.img, 260);
      } else {
        this.elev.set(job.key, this.decodeTerrarium(bmp));
        bmp.close();
        this.evict(this.elev, 400);
      }
      this.onLoad();
    } catch {
      if (job.kind === 'img') this.img.set(job.key, null);
      else this.elev.set(job.key, null);
    }
  }

  private evict<T>(map: Map<string, T>, max: number) {
    while (map.size > max) {
      const first = map.keys().next().value as string;
      const v = map.get(first);
      if (v && typeof (v as unknown as ImageBitmap).close === 'function') (v as unknown as ImageBitmap).close();
      map.delete(first);
    }
  }

  /** Terrarium PNG: h = R*256 + G + B/256 - 32768 (metres). */
  private decodeTerrarium(bmp: ImageBitmap): Float32Array {
    const w = bmp.width;
    const h = bmp.height;
    if (!this.canvas) {
      this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
    }
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const ctx = this.ctx!;
    ctx.drawImage(bmp, 0, 0);
    const px = ctx.getImageData(0, 0, w, h).data;
    const out = new Float32Array(w * h);
    for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = px[j] * 256 + px[j + 1] + px[j + 2] / 256 - 32768;
    return out;
  }
}
