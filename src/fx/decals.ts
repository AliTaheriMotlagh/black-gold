import * as THREE from 'three';

/** Scorch marks, command markers, shockwaves and tracer lines. */
export class Decals {
  readonly group = new THREE.Group();
  private scorches: { mesh: THREE.Mesh; life: number }[] = [];
  private scorchIdx = 0;
  private markers: { mesh: THREE.Mesh; life: number; max: number }[] = [];
  private waves: { mesh: THREE.Mesh; life: number; max: number; size: number }[] = [];
  private tracerGeo: THREE.BufferGeometry;
  private tracerPos: Float32Array;
  private tracerLife: Float32Array;
  private tracerIdx = 0;
  private readonly MAX_TRACERS = 160;
  private lights: { light: THREE.PointLight; life: number }[] = [];

  constructor() {
    const scorchTex = makeRadialTexture([
      [0, 'rgba(10,8,6,0.85)'],
      [0.5, 'rgba(25,18,12,0.55)'],
      [1, 'rgba(30,20,10,0)'],
    ]);
    const scorchMat = new THREE.MeshBasicMaterial({ map: scorchTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 48; i++) {
      const m = new THREE.Mesh(geo, scorchMat.clone());
      m.visible = false;
      m.renderOrder = 1;
      this.group.add(m);
      this.scorches.push({ mesh: m, life: 0 });
    }

    this.tracerPos = new Float32Array(this.MAX_TRACERS * 6);
    this.tracerLife = new Float32Array(this.MAX_TRACERS);
    this.tracerGeo = new THREE.BufferGeometry();
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    const tracers = new THREE.LineSegments(
      this.tracerGeo,
      new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    tracers.frustumCulled = false;
    tracers.renderOrder = 8;
    this.group.add(tracers);

    for (let i = 0; i < 3; i++) {
      const light = new THREE.PointLight(0xffa040, 0, 30, 1.6);
      this.group.add(light);
      this.lights.push({ light, life: 0 });
    }
  }

  scorch(x: number, y: number, z: number, size: number) {
    const s = this.scorches[this.scorchIdx];
    this.scorchIdx = (this.scorchIdx + 1) % this.scorches.length;
    s.mesh.position.set(x, y + 0.08, z);
    s.mesh.scale.setScalar(size);
    s.mesh.rotation.y = Math.random() * Math.PI * 2;
    s.mesh.visible = true;
    (s.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
    s.life = 40;
  }

  marker(x: number, y: number, z: number, color: number) {
    const geo = new THREE.RingGeometry(0.75, 1, 32);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, depthTest: false }));
    mesh.position.set(x, y + 0.2, z);
    mesh.renderOrder = 9;
    this.group.add(mesh);
    this.markers.push({ mesh, life: 0.6, max: 0.6 });
  }

  shockwave(x: number, y: number, z: number, size: number) {
    const geo = new THREE.RingGeometry(0.85, 1, 48);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    mesh.position.set(x, y + 0.5, z);
    mesh.renderOrder = 9;
    this.group.add(mesh);
    this.waves.push({ mesh, life: 1.2, max: 1.2, size });
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3) {
    const i = this.tracerIdx;
    this.tracerIdx = (this.tracerIdx + 1) % this.MAX_TRACERS;
    // Short streak near the target end for a "bullet" look
    const t0 = 0.55 + Math.random() * 0.3;
    this.tracerPos[i * 6] = from.x + (to.x - from.x) * t0;
    this.tracerPos[i * 6 + 1] = from.y + (to.y - from.y) * t0;
    this.tracerPos[i * 6 + 2] = from.z + (to.z - from.z) * t0;
    this.tracerPos[i * 6 + 3] = to.x;
    this.tracerPos[i * 6 + 4] = to.y;
    this.tracerPos[i * 6 + 5] = to.z;
    this.tracerLife[i] = 0.06;
  }

  flash(p: THREE.Vector3, intensity: number) {
    let best = this.lights[0];
    for (const l of this.lights) if (l.life < best.life) best = l;
    best.light.position.set(p.x, p.y + 2, p.z);
    best.light.intensity = intensity;
    best.life = 0.25;
  }

  update(dt: number) {
    for (const s of this.scorches) {
      if (!s.mesh.visible) continue;
      s.life -= dt;
      if (s.life <= 0) s.mesh.visible = false;
      else if (s.life < 8) (s.mesh.material as THREE.MeshBasicMaterial).opacity = s.life / 8;
    }
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      m.life -= dt;
      const t = 1 - m.life / m.max;
      m.mesh.scale.setScalar(1.6 - t * 1.1);
      (m.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - t;
      if (m.life <= 0) {
        this.group.remove(m.mesh);
        m.mesh.geometry.dispose();
        (m.mesh.material as THREE.Material).dispose();
        this.markers.splice(i, 1);
      }
    }
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.life -= dt;
      const t = 1 - w.life / w.max;
      w.mesh.scale.setScalar(1 + t * w.size);
      (w.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.8;
      if (w.life <= 0) {
        this.group.remove(w.mesh);
        w.mesh.geometry.dispose();
        (w.mesh.material as THREE.Material).dispose();
        this.waves.splice(i, 1);
      }
    }
    let dirty = false;
    for (let i = 0; i < this.MAX_TRACERS; i++) {
      if (this.tracerLife[i] <= 0) continue;
      this.tracerLife[i] -= dt;
      dirty = true;
      if (this.tracerLife[i] <= 0) for (let k = 0; k < 6; k++) this.tracerPos[i * 6 + k] = 0;
    }
    if (dirty) (this.tracerGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    for (const l of this.lights) {
      if (l.life <= 0) continue;
      l.life -= dt;
      l.light.intensity *= 0.82;
      if (l.life <= 0) l.light.intensity = 0;
    }
  }
}

export function makeRadialTexture(stops: [number, string][], size = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
