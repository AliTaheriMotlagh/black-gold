/**
 * Unified mouse / touch / pen / keyboard input → Controller + camera.
 *
 * Mouse: left click select, left drag box, right click command, right drag pan (grab
 * the map), wheel zoom to cursor, middle drag rotate/tilt, edge scroll.
 * Touch: tap select/command, one-finger drag pan, pinch zoom, twist rotate, two-finger
 * vertical drag tilt, long-press then drag box select, double-tap select type.
 */
import * as THREE from 'three';
import type { Controller } from './Controller';
import type { World3D } from '../render/World3D';

interface Ptr {
  id: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
  button: number;
  type: string;
  t0: number;
}

export class Input {
  enabled = true;
  edgeScroll = true;
  private ptrs = new Map<number, Ptr>();
  private keys = new Set<string>();
  private mode: 'none' | 'box' | 'pan' | 'rotate' | 'pinch' | 'longpress' = 'none';
  private anchor: THREE.Vector3 | null = null;
  private pinch = { d: 0, a: 0, mx: 0, my: 0 };
  private box: HTMLDivElement;
  private longTimer = 0;
  private mouse = { x: -1, y: -1, inside: false };
  private lastTap = { t: 0, x: 0, y: 0 };
  private listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [];
  onEscape: () => void = () => {};
  onJumpAlert: () => void = () => {};
  onHotkey: (key: string, e: KeyboardEvent) => boolean = () => false;
  /** Touch placement: the HUD shows confirm/cancel after a ghost tap. */
  onPlacementTap: () => void = () => {};

  constructor(
    readonly view: World3D,
    readonly ctl: Controller,
    readonly canvas: HTMLCanvasElement,
  ) {
    this.box = document.createElement('div');
    this.box.className = 'select-box';
    document.body.append(this.box);
    const on = (t: EventTarget, ev: string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(ev, fn as EventListener, opts);
      this.listeners.push([t, ev, fn as EventListener, opts]);
    };
    on(canvas, 'pointerdown', (e: PointerEvent) => this.down(e));
    on(window, 'pointermove', (e: PointerEvent) => this.move(e));
    on(window, 'pointerup', (e: PointerEvent) => this.up(e));
    on(window, 'pointercancel', (e: PointerEvent) => this.cancel(e));
    on(canvas, 'wheel', (e: WheelEvent) => this.wheel(e), { passive: false });
    on(canvas, 'contextmenu', (e: Event) => e.preventDefault());
    on(canvas, 'pointerleave', () => (this.mouse.inside = false));
    on(canvas, 'pointerenter', () => (this.mouse.inside = true));
    on(window, 'keydown', (e: KeyboardEvent) => this.keydown(e));
    on(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
    on(window, 'blur', () => this.keys.clear());
  }

  dispose() {
    for (const [t, ev, fn, opts] of this.listeners) t.removeEventListener(ev, fn, opts);
    this.box.remove();
  }

  private rel(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down(e: PointerEvent) {
    if (!this.enabled) return;
    const p = this.rel(e);
    this.canvas.setPointerCapture?.(e.pointerId);
    const ptr: Ptr = { id: e.pointerId, x: p.x, y: p.y, sx: p.x, sy: p.y, button: e.button, type: e.pointerType, t0: performance.now() };
    this.ptrs.set(e.pointerId, ptr);
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      if (this.ptrs.size === 2) {
        clearTimeout(this.longTimer);
        this.startPinch();
      } else if (this.ptrs.size === 1) {
        this.mode = 'none';
        this.longTimer = window.setTimeout(() => {
          if (this.mode === 'none' && this.ptrs.size === 1) {
            this.mode = 'longpress';
            this.ctl.vibrate(25);
            this.drawBox(ptr.sx, ptr.sy, ptr.sx, ptr.sy);
          }
        }, 420);
      }
      return;
    }
    if (e.button === 1) {
      this.mode = 'rotate';
      e.preventDefault();
    }
  }

  private move(e: PointerEvent) {
    const p = this.rel(e);
    if (e.pointerType === 'mouse') {
      this.mouse.x = p.x;
      this.mouse.y = p.y;
      if (this.ctl.mode.kind === 'place' && this.ptrs.size === 0) {
        const g = this.ctl.ground(p.x, p.y);
        if (g) this.ctl.updateGhost(g.x, g.z);
      }
    }
    const ptr = this.ptrs.get(e.pointerId);
    if (!ptr || !this.enabled) return;
    const dx = p.x - ptr.x;
    const dy = p.y - ptr.y;
    ptr.x = p.x;
    ptr.y = p.y;
    const moved = Math.hypot(p.x - ptr.sx, p.y - ptr.sy);
    if (ptr.type === 'mouse') {
      if (this.mode === 'rotate') {
        this.view.rig.rotate(-dx * 0.005);
        this.view.rig.addTilt(dy * 0.003);
        return;
      }
      if (ptr.button === 0) {
        if (this.mode === 'none' && moved > 6 && this.ctl.mode.kind === 'normal') this.mode = 'box';
        if (this.mode === 'box') this.drawBox(ptr.sx, ptr.sy, p.x, p.y);
      } else if (ptr.button === 2) {
        if (this.mode === 'none' && moved > 5) this.beginPan(ptr.sx, ptr.sy);
        if (this.mode === 'pan') this.dragPan(p.x, p.y);
      }
      return;
    }
    // Touch
    if (this.ptrs.size >= 2) {
      this.updatePinch();
      return;
    }
    if (this.mode === 'longpress') {
      this.drawBox(ptr.sx, ptr.sy, p.x, p.y);
      return;
    }
    if (this.mode === 'none' && moved > 10) {
      clearTimeout(this.longTimer);
      this.beginPan(ptr.sx, ptr.sy);
    }
    if (this.mode === 'pan') this.dragPan(p.x, p.y);
  }

  private up(e: PointerEvent) {
    const ptr = this.ptrs.get(e.pointerId);
    if (!ptr) return;
    this.ptrs.delete(e.pointerId);
    clearTimeout(this.longTimer);
    if (!this.enabled) {
      this.reset();
      return;
    }
    const p = this.rel(e);
    const moved = Math.hypot(p.x - ptr.sx, p.y - ptr.sy);
    const now = performance.now() / 1000;
    if (ptr.type === 'mouse') {
      if (ptr.button === 0) {
        if (this.mode === 'box') this.ctl.boxSelect(ptr.sx, ptr.sy, p.x, p.y, e.shiftKey);
        else if (this.mode === 'none') {
          if (this.ctl.mode.kind !== 'normal') this.ctl.command(p.x, p.y, e.shiftKey);
          else this.ctl.clickSelect(p.x, p.y, e.shiftKey || e.ctrlKey, now);
        }
      } else if (ptr.button === 2 && this.mode !== 'pan' && moved < 6) {
        if (this.ctl.mode.kind !== 'normal') this.ctl.setMode({ kind: 'normal' });
        else this.ctl.command(p.x, p.y, e.shiftKey);
      }
      this.reset();
      return;
    }
    // Touch
    if (this.mode === 'longpress') {
      if (moved > 12) this.ctl.boxSelect(ptr.sx, ptr.sy, p.x, p.y, false);
      else this.ctl.clickSelect(p.x, p.y, true, now);
    } else if (this.mode === 'none' && this.ptrs.size === 0 && moved < 12) this.tap(p.x, p.y, now);
    if (this.ptrs.size === 0) this.reset();
    else if (this.ptrs.size === 1) this.mode = 'pan';
  }

  private cancel(e: PointerEvent) {
    this.ptrs.delete(e.pointerId);
    clearTimeout(this.longTimer);
    if (!this.ptrs.size) this.reset();
  }

  private reset() {
    this.mode = 'none';
    this.anchor = null;
    this.box.style.display = 'none';
  }

  private tap(x: number, y: number, now: number) {
    const ctl = this.ctl;
    const m = ctl.mode.kind;
    if (m === 'place') {
      const g = ctl.ground(x, y);
      if (g) ctl.updateGhost(g.x, g.z);
      this.onPlacementTap();
      return;
    }
    if (m !== 'normal') {
      ctl.command(x, y);
      return;
    }
    const target = ctl.pick(x, y);
    const double = now - this.lastTap.t < 0.32 && Math.hypot(x - this.lastTap.x, y - this.lastTap.y) < 30;
    this.lastTap = { t: now, x, y };
    const own = ctl.selectedUnits().length > 0;
    if (target && target.owner === ctl.local) {
      if (double && target.isUnit) ctl.selectTypeOnScreen(target.def.id, true, false);
      else if (own && !target.isUnit && (!target.built || target.hp < target.maxHp)) ctl.command(x, y);
      else ctl.clickSelect(x, y, false, now);
      return;
    }
    if (own) ctl.command(x, y);
    else ctl.clickSelect(x, y, false, now);
  }

  // --- camera gestures ---------------------------------------------------------

  private beginPan(sx: number, sy: number) {
    this.mode = 'pan';
    this.anchor = this.ctl.ground(sx, sy);
  }

  private dragPan(x: number, y: number) {
    if (!this.anchor) return;
    const p = this.ctl.ground(x, y);
    if (!p) return;
    this.view.rig.panWorld(this.anchor.x - p.x, this.anchor.z - p.z);
  }

  private startPinch() {
    const [a, b] = [...this.ptrs.values()];
    this.mode = 'pinch';
    this.box.style.display = 'none';
    this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    this.anchor = this.ctl.ground(this.pinch.mx, this.pinch.my);
  }

  private updatePinch() {
    const [a, b] = [...this.ptrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const rig = this.view.rig;
    if (this.pinch.d > 10 && d > 10) rig.zoom(this.pinch.d / d);
    let da = ang - this.pinch.a;
    if (da > Math.PI) da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    if (Math.abs(da) < 0.5) rig.rotate(-da);
    // Two fingers moving vertically together tilt; otherwise pan with the midpoint.
    const dmy = my - this.pinch.my;
    const dmx = mx - this.pinch.mx;
    if (Math.abs(dmy) > Math.abs(dmx) * 2 && Math.abs(d - this.pinch.d) < 4) rig.addTilt(dmy * 0.004);
    else if (this.anchor) {
      const p = this.ctl.ground(mx, my);
      if (p) rig.panWorld(this.anchor.x - p.x, this.anchor.z - p.z);
    }
    this.pinch = { d, a: ang, mx, my };
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    if (!this.enabled) return;
    const p = this.rel(e as unknown as PointerEvent);
    const g = this.ctl.ground(p.x, p.y);
    const k = Math.exp((e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY) * 0.0012);
    this.view.rig.zoom(k, g ? { x: g.x, z: g.z } : undefined);
  }

  private drawBox(x0: number, y0: number, x1: number, y1: number) {
    const r = this.canvas.getBoundingClientRect();
    Object.assign(this.box.style, {
      display: 'block',
      left: `${Math.min(x0, x1) + r.left}px`,
      top: `${Math.min(y0, y1) + r.top}px`,
      width: `${Math.abs(x1 - x0)}px`,
      height: `${Math.abs(y1 - y0)}px`,
    });
  }

  // --- keyboard -----------------------------------------------------------------

  private keydown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.code === 'Escape') {
      if (this.ctl.mode.kind !== 'normal') this.ctl.setMode({ kind: 'normal' });
      else this.onEscape();
      return;
    }
    if (!this.enabled) return;
    this.keys.add(e.code);
    if (this.onHotkey(e.code, e)) {
      e.preventDefault();
      return;
    }
    const ctl = this.ctl;
    const digit = e.code.startsWith('Digit') ? Number(e.code.slice(5)) : -1;
    if (digit >= 0) {
      if (e.ctrlKey || e.metaKey) ctl.setGroup(digit);
      else ctl.recallGroup(digit, e.altKey || this.doubleKey(e.code));
      e.preventDefault();
      return;
    }
    switch (e.code) {
      case 'KeyA':
        if (ctl.selectedUnits().length) ctl.setMode({ kind: 'attackMove' });
        break;
      case 'KeyS':
        ctl.stop();
        break;
      case 'KeyH':
        ctl.hold();
        break;
      case 'KeyD':
        ctl.deploy();
        break;
      case 'KeyR':
        ctl.rtb();
        break;
      case 'KeyF':
        ctl.focusSelection();
        break;
      case 'Space':
        this.onJumpAlert();
        e.preventDefault();
        break;
      case 'Period':
        ctl.selectAll((u) => u.def.builder === true && u.order === 'idle');
        ctl.focusSelection();
        break;
      case 'KeyQ':
      case 'KeyE':
      case 'KeyW':
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
        e.preventDefault();
        break;
    }
  }

  private lastKey = { code: '', t: 0 };
  private doubleKey(code: string) {
    const now = performance.now();
    const d = this.lastKey.code === code && now - this.lastKey.t < 350;
    this.lastKey = { code, t: now };
    return d;
  }

  /** Continuous camera control (keys + edge scroll). */
  update(dt: number) {
    if (!this.enabled) return;
    const rig = this.view.rig;
    const k = this.keys;
    let px = 0;
    let pz = 0;
    // WASD only pans when no unit hotkey intent (A/S/D are also commands; arrows always pan).
    if (k.has('ArrowLeft')) px -= 1;
    if (k.has('ArrowRight')) px += 1;
    if (k.has('ArrowUp') || k.has('KeyW')) pz -= 1;
    if (k.has('ArrowDown')) pz += 1;
    if (this.edgeScroll && this.mouse.inside && !this.ptrs.size) {
      const { w, h } = this.ctl.viewport();
      const m = 10;
      if (this.mouse.x < m) px -= 1;
      if (this.mouse.x > w - m) px += 1;
      if (this.mouse.y < m) pz -= 1;
      if (this.mouse.y > h - m) pz += 1;
    }
    if (px || pz) rig.pan(px * dt * 900, pz * dt * 900);
    if (k.has('KeyQ')) rig.rotate(dt * 1.4);
    if (k.has('KeyE')) rig.rotate(-dt * 1.4);
    if (k.has('Equal') || k.has('NumpadAdd')) rig.zoom(Math.exp(-dt * 2));
    if (k.has('Minus') || k.has('NumpadSubtract')) rig.zoom(Math.exp(dt * 2));
    // Hover (mouse only): highlight entity under cursor.
    if (this.mouse.inside && !this.ptrs.size) this.ctl.hover = this.ctl.pick(this.mouse.x, this.mouse.y);
  }
}
