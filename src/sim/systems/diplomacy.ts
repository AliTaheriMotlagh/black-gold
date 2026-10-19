/**
 * Diplomacy: relations (war / hostile / neutral / non-aggression pact / alliance),
 * tension, proposals between countries (AI evaluates; humans answer in the UI),
 * casus belli & reputation, calls to arms, sanctions, trade, military access and
 * border violations.
 */
import type { World } from '../world';
import type { Country, ProposalKind } from '../country';
import { Rel } from '../country';
import { DT } from '../defs';
import { stopUnits } from './movement';

/** Real-world alignments (2025) used by the "Regional blocs" scenario. No wars at start. */
const BLOCS = {
  alliance: [
    ['SAU', 'ARE', 'KWT', 'QAT', 'BHR', 'OMN'],
    ['TUR', 'AZE'],
  ],
  pact: [
    ['EGY', 'SAU'],
    ['ISR', 'ARE'],
    ['ISR', 'BHR'],
    ['ISR', 'EGY'],
    ['ISR', 'JOR'],
    ['IRN', 'IRQ'],
    ['EGY', 'JOR'],
    ['IRN', 'ARM'],
  ],
  tension: [
    ['IRN', 'ISR', 80],
    ['YEM', 'ISR', 70],
    ['YEM', 'SAU', 60],
    ['ISR', 'LBN', 60],
    ['ARM', 'AZE', 55],
    ['TUR', 'CYP', 55],
    ['IRN', 'SAU', 40],
    ['IRN', 'ARE', 40],
    ['SYR', 'ISR', 55],
    ['TUR', 'SYR', 35],
    ['IRQ', 'TUR', 30],
    ['SDN', 'ERI', 35],
    ['ISR', 'PSX', 70],
  ] as [string, string, number][],
  trade: [
    ['TUR', 'AZE'],
    ['IRN', 'IRQ'],
    ['EGY', 'SAU'],
    ['SAU', 'ARE'],
    ['ARE', 'OMN'],
    ['TUR', 'IRQ'],
    ['TUR', 'GEO'],
  ],
};

export function applyScenario(w: World) {
  const d = w.dip;
  if (w.setup.scenario !== 'realistic') return;
  const id = (iso: string) => w.byIso.get(iso)?.idx ?? 0;
  for (const group of BLOCS.alliance)
    for (const a of group)
      for (const b of group) if (a !== b && id(a) && id(b)) d.set(id(a), id(b), Rel.Alliance);
  for (const [a, b] of BLOCS.pact) if (id(a) && id(b)) d.set(id(a), id(b), Rel.Pact);
  for (const [a, b, t] of BLOCS.tension)
    if (id(a) && id(b)) {
      d.addTension(id(a), id(b), t - d.getTension(id(a), id(b)));
      if (t >= 60) d.set(id(a), id(b), Rel.Hostile);
    }
  for (const [a, b] of BLOCS.trade) if (id(a) && id(b)) d.setFlag(d.trade, id(a), id(b), true);
}

// ---------------------------------------------------------------------------
// Actions

function notify(w: World, a: number, b: number, what: string) {
  w.events.push({ t: 'diplo', a, b, what });
}

/** Do we have a justification (casus belli) to attack `b`? */
export function hasCasusBelli(w: World, a: number, b: number) {
  if (w.dip.getTension(a, b) >= 60) return true;
  for (const c of w.countries) if (c.alive && w.dip.allied(a, c.idx) && c.idx !== a && w.dip.atWar(b, c.idx)) return true;
  return false;
}

export function declareWar(w: World, a: number, b: number) {
  const d = w.dip;
  if (a === b || a <= 0 || b <= 0 || d.atWar(a, b)) return;
  const A = w.countries[a];
  const justified = hasCasusBelli(w, a, b);
  if (!justified) {
    A.reputation = Math.max(0, A.reputation - 15);
    A.stability = Math.max(0, A.stability - 5);
  }
  d.set(a, b, Rel.War);
  d.warSince[a * d.n + b] = w.time;
  d.warSince[b * d.n + a] = w.time;
  d.setFlag(d.trade, a, b, false);
  d.setFlag(d.access, a, b, false);
  d.addTension(a, b, 30);
  d.proposals = d.proposals.filter((p) => !((p.from === a && p.to === b) || (p.from === b && p.to === a)));
  notify(w, a, b, 'war');
  w.sound('war', w.countries[b].startX, w.countries[b].startZ);
  for (const c of w.countries) {
    if (c.controller !== 'human' || !c.alive) continue;
    if (c.idx === b) w.alert(c.idx, 'warOnUs', 'bad', A.startX, A.startZ, A.iso);
    else w.alert(c.idx, 'warDeclared', 'warn', undefined, undefined, `${A.iso}>${w.countries[b].iso}`);
  }
  // Calls to arms: allies of the victim join (AI automatically, humans are asked).
  for (const c of w.countries) {
    if (!c.alive || c.idx === a || c.idx === b) continue;
    if (d.get(c.idx, b) !== Rel.Alliance || d.get(c.idx, a) === Rel.Alliance) continue;
    if (c.controller === 'human') w.alert(c.idx, 'callToArms', 'warn', undefined, undefined, `${w.countries[b].iso}>${A.iso}`);
    else if (!d.atWar(c.idx, a)) {
      d.set(c.idx, a, Rel.War);
      d.addTension(c.idx, a, 30);
      notify(w, c.idx, a, 'war');
    }
  }
  // Attacking someone breaks an alliance with them.
  for (const c of w.countries) if (c.alive && d.get(a, c.idx) === Rel.Alliance && c.idx !== a && d.atWar(c.idx, b) === false && d.get(c.idx, b) === Rel.Alliance) d.set(a, c.idx, Rel.Neutral);
}

export function makePeace(w: World, a: number, b: number) {
  const d = w.dip;
  if (!d.atWar(a, b)) return;
  d.set(a, b, Rel.Hostile);
  d.addTension(a, b, -25);
  notify(w, a, b, 'peace');
  w.alert(a, 'peace', 'good', undefined, undefined, w.countries[b].iso);
  w.alert(b, 'peace', 'good', undefined, undefined, w.countries[a].iso);
  // Units of both sides inside the other's territory stop fighting.
  for (const u of w.units) if (u.alive && (u.owner === a || u.owner === b) && u.target && w.get(u.target)?.owner === (u.owner === a ? b : a)) stopUnits([u]);
}

export function formAlliance(w: World, a: number, b: number) {
  w.dip.set(a, b, Rel.Alliance);
  w.dip.setFlag(w.dip.access, a, b, true);
  w.dip.addTension(a, b, -30);
  notify(w, a, b, 'alliance');
  w.alert(a, 'alliance', 'good', undefined, undefined, w.countries[b].iso);
  w.alert(b, 'alliance', 'good', undefined, undefined, w.countries[a].iso);
}

export function breakTreaty(w: World, a: number, b: number) {
  const r = w.dip.get(a, b);
  if (r !== Rel.Alliance && r !== Rel.Pact) return;
  w.dip.set(a, b, Rel.Neutral);
  w.dip.setFlag(w.dip.access, a, b, false);
  w.dip.addTension(a, b, 20);
  w.countries[a].reputation = Math.max(0, w.countries[a].reputation - 5);
  notify(w, a, b, 'broken');
  w.alert(b, 'allianceBroken', 'bad', undefined, undefined, w.countries[a].iso);
}

export function setSanction(w: World, a: number, b: number, on: boolean) {
  w.dip.setFlag(w.dip.sanction, a, b, on, false);
  if (on) {
    w.dip.setFlag(w.dip.trade, a, b, false);
    w.dip.addTension(a, b, 10);
    w.alert(b, 'sanctioned', 'bad', undefined, undefined, w.countries[a].iso);
  }
  notify(w, a, b, on ? 'sanction' : 'unsanction');
}

export function propose(w: World, from: number, to: number, kind: ProposalKind) {
  const d = w.dip;
  if (from === to || !w.countries[to]?.alive) return;
  if (d.proposals.some((p) => p.from === from && p.to === to && p.kind === kind)) return;
  if (kind === 'peace' && !d.atWar(from, to)) return;
  if (kind !== 'peace' && d.atWar(from, to)) return;
  const p = { id: d.nextProposal++, from, to, kind, expires: w.time + 60 };
  d.proposals.push(p);
  notify(w, from, to, `propose:${kind}`);
  w.alert(to, 'proposal', 'info', undefined, undefined, `${kind}:${w.countries[from].iso}:${p.id}`);
}

export function respond(w: World, id: number, by: number, accept: boolean) {
  const d = w.dip;
  const p = d.proposals.find((q) => q.id === id);
  if (!p || p.to !== by) return;
  d.proposals = d.proposals.filter((q) => q !== p);
  if (!accept) {
    notify(w, p.to, p.from, `reject:${p.kind}`);
    w.alert(p.from, 'rejected', 'bad', undefined, undefined, `${p.kind}:${w.countries[p.to].iso}`);
    return;
  }
  switch (p.kind) {
    case 'peace':
      makePeace(w, p.from, p.to);
      break;
    case 'alliance':
      formAlliance(w, p.from, p.to);
      break;
    case 'pact':
      d.set(p.from, p.to, Rel.Pact);
      d.addTension(p.from, p.to, -15);
      notify(w, p.from, p.to, 'pact');
      break;
    case 'trade':
      d.setFlag(d.trade, p.from, p.to, true);
      d.addTension(p.from, p.to, -8);
      notify(w, p.from, p.to, 'trade');
      break;
    case 'access':
      d.setFlag(d.access, p.from, p.to, true, false);
      notify(w, p.from, p.to, 'access');
      break;
  }
}

/** Military strength estimate (unit + defence value). */
export function strength(w: World, idx: number) {
  let s = 0;
  for (const u of w.units) if (u.alive && u.owner === idx) s += u.def.cost;
  for (const b of w.buildings) if (b.alive && b.owner === idx && b.def.weapons) s += b.def.cost * 0.6;
  for (const c of w.cities) if (c.owner === idx) s += c.garrison * 3;
  return s;
}

/** How an AI (or minor) leader answers a proposal. Deterministic. */
export function aiAccepts(w: World, p: { from: number; to: number; kind: ProposalKind }): boolean {
  const d = w.dip;
  const me = w.countries[p.to];
  const them = w.countries[p.from];
  const t = d.getTension(p.from, p.to);
  switch (p.kind) {
    case 'peace': {
      const age = w.time - d.warSince[p.from * d.n + p.to];
      if (age < 150) return false;
      const ratio = strength(w, p.to) / Math.max(1, strength(w, p.from));
      return me.warWeariness > 25 || ratio < 0.7 || me.stability < 35 || (me.controller === 'minor' && age > 300);
    }
    case 'alliance': {
      let sharedEnemy = false;
      for (const c of w.countries) if (c.alive && d.atWar(p.to, c.idx) && d.atWar(p.from, c.idx)) sharedEnemy = true;
      return them.reputation > 35 && t < 30 && (sharedEnemy || t < 12);
    }
    case 'pact':
      return t < 50 && them.reputation > 20;
    case 'trade':
      return t < 60 && !d.flag(d.sanction, p.to, p.from) && them.reputation > 15;
    case 'access':
      return d.get(p.from, p.to) >= Rel.Pact && t < 25;
  }
}

export function relationOf(w: World, a: number, b: number): Rel {
  return w.dip.get(a, b);
}

// ---------------------------------------------------------------------------

const lastViolationAlert = new WeakMap<World, Map<number, number>>();

export function updateDiplomacy(w: World) {
  const d = w.dip;
  if (w.tick % 20 === 0) {
    // Proposals: AI recipients answer after a beat; humans have 60 s.
    for (const p of d.proposals.slice()) {
      const to = w.countries[p.to];
      if (to.controller !== 'human' && p.expires - w.time < 57) respond(w, p.id, p.to, aiAccepts(w, p));
      else if (p.expires < w.time) d.proposals = d.proposals.filter((q) => q !== p);
    }
    // Tension drifts down; hostility label follows tension.
    for (let a = 1; a < d.n; a++)
      for (let b = a + 1; b < d.n; b++) {
        const r = d.get(a, b);
        if (r === Rel.War) continue;
        d.addTension(a, b, -0.05);
        const t = d.getTension(a, b);
        if (r === Rel.Neutral && t >= 60) d.set(a, b, Rel.Hostile);
        else if (r === Rel.Hostile && t < 40) d.set(a, b, Rel.Neutral);
      }
  }
  if (w.tick % 40 === 7) borderViolations(w);
  void DT;
}

/** Armies inside a non-allied country's territory without access raise tension. */
function borderViolations(w: World) {
  const d = w.dip;
  let alerts = lastViolationAlert.get(w);
  if (!alerts) lastViolationAlert.set(w, (alerts = new Map()));
  const seen = new Set<number>();
  for (const u of w.units) {
    if (!u.alive || u.def.category === 'naval') continue;
    const host = w.ownerAt(u.x, u.z);
    if (host <= 0 || host === u.owner) continue;
    const r = d.get(u.owner, host);
    if (r === Rel.War || r === Rel.Alliance || d.flag(d.access, u.owner, host)) continue;
    const key = u.owner * 256 + host;
    if (seen.has(key)) continue;
    seen.add(key);
    d.addTension(u.owner, host, 2);
    const last = alerts.get(key) ?? -1e9;
    if (w.time - last > 45) {
      alerts.set(key, w.time);
      w.alert(host, 'borderViolation', 'warn', u.x, u.z, w.countries[u.owner].iso);
    }
  }
}

export type { Country };
