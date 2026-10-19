import type { I18nKey } from '../i18n';
import { ECONOMY } from './config';

/** Mean-reverting oil price random walk with event shocks. */
export class Market {
  price = ECONOMY.basePrice;
  shock = 1;
  history: number[] = [];
  private sampleTimer = 0;
  private noise = 0;

  update(dt: number) {
    // Ornstein-Uhlenbeck style noise around base * shock
    this.noise += (-this.noise * 0.08 + (Math.random() - 0.5) * 3.2) * dt;
    this.shock += (1 - this.shock) * dt * 0.012;
    const target = ECONOMY.basePrice * this.shock * (1 + this.noise * 0.08);
    this.price += (target - this.price) * Math.min(1, dt * 0.6);
    this.price = Math.max(20, Math.min(180, this.price));
    this.sampleTimer -= dt;
    if (this.sampleTimer <= 0) {
      this.sampleTimer = 2;
      this.history.push(this.price);
      if (this.history.length > 60) this.history.shift();
    }
  }

  get trend(): number {
    const h = this.history;
    if (h.length < 3) return 0;
    return h[h.length - 1] - h[h.length - 3];
  }

  get average(): number {
    const h = this.history;
    if (!h.length) return this.price;
    return h.reduce((a, b) => a + b, 0) / h.length;
  }
}

export type CrisisKind = 'sandstorm' | 'tanker' | 'glut' | 'heatwave' | 'drought' | 'sabotage' | 'sanctions';

export interface CrisisInfo {
  kind: CrisisKind;
  title: I18nKey;
  desc: I18nKey;
  icon: string;
  duration: number;
  remaining: number;
}

const DEFS: Record<CrisisKind, { title: I18nKey; desc: I18nKey; icon: string; duration: number; weight: number }> = {
  sandstorm: { title: 'event.sandstorm', desc: 'event.sandstorm.desc', icon: '🌪️', duration: 45, weight: 3 },
  tanker: { title: 'event.tanker', desc: 'event.tanker.desc', icon: '🛢️', duration: 60, weight: 3 },
  glut: { title: 'event.glut', desc: 'event.glut.desc', icon: '📉', duration: 60, weight: 2 },
  heatwave: { title: 'event.heatwave', desc: 'event.heatwave.desc', icon: '🌡️', duration: 50, weight: 2 },
  drought: { title: 'event.drought', desc: 'event.drought.desc', icon: '💧', duration: 60, weight: 2 },
  sabotage: { title: 'event.sabotage', desc: 'event.sabotage.desc', icon: '💥', duration: 6, weight: 2 },
  sanctions: { title: 'event.sanctions', desc: 'event.sanctions.desc', icon: '⚖️', duration: 75, weight: 1.5 },
};

export interface CrisisHost {
  market: Market;
  sabotageRandomDerrick(): void;
  sanctionLeader(duration: number): void;
  onCrisis(info: CrisisInfo): void;
}

/** Random regional crises that reshape the battlefield. */
export class Crises {
  sandstorm = 0; // 0..1 intensity
  heatwave = false;
  drought = false;
  active: CrisisInfo[] = [];
  private timer = 100 + Math.random() * 40;
  enabled = true;

  constructor(private host: CrisisHost) {}

  update(dt: number) {
    for (const c of this.active) c.remaining -= dt;
    this.active = this.active.filter((c) => c.remaining > 0);
    const storm = this.active.some((c) => c.kind === 'sandstorm');
    this.sandstorm += ((storm ? 1 : 0) - this.sandstorm) * Math.min(1, dt * 0.4);
    this.heatwave = this.active.some((c) => c.kind === 'heatwave');
    this.drought = this.active.some((c) => c.kind === 'drought');
    if (!this.enabled) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 85 + Math.random() * 70;
      this.trigger(this.pick());
    }
  }

  private pick(): CrisisKind {
    const options = (Object.keys(DEFS) as CrisisKind[]).filter((k) => !this.active.some((a) => a.kind === k));
    const total = options.reduce((s, k) => s + DEFS[k].weight, 0);
    let r = Math.random() * total;
    for (const k of options) {
      r -= DEFS[k].weight;
      if (r <= 0) return k;
    }
    return options[0] ?? 'sandstorm';
  }

  trigger(kind: CrisisKind) {
    const d = DEFS[kind];
    const info: CrisisInfo = { kind, title: d.title, desc: d.desc, icon: d.icon, duration: d.duration, remaining: d.duration };
    this.active.push(info);
    const m = this.host.market;
    switch (kind) {
      case 'tanker':
        m.shock = Math.min(2.2, m.shock * 1.65);
        break;
      case 'glut':
        m.shock = Math.max(0.45, m.shock * 0.6);
        break;
      case 'sabotage':
        this.host.sabotageRandomDerrick();
        break;
      case 'sanctions':
        this.host.sanctionLeader(d.duration);
        break;
    }
    this.host.onCrisis(info);
  }
}
