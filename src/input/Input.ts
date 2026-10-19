import type { Controller } from './Controller';
import type { Stage } from '../render/Stage';

interface PointerInfo {
  id: number;
  type: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  button: number;
  startTime: number;
}

/**
 * Unified mouse / touch / pen / keyboard handling.
 * Desktop: LMB select & box, RMB command, MMB rotate, wheel zoom, WASD/edges pan.
 * Touch: tap select/command, drag pan, long-press drag box-select, pinch zoom, twist rotate.
 */
export class Input {
  private pointers = new Map<number, PointerInfo>();
  private keys = new Set<string>();
  private box: HTMLDivElement;
  private boxing = false;
  private panning = false;
  private rotating = false;
  private longPressTimer: number | null = null;
  private pinch: { dist: number; angle: number; mx: number; my: number } | null = null;
  private mouse = { x: -1, y: -1, inside: false };
  /** Touch "box select" toggle (mobile action button). */
  boxMode = false;
  edgeScroll = true;
  enabled = true;
  onEscape: () => void = () => {};
  onJumpAlert: () => void = () => {};
  onHotkey: (key: string) => boolean = () => false;
  private disposers: (() => void)[] = [];

  constructor(private stage: Stage, private ctl: Controller) {
    this.box = document.createElement('div');
    this.box.className = 'select-box';
    document.body.appendChild(this.box);
    const c = stage.canvas;
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, ev: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(ev, fn as EventListener, opts);
      this.disposers.push(() => el.removeEventListener(ev, fn as EventListener, opts));
    };
    on(c, 'pointerdown', (e) => this.down(e));
    on(window, 'pointermove', (e) => this.move(e as PointerEvent));
    on(window, 'pointerup', (e) => this.up(e as PointerEvent));
    on(window, 'pointercancel', (e) => this.cancel(e as PointerEvent));
    on(c, 'wheel', (e) => this.wheel(e), { passive: false });
    on(c, 'contextmenu', (e) => e.preventDefault());
    on(c, 'pointerleave', () => (this.mouse.inside = false));
    on(c, 'pointerenter', () => (this.mouse.inside = true));
    on(window, 'keydown', (e) => this.keyDown(e as KeyboardEvent));
    on(window, 'keyup', (e) => this.keys.delete((e as KeyboardEvent).code));
    on(window, 'blur', () => this.keys.clear());
  }

  dispose() {
    this.disposers.forEach((d) => d());
    this.box.remove();
  }

  private isTouch(e: PointerEvent) {
    return e.pointerType === 'touch' || e.pointerType === 'pen';
  }

  private down(e: PointerEvent) {
    if (!this.enabled) return;
    e.preventDefault();
    this.stage.canvas.setPointerCapture?.(e.pointerId);
    const p: PointerInfo = { id: e.pointerId, type: e.pointerType, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, button: e.button, startTime: performance.now() };
    this.pointers.set(e.pointerId, p);
    if (this.isTouch(e)) {
      const touches = [...this.pointers.values()].filter((q) => q.type !== 'mouse');
      if (touches.length === 2) {
        this.clearLongPress();
        this.boxing = false;
        this.box.style.display = 'none';
        this.panning = false;
        const [a, b] = touches;
        this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), angle: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      } else if (touches.length === 1) {
        if (this.boxMode) this.startBox(p);
        else
          this.longPressTimer = window.setTimeout(() => {
            if (!this.panning && this.ctl.mode === 'normal') {
              this.ctl.vibrate(25);
              this.startBox(p);
            }
          }, 420);
      }
    } else if (e.button === 1) {
      this.rotating = true;
    }
  }

  private startBox(p: PointerInfo) {
    this.boxing = true;
    this.updateBox(p);
    this.box.style.display = 'block';
  }

  private updateBox(p: PointerInfo) {
    const x = Math.min(p.startX, p.x);
    const y = Math.min(p.startY, p.y);
    Object.assign(this.box.style, { left: `${x}px`, top: `${y}px`, width: `${Math.abs(p.x - p.startX)}px`, height: `${Math.abs(p.y - p.startY)}px` });
  }

  private clearLongPress() {
    if (this.longPressTimer !== null) clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
  }

  private move(e: PointerEvent) {
    if (e.pointerType === 'mouse') {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      if (this.ctl.mode === 'place') this.ctl.updatePlacement(e.clientX, e.clientY);
      if (this.ctl.mode === 'missile') this.ctl.hoverMissile(e.clientX, e.clientY);
    }
    const p = this.pointers.get(e.pointerId);
    if (!p || !this.enabled) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    const moved = Math.hypot(p.x - p.startX, p.y - p.startY);

    if (this.isTouch(e)) {
      const touches = [...this.pointers.values()].filter((q) => q.type !== 'mouse');
      if (touches.length >= 2 && this.pinch) {
        const [a, b] = touches;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        if (dist > 10) this.stage.rig.zoom(this.pinch.dist / dist);
        let da = angle - this.pinch.angle;
        if (da > Math.PI) da -= Math.PI * 2;
        if (da < -Math.PI) da += Math.PI * 2;
        this.stage.rig.rotate(-da);
        this.stage.rig.panPixels(mx - this.pinch.mx, my - this.pinch.my, this.stage.height);
        this.pinch = { dist, angle, mx, my };
        return;
      }
      if (this.boxing) {
        this.updateBox(p);
        return;
      }
      if (moved > 10) {
        this.clearLongPress();
        if (this.ctl.mode === 'place' && !this.panning) {
          // Dragging the ghost in placement mode
          this.ctl.updatePlacement(p.x, p.y);
          return;
        }
        this.panning = true;
        this.stage.rig.panPixels(dx, dy, this.stage.height);
      }
      return;
    }
    // Mouse
    if (this.rotating) {
      this.stage.rig.rotate(-dx * 0.006);
      return;
    }
    if (p.button === 0 && this.ctl.mode === 'normal' && moved > 6) {
      this.boxing = true;
      this.box.style.display = 'block';
      this.updateBox(p);
    }
    if (p.button === 2 && moved > 6) {
      this.panning = true;
      this.stage.rig.panPixels(dx, dy, this.stage.height);
    }
  }

  private up(e: PointerEvent) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    this.clearLongPress();
    if (!this.enabled) return;
    const touch = this.isTouch(e);
    const moved = Math.hypot(p.x - p.startX, p.y - p.startY);
    if (touch) {
      const remaining = [...this.pointers.values()].filter((q) => q.type !== 'mouse');
      if (this.pinch) {
        if (remaining.length < 2) this.pinch = null;
        // Prevent the remaining finger from acting as a fresh drag
        if (remaining.length === 1) {
          remaining[0].startX = remaining[0].x;
          remaining[0].startY = remaining[0].y;
          this.panning = true;
        }
        return;
      }
      if (this.boxing) {
        this.endBox(p, false);
        return;
      }
      if (!this.panning && moved < 12) this.ctl.primary(p.x, p.y, false, true);
      if (remaining.length === 0) this.panning = false;
      return;
    }
    // Mouse
    if (p.button === 1) {
      this.rotating = false;
      return;
    }
    if (p.button === 0) {
      if (this.boxing) this.endBox(p, e.shiftKey);
      else this.ctl.primary(p.x, p.y, e.shiftKey, false);
    } else if (p.button === 2) {
      if (this.panning) this.panning = false;
      else if (this.ctl.mode !== 'normal') this.ctl.cancelMode();
      else this.ctl.command(p.x, p.y, false, e.ctrlKey);
    }
  }

  private endBox(p: PointerInfo, additive: boolean) {
    this.boxing = false;
    this.box.style.display = 'none';
    if (Math.hypot(p.x - p.startX, p.y - p.startY) > 8) this.ctl.boxSelect(p.startX, p.startY, p.x, p.y, additive);
  }

  private cancel(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    this.clearLongPress();
    this.boxing = false;
    this.box.style.display = 'none';
    this.pinch = null;
    this.panning = false;
  }

  private wheel(e: WheelEvent) {
    if (!this.enabled) return;
    e.preventDefault();
    const anchor = this.stage.pickGround(e.clientX, e.clientY) ?? undefined;
    const factor = Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0022);
    this.stage.rig.zoom(factor, anchor);
  }

  private keyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return;
    if (e.code === 'Escape') {
      if (this.ctl.mode !== 'normal') this.ctl.cancelMode();
      else this.onEscape();
      return;
    }
    if (!this.enabled) return;
    const digit = /^Digit([0-9])$/.exec(e.code);
    if (digit) {
      const n = Number(digit[1]);
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.ctl.setGroup(n);
      } else this.ctl.recallGroup(n);
      return;
    }
    if (!e.repeat && this.onHotkey(e.key.toUpperCase())) return;
    this.keys.add(e.code);
    switch (e.code) {
      case 'KeyA':
        if (this.ctl.selectedUnits.length) this.ctl.startAttackMove();
        break;
      case 'KeyS':
        if (this.ctl.selectedUnits.length) this.ctl.stop();
        break;
      case 'Space':
        e.preventDefault();
        this.onJumpAlert();
        break;
      case 'KeyH': {
        const hq = this.ctl.selection[0];
        if (hq) this.stage.rig.focus(hq.x, hq.z);
        break;
      }
      case 'Equal':
      case 'NumpadAdd':
        this.stage.rig.zoom(0.85);
        break;
      case 'Minus':
      case 'NumpadSubtract':
        this.stage.rig.zoom(1.18);
        break;
    }
  }

  update(dt: number) {
    if (!this.enabled) return;
    const rig = this.stage.rig;
    const speed = rig.distance * 1.4 * dt;
    let r = 0;
    let f = 0;
    const k = this.keys;
    // Only WASD pan when no units are selected for S/A hotkeys — arrows always pan.
    const wasd = this.ctl.selectedUnits.length === 0;
    if (k.has('ArrowLeft') || (wasd && k.has('KeyA'))) r -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) r += 1;
    if (k.has('ArrowUp') || k.has('KeyW')) f += 1;
    if (k.has('ArrowDown') || (wasd && k.has('KeyS'))) f -= 1;
    if (k.has('KeyQ')) rig.rotate(dt * 1.6);
    if (k.has('KeyE')) rig.rotate(-dt * 1.6);
    if (this.edgeScroll && this.mouse.inside && document.hasFocus() && !this.boxing) {
      const m = 14;
      const { x, y } = this.mouse;
      if (x >= 0 && x < m) r -= 1;
      if (x > this.stage.width - m) r += 1;
      if (y >= 0 && y < m) f += 1;
      if (y > this.stage.height - m) f -= 1;
    }
    if (r || f) rig.panWorld(r * speed, f * speed);
  }
}
