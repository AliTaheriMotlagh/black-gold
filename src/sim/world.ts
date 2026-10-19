/**
 * The authoritative, deterministic game simulation. No DOM, no Three.js, no Math.random,
 * no wall-clock. Every peer runs `step(commands)` at 20 Hz with identical inputs.
 */
import type { Theater } from '../geo/theater';
import { FLAG_COAST } from '../geo/theater';
import { BUILDINGS, DAMAGE, DT, ECON, TICK_RATE, UNITS, type Delivery, type SfxName, type StrikeKind } from './defs';
import { Building, City, type Entity, OilField, type Projectile, Unit } from './entities';
import { Country, type Difficulty, Diplomacy, Rel } from './country';
import { Rng } from './rng';
import { PathGrid, Pathfinder } from './path';
import { SpatialHash } from './spatial';
import { Vision } from './systems/vision';
import { Market, Crises } from './systems/events';
import { updateMovement } from './systems/movement';
import { updateCombat } from './systems/combat';
import { updateProjectiles } from './systems/projectiles';
import { updateProduction } from './systems/production';
import { updateEconomy } from './systems/economy';
import { updateTerritory } from './systems/territory';
import { applyScenario, updateDiplomacy } from './systems/diplomacy';
import { updatePowers } from './systems/powers';
import { AIController } from './ai/ai';
import { type Command, applyCommand } from './commands';
import { cos, dist, dist2, sin, sqrt } from './dmath';

export interface PlayerSlot {
  slot: number;
  name: string;
  country: string; // ISO
}

export interface MatchSetup {
  seed: number;
  players: PlayerSlot[];
  /** ISO codes of countries run by a full AI with a base. */
  aiMajors: string[];
  difficulty: Difficulty;
  startFunds: number;
  scenario: 'sandbox' | 'realistic';
  events: boolean;
  /** Seconds; 0 = no limit (conquest only). */
  timeLimit: number;
}

export type AlertKey =
  | 'underAttack'
  | 'unitsUnderAttack'
  | 'buildComplete'
  | 'unitReady'
  | 'researchDone'
  | 'tierUp'
  | 'cityCaptured'
  | 'cityLost'
  | 'derrickLost'
  | 'missileInbound'
  | 'missileReady'
  | 'intercepted'
  | 'lowPower'
  | 'noFunds'
  | 'noOil'
  | 'supplyCap'
  | 'cantBuild'
  | 'requires'
  | 'limit'
  | 'warDeclared'
  | 'warOnUs'
  | 'peace'
  | 'alliance'
  | 'allianceBroken'
  | 'proposal'
  | 'rejected'
  | 'sanctioned'
  | 'borderViolation'
  | 'rankUp'
  | 'eliminated'
  | 'crisis'
  | 'blackout'
  | 'callToArms';

export type SimEvent =
  | { t: 'fire'; id: number; w: string; x: number; y: number; z: number; tx: number; ty: number; tz: number; owner: number }
  | { t: 'boom'; x: number; y: number; z: number; size: number; kind: Delivery | 'death' | 'building' | 'intercept' | 'crash' }
  | { t: 'death'; id: number; unit: boolean; def: string; x: number; z: number; owner: number }
  | { t: 'launch'; id: number; kind: StrikeKind; owner: number; x: number; z: number; tx: number; tz: number }
  | { t: 'intercept'; x: number; y: number; z: number; owner: number }
  | { t: 'sound'; s: SfxName; x: number; z: number; v?: number }
  | { t: 'alert'; to: number; key: AlertKey; x?: number; z?: number; arg?: string; tone: 'info' | 'good' | 'bad' | 'warn' }
  | { t: 'captured'; city: number; owner: number; prev: number }
  | { t: 'built'; id: number; owner: number }
  | { t: 'trained'; id: number; owner: number }
  | { t: 'diplo'; a: number; b: number; what: string }
  | { t: 'crisis'; id: string; x?: number; z?: number }
  | { t: 'power'; id: string; owner: number; x: number; z: number }
  | { t: 'eliminated'; country: number }
  | { t: 'end'; winners: number[] };

export class World {
  readonly countries: Country[] = [];
  readonly byIso = new Map<string, Country>();
  readonly dip: Diplomacy;
  readonly rng: Rng;
  readonly cities: City[] = [];
  readonly oil: OilField[] = [];
  units: Unit[] = [];
  buildings: Building[] = [];
  projectiles: Projectile[] = [];
  readonly entities = new Map<number, Entity>();
  readonly land: PathGrid;
  readonly sea: PathGrid;
  readonly landPaths: Pathfinder;
  readonly seaPaths: Pathfinder;
  readonly hash: SpatialHash;
  readonly vision: Vision;
  readonly market: Market;
  readonly crises: Crises;
  readonly ais: AIController[] = [];
  events: SimEvent[] = [];
  tick = 0;
  time = 0;
  ended = false;
  winners: number[] = [];
  private nextEntity = 1;
  nextProjectile = 1;
  /** Scratch array for spatial queries (never held across calls). */
  readonly near: Unit[] = [];
  /** Temporary viewers from recon powers: x, z, radius, owner, expires. */
  reveals: { x: number; z: number; r: number; owner: number; until: number }[] = [];

  constructor(
    readonly theater: Theater,
    readonly setup: MatchSetup,
  ) {
    this.rng = new Rng(setup.seed);
    const metas = theater.meta.countries;
    this.dip = new Diplomacy(metas.length + 1);
    this.land = new PathGrid(theater.w, theater.h, theater.cell, (i) => (theater.water[i] ? 0 : 100 / theater.landSpeed[i]));
    this.sea = new PathGrid(theater.w, theater.h, theater.cell, (i) => (theater.water[i] ? 1 : 0));
    this.landPaths = new Pathfinder(this.land);
    this.seaPaths = new Pathfinder(this.sea);
    this.hash = new SpatialHash(theater.worldW, theater.worldH, 6);
    this.market = new Market(this.rng);
    this.crises = new Crises(this);
    this.crises.enabled = setup.events;

    // Countries: index 0 is a placeholder so country idx matches the theater layer.
    this.countries.push(new Country(0, { idx: 0, iso: '---', name: { en: '', fa: '' }, color: '#888', playable: false }, 'minor'));
    this.countries[0].alive = false;
    for (const m of metas) {
      const c = new Country(m.idx, m, 'minor');
      c.difficulty = setup.difficulty;
      this.countries.push(c);
      this.byIso.set(m.iso, c);
    }
    for (const p of setup.players) {
      const c = this.byIso.get(p.country);
      if (!c) continue;
      c.controller = 'human';
      c.slot = p.slot;
      c.major = true;
    }
    for (const iso of setup.aiMajors) {
      const c = this.byIso.get(iso);
      if (!c || c.controller === 'human') continue;
      c.controller = 'ai';
      c.major = true;
    }

    theater.meta.cities.forEach((m, i) => {
      const popM = m.pop / 1e6;
      this.cities.push(new City(i, m.x, m.z, m.pop, m.capital, m.country, 2.5 + Math.min(7, 2.2 * sqrt(popM))));
    });
    theater.meta.oil.forEach((m, i) => this.oil.push(new OilField(i, m.x, m.z, m.rich, m.offshore)));

    this.vision = new Vision(this);
    applyScenario(this);
    this.setupCountries();
  }

  // ---------------------------------------------------------------------------
  // Setup

  private setupCountries() {
    for (const c of this.countries) {
      if (!c.alive || c.idx === 0) continue;
      c.funds = c.major ? this.setup.startFunds : 0;
      c.oil = 150;
      if (!c.major) continue;
      const capital = c.meta.capital !== undefined ? this.cities[c.meta.capital] : null;
      const anchor = capital ?? this.cities.find((ci) => ci.origin === c.idx);
      if (!anchor) continue;
      const spot = this.findBaseSpot(c.idx, anchor.x, anchor.z, anchor.radius + 6);
      if (!spot) continue;
      const hq = this.spawnBuilding('hq', c.idx, spot.x, spot.z, true);
      c.startX = hq.x;
      c.startZ = hq.z;
      const pw = this.findPlacement(c.idx, 'power', hq.x, hq.z, 1.6);
      if (pw) this.spawnBuilding('power', c.idx, pw.x, pw.z, true);
      const start: string[] = ['builder', 'builder', 'rifle', 'rifle', 'rifle', 'rifle', 'atgm_team', 'manpads', 'ifv', 'ifv', 'mbt'];
      start.forEach((k, j) => {
        const a = (j / start.length) * 6.283185307179586;
        const p = this.landNear(hq.x + cos(a) * 1.8, hq.z + sin(a) * 1.8);
        const u = this.spawnUnit(k, c.idx, p.x, p.z);
        u.heading = a;
      });
      if (c.controller === 'ai') this.ais.push(new AIController(this, c.idx));
    }
    for (const c of this.countries) if (c.idx > 0) this.recount(c);
  }

  /** Land position near the anchor, inside the country's own territory, away from the city. */
  private findBaseSpot(owner: number, x: number, z: number, minDist: number): { x: number; z: number } | null {
    for (let r = minDist; r < minDist + 60; r += 2) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * 6.283185307179586 + r;
        const px = x + cos(a) * r;
        const pz = z + sin(a) * r;
        if (this.canPlaceFootprint(owner, 'hq', px, pz, false) && this.land.passable(px, pz)) return { x: px, z: pz };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Entities

  newId() {
    return this.nextEntity++;
  }

  spawnUnit(kind: string, owner: number, x: number, z: number): Unit {
    const def = UNITS[kind];
    const u = new Unit(this.newId(), def, owner, x, z);
    const c = this.countries[owner];
    if (c.has('composite') && (def.armor === 'heavy' || def.armor === 'light')) {
      u.maxHp *= 1.25;
      u.hp = u.maxHp;
    }
    if (def.flight) u.y = def.flight === 'heli' || def.flight === 'fpv' ? 0.02 : def.alt ?? 1;
    if (def.flight === 'fpv' && c.has('swarm')) u.fuel *= 1.5;
    u.px = x;
    u.pz = z;
    u.py = u.y;
    this.units.push(u);
    this.entities.set(u.id, u);
    return u;
  }

  spawnBuilding(kind: string, owner: number, x: number, z: number, instant = false): Building {
    const def = BUILDINGS[kind];
    const b = new Building(this.newId(), def, owner, x, z);
    if (instant) {
      b.built = true;
      b.progress = 1;
    } else {
      b.hp = Math.max(1, def.hp * 0.05);
    }
    if (def.onOil) {
      const f = this.oilFieldAt(x, z);
      if (f) {
        f.derrick = b.id;
        b.oilField = f.idx;
      }
    }
    this.buildings.push(b);
    this.entities.set(b.id, b);
    return b;
  }

  get(id: number): Entity | undefined {
    const e = this.entities.get(id);
    return e && e.alive ? e : undefined;
  }

  // ---------------------------------------------------------------------------
  // Spatial / territory queries

  /** Territory owner of a point (city regions flip with capture). */
  ownerAt(x: number, z: number): number {
    const c = this.theater.cellIndex(x, z);
    if (c < 0 || this.theater.water[c]) return 0;
    const r = this.theater.region[c];
    return r >= 0 ? this.cities[r].owner : this.theater.country[c];
  }

  /** Owner of an offshore/onshore field: territory owner, or the owner of the nearest coast. */
  fieldOwner(f: OilField): number {
    if (!f.offshore) return this.ownerAt(f.x, f.z);
    const t = this.theater;
    const c0 = t.cellIndex(f.x, f.z);
    const cx = c0 % t.w;
    const cz = (c0 - cx) / t.w;
    for (let r = 1; r < 40; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (dx !== -r && dx !== r && dz !== -r && dz !== r) continue;
          const x = cx + dx;
          const z = cz + dz;
          if (x < 0 || z < 0 || x >= t.w || z >= t.h) continue;
          const i = z * t.w + x;
          if (!t.water[i]) return this.ownerAt((x + 0.5) * t.cell, (z + 0.5) * t.cell);
        }
    return 0;
  }

  oilFieldAt(x: number, z: number, r = 0.8): OilField | null {
    let best: OilField | null = null;
    let bd = r * r;
    for (const f of this.oil) {
      const d = dist2(f.x, f.z, x, z);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return best;
  }

  landNear(x: number, z: number): { x: number; z: number } {
    if (this.land.passable(x, z)) return { x, z };
    const c = this.land.nearest(this.land.cellAt(x, z));
    if (c < 0) return { x, z };
    return { x: ((c % this.theater.w) + 0.5) * this.theater.cell, z: (Math.floor(c / this.theater.w) + 0.5) * this.theater.cell };
  }

  seaNear(x: number, z: number): { x: number; z: number } | null {
    if (this.sea.passable(x, z)) return { x, z };
    const c = this.sea.nearest(this.sea.cellAt(x, z), -1, 4);
    if (c < 0) return null;
    return { x: ((c % this.theater.w) + 0.5) * this.theater.cell, z: (Math.floor(c / this.theater.w) + 0.5) * this.theater.cell };
  }

  isEnemy(a: number, b: number) {
    return this.dip.atWar(a, b);
  }

  allied(a: number, b: number) {
    return this.dip.allied(a, b);
  }

  /** Is (x, z) visible to `country` (incl. allies' vision)? */
  visibleTo(country: number, x: number, z: number) {
    return this.vision.visible(country, x, z);
  }

  /** Has `country` (or its allies) detected this entity? */
  detects(country: number, e: Entity) {
    return this.vision.detects(country, e);
  }

  buildingAt(x: number, z: number, margin = 0): Building | null {
    for (const b of this.buildings) {
      if (!b.alive) continue;
      const h = b.half + margin;
      if (x > b.x - h && x < b.x + h && z > b.z - h && z < b.z + h) return b;
    }
    return null;
  }

  countBuildings(owner: number, kind: string, includeUnbuilt = true) {
    let n = 0;
    for (const b of this.buildings) if (b.alive && b.owner === owner && b.def.id === kind && (includeUnbuilt || b.built)) n++;
    return n;
  }

  hasBuilding(owner: number, kind: string) {
    for (const b of this.buildings) if (b.alive && b.owner === owner && b.def.id === kind && b.built) return true;
    return false;
  }

  missingRequirements(owner: number, reqs: string[]): string[] {
    return reqs.filter((r) => !this.hasBuilding(owner, r));
  }

  /** Footprint is on own territory, dry land (or coast for shipyards) and clear of buildings. */
  canPlaceFootprint(owner: number, kind: string, x: number, z: number, checkBuildings = true): boolean {
    const def = BUILDINGS[kind];
    const h = def.size / 2;
    const t = this.theater;
    if (x - h < 1 || z - h < 1 || x + h > t.worldW - 1 || z + h > t.worldH - 1) return false;
    if (def.onOil) {
      const f = this.oilFieldAt(x, z);
      return !!f && !this.get(f.derrick) && this.fieldOwner(f) === owner;
    }
    for (const [ox, oz] of [[0, 0], [-h, -h], [h, -h], [-h, h], [h, h]]) {
      const px = x + ox;
      const pz = z + oz;
      if (!this.land.passable(px, pz)) return false;
      if (this.ownerAt(px, pz) !== owner) return false;
    }
    if (def.coast) {
      const c = t.cellIndex(x, z);
      if (!(t.flags[c] & FLAG_COAST) || !this.seaNear(x, z)) return false;
    }
    if (checkBuildings) {
      for (const b of this.buildings) {
        if (!b.alive) continue;
        const m = b.half + h + 0.08;
        if (Math.abs(b.x - x) < m && Math.abs(b.z - z) < m) return false;
      }
      for (const ci of this.cities) if (dist2(ci.x, ci.z, x, z) < ci.radius * ci.radius * 0.36) return false;
    }
    return true;
  }

  /** Full placement validation. Returns an alert key on failure. */
  placementError(owner: number, kind: string, x: number, z: number): AlertKey | null {
    const def = BUILDINGS[kind];
    const c = this.countries[owner];
    if (!def) return 'cantBuild';
    if (def.tier > c.tier) return 'requires';
    if (def.research && !c.has(def.research)) return 'requires';
    if (this.missingRequirements(owner, def.requires).length) return 'requires';
    if (def.limit !== undefined && this.countBuildings(owner, kind) >= def.limit) return 'limit';
    if (c.funds < def.cost) return 'noFunds';
    if (c.oil < def.oil) return 'noOil';
    if (!this.canPlaceFootprint(owner, kind, x, z)) return 'cantBuild';
    // Offshore wells can only be worked from a naval base; without one the derrick never gets crew.
    if (def.onOil && this.oilFieldAt(x, z)?.offshore && !this.hasBuilding(owner, 'shipyard')) return 'requires';
    if (!def.onOil && kind !== 'fob' && kind !== 'hq') {
      let ok = false;
      for (const b of this.buildings) {
        if (!b.alive || b.owner !== owner || !b.def.baseRadius) continue;
        if (dist(b.x, b.z, x, z) <= b.def.baseRadius) {
          ok = true;
          break;
        }
      }
      if (!ok) return 'cantBuild';
    }
    return null;
  }

  /** Spiral search for a valid placement near (x, z). */
  findPlacement(owner: number, kind: string, x: number, z: number, start = 1, maxR = 20): { x: number; z: number } | null {
    const def = BUILDINGS[kind];
    const step = Math.max(0.35, def.size + 0.15);
    for (let r = start; r < maxR; r += step) {
      const n = Math.max(6, Math.floor((6.283185307179586 * r) / step));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * 6.283185307179586;
        const px = x + cos(a) * r;
        const pz = z + sin(a) * r;
        if (this.canPlaceFootprint(owner, kind, px, pz)) return { x: px, z: pz };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Combat helpers

  applyDamage(target: Entity, amount: number, delivery: Delivery, attacker: Entity | null, attackerOwner: number) {
    if (!target.alive) return;
    let mult = DAMAGE[delivery][target.armor];
    if (attacker && attacker.isUnit) mult *= 1 + attacker.vet * 0.12;
    const dmg = amount * mult;
    if (dmg <= 0) return;
    target.hp -= dmg;
    target.lastHurt = this.time;
    if (attacker) target.lastAttacker = attacker.id;
    if (target.isUnit && target.order === 'idle' && !target.target && attacker && attacker.alive && !target.hold) target.target = attacker.id;
    const owner = this.countries[target.owner];
    if (owner.controller === 'human' && this.time - (this.lastAlertAt.get(target.owner) ?? -99) > 15) {
      this.lastAlertAt.set(target.owner, this.time);
      this.alert(target.owner, target.isUnit ? 'unitsUnderAttack' : 'underAttack', 'warn', target.x, target.z);
    }
    if (target.hp <= 0) this.kill(target, attacker, attackerOwner);
  }

  private lastAlertAt = new Map<number, number>();

  splash(x: number, z: number, radius: number, damage: number, delivery: Delivery, attacker: Entity | null, owner: number, hitAir = false) {
    this.hash.query(x, z, radius + 0.3, this.near);
    const victims = this.near.slice();
    for (const u of victims) {
      if (!u.alive || (u.isAir && !hitAir)) continue;
      if (owner > 0 && u.owner !== owner && !this.isEnemy(owner, u.owner) && !this.allied(owner, u.owner)) {
        // Collateral on neutrals still hurts (and causes tension).
        this.dip.addTension(owner, u.owner, 2);
      }
      if (owner > 0 && this.allied(owner, u.owner)) continue;
      const d = dist(u.x, u.z, x, z);
      if (d > radius + u.radius) continue;
      this.applyDamage(u, damage * (1 - Math.min(1, d / (radius + u.radius)) * 0.65), delivery, attacker, owner);
    }
    for (const b of this.buildings) {
      if (!b.alive || (owner > 0 && this.allied(owner, b.owner))) continue;
      const dx = Math.max(0, Math.abs(b.x - x) - b.half);
      const dz = Math.max(0, Math.abs(b.z - z) - b.half);
      const d = sqrt(dx * dx + dz * dz);
      if (d > radius) continue;
      this.applyDamage(b, damage * (1 - (d / Math.max(0.01, radius)) * 0.6), delivery, attacker, owner);
    }
    for (const c of this.cities) {
      if (dist2(c.x, c.z, x, z) < c.radius * c.radius) {
        c.shelled = 0;
        if (owner > 0 && this.isEnemy(owner, c.owner)) c.garrison = Math.max(0, c.garrison - damage * 0.05);
      }
    }
  }

  kill(e: Entity, attacker: Entity | null, attackerOwner: number) {
    if (!e.alive) return;
    e.alive = false;
    const owner = this.countries[e.owner];
    this.events.push({ t: 'death', id: e.id, unit: e.isUnit, def: e.def.id, x: e.x, z: e.z, owner: e.owner });
    if (e.isUnit) {
      owner.stats.unitsLost++;
      owner.supply = Math.max(0, owner.supply - e.def.supply);
      owner.warWeariness = Math.min(60, owner.warWeariness + e.def.supply * 0.05);
    } else {
      owner.stats.buildingsLost++;
      if (e.oilField >= 0) {
        const f = this.oil[e.oilField];
        f.derrick = 0;
        f.fire = 40;
        this.alert(e.owner, 'derrickLost', 'bad', e.x, e.z);
      }
      // Refund queued units.
      for (const q of e.queue) {
        owner.funds += UNITS[q].cost;
        owner.oil += UNITS[q].oil;
        owner.supply -= UNITS[q].supply;
      }
      e.queue.length = 0;
    }
    if (attackerOwner > 0 && attackerOwner !== e.owner) {
      const a = this.countries[attackerOwner];
      a.stats.kills++;
      if (!e.isUnit) a.stats.buildingsDestroyed++;
      a.xp += (e.isUnit ? e.def.cost : e.def.cost * 0.6) * 0.1;
      if (attacker && attacker.isUnit && attacker.alive) {
        attacker.kills++;
        const vet = attacker.kills >= 10 ? 3 : attacker.kills >= 5 ? 2 : attacker.kills >= 2 ? 1 : 0;
        if (vet > attacker.vet) {
          attacker.vet = vet;
          const oldMax = attacker.maxHp;
          attacker.maxHp = attacker.def.hp * (1 + vet * 0.1);
          attacker.hp = Math.min(attacker.maxHp, attacker.hp + (attacker.maxHp - oldMax) + attacker.def.hp * 0.2);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Events

  alert(to: number, key: AlertKey, tone: 'info' | 'good' | 'bad' | 'warn', x?: number, z?: number, arg?: string) {
    if (to <= 0 || this.countries[to].controller !== 'human') return;
    this.events.push({ t: 'alert', to, key, tone, x, z, arg });
  }

  sound(s: SfxName, x: number, z: number, v?: number) {
    this.events.push({ t: 'sound', s, x, z, v });
  }

  // ---------------------------------------------------------------------------
  // Economy helpers

  recount(c: Country) {
    let prod = 0;
    let use = 0;
    let cap = ECON.supplyBase;
    for (const b of this.buildings) {
      if (!b.alive || b.owner !== c.idx) continue;
      if (b.built) {
        if (b.def.power > 0) prod += b.def.power * (this.crises.heatwave > 0 && b.def.id === 'power' ? 0.8 : 1);
        else use -= b.def.power;
        cap += b.def.supply ?? 0;
      }
    }
    for (const ci of this.cities) if (ci.owner === c.idx) cap += ci.capital ? 20 : 4 + Math.min(10, 2 * sqrt(ci.pop / 1e6));
    c.powerProd = prod;
    c.powerUse = use;
    c.supplyCap = Math.min(ECON.supplyMax, Math.floor(cap));
  }

  // ---------------------------------------------------------------------------
  // Main loop

  /** Advance one fixed tick, applying the commands scheduled for it. */
  step(commands: readonly Command[]) {
    this.events = [];
    for (const cmd of commands) applyCommand(this, cmd);
    this.tick++;
    this.time = this.tick * DT;

    for (const u of this.units) {
      u.px = u.x;
      u.pz = u.z;
      u.py = u.y;
      u.pHeading = u.heading;
      u.pTurretYaw = u.turretYaw;
    }
    for (const b of this.buildings) b.pTurretYaw = b.turretYaw;
    for (const p of this.projectiles) {
      p.px = p.x;
      p.py = p.y;
      p.pz = p.z;
    }
    this.hash.rebuild(this.units);
    this.landPaths.step(24000);
    this.seaPaths.step(12000);

    for (const ai of this.ais) ai.update();
    this.market.update(DT);
    this.crises.update(DT);
    updateEconomy(this);
    updateProduction(this);
    updateTerritory(this);
    updateDiplomacy(this);
    updatePowers(this);
    updateMovement(this);
    updateCombat(this);
    updateProjectiles(this);
    if (this.tick % 10 === 0) this.vision.update();

    // Cleanup
    if (this.units.some((u) => !u.alive)) {
      for (const u of this.units) if (!u.alive) this.entities.delete(u.id);
      this.units = this.units.filter((u) => u.alive);
    }
    if (this.buildings.some((b) => !b.alive)) {
      for (const b of this.buildings) if (!b.alive) this.entities.delete(b.id);
      this.buildings = this.buildings.filter((b) => b.alive);
      for (const c of this.countries) if (c.alive && c.idx > 0) this.recount(c);
    }
    if (this.projectiles.some((p) => !p.alive)) this.projectiles = this.projectiles.filter((p) => p.alive);
    if (this.tick % TICK_RATE === 0) this.checkElimination();
  }

  private checkElimination() {
    if (this.ended) return;
    for (const c of this.countries) {
      if (!c.alive || !c.major) continue;
      let hasBase = false;
      for (const b of this.buildings)
        if (b.alive && b.owner === c.idx && b.def.produces && b.built) {
          hasBase = true;
          break;
        }
      let hasBuilder = false;
      if (!hasBase) for (const u of this.units) if (u.alive && u.owner === c.idx && u.def.builder) hasBuilder = true;
      if (!hasBase && !hasBuilder) {
        c.alive = false;
        for (const u of this.units) if (u.alive && u.owner === c.idx) this.kill(u, null, 0);
        for (const b of this.buildings) if (b.alive && b.owner === c.idx) this.kill(b, null, 0);
        this.events.push({ t: 'eliminated', country: c.idx });
        for (const o of this.countries) if (o.controller === 'human') this.alert(o.idx, 'eliminated', o.idx === c.idx ? 'bad' : 'info', c.startX, c.startZ, c.iso);
      }
    }
    const majors = this.countries.filter((c) => c.major && c.alive);
    const humansAlive = majors.some((c) => c.slot >= 0);
    let done = false;
    let winners: number[] = [];
    if (!majors.length) done = true;
    else if (majors.every((a) => majors.every((b) => this.allied(a.idx, b.idx)))) {
      done = true;
      winners = majors.map((c) => c.idx);
    } else if (!humansAlive && this.setup.players.length) {
      done = true;
      winners = majors.map((c) => c.idx);
    } else if (this.setup.timeLimit > 0 && this.time >= this.setup.timeLimit) {
      done = true;
      let best = -1;
      for (const c of majors) {
        const s = this.score(c.idx);
        if (s > best) {
          best = s;
          winners = [c.idx];
        }
      }
    }
    if (done) {
      this.ended = true;
      this.winners = winners;
      this.events.push({ t: 'end', winners });
    }
  }

  score(idx: number) {
    const c = this.countries[idx];
    let cities = 0;
    for (const ci of this.cities) if (ci.owner === idx) cities += ci.capital ? 3 : 1;
    return Math.round(c.stats.kills * 8 + c.stats.buildingsDestroyed * 40 + c.stats.earned / 25 + cities * 120 + c.stats.citiesCaptured * 150 + c.reputation * 5);
  }

  relationLabel(a: number, b: number): Rel {
    return this.dip.get(a, b);
  }

  rankOf(xp: number) {
    return RANK_XP.filter((t) => xp >= t).length - 1;
  }

  // Exposed for systems.
  readonly strikeTargets: { id: number; kind: StrikeKind }[] = [];
}

/** XP thresholds for country ranks (each rank grants one command point). */
export const RANK_XP = [0, 400, 1200, 2600, 4500, 7000, 10000, 14000];
