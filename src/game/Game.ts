/**
 * One running match: simulation session + 3D view layers + input + HUD + audio.
 */
import * as THREE from 'three';
import type { World, SimEvent } from '../sim/world';
import type { Session } from '../net/Session';
import type { World3D } from '../render/World3D';
import type { Settings } from '../meta/settings';
import { EntityRenderer, visAlt } from '../render/EntityRenderer';
import { Effects } from '../render/fx/Effects';
import { Markers, Rings, Sprites } from '../render/Overlays';
import { MapLayers } from '../render/MapLayers';
import { Controller } from '../input/Controller';
import { Input } from '../input/Input';
import { HUD } from '../ui/hud/HUD';
import { audio } from '../audio/audio';
import { BUILDINGS } from '../sim/defs';

const C = (hex: number | string) => new THREE.Color(hex);
const SEL_OWN = C(0x5dff8a);
const SEL_ENEMY = C(0xff4a3a);
const SEL_ALLY = C(0x5dd6ff);
const SEL_NEUTRAL = C(0xffd34d);
const HOVER = C(0xffffff);
const BAR_BUILD = C(0xf5c542);

export interface GameHooks {
  onEnd: (victory: boolean, winners: number[]) => void;
  onPause: () => void;
  onQuit: () => void;
}

export class Game {
  readonly world: World;
  readonly entities: EntityRenderer;
  readonly effects: Effects;
  readonly sprites = new Sprites();
  readonly rings: Rings;
  readonly markers = new Markers();
  readonly layers: MapLayers;
  readonly ctl: Controller;
  readonly input: Input;
  readonly hud: HUD;
  private root = new THREE.Group();
  private teamColors: THREE.Color[];
  private ambientT = 0;
  private intensity = 0;
  private combatHeat = 0;
  private lastJet = 0;
  ended = false;
  private disposed = false;

  constructor(
    readonly session: Session,
    readonly view: World3D,
    readonly settings: Settings,
    uiRoot: HTMLElement,
    readonly hooks: GameHooks,
  ) {
    this.world = session.world;
    const stage = view.stage;
    const local = session.local;
    this.teamColors = this.world.countries.map((c) => C(c.meta.color));
    this.entities = new EntityRenderer(this.world, view.terrain, local, stage.profile.shadows > 0);
    this.effects = new Effects(this.world, view.terrain, local, stage.profile.particles);
    this.rings = new Rings(this.root);
    this.root.add(this.entities.group, this.effects.group, this.markers.group, this.sprites.mesh);
    stage.scene.add(this.root);
    this.layers = new MapLayers(this.world, view.terrain, local, uiRoot);
    this.layers.showLabels = settings.labels;
    stage.scene.add(this.layers.group);

    this.ctl = new Controller(session, view, this.entities, this.markers);
    this.ctl.haptics = settings.haptics;
    this.input = new Input(view, this.ctl, stage.canvas);
    this.input.edgeScroll = settings.edgeScroll && !matchMedia('(pointer: coarse)').matches;
    this.hud = new HUD(this, uiRoot);
    this.input.onEscape = () => hooks.onPause();
    this.input.onJumpAlert = () => {
      const p = this.ctl.lastAlert;
      if (p) view.rig.focus(p.x, p.z, Math.min(view.rig.goal.dist, 25));
    };
    this.input.onHotkey = (code, e) => this.hud.hotkey(code, e);
    this.input.onPlacementTap = () => this.hud.refresh();
    this.ctl.onAlert = (key) => this.hud.alert({ t: 'alert', to: local, key, tone: 'bad' });

    this.effects.onSound = (s, x, z, v) => this.sound(s, x, z, v);
    this.effects.onShake = (a, x, z) => {
      const d = Math.hypot(x - view.rig.target.x, z - view.rig.target.z) / (view.rig.dist + 5);
      if (d < 1.5) view.rig.shake(a * (1 - d / 1.5));
    };
    session.onTick = (events) => this.onTick(events);

    // Start over our HQ.
    const me = this.world.countries[local];
    view.rig.orbit = false;
    view.rig.jumpTo(me.startX, me.startZ + 1, 7);
    view.rig.goal.yaw = view.rig.yaw = 0;
    audio.setMusic('battle');
  }

  private sound(s: Parameters<typeof audio.play>[0], x: number, z: number, v = 1) {
    if (x < 0) {
      audio.play(s, { volume: v });
      return;
    }
    const rig = this.view.rig;
    const d = Math.hypot(x - rig.target.x, z - rig.target.z) / (rig.dist * 2.2 + 4);
    if (d > 1) return;
    const p = new THREE.Vector3(x, 0, z).project(this.view.stage.camera);
    audio.play(s, { volume: v, distance: d, pan: THREE.MathUtils.clamp(p.x * 0.8, -1, 1) });
  }

  private onTick(events: SimEvent[]) {
    this.effects.handle(events);
    const local = this.session.local;
    for (const e of events) {
      switch (e.t) {
        case 'alert':
          if (e.to !== local) break;
          this.hud.alert(e);
          if (e.x !== undefined && e.z !== undefined && e.tone !== 'good') this.ctl.lastAlert = { x: e.x, z: e.z };
          if (e.key === 'missileInbound') audio.play('siren', { volume: 0.8 });
          else if (e.tone === 'bad' || e.tone === 'warn') audio.play('alert', { volume: 0.7 });
          break;
        case 'sound':
          this.sound(e.s, e.x, e.z, e.v);
          break;
        case 'crisis':
          this.hud.crisis(e.id);
          break;
        case 'diplo':
          if (e.a === local || e.b === local) audio.play(e.what === 'war' ? 'war' : 'diplomacy', { volume: 0.8 });
          this.hud.refresh();
          break;
        case 'death':
          this.entities.addWreck(e.def, e.unit, e.x, e.z, 0, e.owner);
          this.combatHeat += e.unit ? 1 : 3;
          break;
        case 'fire':
          this.combatHeat += 0.05;
          break;
        case 'captured':
          this.hud.refresh();
          break;
        case 'end':
          if (!this.ended) {
            this.ended = true;
            const victory = e.winners.includes(local);
            audio.play(victory ? 'victory' : 'defeat');
            this.hooks.onEnd(victory, e.winners);
          }
          break;
        case 'eliminated':
          if (e.country === local && !this.ended) {
            this.ended = true;
            audio.play('defeat');
            this.hooks.onEnd(false, []);
          }
          break;
      }
    }
  }

  frame(dt: number) {
    if (this.disposed) return;
    const alpha = this.session.advance(dt);
    const view = this.view;
    const rig = view.rig;
    this.input.update(dt);
    view.frame(dt);
    const camDist = rig.dist;
    // Models give way to tactical symbols as we zoom out.
    this.entities.showModels = camDist < 220;
    this.entities.update(alpha, dt, camDist);
    this.effects.scale = this.entities.unitScale;
    this.effects.camDist = camDist;
    const { w, h } = this.ctl.viewport();
    this.effects.particles.setView(view.stage.camera, h * view.stage.renderer.getPixelRatio(), view.stage.fog);
    this.effects.update(dt, alpha, view.stage.camera);
    this.ambient(dt);
    this.overlays(alpha, camDist, w, h);
    this.markers.update(dt);
    this.layers.update(view.stage.camera, camDist, w, h);
    this.hud.update(dt);
    // Music intensity follows the fighting.
    this.combatHeat *= Math.exp(-dt * 0.3);
    this.intensity += (Math.min(1, this.combatHeat / 25) - this.intensity) * Math.min(1, dt * 0.5);
    audio.intensity = this.intensity;
    const storm = this.world.crises.storm;
    const stormAmt = storm ? Math.max(0, 1 - Math.hypot(storm.x - rig.target.x, storm.z - rig.target.z) / storm.r) : 0;
    audio.setStorm(stormAmt);
    view.stage.fog.color.lerpColors(view.stage.hazeColor, new THREE.Color(0xc9a66b), stormAmt * 0.8);
    if (stormAmt > 0) view.stage.fog.near *= 1 - stormAmt * 0.85;
  }

  /** Ambient particle life around what the camera is looking at. */
  private ambient(dt: number) {
    this.ambientT += dt;
    if (this.ambientT < 0.08) return;
    const step = this.ambientT;
    this.ambientT = 0;
    const p = this.effects.particles;
    const rig = this.view.rig;
    if (rig.dist > 120) return;
    const tx = rig.target.x;
    const tz = rig.target.z;
    const range = rig.dist * 2.5 + 4;
    const k = this.entities.unitScale;
    const terrain = this.view.terrain;
    const near = (x: number, z: number) => Math.abs(x - tx) < range && Math.abs(z - tz) < range;
    for (const e of this.entities.visible) {
      if (!near(e.x, e.z)) continue;
      if (!e.isUnit) {
        const y = terrain.heightAt(e.x, e.z);
        if (e.built && !this.world.countries[e.owner].lowPower) {
          const model = this.entities.buildingModel(e.def.id);
          for (const em of model.emitters) {
            const x = e.x + em.pos.x;
            const z = e.z + em.pos.z;
            const yy = y + em.pos.y;
            if (em.kind === 'smoke') p.smoke(x, yy, z, 0.04, false);
            else if (em.kind === 'steam') p.steam(x, yy, z, 0.07);
            else if (em.kind === 'flare') p.flare(x, yy, z, 0.02);
          }
        }
        if (e.hp < e.maxHp * 0.5 && e.built) p.burning(e.x + (Math.random() - 0.5) * e.half, y + 0.02, e.z + (Math.random() - 0.5) * e.half, 0.03 + (1 - e.hp / e.maxHp) * 0.05);
        if (!e.built && Math.random() < 0.4) p.dust(e.x + (Math.random() - 0.5) * BUILDINGS[e.def.id].size, y, e.z + (Math.random() - 0.5) * BUILDINGS[e.def.id].size, 0.05);
        continue;
      }
      const u = e;
      const y = terrain.surfaceAt(u.x, u.z);
      if (u.hp < u.maxHp * 0.4 && u.def.category !== 'infantry') p.smoke(u.x, y + (u.isAir ? visAlt(u.y) * k : 0.02 * k), u.z, 0.02 * k, true);
      if (!u.isAir && !u.isNaval && u.speed > 0.15 && u.def.category === 'vehicle' && Math.random() < 0.5) p.dust(u.x - Math.sin(u.heading) * u.radius * k, y, u.z - Math.cos(u.heading) * u.radius * k, 0.03 * k);
      if (u.isNaval && u.speed > 0.2) p.steam(u.x - Math.sin(u.heading) * u.radius * k, y, u.z - Math.cos(u.heading) * u.radius * k, 0.02 * k);
      if (u.def.flight === 'jet' && this.ambientT === 0 && performance.now() - this.lastJet > 4000 && Math.hypot(u.x - tx, u.z - tz) < rig.dist * 0.8) {
        this.lastJet = performance.now();
        this.sound('jet', u.x, u.z, 0.8);
      }
      if (u.def.id === 'loiter' && Math.random() < 0.02) this.sound('shahed', u.x, u.z, 0.7);
      if (u.def.flight === 'heli' && Math.random() < 0.03) this.sound('heli', u.x, u.z, 0.5);
    }
    // Oil fires
    for (const f of this.world.oil) {
      if (f.fire > 0 && near(f.x, f.z) && this.world.vision.isExplored(this.session.local, f.x, f.z)) {
        const y = terrain.heightAt(f.x, f.z);
        for (let i = 0; i < 2; i++) p.burning(f.x, y + 0.01, f.z, 0.08);
      }
    }
    // Sandstorm haze near the camera
    const storm = this.world.crises.storm;
    if (storm && Math.hypot(storm.x - tx, storm.z - tz) < storm.r)
      for (let i = 0; i < 6; i++) p.dust(tx + (Math.random() - 0.5) * rig.dist * 2, terrain.heightAt(tx, tz) + Math.random() * rig.dist * 0.3, tz + (Math.random() - 0.5) * rig.dist * 2, rig.dist * 0.08);
    void step;
  }

  private overlays(alpha: number, camDist: number, w: number, h: number) {
    const world = this.world;
    const local = this.session.local;
    const terrain = this.view.terrain;
    const rings = this.rings;
    const sprites = this.sprites;
    sprites.begin(w, h);
    rings.begin();
    const k = this.entities.unitScale;
    const iconAlpha = THREE.MathUtils.clamp((camDist - 50) / 60, 0, 1);
    const showBars = camDist < 60;
    const cluster = new Set<string>();
    const v = new THREE.Vector3();
    const cam = this.view.stage.camera;
    for (const e of this.entities.visible) {
      const sel = this.ctl.selection.has(e.id);
      const hov = this.ctl.hover === e;
      const ix = e.isUnit ? e.px + (e.x - e.px) * alpha : e.x;
      const iz = e.isUnit ? e.pz + (e.z - e.pz) * alpha : e.z;
      const gy = terrain.surfaceAt(ix, iz);
      const y = e.isUnit && e.isAir ? gy + visAlt(e.py + (e.y - e.py) * alpha) * Math.max(1, k * 0.7) : gy;
      const rel = e.owner === local ? 'own' : world.allied(local, e.owner) ? 'ally' : world.isEnemy(local, e.owner) ? 'enemy' : 'neutral';
      const ringR = e.isUnit ? e.radius * k * 1.25 : e.half * 1.5;
      if ((sel || hov) && camDist < 260) rings.push(ix, gy + 0.004, iz, ringR, hov && !sel ? HOVER : rel === 'own' ? SEL_OWN : rel === 'ally' ? SEL_ALLY : rel === 'enemy' ? SEL_ENEMY : SEL_NEUTRAL);
      else if (e.isUnit && rel !== 'own' && camDist < 60 && camDist > 2.5) rings.push(ix, gy + 0.003, iz, ringR * 0.9, this.teamColors[e.owner]);
      // Bars
      if (showBars || sel) {
        const top = y + (e.isUnit ? (this.entities.model(e.def.id, true).height + 0.02) * k : this.entities.buildingModel(e.def.id).height + 0.04);
        if (!e.isUnit && !e.built) sprites.bar(ix, top, iz, e.progress, BAR_BUILD, 46, 0);
        else if (sel || e.hp < e.maxHp) {
          const f = e.hp / e.maxHp;
          sprites.bar(ix, top, iz, f, f > 0.6 ? SEL_OWN : f > 0.3 ? SEL_NEUTRAL : SEL_ENEMY, e.isUnit ? 30 : 48, 0);
        }
        if (!e.isUnit && e.built && e.queue.length && e.owner === local) {
          const f = Math.min(1, e.prodTime / Math.max(0.01, (world.countries[e.owner].lowPower ? 2 : 1) * 1));
          void f;
        }
      }
      // Strategic symbols (clustered in 26 px screen cells per owner)
      if (iconAlpha > 0.01) {
        v.set(ix, y, iz).project(cam);
        if (v.z > 1) continue;
        const sx = Math.floor(((v.x * 0.5 + 0.5) * w) / 26);
        const sy = Math.floor(((-v.y * 0.5 + 0.5) * h) / 26);
        const key = `${e.owner}:${sx}:${sy}:${e.isUnit ? 'u' : 'b'}`;
        if (cluster.has(key) && !sel) continue;
        cluster.add(key);
        const shape = !e.isUnit ? 'base' : rel === 'enemy' ? 'hostile' : rel === 'neutral' ? 'neutral' : 'friend';
        const size = e.isUnit ? 22 : e.def.id === 'hq' ? 30 : 20;
        sprites.icon(ix, y, iz, shape, e.def.symbol, this.teamColors[e.owner], size * (sel ? 1.2 : 1), iconAlpha);
      }
    }
    rings.end();
    sprites.end();
  }

  dispose() {
    this.disposed = true;
    this.input.dispose();
    this.hud.dispose();
    this.layers.dispose();
    this.entities.dispose();
    this.view.stage.scene.remove(this.root, this.layers.group);
    this.session.dispose();
    this.ctl.setMode({ kind: 'normal' });
  }
}
