/**
 * Screen-space overlays: NATO-style tactical symbols (strategic zoom), health bars,
 * selection/team rings and order markers.
 *
 * Symbols follow APP-6 conventions: frame shape shows affiliation (rectangle = own or
 * allied, diamond = at war, square = neutral), fill shows the country colour, the glyph
 * shows the unit type.
 */
import * as THREE from 'three';

const CELL = 128;
const COLS = 8;

const SPRITE_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iRect;
attribute vec4 iColor;
attribute vec4 iSize;
uniform vec2 uViewport;
varying vec2 vUv;
varying vec4 vColor;
varying float vMode;
varying vec2 vLocal;
varying float vFrac;
void main() {
  vec4 clip = projectionMatrix * viewMatrix * vec4(iPos, 1.0);
  vec2 px = position.xy * iSize.xy + vec2(0.0, iSize.w);
  clip.xy += px / uViewport * 2.0 * clip.w;
  gl_Position = clip;
  vLocal = position.xy + 0.5;
  vUv = mix(iRect.xy, iRect.zw, vLocal);
  vColor = iColor;
  vMode = iSize.z;
  vFrac = iRect.x;
}`;

const SPRITE_FRAG = /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vUv;
varying vec4 vColor;
varying float vMode;
varying vec2 vLocal;
varying float vFrac;
void main() {
  if (vMode > 0.5) {
    // Health / progress bar
    vec2 p = vLocal;
    float border = step(p.x, 0.04) + step(0.96, p.x) + step(p.y, 0.15) + step(0.85, p.y);
    vec3 fill = vColor.rgb;
    vec3 col = p.x < vFrac ? fill : vec3(0.06);
    col = mix(col, vec3(0.0), clamp(border, 0.0, 1.0));
    gl_FragColor = vec4(col, vColor.a);
    return;
  }
  vec4 t = texture2D(uAtlas, vUv);
  // Red channel = tintable fill, green = black glyph/outline, alpha = coverage.
  vec3 col = mix(vColor.rgb * t.r, vec3(0.04), t.g);
  gl_FragColor = vec4(col, t.a * vColor.a);
  if (gl_FragColor.a < 0.02) discard;
}`;

export type IconShape = 'friend' | 'hostile' | 'neutral';

export class Sprites {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private pos: THREE.InstancedBufferAttribute;
  private rect: THREE.InstancedBufferAttribute;
  private color: THREE.InstancedBufferAttribute;
  private size: THREE.InstancedBufferAttribute;
  private capacity = 0;
  count = 0;
  readonly material: THREE.ShaderMaterial;
  private slots = new Map<string, number>();
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private atlas: THREE.CanvasTexture;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = CELL * COLS;
    this.ctx = this.canvas.getContext('2d')!;
    this.atlas = new THREE.CanvasTexture(this.canvas);
    this.atlas.colorSpace = THREE.NoColorSpace;
    this.atlas.generateMipmaps = true;
    this.atlas.minFilter = THREE.LinearMipmapLinearFilter;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uAtlas: { value: this.atlas }, uViewport: { value: new THREE.Vector2(1, 1) } },
      vertexShader: SPRITE_VERT,
      fragmentShader: SPRITE_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.pos = this.rect = this.color = this.size = null as never;
    this.grow(512);
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 50;
    this.drawFrames();
  }

  private grow(n: number) {
    this.capacity = n;
    const mk = (k: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(n * k), k);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    const copy = (old: THREE.InstancedBufferAttribute | null, fresh: THREE.InstancedBufferAttribute) => {
      if (old) (fresh.array as Float32Array).set(old.array as Float32Array);
      return fresh;
    };
    this.pos = copy(this.pos, mk(3));
    this.rect = copy(this.rect, mk(4));
    this.color = copy(this.color, mk(4));
    this.size = copy(this.size, mk(4));
    this.geo.setAttribute('iPos', this.pos);
    this.geo.setAttribute('iRect', this.rect);
    this.geo.setAttribute('iColor', this.color);
    this.geo.setAttribute('iSize', this.size);
  }

  private slotRect(slot: number): [number, number, number, number] {
    const c = slot % COLS;
    const r = Math.floor(slot / COLS);
    const inset = 1 / (CELL * COLS);
    return [c / COLS + inset, 1 - (r + 1) / COLS + inset, (c + 1) / COLS - inset, 1 - r / COLS - inset];
  }

  /** Atlas slot for a glyph (drawn on demand). */
  private glyph(name: string): number {
    let s = this.slots.get(name);
    if (s !== undefined) return s;
    s = this.slots.size;
    this.slots.set(name, s);
    const ctx = this.ctx;
    const ox = (s % COLS) * CELL;
    const oy = Math.floor(s / COLS) * CELL;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.clearRect(0, 0, CELL, CELL);
    drawSymbol(ctx, name);
    ctx.restore();
    this.atlas.needsUpdate = true;
    return s;
  }

  private drawFrames() {
    for (const f of ['frame:friend', 'frame:hostile', 'frame:neutral', 'frame:base']) this.glyph(f);
  }

  begin(viewW: number, viewH: number) {
    this.count = 0;
    this.material.uniforms.uViewport.value.set(viewW, viewH);
  }

  private push(x: number, y: number, z: number, rect: [number, number, number, number], color: THREE.Color, alpha: number, w: number, h: number, mode: number, offY: number) {
    if (this.count >= this.capacity) this.grow(this.capacity * 2);
    const i = this.count++;
    this.pos.setXYZ(i, x, y, z);
    this.rect.setXYZW(i, rect[0], rect[1], rect[2], rect[3]);
    this.color.setXYZW(i, color.r, color.g, color.b, alpha);
    this.size.setXYZW(i, w, h, mode, offY);
  }

  icon(x: number, y: number, z: number, shape: IconShape | 'base', symbol: string, fill: THREE.Color, size: number, alpha = 1) {
    this.push(x, y, z, this.slotRect(this.glyph(`frame:${shape}`)), fill, alpha, size, size, 0, 0);
    this.push(x, y, z, this.slotRect(this.glyph(symbol)), WHITE, alpha, size, size, 0, 0);
  }

  bar(x: number, y: number, z: number, frac: number, color: THREE.Color, width: number, offY: number, alpha = 0.95) {
    this.push(x, y, z, [frac, 0, 0, 0], color, alpha, width, 5, 1, offY);
  }

  end() {
    this.geo.instanceCount = this.count;
    for (const a of [this.pos, this.rect, this.color, this.size]) {
      a.needsUpdate = true;
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * a.itemSize);
    }
  }
}

const WHITE = new THREE.Color(1, 1, 1);

/**
 * Draw an APP-6-style frame or glyph into a 128 px cell. Red channel = tintable fill,
 * green channel = black ink.
 */
function drawSymbol(ctx: CanvasRenderingContext2D, name: string) {
  const C = CELL / 2;
  const fill = 'rgba(255,0,0,1)';
  const ink = 'rgba(0,255,0,1)';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (name.startsWith('frame:')) {
    const kind = name.slice(6);
    ctx.beginPath();
    if (kind === 'hostile') {
      ctx.moveTo(C, 10);
      ctx.lineTo(CELL - 10, C);
      ctx.lineTo(C, CELL - 10);
      ctx.lineTo(10, C);
    } else if (kind === 'neutral') ctx.rect(22, 22, CELL - 44, CELL - 44);
    else if (kind === 'base') {
      ctx.rect(14, 34, CELL - 28, CELL - 60);
    } else ctx.rect(12, 30, CELL - 24, CELL - 60);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(0,255,0,1)';
    ctx.stroke();
    if (kind === 'base') {
      ctx.fillStyle = ink;
      ctx.fillRect(C - 16, 22, 32, 12);
    }
    return;
  }
  // Glyphs: drawn in ink inside a 100×64 box centred in the cell (matches the friend frame).
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 6;
  const L = 22;
  const R = CELL - 22;
  const T = 40;
  const B = CELL - 40;
  const line = (a: number, b: number, c: number, d: number) => {
    ctx.beginPath();
    ctx.moveTo(a, b);
    ctx.lineTo(c, d);
    ctx.stroke();
  };
  const ellipse = (rx: number, ry: number) => {
    ctx.beginPath();
    ctx.ellipse(C, C, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  };
  const text = (t: string, size = 30, y = C) => {
    ctx.font = `800 ${size}px Rajdhani, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t, C, y + 2);
  };
  const dome = () => {
    ctx.beginPath();
    ctx.arc(C, B, 26, Math.PI, 0);
    ctx.stroke();
  };
  const uav = () => {
    ctx.beginPath();
    ctx.moveTo(L + 8, T + 6);
    ctx.lineTo(C, C + 4);
    ctx.lineTo(R - 8, T + 6);
    ctx.lineTo(C, C + 16);
    ctx.closePath();
    ctx.fill();
  };
  switch (name) {
    case 'inf':
      line(L, T, R, B);
      line(L, B, R, T);
      break;
    case 'armor':
      ellipse(30, 14);
      break;
    case 'mech':
      line(L, T, R, B);
      line(L, B, R, T);
      ellipse(30, 14);
      break;
    case 'at':
      line(L, B, C, T);
      line(C, T, R, B);
      break;
    case 'aa':
      dome();
      break;
    case 'eng':
      line(C - 26, C + 12, C - 26, C - 12);
      line(C - 26, C - 12, C + 26, C - 12);
      line(C + 26, C - 12, C + 26, C + 12);
      line(C, C - 12, C, C + 12);
      break;
    case 'engv':
      line(C - 26, C + 4, C - 26, C - 14);
      line(C - 26, C - 14, C + 26, C - 14);
      line(C + 26, C - 14, C + 26, C + 4);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(C, C + 14, 22, 8, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'sf':
      text('SF');
      break;
    case 'arty':
      ctx.beginPath();
      ctx.arc(C, C, 10, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'mlrs':
      ctx.beginPath();
      ctx.arc(C, C + 6, 8, 0, Math.PI * 2);
      ctx.fill();
      line(C - 14, C - 4, C - 14, T - 2);
      line(C + 14, C - 4, C + 14, T - 2);
      break;
    case 'shorad':
      dome();
      line(C, B - 6, C, T);
      break;
    case 'sam':
      dome();
      line(C - 10, B - 10, C - 10, T);
      line(C + 10, B - 10, C + 10, T);
      break;
    case 'ew':
      text('EW');
      break;
    case 'missile':
      ctx.beginPath();
      ctx.moveTo(C, T - 8);
      ctx.lineTo(C + 8, T + 6);
      ctx.lineTo(C + 8, B);
      ctx.lineTo(C - 8, B);
      ctx.lineTo(C - 8, T + 6);
      ctx.closePath();
      ctx.fill();
      break;
    case 'fpv':
      uav();
      text('FPV', 18, B - 4);
      break;
    case 'uav':
      uav();
      break;
    case 'loiter':
      uav();
      text('LM', 20, B - 4);
      break;
    case 'ucav':
      uav();
      text('A', 22, B - 4);
      break;
    case 'heli':
      ctx.beginPath();
      ctx.moveTo(L + 10, T + 4);
      ctx.lineTo(R - 10, B - 4);
      ctx.lineTo(R - 10, T + 4);
      ctx.lineTo(L + 10, B - 4);
      ctx.closePath();
      ctx.stroke();
      break;
    case 'fighter':
      text('F', 40);
      break;
    case 'bomber':
      text('B', 40);
      break;
    case 'fac':
    case 'frigate':
      ctx.beginPath();
      ctx.moveTo(L + 6, C - 6);
      ctx.lineTo(R - 6, C - 6);
      ctx.lineTo(R - 18, C + 12);
      ctx.lineTo(L + 18, C + 12);
      ctx.closePath();
      ctx.stroke();
      if (name === 'frigate') text('FF', 18, C - 18);
      break;
    case 'sub':
      text('SS', 32);
      break;
    case 'hq':
      line(C - 10, B, C - 10, T);
      ctx.fillRect(C - 10, T, 30, 16);
      break;
    case 'power':
      ctx.beginPath();
      ctx.moveTo(C + 6, T - 2);
      ctx.lineTo(C - 12, C + 2);
      ctx.lineTo(C + 2, C + 2);
      ctx.lineTo(C - 6, B + 2);
      ctx.lineTo(C + 12, C - 4);
      ctx.lineTo(C - 2, C - 4);
      ctx.closePath();
      ctx.fill();
      break;
    case 'oil':
      ctx.beginPath();
      ctx.moveTo(C, T - 4);
      ctx.quadraticCurveTo(C + 18, C + 4, C, B + 2);
      ctx.quadraticCurveTo(C - 18, C + 4, C, T - 4);
      ctx.fill();
      break;
    case 'refinery':
      for (let i = -1; i <= 1; i++) ctx.fillRect(C + i * 16 - 5, T + (i === 0 ? -4 : 6), 10, B - T + (i === 0 ? 4 : -6));
      break;
    case 'barracks':
    case 'depot':
      text(name === 'barracks' ? 'B' : 'S', 34);
      break;
    case 'factory':
      ctx.beginPath();
      ctx.arc(C, C, 14, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        line(C + Math.cos(a) * 14, C + Math.sin(a) * 14, C + Math.cos(a) * 22, C + Math.sin(a) * 22);
      }
      break;
    case 'dronefac':
      uav();
      break;
    case 'airbase':
      line(L + 10, C, R - 10, C);
      line(C, T - 2, C, B + 2);
      break;
    case 'shipyard':
      text('⚓', 36);
      break;
    case 'research':
      ctx.beginPath();
      ctx.arc(C, C, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 4;
      for (const a of [0, 1.05, 2.1]) {
        ctx.beginPath();
        ctx.ellipse(C, C, 26, 9, a, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    case 'radar':
      ctx.beginPath();
      ctx.arc(C - 10, B - 2, 26, -1.2, -0.1);
      ctx.stroke();
      line(C - 10, B - 2, C + 12, T + 6);
      break;
    case 'bunker':
      ctx.fillRect(C - 22, C - 2, 44, 10);
      break;
    case 'cram':
    case 'laser':
      dome();
      text(name === 'laser' ? 'L' : 'C', 26, C - 8);
      break;
    case 'fob':
      text('FOB', 26);
      break;
    case 'city':
      ctx.beginPath();
      ctx.arc(C, C, 16, 0, Math.PI * 2);
      ctx.fill();
      break;
    default:
      text('?');
  }
}

// ---------------------------------------------------------------------------

/** Flat rings drawn on the ground (selection, team identification). */
export class Rings {
  readonly mesh: THREE.InstancedMesh;
  private capacity: number;
  private dummy = new THREE.Object3D();

  constructor(private parent: THREE.Object3D) {
    this.capacity = 512;
    this.mesh = this.make(this.capacity);
    parent.add(this.mesh);
  }

  private make(n: number) {
    const g = new THREE.RingGeometry(0.86, 1, 40);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, fog: false });
    const mesh = new THREE.InstancedMesh(g, m, n);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    mesh.count = 0;
    return mesh;
  }

  begin() {
    this.mesh.count = 0;
  }

  push(x: number, y: number, z: number, r: number, color: THREE.Color) {
    if (this.mesh.count >= this.capacity) {
      const old = this.mesh;
      this.capacity *= 2;
      const next = this.make(this.capacity);
      for (let i = 0; i < old.count; i++) {
        old.getMatrixAt(i, this.dummy.matrix);
        next.setMatrixAt(i, this.dummy.matrix);
        const col = new THREE.Color();
        old.getColorAt(i, col);
        next.setColorAt(i, col);
      }
      next.count = old.count;
      this.parent.remove(old);
      old.dispose();
      this.parent.add(next);
      (this as { mesh: THREE.InstancedMesh }).mesh = next;
    }
    const i = this.mesh.count++;
    this.dummy.position.set(x, y, z);
    this.dummy.scale.set(r, 1, r);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.mesh.setColorAt(i, color);
  }

  end() {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** Short-lived animated ground markers (move/attack orders, pings). */
export class Markers {
  readonly group = new THREE.Group();
  private items: { mesh: THREE.Mesh; t: number; life: number; r: number }[] = [];
  private geo: THREE.RingGeometry;

  constructor() {
    this.geo = new THREE.RingGeometry(0.7, 1, 32);
    this.geo.rotateX(-Math.PI / 2);
  }

  add(x: number, y: number, z: number, color: number, r: number) {
    const m = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, depthTest: false, toneMapped: false, fog: false }));
    m.position.set(x, y + 0.003, z);
    m.renderOrder = 6;
    this.group.add(m);
    this.items.push({ mesh: m, t: 0, life: 0.6, r });
  }

  update(dt: number) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const k = it.t / it.life;
      if (k >= 1) {
        this.group.remove(it.mesh);
        (it.mesh.material as THREE.Material).dispose();
        this.items.splice(i, 1);
        continue;
      }
      it.mesh.scale.setScalar(it.r * (1.4 - 0.9 * k));
      (it.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - k;
    }
  }
}
