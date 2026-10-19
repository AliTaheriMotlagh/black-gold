/**
 * Player commands. Everything a player (or AI) can do goes through here, so the same
 * code path runs for local play, AI and lockstep multiplayer. `c` is the issuing
 * country and is stamped by the session (never trusted from the wire).
 */
import type { World } from './world';
import type { Building, Unit } from './entities';
import type { ProposalKind } from './country';
import { BUILDINGS, RESEARCH, STRIKES, TIER_UPGRADE, UNITS, type StrikeKind } from './defs';
import { dist } from './dmath';
import { goTo, moveUnits, returnToBase, stopUnits, undeploy, undock } from './systems/movement';
import { edgePoint } from './systems/production';
import { launchStrike } from './systems/projectiles';
import { breakTreaty, declareWar, propose, respond, setSanction } from './systems/diplomacy';
import { unlockPower, usePower } from './systems/powers';
import { sellOil } from './systems/economy';
import { AIController } from './ai/ai';

export type Command =
  | { k: 'move'; c: number; ids: number[]; x: number; z: number; atk?: boolean; q?: boolean }
  | { k: 'attack'; c: number; ids: number[]; target: number }
  | { k: 'stop'; c: number; ids: number[] }
  | { k: 'hold'; c: number; ids: number[] }
  | { k: 'deploy'; c: number; ids: number[] }
  | { k: 'rtb'; c: number; ids: number[] }
  | { k: 'build'; c: number; kind: string; x: number; z: number; ids?: number[] }
  | { k: 'assist'; c: number; ids: number[]; target: number }
  | { k: 'repair'; c: number; ids: number[]; target: number }
  | { k: 'capture'; c: number; ids: number[]; city: number }
  | { k: 'train'; c: number; kind: string; n?: number; at?: number }
  | { k: 'cancel'; c: number; kind: string; at?: number }
  | { k: 'rally'; c: number; id: number; x: number; z: number }
  | { k: 'sell'; c: number; id: number }
  | { k: 'research'; c: number; id: string }
  | { k: 'tier'; c: number }
  | { k: 'strike'; c: number; id: number; kind: StrikeKind; x: number; z: number }
  | { k: 'kamikaze'; c: number; ids: number[]; x: number; z: number }
  | { k: 'power'; c: number; id: string; x: number; z: number; target?: number }
  | { k: 'unlock'; c: number; id: string }
  | { k: 'sellOil'; c: number; frac: number }
  | { k: 'autoSell'; c: number; on: boolean }
  | { k: 'war'; c: number; target: number }
  | { k: 'propose'; c: number; target: number; kind: ProposalKind }
  | { k: 'respond'; c: number; id: number; accept: boolean }
  | { k: 'break'; c: number; target: number }
  | { k: 'sanction'; c: number; target: number; on: boolean }
  | { k: 'handover'; c: number; to: 'ai' }
  | { k: 'surrender'; c: number };

/** A command without the issuer (filled in by the session or AI). */
export type CommandBody = Command extends infer C ? (C extends Command ? Omit<C, 'c'> : never) : never;

function ownUnits(w: World, c: number, ids: number[]): Unit[] {
  const out: Unit[] = [];
  for (const id of ids) {
    const e = w.get(id);
    if (e && e.isUnit && e.owner === c) out.push(e);
  }
  return out;
}

function fail(w: World, c: number, key: Parameters<World['alert']>[1]) {
  w.alert(c, key, 'bad');
  w.events.push({ t: 'sound', s: 'error', x: -1, z: -1 });
  return false;
}

export function applyCommand(w: World, cmd: Command): boolean {
  const c = cmd.c;
  const country = w.countries[c];
  if (!country || !country.alive) return false;
  switch (cmd.k) {
    case 'move': {
      const us = ownUnits(w, c, cmd.ids);
      for (const u of us) undock(u);
      moveUnits(w, us, cmd.x, cmd.z, !!cmd.atk, !!cmd.q);
      return true;
    }
    case 'attack': {
      const t = w.get(cmd.target);
      if (!t) return false;
      if (!w.isEnemy(c, t.owner)) return false;
      for (const u of ownUnits(w, c, cmd.ids)) {
        undock(u);
        if (u.deployed && !u.def.weapons.some((wd) => dist(u.x, u.z, t.x, t.z) <= wd.range)) undeploy(u);
        u.target = t.id;
        u.task = -1;
        u.hold = false;
        u.queue.length = 0;
        if (u.isAir) {
          u.path = [t.x, t.z];
          u.pathIdx = 0;
        } else goTo(w, u, t.x, t.z);
        u.order = 'attack';
      }
      return true;
    }
    case 'stop':
      stopUnits(ownUnits(w, c, cmd.ids));
      return true;
    case 'hold':
      for (const u of ownUnits(w, c, cmd.ids)) {
        stopUnits([u]);
        u.hold = true;
      }
      return true;
    case 'deploy':
      for (const u of ownUnits(w, c, cmd.ids)) {
        if (!u.def.deploy) continue;
        if (u.deployed) undeploy(u);
        else {
          stopUnits([u]);
          u.speed = 0;
          u.deployed = true;
          u.deployT = u.def.deploy;
        }
      }
      return true;
    case 'rtb':
      for (const u of ownUnits(w, c, cmd.ids)) if (u.isAir) returnToBase(w, u);
      return true;
    case 'build':
      return build(w, c, cmd.kind, cmd.x, cmd.z, cmd.ids);
    case 'assist': {
      const b = w.get(cmd.target);
      if (!b || b.isUnit || b.owner !== c || b.built) return false;
      for (const u of ownUnits(w, c, cmd.ids)) {
        if (!u.def.builder) continue;
        u.order = 'build';
        u.task = b.id;
        const p = edgePoint(u, b);
        goTo(w, u, p.x, p.z);
        u.order = 'build';
      }
      return true;
    }
    case 'repair': {
      const t = w.get(cmd.target);
      if (!t || !w.allied(c, t.owner)) return false;
      for (const u of ownUnits(w, c, cmd.ids)) {
        if (!u.def.repair) continue;
        u.order = 'repair';
        u.task = t.id;
        u.path = [];
      }
      return true;
    }
    case 'capture': {
      const city = w.cities[cmd.city];
      if (!city) return false;
      const us = ownUnits(w, c, cmd.ids);
      moveUnits(w, us, city.x, city.z, true);
      return true;
    }
    case 'train':
      return train(w, c, cmd.kind, cmd.n ?? 1, cmd.at);
    case 'cancel': {
      const def = UNITS[cmd.kind];
      if (!def) return false;
      let best: Building | null = null;
      for (const b of w.buildings)
        if (b.alive && b.owner === c && (cmd.at === undefined || b.id === cmd.at) && b.queue.includes(cmd.kind) && (!best || b.queue.length > best.queue.length)) best = b;
      if (!best) return false;
      const idx = best.queue.lastIndexOf(cmd.kind);
      best.queue.splice(idx, 1);
      if (idx === 0) best.prodTime = 0;
      country.funds += def.cost;
      country.oil += def.oil;
      country.supply -= def.supply;
      return true;
    }
    case 'rally': {
      const b = w.get(cmd.id);
      if (!b || b.isUnit || b.owner !== c) return false;
      b.rallyX = cmd.x;
      b.rallyZ = cmd.z;
      return true;
    }
    case 'sell': {
      const b = w.get(cmd.id);
      if (!b || b.isUnit || b.owner !== c || b.def.id === 'hq') return false;
      country.funds += b.def.cost * 0.5 * (b.built ? b.hp / b.maxHp : b.progress);
      b.hp = 0;
      w.kill(b, null, 0);
      w.sound('cash', b.x, b.z);
      return true;
    }
    case 'research': {
      const def = RESEARCH.find((r) => r.id === cmd.id);
      if (!def || country.has(def.id)) return false;
      if (def.tier > country.tier) return fail(w, c, 'requires');
      if (w.buildings.some((b) => b.alive && b.owner === c && b.research === def.id)) return false;
      const lab = w.buildings.find((b) => b.alive && b.built && b.owner === c && b.def.research_ && !b.research);
      if (!lab) return fail(w, c, 'requires');
      if (country.funds < def.cost) return fail(w, c, 'noFunds');
      country.funds -= def.cost;
      lab.research = def.id;
      lab.researchT = 0;
      return true;
    }
    case 'tier': {
      const next = (country.tier + 1) as 2 | 3;
      const def = TIER_UPGRADE[next];
      if (!def) return false;
      const hq = w.buildings.find((b) => b.alive && b.built && b.owner === c && b.def.id === 'hq');
      if (!hq || hq.upgrade) return false;
      if (w.missingRequirements(c, [...def.requires]).length) return fail(w, c, 'requires');
      if (country.funds < def.cost) return fail(w, c, 'noFunds');
      country.funds -= def.cost;
      hq.upgrade = next;
      hq.upgradeT = 0;
      return true;
    }
    case 'strike': {
      const e = w.get(cmd.id);
      if (!e || e.owner !== c) return false;
      const def = e.def;
      let kind = cmd.kind;
      if (!def.strike) return false;
      if (kind === 'hypersonic' && (!country.has('hypersonic') || def.strike !== 'ballistic')) kind = def.strike;
      if (kind !== 'hypersonic') kind = def.strike;
      if (e.strikeCd > 0) return false;
      if (e.isUnit && e.def.deploy && !e.deployed) {
        e.deployed = true;
        e.deployT = e.def.deploy;
      }
      if (!e.isUnit && !e.built) return false;
      if (!launchStrike(w, e, kind, cmd.x, cmd.z)) return false;
      e.strikeCd = def.strikeReload ?? 60;
      return true;
    }
    case 'kamikaze': {
      for (const u of ownUnits(w, c, cmd.ids)) {
        if (!u.def.kamikaze) continue;
        undock(u);
        u.order = 'strike';
        u.target = 0;
        u.gx = cmd.x;
        u.gz = cmd.z;
        u.path = [cmd.x, cmd.z];
        u.pathIdx = 0;
      }
      return true;
    }
    case 'power':
      return usePower(w, c, cmd.id, cmd.x, cmd.z, cmd.target);
    case 'unlock':
      return unlockPower(w, c, cmd.id);
    case 'sellOil':
      sellOil(w, country, country.oil * Math.max(0, Math.min(1, cmd.frac)));
      w.sound('cash', -1, -1);
      return true;
    case 'autoSell':
      country.autoSell = cmd.on;
      return true;
    case 'war':
      declareWar(w, c, cmd.target);
      return true;
    case 'propose':
      propose(w, c, cmd.target, cmd.kind);
      return true;
    case 'respond':
      respond(w, cmd.id, c, cmd.accept);
      return true;
    case 'break':
      breakTreaty(w, c, cmd.target);
      return true;
    case 'sanction':
      setSanction(w, c, cmd.target, cmd.on);
      return true;
    case 'handover':
      // A disconnected player's country is taken over by the AI on every peer.
      if (country.controller === 'human') {
        country.controller = 'ai';
        country.slot = -1;
        w.ais.push(new AIController(w, c));
      }
      return true;
    case 'surrender':
      for (const u of w.units) if (u.alive && u.owner === c) w.kill(u, null, 0);
      for (const b of w.buildings) if (b.alive && b.owner === c) w.kill(b, null, 0);
      return true;
  }
}

function build(w: World, c: number, kind: string, x: number, z: number, ids?: number[]): boolean {
  const def = BUILDINGS[kind];
  if (!def) return false;
  if (def.onOil) {
    const f = w.oilFieldAt(x, z, 1.2);
    if (f) {
      x = f.x;
      z = f.z;
    }
  }
  const err = w.placementError(c, kind, x, z);
  if (err) return fail(w, c, err);
  let builders = ids ? ownUnits(w, c, ids).filter((u) => u.def.builder) : [];
  if (!builders.length) {
    // Nearest idle builder (or nearest builder at all).
    let best: Unit | null = null;
    let bd = Infinity;
    for (const u of w.units) {
      if (!u.alive || u.owner !== c || !u.def.builder) continue;
      const d = dist(u.x, u.z, x, z) + (u.order === 'build' ? 50 : 0);
      if (d < bd) {
        bd = d;
        best = u;
      }
    }
    if (def.onOil) {
      const f = w.oilFieldAt(x, z);
      if (f?.offshore && !w.hasBuilding(c, 'shipyard')) return fail(w, c, 'requires');
    } else if (!best) return fail(w, c, 'requires');
    else builders = [best];
  }
  const country = w.countries[c];
  country.funds -= def.cost;
  country.oil -= def.oil;
  const b = w.spawnBuilding(kind, c, x, z);
  for (const u of builders) {
    undeploy(u);
    u.queue.length = 0;
    u.target = 0;
    u.order = 'build';
    u.task = b.id;
    const p = edgePoint(u, b);
    goTo(w, u, p.x, p.z);
    u.order = 'build';
  }
  w.sound('place', x, z);
  return true;
}

function train(w: World, c: number, kind: string, n: number, at?: number): boolean {
  const def = UNITS[kind];
  if (!def) return false;
  const country = w.countries[c];
  if (def.tier > country.tier) return fail(w, c, 'requires');
  if (def.research && !country.has(def.research)) return fail(w, c, 'requires');
  let ok = false;
  for (let i = 0; i < Math.min(10, n); i++) {
    const producers = w.buildings.filter((b) => b.alive && b.built && b.owner === c && b.def.produces?.includes(kind) && (at === undefined || b.id === at));
    if (!producers.length) return ok || fail(w, c, 'requires');
    if (country.funds < def.cost) return ok || fail(w, c, 'noFunds');
    if (country.oil < def.oil) return ok || fail(w, c, 'noOil');
    if (country.supply + def.supply > country.supplyCap) return ok || fail(w, c, 'supplyCap');
    let b = producers[0];
    for (const p of producers) if (p.queue.length < b.queue.length) b = p;
    if (b.queue.length >= 12) return ok || fail(w, c, 'limit');
    country.funds -= def.cost;
    country.oil -= def.oil;
    country.supply += def.supply;
    b.queue.push(kind);
    ok = true;
  }
  return ok;
}

export { STRIKES };
