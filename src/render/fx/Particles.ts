/**
 * Pooled point-sprite particles: an additive layer (fire, flashes, exhaust, sparks)
 * and an alpha layer (smoke, dust, steam). CPU simulated, one draw call per layer.
 * Sizes are in km; point size is derived from the real projection so it is correct on
 * every screen and pixel ratio.
 */
import * as THREE from 'three';

class Layer {
  readonly points: THREE.Points;
  private n: number;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private a0: Float32Array;
  private c0: Float32Array;
  private c1: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private cursor = 0;
  private live = 0;
  private geo = new THREE.BufferGeometry();

  constructor(n: number, additive: boolean) {
    this.n = n;
    const f = (k = 1) => new Float32Array(n * k);
    this.pos = f(3);
    this.col = f(3);
    this.size = f();
    this.alpha = f();
    this.vel = f(3);
    this.life = f();
    this.max = f();
    this.s0 = f();
    this.s1 = f();
    this.a0 = f();
    this.c0 = f(3);
    this.c1 = f(3);
    this.grav = f();
    this.drag = f();
    const attr = (a: Float32Array, k: number) => new THREE.BufferAttribute(a, k).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', attr(this.pos, 3));
    this.geo.setAttribute('color', attr(this.col, 3));
    this.geo.setAttribute('size', attr(this.size, 1));
    this.geo.setAttribute('alpha', attr(this.alpha, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 600 }, uFogColor: { value: new THREE.Color() }, uFogNear: { value: 1 }, uFogFar: { value: 2 } },
      vertexShader: /* glsl */ `
        attribute float size; attribute float alpha; attribute vec3 color;
        uniform float uScale;
        varying float vAlpha; varying vec3 vColor; varying float vDepth;
        void main() {
          vAlpha = alpha; vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vDepth = -mv.z;
          gl_PointSize = clamp(size * uScale / max(-mv.z, 0.001), 0.0, 900.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;
        varying float vAlpha; varying vec3 vColor; varying float vDepth;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c) * 2.0;
          float a = smoothstep(1.0, 0.0, d);
          a *= a;
          float fogK = smoothstep(uFogNear, uFogFar, vDepth);
          vec3 col = mix(vColor, uFogColor, fogK * ${additive ? '0.0' : '1.0'});
          float fa = a * vAlpha * (1.0 - fogK * ${additive ? '1.0' : '0.0'});
          if (fa < 0.004) discard;
          gl_FragColor = vec4(col, fa);
        }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 8 : 7;
  }

  setView(scale: number, fog: THREE.Fog) {
    const u = (this.points.material as THREE.ShaderMaterial).uniforms;
    u.uScale.value = scale;
    u.uFogColor.value.copy(fog.color);
    u.uFogNear.value = fog.near;
    u.uFogFar.value = fog.far;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, a0: number, c0: THREE.Color, c1: THREE.Color, grav = 0, drag = 0) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    if (this.life[i] <= 0) this.live++;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.life[i] = life;
    this.max[i] = life;
    this.s0[i] = s0;
    this.s1[i] = s1;
    this.a0[i] = a0;
    this.c0[i3] = c0.r;
    this.c0[i3 + 1] = c0.g;
    this.c0[i3 + 2] = c0.b;
    this.c1[i3] = c1.r;
    this.c1[i3 + 1] = c1.g;
    this.c1[i3 + 2] = c1.b;
    this.grav[i] = grav;
    this.drag[i] = drag;
  }

  update(dt: number, wx: number, wz: number) {
    if (this.live <= 0) return;
    let live = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      live++;
      const t = 1 - this.life[i] / this.max[i];
      const d = Math.max(0, 1 - this.drag[i] * dt);
      const i3 = i * 3;
      this.vel[i3] = this.vel[i3] * d + wx * dt;
      this.vel[i3 + 1] = this.vel[i3 + 1] * d - this.grav[i] * dt;
      this.vel[i3 + 2] = this.vel[i3 + 2] * d + wz * dt;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.alpha[i] = this.a0[i] * Math.min(1, t * 10) * (1 - t * t);
      this.col[i3] = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * t;
      this.col[i3 + 1] = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * t;
      this.col[i3 + 2] = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * t;
    }
    this.live = live;
    for (const k of ['position', 'color', 'size', 'alpha']) (this.geo.attributes[k] as THREE.BufferAttribute).needsUpdate = true;
  }
}

const C = (hex: number) => new THREE.Color(hex);
export const COL = {
  fire0: C(0xfff0b0),
  fire1: C(0xff4a0a),
  flash: C(0xfff6dc),
  smoke0: C(0x433a33),
  smoke1: C(0x8e877c),
  black0: C(0x121110),
  black1: C(0x3c3833),
  dust0: C(0xc2a578),
  dust1: C(0xd6c29e),
  steam0: C(0xf4f4f4),
  steam1: C(0xcfd2d4),
  spark: C(0xffc864),
  trail0: C(0xe8e4dc),
  trail1: C(0xb2aca2),
  exhaust: C(0xffd890),
  plasma: C(0x9fe4ff),
  laser: C(0x7ff2ff),
  intercept: C(0xfff4c8),
};

const rnd = Math.random;
const rs = () => rnd() * 2 - 1;

export class Particles {
  readonly group = new THREE.Group();
  readonly add: Layer;
  readonly alpha: Layer;
  density = 1;
  wind = new THREE.Vector2(0.004, 0.002);

  constructor(max = 9000) {
    this.add = new Layer(Math.floor(max * 0.45), true);
    this.alpha = new Layer(Math.floor(max * 0.55), false);
    this.group.add(this.alpha.points, this.add.points);
  }

  setView(camera: THREE.PerspectiveCamera, viewportH: number, fog: THREE.Fog) {
    const scale = viewportH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    this.add.setView(scale, fog);
    this.alpha.setView(scale, fog);
  }

  update(dt: number) {
    this.add.update(dt, this.wind.x, this.wind.y);
    this.alpha.update(dt, this.wind.x, this.wind.y);
  }

  private n(base: number) {
    return Math.max(1, Math.round(base * this.density));
  }

  /** Fireball + smoke column + sparks + dust ring. `s` is a size in km. */
  explosion(x: number, y: number, z: number, s: number, ground = true) {
    for (let i = 0; i < this.n(10); i++)
      this.add.emit(x + rs() * s * 0.2, y + rnd() * s * 0.3, z + rs() * s * 0.2, rs() * s * 1.2, rnd() * s * 1.6, rs() * s * 1.2, 0.35 + rnd() * 0.35, s * 0.5, s * 1.4, 1, COL.fire0, COL.fire1, 0, 3);
    this.add.emit(x, y + s * 0.2, z, 0, 0, 0, 0.1, s * 1.3, s * 1.8, 0.8, COL.flash, COL.fire1);
    for (let i = 0; i < this.n(10); i++)
      this.alpha.emit(x + rs() * s * 0.3, y + rnd() * s * 0.4, z + rs() * s * 0.3, rs() * s * 0.4, s * (0.5 + rnd() * 0.9), rs() * s * 0.4, 2.2 + rnd() * 2.5, s * 0.7, s * 2.6, 0.75, COL.black0, COL.smoke1, -s * 0.05, 1.1);
    for (let i = 0; i < this.n(12); i++)
      this.add.emit(x, y + s * 0.1, z, rs() * s * 6, rnd() * s * 6, rs() * s * 6, 0.4 + rnd() * 0.5, s * 0.06, s * 0.02, 1, COL.spark, COL.fire1, s * 9, 0.8);
    if (ground)
      for (let i = 0; i < this.n(8); i++) {
        const a = rnd() * Math.PI * 2;
        this.alpha.emit(x, y + s * 0.05, z, Math.cos(a) * s * 2.2, s * 0.2, Math.sin(a) * s * 2.2, 1 + rnd(), s * 0.5, s * 1.6, 0.5, COL.dust0, COL.dust1, 0, 2.2);
      }
  }

  /** Mid-air intercept: white flash and a drifting puff, no ground effects. */
  airburst(x: number, y: number, z: number, s: number) {
    this.add.emit(x, y, z, 0, 0, 0, 0.16, s * 1.2, s * 2, 0.85, COL.intercept, COL.fire1);
    for (let i = 0; i < this.n(6); i++) this.add.emit(x, y, z, rs() * s * 3, rs() * s * 3, rs() * s * 3, 0.5, s * 0.08, s * 0.03, 1, COL.spark, COL.fire1, s * 4, 0.5);
    for (let i = 0; i < this.n(5); i++) this.alpha.emit(x + rs() * s * 0.3, y, z + rs() * s * 0.3, rs() * s * 0.2, rs() * s * 0.2, rs() * s * 0.2, 3 + rnd() * 2, s * 0.6, s * 2, 0.55, COL.smoke1, COL.steam1, 0, 0.6);
  }

  muzzle(x: number, y: number, z: number, s: number, smoke = false) {
    this.add.emit(x, y, z, 0, 0, 0, 0.06, s, s * 1.4, 1, COL.flash, COL.fire1);
    if (smoke) for (let i = 0; i < this.n(3); i++) this.alpha.emit(x, y, z, rs() * s * 0.6, s * 0.5, rs() * s * 0.6, 1.2 + rnd(), s * 0.8, s * 2.4, 0.5, COL.smoke1, COL.dust1, 0, 1.5);
  }

  /** Smoke trail puff (missiles). */
  trail(x: number, y: number, z: number, s: number, life = 1.6, alpha = 0.55) {
    this.alpha.emit(x + rs() * s * 0.1, y, z + rs() * s * 0.1, rs() * s * 0.05, s * 0.1, rs() * s * 0.05, life, s * 0.5, s * 1.8, alpha, COL.trail0, COL.trail1, 0, 0.6);
  }

  exhaust(x: number, y: number, z: number, s: number) {
    this.add.emit(x, y, z, 0, 0, 0, 0.05, s, s * 0.4, 1, COL.exhaust, COL.fire1);
  }

  burning(x: number, y: number, z: number, s: number) {
    if (rnd() < 0.6) this.add.emit(x + rs() * s * 0.3, y, z + rs() * s * 0.3, rs() * s * 0.1, s * (0.6 + rnd()), rs() * s * 0.1, 0.5 + rnd() * 0.4, s * 0.5, s * 0.15, 0.9, COL.fire0, COL.fire1, -s * 0.2, 0.5);
    this.alpha.emit(x + rs() * s * 0.3, y + s * 0.3, z + rs() * s * 0.3, rs() * s * 0.1, s * (0.8 + rnd() * 0.6), rs() * s * 0.1, 3 + rnd() * 2, s * 0.5, s * 2.8, 0.55, COL.black0, COL.black1, -s * 0.03, 0.4);
  }

  smoke(x: number, y: number, z: number, s: number, dark = false) {
    this.alpha.emit(x + rs() * s * 0.1, y, z + rs() * s * 0.1, rs() * s * 0.08, s * (0.6 + rnd() * 0.4), rs() * s * 0.08, 3 + rnd() * 2, s * 0.4, s * 2.2, dark ? 0.55 : 0.35, dark ? COL.black0 : COL.smoke1, dark ? COL.black1 : COL.steam1, 0, 0.4);
  }

  steam(x: number, y: number, z: number, s: number) {
    this.alpha.emit(x + rs() * s * 0.1, y, z + rs() * s * 0.1, rs() * s * 0.08, s * (0.5 + rnd() * 0.4), rs() * s * 0.08, 3 + rnd() * 2, s * 0.6, s * 2.6, 0.4, COL.steam0, COL.steam1, 0, 0.4);
  }

  flare(x: number, y: number, z: number, s: number) {
    this.add.emit(x + rs() * s * 0.1, y, z + rs() * s * 0.1, 0, s * (1 + rnd()), 0, 0.35 + rnd() * 0.2, s * 0.6, s * 0.2, 1, COL.fire0, COL.fire1, 0, 1);
  }

  dust(x: number, y: number, z: number, s: number) {
    this.alpha.emit(x + rs() * s * 0.3, y, z + rs() * s * 0.3, rs() * s * 0.2, s * 0.3, rs() * s * 0.2, 1.2 + rnd(), s * 0.4, s * 1.4, 0.32, COL.dust0, COL.dust1, 0, 1.6);
  }
}
