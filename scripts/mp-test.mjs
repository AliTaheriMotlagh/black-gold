// Two-tab lockstep test over BroadcastChannel: host + client, commands on both sides,
// then compare the state hashes both peers recorded at the same ticks.
//   node scripts/mp-test.mjs [seconds]
import { chromium } from 'playwright-core';

const secs = Number(process.argv[2] ?? 25);
const base = process.env.URL ?? 'http://localhost:5173';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
const log = (tag) => (m) => {
  if (m.type() === 'error' || m.text().startsWith('[mp]')) console.log(tag, m.text());
};
const A = await ctx.newPage();
A.on('console', log('A'));
A.on('pageerror', (e) => console.log('A pageerror', e.message));
await A.goto(`${base}/play/?local=1`);
await A.waitForTimeout(5000);
await A.click('.menu-item:nth-child(2)'); // Multiplayer
await A.waitForTimeout(400);
await A.click('.panel-body .btn.primary'); // Host
await A.waitForSelector('.room-code b');
const code = await A.textContent('.room-code b');
console.log('room', code);

const B = await ctx.newPage();
B.on('console', log('B'));
B.on('pageerror', (e) => console.log('B pageerror', e.message));
await B.goto(`${base}/play/?local=1&room=${code}`);
await B.waitForSelector('.player', { timeout: 15000 });
await B.waitForTimeout(800);
const readyBtn = await B.$$('.panel-body .btn');
for (const b of readyBtn) if ((await b.textContent()).includes('Ready')) await b.click();
await A.waitForTimeout(800);
await A.click('.start-btn');
await A.waitForTimeout(3000);

const hook = () => {
  window.__h = {};
  const s = window.app.game.session;
  const prev = s.onHash;
  s.onHash = (tick, hash) => {
    window.__h[tick] = hash;
    prev(tick, hash);
  };
};
await A.evaluate(hook);
await B.evaluate(hook);
// Both sides give orders.
const orders = () => {
  const g = window.app.game;
  const w = g.world;
  const mine = w.units.filter((u) => u.owner === g.session.local);
  const hq = w.buildings.find((b) => b.owner === g.session.local && b.def.id === 'hq');
  g.session.issue({ k: 'move', ids: mine.map((u) => u.id), x: hq.x + 3, z: hq.z + 2, atk: true });
  g.session.issue({ k: 'train', kind: 'rifle', n: 3 });
  g.session.issue({ k: 'build', kind: 'power', x: hq.x - 1.6, z: hq.z + 0.4 });
  return [w.countries[g.session.local].iso, mine.length];
};
console.log('A orders', await A.evaluate(orders));
console.log('B orders', await B.evaluate(orders));
await A.waitForTimeout(secs * 1000);
const ha = await A.evaluate(() => ({ h: window.__h, tick: window.app.game.world.tick, status: window.app.game.session.status }));
const hb = await B.evaluate(() => ({ h: window.__h, tick: window.app.game.world.tick, status: window.app.game.session.status }));
const common = Object.keys(ha.h).filter((t) => t in hb.h);
const bad = common.filter((t) => ha.h[t] !== hb.h[t]);
console.log(`A tick ${ha.tick} B tick ${hb.tick} · compared ${common.length} checkpoints · mismatches ${bad.length}`, bad.slice(0, 5));
await browser.close();
process.exit(bad.length || !common.length ? 1 : 0);
