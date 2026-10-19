/**
 * Multiplayer: lobby + deterministic lockstep.
 *
 * The host is a relay and the clock: it seals all commands received during each 100 ms
 * turn into a numbered packet and broadcasts it `delay` turns ahead. Every peer
 * (including the host) simulates turn n only once packet n has arrived, so all worlds
 * stay bit-identical. Peers exchange state hashes to detect desyncs. A dropped player's
 * nation is handed to the AI; if the host drops, clients continue offline vs AI.
 */
import type { Theater } from '../geo/theater';
import { World, type MatchSetup, type SimEvent } from '../sim/world';
import type { Command, CommandBody } from '../sim/commands';
import type { Difficulty } from '../sim/country';
import { DT } from '../sim/defs';
import { stateHash } from '../sim/hash';
import { hashString } from '../sim/rng';
import type { Session } from './Session';
import { type Conn, type Transport } from './Transport';

export const PROTOCOL = 2;
const TURN_TICKS = 2;
const HASH_EVERY = 100;
const MAX_LAG_TURNS = 12;

export interface LobbyPlayer {
  slot: number;
  name: string;
  country: string;
  ready: boolean;
  host: boolean;
  ping: number;
}

export interface LobbySettings {
  difficulty: Difficulty;
  scenario: 'sandbox' | 'realistic';
  funds: number;
  events: boolean;
  timeLimit: number;
  rivals: string[];
}

export interface LobbyState {
  players: LobbyPlayer[];
  settings: LobbySettings;
}

type ToHost =
  | { t: 'hello'; name: string; proto: number; data: number }
  | { t: 'pick'; country: string }
  | { t: 'ready'; ready: boolean }
  | { t: 'chat'; text: string }
  | { t: 'cmd'; cmds: CommandBody[] }
  | { t: 'ack'; turn: number }
  | { t: 'hash'; tick: number; hash: number }
  | { t: 'pong'; id: number };

type ToClient =
  | { t: 'welcome'; slot: number; lobby: LobbyState }
  | { t: 'reject'; reason: string }
  | { t: 'lobby'; lobby: LobbyState }
  | { t: 'chat'; from: string; text: string }
  | { t: 'start'; setup: MatchSetup; delay: number }
  | { t: 'turn'; n: number; cmds: Command[] }
  | { t: 'desync'; tick: number }
  | { t: 'ping'; id: number }
  | { t: 'kicked' };

export interface NetSessionInfo {
  session: Session;
  setup: MatchSetup;
}

/** Fingerprint of the map data so mismatched builds can't play together. */
export function dataHash(th: Theater) {
  return hashString(`${th.w}x${th.h}:${th.meta.cities.length}:${th.meta.countries.map((c) => c.iso).join('')}:${th.height[12345]}:${th.height[th.height.length >> 1]}`);
}

// ---------------------------------------------------------------------------
// Lockstep session (shared by host and clients)

export class LockstepSession implements Session {
  readonly multiplayer = true;
  speed = 1;
  paused = false;
  status = '';
  onTick: (events: SimEvent[]) => void = () => {};
  private turns = new Map<number, Command[]>();
  private acc = 0;
  /** Hook for the role (host/client) to send our commands upstream. */
  sendCommands: (cmds: CommandBody[]) => void = () => {};
  onExecutedTurn: (turn: number) => void = () => {};
  onHash: (tick: number, hash: number) => void = () => {};
  private outbox: CommandBody[] = [];
  private outT = 0;
  offline = false;
  private pendingLocal: Command[] = [];

  constructor(
    readonly world: World,
    readonly local: number,
  ) {}

  issue(cmd: CommandBody) {
    if (this.offline) {
      this.pendingLocal.push({ ...cmd, c: this.local } as Command);
      return;
    }
    this.outbox.push(cmd);
  }

  receiveTurn(n: number, cmds: Command[]) {
    this.turns.set(n, cmds);
  }

  advance(dt: number): number {
    // Flush our commands promptly (they are scheduled by the host).
    this.outT += dt;
    if (this.outbox.length && this.outT > 0.03) {
      this.sendCommands(this.outbox);
      this.outbox = [];
      this.outT = 0;
    }
    this.acc += dt;
    let steps = 0;
    const w = this.world;
    while (this.acc >= DT && steps < 10) {
      const tick = w.tick; // next tick to run is tick (0-based count of executed ticks)
      const turn = Math.floor(tick / TURN_TICKS);
      let cmds: Command[] = [];
      if (tick % TURN_TICKS === 0) {
        if (this.offline) {
          cmds = this.pendingLocal;
          this.pendingLocal = [];
        } else {
          const c = this.turns.get(turn);
          if (!c) {
            this.status = '…';
            this.acc = Math.min(this.acc, DT * 2);
            return 0.999;
          }
          cmds = c;
          this.turns.delete(turn);
        }
      }
      this.status = '';
      w.step(cmds);
      this.onTick(w.events);
      if ((w.tick + 1) % TURN_TICKS === 0) this.onExecutedTurn(turn);
      if (w.tick % HASH_EVERY === 0) this.onHash(w.tick, stateHash(w));
      this.acc -= DT;
      steps++;
    }
    // If we are far behind (tab was hidden), catch up faster next frame.
    if (steps >= 10) this.acc = Math.min(this.acc, DT * 30);
    return Math.min(0.999, this.acc / DT);
  }

  /** Continue without the network (host lost): everyone else becomes AI. */
  goOffline() {
    if (this.offline) return;
    this.offline = true;
    for (const c of this.world.countries) if (c.controller === 'human' && c.idx !== this.local) this.pendingLocal.push({ k: 'handover', c: c.idx, to: 'ai' });
    this.turns.clear();
  }

  dispose() {}
}

// ---------------------------------------------------------------------------
// Host

export class LobbyHost {
  state: LobbyState;
  private conns = new Map<number, Conn>();
  private nextSlot = 1;
  session: LockstepSession | null = null;
  private turn = 0;
  private sealedUpTo = -1;
  private pending: Command[] = [];
  private delay = 2;
  private acks = new Map<number, number>();
  private hashes = new Map<number, number>();
  private pingSent = new Map<number, number>();
  private timer = 0;
  private pingTimer = 0;
  private clock = 0;
  private lastTime = 0;
  onLobby: (s: LobbyState) => void = () => {};
  onChat: (from: string, text: string) => void = () => {};
  onStart: (info: NetSessionInfo) => void = () => {};
  onDesync: () => void = () => {};
  onDrop: (name: string) => void = () => {};

  constructor(
    readonly transport: Transport,
    readonly code: string,
    readonly theater: Theater,
    name: string,
    country: string,
    settings: LobbySettings,
  ) {
    this.state = { players: [{ slot: 0, name, country, ready: true, host: true, ping: 0 }], settings };
  }

  async open() {
    await this.transport.host(this.code, (c) => this.accept(c));
    this.pingTimer = window.setInterval(() => this.ping(), 2000);
  }

  private accept(c: Conn) {
    let slot = -1;
    c.onMessage = (raw) => {
      const m = raw as ToHost;
      if (m.t === 'hello') {
        if (m.proto !== PROTOCOL || m.data !== dataHash(this.theater)) {
          c.send({ t: 'reject', reason: 'version' } satisfies ToClient);
          setTimeout(() => c.close(), 200);
          return;
        }
        if (this.session || this.state.players.length >= 8) {
          c.send({ t: 'reject', reason: 'full' } satisfies ToClient);
          setTimeout(() => c.close(), 200);
          return;
        }
        slot = this.nextSlot++;
        this.conns.set(slot, c);
        const taken = new Set(this.state.players.map((p) => p.country));
        const free = this.freeCountry(taken);
        this.state.players.push({ slot, name: (m.name || `Commander ${slot}`).slice(0, 24), country: free, ready: false, host: false, ping: 0 });
        c.send({ t: 'welcome', slot, lobby: this.state } satisfies ToClient);
        this.broadcastLobby();
        return;
      }
      if (slot < 0) return;
      this.handle(slot, m);
    };
    c.onClose = () => {
      if (slot < 0) return;
      this.conns.delete(slot);
      const p = this.state.players.find((x) => x.slot === slot);
      this.state.players = this.state.players.filter((x) => x.slot !== slot);
      if (this.session && p) {
        // Hand the nation to the AI on every peer, deterministically.
        const idx = this.session.world.byIso.get(p.country)?.idx;
        if (idx) this.pending.push({ k: 'handover', c: idx, to: 'ai' });
        this.acks.delete(slot);
        this.onDrop(p.name);
      }
      this.broadcastLobby();
    };
  }

  private freeCountry(taken: Set<string>) {
    const prefs = ['SAU', 'TUR', 'ISR', 'EGY', 'IRQ', 'ARE', 'IRN', 'SYR', 'QAT', 'OMN'];
    return prefs.find((p) => !taken.has(p)) ?? this.theater.meta.countries.find((c) => c.playable && !taken.has(c.iso))!.iso;
  }

  private handle(slot: number, m: ToHost) {
    const p = this.state.players.find((x) => x.slot === slot);
    switch (m.t) {
      case 'pick':
        if (p && !this.session && !this.state.players.some((x) => x.country === m.country && x.slot !== slot)) {
          p.country = m.country;
          p.ready = false;
          this.broadcastLobby();
        }
        break;
      case 'ready':
        if (p && !this.session) {
          p.ready = m.ready;
          this.broadcastLobby();
        }
        break;
      case 'chat':
        this.chat(p?.name ?? '?', m.text.slice(0, 200));
        break;
      case 'cmd':
        if (this.session && p) {
          const idx = this.session.world.byIso.get(p.country)?.idx ?? 0;
          for (const cmd of m.cmds.slice(0, 64)) this.pending.push({ ...cmd, c: idx } as Command);
        }
        break;
      case 'ack':
        this.acks.set(slot, m.turn);
        break;
      case 'hash': {
        const own = this.hashes.get(m.tick);
        if (own !== undefined && own !== m.hash) {
          this.broadcast({ t: 'desync', tick: m.tick });
          this.onDesync();
        }
        break;
      }
      case 'pong': {
        const sent = this.pingSent.get(m.id);
        if (sent && p) {
          p.ping = Math.round(performance.now() - sent);
          // Adapt input delay to the slowest link (one turn = 100 ms).
          if (!this.session) this.broadcastLobby();
        }
        break;
      }
    }
  }

  private ping() {
    const id = Math.floor(Math.random() * 1e9);
    this.pingSent.set(id, performance.now());
    this.broadcast({ t: 'ping', id });
  }

  chat(from: string, text: string) {
    this.broadcast({ t: 'chat', from, text });
    this.onChat(from, text);
  }

  setHostCountry(country: string) {
    const host = this.state.players[0];
    if (this.state.players.some((p) => p.country === country && !p.host)) return;
    host.country = country;
    this.broadcastLobby();
  }

  updateSettings(s: Partial<LobbySettings>) {
    Object.assign(this.state.settings, s);
    for (const p of this.state.players) if (!p.host) p.ready = false;
    this.broadcastLobby();
  }

  kick(slot: number) {
    const c = this.conns.get(slot);
    c?.send({ t: 'kicked' } satisfies ToClient);
    setTimeout(() => c?.close(), 100);
  }

  private broadcastLobby() {
    this.broadcast({ t: 'lobby', lobby: this.state });
    this.onLobby(this.state);
  }

  private broadcast(m: ToClient) {
    for (const c of this.conns.values()) c.send(m);
  }

  get allReady() {
    return this.state.players.every((p) => p.ready);
  }

  start() {
    const s = this.state.settings;
    const humans = new Set(this.state.players.map((p) => p.country));
    const setup: MatchSetup = {
      seed: (Math.random() * 2 ** 31) >>> 0,
      players: this.state.players.map((p) => ({ slot: p.slot, name: p.name, country: p.country })),
      aiMajors: s.rivals.filter((r) => !humans.has(r)),
      difficulty: s.difficulty,
      startFunds: s.funds,
      scenario: s.scenario,
      events: s.events,
      timeLimit: s.timeLimit,
    };
    const maxPing = Math.max(0, ...this.state.players.map((p) => p.ping));
    this.delay = Math.max(2, Math.min(6, Math.ceil((maxPing / 2 + 60) / 100)));
    this.broadcast({ t: 'start', setup, delay: this.delay });
    const world = new World(this.theater, setup);
    const local = world.byIso.get(this.state.players[0].country)!.idx;
    const session = new LockstepSession(world, local);
    this.session = session;
    session.sendCommands = (cmds) => {
      for (const c of cmds) this.pending.push({ ...c, c: local } as Command);
    };
    session.onHash = (tick, hash) => {
      this.hashes.set(tick, hash);
      if (this.hashes.size > 50) this.hashes.delete(this.hashes.keys().next().value as number);
    };
    // Pre-seal the first `delay` empty turns so everyone can start immediately.
    for (let n = 0; n < this.delay; n++) this.seal(n);
    this.lastTime = performance.now();
    this.timer = window.setInterval(() => this.pump(), 20);
    this.onStart({ session, setup });
  }

  /** Host clock: seal one turn every 100 ms of real time, unless a peer lags behind. */
  private pump() {
    const now = performance.now();
    this.clock += now - this.lastTime;
    this.lastTime = now;
    const session = this.session!;
    while (this.clock >= DT * TURN_TICKS * 1000) {
      const executed = Math.floor(session.world.tick / TURN_TICKS);
      let slowest = executed;
      for (const a of this.acks.values()) slowest = Math.min(slowest, a);
      if (this.sealedUpTo - slowest > MAX_LAG_TURNS) {
        const lagging = [...this.acks.entries()].sort((a, b) => a[1] - b[1])[0];
        const p = this.state.players.find((x) => x.slot === lagging?.[0]);
        session.status = p ? `⏳ ${p.name}` : '⏳';
        this.clock = 0;
        return;
      }
      this.clock -= DT * TURN_TICKS * 1000;
      this.seal(this.sealedUpTo + 1);
    }
  }

  private seal(n: number) {
    const cmds = this.pending;
    this.pending = [];
    this.sealedUpTo = n;
    this.broadcast({ t: 'turn', n, cmds });
    this.session!.receiveTurn(n, cmds);
  }

  close() {
    clearInterval(this.timer);
    clearInterval(this.pingTimer);
    for (const c of this.conns.values()) c.close();
    this.transport.close();
  }
}

// ---------------------------------------------------------------------------
// Client

export class LobbyClient {
  state: LobbyState | null = null;
  slot = -1;
  session: LockstepSession | null = null;
  private conn: Conn | null = null;
  onLobby: (s: LobbyState) => void = () => {};
  onChat: (from: string, text: string) => void = () => {};
  onStart: (info: NetSessionInfo) => void = () => {};
  onClosed: (reason: string) => void = () => {};
  onDesync: () => void = () => {};

  constructor(
    readonly transport: Transport,
    readonly code: string,
    readonly theater: Theater,
    readonly name: string,
  ) {}

  async connect() {
    const c = await this.transport.join(this.code);
    this.conn = c;
    c.onMessage = (raw) => this.handle(raw as ToClient);
    c.onClose = () => {
      if (this.session) this.session.goOffline();
      this.onClosed('hostLeft');
    };
    c.send({ t: 'hello', name: this.name, proto: PROTOCOL, data: dataHash(this.theater) } satisfies ToHost);
  }

  private send(m: ToHost) {
    this.conn?.send(m);
  }

  pick(country: string) {
    this.send({ t: 'pick', country });
  }
  ready(r: boolean) {
    this.send({ t: 'ready', ready: r });
  }
  chat(text: string) {
    this.send({ t: 'chat', text });
  }

  private handle(m: ToClient) {
    switch (m.t) {
      case 'welcome':
        this.slot = m.slot;
        this.state = m.lobby;
        this.onLobby(m.lobby);
        break;
      case 'reject':
        this.onClosed(m.reason);
        break;
      case 'lobby':
        this.state = m.lobby;
        this.onLobby(m.lobby);
        break;
      case 'chat':
        this.onChat(m.from, m.text);
        break;
      case 'ping':
        this.send({ t: 'pong', id: m.id });
        break;
      case 'kicked':
        this.onClosed('kicked');
        break;
      case 'desync':
        this.onDesync();
        break;
      case 'start': {
        const world = new World(this.theater, m.setup);
        const me = m.setup.players.find((p) => p.slot === this.slot)!;
        const session = new LockstepSession(world, world.byIso.get(me.country)!.idx);
        session.sendCommands = (cmds) => this.send({ t: 'cmd', cmds });
        session.onExecutedTurn = (turn) => {
          if (turn % 2 === 0) this.send({ t: 'ack', turn });
        };
        session.onHash = (tick, hash) => this.send({ t: 'hash', tick, hash });
        this.session = session;
        this.onStart({ session, setup: m.setup });
        break;
      }
      case 'turn':
        this.session?.receiveTurn(m.n, m.cmds);
        break;
    }
  }

  close() {
    this.conn?.close();
    this.transport.close();
  }
}
