/**
 * Construction (builders must be on site), unit production queues, research, HQ tier
 * upgrades, missile reloads and repairs.
 */
import type { World } from '../world';
import type { Building, Unit } from '../entities';
import { DT, ECON, RESEARCH, TIER_UPGRADE, UNITS } from '../defs';
import type { Difficulty } from '../country';
import { cos, dist, headingTo, sin } from '../dmath';
import { goTo, moveUnits } from './movement';

export const AI_SPEED: Record<Difficulty, number> = { easy: 0.75, normal: 1, hard: 1.2, brutal: 1.45 };

function onSite(u: Unit, b: Building) {
  const h = b.half + u.radius + 0.25;
  return Math.abs(u.x - b.x) <= h && Math.abs(u.z - b.z) <= h;
}

/** Approach point at the edge of a building facing the unit. */
export function edgePoint(u: Unit, b: Building) {
  const a = headingTo(b.x, b.z, u.x, u.z);
  const r = b.half + u.radius + 0.12;
  return { x: b.x + sin(a) * r, z: b.z + cos(a) * r };
}

export function updateProduction(w: World) {
  for (const b of w.buildings) b.workers = 0;

  // Builders and repairers.
  for (const u of w.units) {
    if (!u.alive) continue;
    if (u.strikeCd > 0) u.strikeCd -= DT;
    if (u.order === 'build') {
      const b = w.get(u.task);
      if (!b || b.isUnit || b.built) {
        u.order = 'idle';
        u.task = -1;
        continue;
      }
      if (onSite(u, b)) {
        b.workers++;
        u.path = [];
        u.speed = 0;
      } else if (!u.pathPending && !u.path.length) {
        const p = edgePoint(u, b);
        goTo(w, u, p.x, p.z);
      }
    } else if (u.order === 'repair') {
      const t = w.get(u.task);
      if (!t || t.hp >= t.maxHp || w.isEnemy(u.owner, t.owner)) {
        u.order = 'idle';
        u.task = -1;
        continue;
      }
      const close = t.isUnit ? dist(u.x, u.z, t.x, t.z) < u.radius + t.radius + 0.2 : onSite(u, t);
      if (close) {
        t.hp = Math.min(t.maxHp, t.hp + t.maxHp * ECON.repairRate * DT);
        u.path = [];
      } else if (!u.pathPending && !u.path.length) {
        const p = t.isUnit ? { x: t.x, z: t.z } : edgePoint(u, t);
        goTo(w, u, p.x, p.z);
      }
    }
  }

  for (const b of w.buildings) {
    if (!b.alive) continue;
    const c = w.countries[b.owner];
    const aiMul = c.controller === 'ai' ? AI_SPEED[c.difficulty] : 1;
    if (!b.built) {
      // Oil derricks are built by contracted crews (offshore ones need a naval base).
      if (b.oilField >= 0 && (!w.oil[b.oilField].offshore || w.hasBuilding(b.owner, 'shipyard'))) b.workers = Math.max(1, b.workers);
      if (b.workers > 0) {
        const crew = b.workers === 1 ? 1 : 1 + Math.min(1.5, (b.workers - 1) * 0.6);
        const dp = (DT / b.def.time) * crew * aiMul;
        b.progress = Math.min(1, b.progress + dp);
        b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.95 * dp);
        if (b.progress >= 1) {
          b.built = true;
          w.recount(c);
          w.events.push({ t: 'built', id: b.id, owner: b.owner });
          w.alert(b.owner, 'buildComplete', 'good', b.x, b.z, `bld.${b.def.id}`);
          w.sound('complete', b.x, b.z);
        }
      }
      continue;
    }
    if (b.emp > 0) continue;
    const speed = (c.lowPower ? ECON.lowPowerFactor : 1) * aiMul;

    if (b.queue.length) {
      const kind = b.queue[0];
      b.prodTime += DT * speed;
      if (b.prodTime >= UNITS[kind].time) {
        b.prodTime = 0;
        b.queue.shift();
        const u = spawnFrom(w, b, kind);
        if (u) {
          c.stats.unitsBuilt++;
          w.events.push({ t: 'trained', id: u.id, owner: u.owner });
          w.alert(b.owner, 'unitReady', 'info', u.x, u.z, `unit.${kind}`);
        }
      }
    }
    if (b.research) {
      const def = RESEARCH.find((r) => r.id === b.research)!;
      b.researchT += DT * speed;
      if (b.researchT >= def.time) {
        if (!c.researched.includes(def.id)) c.researched.push(def.id);
        w.alert(b.owner, 'researchDone', 'good', b.x, b.z, `res.${def.id}`);
        w.sound('complete', b.x, b.z);
        b.research = '';
        b.researchT = 0;
      }
    }
    if (b.upgrade) {
      const def = TIER_UPGRADE[b.upgrade as 2 | 3];
      b.upgradeT += DT * speed;
      if (b.upgradeT >= def.time) {
        c.tier = Math.max(c.tier, b.upgrade);
        w.alert(b.owner, 'tierUp', 'good', b.x, b.z, String(c.tier));
        w.sound('achievement', b.x, b.z);
        b.upgrade = 0;
        b.upgradeT = 0;
      }
    }
    if (b.def.strike && b.strikeCd > 0) {
      b.strikeCd -= DT * speed;
      if (b.strikeCd <= 0) w.alert(b.owner, 'missileReady', 'good', b.x, b.z);
    }
  }
}

function spawnFrom(w: World, b: Building, kind: string): Unit | null {
  const def = UNITS[kind];
  let x = b.x;
  let z = b.z + b.half + def.radius + 0.1;
  if (def.domain === 'sea') {
    const p = w.seaNear(b.x, b.z);
    if (!p) return null;
    x = p.x;
    z = p.z;
  } else if (def.domain === 'land') {
    const p = w.landNear(x, z);
    x = p.x;
    z = p.z;
  } else {
    x = b.x;
    z = b.z;
  }
  const u = w.spawnUnit(kind, b.owner, x, z);
  u.heading = 0;
  if (u.isAir) {
    u.home = b.def.rearm || b.def.id === 'dronefac' ? b.id : 0;
    u.ox = b.x;
    u.oz = b.z + 2;
  }
  if (b.rallyX === b.rallyX) moveUnits(w, [u], b.rallyX, b.rallyZ, def.category !== 'vehicle' || !def.builder);
  else if (!u.isAir) moveUnits(w, [u], x + ((u.id % 5) - 2) * 0.12, z + 0.35 + (Math.floor(u.id / 5) % 3) * 0.12);
  return u;
}
