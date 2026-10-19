import { describe, expect, it } from 'vitest';
import { Pathfinder } from '../src/game/pathfinding';

function grid(rows: string[]) {
  const h = rows.length;
  const w = rows[0].length;
  const cells = rows.join('');
  return { w, h, walk: (c: number) => cells[c] !== '#' };
}

describe('Pathfinder', () => {
  it('finds a path around a wall', () => {
    const g = grid([
      '..........',
      '.########.',
      '.#......#.',
      '.#.####.#.',
      '...#S.#...',
      '.###..###.',
      '..........',
    ]);
    const pf = new Pathfinder(g.w, g.h, g.walk);
    const path = pf.find(4, 4, 9, 0);
    expect(path).not.toBeNull();
    expect(path![path!.length - 1]).toBe(9);
    for (const c of path!) expect(g.walk(c)).toBe(true);
  });

  it('never cuts corners diagonally', () => {
    const g = grid(['.#', '#.']);
    const pf = new Pathfinder(g.w, g.h, g.walk);
    const path = pf.find(0, 0, 1, 1);
    // Unreachable -> returns null (closest reached cell is the start).
    expect(path).toBeNull();
  });

  it('smooths straight corridors down to two waypoints', () => {
    const g = grid(['..........', '..........', '..........']);
    const pf = new Pathfinder(g.w, g.h, g.walk);
    const path = pf.find(0, 1, 9, 1)!;
    expect(pf.smooth(path)).toEqual([10, 19]);
  });

  it('redirects to the nearest walkable cell when the goal is blocked', () => {
    const g = grid(['.....', '..#..', '.....']);
    const pf = new Pathfinder(g.w, g.h, g.walk);
    const path = pf.find(0, 0, 2, 1)!;
    expect(g.walk(path[path.length - 1])).toBe(true);
  });
});
