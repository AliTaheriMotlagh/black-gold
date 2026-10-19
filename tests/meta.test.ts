import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { fa } from '../src/i18n/fa';
import { Market } from '../src/game/events';
import { RANK_XP, rankOf, rankProgress } from '../src/meta/profile';
import { BUILDINGS, UNITS, DAMAGE_TABLE } from '../src/game/config';

describe('i18n', () => {
  it('has a non-empty Farsi translation for every English key', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(fa[key], key).toBeTypeOf('string');
      expect(fa[key].trim().length, key).toBeGreaterThan(0);
    }
    expect(Object.keys(fa).sort()).toEqual(Object.keys(en).sort());
  });

  it('names and describes every unit and building in both languages', () => {
    for (const k of Object.keys(UNITS)) {
      expect(en).toHaveProperty(`unit.${k}`);
      expect(en).toHaveProperty(`unit.${k}.desc`);
    }
    for (const k of Object.keys(BUILDINGS)) {
      expect(en).toHaveProperty(`bld.${k}`);
      expect(en).toHaveProperty(`bld.${k}.desc`);
    }
  });
});

describe('Market', () => {
  it('keeps prices within sane bounds over a long simulation', () => {
    const m = new Market();
    for (let i = 0; i < 20000; i++) {
      if (i % 3000 === 0) m.shock = i % 6000 === 0 ? 2.2 : 0.45;
      m.update(0.1);
      expect(m.price).toBeGreaterThanOrEqual(20);
      expect(m.price).toBeLessThanOrEqual(180);
    }
    expect(m.history.length).toBeLessThanOrEqual(60);
  });
});

describe('profile ranks', () => {
  it('maps XP to ranks monotonically', () => {
    expect(rankOf(0)).toBe(0);
    expect(rankOf(RANK_XP[3])).toBe(3);
    expect(rankOf(1e9)).toBe(RANK_XP.length - 1);
    expect(rankProgress(RANK_XP[2])).toBeCloseTo(0);
    expect(rankProgress(1e9)).toBe(1);
  });
});

describe('balance tables', () => {
  it('every unit can damage at least one armor class and has a valid producer', () => {
    for (const u of Object.values(UNITS)) {
      const row = DAMAGE_TABLE[u.weapon.projectile];
      expect(Object.values(row).some((v) => v > 0)).toBe(true);
      expect(BUILDINGS[u.producer].produces).toContain(u.kind);
    }
  });

  it('building requirements form no cycles', () => {
    const visit = (k: keyof typeof BUILDINGS, seen: Set<string>): void => {
      expect(seen.has(k), `cycle at ${k}`).toBe(false);
      for (const r of BUILDINGS[k].requires) visit(r, new Set([...seen, k]));
    };
    for (const k of Object.keys(BUILDINGS) as (keyof typeof BUILDINGS)[]) visit(k, new Set());
  });
});
