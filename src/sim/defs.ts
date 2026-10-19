/**
 * All gameplay data. Units: km, km/s, seconds, $M. Time is compressed (~60× for
 * movement) so a theater the size of the real Middle East plays in an evening.
 * Display names come from i18n keys `unit.<id>`, `bld.<id>`, `res.<id>`, `pow.<id>`.
 */

export type Domain = 'land' | 'sea' | 'air';
export type Armor = 'infantry' | 'light' | 'heavy' | 'air' | 'drone' | 'naval' | 'structure';
export type Delivery =
  | 'bullet'
  | 'shell'
  | 'flak'
  | 'atgm'
  | 'artillery'
  | 'rocket'
  | 'sam'
  | 'agm'
  | 'bomb'
  | 'laser'
  | 'torpedo'
  | 'asm'
  | 'kamikaze'
  | 'warhead';
export type Flight = 'heli' | 'jet' | 'drone' | 'fpv' | 'loiter';
export type StrikeKind = 'cruise' | 'ballistic' | 'hypersonic';
export type Category = 'infantry' | 'vehicle' | 'drone' | 'air' | 'naval';

/** Target mask bits. */
export const T_GROUND = 1;
export const T_AIR = 2;
export const T_NAVAL = 4;
/** Incoming munitions: rockets, shells, cruise/ballistic/hypersonic missiles. */
export const T_MUNITION = 8;
/** Ballistic missiles specifically (ABM capable). */
export const T_BALLISTIC = 16;

export type SfxName =
  | 'rifle'
  | 'mg'
  | 'autocannon'
  | 'cannon'
  | 'atgm'
  | 'artillery'
  | 'rocket'
  | 'sam'
  | 'flak'
  | 'laser'
  | 'torpedo'
  | 'jet'
  | 'drone'
  | 'shahed'
  | 'heli'
  | 'explosion'
  | 'bigExplosion'
  | 'intercept'
  | 'launch'
  | 'siren'
  | 'click'
  | 'select'
  | 'ack'
  | 'place'
  | 'complete'
  | 'unitReady'
  | 'cash'
  | 'alert'
  | 'error'
  | 'capture'
  | 'achievement'
  | 'diplomacy'
  | 'war'
  | 'victory'
  | 'defeat';

export interface WeaponDef {
  id: string;
  delivery: Delivery;
  damage: number;
  range: number;
  minRange?: number;
  cooldown: number;
  targets: number;
  splash?: number;
  salvo?: number;
  salvoGap?: number;
  /** Projectile speed km/s (0 = hitscan). */
  speed: number;
  /** Spread radius (km) at max range for unguided munitions. */
  spread?: number;
  /** Kill probability vs munitions/aircraft for interceptors (default 1 for direct damage). */
  pk?: number;
  /** Rounds before it must rearm at an airbase. */
  ammo?: number;
  sound: SfxName;
}

export interface UnitDef {
  id: string;
  category: Category;
  domain: Domain;
  producers: string[];
  tier: 1 | 2 | 3;
  research?: string;
  cost: number;
  oil: number;
  time: number;
  hp: number;
  armor: Armor;
  speed: number;
  accel: number;
  /** rad/s */
  turn: number;
  radius: number;
  sight: number;
  /** Detection radius for aircraft and munitions (radar). */
  airSight?: number;
  weapons: WeaponDef[];
  supply: number;
  flight?: Flight;
  /** Cruise altitude above ground (km, render-exaggerated). */
  alt?: number;
  /** Seconds aloft before returning / crashing. */
  endurance?: number;
  kamikaze?: { damage: number; splash: number };
  capture?: number;
  builder?: boolean;
  repair?: boolean;
  stealth?: boolean;
  deploy?: number;
  jammer?: number;
  strike?: StrikeKind;
  strikeReload?: number;
  symbol: string;
  hotkey: string;
}

export interface BuildingDef {
  id: string;
  tier: 1 | 2 | 3;
  research?: string;
  cost: number;
  oil: number;
  time: number;
  hp: number;
  /** Footprint side length in km. */
  size: number;
  power: number;
  sight: number;
  airSight?: number;
  requires: string[];
  produces?: string[];
  weapons?: WeaponDef[];
  onOil?: boolean;
  coast?: boolean;
  limit?: number;
  supply?: number;
  /** Extends the area where buildings may be placed (km). */
  baseRadius?: number;
  jammer?: number;
  strike?: StrikeKind;
  strikeReload?: number;
  research_?: boolean;
  rearm?: boolean;
  symbol: string;
  hotkey: string;
}

const G = T_GROUND;
const A = T_AIR;
const N = T_NAVAL;
const M = T_MUNITION;
const B = T_BALLISTIC;

// --- Weapons -------------------------------------------------------------------
const W = {
  rifle: { id: 'rifle', delivery: 'bullet', damage: 12, range: 1.0, cooldown: 1.0, targets: G, speed: 0, sound: 'rifle' },
  sfRifle: { id: 'sfRifle', delivery: 'bullet', damage: 28, range: 1.4, cooldown: 0.8, targets: G, speed: 0, sound: 'rifle' },
  pistol: { id: 'pistol', delivery: 'bullet', damage: 6, range: 0.6, cooldown: 1.2, targets: G, speed: 0, sound: 'rifle' },
  atgm: { id: 'atgm', delivery: 'atgm', damage: 150, range: 3.6, cooldown: 6, targets: G | N, speed: 1.2, sound: 'atgm' },
  manpads: { id: 'manpads', delivery: 'sam', damage: 120, range: 5, cooldown: 6, targets: A | M, speed: 2.4, pk: 0.6, sound: 'sam' },
  autocannon: { id: 'autocannon', delivery: 'shell', damage: 24, range: 2.3, cooldown: 0.45, targets: G | A | N, speed: 5, sound: 'autocannon' },
  tankGun: { id: 'tankGun', delivery: 'shell', damage: 175, range: 3.3, cooldown: 3.6, targets: G | N, speed: 9, sound: 'cannon' },
  howitzer: { id: 'howitzer', delivery: 'artillery', damage: 95, splash: 0.35, range: 32, minRange: 4, cooldown: 7, targets: G | N, speed: 4, spread: 0.45, sound: 'artillery' },
  mlrs: { id: 'mlrs', delivery: 'rocket', damage: 80, splash: 0.45, range: 80, minRange: 10, cooldown: 22, salvo: 6, salvoGap: 0.22, targets: G | N, speed: 6, spread: 0.8, sound: 'rocket' },
  aaGun: { id: 'aaGun', delivery: 'flak', damage: 12, range: 4, cooldown: 0.12, targets: A | M, speed: 0, pk: 0.1, sound: 'flak' },
  shoradSam: { id: 'shoradSam', delivery: 'sam', damage: 150, range: 18, cooldown: 3.5, targets: A | M, speed: 4, pk: 0.75, sound: 'sam' },
  longSam: { id: 'longSam', delivery: 'sam', damage: 420, range: 110, cooldown: 7, targets: A | M | B, speed: 12, pk: 0.7, sound: 'sam' },
  siteSam: { id: 'siteSam', delivery: 'sam', damage: 450, range: 130, cooldown: 5, targets: A | M | B, speed: 13, pk: 0.72, sound: 'sam' },
  agm: { id: 'agm', delivery: 'agm', damage: 240, range: 9, cooldown: 5, ammo: 4, targets: G | N, speed: 3, sound: 'atgm' },
  hellfire: { id: 'hellfire', delivery: 'atgm', damage: 220, range: 7, cooldown: 2.5, ammo: 8, targets: G | N, speed: 2.5, sound: 'atgm' },
  chaingun: { id: 'chaingun', delivery: 'bullet', damage: 20, range: 2.5, cooldown: 0.25, targets: G | A, speed: 0, sound: 'mg' },
  aam: { id: 'aam', delivery: 'sam', damage: 450, range: 45, cooldown: 2.5, ammo: 4, targets: A | M, speed: 22, pk: 0.78, sound: 'sam' },
  jdam: { id: 'jdam', delivery: 'bomb', damage: 600, splash: 0.25, range: 16, cooldown: 2, ammo: 2, targets: G | N, speed: 4, sound: 'rocket' },
  gbu: { id: 'gbu', delivery: 'bomb', damage: 1000, splash: 0.35, range: 6, cooldown: 0.8, ammo: 8, targets: G | N, speed: 3, sound: 'rocket' },
  asm: { id: 'asm', delivery: 'asm', damage: 420, range: 35, cooldown: 9, targets: N | G, speed: 6, sound: 'atgm' },
  navalGun: { id: 'navalGun', delivery: 'shell', damage: 65, splash: 0.12, range: 14, cooldown: 2, targets: G | N, speed: 6, spread: 0.15, sound: 'cannon' },
  smallGun: { id: 'smallGun', delivery: 'shell', damage: 26, range: 3, cooldown: 0.5, targets: G | N | A, speed: 5, sound: 'autocannon' },
  navalSam: { id: 'navalSam', delivery: 'sam', damage: 320, range: 70, cooldown: 4, targets: A | M | B, speed: 12, pk: 0.65, sound: 'sam' },
  ciws: { id: 'ciws', delivery: 'flak', damage: 10, range: 2.5, cooldown: 0.08, targets: A | M, speed: 0, pk: 0.09, sound: 'flak' },
  torpedo: { id: 'torpedo', delivery: 'torpedo', damage: 950, range: 9, cooldown: 8, targets: N, speed: 1.2, sound: 'torpedo' },
  hmg: { id: 'hmg', delivery: 'bullet', damage: 18, range: 1.7, cooldown: 0.3, targets: G, speed: 0, sound: 'mg' },
  bunkerAtgm: { id: 'bunkerAtgm', delivery: 'atgm', damage: 160, range: 3.8, cooldown: 6, targets: G | N, speed: 1.2, sound: 'atgm' },
  cram: { id: 'cram', delivery: 'flak', damage: 12, range: 4.5, cooldown: 0.1, targets: A | M, speed: 0, pk: 0.12, sound: 'flak' },
  cramSam: { id: 'cramSam', delivery: 'sam', damage: 150, range: 16, cooldown: 3, targets: A | M, speed: 4, pk: 0.72, sound: 'sam' },
  laser: { id: 'laser', delivery: 'laser', damage: 45, range: 8, cooldown: 0.35, targets: A | M, speed: 0, pk: 0.85, sound: 'laser' },
} satisfies Record<string, WeaponDef>;
export const WEAPONS: Record<string, WeaponDef> = W;

// --- Units -------------------------------------------------------------------
type U = Omit<UnitDef, 'accel' | 'turn' | 'oil'> & Partial<Pick<UnitDef, 'accel' | 'turn' | 'oil'>>;
const unitList: U[] = [
  // Infantry
  { id: 'rifle', category: 'infantry', domain: 'land', producers: ['barracks', 'fob'], tier: 1, cost: 100, time: 5, hp: 120, armor: 'infantry', speed: 0.3, radius: 0.05, sight: 3, weapons: [W.rifle], supply: 1, capture: 1, symbol: 'inf', hotkey: 'Q' },
  { id: 'atgm_team', category: 'infantry', domain: 'land', producers: ['barracks'], tier: 1, cost: 300, time: 8, hp: 100, armor: 'infantry', speed: 0.28, radius: 0.05, sight: 3.2, weapons: [W.atgm], supply: 1, symbol: 'at', hotkey: 'W' },
  { id: 'manpads', category: 'infantry', domain: 'land', producers: ['barracks'], tier: 1, cost: 300, time: 8, hp: 100, armor: 'infantry', speed: 0.28, radius: 0.05, sight: 3.5, airSight: 6, weapons: [W.manpads], supply: 1, symbol: 'aa', hotkey: 'E' },
  { id: 'engineer', category: 'infantry', domain: 'land', producers: ['barracks', 'fob'], tier: 1, cost: 250, time: 7, hp: 90, armor: 'infantry', speed: 0.3, radius: 0.05, sight: 3, weapons: [W.pistol], supply: 1, capture: 2.5, repair: true, symbol: 'eng', hotkey: 'R' },
  { id: 'sf', category: 'infantry', domain: 'land', producers: ['barracks'], tier: 2, cost: 900, time: 16, hp: 170, armor: 'infantry', speed: 0.36, radius: 0.05, sight: 4.5, weapons: [W.sfRifle], supply: 2, stealth: true, capture: 1.5, symbol: 'sf', hotkey: 'T' },
  // Vehicles
  { id: 'builder', category: 'vehicle', domain: 'land', producers: ['hq', 'factory', 'fob'], tier: 1, cost: 450, time: 9, hp: 350, armor: 'light', speed: 0.75, radius: 0.07, sight: 3, weapons: [], supply: 1, builder: true, repair: true, symbol: 'engv', hotkey: 'B' },
  { id: 'ifv', category: 'vehicle', domain: 'land', producers: ['factory'], tier: 1, cost: 550, time: 10, hp: 420, armor: 'light', speed: 0.85, radius: 0.08, sight: 4, weapons: [W.autocannon], supply: 2, symbol: 'mech', hotkey: 'Q' },
  { id: 'mbt', category: 'vehicle', domain: 'land', producers: ['factory'], tier: 1, cost: 950, oil: 20, time: 14, hp: 1000, armor: 'heavy', speed: 0.7, turn: 1.6, radius: 0.1, sight: 4, weapons: [W.tankGun], supply: 3, symbol: 'armor', hotkey: 'W' },
  { id: 'shorad', category: 'vehicle', domain: 'land', producers: ['factory'], tier: 1, cost: 950, oil: 10, time: 13, hp: 420, armor: 'light', speed: 0.7, radius: 0.09, sight: 5, airSight: 25, weapons: [W.aaGun, W.shoradSam], supply: 3, symbol: 'shorad', hotkey: 'E' },
  { id: 'spg', category: 'vehicle', domain: 'land', producers: ['factory'], tier: 2, cost: 1200, oil: 20, time: 16, hp: 360, armor: 'light', speed: 0.6, radius: 0.1, sight: 4, weapons: [W.howitzer], supply: 3, symbol: 'arty', hotkey: 'R' },
  { id: 'mlrs', category: 'vehicle', domain: 'land', producers: ['factory'], tier: 2, cost: 1700, oil: 40, time: 20, hp: 320, armor: 'light', speed: 0.7, radius: 0.1, sight: 4, weapons: [W.mlrs], supply: 3, symbol: 'mlrs', hotkey: 'T' },
  { id: 'sam_tel', category: 'vehicle', domain: 'land', producers: ['factory'], tier: 2, cost: 2400, oil: 40, time: 24, hp: 380, armor: 'light', speed: 0.6, radius: 0.1, sight: 4, airSight: 140, weapons: [W.longSam], supply: 4, deploy: 4, symbol: 'sam', hotkey: 'Y' },
  { id: 'ew', category: 'vehicle', domain: 'land', producers: ['factory'], tier: 2, cost: 1300, oil: 20, time: 15, hp: 320, armor: 'light', speed: 0.7, radius: 0.09, sight: 5, airSight: 30, weapons: [], supply: 3, jammer: 14, symbol: 'ew', hotkey: 'U' },
  { id: 'tel', category: 'vehicle', domain: 'land', producers: ['factory'], tier: 2, cost: 2800, oil: 150, time: 32, hp: 420, armor: 'light', speed: 0.6, radius: 0.11, sight: 4, weapons: [], supply: 4, strike: 'ballistic', strikeReload: 100, deploy: 5, symbol: 'missile', hotkey: 'I' },
  // Drones
  { id: 'fpv', category: 'drone', domain: 'air', producers: ['dronefac'], tier: 1, cost: 120, time: 3, hp: 30, armor: 'drone', speed: 1.6, accel: 4, turn: 4, radius: 0.03, sight: 3.5, weapons: [], supply: 0.5, flight: 'fpv', alt: 0.08, endurance: 70, kamikaze: { damage: 210, splash: 0.06 }, symbol: 'fpv', hotkey: 'Q' },
  { id: 'recon', category: 'drone', domain: 'air', producers: ['dronefac'], tier: 1, cost: 350, time: 7, hp: 80, armor: 'drone', speed: 2.2, turn: 1.2, radius: 0.06, sight: 14, airSight: 14, weapons: [], supply: 1, flight: 'drone', alt: 1.5, endurance: 420, symbol: 'uav', hotkey: 'W' },
  { id: 'loiter', category: 'drone', domain: 'air', producers: ['dronefac'], tier: 1, cost: 450, oil: 20, time: 8, hp: 60, armor: 'drone', speed: 4, turn: 1.4, radius: 0.05, sight: 2, weapons: [], supply: 1, flight: 'loiter', alt: 0.18, endurance: 460, kamikaze: { damage: 480, splash: 0.25 }, symbol: 'loiter', hotkey: 'E' },
  { id: 'male', category: 'drone', domain: 'air', producers: ['dronefac'], tier: 2, cost: 1500, oil: 30, time: 18, hp: 260, armor: 'drone', speed: 2.6, turn: 0.9, radius: 0.09, sight: 10, weapons: [W.agm], supply: 2, flight: 'drone', alt: 3, endurance: 700, symbol: 'ucav', hotkey: 'R' },
  // Aircraft
  { id: 'heli', category: 'air', domain: 'air', producers: ['airbase'], tier: 2, cost: 1900, oil: 60, time: 20, hp: 650, armor: 'air', speed: 3.2, accel: 2, turn: 1.8, radius: 0.12, sight: 6, weapons: [W.hellfire, W.chaingun], supply: 3, flight: 'heli', alt: 0.25, symbol: 'heli', hotkey: 'Q' },
  { id: 'fighter', category: 'air', domain: 'air', producers: ['airbase'], tier: 2, cost: 3000, oil: 120, time: 30, hp: 520, armor: 'air', speed: 12, accel: 6, turn: 1.1, radius: 0.14, sight: 12, airSight: 60, weapons: [W.aam, W.jdam], supply: 4, flight: 'jet', alt: 6, endurance: 240, symbol: 'fighter', hotkey: 'W' },
  { id: 'bomber', category: 'air', domain: 'air', producers: ['airbase'], tier: 3, research: 'stealth', cost: 6500, oil: 300, time: 45, hp: 1000, armor: 'air', speed: 9, accel: 3, turn: 0.7, radius: 0.2, sight: 10, weapons: [W.gbu], supply: 6, flight: 'jet', alt: 9, endurance: 360, stealth: true, symbol: 'bomber', hotkey: 'E' },
  // Naval
  { id: 'fac', category: 'naval', domain: 'sea', producers: ['shipyard'], tier: 1, cost: 650, oil: 20, time: 11, hp: 450, armor: 'naval', speed: 1.5, turn: 1.2, radius: 0.1, sight: 6, weapons: [W.asm, W.smallGun], supply: 2, symbol: 'fac', hotkey: 'Q' },
  { id: 'frigate', category: 'naval', domain: 'sea', producers: ['shipyard'], tier: 2, cost: 3200, oil: 100, time: 36, hp: 2600, armor: 'naval', speed: 1.0, turn: 0.5, radius: 0.2, sight: 8, airSight: 90, weapons: [W.navalSam, W.navalGun, W.ciws], supply: 6, strike: 'cruise', strikeReload: 60, symbol: 'frigate', hotkey: 'W' },
  { id: 'sub', category: 'naval', domain: 'sea', producers: ['shipyard'], tier: 3, cost: 3600, oil: 100, time: 40, hp: 1400, armor: 'naval', speed: 0.9, turn: 0.6, radius: 0.15, sight: 6, weapons: [W.torpedo], supply: 6, stealth: true, strike: 'cruise', strikeReload: 75, symbol: 'sub', hotkey: 'E' },
];

export const UNITS: Record<string, UnitDef> = {};
for (const u of unitList) {
  const isAir = u.domain === 'air';
  UNITS[u.id] = {
    ...u,
    oil: u.oil ?? 0,
    accel: u.accel ?? (isAir ? 3 : u.category === 'infantry' ? 1.5 : u.domain === 'sea' ? 0.25 : 0.9),
    turn: u.turn ?? (u.category === 'infantry' ? 8 : isAir ? 2 : u.domain === 'sea' ? 0.8 : 2.4),
  };
}
export const UNIT_IDS = unitList.map((u) => u.id);

// --- Buildings ----------------------------------------------------------------
const buildingList: BuildingDef[] = [
  { id: 'hq', tier: 1, cost: 4000, oil: 0, time: 60, hp: 5000, size: 0.9, power: 20, sight: 8, airSight: 30, requires: [], produces: ['builder'], limit: 1, supply: 20, baseRadius: 30, symbol: 'hq', hotkey: 'H' },
  { id: 'power', tier: 1, cost: 600, oil: 0, time: 10, hp: 1000, size: 0.45, power: 40, sight: 3, requires: [], symbol: 'power', hotkey: 'P' },
  { id: 'barracks', tier: 1, cost: 500, oil: 0, time: 12, hp: 1300, size: 0.45, power: -5, sight: 4, requires: ['power'], produces: ['rifle', 'atgm_team', 'manpads', 'engineer', 'sf'], symbol: 'barracks', hotkey: 'B' },
  { id: 'derrick', tier: 1, cost: 400, oil: 0, time: 9, hp: 700, size: 0.25, power: -2, sight: 3, requires: [], onOil: true, symbol: 'oil', hotkey: 'D' },
  { id: 'depot', tier: 1, cost: 300, oil: 0, time: 8, hp: 800, size: 0.3, power: 0, sight: 3, requires: [], supply: 25, symbol: 'depot', hotkey: 'S' },
  { id: 'refinery', tier: 1, cost: 1200, oil: 0, time: 20, hp: 1500, size: 0.6, power: -8, sight: 3, requires: ['derrick'], limit: 4, symbol: 'refinery', hotkey: 'R' },
  { id: 'factory', tier: 1, cost: 1400, oil: 0, time: 22, hp: 2200, size: 0.7, power: -10, sight: 4, requires: ['barracks'], produces: ['builder', 'ifv', 'mbt', 'shorad', 'spg', 'mlrs', 'sam_tel', 'ew', 'tel'], symbol: 'factory', hotkey: 'F' },
  { id: 'radar', tier: 1, cost: 700, oil: 0, time: 12, hp: 700, size: 0.3, power: -6, sight: 8, airSight: 160, requires: ['power'], symbol: 'radar', hotkey: 'A' },
  { id: 'bunker', tier: 1, cost: 500, oil: 0, time: 9, hp: 1500, size: 0.18, power: -2, sight: 4, requires: ['barracks'], weapons: [W.hmg, W.bunkerAtgm], symbol: 'bunker', hotkey: 'K' },
  { id: 'cram', tier: 1, cost: 900, oil: 0, time: 12, hp: 900, size: 0.2, power: -8, sight: 4, airSight: 20, requires: ['factory'], weapons: [W.cram, W.cramSam], symbol: 'cram', hotkey: 'C' },
  { id: 'dronefac', tier: 1, cost: 1100, oil: 0, time: 18, hp: 1200, size: 0.45, power: -8, sight: 4, requires: ['factory'], produces: ['fpv', 'recon', 'loiter', 'male'], symbol: 'dronefac', hotkey: 'U' },
  { id: 'shipyard', tier: 1, cost: 1800, oil: 0, time: 26, hp: 2400, size: 0.7, power: -10, sight: 5, requires: ['factory'], coast: true, produces: ['fac', 'frigate', 'sub'], symbol: 'shipyard', hotkey: 'N' },
  { id: 'fob', tier: 1, cost: 1200, oil: 0, time: 25, hp: 1800, size: 0.5, power: 0, sight: 6, requires: ['barracks'], produces: ['builder', 'rifle', 'engineer'], supply: 10, baseRadius: 18, symbol: 'fob', hotkey: 'O' },
  { id: 'airbase', tier: 2, cost: 2200, oil: 0, time: 30, hp: 2600, size: 1.3, power: -15, sight: 6, airSight: 40, requires: ['factory'], produces: ['heli', 'fighter', 'bomber'], rearm: true, symbol: 'airbase', hotkey: 'L' },
  { id: 'research', tier: 2, cost: 1800, oil: 0, time: 26, hp: 1400, size: 0.5, power: -12, sight: 4, requires: ['factory'], research_: true, symbol: 'research', hotkey: 'X' },
  { id: 'samsite', tier: 2, cost: 2600, oil: 0, time: 26, hp: 1300, size: 0.4, power: -15, sight: 4, airSight: 160, requires: ['radar'], weapons: [W.siteSam], symbol: 'sam', hotkey: 'M' },
  { id: 'silo', tier: 2, cost: 3500, oil: 300, time: 45, hp: 2800, size: 0.5, power: -20, sight: 4, requires: ['research'], strike: 'ballistic', strikeReload: 120, limit: 2, symbol: 'missile', hotkey: 'Z' },
  { id: 'laser', tier: 3, research: 'laser', cost: 2400, oil: 0, time: 25, hp: 900, size: 0.22, power: -35, sight: 4, airSight: 12, requires: ['research'], weapons: [W.laser], symbol: 'laser', hotkey: 'V' },
  { id: 'nuclear', tier: 3, research: 'reactor', cost: 3500, oil: 0, time: 50, hp: 2500, size: 0.7, power: 180, sight: 3, requires: ['research'], symbol: 'power', hotkey: 'J' },
];
export const BUILDINGS: Record<string, BuildingDef> = Object.fromEntries(buildingList.map((b) => [b.id, b]));
export const BUILD_ORDER = buildingList.filter((b) => b.id !== 'hq').map((b) => b.id);

// --- Research ---------------------------------------------------------------
export interface ResearchDef {
  id: string;
  tier: 2 | 3;
  cost: number;
  time: number;
  icon: string;
}
export const RESEARCH: ResearchDef[] = [
  { id: 'composite', tier: 2, cost: 1500, time: 40, icon: 'shield' },
  { id: 'aps', tier: 2, cost: 1800, time: 45, icon: 'aps' },
  { id: 'swarm', tier: 2, cost: 1500, time: 40, icon: 'swarm' },
  { id: 'precision', tier: 2, cost: 1600, time: 40, icon: 'target' },
  { id: 'aesa', tier: 2, cost: 2000, time: 50, icon: 'radar' },
  { id: 'ew2', tier: 2, cost: 1500, time: 40, icon: 'ew' },
  { id: 'hypersonic', tier: 3, cost: 4000, time: 90, icon: 'missile' },
  { id: 'laser', tier: 3, cost: 3000, time: 70, icon: 'laser' },
  { id: 'stealth', tier: 3, cost: 3500, time: 80, icon: 'stealth' },
  { id: 'reactor', tier: 3, cost: 3000, time: 60, icon: 'atom' },
];

/** HQ upgrades unlock tiers (Age of Empires style "ages"). */
export const TIER_UPGRADE = {
  2: { cost: 3000, time: 60, requires: ['factory'] },
  3: { cost: 6000, time: 90, requires: ['research'] },
} as const;

// --- Strategic strikes ----------------------------------------------------
export interface StrikeDef {
  kind: StrikeKind;
  range: number;
  speed: number;
  damage: number;
  splash: number;
  /** Cruise altitude (cruise) or apex fraction of range (ballistic). */
  alt: number;
  /** Multiplier on interceptors' pk. */
  evasion: number;
  /** Radar detection multiplier (low flyers are seen late). */
  radarMul: number;
  cost: number;
}
export const STRIKES: Record<StrikeKind, StrikeDef> = {
  cruise: { kind: 'cruise', range: 1600, speed: 8, damage: 900, splash: 0.3, alt: 0.05, evasion: 1, radarMul: 0.35, cost: 300 },
  ballistic: { kind: 'ballistic', range: 2200, speed: 25, damage: 2600, splash: 0.8, alt: 0.25, evasion: 0.8, radarMul: 1.5, cost: 600 },
  hypersonic: { kind: 'hypersonic', range: 2600, speed: 55, damage: 3000, splash: 0.6, alt: 0.04, evasion: 0.2, radarMul: 1, cost: 1200 },
};

// --- General's powers ------------------------------------------------------
export interface PowerDef {
  id: string;
  points: number;
  cooldown: number;
  radius: number;
  icon: string;
}
export const POWERS: PowerDef[] = [
  { id: 'recon', points: 1, cooldown: 120, radius: 40, icon: 'satellite' },
  { id: 'repair', points: 1, cooldown: 120, radius: 5, icon: 'wrench' },
  { id: 'barrage', points: 1, cooldown: 150, radius: 3, icon: 'artillery' },
  { id: 'paradrop', points: 2, cooldown: 200, radius: 1, icon: 'parachute' },
  { id: 'swarm', points: 2, cooldown: 180, radius: 1, icon: 'swarm' },
  { id: 'airstrike', points: 2, cooldown: 180, radius: 1.5, icon: 'jet' },
  { id: 'cyber', points: 2, cooldown: 240, radius: 0, icon: 'cyber' },
  { id: 'emp', points: 3, cooldown: 300, radius: 6, icon: 'emp' },
];

// --- Damage table: delivery × armor ------------------------------------------
export const DAMAGE: Record<Delivery, Record<Armor, number>> = {
  bullet: { infantry: 1, light: 0.45, heavy: 0.08, air: 0.3, drone: 0.9, naval: 0.1, structure: 0.12 },
  shell: { infantry: 0.6, light: 1, heavy: 1, air: 0.5, drone: 0.6, naval: 0.7, structure: 0.8 },
  flak: { infantry: 0.8, light: 0.35, heavy: 0.05, air: 0.9, drone: 1.3, naval: 0.1, structure: 0.1 },
  atgm: { infantry: 0.4, light: 1.2, heavy: 1.4, air: 0.6, drone: 0.2, naval: 0.8, structure: 0.7 },
  artillery: { infantry: 1, light: 0.9, heavy: 0.55, air: 0, drone: 0, naval: 0.5, structure: 1 },
  rocket: { infantry: 0.9, light: 1, heavy: 0.65, air: 0, drone: 0, naval: 0.5, structure: 1 },
  sam: { infantry: 0, light: 0, heavy: 0, air: 1.3, drone: 1.5, naval: 0, structure: 0 },
  agm: { infantry: 0.5, light: 1.2, heavy: 1.3, air: 0, drone: 0, naval: 1, structure: 1 },
  bomb: { infantry: 1, light: 1, heavy: 1, air: 0, drone: 0, naval: 1, structure: 1.4 },
  laser: { infantry: 0.6, light: 0.3, heavy: 0.1, air: 0.6, drone: 2, naval: 0.1, structure: 0.1 },
  torpedo: { infantry: 0, light: 0, heavy: 0, air: 0, drone: 0, naval: 2, structure: 0 },
  asm: { infantry: 0, light: 0.6, heavy: 0.6, air: 0, drone: 0, naval: 1.6, structure: 0.8 },
  kamikaze: { infantry: 0.8, light: 1.2, heavy: 1.1, air: 0.4, drone: 0, naval: 1, structure: 1 },
  warhead: { infantry: 1, light: 1, heavy: 1, air: 0, drone: 0, naval: 1, structure: 1.2 },
};

// --- Economy ---------------------------------------------------------------
export const ECON = {
  hqIncome: 3,
  cityBase: 0.4,
  cityPerSqrtM: 0.55,
  capitalBonus: 1.5,
  derrickRate: 1.5,
  basePrice: 80,
  creditsPerBarrel: 1 / 40,
  sellBase: 0.7,
  refineryBonus: 0.1,
  supplyBase: 30,
  supplyMax: 400,
  lowPowerFactor: 0.5,
  repairRate: 0.04,
  captureBase: 20,
  sellRefund: 0.5,
  tradeBonus: 0.05,
  startFunds: 5000,
};

export const TICK_RATE = 20;
export const DT = 1 / TICK_RATE;

export function weaponCanHit(w: WeaponDef, targetMask: number) {
  return (w.targets & targetMask) !== 0;
}
