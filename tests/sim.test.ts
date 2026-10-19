import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { type Theater, parseTheater } from '../src/geo/theater';
import { World, type MatchSetup } from '../src/sim/world';
import { stateHash } from '../src/sim/hash';
import { atan2, cos, sin, wrap } from '../src/sim/dmath';
import { Rng } from '../src/sim/rng';
import { Rel } from '../src/sim/country';
import { lonLatToWorld, worldToLonLat } from '../src/geo/projection';

let theater: Theater;
beforeAll(() => {
  theater = parseTheater(new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.resolve(__dirname, '../public/data/theater.bin.gz')))));
});

const setup = (seed = 7): MatchSetup => ({
  seed,
  players: [{ slot: 0, name: 'P', country: 'IRN' }],
  aiMajors: ['SAU', 'IRQ'],
  difficulty: 'hard',
  startFunds: 5000,
  scenario: 'realistic',
  events: true,
  timeLimit: 0,
});

describe('deterministic math', () => {
  it('matches Math within tolerance', () => {
    for (let a = -20; a < 20; a += 0.37) {
      expect(Math.abs(sin(a) - Math.sin(a))).toBeLessThan(1e-9);
      expect(Math.abs(cos(a) - Math.cos(a))).toBeLessThan(1e-9);
    }
    for (let i = 0; i < 200; i++) {
      const y = Math.sin(i) * 10;
      const x = Math.cos(i * 1.7) * 10;
      expect(Math.abs(atan2(y, x) - Math.atan2(y, x))).toBeLessThan(1e-6);
    }
    expect(Math.abs(wrap(7))).toBeLessThanOrEqual(Math.PI);
  });

  it('seeded RNG is reproducible', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.u32()).toBe(b.u32());
  });

  it('simulation code avoids engine-dependent math', () => {
    const dir = path.resolve(__dirname, '../src/sim');
    const files: string[] = [];
    const walk = (d: string) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name))));
    walk(dir);
    const banned = /Math\.(sin|cos|tan|atan|atan2|asin|acos|exp|log|pow|hypot|cbrt|random)\b|performance\.now|Date\.now|[^/*\s]\s*\*\*\s*[^/]/;
    for (const f of files) {
      const code = fs
        .readFileSync(f, 'utf8')
        .split('\n')
        .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*'))
        .join('\n');
      expect(banned.test(code), `${path.relative(dir, f)} uses non-deterministic math`).toBe(false);
    }
  });
});

describe('theater', () => {
  it('projection round-trips', () => {
    const p = lonLatToWorld(51.4, 35.7);
    const q = worldToLonLat(p.x, p.z);
    expect(q.lon).toBeCloseTo(51.4, 6);
    expect(q.lat).toBeCloseTo(35.7, 6);
  });

  it('has real geography', () => {
    const tehran = lonLatToWorld(51.39, 35.69);
    const gulf = lonLatToWorld(51.5, 27);
    expect(theater.isWater(tehran.x, tehran.z)).toBe(false);
    expect(theater.isWater(gulf.x, gulf.z)).toBe(true);
    expect(theater.heightAt(tehran.x, tehran.z)).toBeGreaterThan(900);
    const iso = (x: number, z: number) => theater.meta.countries.find((c) => c.idx === theater.countryAt(x, z))?.iso;
    expect(iso(tehran.x, tehran.z)).toBe('IRN');
    const riyadh = lonLatToWorld(46.7, 24.7);
    expect(iso(riyadh.x, riyadh.z)).toBe('SAU');
    expect(theater.meta.cities.length).toBeGreaterThan(100);
  });
});

describe('simulation', () => {
  it('is deterministic: same seed + commands → same state', () => {
    const run = () => {
      const w = new World(theater, setup());
      const me = w.byIso.get('IRN')!.idx;
      for (let i = 0; i < 1200; i++) {
        const cmds = [];
        if (i === 10) {
          const ids = w.units.filter((u) => u.owner === me).map((u) => u.id);
          cmds.push({ k: 'move' as const, c: me, ids, x: w.countries[me].startX + 8, z: w.countries[me].startZ + 5, atk: true });
        }
        if (i === 20) cmds.push({ k: 'train' as const, c: me, kind: 'rifle', n: 3 });
        w.step(cmds);
      }
      return stateHash(w);
    };
    expect(run()).toBe(run());
  });

  it('pathfinding routes around the Persian Gulf on land', () => {
    const w = new World(theater, setup());
    const a = lonLatToWorld(48.6, 31.3); // Ahvaz
    const b = lonLatToWorld(50.1, 26.4); // Dammam
    const req = w.landPaths.request(a.x, a.z, b.x, b.z);
    for (let i = 0; i < 400 && !req.done; i++) w.landPaths.step(24000);
    expect(req.done).toBe(true);
    expect(req.result.length).toBeGreaterThan(2);
    for (let i = 0; i < req.result.length; i += 2) expect(theater.isWater(req.result[i], req.result[i + 1])).toBe(false);
    const end = { x: req.result[req.result.length - 2], z: req.result[req.result.length - 1] };
    expect(Math.hypot(end.x - b.x, end.z - b.z)).toBeLessThan(10);
  });

  it('economy produces income and AI builds a base', () => {
    const w = new World(theater, setup(3));
    const sau = w.byIso.get('SAU')!;
    const before = w.buildings.filter((b) => b.owner === sau.idx).length;
    for (let i = 0; i < 20 * 240; i++) w.step([]);
    expect(sau.stats.earned).toBeGreaterThan(500);
    expect(w.buildings.filter((b) => b.owner === sau.idx && b.built).length).toBeGreaterThan(before + 3);
  });

  it('units only fight nations at war', () => {
    const w = new World(theater, { ...setup(), aiMajors: [], scenario: 'sandbox', events: false });
    const iran = w.byIso.get('IRN')!.idx;
    const iraq = w.byIso.get('IRQ')!.idx;
    const p = lonLatToWorld(46, 33);
    const a = w.spawnUnit('mbt', iran, p.x, p.z);
    const b = w.spawnUnit('mbt', iraq, p.x + 1, p.z);
    for (let i = 0; i < 100; i++) w.step([]);
    expect(a.hp).toBe(a.maxHp);
    expect(b.hp).toBe(b.maxHp);
    w.step([{ k: 'war', c: iran, target: iraq }]);
    expect(w.dip.get(iran, iraq)).toBe(Rel.War);
    for (let i = 0; i < 400; i++) w.step([]);
    expect(a.hp < a.maxHp || b.hp < b.maxHp || !a.alive || !b.alive).toBe(true);
    // Unjustified war costs world opinion.
    expect(w.countries[iran].reputation).toBeLessThan(60);
  });

  it('interceptors can shoot down ballistic missiles', () => {
    const w = new World(theater, { ...setup(11), aiMajors: [], events: false });
    const iran = w.byIso.get('IRN')!.idx;
    const sau = w.byIso.get('SAU')!.idx;
    w.dip.set(iran, sau, Rel.War);
    const riyadh = lonLatToWorld(46.7, 24.7);
    for (let i = 0; i < 4; i++) {
      const s = w.spawnBuilding('samsite', sau, riyadh.x + 10 + i, riyadh.z + 10, true);
      s.hp = s.maxHp;
    }
    w.countries[sau].powerProd = 999;
    const tel = w.spawnUnit('tel', iran, w.countries[iran].startX, w.countries[iran].startZ);
    w.countries[iran].funds = 99999;
    let launched = 0;
    for (let k = 0; k < 6; k++) {
      tel.strikeCd = 0;
      w.step([{ k: 'strike', c: iran, id: tel.id, kind: 'ballistic', x: riyadh.x + 10, z: riyadh.z + 10 }]);
      launched++;
      for (let i = 0; i < 20 * 120; i++) w.step([]);
    }
    expect(launched).toBe(6);
    expect(w.countries[sau].stats.intercepts).toBeGreaterThan(0);
  });
});
