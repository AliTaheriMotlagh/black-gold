import { CELL } from '../geo/geography';
import { BUILDINGS, DIFFICULTY, ECONOMY, UNITS, type BuildingKind, type UnitKind } from './config';
import type { Building, Unit } from './entities';
import type { World } from './World';

/**
 * Skirmish AI: expands to oil, captures cities, builds a mixed army, defends, and attacks in waves.
 * It sees the whole map (classic RTS AI behaviour), but plays by the same economic rules.
 */
export class AIController {
  private timer = 2 + Math.random() * 2;
  private attackers = new Set<Unit>();
  private nextAttack: number;
  private waves = 0;
  private targetTeam = -1;

  constructor(private world: World, readonly team: number) {
    this.nextAttack = DIFFICULTY[world.teams[team].difficulty].firstAttack;
  }

  private get t() {
    return this.world.teams[this.team];
  }

  update(dt: number) {
    if (!this.t.alive || this.world.ended) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = DIFFICULTY[this.t.difficulty].thinkRate;
    this.manageBase();
    this.manageProduction();
    this.manageArmy();
    this.useSilo();
  }

  private hq(): Building | undefined {
    return this.world.buildings.find((b) => b.alive && b.team === this.team && b.kind === 'hq') ?? this.world.buildings.find((b) => b.alive && b.team === this.team && b.kind !== 'derrick');
  }

  private count(kind: BuildingKind, includeUnbuilt = true) {
    return this.world.buildings.filter((b) => b.alive && b.team === this.team && b.kind === kind && (includeUnbuilt || b.built)).length;
  }

  private manageBase() {
    const w = this.world;
    const t = this.t;
    const constructing = w.buildings.filter((b) => b.alive && b.team === this.team && !b.built).length;
    const maxConcurrent = t.difficulty === 'hard' ? 2 : 1;
    if (constructing >= maxConcurrent) return;
    const time = w.time;
    const derricks = this.count('derrick');
    const powerMargin = t.powerProd - t.powerUse;

    const wants: BuildingKind[] = [];
    if (powerMargin < 6) wants.push('power');
    if (!this.count('barracks')) wants.push('barracks');
    if (derricks < Math.min(7, 2 + Math.floor(time / 110))) wants.push('derrick');
    if (!this.count('factory') && this.count('barracks', false)) wants.push('factory');
    if (derricks >= 2 && this.count('refinery') < Math.min(3, Math.floor(derricks / 2))) wants.push('refinery');
    if (this.count('turret') < Math.min(4, 1 + Math.floor(time / 220))) wants.push('turret');
    if (this.count('factory', false) && time > 280 && this.count('samsite') < (time > 700 ? 2 : 1)) wants.push('samsite');
    if (this.count('factory', false) && time > 330 && !this.count('airfield')) wants.push('airfield');
    if (t.difficulty !== 'easy' && time > 560 && this.count('airfield', false) && !this.count('silo')) wants.push('silo');
    if (time > 400 && this.count('barracks') < 2 && t.credits > 2500) wants.push('barracks');
    if (time > 500 && this.count('factory') < 2 && t.credits > 4000) wants.push('factory');

    for (const want of wants) {
      // Resolve prerequisites first (e.g. barracks needs a power plant).
      let kind = want;
      for (let guard = 0; guard < 4; guard++) {
        const missing = w.requirementsMet(this.team, kind);
        if (!missing.length) break;
        kind = missing[0];
      }
      if (w.teamBuildings(this.team, kind, false).some((b) => !b.built)) continue; // already under construction
      const def = BUILDINGS[kind];
      if (t.credits < def.cost || t.oil < def.oil) continue;
      if (w.requirementsMet(this.team, kind).length || w.atLimit(this.team, kind)) continue;
      if (this.tryBuild(kind)) return;
    }
  }

  private tryBuild(kind: BuildingKind): boolean {
    const w = this.world;
    const hq = this.hq();
    if (!hq) return false;
    if (kind === 'derrick') {
      const fields = w.oilFields
        .filter((f) => !f.derrick && !w.units.some((u) => u.alive && u.team !== this.team && Math.hypot(u.x - f.x, u.z - f.z) < 10))
        .map((f) => ({ f, d: Math.hypot(f.x - hq.x, f.z - hq.z) }))
        .filter((o) => o.d < 150)
        .sort((a, b) => a.d - b.d);
      for (const { f } of fields) if (w.placeBuilding(this.team, 'derrick', f.cx, f.cz)) return true;
      return false;
    }
    const size = BUILDINGS[kind].size;
    let cx = Math.floor(hq.x / CELL);
    let cz = Math.floor(hq.z / CELL);
    if (kind === 'turret' || kind === 'samsite') {
      // Face the nearest enemy
      const enemy = this.nearestEnemyBase(hq.x, hq.z);
      if (enemy) {
        const a = Math.atan2(enemy.x - hq.x, enemy.z - hq.z) + (Math.random() - 0.5) * 1.2;
        cx += Math.round(Math.sin(a) * 7);
        cz += Math.round(Math.cos(a) * 7);
      }
    } else {
      cx += Math.round((Math.random() - 0.5) * 8);
      cz += Math.round((Math.random() - 0.5) * 8);
    }
    const spot = w.findFootprint(cx, cz, size, (x, z) => w.placementError(this.team, kind, x, z) === null && w.areaFree(x, z, size, false, 1), 14);
    if (!spot) return false;
    return w.placeBuilding(this.team, kind, spot.cx, spot.cz);
  }

  private nearestEnemyBase(x: number, z: number): Building | null {
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of this.world.buildings) {
      if (!b.alive || b.team === this.team) continue;
      if (this.targetTeam >= 0 && b.team !== this.targetTeam && this.world.teams[this.targetTeam].alive) continue;
      const d = Math.hypot(b.x - x, b.z - z) + (b.kind === 'derrick' ? 30 : 0);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  private manageProduction() {
    const w = this.world;
    const t = this.t;
    if (t.pop >= ECONOMY.popCap - 4) return;
    const enemyAir = w.units.filter((u) => u.alive && u.team !== this.team && u.isAir).length;
    const ownSam = w.units.filter((u) => u.alive && u.team === this.team && u.kind === 'sam').length;
    const time = w.time;
    const reserve = this.count('derrick') < 3 ? 350 : 0; // keep cash for expansion early

    const queueAt = (producer: BuildingKind, pick: () => UnitKind, maxQueue: number) => {
      for (const b of w.teamBuildings(this.team, producer)) {
        if (b.queue.length >= maxQueue) continue;
        const kind = pick();
        const def = UNITS[kind];
        if (t.credits - def.cost < reserve || t.oil < def.oil) return;
        w.queueUnit(this.team, kind);
      }
    };
    queueAt('barracks', () => (Math.random() < (time < 240 ? 0.65 : 0.4) ? 'rifleman' : 'rpg'), 2);
    queueAt(
      'factory',
      () => {
        if (enemyAir > ownSam * 2 && Math.random() < 0.6) return 'sam';
        const r = Math.random();
        if (time < 300) return r < 0.6 ? 'technical' : 'tank';
        return r < 0.2 ? 'technical' : r < 0.65 ? 'tank' : r < 0.9 ? 'rocket' : 'sam';
      },
      2,
    );
    queueAt('airfield', () => (Math.random() < 0.65 ? 'heli' : 'drone'), 1);
  }

  private manageArmy() {
    const w = this.world;
    const hq = this.hq();
    if (!hq) return;
    for (const u of this.attackers) if (!u.alive) this.attackers.delete(u);
    const army = w.units.filter((u) => u.alive && u.team === this.team);
    const home = army.filter((u) => !this.attackers.has(u));

    // Defend: buildings hurt recently
    const hurt = w.buildings.find((b) => b.alive && b.team === this.team && w.time - b.lastHurt < 6);
    if (hurt) {
      const defenders = home.filter((u) => u.order === 'idle' && Math.hypot(u.x - hurt.x, u.z - hurt.z) < 70);
      if (defenders.length) w.commandMove(defenders, hurt.x, hurt.z, true);
    }

    // Capture cities with spare infantry
    const infantry = home.filter((u) => u.def.canCapture && u.order === 'idle' && !u.target);
    if (infantry.length >= 2) {
      const city = w.cities
        .filter((c) => c.owner !== this.team)
        .map((c) => ({ c, d: Math.hypot(c.x - hq.x, c.z - hq.z) + (c.owner >= 0 ? 40 : 0) }))
        .filter((o) => o.d < 130)
        .sort((a, b) => a.d - b.d)[0];
      if (city) {
        const squad = infantry.slice(0, 3);
        w.commandMove(squad, city.c.x, city.c.z, true);
      }
    }

    // Attack waves
    const diff = DIFFICULTY[this.t.difficulty];
    const needed = diff.attackSize + this.waves * 2;
    const ready = home.filter((u) => !u.def.canCapture || u.kind === 'rpg').filter((u) => u.order === 'idle');
    if (w.time > this.nextAttack && ready.length >= needed) {
      this.pickTargetTeam(hq);
      const target = this.nearestEnemyBase(hq.x, hq.z);
      if (target) {
        for (const u of ready) this.attackers.add(u);
        w.commandMove(ready, target.x, target.z, true);
        this.waves++;
        this.nextAttack = w.time + 120 + Math.random() * 60;
      }
    }
    // Keep attackers pushing
    const idleAttackers = [...this.attackers].filter((u) => u.order === 'idle' && !u.target);
    if (idleAttackers.length) {
      const target = this.nearestEnemyBase(idleAttackers[0].x, idleAttackers[0].z);
      if (target) w.commandMove(idleAttackers, target.x, target.z, true);
      else for (const u of idleAttackers) this.attackers.delete(u);
    }
  }

  private pickTargetTeam(hq: Building) {
    const w = this.world;
    if (this.targetTeam >= 0 && w.teams[this.targetTeam].alive && Math.random() < 0.7) return;
    const alive = w.teams.filter((t) => t.alive && t.id !== this.team);
    if (!alive.length) return;
    // Prefer the human player 50% of the time, otherwise the closest rival.
    const player = alive.find((t) => t.id === w.playerTeam);
    if (player && Math.random() < 0.5) {
      this.targetTeam = player.id;
      return;
    }
    alive.sort((a, b) => Math.hypot(a.startX - hq.x, a.startZ - hq.z) - Math.hypot(b.startX - hq.x, b.startZ - hq.z));
    this.targetTeam = alive[0].id;
  }

  private useSilo() {
    const w = this.world;
    const silo = w.buildings.find((b) => b.alive && b.team === this.team && w.siloReady(b));
    if (!silo) return;
    let best: Building | null = null;
    let bestScore = 0;
    for (const b of w.buildings) {
      if (!b.alive || b.team === this.team) continue;
      let score = BUILDINGS[b.kind].cost;
      for (const o of w.buildings) if (o !== b && o.alive && o.team === b.team && Math.hypot(o.x - b.x, o.z - b.z) < ECONOMY.missileRadius) score += BUILDINGS[o.kind].cost * 0.7;
      if (score > bestScore) {
        bestScore = score;
        best = b;
      }
    }
    if (best) w.launchMissile(silo, best.x + (Math.random() - 0.5) * 4, best.z + (Math.random() - 0.5) * 4);
  }
}
