import * as THREE from 'three';

/**
 * Pooled GPU point-sprite particle system. Two layers: additive (fire/sparks) and alpha (smoke/dust).
 * CPU-side simulation, one draw call per layer.
 */
class ParticleLayer {
  readonly points: THREE.Points;
  private max: number;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size0: Float32Array;
  private size1: Float32Array;
  private alpha0: Float32Array;
  private col0: Float32Array;
  private col1: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private cursor = 0;
  private alive = 0;
  private geo: THREE.BufferGeometry;

  constructor(max: number, additive: boolean) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.col0 = new Float32Array(max * 3);
    this.col1 = new Float32Array(max * 3);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { scale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute float size; attribute float alpha; attribute vec3 color;
        uniform float scale;
        varying float vAlpha; varying vec3 vColor;
        void main() {
          vAlpha = alpha; vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / max(-mv.z, 0.1);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha; varying vec3 vColor;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c) * 2.0;
          float a = smoothstep(1.0, 0.0, d);
          a *= a;
          if (a * vAlpha < 0.004) discard;
          gl_FragColor = vec4(vColor, a * vAlpha);
        }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 7 : 6;
  }

  setScale(s: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.scale.value = s;
  }

  emit(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    life: number, s0: number, s1: number, a0: number,
    c0: THREE.Color, c1: THREE.Color, grav: number, drag: number,
  ) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    if (this.life[i] <= 0) this.alive++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size0[i] = s0;
    this.size1[i] = s1;
    this.alpha0[i] = a0;
    this.col0[i * 3] = c0.r;
    this.col0[i * 3 + 1] = c0.g;
    this.col0[i * 3 + 2] = c0.b;
    this.col1[i * 3] = c1.r;
    this.col1[i * 3 + 1] = c1.g;
    this.col1[i * 3 + 2] = c1.b;
    this.grav[i] = grav;
    this.drag[i] = drag;
  }

  update(dt: number, wind: THREE.Vector3) {
    if (this.alive <= 0) return;
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      alive++;
      const t = 1 - this.life[i] / this.maxLife[i];
      const d = Math.max(0, 1 - this.drag[i] * dt);
      const i3 = i * 3;
      this.vel[i3] = this.vel[i3] * d + wind.x * dt;
      this.vel[i3 + 1] = this.vel[i3 + 1] * d - this.grav[i] * dt;
      this.vel[i3 + 2] = this.vel[i3 + 2] * d + wind.z * dt;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      this.size[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      // Fade in quickly, fade out smoothly
      this.alpha[i] = this.alpha0[i] * Math.min(1, t * 8) * (1 - t * t);
      this.col[i3] = this.col0[i3] + (this.col1[i3] - this.col0[i3]) * t;
      this.col[i3 + 1] = this.col0[i3 + 1] + (this.col1[i3 + 1] - this.col0[i3 + 1]) * t;
      this.col[i3 + 2] = this.col0[i3 + 2] + (this.col1[i3 + 2] - this.col0[i3 + 2]) * t;
    }
    this.alive = alive;
    for (const name of ['position', 'color', 'size', 'alpha']) (this.geo.attributes[name] as THREE.BufferAttribute).needsUpdate = true;
  }
}

const C = (hex: number) => new THREE.Color(hex);
const FIRE0 = C(0xfff2b0);
const FIRE1 = C(0xff5a10);
const FLASH = C(0xfff6d8);
const SMOKE0 = C(0x4a4038);
const SMOKE1 = C(0x8d8478);
const BLACK0 = C(0x141210);
const BLACK1 = C(0x3a3632);
const DUST0 = C(0xc9ab7a);
const DUST1 = C(0xd8c39c);
const STEAM0 = C(0xf2f2f2);
const STEAM1 = C(0xc8c8c8);
const SPARK = C(0xffc060);
const TRAIL0 = C(0xd8d2c8);
const TRAIL1 = C(0xa8a29a);
const r = Math.random;
const rs = () => r() * 2 - 1;

export class Particles {
  readonly group = new THREE.Group();
  private fire: ParticleLayer;
  private smoke: ParticleLayer;
  readonly wind = new THREE.Vector3(0.6, 0, 0.25);
  /** Global density multiplier (quality setting). */
  density = 1;

  constructor(maxFire = 2500, maxSmoke = 3500) {
    this.fire = new ParticleLayer(maxFire, true);
    this.smoke = new ParticleLayer(maxSmoke, false);
    this.group.add(this.smoke.points, this.fire.points);
  }

  setViewportHeight(h: number) {
    const s = h * 0.9;
    this.fire.setScale(s);
    this.smoke.setScale(s);
  }

  update(dt: number) {
    this.fire.update(dt, this.wind);
    this.smoke.update(dt, this.wind);
  }

  private n(count: number) {
    return Math.max(1, Math.round(count * this.density));
  }

  muzzle(p: THREE.Vector3, dir: THREE.Vector3, big = false) {
    const s = big ? 1.6 : 0.6;
    this.fire.emit(p.x, p.y, p.z, dir.x * 2, dir.y * 2, dir.z * 2, 0.08, s, s * 1.4, 1, FLASH, FIRE1, 0, 0);
    if (big) {
      for (let i = 0; i < this.n(4); i++)
        this.smoke.emit(p.x, p.y, p.z, dir.x * 3 + rs(), 0.6 + r(), dir.z * 3 + rs(), 1.2, 0.8, 2.4, 0.5, SMOKE1, TRAIL1, -0.3, 1.5);
    }
  }

  explosion(p: THREE.Vector3, scale = 1) {
    const n = this.n(10 * scale + 6);
    for (let i = 0; i < n; i++) {
      const sp = 3 * scale;
      this.fire.emit(p.x + rs() * 0.3 * scale, p.y + r() * 0.5, p.z + rs() * 0.3 * scale, rs() * sp, r() * sp * 1.2, rs() * sp, 0.35 + r() * 0.35, 1.4 * scale, 2.8 * scale, 1, FIRE0, FIRE1, -1, 3);
    }
    for (let i = 0; i < this.n(8 * scale + 4); i++) {
      const sp = 2.2 * scale;
      this.smoke.emit(p.x + rs() * scale, p.y + r() * scale, p.z + rs() * scale, rs() * sp, 1 + r() * 2.5 * scale, rs() * sp, 1.8 + r() * 1.6, 1.5 * scale, 5 * scale, 0.75, BLACK0, SMOKE1, -0.4, 1.2);
    }
    for (let i = 0; i < this.n(6 * scale); i++) {
      this.fire.emit(p.x, p.y + 0.3, p.z, rs() * 8, 4 + r() * 8, rs() * 8, 0.6 + r() * 0.5, 0.25, 0.1, 1, SPARK, FIRE1, 14, 0.5);
    }
    for (let i = 0; i < this.n(5 * scale); i++) {
      this.smoke.emit(p.x, p.y, p.z, rs() * 5, 0.5 + r() * 1.5, rs() * 5, 1 + r(), 1, 3 * scale, 0.5, DUST0, DUST1, 0.5, 2);
    }
  }

  /** Ground impact (bullets, shells into sand). */
  impact(p: THREE.Vector3, small = true) {
    for (let i = 0; i < this.n(small ? 2 : 6); i++)
      this.smoke.emit(p.x, p.y + 0.1, p.z, rs() * 1.5, 1 + r() * 2, rs() * 1.5, 0.6 + r() * 0.5, 0.3, small ? 1 : 2.4, 0.6, DUST0, DUST1, 2, 2);
    if (!small) this.fire.emit(p.x, p.y + 0.3, p.z, 0, 1, 0, 0.12, 1.5, 2, 1, FLASH, FIRE1, 0, 0);
  }

  trail(p: THREE.Vector3, hot = true) {
    if (hot) this.fire.emit(p.x, p.y, p.z, rs() * 0.3, rs() * 0.3, rs() * 0.3, 0.12, 0.6, 0.2, 1, FIRE0, FIRE1, 0, 0);
    this.smoke.emit(p.x, p.y, p.z, rs() * 0.4, 0.3 + r() * 0.3, rs() * 0.4, 1.2 + r() * 0.8, 0.4, 1.8, 0.45, TRAIL0, TRAIL1, -0.2, 0.8);
  }

  bigTrail(p: THREE.Vector3) {
    this.fire.emit(p.x, p.y, p.z, rs(), rs(), rs(), 0.25, 2.5, 1, 1, FIRE0, FIRE1, 0, 0);
    for (let i = 0; i < this.n(2); i++)
      this.smoke.emit(p.x + rs(), p.y, p.z + rs(), rs() * 0.8, rs() * 0.5, rs() * 0.8, 3 + r() * 2, 1.5, 6, 0.55, TRAIL0, TRAIL1, -0.1, 0.3);
  }

  burning(p: THREE.Vector3, intensity = 1, black = false) {
    if (r() < 0.6 * intensity) this.fire.emit(p.x + rs() * 0.5, p.y + r() * 0.4, p.z + rs() * 0.5, rs() * 0.3, 1.5 + r() * 1.5, rs() * 0.3, 0.5 + r() * 0.3, 1.0 * intensity, 0.3, 0.9, FIRE0, FIRE1, -1, 0.5);
    if (r() < 0.5 * intensity)
      this.smoke.emit(p.x + rs() * 0.4, p.y + 0.8, p.z + rs() * 0.4, rs() * 0.3, 1.8 + r(), rs() * 0.3, 3 + r() * 2, 0.8 * intensity, 3.6 * intensity, black ? 0.42 : 0.38, black ? BLACK0 : SMOKE0, black ? SMOKE1 : SMOKE1, -0.15, 0.4);
  }

  steam(p: THREE.Vector3) {
    if (r() < 0.35 * this.density)
      this.smoke.emit(p.x + rs() * 0.3, p.y, p.z + rs() * 0.3, rs() * 0.2, 1.5 + r() * 0.5, rs() * 0.2, 3 + r() * 2, 1.4, 4.5, 0.35, STEAM0, STEAM1, -0.1, 0.3);
  }

  chimney(p: THREE.Vector3) {
    if (r() < 0.25 * this.density)
      this.smoke.emit(p.x, p.y, p.z, rs() * 0.2, 1.2 + r() * 0.5, rs() * 0.2, 3, 0.6, 3, 0.4, SMOKE0, SMOKE1, -0.1, 0.3);
  }

  flare(p: THREE.Vector3) {
    if (r() < 0.8) this.fire.emit(p.x + rs() * 0.1, p.y, p.z + rs() * 0.1, rs() * 0.2, 1.8 + r(), rs() * 0.2, 0.35 + r() * 0.2, 0.9, 0.2, 1, FIRE0, FIRE1, -1, 0.3);
    if (r() < 0.1 * this.density) this.smoke.emit(p.x, p.y + 1.2, p.z, 0, 1, 0, 2.5, 0.5, 2, 0.3, BLACK0, BLACK1, -0.1, 0.3);
  }

  dust(p: THREE.Vector3, amount = 1) {
    if (r() < 0.4 * amount * this.density)
      this.smoke.emit(p.x + rs() * 0.4, p.y + 0.1, p.z + rs() * 0.4, rs() * 0.3, 0.3 + r() * 0.4, rs() * 0.3, 0.9 + r() * 0.5, 0.5, 1.8, 0.4, DUST0, DUST1, 0, 1);
  }

  /** Construction dust puff. */
  build(p: THREE.Vector3, size: number) {
    for (let i = 0; i < this.n(2); i++)
      this.smoke.emit(p.x + rs() * size, p.y + 0.2, p.z + rs() * size, rs() * 0.5, 0.6 + r(), rs() * 0.5, 1.2, 0.6, 2.2, 0.45, DUST0, DUST1, 0, 1);
  }

  sandstorm(center: THREE.Vector3, radius: number) {
    for (let i = 0; i < this.n(6); i++) {
      this.smoke.emit(
        center.x + rs() * radius, center.y + r() * 12, center.z + rs() * radius,
        6 + r() * 4, rs() * 0.5, 2 + r() * 2,
        2.5 + r() * 2, 6, 14, 0.25, DUST0, DUST1, 0, 0,
      );
    }
  }
}
