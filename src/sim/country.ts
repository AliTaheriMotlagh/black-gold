import type { CountryMeta } from '../geo/theater';

export type Controller = 'human' | 'ai' | 'minor';
export type Difficulty = 'easy' | 'normal' | 'hard' | 'brutal';

/** Ordered from hostile to friendly. */
export enum Rel {
  War = 0,
  Hostile = 1,
  Neutral = 2,
  Pact = 3,
  Alliance = 4,
}

export interface CountryStats {
  unitsBuilt: number;
  unitsLost: number;
  kills: number;
  buildingsLost: number;
  buildingsDestroyed: number;
  citiesCaptured: number;
  oilPumped: number;
  earned: number;
  missilesFired: number;
  missileHits: number;
  intercepts: number;
}

export class Country {
  controller: Controller;
  /** Lobby slot of the human commanding it (-1 for AI). */
  slot = -1;
  difficulty: Difficulty = 'normal';
  alive = true;
  /** Has a base (HQ) on the map: major powers. */
  major = false;
  funds = 0;
  oil = 0;
  powerProd = 0;
  powerUse = 0;
  supply = 0;
  supplyCap = 0;
  tier = 1;
  researched: string[] = [];
  /** General's command points (Generals-style promotions). */
  xp = 0;
  rank = 0;
  points = 0;
  powers: string[] = [];
  powerCd: Record<string, number> = {};
  /** 0..100 domestic stability. */
  stability = 75;
  /** 0..100 world opinion. */
  reputation = 60;
  warWeariness = 0;
  /** Oil sale multiplier from sanctions. */
  sanctioned = 0;
  autoSell = true;
  oilReserve = 200;
  incomeRate = 0;
  /** Cyber attack: power grid down (seconds). */
  blackout = 0;
  startX = 0;
  startZ = 0;
  stats: CountryStats = {
    unitsBuilt: 0,
    unitsLost: 0,
    kills: 0,
    buildingsLost: 0,
    buildingsDestroyed: 0,
    citiesCaptured: 0,
    oilPumped: 0,
    earned: 0,
    missilesFired: 0,
    missileHits: 0,
    intercepts: 0,
  };

  constructor(
    readonly idx: number,
    readonly meta: CountryMeta,
    controller: Controller,
  ) {
    this.controller = controller;
  }

  get iso() {
    return this.meta.iso;
  }
  get lowPower() {
    return this.blackout > 0 || this.powerUse > this.powerProd;
  }
  has(research: string) {
    return this.researched.includes(research);
  }
}

export type ProposalKind = 'peace' | 'alliance' | 'pact' | 'trade' | 'access';

export interface Proposal {
  id: number;
  from: number;
  to: number;
  kind: ProposalKind;
  expires: number;
}

/**
 * Pairwise relations. Indices are country idx (1-based; 0 unused).
 * Relations are symmetric; trade/access/sanctions are directed flags.
 */
export class Diplomacy {
  readonly n: number;
  readonly rel: Uint8Array;
  /** 0..100 tension. */
  readonly tension: Float32Array;
  readonly trade: Uint8Array;
  readonly access: Uint8Array;
  readonly sanction: Uint8Array;
  /** Time war was declared (for war weariness / casus belli). */
  readonly warSince: Float32Array;
  proposals: Proposal[] = [];
  nextProposal = 1;

  constructor(n: number) {
    this.n = n;
    const nn = n * n;
    this.rel = new Uint8Array(nn).fill(Rel.Neutral);
    this.tension = new Float32Array(nn).fill(10);
    this.trade = new Uint8Array(nn);
    this.access = new Uint8Array(nn);
    this.sanction = new Uint8Array(nn);
    this.warSince = new Float32Array(nn);
    for (let i = 0; i < n; i++) this.rel[i * n + i] = Rel.Alliance;
  }

  get(a: number, b: number): Rel {
    return this.rel[a * this.n + b] as Rel;
  }
  set(a: number, b: number, r: Rel) {
    this.rel[a * this.n + b] = r;
    this.rel[b * this.n + a] = r;
  }
  atWar(a: number, b: number) {
    return a !== b && a > 0 && b > 0 && this.rel[a * this.n + b] === Rel.War;
  }
  allied(a: number, b: number) {
    return a === b || this.rel[a * this.n + b] === Rel.Alliance;
  }
  getTension(a: number, b: number) {
    return this.tension[a * this.n + b];
  }
  addTension(a: number, b: number, v: number) {
    const i = a * this.n + b;
    const j = b * this.n + a;
    const t = Math.max(0, Math.min(100, this.tension[i] + v));
    this.tension[i] = t;
    this.tension[j] = t;
  }
  flag(arr: Uint8Array, a: number, b: number) {
    return arr[a * this.n + b] === 1;
  }
  setFlag(arr: Uint8Array, a: number, b: number, v: boolean, symmetric = true) {
    arr[a * this.n + b] = v ? 1 : 0;
    if (symmetric) arr[b * this.n + a] = v ? 1 : 0;
  }
}
