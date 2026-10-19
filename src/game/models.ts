import * as THREE from 'three';
import type { BuildingKind, UnitKind } from './config';
import { BUILDINGS } from './config';
import { CELL } from '../geo/geography';
import { rng } from '../world/noise';

/**
 * Procedural, low-poly stylised 3D models. Every model faces +Z.
 * Rigs expose animated parts so the game can drive turrets, recoil, rotors, etc.
 */
export interface ModelRig {
  root: THREE.Group;
  body: THREE.Group;
  turret?: THREE.Object3D;
  barrel?: THREE.Object3D;
  muzzle?: THREE.Object3D;
  launcher?: THREE.Object3D;
  rotors: { obj: THREE.Object3D; axis: 'x' | 'y' | 'z'; speed: number }[];
  wheels: THREE.Object3D[];
  legs: THREE.Object3D[];
  beam?: THREE.Object3D;
  dishes: THREE.Object3D[];
  doors: THREE.Object3D[];
  missile?: THREE.Object3D;
  flag?: THREE.Object3D;
  blinkers: THREE.Mesh[];
  emitters: { obj: THREE.Object3D; kind: 'steam' | 'smoke' | 'flare' }[];
  teamMaterial: THREE.MeshStandardMaterial;
}

// ---------------------------------------------------------------------------
// Shared resources

const PAL = {
  sand: 0xc9b48a,
  camo: 0xb19c6f,
  camoDark: 0x8a7a55,
  olive: 0x6f6b45,
  dark: 0x2a2826,
  tire: 0x1b1a19,
  metal: 0x7b8085,
  steel: 0xa9adb1,
  concrete: 0xb8b0a1,
  concreteDark: 0x8f877a,
  beige: 0xd8c8a4,
  white: 0xe9e4d8,
  glass: 0x24313c,
  skin: 0xb98a68,
  turquoise: 0x2aa3a0,
  gold: 0xd4a537,
  asphalt: 0x3a3836,
  rust: 0x8a5a3c,
  black: 0x0b0a09,
  canvas: 0x9c916a,
};

const matCache = new Map<string, THREE.MeshStandardMaterial>();
export function mat(color: number, rough = 0.85, metal = 0.05, emissive = 0): THREE.MeshStandardMaterial {
  const key = `${color}|${rough}|${metal}|${emissive}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, flatShading: true });
    if (emissive) {
      m.emissive = new THREE.Color(color);
      m.emissiveIntensity = emissive;
    }
    matCache.set(key, m);
  }
  return m;
}

export function teamMat(color: number): THREE.MeshStandardMaterial {
  return mat(color, 0.55, 0.25);
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined;
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}
const BOX = () => cached('box', () => new THREE.BoxGeometry(1, 1, 1));
const CYL = (rt = 1, rb = 1, seg = 12) => cached(`cyl${rt}|${rb}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, 1, seg));
const SPH = (seg = 12) => cached(`sph${seg}`, () => new THREE.SphereGeometry(1, seg, Math.max(6, seg * 0.66)));
const HEMI = () => cached('hemi', () => new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2));
const CONE = (seg = 12) => cached(`cone${seg}`, () => new THREE.ConeGeometry(1, 1, seg));

function add(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  sx = 1,
  sy = 1,
  sz = 1,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
const box = (p: THREE.Object3D, m: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) =>
  add(p, BOX(), m, x, y, z, sx, sy, sz);

/** Cylinder lying along the Z axis. */
function tubeZ(p: THREE.Object3D, m: THREE.Material, x: number, y: number, z: number, r: number, len: number, rt = 1, seg = 10) {
  const mesh = add(p, CYL(rt, 1, seg), m, x, y, z, r, len, r);
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}
/** Cylinder lying along the X axis (wheels). */
function tubeX(p: THREE.Object3D, m: THREE.Material, x: number, y: number, z: number, r: number, len: number, seg = 12) {
  const mesh = add(p, CYL(1, 1, seg), m, x, y, z, r, len, r);
  mesh.rotation.z = Math.PI / 2;
  return mesh;
}
const cylY = (p: THREE.Object3D, m: THREE.Material, x: number, y: number, z: number, r: number, h: number, rt = 1, seg = 12) =>
  add(p, CYL(rt, 1, seg), m, x, y, z, r, h, r);

function newRig(color: number): ModelRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  return {
    root,
    body,
    rotors: [],
    wheels: [],
    legs: [],
    dishes: [],
    doors: [],
    blinkers: [],
    emitters: [],
    teamMaterial: teamMat(color),
  };
}

function marker(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

function flag(parent: THREE.Object3D, rig: ModelRig, x: number, z: number, height: number) {
  cylY(parent, mat(PAL.steel, 0.4, 0.6), x, height / 2, z, 0.05, height);
  const pivot = new THREE.Group();
  pivot.position.set(x, height - 0.35, z);
  const f = add(pivot, BOX(), rig.teamMaterial, 0, 0, 0.45, 0.03, 0.5, 0.85);
  f.castShadow = false;
  parent.add(pivot);
  rig.flag = pivot;
}

// ---------------------------------------------------------------------------
// Units

function infantry(rig: ModelRig, rpg: boolean) {
  const b = rig.body;
  const camo = mat(PAL.camo);
  const dark = mat(PAL.dark);
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.09, 0.46, 0);
    box(hip, mat(PAL.camoDark), 0, -0.22, 0, 0.13, 0.44, 0.15);
    box(hip, dark, 0, -0.43, 0.03, 0.14, 0.07, 0.2);
    b.add(hip);
    rig.legs.push(hip);
  }
  box(b, camo, 0, 0.66, 0, 0.34, 0.4, 0.2);
  box(b, rig.teamMaterial, 0, 0.66, 0.01, 0.36, 0.24, 0.23);
  box(b, mat(PAL.camoDark), 0, 0.7, -0.14, 0.26, 0.28, 0.1); // pack
  add(b, SPH(10), mat(PAL.skin), 0, 0.95, 0.02, 0.1, 0.11, 0.1);
  add(b, HEMI(), mat(PAL.olive), 0, 0.97, 0.01, 0.125, 0.11, 0.13);
  for (const side of [-1, 1]) {
    const arm = box(b, camo, side * 0.21, 0.66, 0.12, 0.09, 0.09, 0.32);
    arm.rotation.y = -side * 0.25;
  }
  if (rpg) {
    tubeZ(b, mat(PAL.olive), 0.16, 0.9, 0.05, 0.065, 0.95);
    const warhead = add(b, CONE(8), mat(PAL.olive), 0.16, 0.9, 0.62, 0.1, 0.25, 0.1);
    warhead.rotation.x = Math.PI / 2;
    rig.muzzle = marker(b, 0.16, 0.9, 0.75);
  } else {
    box(b, dark, 0.06, 0.72, 0.3, 0.06, 0.08, 0.55);
    box(b, dark, 0.06, 0.64, 0.25, 0.05, 0.14, 0.06);
    rig.muzzle = marker(b, 0.06, 0.73, 0.6);
  }
  rig.root.scale.setScalar(1.15);
}

function wheels(rig: ModelRig, xs: number, zs: number[], r: number, y = r) {
  const tire = mat(PAL.tire, 0.95);
  const hub = mat(PAL.metal, 0.5, 0.5);
  for (const z of zs) {
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(s * xs, y, z);
      tubeX(g, tire, 0, 0, 0, r, 0.2);
      tubeX(g, hub, s * 0.02, 0, 0, r * 0.5, 0.21, 8);
      rig.body.add(g);
      rig.wheels.push(g);
    }
  }
}

function technical(rig: ModelRig) {
  const b = rig.body;
  const paint = mat(PAL.white, 0.6, 0.2);
  box(b, mat(PAL.dark), 0, 0.42, 0, 0.9, 0.12, 2.0);
  box(b, paint, 0, 0.62, 0.65, 1.0, 0.3, 0.7); // hood
  box(b, paint, 0, 0.9, 0.05, 0.98, 0.5, 0.65); // cab
  const ws = box(b, mat(PAL.glass, 0.2, 0.6), 0, 0.98, 0.38, 0.9, 0.32, 0.04);
  ws.rotation.x = -0.35;
  box(b, rig.teamMaterial, 0, 0.72, 0.05, 1.02, 0.1, 0.66);
  box(b, paint, 0, 0.62, -0.6, 1.0, 0.3, 0.95); // bed
  box(b, paint, -0.48, 0.85, -0.6, 0.05, 0.2, 0.95);
  box(b, paint, 0.48, 0.85, -0.6, 0.05, 0.2, 0.95);
  box(b, paint, 0, 0.85, -1.07, 1.0, 0.2, 0.05);
  box(b, mat(PAL.dark), 0, 0.55, 1.02, 0.95, 0.15, 0.05); // bumper
  wheels(rig, 0.48, [0.6, -0.65], 0.24);
  const turret = new THREE.Group();
  turret.position.set(0, 0.8, -0.55);
  cylY(turret, mat(PAL.dark), 0, 0.25, 0, 0.06, 0.5);
  const gun = new THREE.Group();
  gun.position.set(0, 0.5, 0);
  box(gun, mat(PAL.dark, 0.5, 0.6), 0, 0, 0.1, 0.14, 0.14, 0.4);
  tubeZ(gun, mat(PAL.dark, 0.4, 0.7), 0, 0.02, 0.55, 0.035, 0.7);
  box(gun, rig.teamMaterial, 0, 0.08, 0.15, 0.46, 0.26, 0.04);
  turret.add(gun);
  b.add(turret);
  rig.turret = turret;
  rig.barrel = gun;
  rig.muzzle = marker(gun, 0, 0.02, 0.92);
}

function tank(rig: ModelRig) {
  const b = rig.body;
  const camo = mat(PAL.camo, 0.8, 0.15);
  const dark = mat(PAL.tire, 0.95);
  for (const s of [-1, 1]) {
    box(b, dark, s * 0.62, 0.3, 0, 0.36, 0.5, 2.3);
    for (let i = 0; i < 5; i++) tubeX(b, mat(PAL.metal, 0.6, 0.4), s * 0.62, 0.22, -0.85 + i * 0.425, 0.17, 0.38, 10);
    box(b, rig.teamMaterial, s * 0.82, 0.55, 0, 0.06, 0.16, 2.0);
  }
  box(b, camo, 0, 0.58, -0.05, 1.15, 0.42, 2.0);
  const glacis = box(b, camo, 0, 0.55, 1.05, 1.15, 0.22, 0.45);
  glacis.rotation.x = 0.55;
  box(b, mat(PAL.camoDark), 0, 0.82, -0.9, 0.9, 0.12, 0.3);
  const turret = new THREE.Group();
  turret.position.set(0, 0.79, -0.12);
  box(turret, camo, 0, 0.17, 0, 0.92, 0.34, 1.15);
  const wedge = box(turret, camo, 0, 0.15, 0.6, 0.86, 0.28, 0.3);
  wedge.rotation.x = -0.3;
  box(turret, rig.teamMaterial, 0, 0.3, -0.05, 0.94, 0.06, 1.17);
  cylY(turret, mat(PAL.camoDark), 0.24, 0.4, -0.15, 0.14, 0.12);
  box(turret, mat(PAL.camoDark), 0, 0.2, -0.65, 0.8, 0.24, 0.2); // bustle rack
  const barrel = new THREE.Group();
  barrel.position.set(0, 0.17, 0.62);
  box(barrel, mat(PAL.camoDark), 0, 0, 0.05, 0.3, 0.2, 0.2);
  tubeZ(barrel, mat(PAL.camoDark, 0.6, 0.3), 0, 0, 0.82, 0.06, 1.5);
  tubeZ(barrel, mat(PAL.dark), 0, 0, 1.55, 0.085, 0.16);
  turret.add(barrel);
  b.add(turret);
  rig.turret = turret;
  rig.barrel = barrel;
  rig.muzzle = marker(barrel, 0, 0, 1.68);
  rig.root.scale.setScalar(1.05);
}

function truckBase(rig: ModelRig, paint: THREE.Material) {
  const b = rig.body;
  box(b, mat(PAL.dark), 0, 0.5, -0.1, 0.95, 0.18, 2.6);
  box(b, paint, 0, 0.92, 0.95, 1.05, 0.65, 0.75);
  box(b, mat(PAL.glass, 0.2, 0.6), 0, 1.05, 1.33, 0.95, 0.3, 0.03);
  box(b, rig.teamMaterial, 0, 0.78, 0.95, 1.07, 0.12, 0.77);
  box(b, paint, 0, 0.66, -0.45, 1.05, 0.15, 1.75);
  wheels(rig, 0.5, [0.9, -0.25, -0.95], 0.27);
}

function rocket(rig: ModelRig) {
  const paint = mat(PAL.olive, 0.8, 0.15);
  truckBase(rig, paint);
  const turret = new THREE.Group();
  turret.position.set(0, 0.8, -0.45);
  cylY(turret, mat(PAL.dark), 0, 0.08, 0, 0.35, 0.16);
  const launcher = new THREE.Group();
  launcher.position.set(0, 0.25, -0.35);
  box(launcher, paint, 0, 0.25, 0.35, 0.95, 0.52, 1.5);
  box(launcher, rig.teamMaterial, 0, 0.52, 0.35, 0.97, 0.06, 1.52);
  const tubeMat = mat(PAL.black);
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) tubeZ(launcher, tubeMat, -0.33 + c * 0.22, 0.13 + r * 0.24, 1.1, 0.08, 0.04);
  turret.add(launcher);
  rig.body.add(turret);
  rig.turret = turret;
  rig.launcher = launcher;
  rig.muzzle = marker(launcher, 0, 0.25, 1.15);
}

function samTruck(rig: ModelRig) {
  const paint = mat(PAL.camo, 0.8, 0.15);
  truckBase(rig, paint);
  const turret = new THREE.Group();
  turret.position.set(0, 0.8, -0.5);
  cylY(turret, mat(PAL.dark), 0, 0.1, 0, 0.32, 0.2);
  const launcher = new THREE.Group();
  launcher.position.set(0, 0.35, -0.2);
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 2; c++) {
      tubeZ(launcher, paint, -0.2 + c * 0.4, 0.1 + r * 0.3, 0.4, 0.13, 1.3);
      tubeZ(launcher, rig.teamMaterial, -0.2 + c * 0.4, 0.1 + r * 0.3, 1.06, 0.135, 0.06);
    }
  launcher.rotation.x = -0.45;
  turret.add(launcher);
  rig.body.add(turret);
  rig.turret = turret;
  rig.launcher = launcher;
  rig.muzzle = marker(launcher, 0, 0.25, 1.1);
  const dish = new THREE.Group();
  dish.position.set(0, 1.4, 0.65);
  const d = add(dish, HEMI(), mat(PAL.steel, 0.4, 0.6), 0, 0, 0.0, 0.32, 0.08, 0.32);
  d.rotation.x = Math.PI / 2;
  cylY(rig.body, mat(PAL.dark), 0, 1.3, 0.65, 0.04, 0.25);
  rig.body.add(dish);
  rig.dishes.push(dish);
}

function heli(rig: ModelRig) {
  const b = rig.body;
  const paint = mat(PAL.olive, 0.7, 0.2);
  add(b, SPH(14), paint, 0, 0, 0.1, 0.55, 0.52, 1.05);
  add(b, SPH(12), mat(PAL.glass, 0.15, 0.7), 0, 0.12, 0.75, 0.38, 0.33, 0.5);
  tubeZ(b, paint, 0, 0.12, -1.35, 0.13, 1.7, 0.55);
  box(b, rig.teamMaterial, 0, 0.45, -2.1, 0.06, 0.55, 0.4);
  box(b, paint, 0, 0.15, -2.05, 0.9, 0.05, 0.25);
  box(b, rig.teamMaterial, 0, 0.0, 0.1, 1.12, 0.12, 0.8);
  box(b, paint, 0, -0.08, -0.05, 1.7, 0.05, 0.32); // stub wings
  for (const s of [-1, 1]) {
    tubeZ(b, mat(PAL.dark), s * 0.8, -0.18, 0, 0.1, 0.65);
    box(b, mat(PAL.dark), s * 0.38, -0.62, 0.1, 0.05, 0.05, 1.5); // skids
    box(b, mat(PAL.dark), s * 0.38, -0.45, 0.4, 0.04, 0.3, 0.04);
    box(b, mat(PAL.dark), s * 0.38, -0.45, -0.3, 0.04, 0.3, 0.04);
  }
  const rotor = new THREE.Group();
  rotor.position.set(0, 0.6, 0.05);
  cylY(rotor, mat(PAL.dark), 0, 0, 0, 0.12, 0.18);
  for (let i = 0; i < 4; i++) {
    const blade = box(rotor, mat(PAL.dark, 0.6), 0, 0.06, 0, 0.16, 0.025, 4.0);
    blade.rotation.y = (i * Math.PI) / 4;
    blade.castShadow = true;
  }
  b.add(rotor);
  rig.rotors.push({ obj: rotor, axis: 'y', speed: 28 });
  const tail = new THREE.Group();
  tail.position.set(0.1, 0.4, -2.15);
  box(tail, mat(PAL.dark), 0, 0, 0, 0.03, 0.9, 0.1);
  box(tail, mat(PAL.dark), 0, 0, 0, 0.03, 0.1, 0.9);
  b.add(tail);
  rig.rotors.push({ obj: tail, axis: 'x', speed: 40 });
  rig.muzzle = marker(b, 0, -0.18, 0.5);
}

function drone(rig: ModelRig) {
  const b = rig.body;
  const paint = mat(PAL.white, 0.5, 0.3);
  tubeZ(b, paint, 0, 0, 0, 0.17, 1.7, 0.7);
  add(b, SPH(10), paint, 0, 0.03, 0.85, 0.17, 0.2, 0.3);
  box(b, paint, 0, 0.05, 0.05, 3.0, 0.04, 0.32);
  box(b, rig.teamMaterial, 1.45, 0.06, 0.05, 0.14, 0.05, 0.33);
  box(b, rig.teamMaterial, -1.45, 0.06, 0.05, 0.14, 0.05, 0.33);
  for (const s of [-1, 1]) {
    const tailFin = box(b, paint, s * 0.25, 0.18, -0.75, 0.6, 0.03, 0.22);
    tailFin.rotation.z = s * 0.6;
  }
  tubeZ(b, mat(PAL.dark), 0, -0.2, 0.2, 0.05, 0.45);
  const prop = new THREE.Group();
  prop.position.set(0, 0, -0.9);
  box(prop, mat(PAL.dark), 0, 0, 0, 0.7, 0.06, 0.03);
  b.add(prop);
  rig.rotors.push({ obj: prop, axis: 'z', speed: 50 });
  rig.muzzle = marker(b, 0, -0.22, 0.45);
}

export function createUnitModel(kind: UnitKind, color: number): ModelRig {
  const rig = newRig(color);
  switch (kind) {
    case 'rifleman':
      infantry(rig, false);
      break;
    case 'rpg':
      infantry(rig, true);
      break;
    case 'technical':
      technical(rig);
      break;
    case 'tank':
      tank(rig);
      break;
    case 'rocket':
      rocket(rig);
      break;
    case 'sam':
      samTruck(rig);
      break;
    case 'heli':
      heli(rig);
      break;
    case 'drone':
      drone(rig);
      break;
  }
  // Slightly heroic scale so units stay readable on small screens.
  rig.root.scale.multiplyScalar(1.25);
  return rig;
}

// ---------------------------------------------------------------------------
// Buildings

function pad(rig: ModelRig, size: number, color = PAL.concrete, h = 0.35) {
  const s = size * CELL;
  box(rig.body, mat(color), 0, h / 2 - 0.05, 0, s - 0.2, h, s - 0.2);
}

function hq(rig: ModelRig) {
  const b = rig.body;
  pad(rig, 4);
  const wall = mat(PAL.beige);
  box(b, wall, 0, 1.35, -0.6, 6.2, 2.1, 4.6);
  box(b, rig.teamMaterial, 0, 2.45, -0.6, 6.3, 0.15, 4.7);
  // Iwan-style portal
  box(b, wall, 0, 1.8, 1.9, 2.6, 3.0, 0.6);
  box(b, mat(PAL.turquoise, 0.4, 0.2), 0, 1.6, 2.22, 1.5, 2.2, 0.06);
  box(b, mat(PAL.dark), 0, 1.0, 2.24, 0.9, 1.4, 0.05);
  for (const x of [-2.6, -1.6, 1.6, 2.6]) cylY(b, wall, x, 1.1, 2.2, 0.16, 1.8);
  box(b, wall, 0, 2.05, 2.25, 6.0, 0.15, 0.7);
  // Dome
  cylY(b, wall, 0, 2.85, -0.8, 1.45, 0.8, 1, 16);
  add(b, HEMI(), mat(PAL.turquoise, 0.35, 0.3), 0, 3.25, -0.8, 1.5, 1.6, 1.5);
  cylY(b, mat(PAL.gold, 0.3, 0.8), 0, 4.95, -0.8, 0.06, 0.5);
  // Comm tower with radar
  const steel = mat(PAL.steel, 0.4, 0.7);
  cylY(b, steel, 2.9, 3.0, -2.9, 0.12, 6.0, 0.6);
  const dish = new THREE.Group();
  dish.position.set(2.9, 6.1, -2.9);
  const d = add(dish, HEMI(), mat(PAL.white, 0.4, 0.4), 0, 0, 0.1, 0.8, 0.25, 0.8);
  d.rotation.x = Math.PI / 2;
  b.add(dish);
  rig.dishes.push(dish);
  const light = add(b, SPH(6), mat(0xff3322, 0.5, 0, 2), 2.9, 6.5, -2.9, 0.1, 0.1, 0.1);
  rig.blinkers.push(light);
  flag(b, rig, -3.3, 3.2, 4.2);
  // Sandbag-ish barriers
  for (const x of [-3.5, 3.5]) box(b, mat(PAL.canvas), x, 0.55, 2.2, 0.6, 0.4, 2.6);
}

function power(rig: ModelRig) {
  const b = rig.body;
  pad(rig, 3);
  box(b, mat(PAL.concrete), -0.9, 1.0, 1.2, 3.4, 1.7, 2.6);
  box(b, rig.teamMaterial, -0.9, 1.9, 1.2, 3.5, 0.12, 2.7);
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const y = i / 10;
    pts.push(new THREE.Vector2(1.0 - 0.45 * Math.sin(y * Math.PI * 0.85) + 0.1 * y, y * 3.6));
  }
  const towerGeo = cached('coolingTower', () => new THREE.LatheGeometry(pts, 20));
  for (const [x, z] of [[1.55, -1.45], [-1.2, -1.6]] as const) {
    const t = add(b, towerGeo, mat(PAL.white, 0.9), x, 0.2, z);
    t.material = mat(PAL.white, 0.9);
    rig.emitters.push({ obj: marker(b, x, 3.9, z), kind: 'steam' });
  }
  for (const x of [1.5, 2.3]) box(b, mat(PAL.metal, 0.5, 0.5), x, 0.6, 1.5, 0.6, 0.8, 0.6);
  const glow = add(b, BOX(), mat(0x66ccff, 0.4, 0, 1.6), -0.9, 1.2, 2.52, 2.6, 0.12, 0.04);
  glow.castShadow = false;
}

function barracks(rig: ModelRig) {
  const b = rig.body;
  pad(rig, 3, PAL.concreteDark, 0.25);
  const roofGeo = cached('gable', () => {
    const g = new THREE.CylinderGeometry(1, 1, 1, 3);
    g.rotateZ(Math.PI / 2);
    g.rotateX(-Math.PI / 2); // apex up, base at y = -0.5
    return g;
  });
  for (const z of [-1.3, 1.0]) {
    box(b, mat(PAL.canvas), 0, 0.7, z, 4.8, 0.9, 1.7);
    add(b, roofGeo, mat(PAL.olive), 0, 1.45, z, 4.9, 0.6, 1.0);
    box(b, rig.teamMaterial, 2.42, 0.7, z, 0.06, 0.5, 0.8);
  }
  for (let i = 0; i < 6; i++) box(b, mat(PAL.canvas), -2.5 + i * 1.0, 0.35, 2.55, 0.9, 0.35, 0.4);
  cylY(b, mat(PAL.rust), 2.4, 1.6, 2.4, 0.08, 3.2);
  box(b, mat(PAL.camoDark), 2.4, 3.2, 2.4, 0.9, 0.5, 0.9);
  flag(b, rig, -2.6, 2.4, 3.2);
}

function factory(rig: ModelRig) {
  const b = rig.body;
  pad(rig, 4);
  // Half-cylinder hangar: axis along Z, arch facing up.
  const halfCyl = cached('hangar', () => {
    const g = new THREE.CylinderGeometry(1, 1, 1, 18, 1, false, -Math.PI / 2, Math.PI);
    g.rotateX(-Math.PI / 2);
    return g;
  });
  add(b, halfCyl, mat(PAL.metal, 0.5, 0.6), -0.6, 0.3, -0.3, 2.5, 2.5, 6.0);
  box(b, mat(PAL.dark), -0.6, 1.0, 2.72, 3.2, 1.9, 0.08);
  box(b, rig.teamMaterial, -0.6, 2.2, 2.72, 3.6, 0.3, 0.1);
  box(b, mat(PAL.beige), 2.6, 1.0, -0.8, 2.0, 1.7, 4.4);
  cylY(b, mat(PAL.rust), 2.8, 3.0, -2.6, 0.3, 3.0);
  rig.emitters.push({ obj: marker(b, 2.8, 4.6, -2.6), kind: 'smoke' });
  // Gantry crane
  const yellow = mat(0xd9a520, 0.6, 0.3);
  box(b, yellow, 2.9, 2.6, 2.4, 0.25, 4.6, 0.25);
  box(b, yellow, 1.6, 4.8, 2.4, 2.8, 0.2, 0.25);
  box(b, mat(PAL.dark), 0.4, 4.2, 2.4, 0.03, 1.2, 0.03);
}

function airfield(rig: ModelRig) {
  const b = rig.body;
  box(b, mat(PAL.asphalt, 0.95), 0, 0.08, 0, 7.8, 0.16, 7.8);
  const white = mat(PAL.white, 0.8);
  const ring = new THREE.Mesh(cached('padRing', () => new THREE.RingGeometry(1.8, 2.0, 32)), white);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(-0.8, 0.17, 0.6);
  b.add(ring);
  box(b, white, -1.4, 0.17, 0.6, 0.18, 0.02, 1.6);
  box(b, white, -0.2, 0.17, 0.6, 0.18, 0.02, 1.6);
  box(b, white, -0.8, 0.17, 0.6, 1.2, 0.02, 0.18);
  // Tower
  cylY(b, mat(PAL.concrete), 2.7, 1.6, -2.6, 0.45, 3.2);
  box(b, mat(PAL.glass, 0.2, 0.6), 2.7, 3.5, -2.6, 1.3, 0.7, 1.3);
  box(b, rig.teamMaterial, 2.7, 3.95, -2.6, 1.45, 0.15, 1.45);
  const dish = new THREE.Group();
  dish.position.set(2.7, 4.3, -2.6);
  box(dish, mat(PAL.steel, 0.4, 0.6), 0, 0, 0, 1.2, 0.18, 0.06);
  b.add(dish);
  rig.dishes.push(dish);
  // Hangar
  box(b, mat(PAL.beige), 2.4, 0.9, 1.6, 2.4, 1.6, 3.6);
  box(b, mat(PAL.dark), 1.18, 0.75, 1.6, 0.05, 1.2, 2.6);
  // Windsock
  cylY(b, mat(PAL.steel), -3.4, 1.0, -3.3, 0.04, 2.0);
  const sock = add(b, CONE(8), rig.teamMaterial, -3.4, 1.9, -2.95, 0.15, 0.7, 0.15);
  sock.rotation.x = -Math.PI / 2;
  for (let i = 0; i < 4; i++) rig.blinkers.push(add(b, SPH(6), mat(0x44ff66, 0.5, 0, 2), -3.6 + i * 2.4, 0.22, 3.6, 0.08, 0.08, 0.08));
}

function derrick(rig: ModelRig) {
  const b = rig.body;
  box(b, mat(PAL.concreteDark), 0, 0.1, 0, 3.6, 0.2, 3.6);
  const steel = mat(PAL.metal, 0.6, 0.5);
  // Samson post (A-frame)
  for (const s of [-1, 1]) {
    const leg = box(b, steel, s * 0.35, 1.0, 0, 0.12, 2.0, 0.12);
    leg.rotation.z = s * 0.18;
  }
  const beam = new THREE.Group();
  beam.position.set(0, 1.95, 0);
  box(beam, mat(PAL.dark), 0, 0, 0, 0.22, 0.26, 2.8);
  // Horse head
  const head = box(beam, rig.teamMaterial, 0, -0.25, 1.45, 0.25, 0.85, 0.4);
  head.rotation.x = 0.15;
  // Counterweights
  for (const s of [-1, 1]) tubeX(beam, mat(PAL.rust), s * 0.25, -0.15, -1.25, 0.45, 0.15, 14);
  b.add(beam);
  rig.beam = beam;
  cylY(b, mat(PAL.dark), 0, 0.6, 1.45, 0.08, 1.0); // polished rod/wellhead
  box(b, mat(PAL.metal), 0, 0.45, -1.2, 0.6, 0.5, 0.6); // motor
  cylY(b, mat(PAL.white, 0.7), 1.2, 0.75, -1.1, 0.5, 1.3, 1, 14);
  cylY(b, rig.teamMaterial, 1.2, 1.15, -1.1, 0.52, 0.15, 1, 14);
}

function refinery(rig: ModelRig) {
  const b = rig.body;
  pad(rig, 3);
  const white = mat(PAL.white, 0.6, 0.2);
  for (const [x, z] of [[-1.5, -1.4], [-1.5, 0.4], [0.2, 1.7]] as const) {
    cylY(b, white, x, 0.85, z, 0.85, 1.3, 1, 18);
    cylY(b, rig.teamMaterial, x, 1.0, z, 0.87, 0.15, 1, 18);
  }
  const steel = mat(PAL.steel, 0.4, 0.7);
  cylY(b, steel, 0.8, 2.2, -1.2, 0.32, 4.2);
  cylY(b, steel, 1.6, 1.8, -0.2, 0.28, 3.4);
  for (const y of [1.2, 2.4, 3.4]) cylY(b, mat(PAL.dark), 0.8, y, -1.2, 0.45, 0.06);
  box(b, mat(PAL.rust), 0.0, 0.8, -0.3, 2.6, 0.12, 0.12);
  box(b, mat(PAL.rust), 0.4, 0.5, 0.6, 0.12, 0.12, 2.0);
  cylY(b, mat(PAL.metal), 2.3, 2.6, 1.9, 0.1, 5.0);
  rig.emitters.push({ obj: marker(b, 2.3, 5.2, 1.9), kind: 'flare' });
}

function turretBld(rig: ModelRig) {
  const b = rig.body;
  cylY(b, mat(PAL.concrete), 0, 0.5, 0, 1.6, 1.0, 1.15, 10);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const s = box(b, mat(PAL.canvas), Math.cos(a) * 1.75, 0.25, Math.sin(a) * 1.75, 0.6, 0.35, 0.4);
    s.rotation.y = -a;
  }
  const turret = new THREE.Group();
  turret.position.set(0, 1.0, 0);
  box(turret, mat(PAL.camo), 0, 0.3, 0, 1.2, 0.6, 1.3);
  box(turret, rig.teamMaterial, 0, 0.62, 0, 1.22, 0.08, 1.32);
  const barrel = new THREE.Group();
  barrel.position.set(0, 0.32, 0.6);
  tubeZ(barrel, mat(PAL.camoDark, 0.5, 0.4), 0, 0, 0.8, 0.09, 1.6);
  turret.add(barrel);
  b.add(turret);
  rig.turret = turret;
  rig.barrel = barrel;
  rig.muzzle = marker(barrel, 0, 0, 1.65);
}

function samsite(rig: ModelRig) {
  const b = rig.body;
  box(b, mat(PAL.concrete), 0, 0.15, 0, 3.6, 0.3, 3.6);
  const turret = new THREE.Group();
  turret.position.set(0, 0.3, 0);
  cylY(turret, mat(PAL.dark), 0, 0.2, 0, 0.6, 0.4);
  const launcher = new THREE.Group();
  launcher.position.set(0, 0.7, 0);
  const paint = mat(PAL.camo);
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 2; c++) {
      tubeZ(launcher, paint, -0.3 + c * 0.6, r * 0.42, 0.1, 0.18, 1.9);
      tubeZ(launcher, rig.teamMaterial, -0.3 + c * 0.6, r * 0.42, 1.05, 0.185, 0.08);
    }
  launcher.rotation.x = -0.6;
  turret.add(launcher);
  b.add(turret);
  rig.turret = turret;
  rig.launcher = launcher;
  rig.muzzle = marker(launcher, 0, 0.2, 1.2);
  cylY(b, mat(PAL.steel), 1.4, 0.8, -1.4, 0.05, 1.4);
  const dish = new THREE.Group();
  dish.position.set(1.4, 1.6, -1.4);
  box(dish, mat(PAL.white), 0, 0, 0, 0.9, 0.6, 0.06);
  b.add(dish);
  rig.dishes.push(dish);
}

function silo(rig: ModelRig) {
  const b = rig.body;
  box(b, mat(PAL.concreteDark), 0, 0.25, 0, 5.8, 0.5, 5.8);
  box(b, mat(PAL.concrete), 0, 0.55, 0, 3.8, 0.15, 3.8);
  box(b, mat(PAL.black), 0, 0.5, 0, 3.0, 0.2, 3.0);
  for (const s of [-1, 1]) {
    const door = new THREE.Group();
    door.position.set(s * 0.75, 0.68, 0);
    box(door, mat(PAL.metal, 0.5, 0.5), 0, 0, 0, 1.5, 0.15, 3.0);
    box(door, mat(0xd9a520), 0, 0.09, 0, 1.3, 0.02, 0.2);
    b.add(door);
    rig.doors.push(door);
  }
  const missile = new THREE.Group();
  missile.position.set(0, -2.5, 0);
  cylY(missile, mat(PAL.white, 0.5, 0.3), 0, 1.7, 0, 0.42, 3.4, 1, 14);
  const nose = add(missile, CONE(14), rig.teamMaterial, 0, 3.75, 0, 0.42, 0.9, 0.42);
  nose.castShadow = true;
  b.add(missile);
  missile.visible = false;
  rig.missile = missile;
  box(b, mat(PAL.concrete), -2.2, 0.95, -2.2, 1.2, 0.9, 1.2);
  box(b, rig.teamMaterial, -2.2, 1.45, -2.2, 1.25, 0.1, 1.25);
  for (const [x, z] of [[2.5, 2.5], [-2.5, 2.5], [2.5, -2.5]] as const)
    rig.blinkers.push(add(b, SPH(6), mat(0xff2a1a, 0.5, 0, 2.5), x, 0.7, z, 0.15, 0.15, 0.15));
}

export function createBuildingModel(kind: BuildingKind, color: number): ModelRig {
  const rig = newRig(color);
  switch (kind) {
    case 'hq':
      hq(rig);
      break;
    case 'power':
      power(rig);
      break;
    case 'barracks':
      barracks(rig);
      break;
    case 'factory':
      factory(rig);
      break;
    case 'airfield':
      airfield(rig);
      break;
    case 'derrick':
      derrick(rig);
      break;
    case 'refinery':
      refinery(rig);
      break;
    case 'turret':
      turretBld(rig);
      break;
    case 'samsite':
      samsite(rig);
      break;
    case 'silo':
      silo(rig);
      break;
  }
  return rig;
}

export function buildingFootprint(kind: BuildingKind): number {
  return BUILDINGS[kind].size * CELL;
}

// ---------------------------------------------------------------------------
// World props

export interface CityRig {
  root: THREE.Group;
  flagMat: THREE.MeshStandardMaterial;
  flag: THREE.Object3D;
}

export function createCityModel(seed: number, capital: boolean): CityRig {
  const root = new THREE.Group();
  const r = rng(seed);
  const plaza = new THREE.Mesh(cached('plaza', () => new THREE.CircleGeometry(1, 24)), mat(0xb7a585, 0.95));
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.06;
  plaza.scale.setScalar(capital ? 5.2 : 4.0);
  plaza.receiveShadow = true;
  root.add(plaza);
  const colors = [0xe2d6bb, 0xd4c3a0, 0xc9b691, 0xefe8d8, 0xbfae8c];
  const count = capital ? 26 : 15;
  const spread = capital ? 4.4 : 3.3;
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2;
    const d = 0.9 + Math.sqrt(r()) * spread;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const tall = capital && r() < 0.25;
    const h = tall ? 2.5 + r() * 3.5 : 0.5 + r() * 1.3;
    const w = 0.6 + r() * 0.8;
    const m = box(root, mat(tall ? 0x9fb4c0 : colors[i % colors.length], tall ? 0.3 : 0.9, tall ? 0.5 : 0), x, h / 2, z, w, h, 0.6 + r() * 0.8);
    m.rotation.y = r() * 0.5;
  }
  // Mosque-like dome & minaret for skyline character
  cylY(root, mat(0xe2d6bb), 1.3, 0.55, -0.6, 0.9, 1.1, 1, 14);
  add(root, HEMI(), mat(capital ? PAL.gold : PAL.turquoise, 0.35, 0.4), 1.3, 1.1, -0.6, 0.95, 1.0, 0.95);
  cylY(root, mat(0xefe8d8), 2.5, 1.6, 0.4, 0.16, 3.2, 0.8);
  add(root, CONE(8), mat(PAL.turquoise), 2.5, 3.4, 0.4, 0.2, 0.5, 0.2);
  // Flag
  cylY(root, mat(PAL.steel, 0.4, 0.6), 0, 2.0, 0, 0.06, 4.0);
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.6, flatShading: true });
  const pivot = new THREE.Group();
  pivot.position.set(0, 3.6, 0);
  const f = new THREE.Mesh(BOX(), flagMat);
  f.scale.set(0.04, 0.7, 1.2);
  f.position.z = 0.6;
  pivot.add(f);
  root.add(pivot);
  return { root, flagMat, flag: pivot };
}

export function createOilFieldModel(seed: number): THREE.Group {
  const g = new THREE.Group();
  const r = rng(seed * 31 + 7);
  const shape = new THREE.Shape();
  const n = 20;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rad = 1.6 + (r() - 0.5) * 0.6;
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  // Stained sand halo
  const halo = new THREE.Mesh(
    cached('oilHalo', () => new THREE.CircleGeometry(1, 28)),
    new THREE.MeshBasicMaterial({ color: 0x2a2015, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.06;
  halo.scale.setScalar(2.9);
  g.add(halo);
  // Crude oil: glossy clear-coated black with a thin-film rainbow sheen.
  const oilMat = new THREE.MeshPhysicalMaterial({
    color: 0x16110c,
    roughness: 0.18,
    metalness: 0.2,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    iridescence: 0.9,
    iridescenceIOR: 1.35,
    iridescenceThicknessRange: [150, 450],
  });
  const pool = new THREE.Mesh(new THREE.ShapeGeometry(shape), oilMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.09;
  pool.receiveShadow = true;
  g.add(pool);
  // Rusty wellhead marker so fields read clearly
  cylY(g, mat(PAL.rust, 0.7, 0.4), 0.9, 0.35, -0.5, 0.12, 0.7);
  cylY(g, mat(PAL.rust, 0.7, 0.4), 0.9, 0.72, -0.5, 0.2, 0.08);
  // Pulsing gold ring for unclaimed fields
  const ring = new THREE.Mesh(
    cached('oilRing', () => {
      const geo = new THREE.RingGeometry(0.9, 1, 40);
      geo.rotateX(-Math.PI / 2);
      return geo;
    }),
    new THREE.MeshBasicMaterial({ color: 0xf5b942, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  ring.position.y = 0.15;
  ring.scale.setScalar(3.1);
  ring.name = 'pulse';
  g.add(ring);
  return g;
}

/** Replace all materials with a translucent ghost material (for placement preview). */
export function applyGhost(root: THREE.Object3D, material: THREE.Material) {
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      const m = o as THREE.Mesh;
      m.material = material;
      m.castShadow = false;
      m.receiveShadow = false;
    }
  });
}

/** Render small thumbnails of every unit and building to data URLs for the UI. */
export function renderThumbnails(units: UnitKind[], buildings: BuildingKind[], color: number): Record<string, string> {
  const size = 160;
  const out: Record<string, string> = {};
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return out;
  }
  renderer.setSize(size, size, false);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff1dc, 0x6b5a40, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.6);
  sun.position.set(4, 8, 6);
  scene.add(sun);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);

  const shoot = (rig: ModelRig, key: string) => {
    rig.root.rotation.y = -0.7;
    scene.add(rig.root);
    const bounds = new THREE.Box3().setFromObject(rig.root);
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(15)) * 0.95;
    cam.position.set(sphere.center.x, sphere.center.y + dist * 0.55, sphere.center.z + dist * 0.85);
    cam.lookAt(sphere.center);
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, cam);
    out[key] = renderer.domElement.toDataURL('image/png');
    scene.remove(rig.root);
  };
  for (const u of units) shoot(createUnitModel(u, color), u);
  for (const b of buildings) {
    const rig = createBuildingModel(b, color);
    if (rig.missile) rig.missile.visible = false;
    shoot(rig, b);
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
