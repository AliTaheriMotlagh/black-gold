import type { World } from '../world';
import type { Rng } from '../rng';
import { ECON } from '../defs';
import { Rel } from '../country';
import { clamp, dist2, sqrt } from '../dmath';

/** Brent-style oil price: mean-reverting random walk plus timed shocks. */
export class Market {
  price = ECON.basePrice;
  history: number[] = [];
  private shocks: { mul: number; until: number }[] = [];
  private t = 0;
  private sampleT = 0;

  constructor(private rng: Rng) {
    for (let i = 0; i < 60; i++) this.history.push(this.price);
  }

  get target() {
    let m = 1;
    for (const s of this.shocks) m *= s.mul;
    return ECON.basePrice * m;
  }

  shock(mul: number, seconds: number) {
    this.shocks.push({ mul, until: this.t + seconds });
  }

  update(dt: number) {
    this.t += dt;
    this.shocks = this.shocks.filter((s) => s.until > this.t);
    const noise = (this.rng.next() * 2 - 1) * 2.2 * sqrt(dt);
    this.price += (this.target - this.price) * 0.08 * dt + noise;
    this.price = clamp(this.price, 25, 220);
    this.sampleT += dt;
    if (this.sampleT >= 2) {
      this.sampleT = 0;
      this.history.push(Math.round(this.price * 100) / 100);
      if (this.history.length > 120) this.history.shift();
    }
  }

  get average() {
    let s = 0;
    for (const p of this.history) s += p;
    return s / this.history.length;
  }
}

export type CrisisId = 'tanker' | 'opec' | 'glut' | 'sandstorm' | 'heatwave' | 'earthquake' | 'sabotage' | 'unrest' | 'summit';

const WEIGHTS: [CrisisId, number][] = [
  ['tanker', 3],
  ['opec', 2],
  ['glut', 2],
  ['sandstorm', 3],
  ['heatwave', 2],
  ['earthquake', 1.5],
  ['sabotage', 2],
  ['unrest', 1.5],
  ['summit', 1.5],
];

/** Seismically active countries (real fault zones). */
const QUAKE_ZONES = ['IRN', 'TUR', 'AFG', 'ARM', 'GEO', 'AZE', 'SYR'];

export class Crises {
  enabled = true;
  next = 150;
  heatwave = 0;
  storm: { x: number; z: number; r: number; until: number } | null = null;
  active: { id: CrisisId; until: number }[] = [];

  constructor(private world: World) {}

  update(dt: number) {
    const w = this.world;
    if (this.heatwave > 0) this.heatwave -= dt;
    if (this.storm && this.storm.until < w.time) this.storm = null;
    this.active = this.active.filter((a) => a.until > w.time);
    if (!this.enabled) return;
    this.next -= dt;
    if (this.next > 0) return;
    this.next = w.rng.range(140, 260);
    let total = 0;
    for (const [, wt] of WEIGHTS) total += wt;
    let r = w.rng.next() * total;
    let id: CrisisId = 'tanker';
    for (const [c, wt] of WEIGHTS) {
      r -= wt;
      if (r <= 0) {
        id = c;
        break;
      }
    }
    this.trigger(id);
  }

  trigger(id: CrisisId) {
    const w = this.world;
    const rng = w.rng;
    let x: number | undefined;
    let z: number | undefined;
    let dur = 90;
    switch (id) {
      case 'tanker':
        w.market.shock(1.35, 100);
        break;
      case 'opec':
        w.market.shock(1.2, 140);
        dur = 140;
        break;
      case 'glut':
        w.market.shock(0.72, 120);
        dur = 120;
        break;
      case 'sandstorm': {
        // Arabian Peninsula, Mesopotamia or the Sahara.
        const c = rng.pick(w.cities.filter((ci) => ['SAU', 'IRQ', 'KWT', 'ARE', 'QAT', 'EGY', 'SDN', 'SYR', 'JOR', 'OMN'].includes(w.countries[ci.origin]?.iso ?? '')));
        if (!c) return;
        x = c.x;
        z = c.z;
        dur = 70;
        this.storm = { x, z, r: rng.range(250, 420), until: w.time + dur };
        break;
      }
      case 'heatwave':
        this.heatwave = 90;
        for (const c of w.countries) if (c.alive && c.idx > 0) w.recount(c);
        break;
      case 'earthquake': {
        const c = rng.pick(w.cities.filter((ci) => QUAKE_ZONES.includes(w.countries[ci.origin]?.iso ?? '')));
        if (!c) return;
        x = c.x + rng.range(-40, 40);
        z = c.z + rng.range(-40, 40);
        for (const b of w.buildings) {
          if (!b.alive) continue;
          const d2 = dist2(b.x, b.z, x, z);
          if (d2 < 70 * 70) {
            const dmg = b.maxHp * (0.45 - (sqrt(d2) / 70) * 0.3);
            b.hp = Math.max(1, b.hp - dmg);
            b.lastHurt = w.time;
          }
        }
        for (const ci of w.cities) if (dist2(ci.x, ci.z, x, z) < 80 * 80) w.countries[ci.owner].stability -= 4;
        dur = 20;
        break;
      }
      case 'sabotage': {
        const derricks = w.buildings.filter((b) => b.alive && b.built && b.def.id === 'derrick');
        if (!derricks.length) return;
        const d = rng.pick(derricks);
        x = d.x;
        z = d.z;
        w.applyDamage(d, d.maxHp * 0.6, 'warhead', null, 0);
        if (d.oilField >= 0) w.oil[d.oilField].fire = Math.max(w.oil[d.oilField].fire, 20);
        w.events.push({ t: 'boom', x, y: 0, z, size: 1.5, kind: 'building' });
        dur = 20;
        break;
      }
      case 'unrest': {
        let worst = null as (typeof w.countries)[number] | null;
        for (const c of w.countries) if (c.alive && c.major && (!worst || c.stability < worst.stability)) worst = c;
        if (!worst) return;
        worst.stability = Math.max(0, worst.stability - 15);
        x = worst.startX;
        z = worst.startZ;
        break;
      }
      case 'summit': {
        const pairs: [number, number][] = [];
        const majors = w.countries.filter((c) => c.alive && c.major);
        for (const a of majors)
          for (const b of w.countries) if (b.alive && b.idx > a.idx && w.dip.get(a.idx, b.idx) <= Rel.Hostile) pairs.push([a.idx, b.idx]);
        if (!pairs.length) return;
        const [a, b] = rng.pick(pairs);
        w.dip.addTension(a, b, -25);
        break;
      }
    }
    this.active.push({ id, until: w.time + dur });
    w.events.push({ t: 'crisis', id, x, z });
  }
}
