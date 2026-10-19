/**
 * Incremental, deterministic A* over the theater grid.
 *
 * - Work is budgeted in node expansions (never wall-clock), so every peer finishes the
 *   same search on the same tick.
 * - Connected components are precomputed: requests across the sea snap to the nearest
 *   reachable cell instead of flooding the whole map.
 * - Paths are string-pulled without leaving cheaper terrain (roads stay roads).
 */

const SQRT2 = 1.4142135623730951;

export interface PathRequest {
  id: number;
  sx: number;
  sz: number;
  gx: number;
  gz: number;
  done: boolean;
  /** World-space waypoints [x0, z0, x1, z1, ...]; empty if unreachable. */
  result: number[];
}

export class PathGrid {
  readonly n: number;
  /** Cost multiplier per cell (0 = blocked). */
  readonly cost: Float32Array;
  readonly comp: Int32Array;
  readonly minCost: number;

  constructor(
    readonly w: number,
    readonly h: number,
    readonly cell: number,
    costOf: (i: number) => number,
  ) {
    this.n = w * h;
    this.cost = new Float32Array(this.n);
    let min = Infinity;
    for (let i = 0; i < this.n; i++) {
      const c = costOf(i);
      this.cost[i] = c;
      if (c > 0 && c < min) min = c;
    }
    this.minCost = min === Infinity ? 1 : min;
    this.comp = this.components();
  }

  private components(): Int32Array {
    const comp = new Int32Array(this.n).fill(-1);
    const stack: number[] = [];
    let id = 0;
    for (let s = 0; s < this.n; s++) {
      if (comp[s] !== -1 || this.cost[s] === 0) continue;
      comp[s] = id;
      stack.push(s);
      while (stack.length) {
        const c = stack.pop()!;
        const x = c % this.w;
        if (x > 0 && comp[c - 1] === -1 && this.cost[c - 1] > 0) (comp[c - 1] = id), stack.push(c - 1);
        if (x < this.w - 1 && comp[c + 1] === -1 && this.cost[c + 1] > 0) (comp[c + 1] = id), stack.push(c + 1);
        if (c >= this.w && comp[c - this.w] === -1 && this.cost[c - this.w] > 0) (comp[c - this.w] = id), stack.push(c - this.w);
        if (c < this.n - this.w && comp[c + this.w] === -1 && this.cost[c + this.w] > 0) (comp[c + this.w] = id), stack.push(c + this.w);
      }
      id++;
    }
    return comp;
  }

  cellAt(x: number, z: number) {
    let cx = Math.floor(x / this.cell);
    let cz = Math.floor(z / this.cell);
    cx = cx < 0 ? 0 : cx >= this.w ? this.w - 1 : cx;
    cz = cz < 0 ? 0 : cz >= this.h ? this.h - 1 : cz;
    return cz * this.w + cx;
  }

  passable(x: number, z: number) {
    if (x < 0 || z < 0) return false;
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    if (cx >= this.w || cz >= this.h) return false;
    return this.cost[cz * this.w + cx] > 0;
  }

  /** Nearest passable cell to `c` (optionally within component), spiral search. */
  nearest(c: number, comp = -1, maxR = 60): number {
    if (this.cost[c] > 0 && (comp < 0 || this.comp[c] === comp)) return c;
    const cx = c % this.w;
    const cz = (c - cx) / this.w;
    for (let r = 1; r <= maxR; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (dx !== -r && dx !== r && dz !== -r && dz !== r) continue;
          const x = cx + dx;
          const z = cz + dz;
          if (x < 0 || z < 0 || x >= this.w || z >= this.h) continue;
          const i = z * this.w + x;
          if (this.cost[i] === 0 || (comp >= 0 && this.comp[i] !== comp)) continue;
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      if (best >= 0) return best;
    }
    return -1;
  }
}

export class Pathfinder {
  private queue: PathRequest[] = [];
  private active: PathRequest | null = null;
  private g: Float64Array;
  private parent: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private gen = 0;
  private heap: Int32Array;
  private heapF: Float64Array;
  private heapN = 0;
  private start = -1;
  private goal = -1;
  private bestNode = -1;
  private bestH = Infinity;
  private expanded = 0;
  private nextId = 1;

  constructor(readonly grid: PathGrid) {
    const n = grid.n;
    this.g = new Float64Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new Int32Array(1 << 16);
    this.heapF = new Float64Array(1 << 16);
  }

  get pending() {
    return this.queue.length + (this.active ? 1 : 0);
  }

  request(sx: number, sz: number, gx: number, gz: number): PathRequest {
    const r: PathRequest = { id: this.nextId++, sx, sz, gx, gz, done: false, result: [] };
    this.queue.push(r);
    return r;
  }

  /** Advance searches by up to `budget` node expansions. */
  step(budget: number) {
    while (budget > 0) {
      if (!this.active) {
        const next = this.queue.shift();
        if (!next) return;
        if (!this.begin(next)) continue;
      }
      budget = this.expand(budget);
    }
  }

  private begin(r: PathRequest): boolean {
    const grid = this.grid;
    const s = grid.nearest(grid.cellAt(r.sx, r.sz));
    if (s < 0) {
      r.done = true;
      return false;
    }
    const comp = grid.comp[s];
    const goal = grid.nearest(grid.cellAt(r.gx, r.gz), comp, 120);
    if (goal < 0) {
      r.done = true;
      return false;
    }
    if (goal === s) {
      r.result = this.finalPoint(r, s, goal);
      r.done = true;
      return false;
    }
    this.gen++;
    if (this.gen === 0xffffffff) {
      this.stamp.fill(0);
      this.closed.fill(0);
      this.gen = 1;
    }
    this.active = r;
    this.start = s;
    this.goal = goal;
    this.heapN = 0;
    this.expanded = 0;
    this.bestNode = s;
    this.bestH = Infinity;
    this.stamp[s] = this.gen;
    this.g[s] = 0;
    this.parent[s] = -1;
    this.push(s, this.h(s));
    return true;
  }

  private h(c: number) {
    const w = this.grid.w;
    const ax = c % w;
    const az = (c - ax) / w;
    const bx = this.goal % w;
    const bz = (this.goal - bx) / w;
    const dx = ax > bx ? ax - bx : bx - ax;
    const dz = az > bz ? az - bz : bz - az;
    const oct = dx > dz ? dx + (SQRT2 - 1) * dz : dz + (SQRT2 - 1) * dx;
    return oct * this.grid.minCost * 1.25;
  }

  private expand(budget: number): number {
    const grid = this.grid;
    const w = grid.w;
    const h = grid.h;
    const cost = grid.cost;
    const gen = this.gen;
    while (this.heapN > 0 && budget > 0) {
      const c = this.pop();
      if (this.closed[c] === gen) continue;
      this.closed[c] = gen;
      budget--;
      this.expanded++;
      if (c === this.goal) {
        this.finish(c);
        return budget;
      }
      const hc = this.h(c);
      if (hc < this.bestH) {
        this.bestH = hc;
        this.bestNode = c;
      }
      const cx = c % w;
      const cz = (c - cx) / w;
      const gc = this.g[c];
      for (let k = 0; k < 8; k++) {
        const dx = k === 0 || k === 4 || k === 5 ? 1 : k === 1 || k === 6 || k === 7 ? -1 : 0;
        const dz = k === 2 || k === 4 || k === 6 ? 1 : k === 3 || k === 5 || k === 7 ? -1 : 0;
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
        const ni = nz * w + nx;
        const nc = cost[ni];
        if (nc === 0 || this.closed[ni] === gen) continue;
        let step: number;
        if (dx !== 0 && dz !== 0) {
          // No corner cutting.
          if (cost[cz * w + nx] === 0 || cost[nz * w + cx] === 0) continue;
          step = SQRT2 * 0.5 * (nc + cost[c]);
        } else step = 0.5 * (nc + cost[c]);
        const ng = gc + step;
        if (this.stamp[ni] === gen && ng >= this.g[ni]) continue;
        this.stamp[ni] = gen;
        this.g[ni] = ng;
        this.parent[ni] = c;
        this.push(ni, ng + this.h(ni));
      }
      // Give up on pathological searches: route to the closest point reached.
      if (this.expanded > 600000) {
        this.finish(this.bestNode);
        return budget;
      }
    }
    if (this.heapN === 0 && this.active) this.finish(this.bestNode);
    return budget;
  }

  private finish(end: number) {
    const r = this.active!;
    this.active = null;
    const cells: number[] = [];
    for (let c = end; c !== -1; c = this.parent[c]) cells.push(c);
    cells.reverse();
    const smooth = this.smooth(cells);
    const out: number[] = [];
    const cs = this.grid.cell;
    const w = this.grid.w;
    for (let i = 1; i < smooth.length; i++) {
      const c = smooth[i];
      out.push(((c % w) + 0.5) * cs, (Math.floor(c / w) + 0.5) * cs);
    }
    if (end === this.goal) {
      if (out.length >= 2) {
        out[out.length - 2] = r.gx;
        out[out.length - 1] = r.gz;
      } else out.push(r.gx, r.gz);
      if (!this.grid.passable(r.gx, r.gz)) {
        out[out.length - 2] = ((end % w) + 0.5) * cs;
        out[out.length - 1] = (Math.floor(end / w) + 0.5) * cs;
      }
    } else if (!out.length) out.push(((end % w) + 0.5) * cs, (Math.floor(end / w) + 0.5) * cs);
    r.result = out;
    r.done = true;
  }

  private finalPoint(r: PathRequest, _s: number, goal: number): number[] {
    if (this.grid.passable(r.gx, r.gz)) return [r.gx, r.gz];
    const w = this.grid.w;
    return [((goal % w) + 0.5) * this.grid.cell, (Math.floor(goal / w) + 0.5) * this.grid.cell];
  }

  /** String pulling that never shortcuts through terrain costlier than the skipped cells. */
  private smooth(cells: number[]): number[] {
    if (cells.length <= 2) return cells;
    const out = [cells[0]];
    let anchor = 0;
    while (anchor < cells.length - 1) {
      let best = anchor + 1;
      let maxCost = this.grid.cost[cells[anchor + 1]];
      for (let j = anchor + 2; j < cells.length && j - anchor < 48; j++) {
        maxCost = Math.max(maxCost, this.grid.cost[cells[j - 1]]);
        if (this.lineOk(cells[anchor], cells[j], maxCost * 1.05)) best = j;
      }
      out.push(cells[best]);
      anchor = best;
    }
    return out;
  }

  private lineOk(a: number, b: number, maxCost: number): boolean {
    const w = this.grid.w;
    let x0 = a % w;
    let z0 = (a - x0) / w;
    const x1 = b % w;
    const z1 = (b - x1) / w;
    const dx = Math.abs(x1 - x0);
    const dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1;
    const sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;
    const cost = this.grid.cost;
    for (;;) {
      const c = cost[z0 * w + x0];
      if (c === 0 || c > maxCost) return false;
      if (x0 === x1 && z0 === z1) return true;
      const e2 = 2 * err;
      if (e2 > -dz && e2 < dx) {
        // Diagonal step: both orthogonal neighbours must be open.
        if (cost[z0 * w + x0 + sx] === 0 || cost[(z0 + sz) * w + x0] === 0) return false;
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

  // --- binary heap ------------------------------------------------------
  private push(node: number, f: number) {
    if (this.heapN >= this.heap.length) {
      const nh = new Int32Array(this.heap.length * 2);
      nh.set(this.heap);
      const nf = new Float64Array(this.heapF.length * 2);
      nf.set(this.heapF);
      this.heap = nh;
      this.heapF = nf;
    }
    let i = this.heapN++;
    const heap = this.heap;
    const hf = this.heapF;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hf[p] < f || (hf[p] === f && heap[p] < node)) break;
      heap[i] = heap[p];
      hf[i] = hf[p];
      i = p;
    }
    heap[i] = node;
    hf[i] = f;
  }

  private pop(): number {
    const heap = this.heap;
    const hf = this.heapF;
    const top = heap[0];
    const n = --this.heapN;
    const node = heap[n];
    const f = hf[n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && (hf[c + 1] < hf[c] || (hf[c + 1] === hf[c] && heap[c + 1] < heap[c]))) c++;
      if (hf[c] > f || (hf[c] === f && heap[c] > node)) break;
      heap[i] = heap[c];
      hf[i] = hf[c];
      i = c;
    }
    heap[i] = node;
    hf[i] = f;
    return top;
  }
}
