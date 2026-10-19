import type { World } from './world';

/**
 * 32-bit checksum of the simulation state. Peers exchange it periodically; any
 * mismatch means a desync. Hashes the exact float bits, so it is very sensitive.
 */
export function stateHash(w: World): number {
  const buf = new DataView(new ArrayBuffer(8));
  let h = 0x811c9dc5 ^ w.tick;
  const mix = (v: number) => {
    if (v === Infinity) v = 1e300;
    buf.setFloat64(0, v);
    h = Math.imul(h ^ buf.getUint32(0), 0x01000193);
    h = Math.imul(h ^ buf.getUint32(4), 0x01000193);
  };
  for (const u of w.units) {
    mix(u.id);
    mix(u.x);
    mix(u.z);
    mix(u.hp);
    mix(u.heading);
  }
  for (const b of w.buildings) {
    mix(b.id);
    mix(b.hp);
    mix(b.progress);
    mix(b.queue.length);
  }
  for (const p of w.projectiles) {
    mix(p.id);
    mix(p.x);
    mix(p.z);
  }
  for (const c of w.countries) {
    mix(c.funds);
    mix(c.oil);
    mix(c.stability);
  }
  for (const c of w.cities) {
    mix(c.owner);
    mix(c.garrison);
  }
  for (const s of w.rng.state()) mix(s);
  mix(w.market.price);
  return h >>> 0;
}
