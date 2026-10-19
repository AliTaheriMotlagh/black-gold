// Dev helper (used by scripts/shot.mjs actions): stage a combined-arms battle near the player's HQ.
await page.evaluate(() => {
  const g = window.app.game; const w = g.world; const me = g.session.local;
  const foe = w.byIso.get('IRQ').idx;
  w.dip.set(me, foe, 0);
  const hq = w.buildings.find((b) => b.owner === me && b.def.id === 'hq');
  const X = hq.x + 6, Z = hq.z + 2;
  const sp = (k, o, x, z) => { const u = w.spawnUnit(k, o, x, z); u.heading = o === me ? 0 : Math.PI; return u; };
  for (let i = 0; i < 6; i++) sp('mbt', me, X - 1 + i * 0.35, Z);
  for (let i = 0; i < 4; i++) sp('ifv', me, X - 0.6 + i * 0.4, Z - 0.5);
  for (let i = 0; i < 6; i++) sp('rifle', me, X - 1 + i * 0.3, Z + 0.4);
  sp('shorad', me, X, Z - 1); sp('mlrs', me, X + 1, Z - 1.4); sp('heli', me, X - 1, Z - 0.8);
  for (let i = 0; i < 7; i++) sp('mbt', foe, X - 1 + i * 0.35, Z + 3.2);
  for (let i = 0; i < 5; i++) sp('atgm_team', foe, X - 1 + i * 0.4, Z + 3.8);
  for (let i = 0; i < 6; i++) { const d = sp('fpv', foe, X - 1 + i * 0.3, Z + 4.5); d.y = 0.08; }
  sp('heli', foe, X + 1.5, Z + 4.5);
  w.spawnBuilding('samsite', me, hq.x - 1.5, hq.z + 1.2, true);
  w.spawnBuilding('factory', me, hq.x + 1.5, hq.z - 0.6, true);
  w.spawnBuilding('barracks', me, hq.x - 1.2, hq.z - 1.2, true);
  w.spawnBuilding('radar', me, hq.x + 0.2, hq.z + 1.6, true);
  w.spawnBuilding('refinery', me, hq.x - 2.6, hq.z - 0.2, true);
  g.view.rig.jumpTo(X + 0.2, Z + 2.2, 4.2);
  g.view.rig.goal.yaw = g.view.rig.yaw = 0.5;
});
await page.waitForTimeout(4200);
await page.evaluate(() => {
  const g = window.app.game; const w = g.world; const me = g.session.local;
  const foe = w.byIso.get('IRQ').idx;
  const tel = w.units.find((u) => u.owner === me && u.def.id === 'mbt');
  // A cruise missile streaking in for the shot.
  const silo = w.spawnBuilding('silo', foe, tel.x + 60, tel.z + 30, true); silo.strikeCd = 0;
  g.session.issue({ k: 'stop', ids: [] });
});
await page.waitForTimeout(800);
