import * as THREE from 'three';
import { BUILDINGS, ECONOMY, type BuildingKind } from '../game/config';
import { CELL } from '../geo/geography';
import type { Building, Entity, Unit } from '../game/entities';
import { applyGhost, createBuildingModel } from '../game/models';
import type { World } from '../game/World';
import type { Stage } from '../render/Stage';
import type { AudioEngine } from '../audio/audio';

export type Mode = 'normal' | 'place' | 'attackMove' | 'missile' | 'rally';

const GHOST_OK = new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.45, depthWrite: false });
const GHOST_BAD = new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.45, depthWrite: false });

/** Translates player intent (select / command / place) into world actions. */
export class Controller {
  selection: Entity[] = [];
  mode: Mode = 'normal';
  placeKind: BuildingKind | null = null;
  placeCell: { cx: number; cz: number } | null = null;
  placeValid = false;
  missileSilo: Building | null = null;
  private ghost: THREE.Group | null = null;
  private ghostKind: BuildingKind | null = null;
  private radiusRing: THREE.Mesh;
  private targetRing: THREE.Mesh;
  private groups = new Map<number, Entity[]>();
  private lastClick = { time: 0, id: -1 };
  private lastGroupKey = { time: 0, n: -1 };
  onChange: () => void = () => {};
  haptics = true;

  constructor(private world: World, private stage: Stage, private audio: AudioEngine) {
    const ringGeo = new THREE.RingGeometry(0.97, 1, 64);
    ringGeo.rotateX(-Math.PI / 2);
    this.radiusRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xf5c542, transparent: true, opacity: 0.35, depthWrite: false }));
    this.radiusRing.visible = false;
    this.radiusRing.renderOrder = 4;
    const tgtGeo = new THREE.RingGeometry(0.9, 1, 48);
    tgtGeo.rotateX(-Math.PI / 2);
    this.targetRing = new THREE.Mesh(tgtGeo, new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.8, depthWrite: false, depthTest: false }));
    this.targetRing.scale.setScalar(ECONOMY.missileRadius);
    this.targetRing.visible = false;
    this.targetRing.renderOrder = 9;
    world.root.add(this.radiusRing, this.targetRing);
  }

  get team() {
    return this.world.playerTeam;
  }

  get selectedUnits(): Unit[] {
    return this.selection.filter((e): e is Unit => e.isUnit && e.alive && e.team === this.team);
  }

  get selectedBuildings(): Building[] {
    return this.selection.filter((e): e is Building => !e.isUnit && e.alive && e.team === this.team);
  }

  vibrate(ms: number) {
    if (this.haptics) navigator.vibrate?.(ms);
  }

  // ---------------------------------------------------------------------------
  // Selection

  setSelection(list: Entity[]) {
    for (const e of this.selection) e.selected = false;
    this.selection = list.filter((e) => e.alive);
    for (const e of this.selection) e.selected = true;
    this.onChange();
  }

  /** Remove dead entities; call each frame. */
  prune() {
    if (this.selection.some((e) => !e.alive)) this.setSelection(this.selection.filter((e) => e.alive));
    if (this.missileSilo && !this.missileSilo.alive) this.cancelMode();
  }

  pick(clientX: number, clientY: number, touch: boolean): Entity | null {
    const w = this.world;
    const cam = this.stage.camera;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const center = new THREE.Vector3();
    const edge = new THREE.Vector3();
    let best: Entity | null = null;
    let bestD = Infinity;
    const minR = touch ? 26 : 14;
    const consider = (e: Entity, height: number, radius: number) => {
      if (!e.alive || !e.seen) return;
      center.set(e.x, height, e.z);
      const sp = this.stage.project(center);
      if (!sp) return;
      edge.copy(center).addScaledVector(right, radius);
      const ep = this.stage.project(edge);
      const pr = ep ? Math.hypot(ep.x - sp.x, ep.y - sp.y) : 0;
      const d = Math.hypot(sp.x - clientX, sp.y - clientY);
      const lim = Math.max(minR, pr);
      if (d < lim && d / lim < bestD) {
        bestD = d / lim;
        best = e;
      }
    };
    for (const u of w.units) consider(u, (u.isAir ? u.altitude : u.y) + 0.6, u.radius + 0.4);
    if (!best) for (const b of w.buildings) consider(b, b.y + 1.2, b.radius * 1.1);
    return best;
  }

  clickSelect(clientX: number, clientY: number, additive: boolean, touch: boolean) {
    const e = this.pick(clientX, clientY, touch);
    const now = performance.now();
    if (!e) {
      if (!additive) this.setSelection([]);
      return;
    }
    const double = this.lastClick.id === e.id && now - this.lastClick.time < 350;
    this.lastClick = { time: now, id: e.id };
    if (double && e.isUnit && e.team === this.team) {
      // Select all of this kind on screen
      const same = this.world.units.filter((u) => u.alive && u.team === this.team && u.kind === e.kind && this.onScreen(u));
      this.setSelection(same);
    } else if (additive && e.team === this.team) {
      if (this.selection.includes(e)) this.setSelection(this.selection.filter((s) => s !== e));
      else this.setSelection([...this.selection.filter((s) => s.team === this.team), e]);
    } else {
      this.setSelection([e]);
    }
    if (e.team === this.team) {
      this.audio.play('select');
      this.vibrate(8);
    }
  }

  private onScreen(e: Entity) {
    const p = this.stage.project(new THREE.Vector3(e.x, e.y, e.z));
    if (!p) return false;
    const r = this.stage.canvas.getBoundingClientRect();
    return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
  }

  boxSelect(x0: number, y0: number, x1: number, y1: number, additive: boolean) {
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    const v = new THREE.Vector3();
    const inBox = (e: Entity, y: number) => {
      const p = this.stage.project(v.set(e.x, y, e.z));
      return !!p && p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
    };
    let picked: Entity[] = this.world.units.filter((u) => u.alive && u.team === this.team && inBox(u, u.isAir ? u.altitude : u.y));
    if (!picked.length) picked = this.world.buildings.filter((b) => b.alive && b.team === this.team && inBox(b, b.y + 1));
    if (additive) picked = [...new Set([...this.selection.filter((s) => s.team === this.team), ...picked])];
    this.setSelection(picked);
    if (picked.length) {
      this.audio.play('select');
      this.vibrate(10);
    }
  }

  selectAllArmy() {
    const army = this.world.units.filter((u) => u.alive && u.team === this.team);
    this.setSelection(army);
    if (army.length) this.audio.play('select');
  }

  // ---------------------------------------------------------------------------
  // Commands

  /** Context command at screen point (right-click / tap with selection). */
  command(clientX: number, clientY: number, touch: boolean, forceAttackMove = false) {
    const units = this.selectedUnits;
    const target = this.pick(clientX, clientY, touch);
    const ground = this.stage.pickGround(clientX, clientY);
    const prodBuildings = this.selectedBuildings.filter((b) => b.def.produces);
    if (!units.length) {
      if (prodBuildings.length && ground) {
        for (const b of prodBuildings) this.world.setRally(b, ground.x, ground.z);
        this.world.decals.marker(ground.x, ground.y, ground.z, 0xf5c542);
        this.audio.play('ack');
      }
      return;
    }
    if (target && this.world.isEnemy(this.team, target.team)) {
      this.world.commandAttack(units, target);
      this.world.decals.marker(target.x, target.y, target.z, 0xff4040);
    } else if (ground) {
      this.world.commandMove(units, ground.x, ground.z, forceAttackMove);
      this.world.decals.marker(ground.x, ground.y, ground.z, forceAttackMove ? 0xff8a3d : 0x5dff8a);
    } else return;
    this.audio.play('ack');
    this.vibrate(12);
  }

  stop() {
    this.world.commandStop(this.selectedUnits);
    this.audio.play('ack');
  }

  /** Primary action at a screen point depending on mode (click / tap). */
  primary(clientX: number, clientY: number, additive: boolean, touch: boolean) {
    switch (this.mode) {
      case 'place':
        this.updatePlacement(clientX, clientY);
        if (!touch) this.confirmPlacement();
        return;
      case 'attackMove':
        this.command(clientX, clientY, touch, true);
        this.mode = 'normal';
        this.onChange();
        return;
      case 'missile':
        this.fireMissile(clientX, clientY);
        return;
      case 'rally': {
        const g = this.stage.pickGround(clientX, clientY);
        if (g) {
          for (const b of this.selectedBuildings) this.world.setRally(b, g.x, g.z);
          this.world.decals.marker(g.x, g.y, g.z, 0xf5c542);
          this.audio.play('ack');
        }
        this.mode = 'normal';
        this.onChange();
        return;
      }
    }
    if (touch && this.selectedUnits.length) {
      // On touch, tapping an own unit selects; anything else is a command.
      const e = this.pick(clientX, clientY, true);
      if (e && e.team === this.team) this.clickSelect(clientX, clientY, false, true);
      else this.command(clientX, clientY, true);
      return;
    }
    this.clickSelect(clientX, clientY, additive, touch);
  }

  // ---------------------------------------------------------------------------
  // Modes

  cancelMode() {
    this.mode = 'normal';
    this.placeKind = null;
    this.placeCell = null;
    this.missileSilo = null;
    if (this.ghost) this.world.root.remove(this.ghost);
    this.ghost = null;
    this.ghostKind = null;
    this.radiusRing.visible = false;
    this.targetRing.visible = false;
    this.onChange();
  }

  startPlacement(kind: BuildingKind) {
    this.cancelMode();
    this.mode = 'place';
    this.placeKind = kind;
    const rig = createBuildingModel(kind, this.world.teams[this.team].theme.color);
    applyGhost(rig.root, GHOST_OK);
    this.ghost = rig.root;
    this.ghostKind = kind;
    this.ghost.visible = false;
    this.world.root.add(this.ghost);
    // Show build radius around HQ for orientation
    const hq = this.world.teamBuildings(this.team, 'hq')[0];
    if (hq && kind !== 'derrick') {
      this.radiusRing.position.set(hq.x, hq.y + 0.3, hq.z);
      this.radiusRing.scale.setScalar(ECONOMY.buildRadius);
      this.radiusRing.visible = true;
    }
    // Start the ghost at the nearest valid spot to the view center (touch-first placement).
    const r = this.stage.canvas.getBoundingClientRect();
    this.updatePlacement(r.left + r.width / 2, r.top + r.height / 2);
    if (!this.placeValid) this.autoPlace();
    this.onChange();
  }

  /** Move the ghost to the closest valid location around the camera focus. */
  autoPlace() {
    if (!this.placeKind || !this.ghost) return;
    const kind = this.placeKind;
    const def = BUILDINGS[kind];
    const w = this.world;
    const focus = this.stage.rig.target;
    let cell: { cx: number; cz: number } | null = null;
    if (def.onOil) {
      const fields = w.oilFields
        .filter((f) => !f.derrick && w.fog.isExplored(f.x, f.z))
        .sort((a, b) => Math.hypot(a.x - focus.x, a.z - focus.z) - Math.hypot(b.x - focus.x, b.z - focus.z));
      if (fields[0]) cell = { cx: fields[0].cx, cz: fields[0].cz };
    } else {
      const ok = (cx: number, cz: number) => w.placementError(this.team, kind, cx, cz) === null && w.areaFree(cx, cz, def.size, false, 1);
      cell = w.findFootprint(Math.floor(focus.x / CELL), Math.floor(focus.z / CELL), def.size, ok, 16);
      if (!cell) {
        const hq = w.teamBuildings(this.team, 'hq')[0];
        if (hq) cell = w.findFootprint(Math.floor(hq.x / CELL), Math.floor(hq.z / CELL), def.size, ok, 16);
      }
    }
    if (!cell) return;
    this.setPlacementCell(cell.cx, cell.cz);
  }

  private setPlacementCell(cx: number, cz: number) {
    if (!this.placeKind || !this.ghost) return;
    const def = BUILDINGS[this.placeKind];
    this.placeCell = { cx, cz };
    this.placeValid = !this.world.placementError(this.team, this.placeKind, cx, cz);
    const x = (cx + def.size / 2) * CELL;
    const z = (cz + def.size / 2) * CELL;
    this.ghost.visible = true;
    this.ghost.position.set(x, this.world.ground(x, z), z);
    applyGhost(this.ghost, this.placeValid ? GHOST_OK : GHOST_BAD);
    this.onChange();
  }

  updatePlacement(clientX: number, clientY: number) {
    if (this.mode !== 'place' || !this.placeKind || !this.ghost) return;
    const g = this.stage.pickGround(clientX, clientY);
    if (!g) return;
    const def = BUILDINGS[this.placeKind];
    let cx: number;
    let cz: number;
    if (def.onOil) {
      const f = this.world.findOilFieldNear(g.x, g.z, 14);
      if (f) {
        cx = f.cx;
        cz = f.cz;
      } else {
        cx = Math.round(g.x / CELL - def.size / 2);
        cz = Math.round(g.z / CELL - def.size / 2);
      }
    } else {
      cx = Math.round(g.x / CELL - def.size / 2);
      cz = Math.round(g.z / CELL - def.size / 2);
    }
    this.setPlacementCell(cx, cz);
  }

  confirmPlacement() {
    if (this.mode !== 'place' || !this.placeKind || !this.placeCell) return;
    const ok = this.world.placeBuilding(this.team, this.placeKind, this.placeCell.cx, this.placeCell.cz);
    if (ok) {
      this.vibrate(20);
      this.cancelMode();
    }
  }

  startMissile(silo: Building) {
    if (!this.world.siloReady(silo)) return;
    this.cancelMode();
    this.mode = 'missile';
    this.missileSilo = silo;
    this.onChange();
  }

  hoverMissile(clientX: number, clientY: number) {
    if (this.mode !== 'missile') return;
    const g = this.stage.pickGround(clientX, clientY);
    if (!g) return;
    this.targetRing.visible = true;
    this.targetRing.position.set(g.x, g.y + 0.4, g.z);
  }

  private fireMissile(clientX: number, clientY: number) {
    const g = this.stage.pickGround(clientX, clientY);
    if (!g || !this.missileSilo) return;
    this.world.launchMissile(this.missileSilo, g.x, g.z);
    this.vibrate(60);
    this.cancelMode();
  }

  startAttackMove() {
    if (!this.selectedUnits.length) return;
    this.cancelMode();
    this.mode = 'attackMove';
    this.onChange();
  }

  startRally() {
    this.cancelMode();
    this.mode = 'rally';
    this.onChange();
  }

  // ---------------------------------------------------------------------------
  // Control groups

  setGroup(n: number) {
    const own = this.selection.filter((e) => e.team === this.team);
    if (!own.length) return;
    this.groups.set(n, own);
    this.audio.play('ack');
  }

  recallGroup(n: number) {
    const g = (this.groups.get(n) ?? []).filter((e) => e.alive);
    if (!g.length) return;
    const now = performance.now();
    if (this.lastGroupKey.n === n && now - this.lastGroupKey.time < 400) {
      const cx = g.reduce((s, e) => s + e.x, 0) / g.length;
      const cz = g.reduce((s, e) => s + e.z, 0) / g.length;
      this.stage.rig.focus(cx, cz);
    }
    this.lastGroupKey = { n, time: now };
    this.setSelection(g);
    this.audio.play('select');
  }

  update(time: number) {
    if (this.targetRing.visible) {
      const s = ECONOMY.missileRadius * (1 + Math.sin(time * 6) * 0.05);
      this.targetRing.scale.setScalar(s);
    }
    if (this.ghost && this.ghostKind) this.ghost.position.y += Math.sin(time * 4) * 0.002;
  }
}
