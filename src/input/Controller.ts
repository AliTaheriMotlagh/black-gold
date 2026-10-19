/**
 * Selection and command logic, independent of the input device. Input.ts (mouse,
 * keyboard, touch) and the HUD call into this.
 */
import * as THREE from 'three';
import type { Session } from '../net/Session';
import type { World3D } from '../render/World3D';
import type { EntityRenderer } from '../render/EntityRenderer';
import type { Markers } from '../render/Overlays';
import type { Entity, Unit } from '../sim/entities';
import type { StrikeKind } from '../sim/defs';
import { BUILDINGS, POWERS, STRIKES } from '../sim/defs';
import type { AlertKey } from '../sim/world';
import { audio } from '../audio/audio';
import { modelMaterial } from '../render/models/kit';
import { VEX } from '../render/Stage';

export type Mode =
  | { kind: 'normal' }
  | { kind: 'attackMove' }
  | { kind: 'move' }
  | { kind: 'place'; building: string }
  | { kind: 'strike'; launcher: number; strike: StrikeKind }
  | { kind: 'power'; id: string }
  | { kind: 'rally' }
  | { kind: 'kamikaze' };

export class Controller {
  readonly selection = new Set<number>();
  mode: Mode = { kind: 'normal' };
  groups = new Map<number, number[]>();
  haptics = true;
  private ghost: THREE.Group | null = null;
  private ghostKind = '';
  private ghostRange: THREE.Mesh | null = null;
  ghostPos: { x: number; z: number } | null = null;
  ghostValid = false;
  hover: Entity | null = null;
  lastAlert: { x: number; z: number } | null = null;
  onChange: () => void = () => {};
  onAlert: (key: AlertKey) => void = () => {};
  private lastClick = { t: 0, id: 0 };

  constructor(
    readonly session: Session,
    readonly view: World3D,
    readonly entities: EntityRenderer,
    readonly markers: Markers,
  ) {}

  get world() {
    return this.session.world;
  }
  get local() {
    return this.session.local;
  }

  selected(): Entity[] {
    const out: Entity[] = [];
    for (const id of this.selection) {
      const e = this.world.get(id);
      if (e) out.push(e);
    }
    return out;
  }

  selectedUnits(): Unit[] {
    return this.selected().filter((e): e is Unit => e.isUnit && e.owner === this.local);
  }

  /** Remove dead/invisible entities from the selection. */
  prune() {
    let changed = false;
    for (const id of [...this.selection]) {
      const e = this.world.get(id);
      if (!e || (e.owner !== this.local && !this.entities.sees(e))) {
        this.selection.delete(id);
        changed = true;
      }
    }
    if (changed) this.onChange();
  }

  // ---------------------------------------------------------------------------
  // Picking

  private toScreen(x: number, y: number, z: number, w: number, h: number) {
    const v = new THREE.Vector3(x, y, z).project(this.view.stage.camera);
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, z: v.z };
  }

  /** Entity under a screen point (screen-space, generous for small units and icons). */
  pick(sx: number, sy: number): Entity | null {
    const { w, h } = this.viewport();
    let best: Entity | null = null;
    let bd = Infinity;
    const cam = this.view.stage.camera;
    const scale = this.entities.unitScale;
    for (const e of this.entities.visible) {
      const y = this.view.terrain.surfaceAt(e.x, e.z) + (e.isUnit && e.isAir ? Math.max(0.05, e.y * 0.3) : 0.03);
      const p = this.toScreen(e.x, y, e.z, w, h);
      if (p.z > 1) continue;
      const r = e.isUnit ? e.radius * scale : e.half;
      const edge = this.toScreen(e.x + r, y, e.z, w, h);
      const pr = Math.max(e.isUnit ? 16 : 12, Math.hypot(edge.x - p.x, edge.y - p.y) * (e.isUnit ? 1.4 : 1.1));
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < pr && d - (e.owner === this.local ? 2 : 0) < bd) {
        bd = d;
        best = e;
      }
    }
    void cam;
    return best;
  }

  pickCity(sx: number, sy: number): number {
    const { w, h } = this.viewport();
    let best = -1;
    let bd = 40;
    this.world.cities.forEach((c, i) => {
      const p = this.toScreen(c.x, this.view.terrain.surfaceAt(c.x, c.z), c.z, w, h);
      if (p.z > 1) return;
      const edge = this.toScreen(c.x + c.radius * 0.6, this.view.terrain.surfaceAt(c.x, c.z), c.z, w, h);
      const r = Math.max(20, Math.hypot(edge.x - p.x, edge.y - p.y));
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < r && d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  ground(sx: number, sy: number): THREE.Vector3 | null {
    const { w, h } = this.viewport();
    return this.view.pickGround((sx / w) * 2 - 1, -(sy / h) * 2 + 1);
  }

  viewport() {
    const c = this.view.stage.canvas;
    return { w: c.clientWidth || window.innerWidth, h: c.clientHeight || window.innerHeight };
  }

  // ---------------------------------------------------------------------------
  // Selection

  clickSelect(sx: number, sy: number, add: boolean, time: number) {
    const e = this.pick(sx, sy);
    if (!e) {
      if (!add) this.clear();
      return;
    }
    // Double-click: everything of this type on screen.
    if (time - this.lastClick.t < 0.35 && this.lastClick.id === e.id && e.owner === this.local) {
      this.selectTypeOnScreen(e.def.id, e.isUnit, add);
      this.lastClick = { t: 0, id: 0 };
      return;
    }
    this.lastClick = { t: time, id: e.id };
    if (!add) this.selection.clear();
    if (e.owner !== this.local) {
      this.selection.clear();
      this.selection.add(e.id);
    } else if (add && this.selection.has(e.id)) this.selection.delete(e.id);
    else {
      // Buildings select alone; units can mix.
      if (!e.isUnit) this.selection.clear();
      else for (const id of [...this.selection]) if (!this.world.get(id)?.isUnit) this.selection.delete(id);
      this.selection.add(e.id);
    }
    this.selectFeedback();
  }

  boxSelect(x0: number, y0: number, x1: number, y1: number, add: boolean) {
    const { w, h } = this.viewport();
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    const hits: Unit[] = [];
    for (const e of this.entities.visible) {
      if (!e.isUnit || e.owner !== this.local) continue;
      const p = this.toScreen(e.x, this.view.terrain.surfaceAt(e.x, e.z), e.z, w, h);
      if (p.z <= 1 && p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) hits.push(e);
    }
    if (!add) this.selection.clear();
    // Prefer combat units over builders when both are boxed.
    const combat = hits.filter((u) => !u.def.builder);
    for (const u of combat.length ? combat : hits) this.selection.add(u.id);
    if (hits.length) this.selectFeedback();
    else this.onChange();
  }

  selectTypeOnScreen(kind: string, unit: boolean, add: boolean) {
    const { w, h } = this.viewport();
    if (!add) this.selection.clear();
    for (const e of this.entities.visible) {
      if (e.owner !== this.local || e.def.id !== kind || e.isUnit !== unit) continue;
      const p = this.toScreen(e.x, 0, e.z, w, h);
      if (p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h) this.selection.add(e.id);
    }
    this.selectFeedback();
  }

  selectAll(filter: (u: Unit) => boolean) {
    this.selection.clear();
    for (const u of this.world.units) if (u.alive && u.owner === this.local && filter(u)) this.selection.add(u.id);
    this.selectFeedback();
  }

  selectIds(ids: number[]) {
    this.selection.clear();
    for (const id of ids) if (this.world.get(id)) this.selection.add(id);
    this.selectFeedback();
  }

  clear() {
    if (!this.selection.size) return;
    this.selection.clear();
    this.onChange();
  }

  private selectFeedback() {
    if (this.selection.size) audio.play('select', { volume: 0.6 });
    this.vibrate(8);
    this.onChange();
  }

  setGroup(n: number) {
    this.groups.set(n, [...this.selection]);
  }

  recallGroup(n: number, focus: boolean) {
    const ids = (this.groups.get(n) ?? []).filter((id) => this.world.get(id));
    if (!ids.length) return;
    this.selectIds(ids);
    if (focus) this.focusSelection();
  }

  focusSelection() {
    const sel = this.selected();
    if (!sel.length) return;
    let x = 0;
    let z = 0;
    for (const e of sel) {
      x += e.x;
      z += e.z;
    }
    this.view.rig.focus(x / sel.length, z / sel.length);
  }

  // ---------------------------------------------------------------------------
  // Commands

  /** Context command at a screen point (right-click / tap with a selection). */
  command(sx: number, sy: number, queue = false) {
    const mode = this.mode;
    const p = this.ground(sx, sy);
    if (mode.kind === 'place') {
      if (p) this.updateGhost(p.x, p.z);
      return this.confirmPlacement();
    }
    if (!p) return;
    const units = this.selectedUnits();
    const target = this.pick(sx, sy);
    switch (mode.kind) {
      case 'strike': {
        this.session.issue({ k: 'strike', id: mode.launcher, kind: mode.strike, x: p.x, z: p.z });
        this.marker(p.x, p.z, 0xff3a2a, 1.2);
        audio.play('ack');
        this.setMode({ kind: 'normal' });
        return;
      }
      case 'power': {
        const pw = POWERS.find((x) => x.id === mode.id);
        this.session.issue({ k: 'power', id: mode.id, x: p.x, z: p.z, target: target ? target.owner : this.world.ownerAt(p.x, p.z) });
        this.marker(p.x, p.z, 0xffc040, Math.max(0.5, pw?.radius ?? 1));
        this.setMode({ kind: 'normal' });
        return;
      }
      case 'rally': {
        const b = this.selected().find((e) => !e.isUnit);
        if (b) this.session.issue({ k: 'rally', id: b.id, x: p.x, z: p.z });
        this.marker(p.x, p.z, 0x5dd6ff, 0.3);
        this.setMode({ kind: 'normal' });
        return;
      }
      case 'kamikaze': {
        const ids = units.filter((u) => u.def.kamikaze).map((u) => u.id);
        if (target && this.world.isEnemy(this.local, target.owner)) this.session.issue({ k: 'attack', ids, target: target.id });
        else this.session.issue({ k: 'kamikaze', ids, x: p.x, z: p.z });
        this.marker(p.x, p.z, 0xff5a3a, 0.4);
        audio.play('ack');
        this.setMode({ kind: 'normal' });
        return;
      }
    }
    // Buildings: right-click sets the rally point.
    if (!units.length) {
      const b = this.selected().find((e) => !e.isUnit && e.owner === this.local);
      if (b && !b.isUnit && b.def.produces) {
        this.session.issue({ k: 'rally', id: b.id, x: p.x, z: p.z });
        this.marker(p.x, p.z, 0x5dd6ff, 0.3);
      }
      return;
    }
    const ids = units.map((u) => u.id);
    if (target && target.owner !== this.local) {
      if (this.world.isEnemy(this.local, target.owner)) {
        this.session.issue({ k: 'attack', ids, target: target.id });
        this.marker(target.x, target.z, 0xff3a2a, Math.max(0.15, target.isUnit ? target.radius * 2 : target.half * 1.5));
        audio.play('ack');
        this.vibrate(15);
        return;
      }
    }
    if (target && target.owner === this.local && !target.isUnit) {
      if (!target.built && units.some((u) => u.def.builder)) {
        this.session.issue({ k: 'assist', ids: units.filter((u) => u.def.builder).map((u) => u.id), target: target.id });
        this.marker(target.x, target.z, 0xf5c542, target.half * 1.4);
        audio.play('ack');
        return;
      }
      if (target.hp < target.maxHp && units.some((u) => u.def.repair)) {
        this.session.issue({ k: 'repair', ids: units.filter((u) => u.def.repair).map((u) => u.id), target: target.id });
        this.marker(target.x, target.z, 0x5dff8a, target.half * 1.4);
        audio.play('ack');
        return;
      }
      if (target.def.rearm && units.some((u) => u.isAir)) {
        this.session.issue({ k: 'rtb', ids: units.filter((u) => u.isAir).map((u) => u.id) });
        audio.play('ack');
        return;
      }
    }
    const city = this.pickCity(sx, sy);
    const atk = mode.kind === 'attackMove' || (city >= 0 && this.world.isEnemy(this.local, this.world.cities[city].owner));
    this.session.issue({ k: 'move', ids, x: p.x, z: p.z, atk, q: queue });
    this.marker(p.x, p.z, atk ? 0xff7a3a : 0x5dff8a, 0.25 + Math.min(1.5, Math.sqrt(ids.length) * 0.08) * this.entities.unitScale);
    audio.play('ack');
    this.vibrate(10);
    if (mode.kind === 'attackMove' || mode.kind === 'move') this.setMode({ kind: 'normal' });
  }

  stop() {
    const ids = this.selectedUnits().map((u) => u.id);
    if (ids.length) this.session.issue({ k: 'stop', ids });
  }
  hold() {
    const ids = this.selectedUnits().map((u) => u.id);
    if (ids.length) this.session.issue({ k: 'hold', ids });
  }
  deploy() {
    const ids = this.selectedUnits().filter((u) => u.def.deploy).map((u) => u.id);
    if (ids.length) this.session.issue({ k: 'deploy', ids });
  }
  rtb() {
    const ids = this.selectedUnits().filter((u) => u.isAir).map((u) => u.id);
    if (ids.length) this.session.issue({ k: 'rtb', ids });
  }

  // ---------------------------------------------------------------------------
  // Modes

  setMode(m: Mode) {
    this.mode = m;
    if (m.kind !== 'place') this.removeGhost();
    else this.ghostPos = null;
    this.onChange();
  }

  beginPlacement(kind: string) {
    this.setMode({ kind: 'place', building: kind });
    // Start at the screen centre so touch players see the ghost right away.
    const { w, h } = this.viewport();
    const p = this.ground(w / 2, h / 2);
    if (p) this.updateGhost(p.x, p.z);
  }

  beginStrike(launcher: Entity, kind: StrikeKind) {
    this.setMode({ kind: 'strike', launcher: launcher.id, strike: kind });
    this.showRange(launcher.x, launcher.z, STRIKES[kind].range);
  }

  updateGhost(x: number, z: number) {
    if (this.mode.kind !== 'place') return;
    const kind = this.mode.building;
    const def = BUILDINGS[kind];
    if (def.onOil) {
      const f = this.world.oilFieldAt(x, z, 3);
      if (f) {
        x = f.x;
        z = f.z;
      }
    }
    if (!this.ghost || this.ghostKind !== kind) {
      this.removeGhost();
      this.ghost = this.buildGhost(kind);
      this.ghostKind = kind;
      this.view.stage.scene.add(this.ghost);
    }
    this.ghostPos = { x, z };
    const err = this.world.placementError(this.local, kind, x, z);
    this.ghostValid = !err || err === 'noFunds';
    this.ghost.position.set(x, this.view.terrain.heightAt(x, z) + 0.002, z);
    const ok = this.ghostValid;
    this.ghost.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && 'emissive' in m) {
        m.emissive.setHex(ok ? 0x1f8f4a : 0x9a1f1f);
        m.opacity = 0.55;
      }
    });
    if (this.ghost.userData.footprint) ((this.ghost.userData.footprint as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(ok ? 0x4dff8a : 0xff4040);
  }

  confirmPlacement() {
    if (this.mode.kind !== 'place' || !this.ghostPos) return;
    const kind = this.mode.building;
    const err = this.world.placementError(this.local, kind, this.ghostPos.x, this.ghostPos.z);
    if (err) {
      this.onAlert(err);
      audio.play('error');
      this.vibrate(30);
      return;
    }
    const builders = this.selectedUnits().filter((u) => u.def.builder).map((u) => u.id);
    this.session.issue({ k: 'build', kind, x: this.ghostPos.x, z: this.ghostPos.z, ids: builders.length ? builders : undefined });
    audio.play('place');
    this.vibrate(20);
    this.setMode({ kind: 'normal' });
  }

  private buildGhost(kind: string): THREE.Group {
    const g = new THREE.Group();
    const model = this.entities.buildingModel(kind);
    const mat = modelMaterial();
    mat.transparent = true;
    mat.opacity = 0.55;
    mat.depthWrite = false;
    for (const p of model.parts) {
      const m = new THREE.Mesh(p.geo, mat);
      m.position.copy(p.pivot);
      g.add(m);
    }
    const s = BUILDINGS[kind].size;
    const fp = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshBasicMaterial({ color: 0x4dff8a, transparent: true, opacity: 0.28, depthWrite: false }));
    fp.rotation.x = -Math.PI / 2;
    fp.position.y = 0.004;
    g.add(fp);
    g.userData.footprint = fp;
    g.renderOrder = 30;
    return g;
  }

  private removeGhost() {
    if (this.ghost) {
      this.view.stage.scene.remove(this.ghost);
      this.ghost = null;
      this.ghostKind = '';
    }
    if (this.ghostRange) {
      this.view.stage.scene.remove(this.ghostRange);
      this.ghostRange = null;
    }
  }

  private showRange(x: number, z: number, r: number) {
    const g = new THREE.RingGeometry(r * 0.995, r, 128);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xff5040, transparent: true, opacity: 0.7, depthTest: false }));
    m.position.set(x, 3000 * VEX * 0.001 + 0.05, z);
    m.renderOrder = 40;
    this.ghostRange = m;
    this.view.stage.scene.add(m);
  }

  marker(x: number, z: number, color: number, r: number) {
    this.markers.add(x, this.view.terrain.surfaceAt(x, z), z, color, r);
  }

  vibrate(ms: number) {
    if (this.haptics && 'vibrate' in navigator) navigator.vibrate?.(ms);
  }
}
