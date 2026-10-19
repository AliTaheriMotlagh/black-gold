import * as THREE from 'three';
import type { ProjectileType } from './config';
import { ECONOMY } from './config';
import type { Entity } from './entities';
import type { World } from './World';
import { mat } from './models';

type PType = ProjectileType | 'ballistic' | 'interceptor';

interface Projectile {
  type: PType;
  team: number;
  attacker: Entity | null;
  damage: number;
  splash: number;
  pos: THREE.Vector3;
  start: THREE.Vector3;
  end: THREE.Vector3;
  target: Entity | null;
  t: number;
  dur: number;
  apex: number;
  speed: number;
  vel: THREE.Vector3;
  mesh: THREE.Object3D;
  /** Ballistic: interception decided? */
  interceptChecked?: boolean;
  /** Interceptor: the missile it chases */
  chase?: Projectile;
  dead?: boolean;
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class ProjectileSystem {
  readonly group = new THREE.Group();
  private list: Projectile[] = [];
  private geos = {
    shell: new THREE.SphereGeometry(0.14, 6, 4),
    rocket: (() => {
      const g = new THREE.CylinderGeometry(0.07, 0.07, 0.7, 6);
      g.rotateX(Math.PI / 2);
      return g;
    })(),
    ballistic: (() => {
      const body = new THREE.CylinderGeometry(0.45, 0.45, 3.4, 12);
      body.rotateX(Math.PI / 2);
      return body;
    })(),
    nose: (() => {
      const g = new THREE.ConeGeometry(0.45, 1.0, 12);
      g.rotateX(Math.PI / 2);
      g.translate(0, 0, 2.2);
      return g;
    })(),
  };
  private mats = {
    shell: new THREE.MeshBasicMaterial({ color: 0xffe28a }),
    rocket: mat(0x8a8a80, 0.6, 0.3),
    missile: mat(0xe6e6e6, 0.5, 0.3),
  };

  constructor(private world: World) {}

  get count() {
    return this.list.length;
  }

  /** Fire a weapon from `from` at `target` (or ground point `point`). */
  fire(type: ProjectileType, from: THREE.Vector3, target: Entity | null, point: THREE.Vector3, team: number, attacker: Entity | null, damage: number, splash = 0) {
    const w = this.world;
    if (type === 'bullet') {
      // Hit-scan with tracer
      const accuracy = w.crises.sandstorm > 0 && attacker && attacker.isUnit && attacker.isAir ? 0.55 : 0.88;
      const hit = Math.random() < accuracy;
      tmp.copy(point);
      if (!hit) tmp.add(new THREE.Vector3((Math.random() - 0.5) * 2.4, 0, (Math.random() - 0.5) * 2.4));
      w.decals.tracer(from, tmp);
      if (hit && target) w.applyDamage(target, damage, 'bullet', team, attacker);
      if (Math.random() < 0.5) w.particles.impact(tmp, true);
      return;
    }
    const p: Projectile = {
      type,
      team,
      attacker,
      damage,
      splash,
      pos: from.clone(),
      start: from.clone(),
      end: point.clone(),
      target,
      t: 0,
      dur: 0,
      apex: 0,
      speed: type === 'shell' ? 70 : type === 'rocket' ? 30 : type === 'missile' ? 34 : 0,
      vel: new THREE.Vector3(),
      mesh: this.makeMesh(type),
    };
    if (type === 'artillery') {
      const dist = Math.hypot(point.x - from.x, point.z - from.z);
      p.dur = 1.2 + dist / 22;
      p.apex = 6 + dist * 0.35;
    } else {
      p.vel.subVectors(point, from).normalize().multiplyScalar(p.speed);
      if (type === 'missile') p.vel.y += 6; // launch pop-up
    }
    p.mesh.position.copy(from);
    this.group.add(p.mesh);
    this.list.push(p);
  }

  launchBallistic(from: THREE.Vector3, to: THREE.Vector3, team: number, attacker: Entity | null) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(this.geos.ballistic, mat(0xeeeeee, 0.5, 0.3));
    const nose = new THREE.Mesh(this.geos.nose, mat(this.world.teams[team].theme.color, 0.5, 0.3));
    g.add(body, nose);
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    const p: Projectile = {
      type: 'ballistic',
      team,
      attacker,
      damage: ECONOMY.missileDamage,
      splash: ECONOMY.missileRadius,
      pos: from.clone(),
      start: from.clone(),
      end: to.clone(),
      target: null,
      t: 0,
      dur: 8 + dist / 45,
      apex: 70 + dist * 0.25,
      speed: 0,
      vel: new THREE.Vector3(),
      mesh: g,
    };
    g.position.copy(from);
    this.group.add(g);
    this.list.push(p);
    return p;
  }

  private makeMesh(type: PType): THREE.Object3D {
    switch (type) {
      case 'shell':
        return new THREE.Mesh(this.geos.shell, this.mats.shell);
      case 'missile':
      case 'interceptor':
        return new THREE.Mesh(this.geos.rocket, this.mats.missile);
      default:
        return new THREE.Mesh(this.geos.rocket, this.mats.rocket);
    }
  }

  update(dt: number) {
    const w = this.world;
    for (const p of this.list) {
      if (p.dead) continue;
      switch (p.type) {
        case 'shell':
        case 'rocket':
        case 'missile':
        case 'interceptor': {
          const homing = p.type === 'missile' || p.type === 'interceptor';
          if (p.type === 'interceptor' && p.chase) {
            if (p.chase.dead) {
              p.dead = true;
              break;
            }
            p.end.copy(p.chase.pos);
          } else if (p.target && p.target.alive) {
            w.entityAimPoint(p.target, p.end);
          }
          if (homing) {
            tmp.subVectors(p.end, p.pos).normalize().multiplyScalar(p.speed);
            p.vel.lerp(tmp, Math.min(1, dt * (p.type === 'interceptor' ? 10 : 5)));
            p.speed += dt * 25;
          } else if (p.type === 'rocket') {
            tmp.subVectors(p.end, p.pos).normalize().multiplyScalar(p.speed);
            p.vel.lerp(tmp, Math.min(1, dt * 3));
          }
          const step = p.vel.length() * dt;
          const remaining = p.pos.distanceTo(p.end);
          if (step >= remaining || remaining < 0.6) {
            p.pos.copy(p.end);
            this.hit(p);
            break;
          }
          p.pos.addScaledVector(p.vel, dt);
          p.t += dt;
          if (p.t > 4) {
            this.hit(p);
            break;
          }
          if (p.type !== 'shell') w.particles.trail(p.pos, true);
          break;
        }
        case 'artillery': {
          p.t += dt / p.dur;
          const t = Math.min(1, p.t);
          tmp.lerpVectors(p.start, p.end, t);
          tmp.y += Math.sin(Math.PI * t) * p.apex;
          p.vel.subVectors(tmp, p.pos);
          p.pos.copy(tmp);
          w.particles.trail(p.pos, true);
          if (t >= 1) this.hit(p);
          break;
        }
        case 'ballistic': {
          p.t += dt / p.dur;
          const t = Math.min(1, p.t);
          // Ease-in launch, ballistic arc
          const tt = t < 0.15 ? (t / 0.15) ** 2 * 0.15 : t;
          tmp.lerpVectors(p.start, p.end, tt);
          tmp.y += Math.sin(Math.PI * tt) * p.apex + (t < 0.15 ? (t / 0.15) * 4 : 0);
          p.vel.subVectors(tmp, p.pos);
          p.pos.copy(tmp);
          w.particles.bigTrail(p.pos);
          if (!p.interceptChecked && t > 0.62) {
            p.interceptChecked = true;
            w.tryIntercept(p.end, p.team, (from: THREE.Vector3) => this.launchInterceptor(from, p));
          }
          if (t >= 1) this.hit(p);
          break;
        }
      }
      if (!p.dead && p.vel.lengthSq() > 1e-6) {
        p.mesh.position.copy(p.pos);
        tmp2.copy(p.pos).add(p.vel);
        p.mesh.lookAt(tmp2);
      }
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i].dead) {
        this.group.remove(this.list[i].mesh);
        this.list.splice(i, 1);
      }
    }
  }

  private launchInterceptor(from: THREE.Vector3, missile: Projectile) {
    const p: Projectile = {
      type: 'interceptor',
      team: -1,
      attacker: null,
      damage: 0,
      splash: 0,
      pos: from.clone(),
      start: from.clone(),
      end: missile.pos.clone(),
      target: null,
      t: 0,
      dur: 0,
      apex: 0,
      speed: 60,
      vel: new THREE.Vector3(0, 60, 0),
      mesh: this.makeMesh('interceptor'),
      chase: missile,
    };
    this.group.add(p.mesh);
    this.list.push(p);
    this.world.sound('missile', from);
  }

  private hit(p: Projectile) {
    const w = this.world;
    p.dead = true;
    switch (p.type) {
      case 'shell':
        if (p.target && p.target.alive) w.applyDamage(p.target, p.damage, 'shell', p.team, p.attacker);
        if (p.splash) w.splash(p.pos, p.splash, p.damage * 0.4, 'shell', p.team, p.attacker, p.target);
        w.particles.impact(p.pos, false);
        w.particles.explosion(p.pos, 0.35);
        break;
      case 'rocket':
      case 'missile':
        if (p.target && p.target.alive) w.applyDamage(p.target, p.damage, p.type, p.team, p.attacker);
        w.particles.explosion(p.pos, 0.45);
        w.sound('explosion', p.pos, 0.5);
        break;
      case 'artillery':
        w.splash(p.pos, p.splash, p.damage, 'artillery', p.team, p.attacker, null);
        w.particles.explosion(p.pos, 0.8);
        w.decals.scorch(p.pos.x, w.ground(p.pos.x, p.pos.z), p.pos.z, 2.5);
        w.sound('explosion', p.pos, 0.7);
        break;
      case 'interceptor': {
        const m = p.chase!;
        m.dead = true;
        w.particles.explosion(m.pos, 4);
        w.decals.flash(m.pos, 40);
        w.sound('intercept', m.pos);
        w.onIntercepted(m.end, m.team);
        break;
      }
      case 'ballistic': {
        const g = w.ground(p.end.x, p.end.z);
        tmp.set(p.end.x, g, p.end.z);
        w.splash(tmp, p.splash, p.damage, 'artillery', p.team, p.attacker, null, true);
        for (let i = 0; i < 6; i++) {
          tmp2.set(tmp.x + (Math.random() - 0.5) * 8, g + Math.random() * 3, tmp.z + (Math.random() - 0.5) * 8);
          w.particles.explosion(tmp2, 2.2);
        }
        w.particles.explosion(tmp.clone().add(UP.clone().multiplyScalar(4)), 5);
        w.decals.shockwave(tmp.x, g, tmp.z, 26);
        w.decals.scorch(tmp.x, g, tmp.z, 18);
        w.decals.flash(tmp, 120);
        w.sound('bigExplosion', tmp);
        w.cameraShake(tmp, 2.5);
        break;
      }
    }
  }

  clear() {
    for (const p of this.list) this.group.remove(p.mesh);
    this.list = [];
  }
}
