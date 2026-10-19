import type { Unit } from './entities';

/**
 * Uniform grid of unit buckets. Rebuilt every tick in unit-array order, queried in
 * fixed cell order, so iteration order is identical on every peer.
 */
export class SpatialHash {
  private cols: number;
  private rows: number;
  private heads: Int32Array;
  private next: Int32Array = new Int32Array(1024);
  private items: Unit[] = [];

  constructor(
    worldW: number,
    worldH: number,
    readonly size: number,
  ) {
    this.cols = Math.ceil(worldW / size) + 1;
    this.rows = Math.ceil(worldH / size) + 1;
    this.heads = new Int32Array(this.cols * this.rows).fill(-1);
  }

  rebuild(units: Unit[]) {
    this.heads.fill(-1);
    this.items.length = 0;
    if (this.next.length < units.length) this.next = new Int32Array(units.length * 2);
    // Insert in reverse so each bucket lists units in array order.
    for (let i = units.length - 1; i >= 0; i--) {
      const u = units[i];
      if (!u.alive) continue;
      const k = this.key(u.x, u.z);
      const idx = this.items.length;
      this.items.push(u);
      this.next[idx] = this.heads[k];
      this.heads[k] = idx;
    }
  }

  private key(x: number, z: number) {
    let cx = Math.floor(x / this.size);
    let cz = Math.floor(z / this.size);
    cx = cx < 0 ? 0 : cx >= this.cols ? this.cols - 1 : cx;
    cz = cz < 0 ? 0 : cz >= this.rows ? this.rows - 1 : cz;
    return cz * this.cols + cx;
  }

  /** Units whose position is within the square [x±r, z±r] (caller filters exact range). */
  query(x: number, z: number, r: number, out: Unit[]): Unit[] {
    out.length = 0;
    const s = this.size;
    const x0 = Math.max(0, Math.floor((x - r) / s));
    const x1 = Math.min(this.cols - 1, Math.floor((x + r) / s));
    const z0 = Math.max(0, Math.floor((z - r) / s));
    const z1 = Math.min(this.rows - 1, Math.floor((z + r) / s));
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) {
        for (let i = this.heads[cz * this.cols + cx]; i !== -1; i = this.next[i]) out.push(this.items[i]);
      }
    return out;
  }
}
