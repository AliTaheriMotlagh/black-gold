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
  private hovered = 0;
  private labelRoot: HTMLDivElement;
  private labels: { idx: number; el: HTMLDivElement; x: number; z: number; size: number; w: number; h: number }[] = [];

  constructor(
    readonly view: World3D,
    readonly theater: Theater,
  ) {
    this.tip = document.createElement('div');
    this.tip.className = 'map-tip';
    Object.assign(this.tip.style, { position: 'fixed', zIndex: '7', pointerEvents: 'none', padding: '4px 9px', borderRadius: '6px', background: 'rgba(9,13,19,0.85)', border: '1px solid rgba(150,185,220,0.25)', font: '700 13px var(--font)', display: 'none', letterSpacing: '0.04em' });
    document.body.append(this.tip);
    this.labelRoot = document.createElement('div');
    this.labelRoot.className = 'menu-labels';
    document.body.append(this.labelRoot);
    this.buildLabels();
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
      this.view.warMap = 0;
      this.view.rig.maxDist = 5200;
      this.labelRoot.style.display = 'none';
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
    const rig = this.view.rig;
    rig.orbit = !on;
    rig.goal.tilt = on ? 0 : -0.25;
    // North-up war-room map while choosing a nation; the flyover keeps the satellite look.
    if (on) rig.goal.yaw = Math.round(rig.yaw / (Math.PI * 2)) * Math.PI * 2;
    rig.maxDist = on ? this.maxDist() : 5200;
    this.view.politicalBoost = on ? 0 : 0.4;
    this.view.warMap = on ? 1 : 0;
    this.labelRoot.style.display = on ? '' : 'none';
    if (!on) this.tip.style.display = 'none';
  }

  highlight(selected: number, rivals: number[]) {
    this.selected = selected;
    this.rivals = rivals;
    this.paint();
  }

  focusCountry(idx: number) {
    const m = this.theater.meta.countries.find((c) => c.idx === idx);
    if (!m || m.capital === undefined) return;
    const th = this.theater;
    let sx = 0;
    let sz = 0;
    let n = 0;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < th.country.length; i += 5) {
      if (th.country[i] !== idx) continue;
      const x = (i % th.w) * th.cell;
      const z = Math.floor(i / th.w) * th.cell;
      sx += x;
      sz += z;
      n++;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
    if (!n) return;
    // Fit the country inside the visible map area (the gap between the setup panels, or the
    // map band on phones), then shift the camera so it lands in that area's centre.
    const cv = this.view.stage.canvas.getBoundingClientRect();
    const area = document.querySelector('.setup .map-col')?.getBoundingClientRect();
    const box = area && area.width > 40 && area.height > 40 ? area : cv;
    const fw = box.width / cv.width;
    const fh = box.height / cv.height;
    const cam = this.view.stage.camera;
    const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const aspect = cv.width / cv.height;
    this.view.rig.maxDist = this.maxDist();
    const dist = Math.min(this.view.rig.maxDist, Math.max(450, ((x1 - x0) * 0.65) / (tanH * aspect * fw), ((z1 - z0) * 0.65) / (tanH * fh)));
    const ox = ((box.left + box.width / 2 - (cv.left + cv.width / 2)) / (cv.width / 2)) * dist * tanH * aspect;
    const oz = ((box.top + box.height / 2 - (cv.top + cv.height / 2)) / (cv.height / 2)) * dist * tanH;
    this.view.rig.focus(sx / n - ox, sz / n - oz, dist);
  }

  /** Zoom-out cap that keeps the theater edge mostly off-screen (portrait screens need more height). */
  private maxDist() {
    const r = this.view.stage.canvas.getBoundingClientRect();
    const tanH = Math.tan(THREE.MathUtils.degToRad(this.view.stage.camera.fov / 2));
    return Math.min(5200, Math.max(2900, 1600 / (tanH * (r.width / r.height))));
  }

  private buildLabels() {
    const th = this.theater;
    const acc = new Map<number, { x: number; z: number; n: number }>();
    for (let i = 0; i < th.country.length; i += 3) {
      const c = th.country[i];
      if (!c || th.water[i]) continue;
      const a = acc.get(c) ?? { x: 0, z: 0, n: 0 };
      a.x += (i % th.w) * th.cell;
      a.z += Math.floor(i / th.w) * th.cell;
      a.n++;
      acc.set(c, a);
    }
    for (const m of th.meta.countries) {
      const a = acc.get(m.idx);
      if (!a || a.n < 40) continue;
      const el = document.createElement('div');
      el.className = `mclbl${m.playable ? '' : ' minor'}`;
      el.style.setProperty('--c', m.color);
      el.textContent = loc(m.name);
      this.labelRoot.append(el);
      // size ≈ the country's linear extent in km, used to cull small nations when zoomed out
      this.labels.push({ idx: m.idx, el, x: a.x / a.n, z: a.z / a.n, size: Math.sqrt(a.n * 3) * th.cell, w: 0, h: 0 });
    }
  }

  /** Re-localize labels after a language switch. */
  relabel() {
    for (const l of this.labels) {
      const m = this.theater.meta.countries.find((c) => c.idx === l.idx);
      if (m) l.el.textContent = loc(m.name);
      l.w = 0;
    }
  }

  private paint() {
    const th = this.theater;
    const data = this.view.terrain.territoryTex.image.data as Uint8Array;
    const cols = th.meta.countries.map((c) => new THREE.Color(c.color));
    const playable: boolean[] = [];
    for (const m of th.meta.countries) playable[m.idx] = !!m.playable;
    for (let i = 0; i < th.w * th.h; i++) {
      const o = i * 4;
      const c = th.country[i];
      if (!c || th.water[i]) {
        data[o] = data[o + 1] = data[o + 2] = 0;
        data[o + 3] = th.water[i] ? 0 : 1;
        continue;
      }
      const col = cols[c - 1];
      // Alpha tags the role for the war-map shader: 250 = your nation, 245 = rival.
      let dim = this.selected ? 0.62 : 1;
      let a = 255;
      if (c === this.selected) {
        dim = 1.3;
        a = 250;
      } else if (this.rivals.includes(c)) {
        dim = 0.95;
        a = 245;
      } else if (!playable[c]) dim *= 0.6;
      data[o] = Math.min(255, col.r * 255 * dim);
      data[o + 1] = Math.min(255, col.g * 255 * dim);
      data[o + 2] = Math.min(255, col.b * 255 * dim);
      data[o + 3] = a;
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
      this.hovered = m?.playable ? idx : 0;
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

  /** Project country labels each frame; bigger nations win collisions, small ones fade out when zoomed out. */
  update(_dt: number) {
    if (!this.enabled || !this.interactive) return;
    const cam = this.view.stage.camera;
    const r = this.view.stage.canvas.getBoundingClientRect();
    const dist = this.view.rig.dist;
    const v = new THREE.Vector3();
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const order = [...this.labels].sort((a, b) => this.rank(b) - this.rank(a));
    for (const l of order) {
      const role = l.idx === this.selected ? 'sel' : this.rivals.includes(l.idx) ? 'rival' : '';
      l.el.classList.toggle('sel', role === 'sel');
      l.el.classList.toggle('rival', role === 'rival');
      l.el.classList.toggle('hover', l.idx === this.hovered && role !== 'sel');
      let show = role !== '' || l.size > dist * 0.07;
      if (show) {
        v.set(l.x, this.view.terrain.surfaceAt(l.x, l.z), l.z).project(cam);
        show = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      }
      if (show) {
        if (!l.w) {
          l.el.style.display = 'block';
          l.w = l.el.offsetWidth;
          l.h = l.el.offsetHeight;
        }
        const x = r.left + ((v.x + 1) / 2) * r.width;
        const y = r.top + ((1 - v.y) / 2) * r.height;
        const b = { x0: x - l.w / 2 - 4, y0: y - l.h / 2 - 2, x1: x + l.w / 2 + 4, y1: y + l.h / 2 + 2 };
        show = !placed.some((p) => b.x0 < p.x1 && b.x1 > p.x0 && b.y0 < p.y1 && b.y1 > p.y0);
        if (show) {
          placed.push(b);
          l.el.style.transform = `translate(${(x - l.w / 2).toFixed(1)}px, ${(y - l.h / 2).toFixed(1)}px)`;
        }
      }
      l.el.style.display = show ? 'block' : 'none';
    }
  }

  private rank(l: { idx: number; size: number }) {
    return (l.idx === this.selected ? 1e6 : 0) + (this.rivals.includes(l.idx) ? 1e5 : 0) + l.size;
  }
}
