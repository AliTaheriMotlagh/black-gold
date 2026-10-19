/**
 * Minimap: satellite backdrop, territory tint, fog, unit/city dots, camera frustum.
 * Two zoom levels (whole theater / 700 km region). Click or drag to move the camera.
 */
import * as THREE from 'three';
import type { Game } from '../../game/Game';
import { h, svgIcon } from '../dom';
import { t } from '../../i18n';

export class Minimap {
  readonly root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private bg: HTMLImageElement;
  private overlay: HTMLCanvasElement;
  private overlayT = -1;
  private acc = 0;
  private regional = false;
  private dragging = false;
  private collapsed: boolean;
  private ownerSig = '';

  constructor(readonly game: Game) {
    this.canvas = h('canvas', { class: 'mm-canvas' });
    this.ctx = this.canvas.getContext('2d')!;
    this.bg = new Image();
    this.bg.src = '/data/mini.webp';
    this.overlay = document.createElement('canvas');
    const th = game.world.theater;
    this.overlay.width = Math.ceil(th.w / 3);
    this.overlay.height = Math.ceil(th.h / 3);
    this.collapsed = matchMedia('(max-width: 900px), (max-height: 520px)').matches;
    const zoomBtn = h('button', { class: 'btn icon', title: 'Zoom', onclick: () => ((this.regional = !this.regional), (this.acc = 1)) }, svgIcon('focus'));
    const polBtn = h('button', { class: 'btn icon', title: t('hud.political'), onclick: () => (game.view.politicalBoost = game.view.politicalBoost ? 0 : 1) }, svgIcon('layers'));
    const toggle = h('button', { class: 'btn icon mm-toggle', title: 'Map', onclick: () => this.setCollapsed(!this.collapsed) }, svgIcon('map'));
    this.root = h('div', { class: 'minimap' }, toggle, h('div', { class: 'mm-body' }, this.canvas, h('div', { class: 'mm-tools' }, zoomBtn, polBtn)));
    this.setCollapsed(this.collapsed);
    const handle = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      const p = this.toWorld((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      game.view.rig.focus(p.x, p.z);
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      handle(e);
    });
    this.canvas.addEventListener('pointermove', (e) => this.dragging && handle(e));
    this.canvas.addEventListener('pointerup', () => (this.dragging = false));
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const r = this.canvas.getBoundingClientRect();
      const p = this.toWorld((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      const ids = game.ctl.selectedUnits().map((u) => u.id);
      if (ids.length) game.session.issue({ k: 'move', ids, x: p.x, z: p.z, atk: e.shiftKey });
    });
  }

  private setCollapsed(c: boolean) {
    this.collapsed = c;
    this.root.classList.toggle('collapsed', c);
    this.acc = 1;
  }

  /** Visible world window [x0, z0, size]. */
  private window() {
    const th = this.game.world.theater;
    if (!this.regional) return { x0: 0, z0: 0, w: th.worldW, h: th.worldH };
    const size = 700;
    const t = this.game.view.rig.target;
    const x0 = THREE.MathUtils.clamp(t.x - size / 2, 0, th.worldW - size);
    const z0 = THREE.MathUtils.clamp(t.z - size / 2, 0, th.worldH - size);
    return { x0, z0, w: size, h: size * (th.worldH / th.worldW) };
  }

  private toWorld(u: number, v: number) {
    const w = this.window();
    return { x: w.x0 + u * w.w, z: w.z0 + v * w.h };
  }

  /** Territory + fog at 1/3 resolution (refreshed on capture and every 2 s). */
  private buildOverlay() {
    const g = this.game;
    const w = g.world;
    const th = w.theater;
    const ow = this.overlay.width;
    const oh = this.overlay.height;
    const ctx = this.overlay.getContext('2d')!;
    const img = ctx.createImageData(ow, oh);
    const cols = w.countries.map((c) => new THREE.Color(c.meta.color));
    const fog = g.view.terrain.fogTex.image.data as Uint8Array;
    for (let y = 0; y < oh; y++)
      for (let x = 0; x < ow; x++) {
        const i = Math.min(th.h - 1, y * 3) * th.w + Math.min(th.w - 1, x * 3);
        const o = (y * ow + x) * 4;
        const f = fog[i];
        if (th.water[i]) {
          img.data[o + 3] = f < 100 ? 120 : 0;
          continue;
        }
        const r = th.region[i];
        const owner = r >= 0 ? w.cities[r].owner : th.country[i];
        const c = cols[owner] ?? cols[0];
        const dim = f < 100 ? 0.35 : f < 200 ? 0.75 : 1;
        img.data[o] = c.r * 255 * dim;
        img.data[o + 1] = c.g * 255 * dim;
        img.data[o + 2] = c.b * 255 * dim;
        img.data[o + 3] = owner ? (f < 100 ? 200 : 95) : f < 100 ? 140 : 0;
      }
    ctx.putImageData(img, 0, 0);
  }

  update(dt: number) {
    if (this.collapsed) return;
    this.acc += dt;
    if (this.acc < 0.16) return;
    this.acc = 0;
    const g = this.game;
    const w = g.world;
    const cssW = this.canvas.clientWidth || 220;
    const cssH = this.canvas.clientHeight || 200;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(cssW * dpr)) {
      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);
    }
    const sig = w.cities.map((c) => c.owner).join(',');
    if (sig !== this.ownerSig || w.time - this.overlayT > 2) {
      this.ownerSig = sig;
      this.overlayT = w.time;
      this.buildOverlay();
    }
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const win = this.window();
    const th = w.theater;
    ctx.fillStyle = '#0b1a26';
    ctx.fillRect(0, 0, W, H);
    // Backdrop and overlay, cropped to the window.
    const sx = (win.x0 / th.worldW) * this.bg.naturalWidth;
    const sy = (win.z0 / th.worldH) * this.bg.naturalHeight;
    const sw = (win.w / th.worldW) * this.bg.naturalWidth;
    const sh = (win.h / th.worldH) * this.bg.naturalHeight;
    if (this.bg.complete && this.bg.naturalWidth) ctx.drawImage(this.bg, sx, sy, sw, sh, 0, 0, W, H);
    const ox = (win.x0 / th.worldW) * this.overlay.width;
    const oy = (win.z0 / th.worldH) * this.overlay.height;
    ctx.imageSmoothingEnabled = !this.regional;
    ctx.drawImage(this.overlay, ox, oy, (win.w / th.worldW) * this.overlay.width, (win.h / th.worldH) * this.overlay.height, 0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    const px = (x: number) => ((x - win.x0) / win.w) * W;
    const pz = (z: number) => ((z - win.z0) / win.h) * H;
    // Cities
    for (const c of w.cities) {
      if (!w.vision.isExplored(g.session.local, c.x, c.z)) continue;
      const r = (c.capital ? 2.6 : 1.6) * dpr;
      ctx.fillStyle = w.countries[c.owner]?.meta.color ?? '#999';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = dpr;
      ctx.beginPath();
      ctx.rect(px(c.x) - r, pz(c.z) - r, r * 2, r * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Entities
    const local = g.session.local;
    const size = (this.regional ? 2.4 : 1.8) * dpr;
    for (const e of g.entities.visible) {
      const rel = e.owner === local ? '#5dff8a' : w.allied(local, e.owner) ? '#5dd6ff' : w.isEnemy(local, e.owner) ? '#ff4a3a' : '#ffd34d';
      ctx.fillStyle = rel;
      const s = e.isUnit ? size : size * 1.6;
      ctx.fillRect(px(e.x) - s / 2, pz(e.z) - s / 2, s, s);
    }
    // Missiles in flight
    ctx.fillStyle = '#fff';
    for (const p of w.projectiles) if (p.delivery === 'warhead') ctx.fillRect(px(p.x) - dpr, pz(p.z) - dpr, 2 * dpr, 2 * dpr);
    // Camera frustum
    const corners = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ].map(([u, v]) => g.ctl.ground(u * g.ctl.viewport().w, v * g.ctl.viewport().h) ?? g.view.rig.target);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.2 * dpr;
    ctx.beginPath();
    corners.forEach((c, i) => (i ? ctx.lineTo(px(c.x), pz(c.z)) : ctx.moveTo(px(c.x), pz(c.z))));
    ctx.closePath();
    ctx.stroke();
  }

  dispose() {}
}
