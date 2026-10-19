/**
 * Movement physics.
 *
 * Ground & naval: kinematic vehicles with acceleration, braking, turn rate and
 * terrain/road speed; tracked vehicles slow in turns; mass-weighted circle collision
 * with "shoving" (moving units push idle ones); buildings are solid boxes; impassable
 * cells make units slide along them.
 * Air: helicopters/FPV hover; jets and fixed-wing drones keep minimum airspeed, bank
 * into turns and orbit when idle; aircraft burn fuel and return to base to rearm.
 */
import type { World } from '../world';
import type { Building, Unit } from '../entities';
import type { PathRequest } from '../path';
import { DT } from '../defs';
import { angleDiff, atan2, clamp, cos, dist, dist2, headingTo, sin, sqrt, turnToward } from '../dmath';

interface PathJob {
  req: PathRequest;
  units: number[];
}

interface MoveState {
  jobs: PathJob[];
  bGrid: Map<number, Building[]>;
  bCount: number;
  bTick: number;
}

const states = new WeakMap<World, MoveState>();
function st(w: World): MoveState {
  let s = states.get(w);
  if (!s) {
    s = { jobs: [], bGrid: new Map(), bCount: -1, bTick: -1 };
    states.set(w, s);
  }
  return s;
}

const BCELL = 4;

function rebuildBuildingGrid(w: World, s: MoveState) {
  if (s.bCount === w.buildings.length && w.tick - s.bTick < 40) return;
  s.bGrid.clear();
  for (const b of w.buildings) {
    if (!b.alive) continue;
    const x0 = Math.floor((b.x - b.half) / BCELL);
    const x1 = Math.floor((b.x + b.half) / BCELL);
    const z0 = Math.floor((b.z - b.half) / BCELL);
    const z1 = Math.floor((b.z + b.half) / BCELL);
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const k = z * 4096 + x;
        let arr = s.bGrid.get(k);
        if (!arr) s.bGrid.set(k, (arr = []));
        arr.push(b);
      }
  }
  s.bCount = w.buildings.length;
  s.bTick = w.tick;
}

// ---------------------------------------------------------------------------
// Orders

/** Order a group to move (or attack-move) with a formation at the destination. */
export function moveUnits(w: World, units: Unit[], x: number, z: number, attack = false, queue = false) {
  if (!units.length) return;
  x = clamp(x, 0.5, w.theater.worldW - 0.5);
  z = clamp(z, 0.5, w.theater.worldH - 0.5);
  if (queue) {
    for (const u of units) {
      if (u.order === 'move' || u.order === 'attackMove') u.queue.push(x, z, attack ? 1 : 0);
      else moveUnits(w, [u], x, z, attack);
    }
    return;
  }
  // Formation: rows perpendicular to the direction of travel.
  let cx = 0;
  let cz = 0;
  for (const u of units) {
    cx += u.x;
    cz += u.z;
  }
  cx /= units.length;
  cz /= units.length;
  const a = headingTo(cx, cz, x, z);
  const sorted = [...units].sort((p, q) => q.def.radius - p.def.radius || p.id - q.id);
  const n = sorted.length;
  const cols = Math.max(1, Math.ceil(sqrt(n * 1.6)));
  let spacing = 0;
  for (const u of units) spacing = Math.max(spacing, u.radius);
  spacing = spacing * 3 + 0.08;
  const sa = sin(a);
  const ca = cos(a);
  sorted.forEach((u, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const lat = (col - (Math.min(cols, n - row * cols) - 1) / 2) * spacing;
    const back = -row * spacing;
    // local (lat → right of heading, back → behind)
    u.fx = ca * lat + sa * back;
    u.fz = -sa * lat + ca * back;
    if (u.isAir) {
      // Aircraft spread wider and don't form up.
      u.fx *= 2;
      u.fz *= 2;
    }
  });
  const land: Unit[] = [];
  const sea: Unit[] = [];
  for (const u of sorted) {
    u.order = attack ? 'attackMove' : 'move';
    u.target = 0;
    u.task = -1;
    u.gx = x;
    u.gz = z;
    u.hold = false;
    u.queue.length = 0;
    u.stuck = 0;
    for (const ws of u.weapons) ws.salvoLeft = 0;
    if (u.deployed) undeploy(u);
    if (u.isAir) {
      u.path = [x + u.fx, z + u.fz];
      u.pathIdx = 0;
      u.ox = x + u.fx;
      u.oz = z + u.fz;
      u.pathPending = false;
    } else if (u.isNaval) sea.push(u);
    else land.push(u);
  }
  requestGroupPath(w, land, x, z, false);
  requestGroupPath(w, sea, x, z, true);
}

/** Single unit path to a point (chasing, building, capturing). Keeps the current order. */
export function goTo(w: World, u: Unit, x: number, z: number) {
  u.gx = x;
  u.gz = z;
  u.fx = 0;
  u.fz = 0;
  if (u.isAir) {
    u.path = [x, z];
    u.pathIdx = 0;
    u.pathPending = false;
    return;
  }
  if (u.pathPending) {
    // Retarget the in-flight request instead of queueing another.
    const job = st(w).jobs.find((j) => j.units.includes(u.id) && j.units.length === 1);
    if (job) {
      job.req.gx = x;
      job.req.gz = z;
      return;
    }
  }
  requestGroupPath(w, [u], x, z, u.isNaval);
}

function requestGroupPath(w: World, units: Unit[], x: number, z: number, naval: boolean) {
  if (!units.length) return;
  // Start from the unit closest to the group's centre.
  let cx = 0;
  let cz = 0;
  for (const u of units) {
    cx += u.x;
    cz += u.z;
  }
  cx /= units.length;
  cz /= units.length;
  let lead = units[0];
  let bd = Infinity;
  for (const u of units) {
    const d = dist2(u.x, u.z, cx, cz);
    if (d < bd) {
      bd = d;
      lead = u;
    }
  }
  const pf = naval ? w.seaPaths : w.landPaths;
  const req = pf.request(lead.x, lead.z, x, z);
  for (const u of units) {
    u.pathPending = true;
    u.pathReq = req.id;
  }
  st(w).jobs.push({ req, units: units.map((u) => u.id) });
}

export function stopUnits(units: Unit[]) {
  for (const u of units) {
    u.order = 'idle';
    u.target = 0;
    u.task = -1;
    u.path = [];
    u.pathIdx = 0;
    u.pathPending = false;
    u.queue.length = 0;
    for (const ws of u.weapons) ws.salvoLeft = 0;
  }
}

export function undeploy(u: Unit) {
  if (!u.deployed) return;
  u.deployed = false;
  u.deployT = u.def.deploy ?? 0;
}

// ---------------------------------------------------------------------------

export function updateMovement(w: World) {
  const s = st(w);
  // Deliver finished paths.
  if (s.jobs.length) {
    const remaining: PathJob[] = [];
    for (const job of s.jobs) {
      if (!job.req.done) {
        remaining.push(job);
        continue;
      }
      for (const id of job.units) {
        const e = w.get(id);
        if (!e || !e.isUnit || e.pathReq !== job.req.id) continue;
        e.pathPending = false;
        const p = job.req.result.slice();
        if (p.length >= 2) {
          const lx = p[p.length - 2] + e.fx;
          const lz = p[p.length - 1] + e.fz;
          const grid = e.isNaval ? w.sea : w.land;
          if (grid.passable(lx, lz)) {
            p[p.length - 2] = lx;
            p[p.length - 1] = lz;
          }
        }
        e.path = p;
        e.pathIdx = 0;
        e.stuck = 0;
      }
    }
    s.jobs = remaining;
  }
  rebuildBuildingGrid(w, s);
  for (const u of w.units) {
    if (!u.alive) continue;
    if (u.isAir) moveAir(w, u);
    else moveSurface(w, u, s);
  }
}

/** Current waypoint, or null. Advances past reached waypoints. */
function waypoint(u: Unit, passR: number): { x: number; z: number; last: boolean; d: number } | null {
  while (u.pathIdx * 2 < u.path.length) {
    const i = u.pathIdx * 2;
    const x = u.path[i];
    const z = u.path[i + 1];
    const last = i + 2 >= u.path.length;
    const d = dist(u.x, u.z, x, z);
    if (!last && d < passR) {
      u.pathIdx++;
      continue;
    }
    return { x, z, last, d };
  }
  return null;
}

function finishPath(w: World, u: Unit) {
  u.path = [];
  u.pathIdx = 0;
  if (u.queue.length >= 3) {
    const [x, z, atk] = u.queue.splice(0, 3);
    const q = u.queue.slice();
    moveUnits(w, [u], x, z, atk === 1);
    u.queue = q;
    return;
  }
  if (u.order === 'move' || u.order === 'attackMove') u.order = 'idle';
}

function moveSurface(w: World, u: Unit, s: MoveState) {
  const def = u.def;
  if (u.deployT > 0) u.deployT -= DT;
  const disabled = u.emp > 0 || u.deployed || u.deployT > 0;
  if (u.emp > 0) u.emp -= DT;
  const grid = u.isNaval ? w.sea : w.land;
  let desiredSpeed = 0;
  let desiredHeading = u.heading;
  const wp = disabled ? null : waypoint(u, Math.max(1.2, def.speed * 2));
  if ((w.tick + u.id) % 20 === 0) u.convoy = !!wp && wantsConvoy(w, u);
  if (wp) {
    const terrain = u.isNaval ? 1 : Math.max(0.25, w.theater.speedAt(u.x, u.z));
    desiredSpeed = def.speed * terrain;
    if (u.convoy) desiredSpeed = Math.max(def.speed * 3, u.isNaval ? 3 : 2.4) * (u.isNaval ? 1 : Math.max(0.6, terrain));
    if (wp.last) {
      const arrive = def.radius + 0.03;
      if (wp.d < arrive) {
        finishPath(w, u);
        desiredSpeed = 0;
      } else desiredSpeed = Math.min(desiredSpeed, wp.d * 1.2 + 0.02);
    }
    desiredHeading = headingTo(u.x, u.z, wp.x, wp.z);
  } else if (!u.pathPending && u.path.length === 0 && (u.order === 'move' || u.order === 'attackMove') && !disabled) {
    finishPath(w, u);
  }

  // Steering
  const turn = def.turn * (u.isNaval ? 1 : 1);
  if (desiredSpeed > 0) u.heading = turnToward(u.heading, desiredHeading, turn * DT);
  const err = angleDiff(u.heading, desiredHeading);
  const align = cos(err);
  if (def.category !== 'infantry' && desiredSpeed > 0) {
    // Vehicles slow down to turn; ships can't brake hard.
    desiredSpeed *= align > 0 ? 0.2 + 0.8 * align * align : 0.12;
  }
  const accel = desiredSpeed > u.speed ? def.accel : def.accel * (u.isNaval ? 1.2 : 2.5);
  u.speed += clamp(desiredSpeed - u.speed, -accel * DT, accel * DT);
  if (u.speed < 0) u.speed = 0;
  u.vx = sin(u.heading) * u.speed;
  u.vz = cos(u.heading) * u.speed;
  let nx = u.x + u.vx * DT;
  let nz = u.z + u.vz * DT;

  // Unit-unit collision (mass-weighted, moving units shove idle ones).
  w.hash.query(nx, nz, u.radius + 0.35, w.near);
  let pushX = 0;
  let pushZ = 0;
  const myMass = u.radius * u.radius;
  const moving = u.speed > 0.01;
  for (const o of w.near) {
    if (o === u || !o.alive || o.isAir || o.isNaval !== u.isNaval) continue;
    const dx = nx - o.x;
    const dz = nz - o.z;
    const min = u.radius + o.radius;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) continue;
    let d = sqrt(d2);
    let ux: number;
    let uz: number;
    if (d < 1e-6) {
      // Perfectly overlapping: split deterministically by id.
      const a = (u.id * 2.399963) % 6.283185307179586;
      ux = sin(a);
      uz = cos(a);
      d = 0;
    } else {
      ux = dx / d;
      uz = dz / d;
    }
    const overlap = min - d;
    const oMass = o.radius * o.radius;
    let share = oMass / (myMass + oMass);
    const oMoving = o.speed > 0.01;
    if (moving && !oMoving) share *= 0.35;
    else if (!moving && oMoving) share = Math.min(1, share * 1.8);
    pushX += ux * overlap * share;
    pushZ += uz * overlap * share;
  }
  const pl = sqrt(pushX * pushX + pushZ * pushZ);
  const maxPush = 0.6 * DT + u.radius * 0.5;
  if (pl > maxPush) {
    pushX *= maxPush / pl;
    pushZ *= maxPush / pl;
  }
  nx += pushX;
  nz += pushZ;

  // Buildings are solid.
  if (!u.isNaval) {
    const key = Math.floor(nz / BCELL) * 4096 + Math.floor(nx / BCELL);
    const arr = s.bGrid.get(key);
    if (arr)
      for (const b of arr) {
        if (!b.alive) continue;
        const h = b.half + u.radius;
        const dx = nx - b.x;
        const dz = nz - b.z;
        if (dx > -h && dx < h && dz > -h && dz < h) {
          // Builders may stand at the edge of their site; everyone exits via the shortest axis.
          const px = h - Math.abs(dx);
          const pz = h - Math.abs(dz);
          if (px < pz) nx = b.x + (dx >= 0 ? h : -h);
          else nz = b.z + (dz >= 0 ? h : -h);
        }
      }
  }

  // Terrain: slide along impassable cells.
  if (grid.passable(nx, nz)) {
    u.x = nx;
    u.z = nz;
    if (u.stuck > 0) u.stuck -= DT * 0.5;
  } else if (grid.passable(nx, u.z)) {
    u.x = nx;
    u.stuck += DT * 0.5;
  } else if (grid.passable(u.x, nz)) {
    u.z = nz;
    u.stuck += DT * 0.5;
  } else {
    u.speed *= 0.5;
    u.stuck += DT;
  }
  if (!grid.passable(u.x, u.z)) {
    // Shoved onto bad ground: snap back.
    const c = grid.nearest(grid.cellAt(u.x, u.z), -1, 4);
    if (c >= 0) {
      u.x = ((c % grid.w) + 0.5) * grid.cell;
      u.z = (Math.floor(c / grid.w) + 0.5) * grid.cell;
    }
  }
  if (u.stuck > 2.5 && u.path.length) {
    u.stuck = 0;
    const gx = u.path[u.path.length - 2];
    const gz = u.path[u.path.length - 1];
    goTo(w, u, gx, gz);
  }
  clampWorld(w, u);
}

/**
 * Strategic road march: units on long moves travel as a convoy (≈3× speed, weapons
 * stowed) until they are near the destination or enemy contact.
 */
function wantsConvoy(w: World, u: Unit): boolean {
  if (u.order === 'build' || u.order === 'repair') return remaining(u) > 25;
  if (u.order !== 'move' && u.order !== 'attackMove' && u.order !== 'guard' && u.order !== 'attack') return false;
  if (remaining(u) < 25) return false;
  w.hash.query(u.x, u.z, 12, w.near);
  for (const o of w.near) if (o.alive && w.isEnemy(u.owner, o.owner) && dist2(o.x, o.z, u.x, u.z) < 144 && w.detects(u.owner, o)) return false;
  return true;
}

function remaining(u: Unit) {
  let d = 0;
  let x = u.x;
  let z = u.z;
  for (let i = u.pathIdx * 2; i + 1 < u.path.length; i += 2) {
    d += dist(x, z, u.path[i], u.path[i + 1]);
    x = u.path[i];
    z = u.path[i + 1];
    if (d > 30) return d;
  }
  return d;
}

function clampWorld(w: World, u: Unit) {
  u.x = clamp(u.x, 0.2, w.theater.worldW - 0.2);
  u.z = clamp(u.z, 0.2, w.theater.worldH - 0.2);
}

// ---------------------------------------------------------------------------
// Air

function moveAir(w: World, u: Unit) {
  const def = u.def;
  const flight = def.flight!;
  if (u.order === 'docked') {
    dockedUpdate(w, u);
    return;
  }
  if (u.emp > 0) {
    // EMP: electronics fried, aircraft fall.
    u.emp -= DT;
    u.y -= DT * 0.4;
    if (u.y <= 0) w.kill(u, null, 0);
    return;
  }
  // Fuel / endurance
  if (u.fuel !== Infinity) {
    u.fuel -= DT;
    if (u.fuel <= 0) {
      w.events.push({ t: 'boom', x: u.x, y: 0, z: u.z, size: 0.6, kind: 'crash' });
      w.kill(u, null, 0);
      return;
    }
    if (u.order !== 'rtb' && def.kamikaze === undefined) {
      const home = homeBase(w, u);
      if (home) {
        const need = dist(u.x, u.z, home.x, home.z) / def.speed + 12;
        if (u.fuel < need) returnToBase(w, u, home);
      }
    }
  }
  if (u.jammed > 0) u.jammed -= DT;

  let tx = NaN;
  let tz = NaN;
  let last = true;
  const wp = waypoint(u, flight === 'jet' ? 2 : 0.6);
  if (wp) {
    tx = wp.x;
    tz = wp.z;
    last = wp.last;
  }
  if (u.order === 'rtb') {
    const home = w.get(u.home);
    if (!home) {
      const nb = homeBase(w, u);
      if (nb) returnToBase(w, u, nb);
      else u.order = 'idle';
    } else {
      tx = home.x;
      tz = home.z;
      if (dist(u.x, u.z, tx, tz) < Math.max(0.4, def.speed * 0.15)) {
        u.order = 'docked';
        u.x = home.x + ((u.id % 5) - 2) * 0.12;
        u.z = home.z + ((Math.floor(u.id / 5) % 3) - 1) * 0.15;
        u.speed = 0;
        u.y = 0;
        u.path = [];
        u.deployT = 6;
        return;
      }
    }
  }
  // Jammed drones drift and lose their link.
  if (u.jammed > 0 && def.category === 'drone') {
    tx = NaN;
    u.heading += (((u.id * 7919 + w.tick) % 11) - 5) * 0.004;
  }

  const hasTarget = tx === tx;
  const fixedWing = flight === 'jet' || flight === 'drone' || flight === 'loiter';
  if (fixedWing) {
    // Fixed wing: minimum airspeed, orbit when there is nowhere to go.
    if (!hasTarget) {
      const r = Math.max(0.6, def.speed / def.turn);
      const da = dist(u.x, u.z, u.ox, u.oz);
      // Aim at a point ahead on the orbit circle.
      const ang = atan2(u.x - u.ox, u.z - u.oz) + (da > r * 0.5 ? 0.6 : 1.2);
      tx = u.ox + sin(ang) * r;
      tz = u.oz + cos(ang) * r;
    }
    const desired = headingTo(u.x, u.z, tx, tz);
    const prev = u.heading;
    u.heading = turnToward(u.heading, desired, def.turn * DT);
    u.bank = clamp((angleDiff(prev, u.heading) / DT / def.turn) * 0.9, -1.1, 1.1);
    const minV = def.speed * (flight === 'loiter' ? 0.8 : 0.55);
    const want = hasTarget ? def.speed : def.speed * 0.7;
    u.speed += clamp(Math.max(minV, want) - u.speed, -def.accel * DT, def.accel * DT);
    if (hasTarget && last && u.order === 'move' && dist(u.x, u.z, tx, tz) < Math.max(0.8, def.speed * 0.4)) {
      u.ox = tx;
      u.oz = tz;
      u.path = [];
      u.order = 'idle';
    }
  } else {
    // Rotary wing / quadcopter: can hover.
    let want = 0;
    if (hasTarget) {
      const d = dist(u.x, u.z, tx, tz);
      want = Math.min(def.speed, d * 1.2);
      if (last && d < 0.05) {
        u.path = [];
        if (u.order === 'move' || u.order === 'attackMove') finishPath(w, u);
      }
      if (d > 0.01) u.heading = turnToward(u.heading, headingTo(u.x, u.z, tx, tz), def.turn * DT);
    }
    const err = hasTarget ? cos(angleDiff(u.heading, headingTo(u.x, u.z, tx, tz))) : 1;
    want *= clamp(err, 0.2, 1);
    u.speed += clamp(want - u.speed, -def.accel * 1.5 * DT, def.accel * DT);
    u.bank = clamp((want - u.speed) * -0.3, -0.35, 0.35);
  }
  u.vx = sin(u.heading) * u.speed;
  u.vz = cos(u.heading) * u.speed;
  u.x += u.vx * DT;
  u.z += u.vz * DT;
  // Light separation between aircraft so swarms don't merge into one sprite.
  if (flight === 'heli' || flight === 'fpv') {
    w.hash.query(u.x, u.z, u.radius * 3, w.near);
    for (const o of w.near) {
      if (o === u || !o.isAir || o.order === 'docked') continue;
      const dx = u.x - o.x;
      const dz = u.z - o.z;
      const min = (u.radius + o.radius) * 1.3;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-8) {
        const d = sqrt(d2);
        u.x += (dx / d) * (min - d) * 0.3;
        u.z += (dz / d) * (min - d) * 0.3;
      }
    }
  }
  // Altitude
  const cruise = def.alt ?? 1;
  const targetY = u.order === 'rtb' && dist(u.x, u.z, tx, tz) < 3 ? 0.05 : cruise;
  const climb = flight === 'jet' ? 2 : 0.5;
  u.y += clamp(targetY - u.y, -climb * DT, climb * DT);
  clampWorld(w, u);
}

function dockedUpdate(w: World, u: Unit) {
  const home = w.get(u.home);
  if (!home) {
    u.order = 'idle';
    return;
  }
  u.speed = 0;
  u.y = 0;
  // Rearm and refuel while parked.
  if (u.deployT > 0) {
    u.deployT -= DT;
    if (u.deployT <= 0) {
      u.fuel = u.def.endurance ?? Infinity;
      for (const ws of u.weapons) ws.ammo = ws.def.ammo ?? Infinity;
      if (u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.25);
    }
  }
}

export function homeBase(w: World, u: Unit): Building | null {
  const cur = w.get(u.home);
  if (cur && !cur.isUnit && cur.built) return cur;
  let best: Building | null = null;
  let bd = Infinity;
  const kinds = u.def.category === 'drone' ? ['dronefac', 'airbase'] : ['airbase'];
  for (const b of w.buildings) {
    if (!b.alive || !b.built || b.owner !== u.owner || !kinds.includes(b.def.id)) continue;
    const d = dist2(b.x, b.z, u.x, u.z);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  if (best) u.home = best.id;
  return best;
}

export function returnToBase(w: World, u: Unit, home?: Building | null) {
  const h = home ?? homeBase(w, u);
  if (!h) return false;
  u.home = h.id;
  u.order = 'rtb';
  u.target = 0;
  u.path = [];
  return true;
}

/** Launch a docked aircraft (any order clears docking). */
export function undock(u: Unit) {
  if (u.order === 'docked') {
    u.order = 'idle';
    u.y = 0.05;
    u.speed = u.def.flight === 'jet' ? u.def.speed * 0.5 : 0;
  }
}
