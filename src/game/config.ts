export type UnitKind = 'rifleman' | 'rpg' | 'technical' | 'tank' | 'rocket' | 'sam' | 'heli' | 'drone';
export type BuildingKind =
  | 'hq'
  | 'power'
  | 'barracks'
  | 'factory'
  | 'airfield'
  | 'derrick'
  | 'refinery'
  | 'turret'
  | 'samsite'
  | 'silo';
export type ArmorType = 'infantry' | 'light' | 'heavy' | 'air' | 'structure';
export type ProjectileType = 'bullet' | 'shell' | 'rocket' | 'artillery' | 'missile';
export type TargetFilter = 'ground' | 'air' | 'both';

export interface WeaponDef {
  damage: number;
  range: number;
  minRange?: number;
  cooldown: number;
  projectile: ProjectileType;
  targets: TargetFilter;
  splash?: number;
  salvo?: number;
  sound: SfxName;
}

export interface UnitDef {
  kind: UnitKind;
  cost: number;
  oil: number;
  buildTime: number;
  hp: number;
  speed: number;
  armor: ArmorType;
  sight: number;
  radius: number;
  pop: number;
  weapon: WeaponDef;
  producer: BuildingKind;
  air?: boolean;
  canCapture?: boolean;
  /** SAM units can intercept ballistic missiles. */
  interceptChance?: number;
  hotkey: string;
}

export interface BuildingDef {
  kind: BuildingKind;
  cost: number;
  oil: number;
  buildTime: number;
  hp: number;
  size: number; // footprint in cells
  power: number; // + produces, - consumes
  sight: number;
  requires: BuildingKind[];
  weapon?: WeaponDef;
  interceptChance?: number;
  produces?: UnitKind[];
  onOil?: boolean;
  limit?: number;
  hotkey: string;
}

export type SfxName =
  | 'rifle'
  | 'mg'
  | 'cannon'
  | 'rocket'
  | 'missile'
  | 'artillery'
  | 'explosion'
  | 'bigExplosion'
  | 'click'
  | 'select'
  | 'ack'
  | 'place'
  | 'complete'
  | 'unitReady'
  | 'cash'
  | 'siren'
  | 'alert'
  | 'achievement'
  | 'capture'
  | 'error'
  | 'launch'
  | 'intercept'
  | 'victory'
  | 'defeat';

export const UNITS: Record<UnitKind, UnitDef> = {
  rifleman: {
    kind: 'rifleman', cost: 100, oil: 0, buildTime: 4, hp: 90, speed: 3.4, armor: 'infantry', sight: 11, radius: 0.45, pop: 1,
    producer: 'barracks', canCapture: true, hotkey: 'Q',
    weapon: { damage: 9, range: 7, cooldown: 0.8, projectile: 'bullet', targets: 'ground', sound: 'rifle' },
  },
  rpg: {
    kind: 'rpg', cost: 220, oil: 0, buildTime: 6, hp: 95, speed: 3.0, armor: 'infantry', sight: 11, radius: 0.45, pop: 1,
    producer: 'barracks', canCapture: true, hotkey: 'W',
    weapon: { damage: 48, range: 8.5, cooldown: 2.4, projectile: 'rocket', targets: 'both', sound: 'rocket' },
  },
  technical: {
    kind: 'technical', cost: 320, oil: 15, buildTime: 7, hp: 200, speed: 7.5, armor: 'light', sight: 14, radius: 0.9, pop: 2,
    producer: 'factory', hotkey: 'Q',
    weapon: { damage: 7, range: 8.5, cooldown: 0.2, projectile: 'bullet', targets: 'both', sound: 'mg' },
  },
  tank: {
    kind: 'tank', cost: 750, oil: 40, buildTime: 12, hp: 650, speed: 4.2, armor: 'heavy', sight: 12, radius: 1.1, pop: 3,
    producer: 'factory', hotkey: 'W',
    weapon: { damage: 80, range: 10.5, cooldown: 2.6, projectile: 'shell', targets: 'ground', sound: 'cannon', splash: 1.2 },
  },
  rocket: {
    kind: 'rocket', cost: 950, oil: 60, buildTime: 15, hp: 260, speed: 3.8, armor: 'light', sight: 12, radius: 1.1, pop: 3,
    producer: 'factory', hotkey: 'E',
    weapon: { damage: 42, range: 26, minRange: 6, cooldown: 9, projectile: 'artillery', targets: 'ground', splash: 3.2, salvo: 6, sound: 'artillery' },
  },
  sam: {
    kind: 'sam', cost: 700, oil: 35, buildTime: 12, hp: 280, speed: 4.2, armor: 'light', sight: 18, radius: 1.0, pop: 3,
    producer: 'factory', hotkey: 'R', interceptChance: 0.35,
    weapon: { damage: 75, range: 18, cooldown: 2.2, projectile: 'missile', targets: 'air', sound: 'missile' },
  },
  heli: {
    kind: 'heli', cost: 1300, oil: 90, buildTime: 18, hp: 420, speed: 10, armor: 'air', sight: 16, radius: 1.4, pop: 4,
    producer: 'airfield', air: true, hotkey: 'Q',
    weapon: { damage: 38, range: 12, cooldown: 1.3, projectile: 'rocket', targets: 'ground', sound: 'rocket', salvo: 2 },
  },
  drone: {
    kind: 'drone', cost: 450, oil: 25, buildTime: 10, hp: 130, speed: 13, armor: 'air', sight: 26, radius: 0.9, pop: 2,
    producer: 'airfield', air: true, hotkey: 'W',
    weapon: { damage: 26, range: 10, cooldown: 1.8, projectile: 'missile', targets: 'ground', sound: 'missile' },
  },
};

export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
  hq: { kind: 'hq', cost: 3000, oil: 0, buildTime: 60, hp: 3500, size: 4, power: 12, sight: 18, requires: [], limit: 1, hotkey: 'H' },
  power: { kind: 'power', cost: 500, oil: 0, buildTime: 9, hp: 800, size: 3, power: 25, sight: 9, requires: [], hotkey: 'P' },
  barracks: { kind: 'barracks', cost: 450, oil: 0, buildTime: 11, hp: 1100, size: 3, power: -4, sight: 10, requires: ['power'], produces: ['rifleman', 'rpg'], hotkey: 'B' },
  derrick: { kind: 'derrick', cost: 350, oil: 0, buildTime: 8, hp: 600, size: 2, power: 0, sight: 9, requires: [], onOil: true, hotkey: 'D' },
  refinery: { kind: 'refinery', cost: 1100, oil: 0, buildTime: 18, hp: 1300, size: 3, power: -6, sight: 9, requires: ['derrick'], limit: 3, hotkey: 'R' },
  factory: { kind: 'factory', cost: 1300, oil: 0, buildTime: 20, hp: 1800, size: 4, power: -8, sight: 10, requires: ['barracks'], produces: ['technical', 'tank', 'rocket', 'sam'], hotkey: 'F' },
  turret: {
    kind: 'turret', cost: 650, oil: 0, buildTime: 10, hp: 1000, size: 2, power: -3, sight: 14, requires: ['barracks'], hotkey: 'T',
    weapon: { damage: 32, range: 13, cooldown: 1.0, projectile: 'shell', targets: 'ground', sound: 'cannon' },
  },
  samsite: {
    kind: 'samsite', cost: 850, oil: 0, buildTime: 12, hp: 850, size: 2, power: -5, sight: 20, requires: ['factory'], hotkey: 'S', interceptChance: 0.6,
    weapon: { damage: 85, range: 20, cooldown: 1.8, projectile: 'missile', targets: 'air', sound: 'missile' },
  },
  airfield: { kind: 'airfield', cost: 1600, oil: 0, buildTime: 24, hp: 1400, size: 4, power: -10, sight: 12, requires: ['factory'], produces: ['heli', 'drone'], hotkey: 'A' },
  silo: { kind: 'silo', cost: 3000, oil: 300, buildTime: 40, hp: 2200, size: 3, power: -15, sight: 10, requires: ['airfield'], limit: 1, hotkey: 'M' },
};

/** Build menu order. HQ is pre-placed and not buildable. */
export const BUILD_ORDER: BuildingKind[] = ['power', 'barracks', 'derrick', 'refinery', 'factory', 'turret', 'samsite', 'airfield', 'silo'];
export const UNIT_ORDER: UnitKind[] = ['rifleman', 'rpg', 'technical', 'tank', 'rocket', 'sam', 'heli', 'drone'];

/** Damage multiplier: projectile vs armor. */
export const DAMAGE_TABLE: Record<ProjectileType, Record<ArmorType, number>> = {
  bullet: { infantry: 1.0, light: 0.6, heavy: 0.15, air: 0.55, structure: 0.2 },
  shell: { infantry: 0.55, light: 1.0, heavy: 1.0, air: 0, structure: 0.85 },
  rocket: { infantry: 0.45, light: 1.2, heavy: 1.3, air: 1.0, structure: 0.9 },
  artillery: { infantry: 1.0, light: 1.0, heavy: 0.7, air: 0, structure: 1.25 },
  missile: { infantry: 0.4, light: 0.9, heavy: 0.7, air: 1.5, structure: 0.5 },
};

export const ECONOMY = {
  hqIncome: 6, // credits/sec
  derrickOil: 2.2, // barrels/sec × richness
  cityIncome: 3,
  capitalIncome: 6,
  basePrice: 72, // $/barrel
  barrelsPerCredit: 1 / 4, // credits = barrels * price / 18
  priceDivisor: 18,
  baseSellEfficiency: 0.75,
  refineryBonus: 0.15,
  popCap: 120,
  lowPowerFactor: 0.5,
  buildRadius: 26,
  siloCharge: 150,
  missileDamage: 1600,
  missileRadius: 11,
  captureTime: 12,
  captureRadius: 5,
  sellRefund: 0.5,
};

export interface TeamTheme {
  name: { en: string; fa: string };
  color: number;
  css: string;
}

export const TEAM_THEMES: TeamTheme[] = [
  { name: { en: 'Falcon Command', fa: 'فرماندهی شاهین' }, color: 0x3b82f6, css: '#3b82f6' },
  { name: { en: 'Scorpion Legion', fa: 'لژیون عقرب' }, color: 0xef4444, css: '#ef4444' },
  { name: { en: 'Viper Front', fa: 'جبهه افعی' }, color: 0x22c55e, css: '#22c55e' },
  { name: { en: 'Jackal Brigade', fa: 'تیپ شغال' }, color: 0xf59e0b, css: '#f59e0b' },
];

export type Difficulty = 'easy' | 'normal' | 'hard';

export const DIFFICULTY: Record<Difficulty, { income: number; thinkRate: number; attackSize: number; firstAttack: number; buildSpeed: number }> = {
  easy: { income: 0.75, thinkRate: 2.2, attackSize: 6, firstAttack: 420, buildSpeed: 0.8 },
  normal: { income: 1.0, thinkRate: 1.4, attackSize: 9, firstAttack: 300, buildSpeed: 1.0 },
  hard: { income: 1.35, thinkRate: 0.8, attackSize: 12, firstAttack: 210, buildSpeed: 1.25 },
};

export interface MatchSettings {
  startRegion: string;
  opponents: number;
  difficulty: Difficulty;
  startCredits: number;
  events: boolean;
}
