import * as THREE from 'three';

export const FONT_STACK = '"Vazirmatn", "Rajdhani", system-ui, sans-serif';

interface TextOpts {
  size?: number; // px font size on canvas
  color?: string;
  stroke?: string;
  weight?: number;
  italic?: boolean;
  letterSpacing?: number;
}

function drawText(text: string, o: TextOpts): HTMLCanvasElement {
  const size = o.size ?? 48;
  const font = `${o.italic ? 'italic ' : ''}${o.weight ?? 700} ${size}px ${FONT_STACK}`;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width + size * 0.8);
  const h = Math.ceil(size * 1.6);
  c.width = w;
  c.height = h;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.direction = /[؀-ۿ]/.test(text) ? 'rtl' : 'ltr';
  if (o.stroke) {
    ctx.lineWidth = size * 0.16;
    ctx.strokeStyle = o.stroke;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, w / 2, h / 2);
  }
  ctx.fillStyle = o.color ?? '#fff';
  ctx.fillText(text, w / 2, h / 2);
  return c;
}

/** Billboard text that always faces the camera. `worldHeight` is the label height in world units. */
export function textSprite(text: string, worldHeight: number, o: TextOpts = {}): THREE.Sprite {
  const canvas = drawText(text, o);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
  const s = new THREE.Sprite(m);
  s.scale.set((worldHeight * canvas.width) / canvas.height, worldHeight, 1);
  s.renderOrder = 5;
  return s;
}

/** Flat text lying on the ground/water plane (map-style lettering). */
export function groundText(text: string, worldHeight: number, o: TextOpts = {}): THREE.Mesh {
  const canvas = drawText(text, o);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.75 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry((worldHeight * canvas.width) / canvas.height, worldHeight), m);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 2;
  return mesh;
}

export function disposeObject(o: THREE.Object3D) {
  o.traverse((c) => {
    const anyC = c as THREE.Mesh;
    if (anyC.geometry && !(anyC.geometry as { __shared?: boolean }).__shared) anyC.geometry.dispose?.();
    const m = anyC.material as THREE.Material | THREE.Material[] | undefined;
    const mats = Array.isArray(m) ? m : m ? [m] : [];
    for (const mm of mats) {
      const map = (mm as THREE.MeshBasicMaterial).map;
      if (map) map.dispose();
      if ((mm as { __shared?: boolean }).__shared) continue;
      mm.dispose();
    }
  });
}
