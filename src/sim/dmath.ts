/**
 * Deterministic math for the lockstep simulation.
 *
 * JS guarantees IEEE-754 double semantics for + - * / and Math.sqrt (correctly rounded),
 * but Math.sin/cos/atan2/hypot/pow/exp are implementation-defined and differ between
 * V8, SpiderMonkey and JavaScriptCore. Every peer must compute bit-identical state, so
 * the simulation uses only these functions. tests/determinism.test.ts enforces this.
 */

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;
const INV_TAU = 0.15915494309189535;

/** Wrap angle to [-PI, PI]. */
export function wrap(a: number): number {
  return a - TAU * Math.round(a * INV_TAU);
}

/** sin for |x| <= PI/2 (Taylor/minimax to x^13, |err| < 1e-12). */
function sinPoly(x: number): number {
  const x2 = x * x;
  return x * (1 + x2 * (-0.16666666666666666 + x2 * (0.008333333333333333 + x2 * (-0.0001984126984126984 + x2 * (2.7557319223985893e-6 + x2 * (-2.505210838544172e-8 + x2 * 1.6059043836821613e-10))))));
}

export function sin(a: number): number {
  let x = wrap(a);
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  return sinPoly(x);
}

export function cos(a: number): number {
  return sin(a + HALF_PI);
}

/** atan (Cephes atanf reduction + polynomial, |err| < 2e-7). */
export function atan(x: number): number {
  let sign = 1;
  if (x < 0) {
    sign = -1;
    x = -x;
  }
  let base = 0;
  if (x > 2.414213562373095) {
    base = HALF_PI;
    x = -1 / x;
  } else if (x > 0.4142135623730951) {
    base = 0.7853981633974483;
    x = (x - 1) / (x + 1);
  }
  const z = x * x;
  const r = ((((8.05374449538e-2 * z - 1.38776856032e-1) * z + 1.99777106478e-1) * z - 3.33329491539e-1) * z * x + x);
  return sign * (base + r);
}

export function atan2(y: number, x: number): number {
  if (x > 0) return atan(y / x);
  if (x < 0) return y >= 0 ? atan(y / x) + PI : atan(y / x) - PI;
  if (y > 0) return HALF_PI;
  if (y < 0) return -HALF_PI;
  return 0;
}

export const sqrt = Math.sqrt;

export function len(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}

export function dist(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  return Math.sqrt(dx * dx + dz * dz);
}

export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  return dx * dx + dz * dz;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Signed shortest angular difference b - a in [-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  return wrap(b - a);
}

export function turnToward(current: number, target: number, maxStep: number): number {
  const d = wrap(target - current);
  if (d <= maxStep && d >= -maxStep) return wrap(current + d);
  return wrap(current + (d > 0 ? maxStep : -maxStep));
}

/** Heading convention: 0 = +z (south), PI/2 = +x (east). */
export function headingTo(ax: number, az: number, bx: number, bz: number): number {
  return atan2(bx - ax, bz - az);
}

/** Rounds to 1e-6 so values crossing the wire or the hash are stable. */
export function q6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}
