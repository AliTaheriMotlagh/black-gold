/**
 * Fog of war and sensor detection on the 4 km grid.
 *
 * Only countries with a commander (human or major AI) get vision layers ("slots").
 * Allies share everything. Air units and munitions are found by radars (airSight);
 * stealth units are only revealed at short range.
 */
import type { World } from '../world';
import type { Entity, Projectile } from '../entities';
import { dist2 } from '../dmath';

const MAX_SLOTS = 30;

export class Vision {
  readonly w: number;
  readonly h: number;
  readonly cell: number;
  /** country idx -> slot (-1 = no vision layer). */
  readonly slotOf: Int8Array;
  readonly slotCountry: number[] = [];
  /** Per slot: 1 = currently visible (own sensors only). */
  readonly vis: Uint8Array[] = [];
  /** Per slot: 1 = explored at some point (own + allies). */
  readonly explored: Uint8Array[] = [];
  /** Per entity id: bitmask of slots (own sensors) that detect it. Refreshed on update. */
  private seen = new Map<number, number>();
  private seenProj = new Map<number, number>();
  /** Per slot: mask of slots whose sensors it may use (itself + allies). */
  private shareMask: number[] = [];
  /** Radar circles per slot: x, z, r² triples. */
  private radars: number[][] = [];
  sightMul = 1;
  enabled = true;
  version = 0;

  constructor(private world: World) {
    const t = world.theater;
    this.w = t.w;
    this.h = t.h;
    this.cell = t.cell;
    this.slotOf = new Int8Array(world.countries.length).fill(-1);
  }

  /** Assign slots lazily (countries become major at setup). */
  private ensureSlots() {
    for (const c of this.world.countries) {
      if (!c.major || this.slotOf[c.idx] >= 0 || this.slotCountry.length >= MAX_SLOTS) continue;
      this.slotOf[c.idx] = this.slotCountry.length;
      this.slotCountry.push(c.idx);
      this.vis.push(new Uint8Array(this.w * this.h));
      this.explored.push(new Uint8Array(this.w * this.h));
      this.radars.push([]);
      this.shareMask.push(0);
      // A nation knows the map of its own territory from the start.
      const ex = this.explored[this.explored.length - 1];
      const th = this.world.theater;
      for (let i = 0; i < ex.length; i++) if (th.country[i] === c.idx) ex[i] = 1;
    }
  }

  update() {
    this.ensureSlots();
    const world = this.world;
    const nSlots = this.slotCountry.length;
    for (let s = 0; s < nSlots; s++) {
      this.vis[s].fill(0);
      this.radars[s].length = 0;
      let mask = 0;
      for (let o = 0; o < nSlots; o++) if (world.allied(this.slotCountry[s], this.slotCountry[o])) mask |= 1 << o;
      this.shareMask[s] = mask;
    }
    const storm = world.crises.storm;
    const stamp = (s: number, x: number, z: number, r: number) => {
      if (storm && dist2(x, z, storm.x, storm.z) < storm.r * storm.r) r *= 0.5;
      this.stamp(s, x, z, r * this.sightMul);
    };
    for (const u of world.units) {
      const s = this.slotOf[u.owner];
      if (s < 0) continue;
      stamp(s, u.x, u.z, u.def.sight);
      const air = u.def.airSight ?? 0;
      if (air > 0) this.radars[s].push(u.x, u.z, air * (world.countries[u.owner].has('aesa') ? 1.3 : 1));
    }
    for (const b of world.buildings) {
      const s = this.slotOf[b.owner];
      if (s < 0) continue;
      stamp(s, b.x, b.z, b.def.sight + b.half);
      const air = b.built && !world.countries[b.owner].lowPower ? b.def.airSight ?? 0 : 0;
      if (air > 0) this.radars[s].push(b.x, b.z, air * (world.countries[b.owner].has('aesa') ? 1.3 : 1));
    }
    for (const c of world.cities) {
      const s = this.slotOf[c.owner];
      if (s >= 0) stamp(s, c.x, c.z, c.radius + 4);
    }
    for (let i = world.reveals.length - 1; i >= 0; i--) {
      const r = world.reveals[i];
      if (r.until < world.time) {
        world.reveals.splice(i, 1);
        continue;
      }
      const s = this.slotOf[r.owner];
      if (s >= 0) this.stamp(s, r.x, r.z, r.r);
    }
    // Explored accumulates each slot's own sightings; allies are merged at query time.
    for (let s = 0; s < nSlots; s++) {
      const ex = this.explored[s];
      const v = this.vis[s];
      for (let i = 0; i < v.length; i++) ex[i] |= v[i];
    }
    // Entity detection masks (own sensors only; sharing is applied at query time).
    this.seen.clear();
    for (const u of world.units) this.seen.set(u.id, this.detectMask(u));
    for (const b of world.buildings) this.seen.set(b.id, this.cellMask(b.x, b.z) | this.ownerBit(b.owner));
    this.seenProj.clear();
    for (const p of world.projectiles) if (p.threat) this.seenProj.set(p.id, this.projMask(p));
    this.version++;
  }

  private ownerBit(owner: number) {
    const s = this.slotOf[owner];
    return s >= 0 ? 1 << s : 0;
  }

  private stamp(s: number, x: number, z: number, r: number) {
    const v = this.vis[s];
    const c = this.cell;
    const rr = r + c * 0.5;
    const x0 = Math.max(0, Math.floor((x - rr) / c));
    const x1 = Math.min(this.w - 1, Math.floor((x + rr) / c));
    const z0 = Math.max(0, Math.floor((z - rr) / c));
    const z1 = Math.min(this.h - 1, Math.floor((z + rr) / c));
    const r2 = rr * rr;
    for (let cz = z0; cz <= z1; cz++) {
      const dz = (cz + 0.5) * c - z;
      for (let cx = x0; cx <= x1; cx++) {
        const dx = (cx + 0.5) * c - x;
        if (dx * dx + dz * dz <= r2) v[cz * this.w + cx] = 1;
      }
    }
  }

  private cellMask(x: number, z: number) {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) return 0;
    const i = cz * this.w + cx;
    let m = 0;
    for (let s = 0; s < this.vis.length; s++) if (this.vis[s][i]) m |= 1 << s;
    return m;
  }

  private radarMask(x: number, z: number, mul: number) {
    let m = 0;
    for (let s = 0; s < this.radars.length; s++) {
      const r = this.radars[s];
      for (let i = 0; i < r.length; i += 3) {
        const rad = r[i + 2] * mul;
        if (dist2(r[i], r[i + 1], x, z) <= rad * rad) {
          m |= 1 << s;
          break;
        }
      }
    }
    return m;
  }

  private detectMask(e: Entity): number {
    if (!e.isUnit) return this.cellMask(e.x, e.z);
    const u = e;
    let m = this.ownerBit(u.owner);
    const def = u.def;
    if (def.stealth && u.revealed <= 0) {
      // Stealth: only seen by enemies very close, or by radar at a third of its range.
      const close = def.domain === 'sea' ? 3 : 1.2;
      this.world.hash.query(u.x, u.z, close, this.world.near);
      for (const o of this.world.near) if (o.owner !== u.owner && dist2(o.x, o.z, u.x, u.z) < close * close) m |= this.ownerBit(o.owner);
      if (u.isAir) m |= this.radarMask(u.x, u.z, 0.33);
      return m;
    }
    if (u.isAir) {
      const low = def.flight === 'fpv' || def.flight === 'heli' || def.flight === 'loiter';
      return m | this.radarMask(u.x, u.z, low ? 0.6 : 1) | this.cellMask(u.x, u.z);
    }
    return m | this.cellMask(u.x, u.z);
  }

  private projMask(p: Projectile) {
    return this.radarMask(p.x, p.z, p.radarMul) | this.cellMask(p.x, p.z) | this.ownerBit(p.owner);
  }

  /** Mask of slots whose data `country` may use. */
  private share(country: number): number {
    const s = this.slotOf[country];
    if (s < 0) return 0;
    return this.shareMask[s] ?? 1 << s;
  }

  visible(country: number, x: number, z: number): boolean {
    if (!this.enabled) return true;
    const share = this.share(country);
    if (!share) return true; // minor countries are not fog-limited
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) return false;
    const i = cz * this.w + cx;
    for (let s = 0; s < this.vis.length; s++) if (share & (1 << s) && this.vis[s][i]) return true;
    return false;
  }

  isExplored(country: number, x: number, z: number): boolean {
    if (!this.enabled) return true;
    const share = this.share(country);
    if (!share) return true;
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) return false;
    const i = cz * this.w + cx;
    for (let s = 0; s < this.explored.length; s++) if (share & (1 << s) && this.explored[s][i]) return true;
    return false;
  }

  /** Slots `country` shares vision with (for renderers composing fog). */
  sharedSlots(country: number): number[] {
    const share = this.share(country);
    const out: number[] = [];
    for (let s = 0; s < this.vis.length; s++) if (share & (1 << s)) out.push(s);
    return out;
  }

  detects(country: number, e: Entity): boolean {
    if (e.owner === country) return true;
    if (!this.enabled) return !(e.isUnit && e.def.stealth && e.revealed <= 0);
    const share = this.share(country);
    if (!share) return true;
    const m = this.seen.get(e.id);
    if (m === undefined) return this.visible(country, e.x, e.z); // spawned since last update
    return (m & share) !== 0;
  }

  detectsProjectile(country: number, p: Projectile): boolean {
    const share = this.share(country);
    if (!share) return true;
    const m = this.seenProj.get(p.id);
    if (m === undefined) return (this.radarMask(p.x, p.z, p.radarMul) & share) !== 0;
    return (m & share) !== 0;
  }
}
