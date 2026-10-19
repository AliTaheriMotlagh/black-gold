import { GRID_H, GRID_W, WORLD_H, WORLD_W } from '../geo/geography';
import type { World } from '../game/World';
import type { Stage } from '../render/Stage';
import type { Controller } from '../input/Controller';

/** Tactical minimap with fog, units, cities, oil and camera frustum. Click/drag to move the camera. */
export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private fogCanvas: HTMLCanvasElement;
  private fogCtx: CanvasRenderingContext2D;
  private fogImg: ImageData;
  private timer = 0;
  private pings: { x: number; z: number; t: number; color: string }[] = [];
  private dragging = false;
  private readonly W = GRID_W * 2;
  private readonly H = GRID_H * 2;

  constructor(private world: World, private stage: Stage, private ctl: Controller) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.ctx = this.canvas.getContext('2d')!;
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = GRID_W;
    this.fogCanvas.height = GRID_H;
    this.fogCtx = this.fogCanvas.getContext('2d')!;
    this.fogImg = this.fogCtx.createImageData(GRID_W, GRID_H);
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.button === 2) {
        const p = this.toWorld(e);
        if (this.ctl.selectedUnits.length) {
          this.world.commandMove(this.ctl.selectedUnits, p.x, p.z);
          this.ping(p.x, p.z, '#5dff8a');
        }
        return;
      }
      this.dragging = true;
      c.setPointerCapture(e.pointerId);
      this.jump(e);
    });
    c.addEventListener('pointermove', (e) => {
      if (this.dragging) this.jump(e);
    });
    c.addEventListener('pointerup', () => (this.dragging = false));
    c.addEventListener('pointercancel', () => (this.dragging = false));
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private toWorld(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * WORLD_W, z: ((e.clientY - r.top) / r.height) * WORLD_H };
  }

  private jump(e: PointerEvent) {
    const p = this.toWorld(e);
    this.stage.rig.focus(p.x, p.z);
  }

  ping(x: number, z: number, color = '#ff5050') {
    this.pings.push({ x, z, t: 0, color });
  }

  update(dt: number) {
    for (const p of this.pings) p.t += dt;
    this.pings = this.pings.filter((p) => p.t < 2.5);
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.12;
    this.draw();
  }

  private draw() {
    const { ctx, W, H, world } = this;
    const sx = W / WORLD_W;
    const sz = H / WORLD_H;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.stage.terrain.minimapImage, 0, 0, W, H);

    // Fog
    const fog = world.fog;
    if (fog.enabled) {
      const d = this.fogImg.data;
      for (let i = 0; i < fog.state.length; i++) {
        const s = fog.state[i];
        d[i * 4] = 8;
        d[i * 4 + 1] = 6;
        d[i * 4 + 2] = 4;
        d[i * 4 + 3] = s === 2 ? 0 : s === 1 ? 110 : 175;
      }
      this.fogCtx.putImageData(this.fogImg, 0, 0);
      ctx.drawImage(this.fogCanvas, 0, 0, W, H);
    }

    // Oil fields
    for (const f of world.oilFields) {
      ctx.beginPath();
      ctx.arc(f.x * sx, f.z * sz, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = f.derrick && f.derrick.seen ? world.teams[f.derrick.team].theme.css : '#0a0a0a';
      ctx.fill();
      ctx.strokeStyle = f.fire > 0 ? '#ff6a00' : '#f5b942';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    // Cities
    for (const c of world.cities) {
      const s = c.def.capital ? 6 : 4.5;
      ctx.fillStyle = c.owner >= 0 ? world.teams[c.owner].theme.css : '#e8e2d4';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(c.x * sx - s / 2, c.z * sz - s / 2, s, s);
      ctx.fill();
      ctx.stroke();
    }
    // Buildings
    for (const b of world.buildings) {
      if (!b.alive || !b.seen || b.kind === 'derrick') continue;
      const s = b.size * 2 * sx * 2;
      ctx.fillStyle = world.teams[b.team].theme.css;
      ctx.fillRect(b.x * sx - s / 2, b.z * sz - s / 2, s, s);
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeRect(b.x * sx - s / 2, b.z * sz - s / 2, s, s);
    }
    // Units
    for (const u of world.units) {
      if (!u.alive || !u.seen) continue;
      ctx.fillStyle = u.selected ? '#ffffff' : world.teams[u.team].theme.css;
      const r = u.isAir ? 2.4 : 1.8;
      ctx.fillRect(u.x * sx - r, u.z * sz - r, r * 2, r * 2);
    }
    // Pings
    for (const p of this.pings) {
      const k = p.t / 2.5;
      ctx.beginPath();
      ctx.arc(p.x * sx, p.z * sz, 4 + k * 22, 0, Math.PI * 2);
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Camera frustum
    const r = this.stage.canvas.getBoundingClientRect();
    const corners = [
      [r.left, r.top],
      [r.right, r.top],
      [r.right, r.bottom],
      [r.left, r.bottom],
    ]
      .map(([x, y]) => this.stage.pickGround(x, y))
      .filter((p) => p !== null);
    if (corners.length === 4) {
      ctx.beginPath();
      corners.forEach((p, i) => (i ? ctx.lineTo(p!.x * sx, p!.z * sz) : ctx.moveTo(p!.x * sx, p!.z * sz)));
      ctx.closePath();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      const t = this.stage.rig.target;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.strokeRect(t.x * sx - 12, t.z * sz - 9, 24, 18);
    }
  }
}
