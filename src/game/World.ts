import * as THREE from 'three';
import { CELL, CITIES, GRID_H, GRID_W, OIL_FIELDS, START_REGIONS, WORLD_H, WORLD_W, lonLatToWorld } from '../geo/geography';
import type { MapData } from '../world/heightmap';
import { groundHeight, nearestPassable, worldToCell } from '../world/heightmap';
import type { Terrain } from '../world/Terrain';
import type { Particles } from '../fx/particles';
import type { Decals } from '../fx/decals';
import { disposeObject, textSprite } from '../fx/labels';
import {
  BUILDINGS,
  DAMAGE_TABLE,
  DIFFICULTY,
  ECONOMY,
  TEAM_THEMES,
  UNITS,
  type BuildingKind,
  type MatchSettings,
  type ProjectileType,
  type SfxName,
  type UnitKind,
} from './config';
import { Building, City, type Entity, OilField, type Point, type Team, Unit, newTeam } from './entities';
import { createBuildingModel, createCityModel, createOilFieldModel, createUnitModel } from './models';
import { Pathfinder } from './pathfinding';
import { ProjectileSystem } from './combat';
import { FogOfWar } from './fog';
import { Crises, type CrisisInfo, Market } from './events';
import type { I18nKey } from '../i18n';
import { loc } from '../i18n';

export type GameEvent =
  | { type: 'toast'; key: I18nKey; extra?: string; tone: 'info' | 'good' | 'bad' | 'warn'; x?: number; z?: number }
  | { type: 'crisis'; info: CrisisInfo }
  | { type: 'end'; victory: boolean }
  | { type: 'eliminated'; team: number }
  | { type: 'built'; team: number; kind: BuildingKind }
  | { type: 'trained'; team: number; kind: UnitKind }
  | { type: 'kill'; team: number; victimTeam: number; building: boolean }
  | { type: 'sold'; team: number; price: number; credits: number }
  | { type: 'captured'; team: number; city: City }
  | { type: 'intercept'; team: number }
  | { type: 'missileHit'; team: number }
  | { type: 'missileLaunch'; team: number; x: number; z: number };

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const UNIT_RING_GEO = (() => {
  const g = new THREE.RingGeometry(0.85, 1, 32);
  g.rotateX(-Math.PI / 2);
  return g;
})();

/** Bucketed spatial hash for unit proximity queries. */
class SpatialHash {
  private cells = new Map<number, Unit[]>();
  constructor(private size: number) {}
  clear() {
    this.cells.clear();
  }
  key(x: number, z: number) {
    return Math.floor(x / this.size) * 4096 + Math.floor(z / this.size);
  }
  insert(u: Unit) {
    const k = this.key(u.x, u.z);
    let arr = this.cells.get(k);
    if (!arr) this.cells.set(k, (arr = []));
    arr.push(u);
  }
  query(x: number, z: number, r: number, out: Unit[]) {
    out.length = 0;
    const s = this.size;
    const x0 = Math.floor((x - r) / s);
    const x1 = Math.floor((x + r) / s);
    const z0 = Math.floor((z - r) / s);
    const z1 = Math.floor((z + r) / s);
    for (let i = x0; i <= x1; i++)
      for (let j = z0; j <= z1; j++) {
        const arr = this.cells.get(i * 4096 + j);
        if (arr) for (const u of arr) out.push(u);
      }
    return out;
  }
}

export class World {
  readonly teams: Team[] = [];
  units: Unit[] = [];
  buildings: Building[] = [];
  readonly cities: City[] = [];
  readonly oilFields: OilField[] = [];
  readonly root = new THREE.Group();
  readonly projectiles: ProjectileSystem;
  readonly fog: FogOfWar;
  readonly market = new Market();
  readonly crises: Crises;
  readonly playerTeam = 0;
  time = 0;
  ended = false;
  camera: THREE.Camera | null = null;
  /** Provided by the renderer for 3D sound placement. */
  spatial: (x: number, z: number) => { distance: number; pan: number } = () => ({ distance: 0, pan: 0 });
  playSound: (name: SfxName, opts: { pan?: number; distance?: number; volume?: number }) => void = () => {};
  shake: (amount: number) => void = () => {};

  private occ: Int32Array;
  private oilReserved: Uint8Array;
  private pathfinder: Pathfinder;
  private pathQueue: { unit: Unit; x: number; z: number }[] = [];
  private hash = new SpatialHash(8);
  private near: Unit[] = [];
  private listeners = new Set<(e: GameEvent) => void>();
  private powerTimer = 0;
  private elimTimer = 1;
  private lastAlert = -99;
  private rubble: { mesh: THREE.Object3D; life: number }[] = [];
  lastAlertPos: Point | null = null;

  constructor(
    readonly map: MapData,
    readonly terrain: Terrain,
    readonly scene: THREE.Scene,
    readonly particles: Particles,
    readonly decals: Decals,
    readonly settings: MatchSettings,
  ) {
    this.occ = new Int32Array(GRID_W * GRID_H);
    this.oilReserved = new Uint8Array(GRID_W * GRID_H);
    this.pathfinder = new Pathfinder(GRID_W, GRID_H, (c) => map.cellPassable[c] === 1 && this.occ[c] === 0);
    this.projectiles = new ProjectileSystem(this);
    this.fog = new FogOfWar(GRID_W, GRID_H, terrain);
    this.crises = new Crises({
      market: this.market,
      sabotageRandomDerrick: () => this.sabotage(),
      sanctionLeader: (d) => this.sanctionLeader(d),
      onCrisis: (info) => this.emit({ type: 'crisis', info }),
    });
    this.crises.enabled = settings.events;
    this.scene.add(this.root);
    this.root.add(this.projectiles.group);
    this.setupMap();
    this.setupTeams();
  }

  // ---------------------------------------------------------------------------
  // Setup

  private setupMap() {
    CITIES.forEach((def, i) => {
      const w = lonLatToWorld(def.ll[0], def.ll[1]);
      const c = worldToCell(w.x, w.z);
      const p = nearestPassable(this.map, c.cx, c.cz);
      const x = (p.cx + 0.5) * CELL;
      const z = (p.cz + 0.5) * CELL;
      const rig = createCityModel(i * 97 + 13, def.capital);
      rig.root.position.set(x, this.ground(x, z), z);
      this.root.add(rig.root);
      this.cities.push(new City(def, x, z, rig));
    });
    OIL_FIELDS.forEach((def, i) => {
      const w = lonLatToWorld(def.ll[0], def.ll[1]);
      const c = worldToCell(w.x, w.z);
      const spot = this.findFootprint(c.cx, c.cz, 2, (cx, cz) => this.areaFree(cx, cz, 2, true) && !this.nearCity((cx + 1) * CELL, (cz + 1) * CELL, 3));
      if (!spot) return;
      const x = (spot.cx + 1) * CELL;
      const z = (spot.cz + 1) * CELL;
      const model = createOilFieldModel(i + 1);
      model.position.set(x, this.ground(x, z), z);
      this.root.add(model);
      for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) this.oilReserved[(spot.cz + dz) * GRID_W + spot.cx + dx] = 1;
      this.oilFields.push(new OilField(def, spot.cx, spot.cz, x, z, model));
    });
    this.rebuildLabels();
  }

  rebuildLabels() {
    for (const c of this.cities) {
      if (c.label) {
        c.rig.root.remove(c.label);
        c.label.material.map?.dispose();
        c.label.material.dispose();
      }
      const s = textSprite(loc(c.def.name), c.def.capital ? 3.2 : 2.6, {
        size: 44,
        color: c.def.capital ? '#ffe7a8' : '#ffffff',
        stroke: 'rgba(0,0,0,0.7)',
        weight: 700,
      });
      s.position.set(0, 7.5, 0);
      c.label = s;
      c.rig.root.add(s);
    }
  }

  private setupTeams() {
    const s = this.settings;
    const playerRegion = START_REGIONS.find((r) => r.id === s.startRegion) ?? START_REGIONS[0];
    // Opponents take the regions farthest from the player first for a fair opening.
    const others = START_REGIONS.filter((r) => r !== playerRegion)
      .map((r) => ({ r, d: Math.hypot(r.ll[0] - playerRegion.ll[0], r.ll[1] - playerRegion.ll[1]) }))
      .sort((a, b) => b.d - a.d)
      .map((o) => o.r);
    const regions = [playerRegion, ...shuffleTop(others, s.opponents)];
    for (let i = 0; i <= s.opponents; i++) {
      const team = newTeam(i, TEAM_THEMES[i], i !== 0, s.difficulty, s.startCredits);
      const region = regions[i];
      team.regionId = region.id;
      const w = lonLatToWorld(region.ll[0], region.ll[1]);
      const c = worldToCell(w.x, w.z);
      const spot = this.findFootprint(c.cx, c.cz, 4, (cx, cz) => this.areaFree(cx, cz, 4, false, 2) && !this.nearCity((cx + 2) * CELL, (cz + 2) * CELL, 6));
      this.teams.push(team);
      if (!spot) continue;
      const hq = this.spawnBuilding('hq', i, spot.cx, spot.cz, true);
      team.startX = hq.x;
      team.startZ = hq.z;
      const kinds: UnitKind[] = ['rifleman', 'rifleman', 'rifleman', 'rpg', 'technical'];
      kinds.forEach((k, j) => {
        const a = (j / kinds.length) * Math.PI * 2;
        this.spawnUnit(k, i, hq.x + Math.cos(a) * 7, hq.z + Math.sin(a) * 7);
        team.pop += UNITS[k].pop;
      });
    }
    this.updatePower();
  }

  /** Spiral search for a footprint anchor near (cx, cz). */
  findFootprint(cx: number, cz: number, size: number, ok: (cx: number, cz: number) => boolean, maxR = 40): { cx: number; cz: number } | null {
    const half = Math.floor(size / 2);
    for (let r = 0; r < maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const x = cx + dx - half;
          const z = cz + dz - half;
          if (ok(x, z)) return { cx: x, cz: z };
        }
      }
    }
    return null;
  }

  /** True if a footprint centered at (x, z) with half-size `half` would intrude on a city. */
  nearCity(x: number, z: number, half: number): boolean {
    for (const c of this.cities) {
      const r = (c.def.capital ? 6 : 5) + half;
      if (Math.abs(c.x - x) < r && Math.abs(c.z - z) < r) return true;
    }
    return false;
  }

  /** All cells passable, unoccupied (and not oil-reserved unless allowed), with a 1-cell margin. */
  areaFree(cx: number, cz: number, size: number, allowOil: boolean, margin = 1): boolean {
    for (let dz = -margin; dz < size + margin; dz++) {
      for (let dx = -margin; dx < size + margin; dx++) {
        const x = cx + dx;
        const z = cz + dz;
        if (x < 0 || z < 0 || x >= GRID_W || z >= GRID_H) return false;
        const c = z * GRID_W + x;
        const inner = dx >= 0 && dz >= 0 && dx < size && dz < size;
        if (!this.map.cellPassable[c]) return false;
        if (this.occ[c] !== 0) return false;
        if (inner && !allowOil && this.oilReserved[c]) return false;
      }
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Events

  on(fn: (e: GameEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(e: GameEvent) {
    this.listeners.forEach((fn) => fn(e));
  }

  toast(team: number, key: I18nKey, tone: 'info' | 'good' | 'bad' | 'warn', at?: Point, extra?: string) {
    if (team !== this.playerTeam) return;
    this.emit({ type: 'toast', key, tone, x: at?.x, z: at?.z, extra });
  }

  sound(name: SfxName, pos?: { x: number; z: number }, volume = 1) {
    if (pos) {
      if (!this.fog.isVisible(pos.x, pos.z) && name !== 'bigExplosion' && name !== 'launch') return;
      const s = this.spatial(pos.x, pos.z);
      this.playSound(name, { pan: s.pan, distance: s.distance, volume });
    } else this.playSound(name, { volume });
  }

  cameraShake(pos: { x: number; z: number }, amount: number) {
    const d = this.spatial(pos.x, pos.z).distance;
    this.shake(amount * Math.max(0, 1 - d / 200));
  }

  // ---------------------------------------------------------------------------
  // Spawning

  spawnUnit(kind: UnitKind, team: number, x: number, z: number): Unit {
    const def = UNITS[kind];
    const t = this.teams[team];
    const rig = createUnitModel(kind, t.theme.color);
    if (!def.air) {
      const c = worldToCell(x, z);
      const p = this.pathfinder.nearestWalkable(Math.max(0, Math.min(GRID_W - 1, c.cx)), Math.max(0, Math.min(GRID_H - 1, c.cz)));
      if (p >= 0) {
        x = ((p % GRID_W) + 0.5) * CELL;
        z = (Math.floor(p / GRID_W) + 0.5) * CELL;
      }
    }
    const u = new Unit(def, team, rig, x, z, t.theme.color, team === this.playerTeam);
    u.heading = Math.random() * Math.PI * 2;
    u.y = this.ground(x, z);
    if (def.air) u.altitude = u.y + 7;
    if (rig.barrel) rig.barrel.userData.z0 = rig.barrel.position.z;
    this.root.add(rig.root);
    this.root.add(u.hpBar.group);
    const ring = new THREE.Mesh(UNIT_RING_GEO, new THREE.MeshBasicMaterial({ color: team === this.playerTeam ? 0x5dff8a : 0xff5050, transparent: true, opacity: 0.9, depthWrite: false }));
    ring.scale.setScalar(def.radius * 1.4 + 0.3);
    ring.visible = false;
    ring.renderOrder = 4;
    this.root.add(ring);
    u.ring = ring;
    this.units.push(u);
    this.syncUnit(u, 0);
    return u;
  }

  spawnBuilding(kind: BuildingKind, team: number, cx: number, cz: number, instant = false): Building {
    const def = BUILDINGS[kind];
    const t = this.teams[team];
    const rig = createBuildingModel(kind, t.theme.color);
    const b = new Building(def, team, rig, cx, cz, CELL, t.theme.color, team === this.playerTeam);
    if (rig.barrel) rig.barrel.userData.z0 = rig.barrel.position.z;
    b.y = this.footprintHeight(cx, cz, def.size);
    rig.root.position.set(b.x, b.y, b.z);
    b.heading = team === this.playerTeam ? 0 : Math.PI;
    rig.root.rotation.y = b.heading;
    if (instant) {
      b.progress = 1;
      b.built = true;
    } else {
      b.hp = def.hp * 0.1;
    }
    for (let dz = 0; dz < def.size; dz++) for (let dx = 0; dx < def.size; dx++) this.occ[(cz + dz) * GRID_W + cx + dx] = b.id;
    if (kind === 'derrick') {
      const f = this.oilFields.find((o) => o.cx === cx && o.cz === cz);
      if (f) {
        f.derrick = b;
        b.oilField = f;
        f.model.visible = false;
      }
    }
    this.root.add(rig.root);
    this.root.add(b.hpBar.group);
    const ring = new THREE.Mesh(UNIT_RING_GEO, new THREE.MeshBasicMaterial({ color: team === this.playerTeam ? 0x5dff8a : 0xff5050, transparent: true, opacity: 0.8, depthWrite: false }));
    ring.scale.setScalar(def.size * 1.25);
    ring.position.set(b.x, b.y + 0.4, b.z);
    ring.visible = false;
    ring.renderOrder = 4;
    this.root.add(ring);
    b.ring = ring;
    this.buildings.push(b);
    this.syncBuilding(b, 0);
    return b;
  }

  private footprintHeight(cx: number, cz: number, size: number) {
    let h = 0;
    for (let dz = 0; dz <= size; dz++) for (let dx = 0; dx <= size; dx++) h = Math.max(h, this.ground((cx + dx) * CELL, (cz + dz) * CELL));
    return h;
  }

  ground(x: number, z: number) {
    return groundHeight(this.map, x, z);
  }

  // ---------------------------------------------------------------------------
  // Queries

  teamBuildings(team: number, kind?: BuildingKind, operational = true) {
    return this.buildings.filter((b) => b.alive && b.team === team && (!kind || b.kind === kind) && (!operational || b.built));
  }

  hasBuilding(team: number, kind: BuildingKind) {
    return this.buildings.some((b) => b.alive && b.team === team && b.kind === kind && b.built);
  }

  lowPower(team: number) {
    const t = this.teams[team];
    return t.powerUse > t.powerProd;
  }

  sellEfficiency(team: number) {
    const refineries = Math.min(3, this.teamBuildings(team, 'refinery').length);
    return (ECONOMY.baseSellEfficiency + refineries * ECONOMY.refineryBonus) * this.teams[team].priceMod;
  }

  /** Credits that would be earned selling `barrels` now. */
  oilValue(team: number, barrels: number) {
    return (barrels * this.market.price * this.sellEfficiency(team)) / ECONOMY.priceDivisor;
  }

  requirementsMet(team: number, kind: BuildingKind): BuildingKind[] {
    return BUILDINGS[kind].requires.filter((r) => !this.hasBuilding(team, r));
  }

  unitRequirementMet(team: number, kind: UnitKind) {
    return this.hasBuilding(team, UNITS[kind].producer);
  }

  atLimit(team: number, kind: BuildingKind) {
    const lim = BUILDINGS[kind].limit;
    return lim !== undefined && this.teamBuildings(team, kind, false).length >= lim;
  }

  isEnemy(a: number, b: number) {
    return a !== b && a >= 0 && b >= 0;
  }

  /** Where projectiles should aim on an entity. */
  entityAimPoint(e: Entity, out: THREE.Vector3) {
    if (e.isUnit) out.set(e.x, (e.isAir ? e.altitude : e.y) + (e.isAir ? 0 : e.radius * 0.6), e.z);
    else out.set(e.x, e.y + 1.2, e.z);
    return out;
  }

  findOilFieldNear(x: number, z: number, radius = 8): OilField | null {
    let best: OilField | null = null;
    let bestD = radius;
    for (const f of this.oilFields) {
      const d = Math.hypot(f.x - x, f.z - z);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    return best;
  }

  /** Validate a building placement. Returns null if OK, else the reason key. */
  placementError(team: number, kind: BuildingKind, cx: number, cz: number): I18nKey | null {
    const def = BUILDINGS[kind];
    const t = this.teams[team];
    if (t.credits < def.cost) return 'hud.noFunds';
    if (t.oil < def.oil) return 'hud.noOil';
    if (this.requirementsMet(team, kind).length) return 'hud.requires';
    if (this.atLimit(team, kind)) return 'hud.limit';
    if (def.onOil) {
      const f = this.oilFields.find((o) => o.cx === cx && o.cz === cz);
      if (!f || f.derrick) return 'hud.placeOil';
      if (team === this.playerTeam && !this.fog.isExplored(f.x, f.z)) return 'hud.placeOil';
      return null;
    }
    if (!this.areaFree(cx, cz, def.size, false, 0)) return 'hud.invalidPlace';
    if (this.nearCity((cx + def.size / 2) * CELL, (cz + def.size / 2) * CELL, (def.size * CELL) / 2)) return 'hud.invalidPlace';
    // Must be within build radius of an own non-derrick building.
    const x = (cx + def.size / 2) * CELL;
    const z = (cz + def.size / 2) * CELL;
    const near = this.buildings.some(
      (b) => b.alive && b.team === team && b.kind !== 'derrick' && Math.hypot(b.x - x, b.z - z) < ECONOMY.buildRadius,
    );
    if (!near) return 'hud.invalidPlace';
    // No units inside footprint
    const r = (def.size * CELL) / 2 + 0.5;
    if (this.units.some((u) => u.alive && !u.isAir && Math.abs(u.x - x) < r && Math.abs(u.z - z) < r)) return 'hud.invalidPlace';
    return null;
  }

  // ---------------------------------------------------------------------------
  // Commands

  placeBuilding(team: number, kind: BuildingKind, cx: number, cz: number): boolean {
    const err = this.placementError(team, kind, cx, cz);
    if (err) {
      if (team === this.playerTeam) {
        this.toast(team, err, 'bad');
        this.sound('error');
      }
      return false;
    }
    const def = BUILDINGS[kind];
    const t = this.teams[team];
    t.credits -= def.cost;
    t.oil -= def.oil;
    const b = this.spawnBuilding(kind, team, cx, cz);
    if (team === this.playerTeam) {
      this.sound('place', b);
      this.decals.marker(b.x, b.y, b.z, 0xf5c542);
    }
    return true;
  }

  queueUnit(team: number, kind: UnitKind): boolean {
    const def = UNITS[kind];
    const t = this.teams[team];
    const producers = this.teamBuildings(team, def.producer);
    const fail = (key: I18nKey) => {
      if (team === this.playerTeam) {
        this.toast(team, key, 'bad');
        this.sound('error');
      }
      return false;
    };
    if (!producers.length) return fail('hud.requires');
    if (t.credits < def.cost) return fail('hud.noFunds');
    if (t.oil < def.oil) return fail('hud.noOil');
    if (t.pop + def.pop > ECONOMY.popCap) return fail('hud.popCap');
    const b = producers.reduce((a, c) => (c.queue.length < a.queue.length ? c : a));
    if (b.queue.length >= 9) return fail('hud.limit');
    t.credits -= def.cost;
    t.oil -= def.oil;
    t.pop += def.pop;
    b.queue.push(kind);
    if (team === this.playerTeam) this.sound('click');
    return true;
  }

  cancelUnit(team: number, kind: UnitKind): boolean {
    const producers = this.teamBuildings(team, UNITS[kind].producer).filter((b) => b.queue.includes(kind));
    if (!producers.length) return false;
    const b = producers.reduce((a, c) => (c.queue.length > a.queue.length ? c : a));
    const idx = b.queue.lastIndexOf(kind);
    b.queue.splice(idx, 1);
    if (idx === 0) b.prodTime = 0;
    const t = this.teams[team];
    t.credits += UNITS[kind].cost;
    t.oil += UNITS[kind].oil;
    t.pop -= UNITS[kind].pop;
    return true;
  }

  queuedCount(team: number, kind: UnitKind) {
    let n = 0;
    for (const b of this.buildings) if (b.alive && b.team === team) for (const q of b.queue) if (q === kind) n++;
    return n;
  }

  /** Progress 0..1 of the front-most unit of `kind` in production, or -1. */
  queueProgress(team: number, kind: UnitKind) {
    let best = -1;
    for (const b of this.buildings) {
      if (!b.alive || b.team !== team || b.queue[0] !== kind) continue;
      best = Math.max(best, b.prodTime / UNITS[kind].buildTime);
    }
    return best;
  }

  commandMove(units: Unit[], x: number, z: number, attackMove = false) {
    if (!units.length) return;
    x = Math.max(1, Math.min(WORLD_W - 1, x));
    z = Math.max(1, Math.min(WORLD_H - 1, z));
    // Formation: grid facing the direction of travel.
    let cxs = 0;
    let czs = 0;
    for (const u of units) {
      cxs += u.x;
      czs += u.z;
    }
    cxs /= units.length;
    czs /= units.length;
    const ang = Math.atan2(x - cxs, z - czs);
    const cols = Math.ceil(Math.sqrt(units.length));
    const spacing = units.some((u) => u.radius > 0.8) ? 3.0 : 1.8;
    const sorted = [...units].sort((a, b) => b.def.speed - a.def.speed);
    sorted.forEach((u, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const ox = (col - (cols - 1) / 2) * spacing;
      const oz = -row * spacing;
      const gx = x + Math.cos(ang) * ox + Math.sin(ang) * oz;
      const gz = z - Math.sin(ang) * ox + Math.cos(ang) * oz;
      u.order = attackMove ? 'attackMove' : 'move';
      u.target = null;
      u.salvoLeft = 0;
      u.goal = { x: gx, z: gz };
      u.hold = false;
      this.requestPath(u, gx, gz);
    });
  }

  commandAttack(units: Unit[], target: Entity) {
    for (const u of units) {
      if (!this.canTarget(u, target)) {
        // Units that cannot hit this target move next to it instead.
        u.order = 'move';
        u.goal = { x: target.x, z: target.z };
        this.requestPath(u, target.x, target.z);
        continue;
      }
      u.order = 'attack';
      u.target = target;
      u.goal = null;
      u.path = [];
      u.repathTimer = 0;
    }
  }

  commandStop(units: Unit[]) {
    for (const u of units) {
      u.order = 'idle';
      u.target = null;
      u.goal = null;
      u.path = [];
      u.salvoLeft = 0;
    }
  }

  setRally(b: Building, x: number, z: number) {
    b.rally = { x, z };
  }

  sellBuilding(b: Building) {
    if (!b.alive || b.kind === 'hq') return;
    const t = this.teams[b.team];
    t.credits += BUILDINGS[b.kind].cost * ECONOMY.sellRefund * (b.hp / b.maxHp);
    this.destroyBuilding(b, null, true);
    this.sound('cash', b);
  }

  sellOil(team: number, fraction: number) {
    const t = this.teams[team];
    const barrels = Math.floor(t.oil * fraction);
    if (barrels <= 0) return 0;
    const credits = this.oilValue(team, barrels);
    t.oil -= barrels;
    t.credits += credits;
    t.stats.oilSold += barrels;
    t.stats.creditsEarned += credits;
    t.stats.bestPrice = Math.max(t.stats.bestPrice, this.market.price * t.priceMod);
    this.emit({ type: 'sold', team, price: this.market.price, credits });
    if (team === this.playerTeam) this.sound('cash');
    return credits;
  }

  siloReady(b: Building) {
    return b.kind === 'silo' && b.built && b.siloCharge >= ECONOMY.siloCharge;
  }

  launchMissile(silo: Building, x: number, z: number) {
    if (!this.siloReady(silo)) return false;
    silo.siloCharge = 0;
    const from = new THREE.Vector3(silo.x, silo.y + 3, silo.z);
    this.projectiles.launchBallistic(from, new THREE.Vector3(x, this.ground(x, z), z), silo.team, silo);
    this.particles.explosion(from, 2);
    this.sound('launch', silo);
    this.playSound('siren', { volume: 0.8 });
    this.emit({ type: 'missileLaunch', team: silo.team, x, z });
    if (silo.team !== this.playerTeam) this.emit({ type: 'toast', key: 'msg.missileLaunch', tone: 'bad', x, z });
    return true;
  }

  tryIntercept(point: THREE.Vector3, attackerTeam: number, launch: (from: THREE.Vector3) => void) {
    const candidates: { from: THREE.Vector3; chance: number; team: number }[] = [];
    for (const b of this.buildings) {
      if (!b.operational || b.kind !== 'samsite' || b.team === attackerTeam) continue;
      if (Math.hypot(b.x - point.x, b.z - point.z) < 34 && !this.lowPower(b.team))
        candidates.push({ from: new THREE.Vector3(b.x, b.y + 2, b.z), chance: BUILDINGS.samsite.interceptChance!, team: b.team });
    }
    for (const u of this.units) {
      if (!u.alive || u.kind !== 'sam' || u.team === attackerTeam) continue;
      if (Math.hypot(u.x - point.x, u.z - point.z) < 26)
        candidates.push({ from: new THREE.Vector3(u.x, u.y + 2, u.z), chance: UNITS.sam.interceptChance!, team: u.team });
    }
    for (const c of candidates) {
      if (Math.random() < c.chance) {
        launch(c.from);
        this.teams[c.team].stats.intercepts++;
        this.emit({ type: 'intercept', team: c.team });
        return;
      }
    }
  }

  onIntercepted(_point: THREE.Vector3, _attackerTeam: number) {
    this.emit({ type: 'toast', key: 'msg.intercepted', tone: 'good' });
  }

  private requestPath(u: Unit, x: number, z: number) {
    if (u.isAir) {
      u.path = [{ x, z }];
      u.pathIdx = 0;
      return;
    }
    if (!u.pendingPath) this.pathQueue.push({ unit: u, x, z });
    else {
      const q = this.pathQueue.find((p) => p.unit === u);
      if (q) {
        q.x = x;
        q.z = z;
      }
    }
    u.pendingPath = true;
  }

  private processPaths(budgetMs: number) {
    const start = performance.now();
    while (this.pathQueue.length && performance.now() - start < budgetMs) {
      const req = this.pathQueue.shift()!;
      const u = req.unit;
      u.pendingPath = false;
      if (!u.alive) continue;
      const s = worldToCell(u.x, u.z);
      const g = worldToCell(req.x, req.z);
      const sIdx = this.pathfinder.nearestWalkable(clampI(s.cx, GRID_W), clampI(s.cz, GRID_H));
      if (sIdx < 0) continue;
      const cells = this.pathfinder.find(sIdx % GRID_W, Math.floor(sIdx / GRID_W), clampI(g.cx, GRID_W), clampI(g.cz, GRID_H));
      if (!cells) {
        u.path = [];
        continue;
      }
      const smooth = this.pathfinder.smooth(cells);
      u.path = smooth.slice(1).map((c) => ({ x: ((c % GRID_W) + 0.5) * CELL, z: (Math.floor(c / GRID_W) + 0.5) * CELL }));
      // Final waypoint: exact goal if walkable
      const last = cells[cells.length - 1];
      const gIdx = clampI(g.cz, GRID_H) * GRID_W + clampI(g.cx, GRID_W);
      if (last === gIdx && u.path.length) u.path[u.path.length - 1] = { x: req.x, z: req.z };
      u.pathIdx = 0;
      u.stuckTimer = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Combat

  canTarget(u: Unit | Building, target: Entity): boolean {
    const w = u.def.weapon;
    if (!w) return false;
    const air = target.isUnit && target.isAir;
    return w.targets === 'both' || (w.targets === 'air') === air;
  }

  applyDamage(target: Entity, amount: number, type: ProjectileType, team: number, attacker: Entity | null) {
    if (!target.alive) return;
    let mult = DAMAGE_TABLE[type][target.armor];
    if (attacker && attacker.isUnit) mult *= 1 + attacker.vet * 0.15;
    const dmg = amount * mult;
    if (dmg <= 0) return;
    target.hp -= dmg;
    target.lastHurt = this.time;
    // Retaliate if idle
    if (target.isUnit && target.order === 'idle' && !target.target && attacker && attacker.alive && this.canTarget(target, attacker)) {
      target.target = attacker;
    }
    if (target.team === this.playerTeam && this.time - this.lastAlert > 12) {
      this.lastAlert = this.time;
      this.lastAlertPos = { x: target.x, z: target.z };
      this.emit({ type: 'toast', key: target.isUnit ? 'msg.unitsUnderAttack' : 'msg.underAttack', tone: 'warn', x: target.x, z: target.z });
      this.sound('alert');
    }
    if (target.hp <= 0) {
      if (target.isUnit) this.destroyUnit(target, attacker, team);
      else this.destroyBuilding(target, team);
    }
  }

  splash(pos: THREE.Vector3, radius: number, damage: number, type: ProjectileType, team: number, attacker: Entity | null, exclude: Entity | null, ballistic = false) {
    let hitEnemy = false;
    this.hash.query(pos.x, pos.z, radius + 2, this.near);
    for (const u of [...this.near]) {
      if (u === exclude || !u.alive || u.team === team) continue;
      if (u.isAir && !ballistic) continue;
      const d = Math.hypot(u.x - pos.x, u.z - pos.z);
      if (d > radius + u.radius) continue;
      const falloff = 1 - Math.min(1, d / (radius + u.radius)) * 0.6;
      this.applyDamage(u, damage * falloff, type, team, attacker);
      hitEnemy = true;
    }
    for (const b of this.buildings) {
      if (!b.alive || b.team === team || b === exclude) continue;
      const d = Math.hypot(b.x - pos.x, b.z - pos.z) - b.radius;
      if (d > radius) continue;
      this.applyDamage(b, damage * (1 - Math.max(0, d / radius) * 0.6), type, team, attacker);
      hitEnemy = true;
    }
    if (ballistic && hitEnemy) {
      this.teams[team].stats.missileHits++;
      this.emit({ type: 'missileHit', team });
    }
  }

  private destroyUnit(u: Unit, attacker: Entity | null, attackerTeam: number) {
    if (!u.alive) return;
    u.alive = false;
    u.selected = false;
    const pos = v1.set(u.x, u.isAir ? u.altitude : u.y + 0.5, u.z);
    const infantry = u.armor === 'infantry';
    if (infantry) {
      this.particles.impact(pos, false);
    } else {
      this.particles.explosion(pos, u.isAir ? 1.4 : 1.1);
      this.decals.scorch(u.x, u.y, u.z, 3);
      this.decals.flash(pos, 14);
      this.sound('explosion', u);
      if (!u.isAir) this.leaveWreck(u);
    }
    if (u.isAir) this.particles.explosion(v2.set(u.x, u.y + 0.5, u.z), 0.8);
    const t = this.teams[u.team];
    t.pop = Math.max(0, t.pop - u.def.pop);
    t.stats.unitsLost++;
    if (attackerTeam >= 0 && attackerTeam !== u.team) {
      this.teams[attackerTeam].stats.kills++;
      this.emit({ type: 'kill', team: attackerTeam, victimTeam: u.team, building: false });
    }
    if (attacker && attacker.isUnit && attacker.alive) {
      attacker.kills++;
      const vet = attacker.kills >= 12 ? 3 : attacker.kills >= 7 ? 2 : attacker.kills >= 3 ? 1 : 0;
      if (vet > attacker.vet) {
        attacker.vet = vet;
        attacker.maxHp = attacker.def.hp * (1 + vet * 0.1);
        attacker.hp = Math.min(attacker.maxHp, attacker.hp + attacker.def.hp * 0.25);
        attacker.hpBar.setVeterancy(vet);
      }
    }
    this.removeVisuals(u);
  }

  private leaveWreck(u: Unit) {
    const wreck = u.rig.root.clone(true);
    wreck.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.material = WRECK_MAT;
    });
    wreck.position.set(u.x, u.y - 0.1, u.z);
    this.root.add(wreck);
    this.rubble.push({ mesh: wreck, life: 14 });
  }

  destroyBuilding(b: Building, attackerTeam: number | null, sold = false) {
    if (!b.alive) return;
    b.alive = false;
    b.selected = false;
    for (let dz = 0; dz < b.size; dz++) for (let dx = 0; dx < b.size; dx++) this.occ[(b.cz + dz) * GRID_W + b.cx + dx] = 0;
    const t = this.teams[b.team];
    for (const q of b.queue) {
      t.credits += UNITS[q].cost;
      t.oil += UNITS[q].oil;
      t.pop -= UNITS[q].pop;
    }
    b.queue = [];
    if (b.oilField) {
      b.oilField.derrick = null;
      b.oilField.model.visible = true;
      if (!sold) b.oilField.fire = 35;
      if (!sold) this.toast(b.team, 'msg.derrickLost', 'bad', b);
    }
    if (!sold) {
      const s = b.size;
      for (let i = 0; i < 3 + s; i++) {
        v1.set(b.x + (Math.random() - 0.5) * s * 2, b.y + Math.random() * 2, b.z + (Math.random() - 0.5) * s * 2);
        this.particles.explosion(v1, 1.2 + s * 0.3);
      }
      this.decals.scorch(b.x, b.y, b.z, s * 3);
      this.decals.flash(v1.set(b.x, b.y + 2, b.z), 40);
      this.sound('bigExplosion', b, 0.6);
      this.cameraShake(b, 0.6);
      const rubble = new THREE.Mesh(RUBBLE_GEO, WRECK_MAT);
      rubble.scale.set(s * CELL * 0.8, 0.6, s * CELL * 0.8);
      rubble.position.set(b.x, b.y + 0.2, b.z);
      rubble.rotation.y = Math.random();
      this.root.add(rubble);
      this.rubble.push({ mesh: rubble, life: 30 });
      if (attackerTeam !== null && attackerTeam >= 0 && attackerTeam !== b.team) {
        this.teams[attackerTeam].stats.buildingsDestroyed++;
        this.emit({ type: 'kill', team: attackerTeam, victimTeam: b.team, building: true });
      }
    }
    this.removeVisuals(b);
    this.updatePower();
  }

  private removeVisuals(e: Entity) {
    this.root.remove(e.rig.root);
    this.root.remove(e.hpBar.group);
    if (e.ring) this.root.remove(e.ring);
  }

  private findTarget(e: Unit | Building, range: number): Entity | null {
    let best: Entity | null = null;
    let bestScore = Infinity;
    this.hash.query(e.x, e.z, range, this.near);
    for (const u of this.near) {
      if (!u.alive || !this.isEnemy(e.team, u.team) || !this.canTarget(e, u)) continue;
      const d = Math.hypot(u.x - e.x, u.z - e.z);
      if (d > range) continue;
      const score = d - (u.def.weapon ? 2 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = u;
      }
    }
    const w = e.def.weapon;
    if (w && w.targets !== 'air') {
      for (const b of this.buildings) {
        if (!b.alive || !this.isEnemy(e.team, b.team)) continue;
        const d = Math.hypot(b.x - e.x, b.z - e.z) - b.radius;
        if (d > range) continue;
        const score = d + 4 + (b.def.weapon ? -3 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = b;
        }
      }
    }
    return best;
  }

  private fireWeapon(e: Unit | Building, target: Entity | null, point: THREE.Vector3) {
    const w = e.def.weapon!;
    const muzzle = v1;
    if (e.rig.muzzle) {
      e.rig.root.updateMatrixWorld(true);
      e.rig.muzzle.getWorldPosition(muzzle);
    } else muzzle.set(e.x, e.y + 1, e.z);
    const dmg = w.damage;
    const dir = v2.subVectors(point, muzzle).normalize();
    this.particles.muzzle(muzzle, dir, w.projectile === 'shell' || w.projectile === 'artillery');
    this.projectiles.fire(w.projectile, muzzle, target, point, e.team, e, dmg, w.splash ?? 0);
    e.recoil = 1;
    this.sound(w.sound, e, w.projectile === 'bullet' ? 0.5 : 0.8);
  }

  // ---------------------------------------------------------------------------
  // Simulation

  update(dt: number) {
    if (this.ended) dt = Math.min(dt, 0.05);
    this.time += dt;
    this.market.update(dt);
    this.crises.update(dt);

    this.hash.clear();
    for (const u of this.units) if (u.alive) this.hash.insert(u);

    this.processPaths(3);
    this.updateEconomy(dt);
    for (const b of this.buildings) if (b.alive) this.updateBuilding(b, dt);
    for (const u of this.units) if (u.alive) this.updateUnit(u, dt);
    this.projectiles.update(dt);
    this.updateCities(dt);

    // Cleanup
    if (this.units.some((u) => !u.alive)) this.units = this.units.filter((u) => u.alive);
    if (this.buildings.some((b) => !b.alive)) this.buildings = this.buildings.filter((b) => b.alive);
    for (let i = this.rubble.length - 1; i >= 0; i--) {
      const r = this.rubble[i];
      r.life -= dt;
      if (r.life < 3) r.mesh.position.y -= dt * 0.4;
      if (r.life <= 0) {
        this.root.remove(r.mesh);
        this.rubble.splice(i, 1);
      }
    }

    // Fog
    const sightMult = 1 - this.crises.sandstorm * 0.45;
    this.fog.update(dt, this.playerViewers(), sightMult);

    // Oil fires & unclaimed-field pulse
    const pulse = 3.1 + Math.sin(this.time * 3) * 0.25;
    for (const f of this.oilFields) {
      if (f.model.visible) {
        const ring = f.model.getObjectByName('pulse');
        if (ring) ring.scale.setScalar(pulse);
      }
      if (f.fire > 0) {
        f.fire -= dt;
        v1.set(f.x, this.ground(f.x, f.z) + 0.3, f.z);
        if (this.fog.isVisible(f.x, f.z)) {
          this.particles.burning(v1, 2.2, true);
          this.particles.burning(v1, 1.6, true);
        }
      }
    }

    this.elimTimer -= dt;
    if (this.elimTimer <= 0) {
      this.elimTimer = 1;
      this.checkElimination();
    }
  }

  private *playerViewers() {
    for (const u of this.units) if (u.alive && u.team === this.playerTeam) yield u;
    for (const b of this.buildings) if (b.alive && b.team === this.playerTeam) yield b;
    for (const c of this.cities) if (c.owner === this.playerTeam) yield { x: c.x, z: c.z, sight: 12 };
  }

  updatePower() {
    for (const t of this.teams) {
      t.powerProd = 0;
      t.powerUse = 0;
    }
    for (const b of this.buildings) {
      if (!b.alive || !b.built) continue;
      const t = this.teams[b.team];
      const p = b.def.power;
      if (p > 0) t.powerProd += b.kind === 'power' && this.crises.heatwave ? p * 0.7 : p;
      else t.powerUse -= p;
    }
  }

  private updateEconomy(dt: number) {
    this.powerTimer -= dt;
    if (this.powerTimer <= 0) {
      this.powerTimer = 0.5;
      this.updatePower();
    }
    const cityCount = new Map<number, number>();
    for (const c of this.cities) if (c.owner >= 0) cityCount.set(c.owner, (cityCount.get(c.owner) ?? 0) + 1);
    for (const t of this.teams) {
      if (!t.alive) continue;
      const mul = t.isAI ? DIFFICULTY[t.difficulty].income : 1;
      let credits = 0;
      let oil = 0;
      let derricks = 0;
      for (const b of this.buildings) {
        if (!b.alive || b.team !== t.id || !b.built) continue;
        if (b.kind === 'hq') credits += ECONOMY.hqIncome;
        if (b.kind === 'derrick' && b.oilField) {
          oil += ECONOMY.derrickOil * b.oilField.def.richness;
          derricks++;
        }
      }
      for (const c of this.cities)
        if (c.owner === t.id) credits += (c.def.capital ? ECONOMY.capitalIncome : ECONOMY.cityIncome) * (this.crises.drought ? 0.5 : 1);
      t.credits += credits * mul * dt;
      t.oil += oil * mul * dt;
      t.stats.oilPumped += oil * mul * dt;
      t.stats.creditsEarned += credits * mul * dt;
      t.incomeRate = credits * mul + (oil * mul * this.market.price * this.sellEfficiency(t.id)) / ECONOMY.priceDivisor;
      t.stats.maxDerricks = Math.max(t.stats.maxDerricks, derricks);
      t.stats.maxCities = Math.max(t.stats.maxCities, cityCount.get(t.id) ?? 0);
      if (t.priceModTimer > 0) {
        t.priceModTimer -= dt;
        if (t.priceModTimer <= 0) t.priceMod = 1;
      }
      if (t.autoSell && t.oil > 60) {
        const avg = this.market.average;
        const reserve = t.isAI ? 220 : 120;
        if (this.market.price > avg * 1.08 || t.oil > 900) {
          const frac = Math.max(0, (t.oil - reserve) / t.oil);
          if (frac > 0.2) this.sellOil(t.id, frac);
        }
      }
    }
  }

  private updateBuilding(b: Building, dt: number) {
    const t = this.teams[b.team];
    b.animT += dt;
    if (!b.built) {
      const speed = t.isAI ? DIFFICULTY[t.difficulty].buildSpeed : 1;
      b.progress += (dt / b.def.buildTime) * speed;
      b.hp = Math.min(b.maxHp, b.hp + (b.maxHp * 0.9 * dt * speed) / b.def.buildTime);
      if (Math.random() < 0.3 && b.seen) this.particles.build(v1.set(b.x, b.y, b.z), b.size);
      if (b.progress >= 1) {
        b.progress = 1;
        b.built = true;
        this.updatePower();
        this.emit({ type: 'built', team: b.team, kind: b.kind });
        if (b.team === this.playerTeam) {
          this.toast(b.team, 'msg.buildComplete', 'good', b, `bld.${b.kind}`);
          this.sound('complete');
        }
      }
      this.syncBuilding(b, dt);
      return;
    }
    const low = this.lowPower(b.team);
    // Production
    if (b.queue.length) {
      const kind = b.queue[0];
      const speed = (low ? ECONOMY.lowPowerFactor : 1) * (t.isAI ? DIFFICULTY[t.difficulty].buildSpeed : 1);
      b.prodTime += dt * speed;
      if (b.prodTime >= UNITS[kind].buildTime) {
        b.prodTime = 0;
        b.queue.shift();
        const exit = this.buildingExit(b);
        const u = this.spawnUnit(kind, b.team, exit.x, exit.z);
        u.heading = b.heading; // pop was already reserved when queued
        t.stats.unitsBuilt++;
        this.emit({ type: 'trained', team: b.team, kind });
        if (b.rally) this.commandMove([u], b.rally.x, b.rally.z, true);
        else this.commandMove([u], exit.x + Math.sin(b.heading) * 4, exit.z + Math.cos(b.heading) * 4);
        if (b.team === this.playerTeam) {
          this.sound('unitReady');
        }
      }
    }
    // Weapons
    if (b.def.weapon) {
      const w = b.def.weapon;
      b.cooldown -= dt * (low ? 0.5 : 1);
      if (b.target && (!b.target.alive || Math.hypot(b.target.x - b.x, b.target.z - b.z) - (b.target.isUnit ? 0 : b.target.radius) > w.range + 1)) b.target = null;
      b.scanTimer -= dt;
      if (!b.target && b.scanTimer <= 0) {
        b.scanTimer = 0.5;
        b.target = this.findTarget(b, w.range);
      }
      if (b.target) {
        const desired = Math.atan2(b.target.x - b.x, b.target.z - b.z) - b.heading;
        b.turretYaw = turnToward(b.turretYaw, desired, dt * 2.5);
        if (b.cooldown <= 0 && Math.abs(angleDiff(b.turretYaw, desired)) < 0.15) {
          b.cooldown = w.cooldown;
          this.fireWeapon(b, b.target, this.entityAimPoint(b.target, new THREE.Vector3()));
        }
      } else {
        b.turretYaw += dt * 0.2;
      }
    }
    // Silo
    if (b.kind === 'silo') {
      const before = b.siloCharge;
      b.siloCharge = Math.min(ECONOMY.siloCharge, b.siloCharge + dt * (low ? 0.5 : 1));
      if (before < ECONOMY.siloCharge && b.siloCharge >= ECONOMY.siloCharge) this.toast(b.team, 'msg.missileReady', 'good', b);
    }
    this.syncBuilding(b, dt);
  }

  buildingExit(b: Building): Point {
    const d = (b.size * CELL) / 2 + 1.6;
    return { x: b.x + Math.sin(b.heading) * d, z: b.z + Math.cos(b.heading) * d };
  }

  private updateUnit(u: Unit, dt: number) {
    const w = u.def.weapon;
    u.cooldown -= dt;
    u.animT += dt;
    u.recoil = Math.max(0, u.recoil - dt * 3);

    if (u.target && (!u.target.alive || !this.isEnemy(u.team, u.target.team))) {
      u.target = null;
      if (u.order === 'attack') u.order = 'idle';
    }

    // Target acquisition
    u.scanTimer -= dt;
    if (u.scanTimer <= 0) {
      u.scanTimer = 0.35 + Math.random() * 0.1;
      if (!u.target && (u.order === 'idle' || u.order === 'attackMove')) {
        const range = u.order === 'idle' ? Math.max(w.range + 2, u.sight * 0.85) : u.sight;
        u.target = this.findTarget(u, range);
      } else if (u.target && u.order !== 'attack') {
        // Drop targets that escape far beyond sight
        if (Math.hypot(u.target.x - u.x, u.target.z - u.z) > u.sight * 1.5) u.target = null;
      }
    }

    // Artillery / multi-shot salvos
    if (u.salvoLeft > 0) {
      u.salvoTimer -= dt;
      if (u.salvoTimer <= 0 && u.salvoPoint) {
        u.salvoTimer = 0.16;
        u.salvoLeft--;
        const sp = w.projectile === 'artillery' ? 2.6 : 0;
        const tgt = w.projectile === 'artillery' ? null : u.target;
        const pt = tgt && tgt.alive ? this.entityAimPoint(tgt, new THREE.Vector3()) : new THREE.Vector3(u.salvoPoint.x + (Math.random() - 0.5) * sp * 2, 0, u.salvoPoint.z + (Math.random() - 0.5) * sp * 2);
        if (!tgt) pt.y = this.ground(pt.x, pt.z);
        this.fireWeapon(u, tgt, pt);
      }
    }

    let moving = false;
    if (u.target) {
      const t = u.target;
      const dist = Math.hypot(t.x - u.x, t.z - u.z) - (t.isUnit ? t.radius : t.radius);
      const inRange = dist <= w.range && (!w.minRange || dist >= w.minRange);
      if (inRange) {
        u.path = [];
        const desired = Math.atan2(t.x - u.x, t.z - u.z);
        let aligned: boolean;
        if (u.rig.turret) {
          u.turretYaw = turnToward(u.turretYaw, desired - u.heading, dt * 3);
          aligned = Math.abs(angleDiff(u.turretYaw, desired - u.heading)) < 0.15;
        } else {
          u.heading = turnToward(u.heading, desired, dt * (u.isAir ? 3 : 6));
          aligned = Math.abs(angleDiff(u.heading, desired)) < 0.2;
        }
        if (aligned && u.cooldown <= 0 && u.salvoLeft <= 0) {
          u.cooldown = w.cooldown;
          const n = w.salvo ?? 1;
          if (n > 1) {
            u.salvoLeft = n;
            u.salvoTimer = 0;
            u.salvoPoint = { x: t.x, z: t.z };
          } else {
            this.fireWeapon(u, t, this.entityAimPoint(t, new THREE.Vector3()));
          }
        }
      } else if (!u.hold) {
        // Chase
        u.repathTimer -= dt;
        if (u.repathTimer <= 0) {
          u.repathTimer = u.isAir ? 0.3 : 1.2;
          let gx = t.x;
          let gz = t.z;
          if (w.minRange && dist < w.minRange) {
            // Back away to get minimum range
            const a = Math.atan2(u.x - t.x, u.z - t.z);
            gx = t.x + Math.sin(a) * (w.minRange + 4);
            gz = t.z + Math.cos(a) * (w.minRange + 4);
          }
          this.requestPath(u, gx, gz);
        }
        moving = this.followPath(u, dt);
      }
    } else if (u.order === 'move' || u.order === 'attackMove') {
      moving = this.followPath(u, dt);
      if (!moving && !u.pendingPath && u.path.length === 0) {
        u.order = 'idle';
        u.goal = null;
      }
    }
    if (!moving) this.separate(u, dt);
    if (u.isAir) {
      const ground = Math.max(0, this.ground(u.x, u.z));
      const target = ground + (u.kind === 'drone' ? 10 : 7) + Math.sin(u.animT * 1.3) * 0.25;
      u.altitude += (target - u.altitude) * Math.min(1, dt * 2);
      u.y = ground;
      if (u.kind === 'drone' && !moving && !u.target) {
        // Loiter in a circle
        u.heading += dt * 0.6;
        const nx = u.x + Math.sin(u.heading) * u.def.speed * 0.35 * dt;
        const nz = u.z + Math.cos(u.heading) * u.def.speed * 0.35 * dt;
        u.x = clampF(nx, WORLD_W);
        u.z = clampF(nz, WORLD_H);
      }
    } else {
      u.y = this.ground(u.x, u.z);
    }
    u.speedNow += ((moving ? u.def.speed : 0) - u.speedNow) * Math.min(1, dt * 5);
    // Damaged vehicles smoke
    if (u.armor !== 'infantry' && u.hp < u.maxHp * 0.4 && u.seen && Math.random() < 0.3) {
      this.particles.burning(v1.set(u.x, (u.isAir ? u.altitude : u.y) + 0.8, u.z), 0.5, true);
    }
    // Dust trail
    if (moving && !u.isAir && u.armor !== 'infantry' && u.seen) this.particles.dust(v1.set(u.x - Math.sin(u.heading), u.y, u.z - Math.cos(u.heading)), 0.6);
    this.syncUnit(u, dt);
  }

  private walkableAt(x: number, z: number) {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    if (cx < 0 || cz < 0 || cx >= GRID_W || cz >= GRID_H) return false;
    const c = cz * GRID_W + cx;
    return this.map.cellPassable[c] === 1 && this.occ[c] === 0;
  }

  /** Returns true if the unit moved. */
  private followPath(u: Unit, dt: number): boolean {
    if (u.pathIdx >= u.path.length) {
      u.path = [];
      return false;
    }
    const wp = u.path[u.pathIdx];
    const dx = wp.x - u.x;
    const dz = wp.z - u.z;
    const dist = Math.hypot(dx, dz);
    const last = u.pathIdx === u.path.length - 1;
    if (dist < (last ? 0.5 : 1.4)) {
      u.pathIdx++;
      if (u.pathIdx >= u.path.length) {
        u.path = [];
        return false;
      }
      return true;
    }
    let desired = Math.atan2(dx, dz);
    // Separation steering
    let sx = 0;
    let sz = 0;
    this.hash.query(u.x, u.z, 3, this.near);
    for (const o of this.near) {
      if (o === u || !o.alive || o.isAir !== u.isAir) continue;
      const ox = u.x - o.x;
      const oz = u.z - o.z;
      const d = Math.hypot(ox, oz);
      const min = u.radius + o.radius + 0.25;
      if (d < min && d > 0.001) {
        sx += (ox / d) * (min - d);
        sz += (oz / d) * (min - d);
      }
    }
    if (sx || sz) {
      const ax = Math.sin(desired) + sx * 0.8;
      const az = Math.cos(desired) + sz * 0.8;
      desired = Math.atan2(ax, az);
    }
    const turnRate = u.armor === 'infantry' ? 12 : u.isAir ? 3 : u.kind === 'tank' ? 2.4 : 3.2;
    u.heading = turnToward(u.heading, desired, turnRate * dt);
    const align = Math.max(0, Math.cos(angleDiff(u.heading, desired)));
    let speed = u.def.speed * (u.armor === 'infantry' ? 1 : 0.25 + 0.75 * align);
    if (last) speed = Math.min(speed, dist * 3 + 0.5);
    const step = speed * dt;
    const nx = u.x + Math.sin(u.heading) * step;
    const nz = u.z + Math.cos(u.heading) * step;
    if (u.isAir) {
      u.x = clampF(nx, WORLD_W);
      u.z = clampF(nz, WORLD_H);
      return true;
    }
    if (this.walkableAt(nx, nz)) {
      u.x = nx;
      u.z = nz;
      u.stuckTimer = Math.max(0, u.stuckTimer - dt);
    } else if (this.walkableAt(nx, u.z)) {
      u.x = nx;
      u.stuckTimer += dt * 0.5;
    } else if (this.walkableAt(u.x, nz)) {
      u.z = nz;
      u.stuckTimer += dt * 0.5;
    } else {
      u.stuckTimer += dt;
    }
    if (u.stuckTimer > 1.2) {
      u.stuckTimer = 0;
      const g = u.path[u.path.length - 1];
      this.requestPath(u, g.x, g.z);
    }
    return true;
  }

  private separate(u: Unit, dt: number) {
    this.hash.query(u.x, u.z, 3, this.near);
    let sx = 0;
    let sz = 0;
    for (const o of this.near) {
      if (o === u || !o.alive || o.isAir !== u.isAir) continue;
      const ox = u.x - o.x;
      const oz = u.z - o.z;
      const d = Math.hypot(ox, oz);
      const min = u.radius + o.radius + 0.2;
      if (d < min) {
        if (d < 0.001) {
          sx += Math.random() - 0.5;
          sz += Math.random() - 0.5;
        } else {
          sx += (ox / d) * (min - d);
          sz += (oz / d) * (min - d);
        }
      }
    }
    if (!sx && !sz) return;
    const nx = u.x + sx * dt * 3;
    const nz = u.z + sz * dt * 3;
    if (u.isAir || this.walkableAt(nx, nz)) {
      u.x = clampF(nx, WORLD_W);
      u.z = clampF(nz, WORLD_H);
    }
  }

  private updateCities(dt: number) {
    for (const c of this.cities) {
      this.hash.query(c.x, c.z, ECONOMY.captureRadius + 1, this.near);
      const present = new Set<number>();
      const capturers = new Set<number>();
      for (const u of this.near) {
        if (!u.alive || u.isAir || Math.hypot(u.x - c.x, u.z - c.z) > ECONOMY.captureRadius) continue;
        present.add(u.team);
        if (u.def.canCapture) capturers.add(u.team);
      }
      if (capturers.size === 1 && present.size === 1) {
        const team = [...capturers][0];
        if (team === c.owner) {
          c.captureProgress = 0;
          c.captureTeam = -1;
          continue;
        }
        if (c.captureTeam !== team) {
          c.captureTeam = team;
          c.captureProgress = 0;
        }
        c.captureProgress += dt;
        if (c.captureProgress >= ECONOMY.captureTime) {
          const prev = c.owner;
          c.owner = team;
          c.captureProgress = 0;
          c.captureTeam = -1;
          c.rig.flagMat.color.setHex(this.teams[team].theme.color);
          this.emit({ type: 'captured', team, city: c });
          if (team === this.playerTeam) {
            this.toast(team, 'msg.cityCaptured', 'good', c, undefined);
            this.sound('capture');
          }
          if (prev === this.playerTeam) this.toast(prev, 'msg.cityLost', 'bad', c);
        }
      } else if (capturers.size === 0) {
        c.captureProgress = Math.max(0, c.captureProgress - dt * 0.5);
        if (c.captureProgress === 0) c.captureTeam = -1;
      }
      c.rig.flag.rotation.y = Math.sin(this.time * 1.7 + c.x) * 0.35;
    }
  }

  private sabotage() {
    const derricks = this.buildings.filter((b) => b.alive && b.kind === 'derrick' && b.built);
    if (!derricks.length) return;
    const d = derricks[Math.floor(Math.random() * derricks.length)];
    this.particles.explosion(v1.set(d.x, d.y + 1, d.z), 1.5);
    this.applyDamage(d, d.maxHp * 0.65, 'artillery', -1, null);
    if (d.oilField) d.oilField.fire = Math.max(d.oilField.fire, 15);
    this.toast(d.team, 'event.sabotage', 'bad', d);
  }

  private sanctionLeader(duration: number) {
    let leader: Team | null = null;
    let best = -1;
    for (const t of this.teams) {
      if (!t.alive) continue;
      const score = this.buildings.filter((b) => b.alive && b.team === t.id).length * 2 + this.units.filter((u) => u.alive && u.team === t.id).length;
      if (score > best) {
        best = score;
        leader = t;
      }
    }
    if (leader) {
      leader.priceMod = 0.6;
      leader.priceModTimer = duration;
    }
  }

  private checkElimination() {
    if (this.ended) return;
    for (const t of this.teams) {
      if (!t.alive) continue;
      const hasBase = this.buildings.some((b) => b.alive && b.team === t.id && b.kind !== 'derrick');
      if (!hasBase) {
        t.alive = false;
        for (const u of this.units) if (u.alive && u.team === t.id) this.destroyUnit(u, null, -1);
        for (const b of this.buildings) if (b.alive && b.team === t.id) this.destroyBuilding(b, null);
        for (const c of this.cities)
          if (c.owner === t.id) {
            c.owner = -1;
            c.rig.flagMat.color.setHex(0xe8e2d4);
          }
        this.emit({ type: 'eliminated', team: t.id });
      }
    }
    const player = this.teams[this.playerTeam];
    if (!player.alive) {
      this.ended = true;
      this.fog.enabled = false;
      this.emit({ type: 'end', victory: false });
    } else if (this.teams.every((t) => t.id === this.playerTeam || !t.alive)) {
      this.ended = true;
      this.emit({ type: 'end', victory: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Visual sync

  private syncUnit(u: Unit, dt: number) {
    const rig = u.rig;
    const r = rig.root;
    u.seen = u.team === this.playerTeam || this.fog.isVisible(u.x, u.z);
    r.visible = u.seen;
    const y = u.isAir ? u.altitude : u.y;
    r.position.set(u.x, y, u.z);
    r.rotation.y = u.heading;
    const moving = u.speedNow > 0.3;
    if (!u.isAir && u.armor !== 'infantry') {
      // Tilt with terrain
      const fx = Math.sin(u.heading);
      const fz = Math.cos(u.heading);
      const hf = this.ground(u.x + fx, u.z + fz);
      const hb = this.ground(u.x - fx, u.z - fz);
      const hr = this.ground(u.x + fz, u.z - fx);
      const hl = this.ground(u.x - fz, u.z + fx);
      rig.body.rotation.x = Math.atan2(hb - hf, 2) * 0.9;
      rig.body.rotation.z = Math.atan2(hr - hl, 2) * 0.9;
      if (moving) rig.body.position.y = Math.sin(u.animT * 18) * 0.025;
    }
    if (u.isAir) {
      rig.body.rotation.x = u.kind === 'heli' ? (moving ? 0.18 : 0) : 0;
      rig.body.rotation.z = u.kind === 'drone' && !moving ? -0.25 : 0;
    }
    if (rig.turret) rig.turret.rotation.y = u.turretYaw;
    if (rig.barrel) rig.barrel.position.z = (rig.barrel.userData.z0 ?? 0) - u.recoil * 0.25;
    if (rig.launcher) {
      const want = u.kind === 'rocket' ? (u.target ? -0.7 : -0.05) : -0.45 - (u.target ? 0.25 : 0);
      rig.launcher.rotation.x += (want - rig.launcher.rotation.x) * Math.min(1, dt * 2);
    }
    for (const wh of rig.wheels) wh.rotation.x += u.speedNow * dt * 4;
    if (rig.legs.length) {
      const swing = moving ? Math.sin(u.animT * 11) * 0.6 : 0;
      rig.legs[0].rotation.x = swing;
      rig.legs[1].rotation.x = -swing;
      rig.body.position.y = moving ? Math.abs(Math.sin(u.animT * 11)) * 0.05 : 0;
    }
    for (const ro of rig.rotors) ro.obj.rotation[ro.axis] += ro.speed * dt;
    for (const d of rig.dishes) d.rotation.y += dt * 1.5;
    // HP bar & ring
    const showBar = u.seen && (u.selected || u.hp < u.maxHp);
    u.hpBar.group.visible = showBar;
    if (showBar) {
      u.hpBar.set(u.hp / u.maxHp);
      u.hpBar.group.position.set(u.x, y + (u.isAir ? 1.4 : u.radius * 1.6 + 1.1), u.z);
      if (this.camera) u.hpBar.group.quaternion.copy(this.camera.quaternion);
    }
    if (u.ring) {
      u.ring.visible = u.selected && u.seen;
      if (u.ring.visible) u.ring.position.set(u.x, u.y + 0.15, u.z);
    }
  }

  private syncBuilding(b: Building, dt: number) {
    const rig = b.rig;
    b.seen = b.team === this.playerTeam || this.fog.isExplored(b.x, b.z);
    rig.root.visible = b.seen;
    const p = b.built ? 1 : b.progress;
    const ease = 1 - Math.pow(1 - p, 3);
    rig.root.scale.set(1, Math.max(0.03, ease), 1);
    if (b.built) {
      if (rig.turret) rig.turret.rotation.y = b.turretYaw;
      if (rig.barrel) rig.barrel.position.z = (rig.barrel.userData.z0 ?? 0) - b.recoil * 0.3;
      b.recoil = Math.max(0, b.recoil - dt * 3);
      if (rig.beam) rig.beam.rotation.x = Math.sin(b.animT * 1.6) * 0.32;
      for (const d of rig.dishes) d.rotation.y += dt * 1.2;
      for (const bl of rig.blinkers) bl.visible = Math.sin(b.animT * 4 + bl.position.x) > 0;
      if (rig.flag) rig.flag.rotation.y = Math.sin(b.animT * 1.8) * 0.4;
      if (b.kind === 'silo') {
        const ready = this.siloReady(b);
        for (let i = 0; i < rig.doors.length; i++) {
          const d = rig.doors[i];
          const target = (i === 0 ? -1 : 1) * (ready ? 2.2 : 0.75);
          d.position.x += (target - d.position.x) * Math.min(1, dt * 1.5);
        }
        if (rig.missile) {
          rig.missile.visible = b.siloCharge > ECONOMY.siloCharge * 0.6;
          const targetY = ready ? 0.4 : -2.5;
          rig.missile.position.y += (targetY - rig.missile.position.y) * Math.min(1, dt * 0.8);
        }
      }
      if (b.seen && this.camera) {
        const lowPwr = this.lowPower(b.team);
        for (const e of rig.emitters) {
          e.obj.getWorldPosition(v1);
          if (e.kind === 'steam' && !lowPwr) this.particles.steam(v1);
          else if (e.kind === 'smoke') this.particles.chimney(v1);
          else if (e.kind === 'flare') this.particles.flare(v1);
        }
      }
    }
    // Damage fire
    if (b.hp < b.maxHp * 0.5 && b.seen && b.built) {
      const intensity = 1 - b.hp / b.maxHp;
      this.particles.burning(v1.set(b.x + (Math.random() - 0.5) * b.size, b.y + 1.5, b.z + (Math.random() - 0.5) * b.size), intensity, true);
    }
    const showBar = b.seen && (b.selected || b.hp < b.maxHp || !b.built);
    b.hpBar.group.visible = showBar;
    if (showBar) {
      if (!b.built) b.hpBar.set(b.progress, true);
      else b.hpBar.set(b.hp / b.maxHp);
      b.hpBar.group.position.set(b.x, b.y + b.size * 1.6 + 1.5, b.z);
      if (this.camera) b.hpBar.group.quaternion.copy(this.camera.quaternion);
    }
    if (b.ring) b.ring.visible = b.selected && b.seen;
  }

  dispose() {
    this.scene.remove(this.root);
    this.projectiles.clear();
    this.listeners.clear();
    // Free GPU memory. Shared/cached resources are transparently re-uploaded if used again.
    disposeObject(this.root);
  }
}

const WRECK_MAT = new THREE.MeshStandardMaterial({ color: 0x1d1a17, roughness: 1, flatShading: true });
const RUBBLE_GEO = (() => {
  const g = new THREE.DodecahedronGeometry(0.6, 0);
  g.translate(0, 0.2, 0);
  return g;
})();

export function angleDiff(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function turnToward(current: number, target: number, maxStep: number) {
  const d = angleDiff(current, target);
  if (Math.abs(d) <= maxStep) return current + d;
  return current + Math.sign(d) * maxStep;
}

function clampI(v: number, max: number) {
  return Math.max(0, Math.min(max - 1, v));
}

function clampF(v: number, max: number) {
  return Math.max(0.5, Math.min(max - 0.5, v));
}

function shuffleTop<T>(arr: T[], n: number): T[] {
  // Pick n of the farthest options with a little randomness among the top n+1.
  const pool = arr.slice(0, Math.min(arr.length, n + 1));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}
