/**
 * The 3D theater behind the menus: slow flyover on the main menu, interactive political
 * map on the setup screen (hover + click a country, drag to pan, wheel/pinch to zoom).
 */
import * as THREE from 'three';
import type { World3D } from '../../render/World3D';
import type { Theater } from '../../geo/theater';
import { lonLatToWorld } from '../../geo/projection';
import { loc } from '../../i18n';

export class MenuMap {
  private enabled = false;
  private interactive = false;
  private tip: HTMLDivElement;
  private drag: { x: number; y: number; moved: boolean; anchor: THREE.Vector3 | null } | null = null;
  private pinch: { d: number } | null = null;
  private ptrs = new Map<number, { x: number; y: number }>();
  onPick: (countryIdx: number) => void = () => {};
  private selected = 0;
  private rivals: number[] = [];

  constructor(
    readonly view: World3D,
    readonly theater: Theater,
  ) {
    this.tip = document.createElement('div');
    this.tip.className = 'map-tip';
    Object.assign(this.tip.style, { position: 'fixed', zIndex: '7', pointerEvents: 'none', padding: '4px 9px', borderRadius: '6px', background: 'rgba(9,13,19,0.85)', border: '1px solid rgba(150,185,220,0.25)', font: '700 13px var(--font)', display: 'none', letterSpacing: '0.04em' });
    document.body.append(this.tip);
    const c = view.stage.canvas;
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerup', (e) => this.up(e));
    c.addEventListener('pointercancel', (e) => this.ptrs.delete(e.pointerId));
    c.addEventListener('pointerleave', () => (this.tip.style.display = 'none'));
    c.addEventListener('wheel', (e) => {
      if (!this.enabled || !this.interactive) return;
      e.preventDefault();
      this.view.rig.zoom(Math.exp(e.deltaY * 0.0012));
    }, { passive: false });
  }

  enable(on: boolean) {
    this.enabled = on;
    if (!on) {
      this.interactive = false;
      this.tip.style.display = 'none';
      this.view.politicalBoost = 0;
    } else this.resetOverlays();
  }

  /** Clear in-game fog and paint the static political map. */
  resetOverlays() {
    const fog = this.view.terrain.fogTex.image.data as Uint8Array;
    fog.fill(255);
    this.view.terrain.fogTex.needsUpdate = true;
    this.paint();
  }

  flyover() {
    this.interactive = false;
    const p = lonLatToWorld(47, 28);
    this.view.rig.orbit = true;
    this.view.rig.focus(p.x, p.z, 2400);
    this.view.rig.goal.tilt = -0.25;
    this.view.politicalBoost = 0.4;
  }

  setInteractive(on: boolean) {
    this.interactive = on;
    this.view.rig.orbit = !on;
    this.view.rig.goal.tilt = on ? 0 : -0.25;
    this.view.politicalBoost = on ? 1 : 0.4;
  }

  highlight(selected: number, rivals: number[]) {
    this.selected = selected;
    this.rivals = rivals;
    this.paint();
  }

  focusCountry(idx: number) {
    const m = this.theater.meta.countries.find((c) => c.idx === idx);
    if (!m || m.capital === undefined) return;
    // Frame the whole country, nudged right so it sits between the setup panels.
    const th = this.theater;
    let sx = 0;
    let sz = 0;
    let n = 0;
    let x0 = Infinity;
    let x1 = -Infinity;
    for (let i = 0; i < th.country.length; i += 5) {
      if (th.country[i] !== idx) continue;
      const x = (i % th.w) * th.cell;
      sx += x;
      sz += Math.floor(i / th.w) * th.cell;
      n++;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
    }
    if (!n) return;
    const span = Math.max(600, (x1 - x0) * 1.9);
    this.view.rig.focus(sx / n, sz / n, span);
  }

  private paint() {
    const th = this.theater;
    const data = this.view.terrain.territoryTex.image.data as Uint8Array;
    const cols = th.meta.countries.map((c) => new THREE.Color(c.color));
    const gold = new THREE.Color(0xf5c542);
    for (let i = 0; i < th.w * th.h; i++) {
      const o = i * 4;
      const c = th.country[i];
      if (!c || th.water[i]) {
        data[o + 3] = 0;
        continue;
      }
      let col = cols[c - 1];
      let dim = this.selected ? 0.55 : 1;
      if (c === this.selected) {
        col = gold;
        dim = 1.15;
      } else if (this.rivals.includes(c)) dim = 1.05;
      data[o] = Math.min(255, col.r * 255 * dim);
      data[o + 1] = Math.min(255, col.g * 255 * dim);
      data[o + 2] = Math.min(255, col.b * 255 * dim);
      data[o + 3] = 255;
    }
    this.view.terrain.territoryTex.needsUpdate = true;
  }

  private countryAt(e: PointerEvent): number {
    const r = this.view.stage.canvas.getBoundingClientRect();
    const g = this.view.pickGround(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    if (!g) return 0;
    return this.theater.countryAt(g.x, g.z);
  }

  private down(e: PointerEvent) {
    if (!this.enabled || !this.interactive) return;
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.ptrs.size === 2) {
      const [a, b] = [...this.ptrs.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
      this.drag = null;
      return;
    }
    const r = this.view.stage.canvas.getBoundingClientRect();
    const anchor = this.view.pickGround(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.drag = { x: e.clientX, y: e.clientY, moved: false, anchor };
  }

  private move(e: PointerEvent) {
    if (!this.enabled || !this.interactive) return;
    if (this.ptrs.has(e.pointerId)) this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch && this.ptrs.size === 2) {
      const [a, b] = [...this.ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 10) this.view.rig.zoom(this.pinch.d / d);
      this.pinch.d = d;
      return;
    }
    if (this.drag) {
      if (Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) > 8) this.drag.moved = true;
      if (this.drag.moved && this.drag.anchor) {
        const r = this.view.stage.canvas.getBoundingClientRect();
        const p = this.view.pickGround(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        if (p) this.view.rig.panWorld(this.drag.anchor.x - p.x, this.drag.anchor.z - p.z);
      }
      return;
    }
    if (e.pointerType === 'mouse') {
      const idx = this.countryAt(e);
      const m = this.theater.meta.countries.find((c) => c.idx === idx);
      if (m) {
        this.tip.textContent = loc(m.name) + (m.playable ? '' : ' ·');
        this.tip.style.display = 'block';
        this.tip.style.left = `${e.clientX + 14}px`;
        this.tip.style.top = `${e.clientY + 10}px`;
        this.view.stage.canvas.style.cursor = m.playable ? 'pointer' : 'default';
      } else this.tip.style.display = 'none';
    }
  }

  private up(e: PointerEvent) {
    this.ptrs.delete(e.pointerId);
    if (this.ptrs.size < 2) this.pinch = null;
    if (!this.enabled || !this.interactive || !this.drag) return;
    const moved = this.drag.moved;
    this.drag = null;
    if (moved) return;
    const idx = this.countryAt(e);
    if (idx) this.onPick(idx);
  }

  update(_dt: number) {}
}
