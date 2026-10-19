import { CELL } from '../geo/geography';
import type { Terrain } from '../world/Terrain';

/** Player fog of war: 0 unexplored, 1 explored, 2 visible. */
export class FogOfWar {
  readonly state: Uint8Array;
  private display: Float32Array;
  private timer = 0;
  private displayTimer = 0;
  enabled = true;

  constructor(readonly w: number, readonly h: number, private terrain: Terrain) {
    this.state = new Uint8Array(w * h);
    this.display = new Float32Array(w * h).fill(0.72);
  }

  reset() {
    this.state.fill(0);
    this.display.fill(0.72);
  }

  isVisible(x: number, z: number): boolean {
    if (!this.enabled) return true;
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) return false;
    return this.state[cz * this.w + cx] === 2;
  }

  isExplored(x: number, z: number): boolean {
    if (!this.enabled) return true;
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) return false;
    return this.state[cz * this.w + cx] >= 1;
  }

  /** Recompute visibility from viewers ({x, z, sight}). */
  update(dt: number, viewers: Iterable<{ x: number; z: number; sight: number }>, sightMult: number) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.15;
      const s = this.state;
      for (let i = 0; i < s.length; i++) if (s[i] === 2) s[i] = 1;
      if (this.enabled) {
        for (const v of viewers) this.stamp(v.x, v.z, v.sight * sightMult);
      } else {
        s.fill(2);
      }
    }
    // Smooth display transitions (with a 3x3 blur to soften cell edges) & upload at ~20 Hz
    this.displayTimer -= dt;
    if (this.displayTimer > 0) return;
    const k = Math.min(1, (0.05 - this.displayTimer) * 6);
    this.displayTimer = 0.05;
    const data = this.terrain.fogData;
    const { w, h } = this;
    const lvl = (s: number) => (s === 2 ? 0 : s === 1 ? 0.42 : 0.72);
    for (let i = 0; i < this.display.length; i++) {
      const x = i % w;
      const z = (i / w) | 0;
      let sum = 0;
      let cnt = 0;
      for (let dz = -1; dz <= 1; dz++) {
        const zz = z + dz;
        if (zz < 0 || zz >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const wt = dx === 0 && dz === 0 ? 4 : dx === 0 || dz === 0 ? 2 : 1;
          sum += lvl(this.state[zz * w + xx]) * wt;
          cnt += wt;
        }
      }
      const target = sum / cnt;
      const d = this.display[i] + (target - this.display[i]) * k;
      this.display[i] = d;
      const v = Math.round(d * 255);
      const o = i * 4;
      data[o] = data[o + 1] = data[o + 2] = data[o + 3] = v;
    }
    this.terrain.fogTexture.needsUpdate = true;
  }

  private stamp(x: number, z: number, radius: number) {
    const r = radius / CELL;
    const cx = x / CELL;
    const cz = z / CELL;
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const z0 = Math.max(0, Math.floor(cz - r));
    const z1 = Math.min(this.h - 1, Math.ceil(cz + r));
    for (let j = z0; j <= z1; j++) {
      const dz = j + 0.5 - cz;
      for (let i = x0; i <= x1; i++) {
        const dx = i + 0.5 - cx;
        if (dx * dx + dz * dz <= r2) this.state[j * this.w + i] = 2;
      }
    }
  }
}
