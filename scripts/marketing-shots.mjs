// Captures real in-game screenshots for the landing page and social cards.
//   node scripts/marketing-shots.mjs   (dev server on :5173)
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import fs from 'node:fs';

const base = process.env.URL ?? 'http://localhost:5173';
const out = 'public/media';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });

async function shot(name, { w = 1600, h = 900, mobile = false, url = '/play/?quick=1', prep, wait = 7000, hideHud = false }) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, hasTouch: mobile, isMobile: mobile });
  page.on('pageerror', (e) => console.log(name, 'pageerror', e.message));
  await page.goto(base + url);
  await page.waitForTimeout(6500);
  if (prep) await page.evaluate(prep);
  if (hideHud) await page.addStyleTag({ content: '.hud, .map-labels { display: none !important; }' });
  await page.waitForTimeout(wait);
  const png = await page.screenshot();
  await sharp(png).webp({ quality: 82 }).toFile(`${out}/${name}.webp`);
  if (name === 'battle') fs.writeFileSync(`${out}/_battle.png`, png);
  if (name === 'strategic') fs.writeFileSync(`${out}/_strategic.png`, png);
  console.log('saved', name);
  await page.close();
}

const battle = () => {
  const g = window.app.game;
  const w = g.world;
  const me = g.session.local;
  const foe = w.byIso.get('IRQ').idx;
  w.dip.set(me, foe, 0);
  const hq = w.buildings.find((b) => b.owner === me && b.def.id === 'hq');
  const X = hq.x + 7;
  const Z = hq.z + 3;
  const sp = (k, o, x, z, hd) => {
    const u = w.spawnUnit(k, o, x, z);
    u.heading = hd;
    return u;
  };
  for (let i = 0; i < 7; i++) sp('mbt', me, X - 1.2 + i * 0.4, Z + (i % 2) * 0.2, Math.PI);
  for (let i = 0; i < 4; i++) sp('ifv', me, X - 0.8 + i * 0.5, Z - 0.6, Math.PI);
  sp('shorad', me, X - 1.4, Z - 1.1, Math.PI);
  sp('mlrs', me, X + 1.2, Z - 1.3, Math.PI);
  for (let i = 0; i < 2; i++) {
    const hl = sp('heli', me, X - 0.6 + i * 1.2, Z - 0.2, Math.PI);
    hl.y = 0.25;
  }
  for (let i = 0; i < 8; i++) sp('mbt', foe, X - 1.4 + i * 0.4, Z + 3.4 + (i % 2) * 0.3, 0);
  for (let i = 0; i < 6; i++) sp('atgm_team', foe, X - 1.2 + i * 0.45, Z + 4.1, 0);
  for (let i = 0; i < 8; i++) {
    const d = sp('fpv', foe, X - 1 + i * 0.3, Z + 4.6, 0);
    d.y = 0.08;
  }
  w.spawnBuilding('bunker', foe, X - 0.5, Z + 4.8, true);
  w.spawnBuilding('bunker', foe, X + 0.9, Z + 4.9, true);
  for (let i = 0; i < 400; i++) w.step([]);
  g.view.rig.jumpTo(X + 0.6, Z + 2.4, 3.2);
  g.view.rig.goal.yaw = g.view.rig.yaw = 0.55;
  g.view.rig.goal.tilt = g.view.rig.tilt = -0.32;
};

const strategic = () => {
  window.app.debugAutoplay(1);
  window.app.debugSimulate(1600);
  const g = window.app.game;
  g.view.rig.jumpTo(2350, 1500, 1750);
  g.view.rig.goal.yaw = g.view.rig.yaw = 0.15;
  g.view.politicalBoost = 0.6;
};

const baseView = () => {
  window.app.debugAutoplay(1);
  window.app.debugSimulate(1400);
  const g = window.app.game;
  const me = g.world.countries[g.session.local];
  g.view.rig.jumpTo(me.startX + 0.4, me.startZ + 0.6, 5.5);
  g.view.rig.goal.yaw = g.view.rig.yaw = 0.7;
  g.view.rig.goal.tilt = g.view.rig.tilt = -0.15;
};

const diplomacy = () => {
  window.app.debugSimulate(60);
  const g = window.app.game;
  g.hud.diplo.open();
  g.view.rig.jumpTo(2350, 1700, 900);
};

await shot('battle', { prep: battle, wait: 6000, hideHud: true });
await shot('battle-hud', { prep: battle, wait: 6000 });
await shot('strategic', { prep: strategic, wait: 9000 });
await shot('base', { prep: baseView, wait: 9000 });
await shot('diplomacy', { prep: diplomacy, wait: 5000 });
await shot('mobile', { w: 844, h: 390, mobile: true, prep: battle, wait: 6000 });
await shot('menu', { url: '/play/', wait: 2500 });

// Social card 1200×630: battle shot + title band.
const card = await sharp(`${out}/_battle.png`).resize(1200, 630, { fit: 'cover', position: 'centre' }).toBuffer();
const overlay = Buffer.from(`<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="f" x1="0" x2="0" y1="0" y2="1"><stop offset="0.45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.85"/></linearGradient>
  <linearGradient id="t" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff2c2"/><stop offset="1" stop-color="#d9a21e"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#f)"/>
  <text x="60" y="520" font-family="Rajdhani, Arial Black, sans-serif" font-weight="700" font-size="92" letter-spacing="14" fill="url(#t)">BLACK GOLD</text>
  <text x="64" y="572" font-family="Rajdhani, Arial, sans-serif" font-weight="600" font-size="28" letter-spacing="7" fill="#e7edf4">REAL-TIME STRATEGY · REAL MIDDLE EAST · PLAY FREE</text>
</svg>`);
await sharp(card).composite([{ input: overlay }]).jpeg({ quality: 86, mozjpeg: true }).toFile('public/og-image.jpg');
fs.rmSync(`${out}/_battle.png`);
fs.rmSync(`${out}/_strategic.png`);
console.log('og-image ok');
await browser.close();
