/**
 * Theater projection. World space is kilometres: +x east, +z south, origin at the
 * north-west corner. Web Mercator scaled by cos(27°) so distances are true near the
 * middle of the map (within ~15% at the edges). Web Mercator keeps us aligned with
 * slippy-map tiles (elevation + imagery), which is how terrain detail is streamed.
 *
 * Shared by the game and scripts/bake-geo.ts. Uses Math.* freely: never called from
 * the deterministic simulation at runtime except through precomputed constants.
 */

export const LON_MIN = 24;
export const LON_MAX = 64;
export const LAT_MIN = 11;
export const LAT_MAX = 43;

export const EARTH_R = 6371.0088;
const REF_LAT = 27;
export const K = Math.cos((REF_LAT * Math.PI) / 180);

const mx = (lon: number) => EARTH_R * ((lon * Math.PI) / 180);
const my = (lat: number) => EARTH_R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

const MX0 = mx(LON_MIN);
const MY0 = my(LAT_MAX);

/** World size in km. */
export const WORLD_W = (mx(LON_MAX) - MX0) * K;
export const WORLD_H = (MY0 - my(LAT_MIN)) * K;

/** Simulation grid: 4 km cells. */
export const CELL = 4;
export const GRID_W = Math.ceil(WORLD_W / CELL);
export const GRID_H = Math.ceil(WORLD_H / CELL);

export function lonLatToWorld(lon: number, lat: number): { x: number; z: number } {
  return { x: (mx(lon) - MX0) * K, z: (MY0 - my(lat)) * K };
}

export function worldToLonLat(x: number, z: number): { lon: number; lat: number } {
  const lon = ((x / K + MX0) / EARTH_R) * (180 / Math.PI);
  const yy = MY0 - z / K;
  const lat = (2 * Math.atan(Math.exp(yy / EARTH_R)) - Math.PI / 2) * (180 / Math.PI);
  return { lon, lat };
}

/** Slippy-map tile coordinate (fractional) for a world point at zoom z. */
export function worldToTile(x: number, zz: number, zoom: number): { tx: number; ty: number } {
  const { lon, lat } = worldToLonLat(x, zz);
  const n = 2 ** zoom;
  const latR = (lat * Math.PI) / 180;
  return {
    tx: ((lon + 180) / 360) * n,
    ty: ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n,
  };
}

/** World-space rectangle covered by slippy tile (tx, ty, zoom). Mercator → linear in world. */
export function tileToWorldRect(tx: number, ty: number, zoom: number) {
  const n = 2 ** zoom;
  const lon0 = (tx / n) * 360 - 180;
  const lon1 = ((tx + 1) / n) * 360 - 180;
  const lat0 = (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI;
  const lat1 = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + 1)) / n))) * 180) / Math.PI;
  const a = lonLatToWorld(lon0, lat0);
  const b = lonLatToWorld(lon1, lat1);
  return { x0: a.x, z0: a.z, x1: b.x, z1: b.z };
}

/** Real-world km per world unit at a given world z (Mercator scale error). */
export function kmScaleAt(z: number) {
  const { lat } = worldToLonLat(0, z);
  return Math.cos((lat * Math.PI) / 180) / K;
}
