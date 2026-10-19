/**
 * Cities: garrisons defend, attackers suppress them, infantry captures, territory flips.
 * Each land cell belongs to its nearest city of the same country (theater.region), so
 * capturing a city moves the border on the map.
 */
import type { World } from '../world';
import type { Unit } from '../entities';
import { DT, ECON } from '../defs';
import { dist2, sqrt } from '../dmath';

export function updateTerritory(w: World) {
  const second = w.tick % 20 === 0;
  for (const c of w.cities) {
    c.shelled += DT;
    w.hash.query(c.x, c.z, c.radius, w.near);
    let defenders = 0;
    const attackers: Unit[] = [];
    const capturePower = new Map<number, number>();
    const r2 = c.radius * c.radius;
    for (const u of w.near) {
      if (!u.alive || u.isAir || u.isNaval || dist2(u.x, u.z, c.x, c.z) > r2) continue;
      if (u.owner === c.owner || w.allied(u.owner, c.owner)) defenders++;
      else if (w.isEnemy(u.owner, c.owner)) {
        attackers.push(u);
        if (u.def.capture) capturePower.set(u.owner, (capturePower.get(u.owner) ?? 0) + u.def.capture);
      }
    }
    if (attackers.length) {
      // Attackers suppress the garrison.
      let dps = 0;
      for (const a of attackers) for (const ws of a.weapons) dps += 0.6 + (ws.def.damage / ws.def.cooldown) * 0.02;
      c.garrison = Math.max(0, c.garrison - dps * DT);
      // Militia fire back once a second.
      if (second && c.garrison > 0) {
        const t = attackers[w.rng.int(attackers.length)];
        const dmg = 10 + 30 * (c.garrison / c.maxGarrison);
        w.events.push({ t: 'fire', id: 0, w: 'militia', x: c.x, y: 0.01, z: c.z, tx: t.x, ty: 0.004, tz: t.z, owner: c.owner });
        w.applyDamage(t, dmg, 'bullet', null, c.owner);
      }
    } else if (c.garrison < c.maxGarrison) {
      c.garrison = Math.min(c.maxGarrison, c.garrison + c.maxGarrison * 0.015 * DT);
    }

    // Capture
    if (c.garrison <= c.maxGarrison * 0.05 && capturePower.size && defenders === 0) {
      let by = 0;
      let best = 0;
      for (const [owner, p] of capturePower) if (p > best || (p === best && owner < by)) (best = p), (by = owner);
      if (c.captureBy !== by) {
        c.captureBy = by;
        c.capture = 0;
      }
      c.capture += (best * DT) / (ECON.captureBase * (1 + sqrt(c.pop / 1e6) * 0.4));
      if (c.capture >= 1) captureCity(w, c.idx, by);
    } else if (!capturePower.size && c.capture > 0) {
      c.capture = Math.max(0, c.capture - DT * 0.05);
      if (c.capture === 0) c.captureBy = 0;
    }
  }
}

export function captureCity(w: World, idx: number, by: number) {
  const c = w.cities[idx];
  const prev = c.owner;
  c.owner = by;
  c.capture = 0;
  c.captureBy = 0;
  c.garrison = c.maxGarrison * 0.3;
  const winner = w.countries[by];
  const loser = w.countries[prev];
  winner.stats.citiesCaptured++;
  winner.xp += 150 + sqrt(c.pop / 1e6) * 120;
  if (c.origin === by) winner.stability = Math.min(100, winner.stability + (c.capital ? 20 : 5));
  else winner.reputation = Math.max(0, winner.reputation - (c.capital ? 6 : 2));
  if (prev > 0) loser.stability = Math.max(0, loser.stability - (c.capital ? 25 : 5));
  w.events.push({ t: 'captured', city: idx, owner: by, prev });
  w.alert(by, 'cityCaptured', 'good', c.x, c.z, String(idx));
  w.alert(prev, 'cityLost', 'bad', c.x, c.z, String(idx));
  w.sound('capture', c.x, c.z);
  for (const co of [winner, loser]) if (co.idx > 0) w.recount(co);
  // A minor power that has lost every city is annexed.
  if (prev > 0 && !loser.major && loser.alive && !w.cities.some((ci) => ci.owner === prev)) {
    loser.alive = false;
    w.events.push({ t: 'eliminated', country: prev });
  }
}
