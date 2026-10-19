/**
 * Income, oil, power, supply, domestic stability and world opinion.
 *
 * Funds: HQ + city taxes (scaled by real population and stability) + oil sales.
 * Oil: derricks on real fields pump barrels; surplus is sold at the market price,
 * improved by refineries and cut by sanctions. Trade agreements add a bonus.
 */
import type { World } from '../world';
import type { Country } from '../country';
import { Rel } from '../country';
import { DT, ECON, UNITS } from '../defs';
import { clamp, sqrt } from '../dmath';
import { AI_SPEED } from './production';

export function sellEfficiency(w: World, c: Country) {
  const refineries = Math.min(4, w.countBuildings(c.idx, 'refinery', false));
  return (ECON.sellBase + refineries * ECON.refineryBonus) * sanctionMul(w, c);
}

export function sanctionMul(w: World, c: Country) {
  let n = 0;
  for (const o of w.countries) if (o.alive && o.idx !== c.idx && w.dip.flag(w.dip.sanction, o.idx, c.idx)) n++;
  let m = 1 - Math.min(0.4, n * 0.05);
  if (c.reputation < 25) m *= 0.65; // UN sanctions
  return m;
}

export function oilValue(w: World, c: Country, barrels: number) {
  return barrels * w.market.price * ECON.creditsPerBarrel * sellEfficiency(w, c);
}

export function sellOil(w: World, c: Country, barrels: number) {
  barrels = Math.min(barrels, c.oil);
  if (barrels <= 0) return 0;
  const credits = oilValue(w, c, barrels);
  c.oil -= barrels;
  c.funds += credits;
  c.stats.earned += credits;
  return credits;
}

export function updateEconomy(w: World) {
  const every = w.tick % 10 === 0;
  for (const c of w.countries) {
    if (!c.alive || c.idx === 0) continue;
    if (c.blackout > 0) c.blackout -= DT;
    let income = 0;
    let oil = 0;
    if (c.major) {
      for (const b of w.buildings) {
        if (!b.alive || b.owner !== c.idx || !b.built) continue;
        if (b.def.id === 'hq') income += ECON.hqIncome;
        else if (b.def.id === 'derrick' && b.oilField >= 0) oil += ECON.derrickRate * w.oil[b.oilField].rich * (c.lowPower ? 0.6 : 1);
      }
    }
    const stab = 0.55 + c.stability / 220;
    for (const ci of w.cities) {
      if (ci.owner !== c.idx) continue;
      let v = ECON.cityBase + ECON.cityPerSqrtM * sqrt(ci.pop / 1e6);
      if (ci.capital && ci.origin === c.idx) v += ECON.capitalBonus;
      // Conquered cities pay less (occupation).
      if (ci.origin !== c.idx) v *= 0.6;
      income += v * stab;
    }
    let trades = 0;
    for (const o of w.countries) if (o.alive && o.idx !== c.idx && w.dip.flag(w.dip.trade, c.idx, o.idx)) trades++;
    income *= 1 + Math.min(6, trades) * ECON.tradeBonus;
    const mul = c.controller === 'ai' ? AI_SPEED[c.difficulty] : 1;
    c.funds += income * mul * DT;
    c.stats.earned += income * mul * DT;
    c.oil += oil * mul * DT;
    c.stats.oilPumped += oil * mul * DT;
    c.incomeRate = income * mul + oilValue(w, c, oil * mul);
    // Sell surplus oil continuously.
    if (c.autoSell && c.oil > c.oilReserve) sellOil(w, c, (c.oil - c.oilReserve) * Math.min(1, DT * 0.5));
    if (!c.major) {
      // Minor powers bank money into their garrisons.
      c.funds = Math.min(c.funds, 5000);
    }

    if (every) {
      w.recount(c);
      // Supply used
      let used = 0;
      for (const u of w.units) if (u.alive && u.owner === c.idx) used += u.def.supply;
      c.supply = used + queuedSupply(w, c.idx);
      updatePolitics(w, c);
    }
  }
}

function queuedSupply(w: World, idx: number) {
  let s = 0;
  for (const b of w.buildings) if (b.alive && b.owner === idx) for (const q of b.queue) s += unitSupply(q);
  return s;
}

function unitSupply(kind: string) {
  return UNITS[kind]?.supply ?? 0;
}

/** Called twice a second per country: stability, reputation, war weariness. */
function updatePolitics(w: World, c: Country) {
  const dt = DT * 10;
  let wars = 0;
  for (const o of w.countries) if (o.alive && o.idx !== c.idx && w.dip.get(c.idx, o.idx) === Rel.War) wars++;
  if (wars) c.warWeariness = Math.min(60, c.warWeariness + dt * 0.02 * wars);
  else c.warWeariness = Math.max(0, c.warWeariness - dt * 0.15);
  // Stability: drifts toward a target set by war, occupation, losses, reputation.
  let lostCities = 0;
  let capitalLost = false;
  let shelled = 0;
  for (const ci of w.cities) {
    if (ci.origin !== c.idx) continue;
    if (ci.owner !== c.idx) {
      lostCities++;
      if (ci.capital) capitalLost = true;
    }
    if (ci.shelled < 20) shelled++;
  }
  const target = clamp(80 - c.warWeariness * 0.6 - lostCities * 4 - (capitalLost ? 25 : 0) - shelled * 3 + (c.reputation - 50) * 0.1, 5, 95);
  c.stability += (target - c.stability) * Math.min(1, dt * 0.02);
  // Reputation recovers slowly toward neutral.
  c.reputation += (60 - c.reputation) * Math.min(1, dt * 0.004);
  c.reputation = clamp(c.reputation, 0, 100);
  c.stability = clamp(c.stability, 0, 100);
  // Rank / command points from XP (Generals-style promotions).
  const rank = w.rankOf(c.xp);
  if (rank > c.rank) {
    c.points += rank - c.rank;
    c.rank = rank;
    w.alert(c.idx, 'rankUp', 'good', undefined, undefined, String(rank));
    w.sound('achievement', c.startX, c.startZ);
  }
}
