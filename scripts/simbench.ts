/**
 * Headless simulation run: all-AI match on the real theater.
 *   npx tsx scripts/simbench.ts [minutes] [seed]
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { parseTheater } from '../src/geo/theater';
import { World } from '../src/sim/world';
import { AIController } from '../src/sim/ai/ai';
import { stateHash } from '../src/sim/hash';

const minutes = Number(process.argv[2] ?? 20);
const seed = Number(process.argv[3] ?? 42);
const theater = parseTheater(new Uint8Array(zlib.gunzipSync(fs.readFileSync('public/data/theater.bin.gz'))));
const t0 = performance.now();
const w = new World(theater, {
  seed,
  players: [],
  aiMajors: ['IRN', 'SAU', 'IRQ', 'ARE'],
  difficulty: 'hard',
  startFunds: 5000,
  scenario: 'realistic',
  events: true,
  timeLimit: 0,
});
console.log(`setup ${(performance.now() - t0).toFixed(0)} ms, ${w.units.length} units, ${w.buildings.length} buildings, ${w.ais.length} AIs`);
void AIController;
const ticks = minutes * 60 * 20;
let worst = 0;
const tStart = performance.now();
const counts: Record<string, number> = {};
for (let i = 0; i < ticks && !w.ended; i++) {
  const a = performance.now();
  w.step([]);
  const dt = performance.now() - a;
  if (dt > worst) worst = dt;
  for (const e of w.events) {
    const k = e.t === 'diplo' ? `diplo:${e.what}` : e.t === 'crisis' ? `crisis:${e.id}` : e.t;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  if (i % (20 * 120) === 0) {
    const line = w.countries
      .filter((c) => c.major)
      .map((c) => `${c.iso} $${c.funds.toFixed(0)} t${c.tier} u${w.units.filter((u) => u.owner === c.idx).length} b${w.buildings.filter((b) => b.owner === c.idx).length} cities${w.cities.filter((ci) => ci.owner === c.idx).length} sup${c.supply.toFixed(0)}/${c.supplyCap} pw${c.powerProd}/${c.powerUse}`)
      .join(' | ');
    console.log(`t=${(w.time / 60).toFixed(0)}m proj=${w.projectiles.length} ${line}`);
  }
}
const total = performance.now() - tStart;
console.log(`\n${w.tick} ticks in ${(total / 1000).toFixed(1)} s → ${(total / w.tick).toFixed(2)} ms/tick avg, worst ${worst.toFixed(1)} ms`);
console.log('events', counts);
const wars: string[] = [];
for (const a of w.countries) for (const b of w.countries) if (a.idx < b.idx && w.dip.atWar(a.idx, b.idx)) wars.push(`${a.iso}-${b.iso}`);
console.log('wars', wars.join(' '), 'hash', stateHash(w).toString(16), 'ended', w.ended, w.winners);
for (const c of w.countries.filter((c) => c.major)) console.log(c.iso, JSON.stringify(c.stats), 'researched', c.researched.join(','), 'stab', c.stability.toFixed(0), 'rep', c.reputation.toFixed(0));
