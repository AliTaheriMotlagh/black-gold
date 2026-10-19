/**
 * Map layers: international borders, highways, territory + fog textures, and DOM labels
 * for cities, countries and seas (collision-culled, localized, RTL-aware).
 */
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { World } from '../sim/world';
import type { Terrain } from './terrain/Terrain';
import { VEX } from './Stage';
import { lonLatToWorld } from '../geo/projection';
import { loc, t } from '../i18n';

const SEAS: { name: { en: string; fa: string }; ll: [number, number]; size: number }[] = [
  { name: { en: 'Persian Gulf', fa: 'خلیج فارس' }, ll: [51.4, 27.0], size: 1.1 },
  { name: { en: 'Gulf of Oman', fa: 'دریای عمان' }, ll: [58.6, 24.6], size: 0.85 },
  { name: { en: 'Arabian Sea', fa: 'دریای عرب' }, ll: [61.5, 18.5], size: 1.1 },
  { name: { en: 'Red Sea', fa: 'دریای سرخ' }, ll: [38.2, 20.3], size: 1 },
  { name: { en: 'Gulf of Aden', fa: 'خلیج عدن' }, ll: [48.0, 12.4], size: 0.85 },
  { name: { en: 'Mediterranean Sea', fa: 'دریای مدیترانه' }, ll: [29.5, 33.6], size: 1.2 },
  { name: { en: 'Black Sea', fa: 'دریای سیاه' }, ll: [35.5, 42.4], size: 1.1 },
  { name: { en: 'Caspian Sea', fa: 'دریای خزر' }, ll: [51.0, 40.3], size: 1.05 },
  { name: { en: 'Strait of Hormuz', fa: 'تنگه هرمز' }, ll: [56.4, 26.45], size: 0.6 },
  { name: { en: 'Bab-el-Mandeb', fa: 'باب‌المندب' }, ll: [43.4, 12.6], size: 0.55 },
];

interface Label {
  el: HTMLDivElement;
  x: number;
  z: number;
  y: number;
  priority: number;
  kind: 'city' | 'country' | 'sea';
  minD: number;
  maxD: number;
  idx: number;
  w: number;
  h: number;
  shown: boolean;
  bar?: HTMLDivElement;
}

export class MapLayers {
  readonly group = new THREE.Group();
  private borderMats: LineMaterial[] = [];
  private roadMat: LineMaterial;
  private labels: Label[] = [];
  readonly labelRoot: HTMLDivElement;
  private terrVersion = -1;
  private fogVersion = -1;
  private cityOwners: number[] = [];
  showLabels = true;

  constructor(
    readonly world: World,
    readonly terrain: Terrain,
    readonly local: number,
    container: HTMLElement,
  ) {
    const th = world.theater;
    // Borders
    const pos: number[] = [];
    for (const line of th.meta.borders) {
      for (let i = 2; i < line.length; i += 2) {
        const ax = line[i - 2];
        const az = line[i - 1];
        const bx = line[i];
        const bz = line[i + 1];
        pos.push(ax, Math.max(0, th.heightAt(ax, az)) * VEX + 0.09, az, bx, Math.max(0, th.heightAt(bx, bz)) * VEX + 0.09, bz);
      }
    }
    for (const [width, color, opacity] of [
      [3.2, 0x000000, 0.35],
      [1.3, 0xf3efe2, 0.85],
    ] as [number, number, number][]) {
      const g = new LineSegmentsGeometry();
      g.setPositions(pos);
      const m = new LineMaterial({ color, linewidth: width, transparent: true, opacity, depthTest: true, depthWrite: false, worldUnits: false });
      const l = new LineSegments2(g, m);
      l.frustumCulled = false;
      l.renderOrder = 20;
      this.group.add(l);
      this.borderMats.push(m);
    }
    // Major highways
    const rpos: number[] = [];
    for (const r of th.meta.roads) {
      if (r.t > 0) continue;
      for (let i = 2; i < r.pts.length; i += 2) {
        const ax = r.pts[i - 2];
        const az = r.pts[i - 1];
        const bx = r.pts[i];
        const bz = r.pts[i + 1];
        rpos.push(ax, Math.max(0, th.heightAt(ax, az)) * VEX + 0.06, az, bx, Math.max(0, th.heightAt(bx, bz)) * VEX + 0.06, bz);
      }
    }
    const rg = new LineSegmentsGeometry();
    rg.setPositions(rpos);
    this.roadMat = new LineMaterial({ color: 0xe8c890, linewidth: 1, transparent: true, opacity: 0.35, depthTest: true, depthWrite: false });
    const rl = new LineSegments2(rg, this.roadMat);
    rl.frustumCulled = false;
    rl.renderOrder = 19;
    this.group.add(rl);

    this.labelRoot = document.createElement('div');
    this.labelRoot.className = 'map-labels';
    container.append(this.labelRoot);
    this.buildLabels();
  }

  buildLabels() {
    this.labelRoot.replaceChildren();
    this.labels = [];
    const w = this.world;
    w.cities.forEach((c, i) => {
      const m = w.theater.meta.cities[i];
      const el = document.createElement('div');
      el.className = `mlbl city${c.capital ? ' capital' : ''}`;
      el.innerHTML = `<i class="dot"></i><span class="nm"></span><span class="pop"></span><div class="siege"><b></b></div>`;
      (el.querySelector('.nm') as HTMLElement).textContent = loc(m.name);
      (el.querySelector('.pop') as HTMLElement).textContent = m.pop >= 1e6 ? `${(m.pop / 1e6).toFixed(1)}M` : `${Math.round(m.pop / 1000)}K`;
      this.labelRoot.append(el);
      const pr = c.capital ? 3 : m.pop > 3e6 ? 2 : m.pop > 1e6 ? 1 : 0;
      this.labels.push({ el, x: c.x, z: c.z, y: 0, priority: 10 + pr * 10 + Math.log10(m.pop), kind: 'city', minD: 0, maxD: c.capital ? 4000 : pr >= 1 ? 1500 : 500, idx: i, w: 0, h: 0, shown: false, bar: el.querySelector('.siege b') as HTMLDivElement });
    });
    // Country names at their territory centroid.
    const sums = new Map<number, [number, number, number]>();
    const th = w.theater;
    for (let i = 0; i < th.country.length; i += 3) {
      const c = th.country[i];
      if (!c) continue;
      const s = sums.get(c) ?? [0, 0, 0];
      s[0] += (i % th.w) * th.cell;
      s[1] += Math.floor(i / th.w) * th.cell;
      s[2]++;
      sums.set(c, s);
    }
    for (const co of w.countries) {
      const s = sums.get(co.idx);
      if (!s || s[2] < 40) continue;
      const el = document.createElement('div');
      el.className = 'mlbl country';
      el.textContent = loc(co.meta.name);
      el.style.setProperty('--c', co.meta.color);
      this.labelRoot.append(el);
      this.labels.push({ el, x: s[0] / s[2], z: s[1] / s[2], y: 0, priority: 100 + Math.log10(s[2]), kind: 'country', minD: 260, maxD: 99999, idx: co.idx, w: 0, h: 0, shown: false });
    }
    for (const sea of SEAS) {
      const p = lonLatToWorld(sea.ll[0], sea.ll[1]);
      const el = document.createElement('div');
      el.className = 'mlbl sea';
      el.textContent = loc(sea.name);
      el.style.fontSize = `${sea.size}em`;
      this.labelRoot.append(el);
      this.labels.push({ el, x: p.x, z: p.z, y: 0, priority: 90 + sea.size, kind: 'sea', minD: 120, maxD: 99999, idx: -1, w: 0, h: 0, shown: false });
    }
    this.labels.sort((a, b) => b.priority - a.priority);
  }

  /** Recompute the territory texture when cities change hands. */
  private updateTerritory() {
    const w = this.world;
    let changed = this.terrVersion < 0;
    w.cities.forEach((c, i) => {
      if (this.cityOwners[i] !== c.owner) {
        changed = true;
        this.cityOwners[i] = c.owner;
      }
    });
    if (!changed) return;
    this.terrVersion++;
    const th = w.theater;
    const data = this.terrain.territoryTex.image.data as Uint8Array;
    const cols = w.countries.map((c) => new THREE.Color(c.meta.color));
    for (let i = 0; i < th.w * th.h; i++) {
      const o = i * 4;
      if (th.water[i]) {
        data[o + 3] = 0;
        continue;
      }
      const r = th.region[i];
      const owner = r >= 0 ? w.cities[r].owner : th.country[i];
      if (!owner) {
        data[o + 3] = 1; // unclaimed land (0 is reserved for sea)
        continue;
      }
      const c = cols[owner];
      data[o] = c.r * 255;
      data[o + 1] = c.g * 255;
      data[o + 2] = c.b * 255;
      data[o + 3] = owner === th.country[i] ? 255 : 128;
    }
    this.terrain.territoryTex.needsUpdate = true;
  }

  private updateFog() {
    const v = this.world.vision;
    if (v.version === this.fogVersion) return;
    this.fogVersion = v.version;
    const data = this.terrain.fogTex.image.data as Uint8Array;
    if (!v.enabled) {
      data.fill(255);
      this.terrain.fogTex.needsUpdate = true;
      return;
    }
    const slots = v.sharedSlots(this.local);
    if (!slots.length) return;
    const n = data.length;
    const vis = slots.map((s) => v.vis[s]);
    const exp = slots.map((s) => v.explored[s]);
    for (let i = 0; i < n; i++) {
      let val = 0;
      for (let k = 0; k < vis.length; k++) {
        if (vis[k][i]) {
          val = 255;
          break;
        }
        if (exp[k][i]) val = 150;
      }
      // Ease toward the target so fog edges soften over time.
      data[i] = val;
    }
    this.terrain.fogTex.needsUpdate = true;
  }

  update(camera: THREE.PerspectiveCamera, camDist: number, viewW: number, viewH: number) {
    this.updateTerritory();
    this.updateFog();
    const res = new THREE.Vector2(viewW, viewH);
    const bAlpha = THREE.MathUtils.clamp((camDist - 4) / 40, 0.15, 1);
    for (const m of this.borderMats) {
      m.resolution.copy(res);
      m.opacity = (m.color.getHex() === 0 ? 0.35 : 0.85) * bAlpha;
    }
    this.roadMat.resolution.copy(res);
    this.roadMat.opacity = THREE.MathUtils.clamp(1 - Math.abs(Math.log(camDist / 160)) / 1.4, 0, 0.22);
    this.layoutLabels(camera, camDist, viewW, viewH);
  }

  private layoutLabels(camera: THREE.PerspectiveCamera, camDist: number, viewW: number, viewH: number) {
    const v = new THREE.Vector3();
    const placed: [number, number, number, number][] = [];
    const w = this.world;
    for (const l of this.labels) {
      let show = this.showLabels && camDist >= l.minD && camDist <= l.maxD;
      if (show && l.kind === 'city' && !w.vision.isExplored(this.local, l.x, l.z)) show = false;
      if (show) {
        if (!l.y) l.y = this.terrain.surfaceAt(l.x, l.z) + 0.02;
        v.set(l.x, l.y, l.z).project(camera);
        if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) show = false;
      }
      if (show) {
        const sx = (v.x * 0.5 + 0.5) * viewW;
        const sy = (-v.y * 0.5 + 0.5) * viewH;
        if (!l.w) {
          l.el.style.display = 'block';
          l.w = l.el.offsetWidth || 80;
          l.h = l.el.offsetHeight || 16;
        }
        const box: [number, number, number, number] = [sx - l.w / 2, sy - l.h / 2, sx + l.w / 2, sy + l.h / 2];
        if (placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) show = false;
        else {
          placed.push(box);
          l.el.style.transform = `translate3d(${(sx - l.w / 2) | 0}px, ${(sy - l.h / 2) | 0}px, 0)`;
          if (l.kind === 'country') l.el.style.opacity = String(THREE.MathUtils.clamp((camDist - l.minD) / 300, 0, 0.9));
          if (l.kind === 'city') this.cityState(l);
        }
      }
      if (show !== l.shown) {
        l.shown = show;
        l.el.style.display = show ? 'block' : 'none';
      }
    }
  }

  private cityState(l: Label) {
    const c = this.world.cities[l.idx];
    const owner = this.world.countries[c.owner];
    l.el.style.setProperty('--c', owner?.meta.color ?? '#999');
    const siege = c.garrison < c.maxGarrison * 0.98 || c.capture > 0;
    l.el.classList.toggle('sieged', siege);
    if (siege && l.bar) l.bar.style.width = `${c.capture > 0 ? c.capture * 100 : (c.garrison / c.maxGarrison) * 100}%`;
    l.el.classList.toggle('capturing', c.capture > 0);
    l.el.title = `${loc(this.world.theater.meta.cities[l.idx].name)} — ${t('hud.garrison')} ${Math.round((c.garrison / c.maxGarrison) * 100)}%`;
  }

  dispose() {
    this.labelRoot.remove();
  }
}
