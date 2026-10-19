import '@fontsource/rajdhani/500.css';
import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/600.css';
import '@fontsource/vazirmatn/700.css';
import './styles/main.css';

import * as THREE from 'three';
import { type Theater, loadTheater } from './geo/theater';
import { lonLatToWorld } from './geo/projection';
import { World3D } from './render/World3D';
import { autoQuality } from './render/Stage';
import { World, type MatchSetup } from './sim/world';
import { LocalSession, type Session } from './net/Session';
import { Game } from './game/Game';
import { Menus } from './ui/menus/Menus';
import { renderThumbs } from './ui/thumbs';
import { camoFor } from './render/models/units';
import { audio } from './audio/audio';
import { type Lang, detectLang, setLang, t } from './i18n';
import { type Settings, loadSettings, saveSettings } from './meta/settings';
import { type Profile, loadProfile, rankOf, saveProfile } from './meta/profile';
import { hashString } from './sim/rng';
import { MenuMap } from './ui/menus/MenuMap';
import type { NetSessionInfo } from './net/Lockstep';
import { AIController } from './sim/ai/ai';

type State = 'boot' | 'menu' | 'playing' | 'paused' | 'ended';

class App {
  settings: Settings = loadSettings();
  profile: Profile = loadProfile();
  theater!: Theater;
  view!: World3D;
  game: Game | null = null;
  menus!: Menus;
  menuMap!: MenuMap;
  state: State = 'boot';
  private uiRoot = document.getElementById('ui-root')!;
  private last = performance.now();
  private setup: MatchSetup | null = null;

  async boot() {
    setLang(this.settings.lang ?? detectLang());
    document.documentElement.style.setProperty('--ui', String(this.settings.uiScale));
    const splash = document.getElementById('boot-splash')!;
    const fill = splash.querySelector<HTMLElement>('.boot-fill')!;
    const status = splash.querySelector<HTMLElement>('.boot-status')!;
    const progress = (f: number, msg: string) => {
      fill.style.width = `${Math.round(f * 100)}%`;
      status.textContent = msg;
    };
    progress(0.05, t('loading.data'));
    const mobile = matchMedia('(pointer: coarse)').matches;
    const [theater, base] = await Promise.all([
      loadTheater('/data/theater.bin.gz', (f) => progress(0.05 + f * 0.55, t('loading.data'))),
      new THREE.TextureLoader().loadAsync(mobile ? '/data/base-2k.jpg' : '/data/base.jpg'),
      document.fonts?.ready.catch(() => undefined),
    ]);
    this.theater = theater;
    progress(0.7, t('loading.imagery'));
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    const quality = this.settings.quality ?? autoQuality();
    this.view = new World3D(canvas, theater, base, quality);
    this.view.terrain.setImagery(this.settings.imagery);
    progress(0.85, t('loading.models'));
    await new Promise((r) => setTimeout(r, 20));
    renderThumbs(this.view.stage.renderer, '#3b82f6', camoFor('IRN'));
    audio.setVolumes({ master: this.settings.master, music: this.settings.music, sfx: this.settings.sfx });
    this.menuMap = new MenuMap(this.view, theater);
    this.menus = new Menus(this);
    progress(1, t('loading.ready'));

    window.addEventListener('resize', () => this.view.stage.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.view.stage.resize(), 250));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing' && !this.game?.session.multiplayer) this.pause();
    });
    const unlock = () => {
      audio.unlock();
      audio.setMusic(this.state === 'playing' ? 'battle' : 'menu');
    };
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });

    splash.classList.add('hide');
    setTimeout(() => splash.remove(), 700);
    this.registerSW();
    requestAnimationFrame(this.loop);

    const params = new URLSearchParams(location.search);
    if (params.get('quick')) this.startSingle({ ...this.settings.setup, country: params.get('country') ?? this.settings.setup.country });
    else if (params.get('room')) this.menus.multiplayer(params.get('room')!);
    else this.showMenu();
  }

  private registerSW() {
    if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  showMenu() {
    this.state = 'menu';
    this.menuMap.enable(true);
    this.menuMap.flyover();
    audio.setMusic('menu');
    this.menus.main();
  }

  setLanguage(l: Lang) {
    setLang(l);
    this.settings.lang = l;
    saveSettings(this.settings);
    this.game?.layers.buildLabels();
    this.game?.hud.refresh();
  }

  // ---------------------------------------------------------------------------

  startSingle(prefs: Settings['setup']) {
    this.settings.setup = prefs;
    saveSettings(this.settings);
    const setup: MatchSetup = {
      seed: (Date.now() ^ hashString(prefs.country)) >>> 0,
      players: [{ slot: 0, name: this.settings.name || 'Commander', country: prefs.country }],
      aiMajors: prefs.rivals.filter((r) => r !== prefs.country),
      difficulty: prefs.difficulty,
      startFunds: prefs.funds,
      scenario: prefs.scenario,
      events: prefs.events,
      timeLimit: prefs.timeLimit,
    };
    const world = new World(this.theater, setup);
    const local = world.byIso.get(prefs.country)!.idx;
    this.launch(new LocalSession(world, local), setup);
  }

  startNetwork(info: NetSessionInfo) {
    this.launch(info.session, info.setup);
  }

  private launch(session: Session, setup: MatchSetup) {
    this.teardown();
    this.setup = setup;
    this.menus.clear();
    this.menuMap.enable(false);
    this.game = new Game(session, this.view, this.settings, this.uiRoot, {
      onEnd: (victory, winners) => this.onEnd(victory, winners),
      onPause: () => this.pause(),
      onQuit: () => this.quit(),
    });
    this.state = 'playing';
  }

  teardown() {
    this.game?.dispose();
    this.game = null;
  }

  pause() {
    if (this.state !== 'playing' || !this.game) return;
    if (!this.game.session.multiplayer) this.game.session.paused = true;
    this.state = 'paused';
    this.game.input.enabled = false;
    this.menus.pause();
  }

  resume() {
    if (this.state !== 'paused' || !this.game) return;
    this.menus.clear();
    this.game.session.paused = false;
    this.game.input.enabled = true;
    this.state = 'playing';
  }

  quit() {
    this.teardown();
    this.showMenu();
  }

  surrender() {
    this.game?.session.issue({ k: 'surrender' });
    this.resume();
  }

  restart() {
    if (this.setup && this.game && !this.game.session.multiplayer) this.startSingle(this.settings.setup);
  }

  private onEnd(victory: boolean, winners: number[]) {
    const game = this.game!;
    const w = game.world;
    const me = w.countries[game.session.local];
    const score = w.score(me.idx) + (victory ? 3000 : 0);
    const diffMul = { easy: 0.8, normal: 1, hard: 1.4, brutal: 2 }[this.setup?.difficulty ?? 'normal'];
    const xp = Math.round((score / 10) * diffMul) + (victory ? 300 : 80);
    const before = rankOf(this.profile.xp);
    this.profile.games++;
    if (victory) this.profile.wins++;
    this.profile.xp += xp;
    this.profile.bestScore = Math.max(this.profile.bestScore, score);
    saveProfile(this.profile);
    this.state = 'ended';
    setTimeout(() => {
      if (this.game !== game) return;
      game.input.enabled = false;
      this.menus.end({ victory, winners, score, xp, rankBefore: before });
    }, 2200);
  }

  /** Dev/testing: let the AI command our nation and fast-forward. */
  debugAutoplay(speed = 8) {
    const g = this.game;
    if (!g) return;
    g.world.countries[g.session.local].controller = 'ai';
    g.world.ais.push(new AIController(g.world, g.session.local));
    g.session.speed = speed;
  }

  /** Dev/testing: run the simulation headless for `seconds` of game time. */
  debugSimulate(seconds: number) {
    const g = this.game;
    if (!g) return;
    const w = g.world;
    const end = w.time + seconds;
    while (w.time < end && !w.ended) w.step([]);
  }

  private loop = () => {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.game) this.game.frame(this.state === 'paused' && !this.game.session.multiplayer ? 0 : dt);
    else {
      this.menuMap.update(dt);
      this.view.frame(dt);
    }
    this.view.render(dt);
  };
}

const app = new App();
export type { App };
if (import.meta.env.DEV) (window as unknown as { app: App }).app = app;
app.boot().catch((err) => {
  console.error(err);
  const splash = document.getElementById('boot-splash');
  if (splash) splash.innerHTML = `<div class="boot-logo" style="font-size:22px">${t('loading.webgl')}</div><div class="boot-status">${String(err?.message ?? err)}</div>`;
});
void lonLatToWorld;
