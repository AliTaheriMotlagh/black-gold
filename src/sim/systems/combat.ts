/**
 * Target acquisition and firing. Units only engage countries they are at war with,
 * need sensor contact (own sight for direct fire, alliance vision for indirect fire,
 * radar for aircraft and munitions), slew turrets, respect ammo and salvos.
 */
import type { World } from '../world';
import type { Building, Entity, Projectile, Unit, WeaponState } from '../entities';
import { DT, T_AIR, T_BALLISTIC, T_GROUND, T_MUNITION, T_NAVAL, type WeaponDef } from '../defs';
import { angleDiff, cos, dist, dist2, headingTo, sin, turnToward } from '../dmath';
import { fireWeapon, interceptRoll } from './projectiles';
import { goTo, moveUnits, returnToBase } from './movement';

const TURRETED = new Set(['ifv', 'mbt', 'spg', 'shorad', 'sam_tel', 'fac', 'frigate', 'mlrs']);

export function targetMask(e: Entity): number {
  if (!e.isUnit) return T_GROUND;
  if (e.isAir) return T_AIR;
  if (e.isNaval) return T_NAVAL;
  return T_GROUND;
}

function canHit(w: WeaponDef, e: Entity) {
  return (w.targets & targetMask(e)) !== 0;
}

/** Edge distance from a point to an entity. */
function edgeDist(x: number, z: number, e: Entity) {
  if (e.isUnit) return dist(x, z, e.x, e.z);
  const dx = Math.max(0, Math.abs(e.x - x) - e.half);
  const dz = Math.max(0, Math.abs(e.z - z) - e.half);
  return Math.sqrt(dx * dx + dz * dz);
}

function hostile(w: World, owner: number, e: Entity) {
  return e.alive && w.isEnemy(owner, e.owner);
}

export function updateCombat(w: World) {
  for (const u of w.units) if (u.alive) unitCombat(w, u);
  for (const b of w.buildings) if (b.alive && b.built && b.weapons.length) buildingCombat(w, b);
}

// ---------------------------------------------------------------------------

function unitCombat(w: World, u: Unit) {
  if (u.emp > 0 || u.order === 'docked') return;
  if (u.convoy) {
    tickWeapons(u);
    return;
  }
  if (u.revealed > 0) u.revealed -= DT;
  const def = u.def;
  if (def.kamikaze) {
    kamikaze(w, u);
    return;
  }
  if (!u.weapons.length) return;

  // Primary target from orders.
  let primary = u.target ? w.get(u.target) : undefined;
  if (primary && (!hostile(w, u.owner, primary) || !w.detects(u.owner, primary))) {
    primary = undefined;
    u.target = 0;
    if (u.order === 'attack') {
      u.order = 'idle';
      u.path = [];
    }
    if (u.order === 'attackMove' && !u.path.length && !u.pathPending) moveUnits(w, [u], u.gx, u.gz, true);
  }

  // Scan for targets (staggered).
  const scanNow = (w.tick + u.id) % 8 === 0;
  if (scanNow && !primary && (u.order === 'idle' || u.order === 'attackMove' || u.order === 'guard')) {
    const acquire = u.order === 'attackMove' ? Math.max(maxRange(u), def.sight) : Math.max(maxRange(u), u.hold ? 0 : Math.min(def.sight, maxRange(u) + 1.5));
    const t = findTarget(w, u, null, acquire);
    if (t) {
      u.target = t.id;
      primary = t;
    }
  }

  // Engage / chase the primary target.
  const mainW = primary ? bestWeaponFor(u, primary) : null;
  if (primary && mainW) {
    const d = edgeDist(u.x, u.z, primary);
    const inRange = d <= mainW.def.range && (!mainW.def.minRange || d >= mainW.def.minRange);
    if (!inRange && !u.hold && !u.deployed) {
      // Chase: repath when the target moved or periodically.
      const moved = dist2(u.gx, u.gz, primary.x, primary.z) > 1;
      if ((moved || !u.path.length) && (w.tick + u.id) % 30 === 0) {
        let gx = primary.x;
        let gz = primary.z;
        if (mainW.def.minRange && d < mainW.def.minRange) {
          const a = headingTo(primary.x, primary.z, u.x, u.z);
          gx = primary.x + sin(a) * (mainW.def.minRange + 2);
          gz = primary.z + cos(a) * (mainW.def.minRange + 2);
        }
        if (u.order === 'idle') u.order = 'guard';
        goTo(w, u, gx, gz);
      }
    } else if (inRange && !u.isAir) {
      if (u.path.length && u.order !== 'move') {
        u.path = [];
        u.pathPending = false;
      }
      if (def.deploy && !u.deployed && u.deployT <= 0) {
        u.deployed = true;
        u.deployT = def.deploy;
      }
    }
    if (!TURRETED.has(def.id) && !u.isAir && u.speed < 0.05) {
      u.heading = turnToward(u.heading, headingTo(u.x, u.z, primary.x, primary.z), def.turn * DT);
    }
  }
  if (def.deploy && u.deployT > 0) {
    tickWeapons(u);
    return; // still (un)deploying
  }
  if (def.deploy && !u.deployed && def.id === 'sam_tel' && u.speed < 0.01 && u.order === 'idle' && !u.pathPending) {
    u.deployed = true;
    u.deployT = def.deploy;
  }

  // Fire each weapon.
  let anyAmmo = false;
  for (const ws of u.weapons) {
    if (ws.cooldown > 0) ws.cooldown -= DT;
    if (ws.ammo > 0) anyAmmo = true;
    if (ws.salvoLeft > 0) {
      salvo(w, u, ws);
      continue;
    }
    if (ws.ammo <= 0) continue;
    if (def.deploy && !u.deployed && ws.def.delivery === 'sam') continue;
    let target: Entity | undefined;
    let proj: Projectile | undefined;
    if (primary && canHit(ws.def, primary)) target = primary;
    else if (ws.target) {
      if (ws.target < 0) proj = w.projectiles.find((p) => p.id === -ws.target && p.alive);
      else target = w.get(ws.target);
      if (target && (!hostile(w, u.owner, target) || !canHit(ws.def, target) || edgeDist(u.x, u.z, target) > ws.def.range)) target = undefined;
      if (proj && dist(u.x, u.z, proj.x, proj.z) > ws.def.range) proj = undefined;
      if (!target && !proj) ws.target = 0;
    }
    if (!target && !proj && (w.tick + u.id + ws.def.id.length) % 6 === 0) {
      if (ws.def.targets & (T_MUNITION | T_BALLISTIC)) proj = findThreat(w, u.owner, u.x, u.z, ws.def);
      if (!proj && !u.hold) target = findTarget(w, u, ws.def, ws.def.range) ?? undefined;
      else if (!proj) target = findTarget(w, u, ws.def, ws.def.range) ?? undefined;
      ws.target = proj ? -proj.id : target ? target.id : 0;
    }
    if (!target && !proj) continue;
    const tx = proj ? proj.x : target!.x;
    const tz = proj ? proj.z : target!.z;
    const d = proj ? dist(u.x, u.z, tx, tz) : edgeDist(u.x, u.z, target!);
    if (d > ws.def.range || (ws.def.minRange && d < ws.def.minRange)) continue;
    // Aim
    const want = headingTo(u.x, u.z, tx, tz);
    let aligned: boolean;
    if (TURRETED.has(def.id)) {
      u.turretYaw = turnToward(u.turretYaw, angleDiff(u.heading, want), 2.2 * DT);
      aligned = Math.abs(angleDiff(u.turretYaw, angleDiff(u.heading, want))) < 0.12;
    } else if (def.flight === 'jet' || def.flight === 'drone') {
      // Air-to-ground needs a forward aspect; air-to-air missiles are all-aspect.
      aligned = ws.def.delivery === 'sam' || Math.abs(angleDiff(u.heading, want)) < 0.7;
    } else aligned = Math.abs(angleDiff(u.heading, want)) < 0.35 || def.category === 'infantry';
    if (!aligned || ws.cooldown > 0) continue;
    ws.cooldown = ws.def.cooldown;
    if (ws.def.salvo && ws.def.salvo > 1) {
      ws.salvoLeft = ws.def.salvo;
      ws.salvoTimer = 0;
      ws.salvoX = tx;
      ws.salvoZ = tz;
      salvo(w, u, ws);
    } else {
      fireWeapon(w, u, ws, target ?? null, proj ?? null, tx, tz);
    }
    if (ws.ammo !== Infinity) ws.ammo--;
    if (def.stealth) u.revealed = 4;
  }
  // Out of ammo aircraft return to rearm.
  if (u.isAir && !anyAmmo && u.weapons.length && u.order !== 'rtb') returnToBase(w, u);
}

function tickWeapons(u: Unit) {
  for (const ws of u.weapons) if (ws.cooldown > 0) ws.cooldown -= DT;
}

function salvo(w: World, e: Unit | Building, ws: WeaponState) {
  ws.salvoTimer -= DT;
  if (ws.salvoTimer > 0) return;
  ws.salvoTimer = ws.def.salvoGap ?? 0.2;
  ws.salvoLeft--;
  fireWeapon(w, e, ws, null, null, ws.salvoX, ws.salvoZ);
}

function maxRange(u: Unit) {
  let r = 0;
  for (const ws of u.weapons) if (ws.ammo > 0 && ws.def.range > r && ws.def.targets & (T_GROUND | T_NAVAL | T_AIR)) r = ws.def.range;
  return r;
}

function bestWeaponFor(u: Unit, t: Entity): WeaponState | null {
  let best: WeaponState | null = null;
  for (const ws of u.weapons) {
    if (ws.ammo <= 0 || !canHit(ws.def, t)) continue;
    if (!best || ws.def.range > best.def.range) best = ws;
  }
  return best;
}

/**
 * Best entity target for `e` (optionally for one weapon) within `range`.
 * Ground targets beyond the shooter's own sight need alliance vision.
 */
function findTarget(w: World, e: Unit | Building, weapon: WeaponDef | null, range: number): Entity | null {
  const owner = e.owner;
  const weapons = weapon ? [weapon] : e.weapons.filter((ws) => ws.ammo > 0).map((ws) => ws.def);
  if (!weapons.length) return null;
  let mask = 0;
  for (const wd of weapons) mask |= wd.targets;
  const sight = e.isUnit ? e.def.sight : e.def.sight + e.half;
  let best: Entity | null = null;
  let bestScore = Infinity;
  const consider = (t: Entity, d: number) => {
    if (!weapons.some((wd) => (wd.targets & targetMask(t)) !== 0 && d <= Math.max(range, wd.range) && (!wd.minRange || d >= wd.minRange))) return;
    if (!w.detects(owner, t)) return;
    if (!t.isUnit || !t.isAir) {
      if (d > sight && !w.visibleTo(owner, t.x, t.z)) return;
    }
    // Prefer armed threats, then damaged, then close.
    const armed = t.weapons.length ? -2 : 0;
    const score = d + armed - (1 - t.hp / t.maxHp) * 1.5 + (t.isUnit ? 0 : 1.5);
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  };
  if (mask & (T_GROUND | T_AIR | T_NAVAL)) {
    w.hash.query(e.x, e.z, range, w.near);
    for (const t of w.near) {
      if (!t.alive || !w.isEnemy(owner, t.owner)) continue;
      if (t.order === 'docked') continue;
      const d = dist(e.x, e.z, t.x, t.z);
      if (d <= range) consider(t, d);
    }
  }
  if (mask & T_GROUND) {
    for (const b of w.buildings) {
      if (!b.alive || !w.isEnemy(owner, b.owner)) continue;
      if (Math.abs(b.x - e.x) > range + 1 || Math.abs(b.z - e.z) > range + 1) continue;
      const d = edgeDist(e.x, e.z, b);
      if (d <= range) consider(b, d);
    }
  }
  return best;
}

/** Incoming munition (rocket, shell, missile) this weapon can engage. */
function findThreat(w: World, owner: number, x: number, z: number, wd: WeaponDef): Projectile | undefined {
  let best: Projectile | undefined;
  let bd = Infinity;
  const r2 = wd.range * wd.range;
  const guided = wd.delivery === 'sam';
  for (const p of w.projectiles) {
    if (!p.alive || !p.threat || !(p.threat & wd.targets)) continue;
    if (p.owner === owner || !w.isEnemy(owner, p.owner)) continue;
    if (guided && p.engaged >= 2) continue;
    const d = dist2(x, z, p.x, p.z);
    if (d > r2 || d >= bd) continue;
    if (!w.vision.detectsProjectile(owner, p)) continue;
    // Only engage munitions heading roughly our way (within 15 km of their impact point).
    if (dist2(x, z, p.tx, p.tz) > (wd.range + 15) * (wd.range + 15)) continue;
    bd = d;
    best = p;
  }
  return best;
}

// ---------------------------------------------------------------------------

function buildingCombat(w: World, b: Building) {
  const c = w.countries[b.owner];
  if (b.emp > 0) {
    b.emp -= DT;
    return;
  }
  const slow = c.lowPower ? 0.5 : 1;
  for (const ws of b.weapons) {
    if (ws.cooldown > 0) ws.cooldown -= DT * slow;
    let target: Entity | undefined;
    let proj: Projectile | undefined;
    if (ws.target < 0) proj = w.projectiles.find((p) => p.id === -ws.target && p.alive);
    else if (ws.target > 0) target = w.get(ws.target);
    if (target && (!hostile(w, b.owner, target) || edgeDist(b.x, b.z, target) > ws.def.range || !w.detects(b.owner, target))) target = undefined;
    if (proj && dist(b.x, b.z, proj.x, proj.z) > ws.def.range) proj = undefined;
    if (!target && !proj && (w.tick + b.id + ws.def.id.length) % 6 === 0) {
      if (ws.def.targets & (T_MUNITION | T_BALLISTIC)) proj = findThreat(w, b.owner, b.x, b.z, ws.def);
      if (!proj) target = findTarget(w, b, ws.def, ws.def.range) ?? undefined;
    }
    ws.target = proj ? -proj.id : target ? target.id : 0;
    if (!target && !proj) continue;
    const tx = proj ? proj.x : target!.x;
    const tz = proj ? proj.z : target!.z;
    const want = headingTo(b.x, b.z, tx, tz);
    b.turretYaw = turnToward(b.turretYaw, want, 2.5 * DT);
    if (Math.abs(angleDiff(b.turretYaw, want)) > 0.15 || ws.cooldown > 0) continue;
    ws.cooldown = ws.def.cooldown;
    fireWeapon(w, b, ws, target ?? null, proj ?? null, tx, tz);
  }
}

// ---------------------------------------------------------------------------

/** One-way drones: FPV quadcopters and Shahed-type loitering munitions. */
function kamikaze(w: World, u: Unit) {
  const k = u.def.kamikaze!;
  let tx = NaN;
  let tz = NaN;
  let target = u.target ? w.get(u.target) : undefined;
  if (target && !hostile(w, u.owner, target)) {
    target = undefined;
    u.target = 0;
  }
  if (!target && u.order === 'idle' && u.jammed <= 0 && (w.tick + u.id) % 10 === 0) {
    // FPV operators hunt vehicles; loitering munitions hunt anything valuable in sight.
    let best: Entity | null = null;
    let bd = Infinity;
    w.hash.query(u.x, u.z, u.def.sight, w.near);
    for (const t of w.near) {
      if (!t.alive || t.isAir || !w.isEnemy(u.owner, t.owner) || !w.detects(u.owner, t)) continue;
      const d = dist(u.x, u.z, t.x, t.z) - (t.def.armor === 'infantry' ? -1 : 0) - t.def.cost / 2000;
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    if (!best) {
      for (const b of w.buildings) {
        if (!b.alive || !w.isEnemy(u.owner, b.owner)) continue;
        const d = dist(u.x, u.z, b.x, b.z);
        if (d < u.def.sight && d < bd) {
          bd = d;
          best = b;
        }
      }
    }
    if (best) {
      u.target = best.id;
      u.order = 'attack';
      target = best;
    }
  }
  if (target) {
    tx = target.x;
    tz = target.z;
    u.path = [tx, tz];
    u.pathIdx = 0;
  } else if (u.order === 'strike' || u.order === 'kamikaze') {
    tx = u.gx;
    tz = u.gz;
  }
  if (tx !== tx) return;
  const hitR = target ? (target.isUnit ? target.radius : target.half) + 0.06 : 0.08;
  if (dist(u.x, u.z, tx, tz) < hitR + u.def.speed * DT) {
    // Detonate
    w.events.push({ t: 'boom', x: u.x, y: 0, z: u.z, size: k.splash > 0.1 ? 1.4 : 0.6, kind: 'kamikaze' });
    const dmg = k.damage * (w.countries[u.owner].has('swarm') ? 1.4 : 1);
    if (target) w.applyDamage(target, dmg, 'kamikaze', u, u.owner);
    w.splash(u.x, u.z, k.splash, dmg * 0.5, 'kamikaze', u, u.owner);
    u.hp = 0;
    w.kill(u, null, 0);
  }
}

/** Interceptor-style instant engagement (used by flak/laser vs munitions). */
export { interceptRoll };
