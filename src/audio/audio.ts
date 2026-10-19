import type { SfxName } from '../game/config';

/**
 * Fully procedural audio (no asset downloads): Web Audio synthesized SFX, wind ambience,
 * and a generative soundtrack in the Hijaz maqam with darbuka rhythms.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private ambience!: GainNode;
  private comp!: DynamicsCompressorNode;
  private noise!: AudioBuffer;
  private lastPlayed = new Map<string, number>();
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private musicTimer: number | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private mode: 'menu' | 'battle' | 'off' = 'off';
  intensity = 0;
  volumes = { master: 0.8, music: 0.5, sfx: 0.8 };

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.sfx = ctx.createGain();
    this.music = ctx.createGain();
    this.ambience = ctx.createGain();
    this.sfx.connect(this.comp);
    this.music.connect(this.comp);
    this.ambience.connect(this.comp);
    this.comp.connect(this.master);
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this.startWind();
    if (this.mode !== 'off') this.startMusic();
  }

  setVolumes(v: Partial<AudioEngine['volumes']>) {
    Object.assign(this.volumes, v);
    this.applyVolumes();
  }

  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    this.music.gain.setTargetAtTime(this.volumes.music * 0.55, t, 0.05);
    this.ambience.gain.setTargetAtTime(this.volumes.sfx * 0.5, t, 0.05);
  }

  /**
   * Play a sound effect. `pan` -1..1, `distance` attenuates (0 = at camera focus).
   */
  play(name: SfxName, opts: { pan?: number; distance?: number; volume?: number } = {}) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const minGap = THROTTLE[name] ?? 0.03;
    const last = this.lastPlayed.get(name) ?? -1;
    if (now - last < minGap) return;
    this.lastPlayed.set(name, now);
    const dist = opts.distance ?? 0;
    const vol = (opts.volume ?? 1) * Math.max(0, 1 - dist / 160) ** 1.6;
    if (vol < 0.02) return;
    const out = ctx.createGain();
    out.gain.value = vol;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, opts.pan ?? 0));
    out.connect(panner).connect(this.sfx);
    SYNTHS[name]?.(this, out, now);
  }

  // --- synthesis primitives -------------------------------------------------

  noiseBurst(out: AudioNode, t: number, dur: number, opts: { type?: BiquadFilterType; freq?: number; freqEnd?: number; q?: number; gain?: number; attack?: number }) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'lowpass';
    f.frequency.setValueAtTime(opts.freq ?? 1000, t);
    if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + dur);
    f.Q.value = opts.q ?? 0.8;
    const g = ctx.createGain();
    const peak = opts.gain ?? 1;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (opts.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  tone(out: AudioNode, t: number, dur: number, opts: { type?: OscillatorType; freq: number; freqEnd?: number; gain?: number; attack?: number; detune?: number }) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) o.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + dur);
    if (opts.detune) o.detune.value = opts.detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.5, t + (opts.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // --- ambience ---------------------------------------------------------------

  private startWind() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 420;
    f.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(f.frequency);
    lfo.start();
    src.connect(f).connect(g).connect(this.ambience);
    src.start();
    this.windGain = g;
    this.windFilter = f;
  }

  setStorm(amount: number) {
    if (!this.ctx || !this.windGain || !this.windFilter) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.05 + amount * 0.35, t, 1.5);
    this.windFilter.frequency.setTargetAtTime(420 + amount * 500, t, 1.5);
  }

  // --- music ------------------------------------------------------------------

  setMusic(mode: 'menu' | 'battle' | 'off') {
    this.mode = mode;
    if (!this.ctx) return;
    if (mode === 'off') this.stopMusic();
    else this.startMusic();
  }

  private startMusic() {
    if (this.musicTimer !== null || !this.ctx) return;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.droneStart();
    this.musicTimer = window.setInterval(() => this.schedule(), 50);
  }

  private stopMusic() {
    if (this.musicTimer !== null) clearInterval(this.musicTimer);
    this.musicTimer = null;
    this.droneStop();
  }

  private drone: { oscs: OscillatorNode[]; gain: GainNode } | null = null;

  private droneStart() {
    const ctx = this.ctx!;
    if (this.drone) return;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 3);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 600;
    const oscs = [ROOT / 2, ROOT * 0.75, ROOT / 2 + 0.6].map((freq) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.connect(f);
      o.start();
      return o;
    });
    f.connect(gain).connect(this.music);
    this.drone = { oscs, gain };
  }

  private droneStop() {
    if (!this.drone || !this.ctx) return;
    const { oscs, gain } = this.drone;
    gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.5);
    oscs.forEach((o) => o.stop(this.ctx!.currentTime + 2));
    this.drone = null;
  }

  private melodyIdx = 7;

  private schedule() {
    const ctx = this.ctx!;
    const battle = this.mode === 'battle';
    const bpm = battle ? 100 + this.intensity * 20 : 76;
    const sixteenth = 60 / bpm / 4;
    while (this.nextNoteTime < ctx.currentTime + 0.2) {
      const t = this.nextNoteTime;
      const s = this.step % 32;
      // Maqsoum: D-T-T-D-T over 8 eighths (16 sixteenths)
      if (battle) {
        const pat = s % 16;
        if (pat === 0 || pat === 10) this.doum(t);
        if (pat === 4 || pat === 6 || pat === 12) this.tek(t, 0.5);
        if (this.intensity > 0.4 && (pat === 2 || pat === 14)) this.tek(t, 0.25);
        if (this.intensity > 0.7 && pat % 2 === 1) this.tek(t, 0.12);
        if (s === 0 && this.step % 64 === 0) this.frameDrum(t);
      }
      // Melody: oud-like plucks wandering through Hijaz
      const chance = battle ? 0.3 + this.intensity * 0.2 : 0.22;
      if ((s % 2 === 0 && Math.random() < chance) || s === 0) {
        const move = Math.random() < 0.7 ? (Math.random() < 0.5 ? -1 : 1) : Math.random() < 0.5 ? -2 : 2;
        this.melodyIdx = Math.max(0, Math.min(HIJAZ.length - 1, this.melodyIdx + move));
        if (s === 0 && Math.random() < 0.5) this.melodyIdx = 7;
        this.pluck(t, ROOT * HIJAZ[this.melodyIdx], battle ? 0.12 : 0.1);
        if (Math.random() < 0.18) this.pluck(t + sixteenth, ROOT * HIJAZ[this.melodyIdx], 0.07);
      }
      this.nextNoteTime += sixteenth;
      this.step++;
    }
  }

  private pluck(t: number, freq: number, gain: number) {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq * 8, t);
    f.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.4);
    f.Q.value = 2;
    f.connect(this.music);
    this.tone(f, t, 0.9, { type: 'sawtooth', freq, gain, attack: 0.004 });
    this.tone(f, t, 0.7, { type: 'triangle', freq: freq * 2, gain: gain * 0.4, attack: 0.003, detune: 6 });
  }

  private doum(t: number) {
    this.tone(this.music, t, 0.35, { freq: 95, freqEnd: 55, gain: 0.55, attack: 0.003 });
  }

  private tek(t: number, gain: number) {
    this.noiseBurst(this.music, t, 0.07, { type: 'highpass', freq: 2500, gain: gain * 0.4 });
    this.tone(this.music, t, 0.05, { freq: 520, freqEnd: 380, gain: gain * 0.15 });
  }

  private frameDrum(t: number) {
    this.tone(this.music, t, 0.8, { freq: 70, freqEnd: 45, gain: 0.4, attack: 0.01 });
    this.noiseBurst(this.music, t, 0.4, { type: 'lowpass', freq: 400, gain: 0.2 });
  }
}

/** D Hijaz: D Eb F# G A Bb C D across two octaves (ratios relative to ROOT). */
const ROOT = 146.83; // D3
const SEMI = (n: number) => Math.pow(2, n / 12);
const HIJAZ = [-5, -4, -2, 0, 1, 4, 5, 7, 8, 10, 12, 13, 16, 17, 19].map(SEMI);

const THROTTLE: Partial<Record<SfxName, number>> = {
  rifle: 0.05,
  mg: 0.07,
  cannon: 0.08,
  explosion: 0.06,
  alert: 4,
  siren: 3,
  select: 0.08,
  ack: 0.15,
};

type Synth = (a: AudioEngine, out: AudioNode, t: number) => void;

const SYNTHS: Record<SfxName, Synth> = {
  rifle: (a, o, t) => {
    a.noiseBurst(o, t, 0.09, { type: 'highpass', freq: 1200, gain: 0.35 });
    a.noiseBurst(o, t, 0.15, { type: 'lowpass', freq: 600, gain: 0.25 });
  },
  mg: (a, o, t) => {
    for (let i = 0; i < 3; i++) a.noiseBurst(o, t + i * 0.06, 0.06, { type: 'bandpass', freq: 1500, q: 0.7, gain: 0.3 });
  },
  cannon: (a, o, t) => {
    a.tone(o, t, 0.45, { freq: 110, freqEnd: 38, gain: 0.8 });
    a.noiseBurst(o, t, 0.5, { type: 'lowpass', freq: 1800, freqEnd: 200, gain: 0.7 });
  },
  rocket: (a, o, t) => {
    a.noiseBurst(o, t, 0.6, { type: 'bandpass', freq: 600, freqEnd: 2600, q: 1.2, gain: 0.45, attack: 0.03 });
  },
  missile: (a, o, t) => {
    a.noiseBurst(o, t, 0.9, { type: 'bandpass', freq: 900, freqEnd: 3400, q: 1.5, gain: 0.45, attack: 0.05 });
    a.tone(o, t, 0.6, { type: 'sawtooth', freq: 300, freqEnd: 900, gain: 0.05 });
  },
  artillery: (a, o, t) => {
    for (let i = 0; i < 6; i++) a.noiseBurst(o, t + i * 0.12, 0.5, { type: 'bandpass', freq: 500, freqEnd: 2000, q: 1, gain: 0.35, attack: 0.02 });
  },
  explosion: (a, o, t) => {
    a.tone(o, t, 0.7, { freq: 80, freqEnd: 30, gain: 0.8 });
    a.noiseBurst(o, t, 0.9, { type: 'lowpass', freq: 2500, freqEnd: 120, gain: 0.8 });
  },
  bigExplosion: (a, o, t) => {
    a.tone(o, t, 2.5, { freq: 60, freqEnd: 20, gain: 1 });
    a.noiseBurst(o, t, 3.0, { type: 'lowpass', freq: 3000, freqEnd: 60, gain: 1, attack: 0.01 });
    a.noiseBurst(o, t + 0.15, 2.0, { type: 'bandpass', freq: 300, q: 0.5, gain: 0.6 });
  },
  click: (a, o, t) => a.tone(o, t, 0.05, { type: 'square', freq: 1400, freqEnd: 900, gain: 0.08 }),
  select: (a, o, t) => {
    a.noiseBurst(o, t, 0.05, { type: 'bandpass', freq: 3000, gain: 0.08 });
    a.tone(o, t + 0.02, 0.08, { type: 'square', freq: 880, gain: 0.06 });
    a.tone(o, t + 0.09, 0.08, { type: 'square', freq: 1320, gain: 0.06 });
  },
  ack: (a, o, t) => {
    a.noiseBurst(o, t, 0.12, { type: 'bandpass', freq: 2400, q: 2, gain: 0.12 });
    a.tone(o, t + 0.1, 0.07, { type: 'square', freq: 1100, gain: 0.05 });
  },
  place: (a, o, t) => {
    a.tone(o, t, 0.25, { freq: 160, freqEnd: 70, gain: 0.5 });
    a.noiseBurst(o, t, 0.3, { type: 'lowpass', freq: 800, gain: 0.3 });
  },
  complete: (a, o, t) => {
    [523, 659, 784].forEach((f, i) => a.tone(o, t + i * 0.09, 0.3, { type: 'triangle', freq: f, gain: 0.18 }));
  },
  unitReady: (a, o, t) => {
    a.tone(o, t, 0.12, { type: 'triangle', freq: 660, gain: 0.15 });
    a.tone(o, t + 0.12, 0.2, { type: 'triangle', freq: 990, gain: 0.15 });
  },
  cash: (a, o, t) => {
    a.tone(o, t, 0.12, { type: 'square', freq: 1568, gain: 0.08 });
    a.tone(o, t + 0.08, 0.35, { type: 'square', freq: 2093, gain: 0.08 });
  },
  siren: (a, o, t) => {
    const ctx = a.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.2);
    g.gain.setValueAtTime(0.12, t + 2.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
    for (let i = 0; i < 3; i++) {
      osc.frequency.setValueAtTime(500, t + i);
      osc.frequency.linearRampToValueAtTime(900, t + i + 0.5);
      osc.frequency.linearRampToValueAtTime(500, t + i + 1);
    }
    const f = ctx.createBiquadFilter();
    f.frequency.value = 2000;
    osc.connect(f).connect(g).connect(o);
    osc.start(t);
    osc.stop(t + 3.1);
  },
  alert: (a, o, t) => {
    [880, 660, 880].forEach((f, i) => a.tone(o, t + i * 0.16, 0.14, { type: 'square', freq: f, gain: 0.09 }));
  },
  achievement: (a, o, t) => {
    [523, 659, 784, 1047].forEach((f, i) => a.tone(o, t + i * 0.11, 0.5, { type: 'triangle', freq: f, gain: 0.16 }));
    a.tone(o, t + 0.44, 0.9, { type: 'sine', freq: 1568, gain: 0.08 });
  },
  capture: (a, o, t) => {
    [392, 494, 587].forEach((f, i) => a.tone(o, t + i * 0.07, 0.6, { type: 'triangle', freq: f, gain: 0.12 }));
  },
  error: (a, o, t) => a.tone(o, t, 0.18, { type: 'square', freq: 180, gain: 0.1 }),
  launch: (a, o, t) => {
    a.noiseBurst(o, t, 3.5, { type: 'lowpass', freq: 200, freqEnd: 1500, gain: 0.9, attack: 0.4 });
    a.tone(o, t, 3.0, { freq: 45, freqEnd: 80, gain: 0.6, attack: 0.3 });
  },
  intercept: (a, o, t) => {
    a.noiseBurst(o, t, 1.2, { type: 'lowpass', freq: 4000, freqEnd: 200, gain: 0.7 });
    a.tone(o, t, 0.8, { freq: 120, freqEnd: 40, gain: 0.5 });
  },
  victory: (a, o, t) => {
    [392, 523, 659, 784, 1047].forEach((f, i) => a.tone(o, t + i * 0.18, 1.2, { type: 'triangle', freq: f, gain: 0.15 }));
  },
  defeat: (a, o, t) => {
    [392, 349, 311, 262].forEach((f, i) => a.tone(o, t + i * 0.35, 1.0, { type: 'triangle', freq: f, gain: 0.15 }));
  },
};

export const audio = new AudioEngine();
