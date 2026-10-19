/**
 * Transports for multiplayer. Star topology: every client connects to the host.
 *
 * - PeerTransport: WebRTC data channels via PeerJS (public signalling broker, then
 *   direct peer-to-peer). Works from static hosting such as Vercel; no game server.
 * - LocalTransport: BroadcastChannel between tabs of the same browser (offline testing,
 *   hot-seat demos and automated tests).
 */
import type { DataConnection, Peer as PeerT } from 'peerjs';

export interface Conn {
  readonly id: string;
  send(msg: unknown): void;
  close(): void;
  onMessage: (msg: unknown) => void;
  onClose: () => void;
}

export interface Transport {
  /** Host: listen under `code`; resolves when ready to accept connections. */
  host(code: string, onConn: (c: Conn) => void): Promise<void>;
  /** Client: connect to the host listening under `code`. */
  join(code: string): Promise<Conn>;
  close(): void;
}

const PREFIX = 'blackgold-v2-';

// ---------------------------------------------------------------------------

class PeerConn implements Conn {
  onMessage: (msg: unknown) => void = () => {};
  onClose: () => void = () => {};
  private closed = false;
  constructor(readonly dc: DataConnection) {
    dc.on('data', (d) => this.onMessage(d));
    dc.on('close', () => this.fireClose());
    dc.on('error', () => this.fireClose());
    // Detect dead peers (ICE failure) quickly.
    dc.peerConnection?.addEventListener('iceconnectionstatechange', () => {
      const s = dc.peerConnection?.iceConnectionState;
      if (s === 'failed' || s === 'closed') this.fireClose();
    });
  }
  get id() {
    return this.dc.peer;
  }
  send(msg: unknown) {
    if (this.dc.open) this.dc.send(msg);
  }
  close() {
    this.dc.close();
    this.fireClose();
  }
  private fireClose() {
    if (this.closed) return;
    this.closed = true;
    this.onClose();
  }
}

const ICE: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

export class PeerTransport implements Transport {
  private peer: PeerT | null = null;

  private async make(id?: string): Promise<PeerT> {
    const { Peer } = await import('peerjs');
    const iceServers = [...ICE];
    // Optional TURN relay for strict NATs, configured at build time.
    const turn = import.meta.env.VITE_TURN_URL as string | undefined;
    if (turn) iceServers.push({ urls: turn, username: import.meta.env.VITE_TURN_USER as string, credential: import.meta.env.VITE_TURN_PASS as string });
    const peer = id ? new Peer(id, { config: { iceServers }, debug: 0 }) : new Peer({ config: { iceServers }, debug: 0 });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('signalling timeout')), 12000);
      peer.on('open', () => {
        clearTimeout(timer);
        resolve();
      });
      peer.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
    this.peer = peer;
    return peer;
  }

  async host(code: string, onConn: (c: Conn) => void) {
    const peer = await this.make(PREFIX + code);
    peer.on('connection', (dc) => {
      dc.on('open', () => onConn(new PeerConn(dc)));
    });
  }

  async join(code: string): Promise<Conn> {
    const peer = await this.make();
    const dc = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('connect timeout')), 15000);
      dc.on('open', () => {
        clearTimeout(timer);
        resolve(new PeerConn(dc));
      });
      dc.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      peer.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  close() {
    this.peer?.destroy();
    this.peer = null;
  }
}

// ---------------------------------------------------------------------------

interface Envelope {
  from: string;
  to: string;
  kind: 'open' | 'accept' | 'msg' | 'close';
  payload?: unknown;
}

class LocalConn implements Conn {
  onMessage: (msg: unknown) => void = () => {};
  onClose: () => void = () => {};
  constructor(
    readonly id: string,
    private self: string,
    private ch: BroadcastChannel,
  ) {}
  send(msg: unknown) {
    this.ch.postMessage({ from: this.self, to: this.id, kind: 'msg', payload: JSON.parse(JSON.stringify(msg)) } satisfies Envelope);
  }
  close() {
    this.ch.postMessage({ from: this.self, to: this.id, kind: 'close' } satisfies Envelope);
    this.onClose();
  }
}

export class LocalTransport implements Transport {
  private ch: BroadcastChannel | null = null;
  private self = Math.random().toString(36).slice(2, 10);
  private conns = new Map<string, LocalConn>();

  async host(code: string, onConn: (c: Conn) => void) {
    const ch = new BroadcastChannel(PREFIX + code);
    this.ch = ch;
    ch.onmessage = (ev: MessageEvent<Envelope>) => {
      const e = ev.data;
      if (e.kind === 'open' && e.to === 'host') {
        const c = new LocalConn(e.from, 'host', ch);
        this.conns.set(e.from, c);
        ch.postMessage({ from: 'host', to: e.from, kind: 'accept' } satisfies Envelope);
        onConn(c);
      } else if (e.to === 'host') {
        const c = this.conns.get(e.from);
        if (!c) return;
        if (e.kind === 'msg') c.onMessage(e.payload);
        else if (e.kind === 'close') {
          this.conns.delete(e.from);
          c.onClose();
        }
      }
    };
  }

  async join(code: string): Promise<Conn> {
    const ch = new BroadcastChannel(PREFIX + code);
    this.ch = ch;
    const conn = new LocalConn('host', this.self, ch);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no host')), 3000);
      ch.onmessage = (ev: MessageEvent<Envelope>) => {
        const e = ev.data;
        if (e.to !== this.self) return;
        if (e.kind === 'accept') {
          clearTimeout(timer);
          resolve(conn);
        } else if (e.kind === 'msg') conn.onMessage(e.payload);
        else if (e.kind === 'close') conn.onClose();
      };
      ch.postMessage({ from: this.self, to: 'host', kind: 'open' } satisfies Envelope);
    });
  }

  close() {
    this.ch?.close();
    this.ch = null;
  }
}

export function randomCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const buf = new Uint32Array(6);
  crypto.getRandomValues(buf);
  for (const v of buf) s += A[v % A.length];
  return s;
}
