import '@fontsource/rajdhani/500.css';
import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/600.css';
import '@fontsource/vazirmatn/800.css';
import './styles/main.css';

import * as THREE from 'three';
import { lonLatToWorld } from './geo/geography';
import { generateMap, type MapData } from './world/heightmap';
import { Stage } from './render/Stage';
import { World } from './game/World';
import { AIController } from './game/ai';
import { Progression } from './game/objectives';
import { BUILD_ORDER, UNIT_ORDER, type MatchSettings } from './game/config';
import { renderThumbnails } from './game/models';
import { Controller } from './input/Controller';
import { Input } from './input/Input';
import { HUD } from './ui/HUD';
import { Menus } from './ui/Menus';
import { audio } from './audio/audio';
import { type Lang, detectLang, getLang, loc, setLang, t } from './i18n';
import { type Settings, autoQuality, loadSettings, saveSettings } from './meta/settings';
import { type AchievementId, type Profile, loadProfile, rankOf, saveProfile, unlock } from './meta/profile';

type State = 'boot' | 'menu' | 'playing' | 'paused' | 'ended';

class App {
  private settings: Settings = loadSettings();
  private profile: Profile = loadProfile();
  private stage!: Stage;
  private map!: MapData;
  private menus: Menus;
  private uiRoot = document.getElementById('ui-root')!;
  private thumbs: Record<string, string> = {};
  private state: State = 'boot';
  private world: World | null = null;
  private ctl: Controller | null = null;
  private input: Input | null = null;
  private hud: HUD | null = null;
  private ais: AIController[] = [];
  private progression: Progression | null = null;
  private match: MatchSettings | null = null;
  private speed = 1;
  private clock = new THREE.Clock();
  private elapsed = 0;
  private menuScreen: () => void = () => {};
  private intensity = 0;

  constructor() {
    setLang(this.settings.lang ?? detectLang());
    this.menus = new Menus({ click: () => audio.play('click') });
    this.menus.root.classList.add('pe');
    this.uiRoot.append(this.menus.root);
  }

  async boot() {
    const splash = document.getElementById('boot-splash')!;
    const fill = splash.querySelector<HTMLElement>('.boot-fill')!;
    const status = document.createElement('div');
    status.className = 'boot-status';
    splash.append(status);
    const step = async (pct: number, msg: string) => {
      fill.style.width = `${pct}%`;
      status.textContent = msg;
      await new Promise((r) => setTimeout(r, 30));
    };
    await step(10, t('loading.terrain'));
    try {
      await document.fonts?.ready;
    } catch {
      /* fonts optional */
    }
    this.map = generateMap(2);
    await step(55, t('loading.models'));
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    const quality = this.settings.quality ?? autoQuality();
    this.stage = new Stage(canvas, this.map, quality);
    this.stage.terrain.setLabelsVisible(this.settings.labels);
    this.thumbs = renderThumbnails(UNIT_ORDER, ['hq', ...BUILD_ORDER], 0x3b82f6);
    audio.setVolumes({ master: this.settings.master, music: this.settings.music, sfx: this.settings.sfx });
    await step(100, t('loading.ready'));

    // Menu camera: slow orbit over the Persian Gulf
    const gulf = lonLatToWorld(50.5, 28);
    this.stage.rig.jumpTo(gulf.x, gulf.z, 230);
    this.stage.rig.orbit = true;

    window.addEventListener('resize', () => this.stage.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.stage.resize(), 200));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
    // Audio must be unlocked by a gesture
    const unlock = () => {
      audio.unlock();
      if (this.state === 'menu') audio.setMusic('menu');
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    splash.classList.add('hide');
    setTimeout(() => splash.remove(), 700);
    this.showMainMenu();
    this.loop();
    this.registerSW();
  }

  private registerSW() {
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------
  // Menus

  private showMainMenu() {
    this.state = 'menu';
    audio.setMusic('menu');
    this.menuScreen = () =>
      this.menus.main({
        profile: this.profile,
        onPlay: () => this.showSetup(),
        onSettings: () => this.showSettings(() => this.showMainMenu()),
        onHowTo: () => this.menus.howto(() => this.showMainMenu()),
        onCareer: () => this.menus.career(this.profile, () => this.showMainMenu()),
        onLang: (l) => this.changeLang(l),
        onFullscreen: () => this.fullscreen(),
      });
    this.menuScreen();
  }

  private showSetup() {
    this.menuScreen = () => this.showSetup();
    this.menus.setup(this.stage.terrain.minimapImage, this.settings.lastMatch, (m) => this.startMatch(m), () => this.showMainMenu());
  }

  private showSettings(back: () => void) {
    this.menuScreen = () => this.showSettings(back);
    this.menus.settings(
      this.settings,
      (s) => {
        audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx });
        if (s.quality && s.quality !== this.stage.quality) this.stage.applyQuality(s.quality);
        if (this.input) this.input.edgeScroll = s.edgeScroll;
        if (this.ctl) this.ctl.haptics = s.haptics;
        if (this.hud) this.hud.showFps = s.showFps;
        this.stage.terrain.setLabelsVisible(s.labels);
        if (this.world) for (const c of this.world.cities) if (c.label) c.label.visible = s.labels;
        saveSettings(s);
        if (s.lang && s.lang !== getLang()) this.changeLang(s.lang);
      },
      back,
    );
  }

  private changeLang(l: Lang) {
    setLang(l);
    this.settings.lang = l;
    saveSettings(this.settings);
    this.stage.terrain.buildLabels();
    this.world?.rebuildLabels();
    this.hud?.rebuild();
    this.menuScreen();
  }

  private fullscreen() {
    const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    if (document.fullscreenElement || doc.webkitFullscreenElement) {
      (document.exitFullscreen ?? doc.webkitExitFullscreen)?.call(document);
      return;
    }
    const req = el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el);
    Promise.resolve(req?.())
      .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.('landscape'))
      .catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // Match lifecycle

  private startMatch(m: MatchSettings) {
    this.teardownMatch();
    this.match = m;
    this.settings.lastMatch = m;
    saveSettings(this.settings);
    this.menus.clear();
    const stage = this.stage;
    const world = new World(this.map, stage.terrain, stage.scene, stage.particles, stage.decals, m);
    world.camera = stage.camera;
    world.playSound = (name, opts) => audio.play(name, opts);
    world.shake = (a) => stage.rig.shake(a);
    const proj = new THREE.Vector3();
    world.spatial = (x, z) => {
      const tgt = stage.rig.target;
      proj.set(x, 0, z).project(stage.camera);
      return { distance: Math.hypot(x - tgt.x, z - tgt.z) * 0.6 + stage.rig.distance * 0.25, pan: Math.max(-1, Math.min(1, proj.x * 0.8)) };
    };
    for (const c of world.cities) if (c.label) c.label.visible = this.settings.labels;

    const ctl = new Controller(world, stage, audio);
    ctl.haptics = this.settings.haptics;
    const input = new Input(stage, ctl);
    input.edgeScroll = this.settings.edgeScroll;
    input.onEscape = () => (this.state === 'playing' ? this.pause() : this.state === 'paused' ? this.resume() : undefined);
    input.onJumpAlert = () => {
      const p = world.lastAlertPos;
      if (p) stage.rig.focus(p.x, p.z);
    };
    const progression = new Progression(world, this.profile);
    const hud = new HUD(world, stage, ctl, input, audio, this.thumbs, progression, {
      onPause: () => this.pause(),
      onSpeed: () => {
        const speeds = [1, 1.5, 2, 3];
        this.speed = speeds[(speeds.indexOf(this.speed) + 1) % speeds.length];
        return this.speed;
      },
      onFullscreen: () => this.fullscreen(),
    });
    hud.showFps = this.settings.showFps;
    this.uiRoot.prepend(hud.root);
    progression.onObjective = (o) => hud.objectiveDone(o.key, o.reward);
    progression.onAchievement = (id) => hud.medal(id);

    world.on((e) => {
      switch (e.type) {
        case 'toast':
          hud.toast(e.key, e.tone, e.extra, e.x !== undefined && e.z !== undefined ? { x: e.x, z: e.z } : undefined);
          break;
        case 'crisis':
          hud.crisis(e.info);
          break;
        case 'eliminated':
          if (e.team !== world.playerTeam) hud.toast('msg.teamEliminated', 'good', `${loc(world.teams[e.team].theme.name)} ${t('msg.teamEliminated')}`);
          break;
        case 'missileLaunch':
          if (e.team !== world.playerTeam) hud.minimap.ping(e.x, e.z, '#ff2020');
          break;
        case 'end':
          this.onEnd(e.victory);
          break;
      }
    });

    this.ais = world.teams.filter((tm) => tm.isAI).map((tm) => new AIController(world, tm.id));
    this.world = world;
    this.ctl = ctl;
    this.input = input;
    this.hud = hud;
    this.progression = progression;
    this.speed = 1;
    const me = world.teams[world.playerTeam];
    stage.rig.orbit = false;
    stage.rig.jumpTo(me.startX, me.startZ + 6, 60);
    this.state = 'playing';
    audio.setMusic('battle');
    audio.play('complete');
  }

  private teardownMatch() {
    this.input?.dispose();
    this.hud?.destroy();
    this.world?.dispose();
    this.world = null;
    this.ctl = null;
    this.input = null;
    this.hud = null;
    this.ais = [];
    this.progression = null;
    this.stage.storm = 0;
    audio.setStorm(0);
  }

  private pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    if (this.input) this.input.enabled = false;
    const show = () =>
      this.menus.pause({
        onResume: () => this.resume(),
        onSettings: () => this.showSettings(show),
        onHowTo: () => this.menus.howto(show),
        onQuit: () => {
          this.teardownMatch();
          const gulf = lonLatToWorld(50.5, 28);
          this.stage.rig.jumpTo(gulf.x, gulf.z, 230);
          this.stage.rig.orbit = true;
          this.showMainMenu();
        },
      });
    this.menuScreen = show;
    show();
  }

  private resume() {
    if (this.state !== 'paused') return;
    this.menus.clear();
    this.state = 'playing';
    if (this.input) this.input.enabled = true;
  }

  private onEnd(victory: boolean) {
    const world = this.world!;
    const m = this.match!;
    const me = world.teams[world.playerTeam];
    const s = me.stats;
    const diffMul = m.difficulty === 'hard' ? 2 : m.difficulty === 'normal' ? 1.4 : 1;
    const cities = world.cities.filter((c) => c.owner === world.playerTeam).length;
    const score = Math.round(
      (s.kills * 10 + s.buildingsDestroyed * 60 + s.creditsEarned / 20 + s.maxCities * 80 + (victory ? 2500 + m.opponents * 1000 : 0)) * diffMul,
    );
    const xp = Math.round(score / 12) + (victory ? 250 : 60);
    const rankBefore = rankOf(this.profile.xp);
    const medals: AchievementId[] = [...(this.progression?.earned ?? [])];
    const grant = (id: AchievementId) => unlock(this.profile, id) && medals.push(id);
    if (victory) {
      grant('victory');
      if (m.difficulty === 'hard') grant('general');
      if (world.time < 900) grant('blitz');
      if (m.opponents >= 3) grant('survivor');
    }
    this.profile.games++;
    if (victory) this.profile.wins++;
    this.profile.xp += xp;
    this.profile.bestScore = Math.max(this.profile.bestScore, score);
    saveProfile(this.profile);
    audio.play(victory ? 'victory' : 'defeat');
    this.state = 'ended';
    window.setTimeout(() => {
      if (this.world !== world) return;
      if (this.input) this.input.enabled = false;
      this.menuScreen = () => {};
      this.menus.end({
        victory,
        stats: s,
        time: world.time,
        cities,
        score,
        xp,
        profile: this.profile,
        rankBefore,
        medals,
        onAgain: () => this.startMatch(m),
        onMenu: () => {
          this.teardownMatch();
          const gulf = lonLatToWorld(50.5, 28);
          this.stage.rig.jumpTo(gulf.x, gulf.z, 230);
          this.stage.rig.orbit = true;
          this.showMainMenu();
        },
      });
    }, 2600);
  }

  /** Dev/testing hook: let an AI play for the human side. */
  debugAutoplay() {
    if (this.world) this.ais.push(new AIController(this.world, this.world.playerTeam));
  }

  /** Dev/testing hook: advance the simulation without rendering. */
  debugSimulate(seconds: number) {
    const world = this.world;
    if (!world) return;
    const step = 1 / 30;
    for (let t = 0; t < seconds && !world.ended; t += step) {
      world.update(step);
      for (const ai of this.ais) ai.update(step);
      this.progression?.update(step);
    }
  }

  // ---------------------------------------------------------------------------
  // Frame loop

  private loop = () => {
    requestAnimationFrame(this.loop);
    const rawDt = Math.min(0.1, this.clock.getDelta());
    this.elapsed += rawDt;
    const stage = this.stage;
    const world = this.world;

    if (world && (this.state === 'playing' || this.state === 'ended')) {
      // Fixed-ish substeps keep fast-forward stable.
      let simDt = rawDt * (this.state === 'ended' ? 0.4 : this.speed);
      while (simDt > 0) {
        const step = Math.min(simDt, 1 / 30);
        world.update(step);
        for (const ai of this.ais) ai.update(step);
        this.progression?.update(step);
        simDt -= step;
      }
      this.ctl!.prune();
      this.ctl!.update(this.elapsed);
      this.input!.update(rawDt);
      this.hud!.update(rawDt);
      stage.storm = world.crises.sandstorm;
      audio.setStorm(world.crises.sandstorm);
      if (world.crises.sandstorm > 0.1) stage.particles.sandstorm(stage.rig.target, 50 * world.crises.sandstorm);
      const target = Math.min(1, world.projectiles.count / 18);
      this.intensity += (target - this.intensity) * Math.min(1, rawDt * 0.5);
      audio.intensity = this.intensity;
      if (this.state === 'ended') stage.rig.rotate(rawDt * 0.05);
    }
    stage.update(rawDt, this.elapsed);
    stage.render();
  };
}

const app = new App();
if (import.meta.env.DEV) (window as unknown as { __app: App }).__app = app;
app.boot().catch((err) => {
  console.error(err);
  const splash = document.getElementById('boot-splash');
  if (splash) splash.innerHTML = `<div class="boot-logo" style="font-size:20px;letter-spacing:.1em">WebGL error</div><div class="boot-status">${String(err?.message ?? err)}</div>`;
});
