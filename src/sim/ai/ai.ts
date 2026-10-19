/**
 * Skirmish AI for a major power. Deterministic: it reads the world and issues ordinary
 * commands, so it runs identically on every peer in multiplayer.
 */
import type { World } from '../world';
import type { Building, Unit } from '../entities';
import { Rel } from '../country';
import { BUILDINGS, POWERS, RESEARCH, STRIKES, TIER_UPGRADE, UNITS } from '../defs';
import { type Command, type CommandBody, applyCommand } from '../commands';
import { cos, dist, dist2, headingTo, sin } from '../dmath';
import { aiAccepts, hasCasusBelli, strength } from '../systems/diplomacy';

const AGGRESSION = { easy: 0.5, normal: 1, hard: 1.4, brutal: 2 } as const;
const ATTACK_SIZE = { easy: 8, normal: 12, hard: 16, brutal: 20 } as const;

const MIX: Record<string, [string, number][]> = {
  barracks: [['rifle', 4], ['atgm_team', 2.5], ['manpads', 1.5], ['engineer', 1], ['sf', 0.8]],
  factory: [['ifv', 2.5], ['mbt', 3.5], ['shorad', 1.5], ['spg', 1.2], ['mlrs', 1], ['sam_tel', 0.5], ['ew', 0.4], ['tel', 0.3]],
  dronefac: [['fpv', 4], ['loiter', 3], ['recon', 0.6], ['male', 2]],
  airbase: [['heli', 2], ['fighter', 2], ['bomber', 1]],
  shipyard: [['fac', 3], ['frigate', 2], ['sub', 1]],
  fob: [['rifle', 1]],
};

export class AIController {
  private phase: number;
  private rival = 0;
  private provokeT = 0;
  private attackTarget: { x: number; z: number } | null = null;
  private lastAttack = -999;
  private lastPeace = new Map<number, number>();
  /** Funds held back for the next building or tier upgrade. */
  private saving = 0;

  constructor(
    private w: World,
    readonly idx: number,
  ) {
    this.phase = (idx * 7) % 40;
  }

  private get me() {
    return this.w.countries[this.idx];
  }

  private cmd(c: CommandBody) {
    return applyCommand(this.w, { ...c, c: this.idx } as Command);
  }

  update() {
    const w = this.w;
    const me = this.me;
    if (!me.alive || me.controller !== 'ai') return;
    const t = (w.tick + this.phase) % 40;
    if (t === 0) this.economy();
    if (t === 10) this.production();
    if (t === 20) this.military();
    if (t === 30 && (w.tick + this.phase) % 200 === 30) this.diplomacy();
    if (t === 35 && (w.tick + this.phase) % 120 === 35) this.strategic();
  }

  // ---------------------------------------------------------------------------
  // Economy & base building

  private hq(): Building | undefined {
    return this.w.buildings.find((b) => b.alive && b.owner === this.idx && b.def.id === 'hq');
  }

  private count(kind: string) {
    return this.w.countBuildings(this.idx, kind);
  }

  private underConstruction(kind?: string) {
    return this.w.buildings.some((b) => b.alive && b.owner === this.idx && !b.built && (!kind || b.def.id === kind));
  }

  private economy() {
    const w = this.w;
    const me = this.me;
    const hq = this.hq();
    const builders = w.units.filter((u) => u.alive && u.owner === this.idx && u.def.builder);
    if (builders.length < 3 && !w.buildings.some((b) => b.alive && b.owner === this.idx && b.queue.includes('builder'))) this.cmd({ k: 'train', kind: 'builder' });
    // Idle builders help unfinished sites.
    const site = w.buildings.find((b) => b.alive && b.owner === this.idx && !b.built);
    if (site) for (const u of builders) if (u.order === 'idle') this.cmd({ k: 'assist', ids: [u.id], target: site.id });
    // Repair damaged buildings with spare builders.
    const damaged = w.buildings.find((b) => b.alive && b.built && b.owner === this.idx && b.hp < b.maxHp * 0.6);
    if (damaged) {
      const free = builders.find((u) => u.order === 'idle');
      if (free) this.cmd({ k: 'repair', ids: [free.id], target: damaged.id });
    }
    this.saving = 0;
    if (!hq) return;
    if (w.buildings.filter((b) => b.alive && b.owner === this.idx && !b.built && b.oilField < 0).length >= Math.max(1, builders.length - 1)) return;
    const want = this.nextBuilding();
    if (!want) return;
    if (want === '@tier') {
      const next = (me.tier + 1) as 2 | 3;
      this.saving = TIER_UPGRADE[next].cost;
      if (me.funds >= this.saving && !hq.upgrade) this.cmd({ k: 'tier' });
      return;
    }
    const def = BUILDINGS[want];
    if (me.funds < def.cost + 100) {
      this.saving = def.cost + 100;
      return;
    }
    let spot: { x: number; z: number } | null = null;
    if (def.onOil) {
      const f = this.freeOilField();
      if (f) spot = { x: f.x, z: f.z };
    } else if (def.weapons) {
      const dir = this.threatDir(hq);
      spot = w.findPlacement(this.idx, want, hq.x + sin(dir) * 4, hq.z + cos(dir) * 4, 0.5, 10);
    } else spot = w.findPlacement(this.idx, want, hq.x, hq.z, 1.2, 14);
    if (spot) this.cmd({ k: 'build', kind: want, x: spot.x, z: spot.z });
  }

  private freeOilField() {
    const hq = this.hq();
    let best = null as (typeof this.w.oil)[number] | null;
    let bd = Infinity;
    for (const f of this.w.oil) {
      if (f.derrick && this.w.get(f.derrick)) continue;
      if (this.w.fieldOwner(f) !== this.idx) continue;
      if (f.offshore && !this.w.hasBuilding(this.idx, 'shipyard')) continue;
      const d = hq ? dist(hq.x, hq.z, f.x, f.z) : 0;
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return best;
  }

  private threatDir(hq: Building) {
    const r = this.rival ? this.w.countries[this.rival] : null;
    if (r && r.startX) return headingTo(hq.x, hq.z, r.startX, r.startZ);
    return (this.idx * 2.4) % 6.283185307179586;
  }

  private nextBuilding(): string | null {
    const me = this.me;
    const w = this.w;
    const n = (k: string) => this.count(k);
    const surplus = me.powerProd - me.powerUse;
    if (surplus < 12 && !this.underConstruction('power') && !this.underConstruction('nuclear')) return me.has('reactor') && n('nuclear') === 0 && me.tier >= 3 ? 'nuclear' : 'power';
    if (n('barracks') === 0) return 'barracks';
    const derricks = n('derrick');
    if (derricks < 2 && this.freeOilField()) return 'derrick';
    if (me.supply > me.supplyCap - 8 && me.supplyCap < 400 && !this.underConstruction('depot')) return 'depot';
    if (n('factory') === 0) return 'factory';
    if (derricks < 7 && this.freeOilField() && !this.underConstruction('derrick')) return 'derrick';
    if (derricks >= 1 && n('refinery') < Math.min(4, Math.ceil(derricks / 2))) return 'refinery';
    if (n('radar') === 0) return 'radar';
    if (n('cram') < 1) return 'cram';
    if (n('dronefac') === 0) return 'dronefac';
    if (n('bunker') < 2) return 'bunker';
    if (n('shipyard') === 0 && this.coastal()) return 'shipyard';
    if (me.tier < 2) return this.hq()?.upgrade ? (me.funds > 4000 && n('barracks') < 2 ? 'barracks' : null) : '@tier';
    if (n('research') === 0) return 'research';
    if (n('airbase') === 0) return 'airbase';
    if (n('samsite') < 2) return 'samsite';
    if (n('cram') < 3) return 'cram';
    if (n('silo') === 0 && w.hasBuilding(this.idx, 'research')) return 'silo';
    if (me.funds > 6000 && n('factory') < 2) return 'factory';
    if (me.tier < 3) return this.hq()?.upgrade || !w.hasBuilding(this.idx, 'research') ? null : '@tier';
    if (me.has('laser') && n('laser') < 2) return 'laser';
    if (me.funds > 8000 && n('dronefac') < 2) return 'dronefac';
    return null;
  }

  private coastal() {
    const hq = this.hq();
    if (!hq) return false;
    return !!this.w.findPlacement(this.idx, 'shipyard', hq.x, hq.z, 1, 25);
  }

  // ---------------------------------------------------------------------------
  // Production

  private production() {
    const w = this.w;
    const me = this.me;
    // Research
    if (me.tier >= 2) {
      const lab = w.buildings.find((b) => b.alive && b.built && b.owner === this.idx && b.def.research_ && !b.research);
      if (lab) {
        const r = RESEARCH.find((x) => x.tier <= me.tier && !me.has(x.id) && !w.buildings.some((b) => b.research === x.id && b.owner === this.idx));
        if (r && me.funds > r.cost + 1500) this.cmd({ k: 'research', id: r.id });
      }
    }
    // Powers
    for (const p of POWERS) if (me.points >= p.points && !me.powers.includes(p.id)) this.cmd({ k: 'unlock', id: p.id });
    // Units (keep money for planned construction unless the base is threatened)
    const hq = this.hq();
    let threatened = false;
    if (hq) {
      w.hash.query(hq.x, hq.z, 25, w.near);
      for (const u of w.near) if (u.alive && w.isEnemy(this.idx, u.owner)) threatened = true;
    }
    const reserve = 300 + (threatened ? 0 : this.saving);
    for (const b of w.buildings) {
      if (!b.alive || !b.built || b.owner !== this.idx || !b.def.produces || b.queue.length >= 2) continue;
      if (b.def.id === 'hq') continue;
      const mix = MIX[b.def.id];
      if (!mix) continue;
      const navy = w.units.filter((u) => u.alive && u.owner === this.idx && u.isNaval).length;
      if (b.def.id === 'shipyard' && navy >= 6) continue;
      const options = mix.filter(([k]) => {
        const d = UNITS[k];
        if (d.tier > me.tier || (d.research && !me.has(d.research))) return false;
        if (k === 'tel' && w.units.filter((u) => u.owner === this.idx && u.def.id === 'tel').length >= 2) return false;
        if (k === 'sam_tel' && w.units.filter((u) => u.owner === this.idx && u.def.id === 'sam_tel').length >= 3) return false;
        if (k === 'ew' && w.units.filter((u) => u.owner === this.idx && u.def.id === 'ew').length >= 2) return false;
        return true;
      });
      if (!options.length) continue;
      let total = 0;
      for (const [, wt] of options) total += wt;
      let r = w.rng.next() * total;
      let kind = options[0][0];
      for (const [k, wt] of options) {
        r -= wt;
        if (r <= 0) {
          kind = k;
          break;
        }
      }
      if (me.funds > UNITS[kind].cost + reserve && me.supply + UNITS[kind].supply <= me.supplyCap) this.cmd({ k: 'train', kind, at: b.id });
    }
  }

  // ---------------------------------------------------------------------------
  // Military

  private army(): Unit[] {
    return this.w.units.filter(
      (u) => u.alive && u.owner === this.idx && !u.def.builder && u.def.weapons.length > 0 && !u.isNaval && u.def.flight !== 'jet' && u.order !== 'docked' && u.def.id !== 'sam_tel',
    );
  }

  private enemies(): number[] {
    const out: number[] = [];
    for (const c of this.w.countries) if (c.alive && this.w.isEnemy(this.idx, c.idx)) out.push(c.idx);
    return out;
  }

  private military() {
    const w = this.w;
    const hq = this.hq();
    if (!hq) return;
    const army = this.army();
    // Defend: enemy ground units near our buildings.
    let threat: Unit | null = null;
    w.hash.query(hq.x, hq.z, 25, w.near);
    for (const u of w.near) if (u.alive && w.isEnemy(this.idx, u.owner) && !u.isAir) threat = u;
    if (threat) {
      const defenders = army.filter((u) => dist(u.x, u.z, hq.x, hq.z) < 40 && (u.order === 'idle' || u.order === 'guard'));
      if (defenders.length) this.cmd({ k: 'move', ids: defenders.map((u) => u.id), x: threat.x, z: threat.z, atk: true });
    }
    const enemies = this.enemies();
    // Kamikaze drones strike enemy assets.
    if (enemies.length) {
      const loiters = w.units.filter((u) => u.alive && u.owner === this.idx && u.def.id === 'loiter' && u.order === 'idle');
      for (const l of loiters.slice(0, 3)) {
        const tgt = this.highValueTarget(enemies, l.x, l.z, 1500);
        if (tgt) this.cmd({ k: 'kamikaze', ids: [l.id], x: tgt.x, z: tgt.z });
      }
    }
    if (!enemies.length) {
      // Peacetime: gather near the base facing the rival.
      const idle = army.filter((u) => u.order === 'idle' && dist(u.x, u.z, hq.x, hq.z) > 12);
      if (idle.length) {
        const a = this.threatDir(hq);
        this.cmd({ k: 'move', ids: idle.map((u) => u.id), x: hq.x + sin(a) * 5, z: hq.z + cos(a) * 5 });
      }
      return;
    }
    const size = ATTACK_SIZE[this.me.difficulty];
    const ready = army.filter((u) => (u.order === 'idle' || u.order === 'guard') && dist(u.x, u.z, hq.x, hq.z) < 60);
    if (ready.length >= size && w.time - this.lastAttack > 40) {
      const tgt = this.attackObjective(enemies, hq);
      if (tgt) {
        this.lastAttack = w.time;
        this.attackTarget = tgt;
        this.cmd({ k: 'move', ids: ready.map((u) => u.id), x: tgt.x, z: tgt.z, atk: true });
        // Air support follows.
        const air = w.units.filter((u) => u.alive && u.owner === this.idx && u.isAir && !u.def.kamikaze && u.order === 'idle');
        if (air.length) this.cmd({ k: 'move', ids: air.map((u) => u.id), x: tgt.x, z: tgt.z, atk: true });
        const ships = w.units.filter((u) => u.alive && u.owner === this.idx && u.isNaval && u.order === 'idle');
        if (ships.length) this.cmd({ k: 'move', ids: ships.map((u) => u.id), x: tgt.x, z: tgt.z, atk: true });
      }
    } else if (this.attackTarget) {
      // Keep the offensive rolling: idle units far from home rejoin the objective.
      const stragglers = army.filter((u) => u.order === 'idle' && dist(u.x, u.z, hq.x, hq.z) > 60);
      if (stragglers.length) {
        const tgt = this.attackObjective(enemies, { x: stragglers[0].x, z: stragglers[0].z });
        if (tgt) this.cmd({ k: 'move', ids: stragglers.map((u) => u.id), x: tgt.x, z: tgt.z, atk: true });
      }
    }
  }

  /** Nearest enemy city or building to `from`. */
  private attackObjective(enemies: number[], from: { x: number; z: number }) {
    const w = this.w;
    let best: { x: number; z: number } | null = null;
    let bd = Infinity;
    for (const c of w.cities) {
      if (!enemies.includes(c.owner)) continue;
      const d = dist2(c.x, c.z, from.x, from.z) * (c.capital ? 0.8 : 1);
      if (d < bd) {
        bd = d;
        best = { x: c.x, z: c.z };
      }
    }
    for (const b of w.buildings) {
      if (!b.alive || !enemies.includes(b.owner)) continue;
      const d = dist2(b.x, b.z, from.x, from.z) * 0.9;
      if (d < bd) {
        bd = d;
        best = { x: b.x, z: b.z };
      }
    }
    return best;
  }

  private highValueTarget(enemies: number[], x: number, z: number, range: number) {
    let best: Building | null = null;
    let bs = -Infinity;
    for (const b of this.w.buildings) {
      if (!b.alive || !enemies.includes(b.owner)) continue;
      const d = dist(b.x, b.z, x, z);
      if (d > range) continue;
      if (!this.w.vision.isExplored(this.idx, b.x, b.z) && b.def.id !== 'hq') continue;
      const v = b.def.cost - d * 0.5 + (b.def.id === 'hq' ? 2000 : 0) + (b.def.id === 'samsite' ? -1500 : 0);
      if (v > bs) {
        bs = v;
        best = b;
      }
    }
    return best;
  }

  private strategic() {
    const w = this.w;
    const me = this.me;
    const enemies = this.enemies();
    if (!enemies.length) return;
    // Missiles
    for (const e of [...w.buildings, ...w.units]) {
      if (!e.alive || e.owner !== this.idx || !e.def.strike || e.strikeCd > 0) continue;
      if (!e.isUnit && !e.built) continue;
      const kind = e.def.strike === 'ballistic' && me.has('hypersonic') ? 'hypersonic' : e.def.strike;
      if (me.funds < STRIKES[kind].cost + 800) continue;
      const tgt = this.highValueTarget(enemies, e.x, e.z, STRIKES[kind].range);
      if (tgt) this.cmd({ k: 'strike', id: e.id, kind, x: tgt.x, z: tgt.z });
    }
    // Powers
    for (const id of me.powers) {
      if ((me.powerCd[id] ?? 0) > 0) continue;
      const hq = this.hq();
      if (id === 'repair' && hq && hq.hp < hq.maxHp * 0.6) this.cmd({ k: 'power', id, x: hq.x, z: hq.z });
      else if ((id === 'barrage' || id === 'airstrike' || id === 'swarm' || id === 'emp') && this.attackTarget) {
        const t = this.highValueTarget(enemies, this.attackTarget.x, this.attackTarget.z, 30);
        if (t) this.cmd({ k: 'power', id, x: t.x, z: t.z });
      } else if (id === 'cyber') this.cmd({ k: 'power', id, x: 0, z: 0, target: enemies[0] });
      else if (id === 'recon') {
        const e = w.countries[enemies[0]];
        if (e.startX) this.cmd({ k: 'power', id, x: e.startX, z: e.startZ });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Diplomacy

  private diplomacy() {
    const w = this.w;
    const me = this.me;
    const d = w.dip;
    const mine = strength(w, this.idx);
    const enemies = this.enemies();
    // Sue for peace when exhausted or losing.
    for (const e of enemies) {
      if (!w.countries[e].major) continue;
      const age = w.time - d.warSince[this.idx * d.n + e];
      if (age < 180 || w.time - (this.lastPeace.get(e) ?? -1e9) < 90) continue;
      const ratio = mine / Math.max(1, strength(w, e));
      if (me.warWeariness > 35 || ratio < 0.5 || me.stability < 25) {
        this.lastPeace.set(e, w.time);
        this.cmd({ k: 'propose', target: e, kind: 'peace' });
      }
    }
    // Pick a rival: the closest major power we are not allied with, preferring high tension.
    if (!this.rival || !w.countries[this.rival].alive || d.allied(this.idx, this.rival)) {
      let best = 0;
      let bs = Infinity;
      for (const c of w.countries) {
        if (!c.alive || !c.major || c.idx === this.idx || d.allied(this.idx, c.idx) || d.get(this.idx, c.idx) === Rel.Pact) continue;
        const s = dist(me.startX, me.startZ, c.startX, c.startZ) - d.getTension(this.idx, c.idx) * 15 - (c.controller === 'human' ? 200 * AGGRESSION[me.difficulty] : 0);
        if (s < bs) {
          bs = s;
          best = c.idx;
        }
      }
      this.rival = best;
    }
    // Provocations escalate toward war with the rival once we are established.
    const startWar = 240 / AGGRESSION[me.difficulty];
    if (this.rival && !enemies.length && w.time > startWar && me.tier >= 1) {
      this.provokeT += 10;
      d.addTension(this.idx, this.rival, 3 * AGGRESSION[me.difficulty]);
      const ratio = mine / Math.max(1, strength(w, this.rival));
      if (hasCasusBelli(w, this.idx, this.rival) && (ratio > 0.9 || this.provokeT > 300)) this.cmd({ k: 'war', target: this.rival });
    }
    // Opportunistic alliances against shared enemies; trade with friendly neighbours.
    for (const c of w.countries) {
      if (!c.alive || c.idx === this.idx || c.controller === 'human') continue;
      const rel = d.get(this.idx, c.idx);
      if (rel === Rel.War) continue;
      const shared = enemies.some((e) => d.atWar(c.idx, e));
      if (shared && rel < Rel.Alliance && aiAccepts(w, { from: this.idx, to: c.idx, kind: 'alliance' })) this.cmd({ k: 'propose', target: c.idx, kind: 'alliance' });
      else if (!d.flag(d.trade, this.idx, c.idx) && d.getTension(this.idx, c.idx) < 25 && w.rng.next() < 0.1) this.cmd({ k: 'propose', target: c.idx, kind: 'trade' });
      if (c.reputation < 25 && enemies.length && !d.flag(d.sanction, this.idx, c.idx) && d.allied(this.idx, c.idx) === false && enemies.includes(c.idx)) this.cmd({ k: 'sanction', target: c.idx, on: true });
    }
  }
}
