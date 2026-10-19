import { describe, expect, it } from 'vitest';
import { CITIES, OIL_FIELDS, START_REGIONS, isSea, lonLatToWorld } from '../src/geo/geography';
import { generateMap, nearestPassable, worldToCell } from '../src/world/heightmap';

const map = generateMap(2);

function components(): Int32Array {
  const comp = new Int32Array(map.w * map.h).fill(-1);
  let id = 0;
  for (let s = 0; s < comp.length; s++) {
    if (!map.cellPassable[s] || comp[s] >= 0) continue;
    const stack = [s];
    comp[s] = id;
    while (stack.length) {
      const c = stack.pop()!;
      const x = c % map.w;
      const z = (c / map.w) | 0;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= map.w || nz >= map.h) continue;
          const k = nz * map.w + nx;
          if (map.cellPassable[k] && comp[k] < 0) {
            comp[k] = id;
            stack.push(k);
          }
        }
    }
    id++;
  }
  return comp;
}

describe('geography', () => {
  it('classifies well-known seas and land', () => {
    expect(isSea(51.5, 27.0)).toBe(true); // Persian Gulf
    expect(isSea(51.0, 39.0)).toBe(true); // Caspian
    expect(isSea(38.5, 21.0)).toBe(true); // Red Sea
    expect(isSea(46.7, 24.7)).toBe(false); // Riyadh
    expect(isSea(51.4, 35.7)).toBe(false); // Tehran
    expect(isSea(33.2, 35.1)).toBe(false); // Cyprus (island)
  });

  it('connects all start regions, oil fields and cities by land', () => {
    const comp = components();
    const at = (ll: readonly [number, number]) => {
      const w = lonLatToWorld(ll[0], ll[1]);
      const c = worldToCell(w.x, w.z);
      const p = nearestPassable(map, c.cx, c.cz);
      return comp[p.cz * map.w + p.cx];
    };
    const main = at(START_REGIONS[0].ll);
    for (const r of START_REGIONS) expect(at(r.ll), r.id).toBe(main);
    for (const o of OIL_FIELDS) expect(at(o.ll), o.id).toBe(main);
    for (const c of CITIES) expect(at(c.ll), c.id).toBe(main);
  });
});
