/**
 * Grid A* with octile heuristic, binary heap, no corner cutting, and line-of-sight path smoothing.
 * All buffers are allocated once and reused via a generation counter.
 */
export class Pathfinder {
  private g: Float32Array;
  private f: Float32Array;
  private parent: Int32Array;
  private gen: Uint32Array;
  private closed: Uint32Array;
  private heap: Int32Array;
  private heapSize = 0;
  private stamp = 0;

  constructor(
    readonly w: number,
    readonly h: number,
    /** Returns true if the cell index can be walked on. */
    private walkable: (c: number) => boolean,
  ) {
    const n = w * h;
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.gen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new Int32Array(n);
  }

  /** Returns a list of cell indices from start to goal (inclusive), or null. */
  find(sx: number, sz: number, gx: number, gz: number, maxExpand = 40000): number[] | null {
    const { w, h } = this;
    if (gx < 0 || gz < 0 || gx >= w || gz >= h) return null;
    const goalIdx = this.nearestWalkable(gx, gz);
    if (goalIdx < 0) return null;
    const start = sz * w + sx;
    const gxx = goalIdx % w;
    const gzz = (goalIdx / w) | 0;
    this.stamp++;
    const stamp = this.stamp;
    this.heapSize = 0;

    this.g[start] = 0;
    this.f[start] = this.heur(sx, sz, gxx, gzz);
    this.parent[start] = -1;
    this.gen[start] = stamp;
    this.push(start);

    let bestIdx = start;
    let bestH = this.f[start];
    let expanded = 0;

    while (this.heapSize > 0) {
      const cur = this.pop();
      if (cur === goalIdx) return this.reconstruct(cur);
      if (this.closed[cur] === stamp) continue;
      this.closed[cur] = stamp;
      if (++expanded > maxExpand) break;
      const cx = cur % w;
      const cz = (cur / w) | 0;
      const hc = this.heur(cx, cz, gxx, gzz);
      if (hc < bestH) {
        bestH = hc;
        bestIdx = cur;
      }
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
          const ni = nz * w + nx;
          if (!this.walkable(ni) || this.closed[ni] === stamp) continue;
          if (dx !== 0 && dz !== 0) {
            if (!this.walkable(cz * w + nx) || !this.walkable(nz * w + cx)) continue;
          }
          const cost = this.g[cur] + (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1);
          if (this.gen[ni] !== stamp || cost < this.g[ni]) {
            this.gen[ni] = stamp;
            this.g[ni] = cost;
            this.f[ni] = cost + this.heur(nx, nz, gxx, gzz) * 1.001;
            this.parent[ni] = cur;
            this.push(ni);
          }
        }
      }
    }
    // Unreachable: return a path to the closest reached cell.
    return bestIdx !== start ? this.reconstruct(bestIdx) : null;
  }

  /** Remove intermediate waypoints that have a clear straight line between them. */
  smooth(path: number[]): number[] {
    if (path.length <= 2) return path;
    const out = [path[0]];
    let anchor = 0;
    for (let i = 2; i < path.length; i++) {
      if (!this.lineWalkable(path[anchor], path[i])) {
        out.push(path[i - 1]);
        anchor = i - 1;
      }
    }
    out.push(path[path.length - 1]);
    return out;
  }

  lineWalkable(a: number, b: number): boolean {
    const w = this.w;
    let x0 = a % w;
    let z0 = (a / w) | 0;
    const x1 = b % w;
    const z1 = (b / w) | 0;
    const dx = Math.abs(x1 - x0);
    const dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1;
    const sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;
    for (;;) {
      if (!this.walkable(z0 * w + x0)) return false;
      if (x0 === x1 && z0 === z1) return true;
      const e2 = 2 * err;
      if (e2 > -dz && e2 < dx) {
        // Diagonal step: both orthogonal neighbours must be clear.
        if (!this.walkable(z0 * w + x0 + sx) || !this.walkable((z0 + sz) * w + x0)) return false;
      }
      if (e2 > -dz) {
        err -= dz;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        z0 += sz;
      }
    }
  }

  nearestWalkable(x: number, z: number): number {
    const { w, h } = this;
    if (this.walkable(z * w + x)) return z * w + x;
    for (let r = 1; r < 40; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
          const d = dx * dx + dz * dz;
          if (d < bestD && this.walkable(nz * w + nx)) {
            bestD = d;
            best = nz * w + nx;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  private heur(ax: number, az: number, bx: number, bz: number): number {
    const dx = Math.abs(ax - bx);
    const dz = Math.abs(az - bz);
    return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz);
  }

  private reconstruct(idx: number): number[] {
    const out: number[] = [];
    let c = idx;
    while (c >= 0) {
      out.push(c);
      c = this.parent[c];
    }
    return out.reverse();
  }

  private push(i: number) {
    const heap = this.heap;
    const f = this.f;
    let k = this.heapSize++;
    heap[k] = i;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (f[heap[p]] <= f[heap[k]]) break;
      const tmp = heap[p];
      heap[p] = heap[k];
      heap[k] = tmp;
      k = p;
    }
  }

  private pop(): number {
    const heap = this.heap;
    const f = this.f;
    const top = heap[0];
    const last = heap[--this.heapSize];
    if (this.heapSize > 0) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < this.heapSize && f[heap[l]] < f[heap[m]]) m = l;
        if (r < this.heapSize && f[heap[r]] < f[heap[m]]) m = r;
        if (m === k) break;
        const tmp = heap[m];
        heap[m] = heap[k];
        heap[k] = tmp;
        k = m;
      }
    }
    return top;
  }
}
