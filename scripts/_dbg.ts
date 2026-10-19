import fs from 'node:fs';
import zlib from 'node:zlib';
import { parseTheater } from '../src/geo/theater';
import { World } from '../src/sim/world';
const theater = parseTheater(new Uint8Array(zlib.gunzipSync(fs.readFileSync('public/data/theater.bin.gz'))));
const w = new World(theater, { seed: 42, players: [], aiMajors: ['IRN', 'SAU', 'IRQ', 'ARE'], difficulty: 'hard', startFunds: 5000, scenario: 'realistic', events: true, timeLimit: 0 });
for (let i = 0; i < 20 * 400; i++) {
  w.step([]);
  for (const e of w.events) if (e.t === 'diplo' && i < 20*400) console.log((w.time|0)+'s', w.countries[e.a].iso, e.what, w.countries[e.b].iso);
}
for (const c of w.countries.filter(c=>c.major)) {
  const hq = w.buildings.find(b=>b.owner===c.idx && b.def.id==='hq')!;
  console.log(c.iso, 'hq', hq.x.toFixed(0), hq.z.toFixed(0), 'buildings', w.buildings.filter(b=>b.owner===c.idx).map(b=>b.def.id+(b.built?'':'*')+':'+b.workers).join(','));
  for (const k of ['barracks','factory','refinery','depot']) console.log('  place', k, JSON.stringify(w.findPlacement(c.idx, k, hq.x, hq.z, 1.2, 14)));
  const bs = w.units.filter(u=>u.owner===c.idx && u.def.builder);
  console.log('  builders', bs.map(u=>`${u.order} task${u.task} ${u.x.toFixed(1)},${u.z.toFixed(1)} path${u.path.length/2} pend${u.pathPending}`).join(' | '));
}
