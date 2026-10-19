import type { BuildingDef, StrikeKind, UnitDef, WeaponDef } from './defs';

export type OrderType = 'idle' | 'move' | 'attack' | 'attackMove' | 'build' | 'repair' | 'capture' | 'strike' | 'rtb' | 'docked' | 'kamikaze' | 'guard';

export interface WeaponState {
  def: WeaponDef;
  cooldown: number;
  ammo: number;
  salvoLeft: number;
  salvoTimer: number;
  salvoX: number;
  salvoZ: number;
  /** Entity id or projectile id (munition targets are negative). */
  target: number;
}

function weaponStates(defs: WeaponDef[]): WeaponState[] {
  return defs.map((def) => ({ def, cooldown: 0, ammo: def.ammo ?? Infinity, salvoLeft: 0, salvoTimer: 0, salvoX: 0, salvoZ: 0, target: 0 }));
}

abstract class EntityBase {
  alive = true;
  hp: number;
  maxHp: number;
  heading = 0;
  pHeading = 0;
  px: number;
  pz: number;
  lastHurt = -1e9;
  lastAttacker = 0;
  weapons: WeaponState[];
  turretYaw = 0;
  pTurretYaw = 0;
  /** Seconds of EMP disable remaining. */
  emp = 0;
  /** Renderer-owned scratch (instance slot etc.). Never read by the sim. */
  view: unknown = null;

  constructor(
    readonly id: number,
    public owner: number,
    public x: number,
    public z: number,
    hp: number,
    weapons: WeaponDef[],
  ) {
    this.px = x;
    this.pz = z;
    this.hp = hp;
    this.maxHp = hp;
    this.weapons = weaponStates(weapons);
  }
}

export class Unit extends EntityBase {
  readonly isUnit = true as const;
  /** Altitude above ground, km (air units). */
  y = 0;
  py = 0;
  speed = 0;
  vx = 0;
  vz = 0;
  /** Visual pitch/roll hints for the renderer (radians). */
  bank = 0;
  order: OrderType = 'idle';
  /** Final destination (move/attackMove/build...). */
  gx = 0;
  gz = 0;
  /** Formation offset applied to the final waypoint. */
  fx = 0;
  fz = 0;
  path: number[] = [];
  pathIdx = 0;
  pathPending = false;
  /** Shared path request id for groups. */
  pathReq = 0;
  target = 0;
  /** Building being constructed / repaired, city being captured. */
  task = -1;
  stuck = 0;
  scan = 0;
  hold = false;
  kills = 0;
  vet = 0;
  deployed = false;
  deployT = 0;
  fuel: number;
  home = 0;
  strikeCd = 0;
  jammed = 0;
  /** Revealed despite stealth (seconds). */
  revealed = 0;
  /** Queue of further move waypoints (shift-queue). */
  queue: number[] = [];
  /** Strategic road march: fast, but weapons stowed. */
  convoy = false;
  /** Orbit centre for loitering aircraft. */
  ox = 0;
  oz = 0;

  constructor(
    id: number,
    readonly def: UnitDef,
    owner: number,
    x: number,
    z: number,
  ) {
    super(id, owner, x, z, def.hp, def.weapons);
    this.fuel = def.endurance ?? Infinity;
    this.ox = x;
    this.oz = z;
  }

  get radius() {
    return this.def.radius;
  }
  get isAir() {
    return this.def.domain === 'air';
  }
  get isNaval() {
    return this.def.domain === 'sea';
  }
  get armor() {
    return this.def.armor;
  }
}

export class Building extends EntityBase {
  readonly isUnit = false as const;
  progress = 0;
  built = false;
  queue: string[] = [];
  prodTime = 0;
  rallyX = NaN;
  rallyZ = NaN;
  research = '';
  researchT = 0;
  /** HQ tier upgrade in progress (target tier, 0 = none). */
  upgrade = 0;
  upgradeT = 0;
  strikeCd = 0;
  oilField = -1;
  /** Builders currently working on it. */
  workers = 0;
  readonly half: number;

  constructor(
    id: number,
    readonly def: BuildingDef,
    owner: number,
    x: number,
    z: number,
  ) {
    super(id, owner, x, z, def.hp, def.weapons ?? []);
    this.half = def.size / 2;
    this.strikeCd = def.strikeReload ?? 0;
  }

  get radius() {
    return this.half * 1.2;
  }
  get isAir() {
    return false;
  }
  get isNaval() {
    return false;
  }
  get armor() {
    return 'structure' as const;
  }
  get operational() {
    return this.alive && this.built && this.emp <= 0;
  }
}

export type Entity = Unit | Building;

export interface Projectile {
  id: number;
  /** Weapon id or strike kind (for visuals/sounds). */
  kind: string;
  delivery: WeaponDef['delivery'] | 'warhead';
  strike?: StrikeKind;
  owner: number;
  source: number;
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  speed: number;
  /** Target entity id (>0), target projectile id (<0) or 0 for point. */
  target: number;
  tx: number;
  tz: number;
  damage: number;
  splash: number;
  pk: number;
  /** Interceptable by T_MUNITION / T_BALLISTIC weapons. */
  threat: number;
  evasion: number;
  radarMul: number;
  /** Parametric arcs: elapsed / total flight time, launch point and apex height. */
  t: number;
  dur: number;
  sx: number;
  sz: number;
  apex: number;
  life: number;
  /** Interceptors already assigned (avoid overkill). */
  engaged: number;
  alive: boolean;
}

export class City {
  owner: number;
  captureBy = 0;
  capture = 0;
  garrison: number;
  maxGarrison: number;
  /** Seconds since last bombardment (stability effects). */
  shelled = 1e9;
  constructor(
    readonly idx: number,
    readonly x: number,
    readonly z: number,
    readonly pop: number,
    readonly capital: boolean,
    readonly origin: number,
    readonly radius: number,
  ) {
    this.owner = origin;
    this.maxGarrison = Math.round(150 + 120 * Math.sqrt(pop / 1e6));
    this.garrison = this.maxGarrison;
  }
}

export class OilField {
  derrick = 0;
  fire = 0;
  constructor(
    readonly idx: number,
    readonly x: number,
    readonly z: number,
    readonly rich: number,
    readonly offshore: boolean,
  ) {}
}
