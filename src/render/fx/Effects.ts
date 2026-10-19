/**
 * Turns simulation events and live projectiles into visuals: muzzle flashes, tracers,
 * laser beams, missile bodies with smoke trails, ballistic missile plumes and long arcs
 * (visible from the strategic map), explosions with light, shockwaves and scorch marks.
 */
import * as THREE from 'three';
import type { SimEvent, World } from '../../sim/world';
import type { Projectile } from '../../sim/entities';
import { WEAPONS, type SfxName } from '../../sim/defs';
import type { Terrain } from '../terrain/Terrain';
import { Particles, COL } from './Particles';
import { visAlt } from '../EntityRenderer';

const MAX_TRACERS = 600;

export class Effects {
  readonly group = new THREE.Group();
  readonly particles: Particles;
  private tracerGeo = new THREE.BufferGeometry();
  private tracerPos = new Float32Array(MAX_TRACERS * 6);
  private tracerCol = new Float32Array(MAX_TRACERS * 6);
  private tracers: { ax: number; ay: number; az: number; bx: number; by: number; bz: number; t: number; life: number; c: THREE.Color; grow: boolean }[] = [];
  private missiles: THREE.InstancedMesh;
  private glows: THREE.InstancedMesh;
  private lights: THREE.PointLight[] = [];
  private lightT: number[] = [];
  private rings: { mesh: THREE.Mesh; t: number; life: number; r: number }[] = [];
  private ringGeo = new THREE.RingGeometry(0.85, 1, 48);
  private scorch: THREE.InstancedMesh;
  private scorchAge: number[] = [];
  private scorchNext = 0;
  /** Ballistic missile arc history: projectile id → points. */
  private arcs = new Map<number, { pts: number[]; age: number; done: boolean }>();
  private arcLine: THREE.LineSegments;
  private arcPos = new Float32Array(30000);
  private arcCol = new Float32Array(30000);
  scale = 1;
  camDist = 10;
  onSound: (s: SfxName, x: number, z: number, v?: number) => void = () => {};
  onShake: (amount: number, x: number, z: number) => void = () => {};

  constructor(
    readonly world: World,
    readonly terrain: Terrain,
    readonly local: number,
    density: number,
  ) {
    this.particles = new Particles(Math.round(9000 * Math.max(0.4, density)));
    this.particles.density = density;
    this.group.add(this.particles.group);
    // Tracers
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracerGeo.setAttribute('color', new THREE.BufferAttribute(this.tracerCol, 3).setUsage(THREE.DynamicDrawUsage));
    const tracerMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
    const tracerLines = new THREE.LineSegments(this.tracerGeo, tracerMat);
    tracerLines.frustumCulled = false;
    tracerLines.renderOrder = 9;
    this.group.add(tracerLines);
    // Missile bodies + exhaust glows
    const mg = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
    mg.rotateX(Math.PI / 2);
    const nose = new THREE.ConeGeometry(0.5, 0.6, 6);
    nose.rotateX(Math.PI / 2);
    nose.translate(0, 0, 0.8);
    const missileGeo = mergeSimple([mg, nose]);
    this.missiles = new THREE.InstancedMesh(missileGeo, new THREE.MeshStandardMaterial({ color: 0xdedcd4, roughness: 0.5, metalness: 0.3 }), 512);
    this.missiles.frustumCulled = false;
    this.missiles.count = 0;
    this.group.add(this.missiles);
    const glowTex = radialTexture();
    this.glows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }), 1024);
    this.glows.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(1024 * 3), 3);
    this.glows.frustumCulled = false;
    this.glows.count = 0;
    this.glows.renderOrder = 10;
    this.group.add(this.glows);
    for (let i = 0; i < 5; i++) {
      const l = new THREE.PointLight(0xffa860, 0, 1, 2);
      this.lights.push(l);
      this.lightT.push(0);
      this.group.add(l);
    }
    // Scorch decals
    const sg = new THREE.CircleGeometry(1, 20);
    sg.rotateX(-Math.PI / 2);
    this.scorch = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ color: 0x0e0b08, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), 220);
    this.scorch.frustumCulled = false;
    this.scorch.count = 0;
    this.scorch.renderOrder = 2;
    this.group.add(this.scorch);
    // Ballistic arcs
    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.BufferAttribute(this.arcPos, 3).setUsage(THREE.DynamicDrawUsage));
    ag.setAttribute('color', new THREE.BufferAttribute(this.arcCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.arcLine = new THREE.LineSegments(ag, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
    this.arcLine.frustumCulled = false;
    this.arcLine.renderOrder = 9;
    this.group.add(this.arcLine);
  }

  private y(x: number, z: number) {
    return this.terrain.surfaceAt(x, z);
  }

  private visible(x: number, z: number, owner: number) {
    return owner === this.local || this.world.allied(this.local, owner) || this.world.visibleTo(this.local, x, z);
  }

  /** Feed one tick's events. */
  handle(events: SimEvent[]) {
    const k = this.scale;
    for (const e of events) {
      switch (e.t) {
        case 'fire': {
          if (!this.visible(e.x, e.z, e.owner) && !this.visible(e.tx, e.tz, e.owner)) break;
          const def = WEAPONS[e.w];
          const ax = e.x;
          const az = e.z;
          const ay = this.y(ax, az) + visAlt(e.y) * k + 0.01 * k;
          const bx = e.tx;
          const bz = e.tz;
          const by = this.y(bx, bz) + visAlt(e.ty) * k + 0.008 * k;
          if (!def) {
            // Militia small arms from a city
            this.tracer(ax, ay, az, bx, by, bz, 0.15, COL.spark);
            break;
          }
          const d = def.delivery;
          if (d === 'bullet' || d === 'flak') {
            const n = d === 'flak' ? 2 : 1;
            for (let i = 0; i < n; i++) this.tracer(ax, ay, az, bx + (Math.random() - 0.5) * 0.03, by + (Math.random() - 0.5) * 0.02, bz + (Math.random() - 0.5) * 0.03, 0.12, d === 'flak' ? COL.fire0 : COL.spark);
            this.particles.muzzle(ax, ay, az, 0.012 * k);
          } else if (d === 'laser') {
            this.tracer(ax, ay, az, bx, by, bz, 0.3, COL.laser, false);
            this.tracer(ax, ay + 0.002, az, bx, by, bz, 0.3, COL.plasma, false);
            this.particles.airburst(bx, by, bz, 0.02 * k);
          } else {
            const big = d === 'artillery' || d === 'rocket' || def.id === 'tankGun';
            this.particles.muzzle(ax, ay, az, (big ? 0.05 : 0.025) * k, d !== 'shell' || big);
          }
          this.onSound(def.sound, ax, az, d === 'bullet' ? 0.5 : 0.85);
          break;
        }
        case 'boom': {
          if (!this.visible(e.x, e.z, -1) && e.size < 2) break;
          const s = (0.05 + e.size * 0.07) * k;
          const gy = this.y(e.x, e.z);
          const y = gy + visAlt(e.y) * k;
          if (e.kind === 'intercept' || e.y > 0.05) {
            this.particles.airburst(e.x, y, e.z, s * 0.8);
            this.flash(e.x, y, e.z, s * 12, 0.25);
            this.onSound(e.size > 1 ? 'bigExplosion' : 'explosion', e.x, e.z, 0.5);
          } else {
            this.particles.explosion(e.x, gy, e.z, s, true);
            this.flash(e.x, gy + s, e.z, s * 16, 0.35);
            if (e.size >= 0.6) this.decal(e.x, gy, e.z, s * 1.4);
            if (e.size >= 1.4) this.ring(e.x, gy, e.z, s * 9);
            this.onSound(e.size >= 1.4 ? 'bigExplosion' : 'explosion', e.x, e.z, Math.min(1, 0.4 + e.size * 0.3));
            if (e.size >= 1.4) this.onShake(Math.min(1, e.size * 0.25), e.x, e.z);
          }
          break;
        }
        case 'death': {
          if (!this.visible(e.x, e.z, e.owner)) break;
          const gy = this.y(e.x, e.z);
          const big = !e.unit;
          const s = (big ? 0.12 : 0.06) * k;
          this.particles.explosion(e.x, gy, e.z, s, true);
          this.flash(e.x, gy + s, e.z, s * 18, 0.4);
          this.decal(e.x, gy, e.z, s * 1.6);
          if (big) {
            this.ring(e.x, gy, e.z, s * 8);
            for (let i = 0; i < 4; i++) this.particles.explosion(e.x + (Math.random() - 0.5) * 0.2, gy, e.z + (Math.random() - 0.5) * 0.2, s * 0.7, false);
            this.onShake(0.3, e.x, e.z);
          }
          this.onSound(big ? 'bigExplosion' : 'explosion', e.x, e.z, big ? 0.9 : 0.6);
          break;
        }
        case 'launch': {
          const gy = this.y(e.x, e.z);
          for (let i = 0; i < 14; i++) this.particles.smoke(e.x + (Math.random() - 0.5) * 0.1, gy + 0.02, e.z + (Math.random() - 0.5) * 0.1, 0.12 * k);
          this.flash(e.x, gy + 0.05, e.z, 2 * k, 0.6);
          this.arcs.set(e.id, { pts: [], age: 0, done: false });
          break;
        }
        case 'intercept':
          this.flash(e.x, this.y(e.x, e.z) + visAlt(e.y) * k, e.z, 3 * k, 0.4);
          this.onSound('intercept', e.x, e.z, 0.9);
          break;
      }
    }
  }

  private tracer(ax: number, ay: number, az: number, bx: number, by: number, bz: number, life: number, c: THREE.Color, grow = true) {
    if (this.tracers.length >= MAX_TRACERS) this.tracers.shift();
    this.tracers.push({ ax, ay, az, bx, by, bz, t: 0, life, c, grow });
  }

  private flash(x: number, y: number, z: number, range: number, life: number) {
    if (this.camDist > 80) return;
    let best = 0;
    for (let i = 1; i < this.lights.length; i++) if (this.lightT[i] < this.lightT[best]) best = i;
    const l = this.lights[best];
    l.position.set(x, y, z);
    l.distance = range;
    l.intensity = 0;
    l.userData.peak = Math.min(6, range * 2.5);
    l.userData.life = life;
    this.lightT[best] = life;
  }

  private ring(x: number, y: number, z: number, r: number) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y + 0.01, z);
    this.group.add(m);
    this.rings.push({ mesh: m, t: 0, life: 0.7, r });
  }

  private decal(x: number, y: number, z: number, r: number) {
    const i = this.scorchNext;
    this.scorchNext = (this.scorchNext + 1) % 220;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y + 0.002, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6), new THREE.Vector3(r, 1, r));
    this.scorch.setMatrixAt(i, m);
    this.scorchAge[i] = 0;
    this.scorch.count = Math.max(this.scorch.count, i + 1);
    this.scorch.instanceMatrix.needsUpdate = true;
  }

  /** Per frame: projectiles, tracers, lights, rings. */
  update(dt: number, alpha: number, camera: THREE.Camera) {
    const k = this.scale;
    // Lights
    for (let i = 0; i < this.lights.length; i++) {
      if (this.lightT[i] <= 0) {
        this.lights[i].intensity = 0;
        continue;
      }
      this.lightT[i] -= dt;
      const l = this.lights[i];
      const f = Math.max(0, this.lightT[i] / (l.userData.life as number));
      l.intensity = (l.userData.peak as number) * f * f;
    }
    // Rings
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const f = r.t / r.life;
      if (f >= 1) {
        this.group.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
        continue;
      }
      r.mesh.scale.setScalar(r.r * (0.2 + f));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - f) * 0.8;
    }
    // Projectiles
    const dummy = new THREE.Object3D();
    const glowM = new THREE.Matrix4();
    let mi = 0;
    let gi = 0;
    const camQ = camera.quaternion;
    const pushGlow = (x: number, y: number, z: number, s: number, c: THREE.Color) => {
      if (gi >= 1024) return;
      glowM.compose(new THREE.Vector3(x, y, z), camQ, new THREE.Vector3(s, s, s));
      this.glows.setMatrixAt(gi, glowM);
      this.glows.setColorAt(gi, c);
      gi++;
    };
    for (const p of this.world.projectiles) {
      if (!p.alive) continue;
      const strategic = p.delivery === 'warhead';
      if (!strategic && !this.visible(p.x, p.z, p.owner)) continue;
      const x = p.px + (p.x - p.px) * alpha;
      const z = p.pz + (p.z - p.pz) * alpha;
      const py = p.py + (p.y - p.py) * alpha;
      const y = this.y(x, z) + visAlt(py) * k + 0.006 * k;
      const ox = p.px;
      const oz = p.pz;
      const oy = this.y(ox, oz) + visAlt(p.py) * k + 0.006 * k;
      switch (p.delivery) {
        case 'shell':
          this.tracer(ox, oy, oz, x, y, z, 0.05, COL.spark, false);
          break;
        case 'artillery':
          pushGlow(x, y, z, 0.02 * k, COL.fire0);
          break;
        case 'rocket':
          pushGlow(x, y, z, 0.04 * k, COL.exhaust);
          this.particles.trail(x, y, z, 0.03 * k, 1.2, 0.35);
          break;
        default: {
          // Missile body aligned with travel direction.
          if (mi < 512) {
            const len = (strategic ? 0.14 : p.delivery === 'sam' ? 0.05 : 0.035) * k * (p.strike === 'ballistic' ? 1.6 : 1);
            dummy.position.set(x, y, z);
            dummy.lookAt(x + (x - ox), y + (y - oy), z + (z - oz));
            dummy.scale.set(len * 0.18, len * 0.18, len);
            dummy.updateMatrix();
            this.missiles.setMatrixAt(mi++, dummy.matrix);
          }
          const glowS = strategic ? (p.strike === 'cruise' ? 0.08 : 0.25) * k : 0.035 * k;
          pushGlow(x, y, z, glowS, p.strike === 'hypersonic' ? COL.plasma : COL.exhaust);
          if (p.delivery !== 'torpedo') {
            const n = strategic ? 2 : 1;
            for (let i = 0; i < n; i++) {
              const f = i / n;
              this.particles.trail(ox + (x - ox) * f, oy + (y - oy) * f, oz + (z - oz) * f, (strategic ? 0.08 : 0.025) * k, strategic ? 6 : 1.4, strategic ? 0.6 : 0.45);
            }
          }
          if (strategic && p.strike !== 'cruise') {
            const arc = this.arcs.get(p.id) ?? { pts: [], age: 0, done: false };
            arc.pts.push(x, y, z);
            if (arc.pts.length > 3000) arc.pts.splice(0, 3);
            this.arcs.set(p.id, arc);
          }
        }
      }
    }
    this.missiles.count = mi;
    this.missiles.instanceMatrix.needsUpdate = true;
    this.glows.count = gi;
    this.glows.instanceMatrix.needsUpdate = true;
    if (this.glows.instanceColor) this.glows.instanceColor.needsUpdate = true;
    // Tracers
    let ti = 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.t += dt;
      if (t.t >= t.life) {
        this.tracers.splice(i, 1);
        continue;
      }
      const f = 1 - t.t / t.life;
      // Bullet tracers travel; beams stay.
      const head = t.grow ? Math.min(1, (t.t / t.life) * 2.5) : 1;
      const tail = t.grow ? Math.max(0, head - 0.45) : 0;
      const o = ti * 6;
      this.tracerPos[o] = t.ax + (t.bx - t.ax) * tail;
      this.tracerPos[o + 1] = t.ay + (t.by - t.ay) * tail;
      this.tracerPos[o + 2] = t.az + (t.bz - t.az) * tail;
      this.tracerPos[o + 3] = t.ax + (t.bx - t.ax) * head;
      this.tracerPos[o + 4] = t.ay + (t.by - t.ay) * head;
      this.tracerPos[o + 5] = t.az + (t.bz - t.az) * head;
      for (let j = 0; j < 2; j++) {
        this.tracerCol[o + j * 3] = t.c.r * f * 2;
        this.tracerCol[o + j * 3 + 1] = t.c.g * f * 2;
        this.tracerCol[o + j * 3 + 2] = t.c.b * f * 2;
      }
      ti++;
    }
    this.tracerGeo.setDrawRange(0, ti * 2);
    (this.tracerGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.tracerGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    // Ballistic arcs (fade after impact)
    let ai = 0;
    for (const [id, arc] of this.arcs) {
      const alive = this.world.projectiles.some((p) => p.id === id && p.alive);
      if (!alive) arc.age += dt;
      if (arc.age > 6) {
        this.arcs.delete(id);
        continue;
      }
      const fade = 1 - arc.age / 6;
      const pts = arc.pts;
      for (let i = 3; i < pts.length && ai < 9990; i += 3) {
        const o = ai * 6;
        this.arcPos.set([pts[i - 3], pts[i - 2], pts[i - 1], pts[i], pts[i + 1], pts[i + 2]], o);
        const c = 0.55 * fade * (0.3 + (0.7 * i) / pts.length);
        this.arcCol.set([c, c * 0.9, c * 0.75, c, c * 0.9, c * 0.75], o);
        ai++;
      }
    }
    this.arcLine.geometry.setDrawRange(0, ai * 2);
    (this.arcLine.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.arcLine.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    // Scorch marks fade over a minute
    let changed = false;
    for (let i = 0; i < this.scorch.count; i++) {
      this.scorchAge[i] = (this.scorchAge[i] ?? 0) + dt;
      if (this.scorchAge[i] > 90 && this.scorchAge[i] - dt <= 90) {
        this.scorch.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
        changed = true;
      }
    }
    if (changed) this.scorch.instanceMatrix.needsUpdate = true;
    this.particles.update(dt);
  }

  /** Ambient emitters: building smoke/steam/flares, burning damage, oil fires. */
  ambient(emit: (fn: (p: Particles) => void) => void) {
    emit(() => {});
  }
}

function mergeSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.getAttribute('position').count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.getAttribute('position').array as Float32Array, o * 3);
    nor.set(g.getAttribute('normal').array as Float32Array, o * 3);
    o += g.getAttribute('position').count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export type { Projectile };
