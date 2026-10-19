import * as THREE from 'three';
import type { BuildingDef, BuildingKind, Difficulty, TeamTheme, UnitDef, UnitKind } from './config';
import type { CityDef, OilFieldDef } from '../geo/geography';
import type { CityRig, ModelRig } from './models';

let nextId = 1;
export const newId = () => nextId++;

export interface TeamStats {
  unitsBuilt: number;
  unitsLost: number;
  kills: number;
  buildingsDestroyed: number;
  oilPumped: number;
  oilSold: number;
  creditsEarned: number;
  maxCities: number;
  maxDerricks: number;
  missileHits: number;
  intercepts: number;
  bestPrice: number;
}

export interface Team {
  id: number;
  theme: TeamTheme;
  isAI: boolean;
  difficulty: Difficulty;
  credits: number;
  oil: number;
  powerProd: number;
  powerUse: number;
  pop: number;
  alive: boolean;
  startX: number;
  startZ: number;
  regionId: string;
  /** Multiplier on oil sale price (sanctions). */
  priceMod: number;
  priceModTimer: number;
  autoSell: boolean;
  stats: TeamStats;
  /** Accumulates fractional income. */
  incomeRate: number;
}

export function newTeam(id: number, theme: TeamTheme, isAI: boolean, difficulty: Difficulty, credits: number): Team {
  return {
    id,
    theme,
    isAI,
    difficulty,
    credits,
    oil: 100,
    powerProd: 0,
    powerUse: 0,
    pop: 0,
    alive: true,
    startX: 0,
    startZ: 0,
    regionId: '',
    priceMod: 1,
    priceModTimer: 0,
    autoSell: isAI,
    incomeRate: 0,
    stats: {
      unitsBuilt: 0,
      unitsLost: 0,
      kills: 0,
      buildingsDestroyed: 0,
      oilPumped: 0,
      oilSold: 0,
      creditsEarned: 0,
      maxCities: 0,
      maxDerricks: 0,
      missileHits: 0,
      intercepts: 0,
      bestPrice: 0,
    },
  };
}

export type Order = 'idle' | 'move' | 'attack' | 'attackMove';

export interface Point {
  x: number;
  z: number;
}

export class HealthBar {
  readonly group = new THREE.Group();
  private fg: THREE.Mesh;
  private chevrons: THREE.Mesh[] = [];
  private width: number;

  constructor(width: number, private teamColor: number, private isPlayer: boolean) {
    this.width = width;
    const bg = new THREE.Mesh(HealthBar.geo(), HealthBar.bgMat());
    bg.scale.set(width + 0.12, 0.32, 1);
    bg.renderOrder = 10;
    this.fg = new THREE.Mesh(HealthBar.geo(), new THREE.MeshBasicMaterial({ color: 0x44dd55, depthTest: false, transparent: true, fog: false }));
    this.fg.scale.set(width, 0.2, 1);
    this.fg.position.z = 0.01;
    this.fg.renderOrder = 11;
    this.group.add(bg, this.fg);
    this.group.visible = false;
  }

  set(frac: number, building = false) {
    frac = Math.max(0, Math.min(1, frac));
    this.fg.scale.x = Math.max(0.0001, this.width * frac);
    this.fg.position.x = -(this.width * (1 - frac)) / 2;
    const m = this.fg.material as THREE.MeshBasicMaterial;
    if (building) m.color.setHex(0xf5c542);
    else if (!this.isPlayer) m.color.setHex(this.teamColor);
    else m.color.setHex(frac > 0.6 ? 0x44dd55 : frac > 0.3 ? 0xf5c542 : 0xef4444);
  }

  setVeterancy(level: number) {
    while (this.chevrons.length < level) {
      const c = new THREE.Mesh(HealthBar.chevGeo(), HealthBar.chevMat());
      c.position.set(-this.width / 2 + this.chevrons.length * 0.38, 0.38, 0.02);
      c.renderOrder = 12;
      this.group.add(c);
      this.chevrons.push(c);
    }
  }

  private static _geo: THREE.PlaneGeometry;
  private static _chevGeo: THREE.BufferGeometry;
  private static _bg: THREE.MeshBasicMaterial;
  private static _chev: THREE.MeshBasicMaterial;
  static geo() {
    return (this._geo ??= new THREE.PlaneGeometry(1, 1));
  }
  static chevGeo() {
    if (!this._chevGeo) {
      const s = new THREE.Shape();
      s.moveTo(-0.15, 0);
      s.lineTo(0, 0.15);
      s.lineTo(0.15, 0);
      s.lineTo(0.15, -0.08);
      s.lineTo(0, 0.07);
      s.lineTo(-0.15, -0.08);
      this._chevGeo = new THREE.ShapeGeometry(s);
    }
    return this._chevGeo;
  }
  static bgMat() {
    return (this._bg ??= new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.75, depthTest: false, fog: false }));
  }
  static chevMat() {
    return (this._chev ??= new THREE.MeshBasicMaterial({ color: 0xffd34d, depthTest: false, fog: false }));
  }
}

abstract class EntityBase {
  readonly id = newId();
  alive = true;
  hp: number;
  maxHp: number;
  x: number;
  z: number;
  y = 0;
  heading = 0;
  selected = false;
  /** Visible to the local player (fog of war). */
  seen = true;
  lastHurt = -999;
  hpBar: HealthBar;
  ring: THREE.Mesh | null = null;

  constructor(
    public team: number,
    readonly rig: ModelRig,
    x: number,
    z: number,
    hp: number,
    barWidth: number,
    teamColor: number,
    isPlayer: boolean,
  ) {
    this.x = x;
    this.z = z;
    this.hp = hp;
    this.maxHp = hp;
    this.hpBar = new HealthBar(barWidth, teamColor, isPlayer);
  }
}

export class Unit extends EntityBase {
  readonly isUnit = true as const;
  readonly kind: UnitKind;
  path: Point[] = [];
  pathIdx = 0;
  pendingPath = false;
  order: Order = 'idle';
  goal: Point | null = null;
  target: Entity | null = null;
  cooldown = 0;
  turretYaw = 0;
  salvoLeft = 0;
  salvoTimer = 0;
  salvoPoint: Point | null = null;
  kills = 0;
  vet = 0;
  animT = Math.random() * 10;
  recoil = 0;
  scanTimer = Math.random() * 0.4;
  repathTimer = 0;
  stuckTimer = 0;
  speedNow = 0;
  vx = 0;
  vz = 0;
  altitude = 0;
  hold = false;

  constructor(readonly def: UnitDef, team: number, rig: ModelRig, x: number, z: number, teamColor: number, isPlayer: boolean) {
    super(team, rig, x, z, def.hp, def.air ? 2.2 : def.radius > 0.6 ? 2.0 : 1.2, teamColor, isPlayer);
    this.kind = def.kind;
  }

  get radius() {
    return this.def.radius;
  }
  get sight() {
    return this.def.sight;
  }
  get armor() {
    return this.def.armor;
  }
  get isAir() {
    return !!this.def.air;
  }
}

export class Building extends EntityBase {
  readonly isUnit = false as const;
  readonly kind: BuildingKind;
  readonly cx: number;
  readonly cz: number;
  readonly size: number;
  progress = 0;
  built = false;
  queue: UnitKind[] = [];
  prodTime = 0;
  rally: Point | null = null;
  cooldown = 0;
  turretYaw = 0;
  target: Entity | null = null;
  scanTimer = Math.random() * 0.5;
  oilField: OilField | null = null;
  siloCharge = 0;
  recoil = 0;
  animT = Math.random() * 10;
  burn = 0;

  constructor(readonly def: BuildingDef, team: number, rig: ModelRig, cx: number, cz: number, cell: number, teamColor: number, isPlayer: boolean) {
    const x = (cx + def.size / 2) * cell;
    const z = (cz + def.size / 2) * cell;
    super(team, rig, x, z, def.hp, def.size * 1.4, teamColor, isPlayer);
    this.kind = def.kind;
    this.cx = cx;
    this.cz = cz;
    this.size = def.size;
  }

  get radius() {
    return (this.def.size * 2) / 2;
  }
  get sight() {
    return this.def.sight;
  }
  get armor() {
    return 'structure' as const;
  }
  get isAir() {
    return false;
  }
  get operational() {
    return this.built && this.alive;
  }
}

export type Entity = Unit | Building;

export class City {
  owner = -1;
  captureTeam = -1;
  captureProgress = 0;
  label: THREE.Sprite | null = null;
  constructor(
    readonly def: CityDef,
    readonly x: number,
    readonly z: number,
    readonly rig: CityRig,
  ) {}
}

export class OilField {
  derrick: Building | null = null;
  fire = 0;
  constructor(
    readonly def: OilFieldDef,
    readonly cx: number,
    readonly cz: number,
    readonly x: number,
    readonly z: number,
    readonly model: THREE.Group,
  ) {}
}
