/**
 * Draws all units and buildings with instancing: one InstancedMesh per model part.
 * Positions are interpolated between simulation ticks; ground units tilt with the
 * terrain, aircraft bank, turrets/rotors/pumpjacks animate, buildings rise while under
 * construction, and wrecks smoulder for a while.
 */
import * as THREE from 'three';
import type { World } from '../sim/world';
import type { Building, Entity, Unit } from '../sim/entities';
import { BUILDINGS } from '../sim/defs';
import type { Terrain } from './terrain/Terrain';
import { type ModelDef, modelMaterial } from './models/kit';
import { UNIT_MODELS, camoFor } from './models/units';
import { BUILDING_MODELS, type BuildingModel } from './models/buildings';

const _m = new THREE.Matrix4();
const _p = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** Visual altitude: compress high flight levels so aircraft stay on screen. */
export function visAlt(y: number) {
  return y < 0.3 ? y : 0.3 + Math.sqrt(y - 0.3) * 0.55;
}

class Batch {
  meshes: THREE.InstancedMesh[] = [];
  camo: THREE.InstancedBufferAttribute;
  capacity = 0;
  count = 0;

  constructor(
    readonly def: ModelDef,
    private parent: THREE.Object3D,
    private material: THREE.Material,
    private shadows: boolean,
  ) {
    this.camo = new THREE.InstancedBufferAttribute(new Float32Array(0), 3);
    this.grow(16);
  }

  private grow(n: number) {
    const old = this.meshes;
    this.capacity = n;
    this.camo = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.camo.setUsage(THREE.DynamicDrawUsage);
    this.meshes = this.def.parts.map((p) => {
      const geo = p.geo;
      geo.setAttribute('aCamo', this.camo);
      const m = new THREE.InstancedMesh(geo, this.material, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = this.shadows;
      m.receiveShadow = this.shadows;
      this.parent.add(m);
      return m;
    });
    for (const m of old) {
      this.parent.remove(m);
      m.dispose();
    }
  }

  begin() {
    this.count = 0;
  }

  /** Add an instance: base transform, team colour, camo colour, per-part animation. */
  push(base: THREE.Matrix4, team: THREE.Color, camo: THREE.Color, anim: (i: number, out: THREE.Matrix4) => void) {
    if (this.count >= this.capacity) this.grow(this.capacity * 2);
    const i = this.count++;
    this.camo.setXYZ(i, camo.r, camo.g, camo.b);
    for (let k = 0; k < this.meshes.length; k++) {
      const part = this.def.parts[k];
      if (part.anim === 'none' && part.pivot.lengthSq() === 0) _p.copy(base);
      else {
        anim(k, _m);
        _p.multiplyMatrices(base, _m);
      }
      this.meshes[k].setMatrixAt(i, _p);
      this.meshes[k].setColorAt(i, team);
    }
  }

  end() {
    for (const m of this.meshes) {
      m.count = this.count;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.camo.needsUpdate = true;
  }
}

interface Wreck {
  kind: string;
  unit: boolean;
  x: number;
  z: number;
  heading: number;
  owner: number;
  t: number;
}

export class EntityRenderer {
  readonly group = new THREE.Group();
  private material = modelMaterial();
  private unitBatches = new Map<string, Batch>();
  private buildingBatches = new Map<string, Batch>();
  private wreckBatches = new Map<string, Batch>();
  private teamColors: THREE.Color[] = [];
  private camoColors: THREE.Color[] = [];
  private buildingModels = new Map<string, BuildingModel>();
  wrecks: Wreck[] = [];
  /** Units and buildings drawn this frame (for overlays/picking). */
  readonly visible: Entity[] = [];
  time = 0;
  unitScale = 1;
  showModels = true;

  constructor(
    readonly world: World,
    readonly terrain: Terrain,
    readonly local: number,
    readonly shadows: boolean,
  ) {
    for (const c of world.countries) {
      this.teamColors[c.idx] = new THREE.Color(c.meta.color);
      this.camoColors[c.idx] = new THREE.Color(camoFor(c.iso)).convertSRGBToLinear();
    }
    this.group.name = 'entities';
  }

  model(kind: string, unit: boolean): ModelDef {
    if (unit) return (this.unitBatches.get(kind) ?? this.unitBatch(kind)).def;
    return this.buildingModel(kind);
  }

  buildingModel(kind: string): BuildingModel {
    let m = this.buildingModels.get(kind);
    if (!m) {
      m = BUILDING_MODELS[kind](BUILDINGS[kind].size);
      this.buildingModels.set(kind, m);
    }
    return m;
  }

  private unitBatch(kind: string) {
    let b = this.unitBatches.get(kind);
    if (!b) {
      b = new Batch(UNIT_MODELS[kind](), this.group, this.material, this.shadows);
      this.unitBatches.set(kind, b);
    }
    return b;
  }

  private buildingBatch(kind: string) {
    let b = this.buildingBatches.get(kind);
    if (!b) {
      b = new Batch(this.buildingModel(kind), this.group, this.material, this.shadows);
      this.buildingBatches.set(kind, b);
    }
    return b;
  }

  private wreckBatch(kind: string, unit: boolean) {
    const key = (unit ? 'u:' : 'b:') + kind;
    let b = this.wreckBatches.get(key);
    if (!b) {
      const def = unit ? UNIT_MODELS[kind]() : BUILDING_MODELS[kind](BUILDINGS[kind].size);
      b = new Batch(def, this.group, this.material, false);
      this.wreckBatches.set(key, b);
    }
    return b;
  }

  /** Is this entity visible to the local player? */
  sees(e: Entity): boolean {
    const w = this.world;
    if (e.owner === this.local || w.allied(this.local, e.owner)) return true;
    if (!e.isUnit) return w.vision.isExplored(this.local, e.x, e.z);
    return w.detects(this.local, e);
  }

  addWreck(kind: string, unit: boolean, x: number, z: number, heading: number, owner: number) {
    if (unit && (kind === 'rifle' || kind === 'atgm_team' || kind === 'manpads' || kind === 'engineer' || kind === 'sf' || kind === 'fpv' || kind === 'loiter')) return;
    this.wrecks.push({ kind, unit, x, z, heading, owner, t: 0 });
    if (this.wrecks.length > 160) this.wrecks.shift();
  }

  update(alpha: number, dt: number, camDist: number) {
    this.time += dt;
    const w = this.world;
    this.visible.length = 0;
    // Units grow when zoomed out so they stay legible until icons take over.
    this.unitScale = THREE.MathUtils.clamp(camDist / 12, 1, 6);
    for (const b of this.unitBatches.values()) b.begin();
    for (const b of this.buildingBatches.values()) b.begin();
    for (const b of this.wreckBatches.values()) b.begin();
    const show = this.showModels;
    for (const u of w.units) {
      if (!u.alive || !this.sees(u)) continue;
      this.visible.push(u);
      if (show) this.drawUnit(u, alpha);
    }
    for (const b of w.buildings) {
      if (!b.alive || !this.sees(b)) continue;
      this.visible.push(b);
      if (show) this.drawBuilding(b);
    }
    // Wrecks: charred hulks that sink after a while.
    const charred = new THREE.Color(0x141210);
    const charred2 = new THREE.Color(0x1e1a16);
    for (let i = this.wrecks.length - 1; i >= 0; i--) {
      const wr = this.wrecks[i];
      wr.t += dt;
      if (wr.t > 45) {
        this.wrecks.splice(i, 1);
        continue;
      }
      if (!show || !w.vision.isExplored(this.local, wr.x, wr.z)) continue;
      const y = this.terrain.surfaceAt(wr.x, wr.z) - Math.max(0, wr.t - 35) * 0.006;
      const s = wr.unit ? this.unitScale : 1;
      _e.set(wr.unit ? 0.08 : 0, wr.heading, wr.unit ? 0.05 : 0);
      _q.setFromEuler(_e);
      _m.compose(_v.set(wr.x, y, wr.z), _q, _s.set(s, wr.unit ? s : s * 0.35, s));
      const base = _m.clone();
      this.wreckBatch(wr.kind, wr.unit).push(base, charred, charred2, (_k, out) => out.makeTranslation(this.wreckBatch(wr.kind, wr.unit).def.parts[_k].pivot));
    }
    for (const b of this.unitBatches.values()) b.end();
    for (const b of this.buildingBatches.values()) b.end();
    for (const b of this.wreckBatches.values()) b.end();
  }

  private drawUnit(u: Unit, alpha: number) {
    const x = u.px + (u.x - u.px) * alpha;
    const z = u.pz + (u.z - u.pz) * alpha;
    const heading = lerpAngle(u.pHeading, u.heading, alpha);
    const def = u.def;
    const s = this.unitScale;
    let y: number;
    let pitch = 0;
    let roll = 0;
    if (u.isAir) {
      const ay = u.py + (u.y - u.py) * alpha;
      y = this.terrain.surfaceAt(x, z) + visAlt(ay) * Math.max(1, s * 0.7);
      roll = -u.bank * (def.flight === 'heli' || def.flight === 'fpv' ? 0.4 : 0.7);
      pitch = def.flight === 'heli' ? Math.min(0.25, u.speed * 0.06) : 0;
    } else {
      y = this.terrain.surfaceAt(x, z);
      if (!u.isNaval && def.category !== 'infantry') {
        // Tilt with the ground under the hull.
        const r = def.radius * s;
        const fx = Math.sin(heading) * r;
        const fz = Math.cos(heading) * r;
        const hf = this.terrain.heightAt(x + fx, z + fz);
        const hb = this.terrain.heightAt(x - fx, z - fz);
        const hl = this.terrain.heightAt(x + fz, z - fx);
        const hr = this.terrain.heightAt(x - fz, z + fx);
        pitch = -Math.atan2(hf - hb, 2 * r);
        roll = Math.atan2(hl - hr, 2 * r);
        y = Math.max(y, (hf + hb) / 2);
      } else if (u.isNaval) {
        pitch = Math.sin(this.time * 1.3 + u.id) * 0.02;
        roll = Math.sin(this.time * 0.9 + u.id * 1.7) * 0.03;
      }
      if (u.speed > 0.05 && def.category === 'infantry') y += Math.abs(Math.sin(this.time * 9 + u.id)) * 0.003 * s;
    }
    _e.set(pitch, heading, roll);
    _q.setFromEuler(_e);
    _m.compose(_v.set(x, y, z), _q, _s.set(s, s, s));
    const base = _m.clone();
    const turret = lerpAngle(u.pTurretYaw, u.turretYaw, alpha);
    const elev = u.deployed ? 1.15 : 0;
    const t = this.time;
    const batch = this.unitBatch(def.id);
    batch.push(base, this.teamColors[u.owner], this.camoColors[u.owner], (k, out) => partMatrix(batch.def, k, turret, elev, t + u.id * 0.37, out));
  }

  private drawBuilding(b: Building) {
    const y = this.terrain.heightAt(b.x, b.z);
    const grow = b.built ? 1 : Math.max(0.04, 1 - (1 - b.progress) ** 3);
    _e.set(0, 0, 0);
    _q.setFromEuler(_e);
    _m.compose(_v.set(b.x, y, b.z), _q, _s.set(1, grow, 1));
    const base = _m.clone();
    const batch = this.buildingBatch(b.def.id);
    const t = b.built && !this.world.countries[b.owner].lowPower ? this.time : 0;
    batch.push(base, this.teamColors[b.owner], this.camoColors[b.owner], (k, out) => partMatrix(batch.def, k, b.turretYaw, 0, t + b.id * 0.5, out));
  }

  dispose() {
    for (const batches of [this.unitBatches, this.buildingBatches, this.wreckBatches])
      for (const b of batches.values())
        for (const m of b.meshes) {
          this.group.remove(m);
          m.dispose();
        }
    this.material.dispose();
  }
}

function partMatrix(def: ModelDef, k: number, turret: number, elev: number, t: number, out: THREE.Matrix4) {
  const p = def.parts[k];
  switch (p.anim) {
    case 'turret':
      _e.set(0, turret, 0);
      break;
    case 'pitch':
      _e.set(-elev, 0, 0);
      break;
    case 'spin': {
      const a = t * p.speed;
      _e.set(p.axis === 'x' ? a : 0, p.axis === 'y' ? a : 0, p.axis === 'z' ? a : 0);
      break;
    }
    case 'rock':
      _e.set(Math.sin(t * p.speed) * 0.35, 0, 0);
      break;
    default:
      _e.set(0, 0, 0);
  }
  _q.setFromEuler(_e);
  return out.compose(p.pivot, _q, _s.set(1, 1, 1));
}

export function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export { _c as scratchColor };
