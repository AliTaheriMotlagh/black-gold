/**
 * Projectile physics.
 *
 * - Hitscan (bullets, flak, lasers): resolved instantly with hit/kill probabilities.
 * - Direct fire shells: fly straight to a lead-predicted aim point; they hit only if the
 *   target is still there (moving targets can be missed).
 * - Artillery, rockets, ballistic and hypersonic missiles: parabolic arcs (deterministic
 *   closed form), interceptable while in flight.
 * - Guided munitions (ATGM, AGM, SAM, AAM, ASM, torpedo, bombs): turn-rate-limited
 *   pursuit with lead, proximity fuse, kill probability; interceptors aim at the
 *   predicted position of their target along its arc.
 */
import type { World } from '../world';
import type { Building, Entity, Projectile, Unit, WeaponState } from '../entities';
import { DT, STRIKES, T_BALLISTIC, T_MUNITION, type StrikeKind } from '../defs';
import { clamp, cos, dist, sin, sqrt } from '../dmath';

const GUIDED_TURN: Record<string, number> = { atgm: 2.2, agm: 2.5, asm: 1.6, sam: 4.5, torpedo: 1.2, bomb: 1.5, warhead: 0.8 };

function baseProjectile(w: World, kind: string, owner: number, source: number, x: number, y: number, z: number): Projectile {
  return {
    id: w.nextProjectile++,
    kind,
    delivery: 'shell',
    owner,
    source,
    x,
    y,
    z,
    px: x,
    py: y,
    pz: z,
    vx: 0,
    vy: 0,
    vz: 0,
    speed: 0,
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
    dur: 0,
    sx: x,
    sz: z,
    apex: 0,
    life: 30,
    engaged: 0,
    alive: true,
  };
}

function muzzleY(e: Entity) {
  return e.isUnit && e.isAir ? e.y : e.isUnit ? 0.004 : 0.01 + (e as Building).half * 0.3;
}

function aimY(e: Entity) {
  return e.isUnit && e.isAir ? e.y : 0.003;
}

export function interceptRoll(w: World, pk: number, p: Projectile) {
  return w.rng.next() < pk * p.evasion;
}

/** Fire one round from `ws` at an entity, a munition, or a ground point. */
export function fireWeapon(w: World, e: Unit | Building, ws: WeaponState, target: Entity | null, proj: Projectile | null, tx: number, tz: number) {
  const d = ws.def;
  const owner = e.owner;
  const c = w.countries[owner];
  const mx = e.x;
  const mz = e.z;
  const my = muzzleY(e);
  const ty = proj ? proj.y : target ? aimY(target) : 0;
  w.events.push({ t: 'fire', id: e.id, w: d.id, x: mx, y: my, z: mz, tx, ty, tz, owner });

  // --- Hitscan ---------------------------------------------------------------
  if (d.speed === 0) {
    if (proj) {
      const pk = (d.pk ?? 0.1) * (c.has('aesa') ? 1.1 : 1);
      if (interceptRoll(w, pk, proj)) destroyThreat(w, proj, owner);
      return;
    }
    if (!target) return;
    let hit = d.delivery === 'laser' ? 0.95 : d.delivery === 'flak' ? (target.isUnit && target.isAir ? 0.65 : 0.5) : 0.8;
    if (target.isUnit && target.speed > 0.3) hit -= 0.15;
    if (w.rng.next() < hit) w.applyDamage(target, d.damage, d.delivery, e, owner);
    return;
  }

  const p = baseProjectile(w, d.id, owner, e.id, mx, my, mz);
  p.delivery = d.delivery;
  p.damage = d.damage * (e.isUnit ? 1 + e.vet * 0.1 : 1);
  p.splash = d.splash ?? 0;
  p.pk = (d.pk ?? 1) * (c.has('aesa') && d.delivery === 'sam' ? 1.12 : 1);
  p.speed = d.speed;
  const range = dist(mx, mz, tx, tz);

  switch (d.delivery) {
    case 'shell': {
      // Lead the target, then fly straight. Dispersion grows with range.
      let ax = tx;
      let az = tz;
      if (target && target.isUnit) {
        const tof = range / d.speed;
        ax += target.vx * tof;
        az += target.vz * tof;
      }
      const spread = (d.spread ?? 0.02) * (range / d.range);
      const a = w.rng.next() * 6.283185307179586;
      const r = sqrt(w.rng.next()) * spread;
      p.tx = ax + sin(a) * r;
      p.tz = az + cos(a) * r;
      p.target = target ? target.id : 0;
      p.dur = dist(mx, mz, p.tx, p.tz) / d.speed;
      p.apex = ty;
      p.life = p.dur + 0.1;
      break;
    }
    case 'artillery':
    case 'rocket': {
      const precise = c.has('precision') ? 0.4 : 1;
      const spread = (d.spread ?? 0.3) * (range / d.range) * precise;
      const a = w.rng.next() * 6.283185307179586;
      const r = sqrt(w.rng.next()) * spread;
      p.tx = tx + sin(a) * r;
      p.tz = tz + cos(a) * r;
      p.dur = range / d.speed + 1.2;
      p.apex = Math.min(18, range * 0.22 + 0.3);
      p.life = p.dur + 1;
      p.threat = T_MUNITION;
      p.radarMul = 0.6;
      break;
    }
    default: {
      // Guided
      p.target = proj ? -proj.id : target ? target.id : 0;
      p.tx = tx;
      p.tz = tz;
      const dx = tx - mx;
      const dz = tz - mz;
      const l = sqrt(dx * dx + dz * dz) || 1;
      const launch = d.delivery === 'sam' ? 0.45 : 0.25;
      p.vx = (dx / l) * d.speed * launch;
      p.vz = (dz / l) * d.speed * launch;
      p.vy = d.delivery === 'sam' ? d.speed * 0.25 : 0;
      p.life = (d.range / d.speed) * 1.6 + 2;
      if (proj) proj.engaged++;
      if (d.delivery === 'asm' || d.delivery === 'agm') {
        p.threat = T_MUNITION;
        p.radarMul = 0.4;
      }
      break;
    }
  }
  w.projectiles.push(p);
}

/** Launch a strategic missile from a silo, TEL, frigate or submarine. */
export function launchStrike(w: World, launcher: Unit | Building, kind: StrikeKind, tx: number, tz: number): boolean {
  const s = STRIKES[kind];
  const c = w.countries[launcher.owner];
  const d = dist(launcher.x, launcher.z, tx, tz);
  if (d > s.range || d < 5) return false;
  if (c.funds < s.cost) {
    w.alert(launcher.owner, 'noFunds', 'bad');
    return false;
  }
  c.funds -= s.cost;
  c.stats.missilesFired++;
  const p = baseProjectile(w, kind, launcher.owner, launcher.id, launcher.x, 0.02, launcher.z);
  p.delivery = 'warhead';
  p.strike = kind;
  p.damage = s.damage;
  p.splash = s.splash;
  p.speed = s.speed;
  p.evasion = s.evasion;
  p.radarMul = s.radarMul;
  p.tx = tx;
  p.tz = tz;
  p.sx = launcher.x;
  p.sz = launcher.z;
  if (kind === 'cruise') {
    p.threat = T_MUNITION;
    const dx = tx - launcher.x;
    const dz = tz - launcher.z;
    p.vx = (dx / d) * s.speed;
    p.vz = (dz / d) * s.speed;
    p.life = d / s.speed + 10;
  } else {
    p.threat = T_BALLISTIC;
    p.dur = d / s.speed + (kind === 'ballistic' ? 8 : 3);
    p.apex = kind === 'ballistic' ? clamp(d * s.alt, 30, 450) : clamp(d * s.alt, 20, 60);
    p.life = p.dur + 2;
  }
  w.projectiles.push(p);
  w.events.push({ t: 'launch', id: p.id, kind, owner: launcher.owner, x: launcher.x, z: launcher.z, tx, tz });
  w.sound('launch', launcher.x, launcher.z);
  // Early-warning satellites: the target country and its allies are warned.
  const victim = w.ownerAt(tx, tz);
  for (const o of w.countries) if (o.controller === 'human' && (o.idx === victim || (victim > 0 && w.allied(o.idx, victim))) && o.idx !== launcher.owner) w.alert(o.idx, 'missileInbound', 'bad', tx, tz, kind);
  if (victim > 0 && victim !== launcher.owner) {
    w.dip.addTension(launcher.owner, victim, 15);
    if (!w.isEnemy(launcher.owner, victim)) w.countries[launcher.owner].reputation -= 10;
  }
  return true;
}

/** Position of an arc projectile `ahead` seconds in the future. */
function arcPos(p: Projectile, t: number, out: { x: number; y: number; z: number }) {
  const s = clamp(t / p.dur, 0, 1);
  out.x = p.sx + (p.tx - p.sx) * s;
  out.z = p.sz + (p.tz - p.sz) * s;
  out.y = p.apex * 4 * s * (1 - s);
  if (p.strike === 'hypersonic') {
    // Glide vehicle weaves laterally to defeat interceptors.
    const dx = p.tx - p.sx;
    const dz = p.tz - p.sz;
    const l = sqrt(dx * dx + dz * dz) || 1;
    const weave = sin(s * 18.84955592153876) * 12 * (1 - s) * s * 4;
    out.x += (-dz / l) * weave;
    out.z += (dx / l) * weave;
  }
  return out;
}

const tmp = { x: 0, y: 0, z: 0 };

export function updateProjectiles(w: World) {
  for (const p of w.projectiles) {
    if (!p.alive) continue;
    p.life -= DT;
    switch (p.delivery) {
      case 'shell':
        p.t += DT;
        stepLine(p);
        if (p.t >= p.dur) impactShell(w, p);
        break;
      case 'artillery':
      case 'rocket':
        p.t += DT;
        arcPos(p, p.t, tmp);
        p.x = tmp.x;
        p.y = tmp.y;
        p.z = tmp.z;
        if (p.t >= p.dur) impact(w, p, p.x, p.z, p.delivery === 'rocket' ? 1 : 0.9);
        break;
      case 'warhead':
        if (p.strike === 'cruise') stepCruise(w, p);
        else {
          p.t += DT;
          arcPos(p, p.t, tmp);
          p.x = tmp.x;
          p.y = tmp.y;
          p.z = tmp.z;
          if (p.t >= p.dur) impact(w, p, p.tx, p.tz, 3);
        }
        break;
      default:
        stepGuided(w, p);
    }
    if (p.alive && p.life <= 0) {
      p.alive = false;
      if (p.delivery !== 'sam') w.events.push({ t: 'boom', x: p.x, y: p.y, z: p.z, size: 0.3, kind: p.delivery });
      else w.events.push({ t: 'boom', x: p.x, y: p.y, z: p.z, size: 0.25, kind: 'intercept' });
    }
  }
}

function stepLine(p: Projectile) {
  const s = clamp(p.t / p.dur, 0, 1);
  p.x = p.sx + (p.tx - p.sx) * s;
  p.z = p.sz + (p.tz - p.sz) * s;
  p.y = 0.004 + (p.apex - 0.004) * s;
}

function impactShell(w: World, p: Projectile) {
  p.alive = false;
  const t = p.target ? w.get(p.target) : undefined;
  let hit = false;
  if (t) {
    const r = t.isUnit ? t.radius + 0.025 : t.half + 0.02;
    if (t.isUnit ? dist(t.x, t.z, p.tx, p.tz) <= r : Math.abs(t.x - p.tx) <= r && Math.abs(t.z - p.tz) <= r) {
      w.applyDamage(t, p.damage, 'shell', w.get(p.source) ?? null, p.owner);
      hit = true;
    }
  }
  if (p.splash > 0) w.splash(p.tx, p.tz, p.splash, p.damage * 0.6, 'shell', w.get(p.source) ?? null, p.owner);
  w.events.push({ t: 'boom', x: p.tx, y: p.apex, z: p.tz, size: hit ? 0.5 : 0.3, kind: 'shell' });
}

function impact(w: World, p: Projectile, x: number, z: number, size: number) {
  p.alive = false;
  const src = w.get(p.source) ?? null;
  const air = false;
  w.splash(x, z, Math.max(0.05, p.splash), p.damage, p.delivery === 'warhead' ? 'warhead' : p.delivery, src, p.owner, air);
  w.events.push({ t: 'boom', x, y: 0, z, size, kind: p.delivery });
  if (p.delivery === 'warhead') {
    const c = w.countries[p.owner];
    let hitSomething = false;
    for (const b of w.buildings) if (b.alive && b.lastHurt === w.time && b.owner !== p.owner) hitSomething = true;
    if (hitSomething) c.stats.missileHits++;
    // Strikes on cities are war crimes in the eyes of the world.
    for (const ci of w.cities)
      if (dist(ci.x, ci.z, x, z) < ci.radius) {
        c.reputation = Math.max(0, c.reputation - 6);
        w.countries[ci.owner].stability = Math.max(0, w.countries[ci.owner].stability - 3);
      }
  }
}

function stepCruise(w: World, p: Projectile) {
  const d = dist(p.x, p.z, p.tx, p.tz);
  if (d < p.speed * DT * 1.2) {
    p.x = p.tx;
    p.z = p.tz;
    impact(w, p, p.tx, p.tz, 2.2);
    return;
  }
  p.vx = ((p.tx - p.x) / d) * p.speed;
  p.vz = ((p.tz - p.z) / d) * p.speed;
  p.x += p.vx * DT;
  p.z += p.vz * DT;
  // Terrain-hugging cruise, pop-up in the last 3 km.
  const want = d < 3 ? 0.25 * (d / 3) : 0.05;
  p.y += (want - p.y) * Math.min(1, DT * 2);
}

function stepGuided(w: World, p: Projectile) {
  // Aim point (with lead) and target radius.
  let ax = p.tx;
  let ay = 0.003;
  let az = p.tz;
  let hitR = 0.04;
  let targetEnt: Entity | undefined;
  let targetProj: Projectile | undefined;
  if (p.target > 0) {
    targetEnt = w.get(p.target);
    if (targetEnt) {
      const range = sqrt((targetEnt.x - p.x) * (targetEnt.x - p.x) + (targetEnt.z - p.z) * (targetEnt.z - p.z));
      const tof = range / Math.max(0.1, p.speed);
      ax = targetEnt.x + (targetEnt.isUnit ? targetEnt.vx * tof * 0.8 : 0);
      az = targetEnt.z + (targetEnt.isUnit ? targetEnt.vz * tof * 0.8 : 0);
      ay = aimY(targetEnt);
      hitR = targetEnt.isUnit ? targetEnt.radius + 0.03 : targetEnt.half + 0.02;
      p.tx = targetEnt.x;
      p.tz = targetEnt.z;
    } else p.target = 0;
  } else if (p.target < 0) {
    targetProj = w.projectiles.find((q) => q.id === -p.target && q.alive);
    if (targetProj) {
      // Predict where the threat will be when we get there (two iterations).
      let tof = sqrt((targetProj.x - p.x) * (targetProj.x - p.x) + (targetProj.z - p.z) * (targetProj.z - p.z) + (targetProj.y - p.y) * (targetProj.y - p.y)) / p.speed;
      for (let k = 0; k < 2; k++) {
        predict(targetProj, tof, tmp);
        tof = sqrt((tmp.x - p.x) * (tmp.x - p.x) + (tmp.z - p.z) * (tmp.z - p.z) + (tmp.y - p.y) * (tmp.y - p.y)) / p.speed;
      }
      predict(targetProj, tof, tmp);
      ax = tmp.x;
      ay = tmp.y;
      az = tmp.z;
      hitR = 0.15 + targetProj.speed * DT;
    } else p.target = 0;
  }
  // Steering: rotate velocity toward the aim point with limited turn rate, accelerate.
  const dx = ax - p.x;
  const dy = ay - p.y;
  const dz = az - p.z;
  const dl = sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
  const turn = (GUIDED_TURN[p.delivery] ?? 2) * DT;
  let vl = sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz) || 1e-6;
  const k = clamp(turn, 0, 1);
  let nx = (p.vx / vl) * (1 - k) + (dx / dl) * k;
  let ny = (p.vy / vl) * (1 - k) + (dy / dl) * k;
  let nz = (p.vz / vl) * (1 - k) + (dz / dl) * k;
  const nl = sqrt(nx * nx + ny * ny + nz * nz) || 1e-6;
  nx /= nl;
  ny /= nl;
  nz /= nl;
  vl = Math.min(p.speed, vl + p.speed * 1.5 * DT);
  p.vx = nx * vl;
  p.vy = ny * vl;
  p.vz = nz * vl;
  // Ground-attack missiles fly a low lofted profile.
  if (p.delivery === 'atgm' || p.delivery === 'agm' || p.delivery === 'asm' || p.delivery === 'torpedo') {
    const loft = p.delivery === 'torpedo' ? 0 : Math.min(0.12, dl * 0.04);
    if (dl > 0.3) p.vy = (Math.max(ay, loft) - p.y) * 3;
  }
  p.x += p.vx * DT;
  p.y = Math.max(0, p.y + p.vy * DT);
  p.z += p.vz * DT;

  const dx2 = ax - p.x;
  const dy2 = ay - p.y;
  const dz2 = az - p.z;
  const d2 = sqrt(dx2 * dx2 + dy2 * dy2 + dz2 * dz2);
  if (d2 > hitR + vl * DT) {
    if (!targetEnt && !targetProj && p.target === 0 && dist(p.x, p.z, p.tx, p.tz) < 0.05 + vl * DT && p.delivery !== 'sam') {
      // Lost lock: detonate on the last known point.
      p.alive = false;
      w.splash(p.tx, p.tz, Math.max(0.04, p.splash), p.damage * 0.5, p.delivery, null, p.owner);
      w.events.push({ t: 'boom', x: p.tx, y: 0, z: p.tz, size: 0.4, kind: p.delivery });
    }
    return;
  }
  // Fuse
  p.alive = false;
  const src = w.get(p.source) ?? null;
  if (targetProj) {
    targetProj.engaged = Math.max(0, targetProj.engaged - 1);
    if (interceptRoll(w, p.pk, targetProj)) destroyThreat(w, targetProj, p.owner);
    else w.events.push({ t: 'boom', x: p.x, y: p.y, z: p.z, size: 0.3, kind: 'intercept' });
    return;
  }
  if (targetEnt) {
    if (p.delivery === 'sam' && w.rng.next() > p.pk) {
      w.events.push({ t: 'boom', x: p.x, y: p.y, z: p.z, size: 0.3, kind: 'intercept' });
      return;
    }
    // Active protection systems on armour (Trophy/Arena style).
    if ((p.delivery === 'atgm' || p.delivery === 'agm') && targetEnt.isUnit && (targetEnt.def.id === 'mbt' || targetEnt.def.id === 'ifv') && w.countries[targetEnt.owner].has('aps') && w.rng.next() < 0.35) {
      w.events.push({ t: 'boom', x: p.x, y: p.y, z: p.z, size: 0.25, kind: 'intercept' });
      return;
    }
    w.applyDamage(targetEnt, p.damage, p.delivery, src, p.owner);
  }
  if (p.splash > 0) w.splash(p.x, p.z, p.splash, p.damage * 0.5, p.delivery, src, p.owner);
  w.events.push({ t: 'boom', x: p.x, y: p.y, z: p.z, size: p.delivery === 'bomb' ? 1.3 : p.delivery === 'sam' ? 0.5 : 0.7, kind: p.delivery });
}

function predict(q: Projectile, ahead: number, out: { x: number; y: number; z: number }) {
  if (q.delivery === 'artillery' || q.delivery === 'rocket' || (q.delivery === 'warhead' && q.strike !== 'cruise')) return arcPos(q, q.t + ahead, out);
  out.x = q.x + q.vx * ahead;
  out.y = q.y + q.vy * ahead;
  out.z = q.z + q.vz * ahead;
  return out;
}

function destroyThreat(w: World, p: Projectile, by: number) {
  if (!p.alive) return;
  p.alive = false;
  w.countries[by].stats.intercepts++;
  w.events.push({ t: 'intercept', x: p.x, y: p.y, z: p.z, owner: by });
  w.events.push({ t: 'boom', x: p.x, y: p.y, z: p.z, size: p.delivery === 'warhead' ? 1.6 : 0.5, kind: 'intercept' });
  if (p.delivery === 'warhead') {
    w.alert(by, 'intercepted', 'good', p.x, p.z);
    // Debris still falls near the intercept point.
    if (p.y < 1) w.splash(p.x, p.z, 0.15, p.damage * 0.05, 'warhead', null, p.owner);
  }
}
