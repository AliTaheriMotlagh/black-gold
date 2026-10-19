/**
 * General's powers (Generals Zero Hour style): promotions grant command points that
 * permanently unlock powers; each use then has a cooldown.
 */
import type { World } from '../world';
import type { Projectile } from '../entities';
import { DT, POWERS, T_MUNITION, UNITS } from '../defs';
import { cos, dist2, sin, sqrt } from '../dmath';
import { moveUnits } from './movement';

export function unlockPower(w: World, owner: number, id: string) {
  const c = w.countries[owner];
  const def = POWERS.find((p) => p.id === id);
  if (!def || c.powers.includes(id) || c.points < def.points) return false;
  c.points -= def.points;
  c.powers.push(id);
  return true;
}

export function usePower(w: World, owner: number, id: string, x: number, z: number, targetCountry = 0): boolean {
  const c = w.countries[owner];
  const def = POWERS.find((p) => p.id === id);
  if (!def || !c.powers.includes(id) || (c.powerCd[id] ?? 0) > 0) return false;
  const rng = w.rng;
  switch (id) {
    case 'recon':
      w.reveals.push({ x, z, r: def.radius, owner, until: w.time + 25 });
      break;
    case 'repair':
      for (const u of w.units) if (u.alive && u.owner === owner && dist2(u.x, u.z, x, z) < def.radius * def.radius) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.5);
      for (const b of w.buildings) if (b.alive && b.owner === owner && dist2(b.x, b.z, x, z) < def.radius * def.radius) b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.5);
      break;
    case 'barrage':
      for (let i = 0; i < 28; i++) {
        const a = rng.next() * 6.283185307179586;
        const r = sqrt(rng.next()) * def.radius;
        offmapShell(w, owner, x + sin(a) * r, z + cos(a) * r, 0.4 + i * 0.15);
      }
      break;
    case 'paradrop':
      for (let i = 0; i < 8; i++) {
        const kind = i < 6 ? 'rifle' : 'atgm_team';
        const a = (i / 8) * 6.283185307179586;
        const p = w.landNear(x + sin(a) * 0.25, z + cos(a) * 0.25);
        const u = w.spawnUnit(kind, owner, p.x, p.z);
        c.supply += UNITS[kind].supply;
        u.heading = a;
      }
      break;
    case 'swarm': {
      const spawned = [];
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * 6.283185307179586;
        const u = w.spawnUnit('fpv', owner, x + sin(a) * 0.3, z + cos(a) * 0.3);
        u.y = 0.08;
        spawned.push(u);
      }
      moveUnits(w, spawned, x, z, true);
      break;
    }
    case 'airstrike':
      for (let i = 0; i < 6; i++) offmapBomb(w, owner, x + (rng.next() - 0.5) * def.radius * 2, z + (rng.next() - 0.5) * def.radius * 2, 1 + i * 0.25);
      break;
    case 'cyber': {
      const victim = targetCountry || w.ownerAt(x, z);
      if (victim <= 0 || !w.isEnemy(owner, victim)) return false;
      w.countries[victim].blackout = 30;
      w.alert(victim, 'blackout', 'bad');
      break;
    }
    case 'emp':
      for (const u of w.units) if (u.alive && u.owner !== owner && !w.allied(owner, u.owner) && dist2(u.x, u.z, x, z) < def.radius * def.radius) u.emp = 20;
      for (const b of w.buildings) if (b.alive && b.owner !== owner && !w.allied(owner, b.owner) && dist2(b.x, b.z, x, z) < def.radius * def.radius) b.emp = 20;
      break;
  }
  c.powerCd[id] = def.cooldown;
  w.events.push({ t: 'power', id, owner, x, z });
  return true;
}

function offmapShell(w: World, owner: number, x: number, z: number, delay: number) {
  const p = blankShell(w, owner, x, z);
  p.delivery = 'artillery';
  p.kind = 'howitzer';
  p.sx = x - 30;
  p.sz = z - 10;
  p.x = p.sx;
  p.z = p.sz;
  p.dur = 8 + delay;
  p.apex = 8;
  p.damage = 110;
  p.splash = 0.35;
  p.threat = T_MUNITION;
  p.life = p.dur + 1;
  w.projectiles.push(p);
}

function offmapBomb(w: World, owner: number, x: number, z: number, delay: number) {
  const p = blankShell(w, owner, x, z);
  p.delivery = 'artillery';
  p.kind = 'gbu';
  p.sx = x - 3;
  p.sz = z;
  p.x = p.sx;
  p.z = p.sz;
  p.dur = 2.5 + delay;
  p.apex = 2.5;
  p.damage = 650;
  p.splash = 0.3;
  p.life = p.dur + 1;
  w.projectiles.push(p);
}

function blankShell(w: World, owner: number, x: number, z: number): Projectile {
  return {
    id: w.nextProjectile++,
    kind: '',
    delivery: 'artillery',
    owner,
    source: 0,
    x,
    y: 0,
    z,
    px: x,
    py: 0,
    pz: z,
    vx: 0,
    vy: 0,
    vz: 0,
    speed: 4,
    target: 0,
    tx: x,
    tz: z,
    damage: 0,
    splash: 0,
    pk: 1,
    threat: 0,
    evasion: 1,
    radarMul: 1,
    t: 0,
    dur: 1,
    sx: x,
    sz: z,
    apex: 1,
    life: 10,
    engaged: 0,
    alive: true,
  };
}

export function updatePowers(w: World) {
  if (w.tick % 20 !== 0) return;
  for (const c of w.countries) {
    if (!c.alive) continue;
    for (const k of Object.keys(c.powerCd)) if (c.powerCd[k] > 0) c.powerCd[k] = Math.max(0, c.powerCd[k] - DT * 20);
  }
}
