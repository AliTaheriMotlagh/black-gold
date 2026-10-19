/**
 * Procedural unit models (km units, ~20× real size so they read at RTS zoom).
 * Forward is +z, up is +y. Each model is a few merged parts for instancing.
 */
import * as THREE from 'three';
import { CAMO, FIXED, GLOW, type ModelDef, type Part, TEAM, part } from './kit';

const DARK = 0x262826;
const TRACK = 0x1d1e1c;
const METAL = 0x5a5f62;
const GUN = 0x34383a;
const GLASS = 0x1d2c38;
const SKIN = 0x9c7b60;
const AIRGREY = 0xa3aab0;
const NAVY = 0x8b9399;
const WHITE = 0xe6e6e2;
const SHADE = 0xd6d6d6;
const LIGHT_R = 0xff3a2a;
const LIGHT_G = 0x40ff70;

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------------------
// Shared sub-assemblies

function tracks(p: Part, len: number, w: number, r: number, wheels: number) {
  for (const s of [-1, 1]) {
    p.box(0.022, r * 2, len, TRACK, FIXED, { x: s * w, y: r });
    for (let i = 0; i < wheels; i++) {
      const z = -len / 2 + r + ((len - 2 * r) * i) / (wheels - 1);
      p.cyl(r * 0.85, r * 0.85, 0.024, DARK, FIXED, { x: s * w, y: r, z, rz: Math.PI / 2 });
    }
    p.box(0.012, 0.004, len * 0.98, 0xffffff, CAMO, { x: s * (w + 0.002), y: r * 2 + 0.002 });
  }
}

function wheels(p: Part, zs: number[], w: number, r: number) {
  for (const s of [-1, 1]) for (const z of zs) p.cyl(r, r, 0.016, TRACK, FIXED, { x: s * w, y: r, z, rz: Math.PI / 2 }, 10);
}

/** Military truck chassis with cab; returns bed height. */
function truck(p: Part, len: number, w: number, axles: number) {
  const r = 0.012;
  const zs: number[] = [];
  for (let i = 0; i < axles; i++) zs.push(len / 2 - 0.03 - ((len - 0.07) * i) / (axles - 1));
  wheels(p, zs, w / 2 - 0.006, r);
  p.box(w * 0.86, 0.012, len, DARK, FIXED, { y: r * 1.6 });
  // Cab
  p.box(w, 0.032, 0.045, 0xffffff, CAMO, { y: r * 2 + 0.016, z: len / 2 - 0.025 });
  p.box(w * 0.92, 0.012, 0.004, GLASS, FIXED, { y: r * 2 + 0.024, z: len / 2 - 0.001 });
  p.box(0.012, 0.003, 0.003, LIGHT_R, GLOW, { x: -w * 0.3, y: r * 2 + 0.006, z: len / 2 + 0.001 });
  p.box(0.012, 0.003, 0.003, LIGHT_R, GLOW, { x: w * 0.3, y: r * 2 + 0.006, z: len / 2 + 0.001 });
  return r * 2 + 0.006;
}

function soldier(p: Part, x: number, z: number, ry: number, kit: 'rifle' | 'tube' | 'pack' | 'dark' = 'rifle') {
  const body = kit === 'dark' ? 0x2a2c2a : 0xffffff;
  const mask = kit === 'dark' ? FIXED : CAMO;
  p.cyl(0.006, 0.007, 0.022, body, mask, { x, y: 0.011, z }, 6);
  p.box(0.012, 0.009, 0.008, SHADE, mask, { x, y: 0.016, z: z - 0.004 * Math.cos(ry) });
  p.sphere(0.0055, SKIN, FIXED, { x, y: 0.0265, z }, 6);
  p.sphere(0.0062, body === 0xffffff ? SHADE : 0x1e201e, mask, { x, y: 0.029, z, sy: 0.7 }, 6);
  if (kit === 'tube') p.tube(0.003, 0.03, 0x4e5a3c, FIXED, { x: x + 0.005, y: 0.03, z: z - 0.01 }, 6);
  else p.box(0.002, 0.002, 0.018, GUN, FIXED, { x: x + 0.006, y: 0.018, z: z + 0.006 });
  if (kit === 'pack') p.box(0.01, 0.012, 0.007, 0xffffff, TEAM, { x, y: 0.017, z: z - 0.008 });
  else p.box(0.004, 0.003, 0.004, 0xffffff, TEAM, { x: x - 0.006, y: 0.02, z });
}

// ---------------------------------------------------------------------------

type Factory = () => ModelDef;

export const UNIT_MODELS: Record<string, Factory> = {
  rifle: () => ({
    parts: [part((p) => [[-0.018, -0.012], [0.018, -0.012], [0, 0.018], [0.0, -0.03]].forEach(([x, z], i) => soldier(p, x, z, 0, i === 2 ? 'rifle' : 'rifle')))],
    height: 0.035,
    radius: 0.05,
  }),
  atgm_team: () => ({
    parts: [
      part((p) => {
        soldier(p, -0.012, -0.01, 0);
        soldier(p, 0.016, 0.004, 0, 'pack');
        // Tripod launcher
        p.tube(0.004, 0.032, 0x4b5638, FIXED, { y: 0.016, z: 0.006 }, 8);
        p.box(0.012, 0.01, 0.008, 0x3d4430, FIXED, { y: 0.014, z: 0.002 });
        for (const a of [0, 2.1, 4.2]) p.cyl(0.001, 0.001, 0.018, GUN, FIXED, { x: Math.sin(a) * 0.006, y: 0.007, z: Math.cos(a) * 0.006 + 0.004, rx: Math.cos(a) * 0.4, rz: -Math.sin(a) * 0.4 }, 4);
      }),
    ],
    height: 0.035,
    radius: 0.05,
  }),
  manpads: () => ({
    parts: [part((p) => [soldier(p, -0.012, -0.006, 0, 'tube'), soldier(p, 0.014, 0.008, 0, 'tube'), soldier(p, 0.0, -0.026, 0)])],
    height: 0.035,
    radius: 0.05,
  }),
  engineer: () => ({
    parts: [part((p) => [soldier(p, -0.014, 0, 0, 'pack'), soldier(p, 0.014, 0.006, 0, 'pack'), soldier(p, 0, -0.02, 0, 'pack')])],
    height: 0.035,
    radius: 0.05,
  }),
  sf: () => ({
    parts: [part((p) => [[-0.016, -0.01], [0.016, -0.006], [0, 0.014]].forEach(([x, z]) => soldier(p, x, z, 0, 'dark')))],
    height: 0.035,
    radius: 0.05,
  }),

  builder: () => ({
    parts: [
      part((p) => {
        tracks(p, 0.15, 0.045, 0.014, 5);
        p.hull(0.14, 0.075, 0.03, 0.2, 0.2, 0xffffff, CAMO, { y: 0.028 });
        // Cab and dozer blade
        p.box(0.05, 0.035, 0.045, SHADE, CAMO, { y: 0.075, z: -0.02 });
        p.box(0.046, 0.016, 0.04, GLASS, FIXED, { y: 0.08, z: -0.02, sx: 1.04 });
        p.box(0.12, 0.04, 0.008, 0xc8a227, FIXED, { y: 0.024, z: 0.1, rx: -0.2 });
        for (const s of [-1, 1]) p.box(0.006, 0.006, 0.05, METAL, FIXED, { x: s * 0.045, y: 0.03, z: 0.07, rx: 0.3 });
        // Crane arm
        p.box(0.008, 0.008, 0.09, 0xc8a227, FIXED, { y: 0.07, z: -0.07, rx: -0.6 });
        p.box(0.01, 0.004, 0.004, 0xffa020, GLOW, { y: 0.095, z: -0.02 });
        p.box(0.03, 0.002, 0.012, 0xffffff, TEAM, { y: 0.0935, z: -0.02 });
      }),
    ],
    height: 0.1,
    radius: 0.075,
  }),

  ifv: () => ({
    parts: [
      part((p) => {
        tracks(p, 0.165, 0.042, 0.013, 6);
        p.hull(0.168, 0.09, 0.042, 0.42, 0.1, 0xffffff, CAMO, { y: 0.024 });
        p.box(0.07, 0.003, 0.06, SHADE, CAMO, { y: 0.067, z: -0.04 });
        p.box(0.03, 0.012, 0.012, DARK, FIXED, { y: 0.06, z: -0.084 });
      }),
      part(
        (p) => {
          p.slab([[-0.026, -0.02], [0.026, -0.02], [0.03, 0.012], [0.016, 0.028], [-0.016, 0.028], [-0.03, 0.012]], 0.02, 0xffffff, CAMO);
          p.tube(0.0026, 0.075, GUN, FIXED, { y: 0.011, z: 0.025 }, 6);
          p.cyl(0.004, 0.004, 0.012, GUN, FIXED, { y: 0.011, z: 0.03, rx: Math.PI / 2 }, 6);
          p.box(0.014, 0.012, 0.03, 0x4b5638, FIXED, { x: 0.03, y: 0.016, z: 0.0 });
          p.box(0.006, 0.006, 0.006, GLASS, FIXED, { x: -0.012, y: 0.023, z: 0.012 });
          p.box(0.003, 0.012, 0.03, 0xffffff, TEAM, { x: -0.029, y: 0.01, z: -0.004 });
          p.cyl(0.0007, 0.0007, 0.05, DARK, FIXED, { x: -0.02, y: 0.045, z: -0.015 }, 4);
        },
        'turret',
        v(0, 0.066, -0.005),
      ),
    ],
    height: 0.1,
    radius: 0.085,
  }),

  mbt: () => ({
    parts: [
      part((p) => {
        tracks(p, 0.19, 0.046, 0.013, 7);
        p.hull(0.192, 0.1, 0.034, 0.38, 0.12, 0xffffff, CAMO, { y: 0.026 });
        // Engine deck & side skirts
        p.box(0.07, 0.004, 0.05, DARK, FIXED, { y: 0.061, z: -0.06 });
        p.box(0.012, 0.01, 0.006, LIGHT_R, GLOW, { x: -0.04, y: 0.045, z: -0.097 });
        p.box(0.012, 0.01, 0.006, LIGHT_R, GLOW, { x: 0.04, y: 0.045, z: -0.097 });
      }),
      part(
        (p) => {
          // Angular composite-armour turret
          p.slab([[-0.04, -0.045], [0.04, -0.045], [0.046, 0.0], [0.034, 0.04], [0.012, 0.05], [-0.012, 0.05], [-0.034, 0.04], [-0.046, 0.0]], 0.026, 0xffffff, CAMO);
          p.box(0.07, 0.016, 0.03, SHADE, CAMO, { y: 0.009, z: -0.055 });
          p.tube(0.0036, 0.14, GUN, FIXED, { y: 0.014, z: 0.045 }, 8);
          p.tube(0.0052, 0.03, GUN, FIXED, { y: 0.014, z: 0.1 }, 8);
          p.cyl(0.009, 0.01, 0.01, SHADE, CAMO, { x: -0.018, y: 0.031, z: -0.012 }, 8);
          p.box(0.002, 0.002, 0.022, GUN, FIXED, { x: -0.018, y: 0.04, z: 0.0 });
          p.box(0.012, 0.01, 0.012, GLASS, FIXED, { x: 0.022, y: 0.031, z: 0.012 });
          for (const s of [-1, 1]) {
            p.box(0.003, 0.014, 0.05, 0xffffff, TEAM, { x: s * 0.044, y: 0.012, z: -0.005 });
            for (let i = 0; i < 3; i++) p.tube(0.0022, 0.008, DARK, FIXED, { x: s * (0.03 + i * 0.004), y: 0.022, z: 0.036, ry: s * 0.4 }, 5);
          }
          p.cyl(0.0006, 0.0006, 0.06, DARK, FIXED, { x: 0.02, y: 0.056, z: -0.05 }, 4);
        },
        'turret',
        v(0, 0.06, -0.006),
      ),
    ],
    height: 0.11,
    radius: 0.1,
  }),

  shorad: () => ({
    parts: [
      part((p) => {
        const bed = truck(p, 0.19, 0.085, 4);
        p.box(0.08, 0.02, 0.1, 0xffffff, CAMO, { y: bed + 0.01, z: -0.035 });
      }),
      part(
        (p) => {
          p.cyl(0.03, 0.034, 0.03, 0xffffff, CAMO, { y: 0.015 }, 10);
          for (const s of [-1, 1]) {
            for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) p.tube(0.0045, 0.06, 0x4e5a3c, FIXED, { x: s * (0.038 + j * 0.009), y: 0.018 + i * 0.009, z: -0.02 }, 6);
            p.tube(0.0025, 0.045, GUN, FIXED, { x: s * 0.022, y: 0.032, z: 0.0 }, 6);
          }
          p.box(0.05, 0.03, 0.004, 0x3a3f3a, FIXED, { y: 0.055, z: -0.012 });
          p.box(0.004, 0.012, 0.03, 0xffffff, TEAM, { x: 0.031, y: 0.016 });
        },
        'turret',
        v(0, 0.06, -0.05),
      ),
    ],
    height: 0.13,
    radius: 0.09,
  }),

  spg: () => ({
    parts: [
      part((p) => {
        tracks(p, 0.19, 0.048, 0.013, 7);
        p.hull(0.19, 0.1, 0.03, 0.4, 0.08, 0xffffff, CAMO, { y: 0.026 });
      }),
      part(
        (p) => {
          p.box(0.09, 0.04, 0.095, 0xffffff, CAMO, { y: 0.02 });
          p.box(0.07, 0.006, 0.02, SHADE, CAMO, { y: 0.042, z: -0.03 });
          p.tube(0.0042, 0.17, GUN, FIXED, { y: 0.024, z: 0.045 }, 8);
          p.tube(0.0058, 0.016, GUN, FIXED, { y: 0.024, z: 0.205 }, 8);
          for (const s of [-1, 1]) p.box(0.003, 0.02, 0.05, 0xffffff, TEAM, { x: s * 0.046, y: 0.022, z: 0.005 });
        },
        'turret',
        v(0, 0.056, -0.04),
      ),
    ],
    height: 0.11,
    radius: 0.1,
  }),

  mlrs: () => ({
    parts: [
      part((p) => {
        truck(p, 0.2, 0.09, 3);
      }),
      part(
        (p) => {
          p.box(0.075, 0.04, 0.11, 0xffffff, CAMO, { y: 0.024 });
          for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) p.cyl(0.006, 0.006, 0.002, DARK, FIXED, { x: -0.02 + i * 0.02, y: 0.015 + j * 0.02, z: 0.056, rx: Math.PI / 2 }, 6);
          p.box(0.003, 0.03, 0.08, 0xffffff, TEAM, { x: 0.038, y: 0.024 });
        },
        'turret',
        v(0, 0.035, -0.045),
      ),
    ],
    height: 0.1,
    radius: 0.1,
  }),

  sam_tel: () => ({
    parts: [
      part((p) => {
        const bed = truck(p, 0.23, 0.09, 4);
        p.box(0.08, 0.012, 0.13, DARK, FIXED, { y: bed, z: -0.04 });
        for (const s of [-1, 1]) p.box(0.006, 0.02, 0.006, METAL, FIXED, { x: s * 0.045, y: bed - 0.008, z: -0.1 });
      }),
      part(
        (p) => {
          for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) p.tube(0.011, 0.15, 0xffffff, CAMO, { x: -0.012 + i * 0.024, y: 0.012 + j * 0.022, z: 0 }, 10);
          p.box(0.05, 0.05, 0.004, DARK, FIXED, { y: 0.023, z: 0.151 });
          p.box(0.003, 0.03, 0.1, 0xffffff, TEAM, { x: 0.027, y: 0.022, z: 0.06 });
        },
        'pitch',
        v(0, 0.05, -0.105),
        'x',
      ),
    ],
    height: 0.12,
    radius: 0.11,
  }),

  ew: () => ({
    parts: [
      part((p) => {
        const bed = truck(p, 0.2, 0.09, 3);
        p.box(0.085, 0.05, 0.11, 0xffffff, CAMO, { y: bed + 0.025, z: -0.035 });
        p.box(0.003, 0.03, 0.08, 0xffffff, TEAM, { x: 0.043, y: bed + 0.03, z: -0.035 });
        p.cyl(0.003, 0.004, 0.11, METAL, FIXED, { y: bed + 0.1, z: -0.07 }, 6);
      }),
      part(
        (p) => {
          for (let k = 0; k < 4; k++) p.box(0.004, 0.035, 0.03, 0xdedede, FIXED, { x: Math.sin((k * Math.PI) / 2) * 0.016, y: 0, z: Math.cos((k * Math.PI) / 2) * 0.016, ry: (k * Math.PI) / 2 + Math.PI / 2 });
          p.sphere(0.006, LIGHT_R, GLOW, { y: 0.022 }, 6);
        },
        'spin',
        v(0, 0.16, -0.07),
        'y',
        1.2,
      ),
    ],
    height: 0.18,
    radius: 0.09,
  }),

  tel: () => ({
    parts: [
      part((p) => {
        truck(p, 0.26, 0.095, 4);
      }),
      part(
        (p) => {
          p.box(0.05, 0.012, 0.21, METAL, FIXED, { y: 0.006, z: 0.105 });
          p.tube(0.016, 0.19, 0xdedcd2, FIXED, { y: 0.03, z: 0.005 }, 12);
          p.cone(0.016, 0.04, 0xdedcd2, FIXED, { y: 0.03, z: 0.215, rx: Math.PI / 2 }, 12);
          p.tube(0.0165, 0.02, 0xffffff, TEAM, { y: 0.03, z: 0.12 }, 12);
          for (const s of [-1, 1]) p.box(0.002, 0.018, 0.02, 0x404040, FIXED, { x: s * 0.016, y: 0.03, z: 0.01 });
        },
        'pitch',
        v(0, 0.045, -0.11),
        'x',
      ),
    ],
    height: 0.12,
    radius: 0.11,
  }),

  // --- Drones ---------------------------------------------------------------
  fpv: () => ({
    parts: [
      part((p) => {
        p.box(0.008, 0.004, 0.012, DARK, FIXED);
        p.box(0.04, 0.0016, 0.003, 0x303030, FIXED, { ry: Math.PI / 4 });
        p.box(0.04, 0.0016, 0.003, 0x303030, FIXED, { ry: -Math.PI / 4 });
        p.tube(0.0025, 0.012, 0x4b5638, FIXED, { y: -0.004, z: -0.002 }, 6);
        p.box(0.004, 0.002, 0.004, LIGHT_G, GLOW, { y: 0.003, z: 0.005 });
        p.box(0.004, 0.0015, 0.004, 0xffffff, TEAM, { y: 0.0028, z: -0.004 });
      }),
      part(
        (p) => {
          for (const [x, z] of [[0.014, 0.014], [-0.014, 0.014], [0.014, -0.014], [-0.014, -0.014]]) p.cyl(0.008, 0.008, 0.0006, 0x777777, FIXED, { x, y: 0.0012, z }, 10);
        },
        'none',
      ),
    ],
    height: 0.02,
    radius: 0.03,
  }),
  recon: () => ({
    parts: [
      part((p) => {
        p.tube(0.005, 0.07, 0xc9ccc8, FIXED, { z: -0.035 }, 8, 0.003);
        p.box(0.11, 0.002, 0.014, 0xc9ccc8, FIXED, { z: 0.004 });
        p.box(0.03, 0.002, 0.008, 0xc9ccc8, FIXED, { z: -0.032, rz: 0.5 });
        p.box(0.006, 0.006, 0.006, GLASS, FIXED, { y: -0.005, z: 0.02 });
        p.box(0.012, 0.0022, 0.006, 0xffffff, TEAM, { x: 0.04, z: 0.004 });
      }),
      part((p) => p.box(0.022, 0.001, 0.002, 0x333333, FIXED), 'spin', v(0, 0, -0.037), 'z', 40),
    ],
    height: 0.02,
    radius: 0.06,
  }),
  loiter: () => ({
    parts: [
      part((p) => {
        // Shahed-style cropped delta
        p.slab([[0, 0.04], [0.045, -0.025], [0.045, -0.03], [0.01, -0.03], [-0.01, -0.03], [-0.045, -0.03], [-0.045, -0.025]], 0.003, 0xb8b8ae, FIXED);
        p.tube(0.005, 0.07, 0xb8b8ae, FIXED, { y: 0.002, z: -0.033 }, 8, 0.004);
        for (const s of [-1, 1]) p.box(0.002, 0.012, 0.01, 0xb8b8ae, FIXED, { x: s * 0.045, y: 0.006, z: -0.026 });
        p.box(0.012, 0.0032, 0.01, 0xffffff, TEAM, { y: 0.0018, z: 0.0 });
      }),
      part((p) => p.box(0.02, 0.001, 0.002, 0x222222, FIXED), 'spin', v(0, 0.002, -0.034), 'z', 50),
    ],
    height: 0.02,
    radius: 0.05,
  }),
  male: () => ({
    parts: [
      part((p) => {
        p.tube(0.007, 0.12, 0xd2d5d2, FIXED, { z: -0.06 }, 10, 0.004);
        p.sphere(0.008, 0xd2d5d2, FIXED, { z: 0.06, sz: 1.4 }, 8);
        p.box(0.18, 0.002, 0.016, 0xd2d5d2, FIXED, { y: 0.004, z: 0.0 });
        for (const s of [-1, 1]) {
          p.box(0.03, 0.002, 0.01, 0xd2d5d2, FIXED, { x: s * 0.012, y: 0.006, z: -0.058, rz: s * 0.7 });
          p.tube(0.0016, 0.02, 0x3a3f3a, FIXED, { x: s * 0.04, y: -0.002, z: -0.004 }, 6);
          p.box(0.018, 0.0024, 0.008, 0xffffff, TEAM, { x: s * 0.07, y: 0.0052, z: 0 });
        }
        p.sphere(0.005, GLASS, FIXED, { y: -0.007, z: 0.045 }, 8);
      }),
      part((p) => p.box(0.024, 0.0012, 0.0025, 0x333333, FIXED), 'spin', v(0, 0, -0.062), 'z', 45),
    ],
    height: 0.03,
    radius: 0.09,
  }),

  // --- Aircraft ---------------------------------------------------------------
  heli: () => ({
    parts: [
      part((p) => {
        p.tube(0.016, 0.1, 0xffffff, CAMO, { z: -0.03 }, 10, 0.012);
        p.sphere(0.017, 0xffffff, CAMO, { z: 0.07, sz: 1.5, sy: 0.9 }, 10);
        p.box(0.012, 0.016, 0.03, GLASS, FIXED, { y: 0.012, z: 0.068 });
        p.box(0.012, 0.014, 0.024, GLASS, FIXED, { y: 0.016, z: 0.04 });
        p.tube(0.005, 0.12, 0xffffff, CAMO, { y: 0.006, z: -0.15 }, 8, 0.004);
        p.box(0.003, 0.03, 0.02, SHADE, CAMO, { y: 0.02, z: -0.15 });
        p.box(0.03, 0.002, 0.012, SHADE, CAMO, { y: 0.006, z: -0.14 });
        for (const s of [-1, 1]) {
          p.box(0.03, 0.003, 0.014, SHADE, CAMO, { x: s * 0.028, y: -0.002, z: 0.01 });
          p.tube(0.004, 0.02, 0x3a3f3a, FIXED, { x: s * 0.038, y: -0.008, z: 0.0 }, 6);
          p.tube(0.004, 0.02, 0x3a3f3a, FIXED, { x: s * 0.024, y: -0.008, z: 0.0 }, 6);
          p.box(0.002, 0.012, 0.002, DARK, FIXED, { x: s * 0.012, y: -0.02, z: 0.03 });
        }
        p.box(0.003, 0.012, 0.03, 0xffffff, TEAM, { x: 0.016, y: 0.0, z: -0.02 });
        p.tube(0.002, 0.03, GUN, FIXED, { y: -0.016, z: 0.075 }, 6);
        p.cyl(0.005, 0.006, 0.012, DARK, FIXED, { y: 0.022, z: 0.02 }, 8);
        p.box(0.004, 0.003, 0.003, LIGHT_R, GLOW, { y: 0.03, z: -0.16 });
      }),
      part(
        (p) => {
          for (let k = 0; k < 4; k++) p.box(0.2, 0.0014, 0.007, 0x2b2b2b, FIXED, { ry: (k * Math.PI) / 4 });
          p.cyl(0.004, 0.004, 0.006, DARK, FIXED);
        },
        'spin',
        v(0, 0.03, 0.02),
        'y',
        28,
      ),
      part((p) => [0, 1].forEach((k) => p.box(0.001, 0.034, 0.004, 0x2b2b2b, FIXED, { rx: (k * Math.PI) / 2 })), 'spin', v(0.006, 0.022, -0.2), 'x', 40),
    ],
    height: 0.05,
    radius: 0.12,
  }),
  fighter: () => ({
    parts: [
      part((p) => {
        p.tube(0.013, 0.2, AIRGREY, FIXED, { z: -0.11 }, 10, 0.011);
        p.cone(0.013, 0.06, AIRGREY, FIXED, { z: 0.12, rx: Math.PI / 2 }, 10);
        p.sphere(0.009, GLASS, FIXED, { y: 0.01, z: 0.06, sz: 2.4, sy: 0.8 }, 10);
        p.slab([[0.0, 0.06], [0.11, -0.04], [0.11, -0.06], [-0.11, -0.06], [-0.11, -0.04]], 0.003, AIRGREY, FIXED, { y: -0.002, z: -0.02 });
        p.slab([[0.0, -0.06], [0.05, -0.1], [0.05, -0.115], [-0.05, -0.115], [-0.05, -0.1]], 0.002, AIRGREY, FIXED, { y: 0.0, z: 0.0 });
        for (const s of [-1, 1]) {
          p.box(0.002, 0.04, 0.035, AIRGREY, FIXED, { x: s * 0.016, y: 0.024, z: -0.09, rz: s * 0.35 });
          p.box(0.012, 0.012, 0.03, 0x707680, FIXED, { x: s * 0.017, y: -0.004, z: 0.02 });
          p.tube(0.0022, 0.035, 0xdddddd, FIXED, { x: s * 0.06, y: -0.008, z: -0.03 }, 6);
          p.tube(0.0022, 0.035, 0xdddddd, FIXED, { x: s * 0.09, y: -0.006, z: -0.04 }, 6);
          p.cyl(0.008, 0.008, 0.001, 0xffffff, TEAM, { x: s * 0.07, y: 0.0015, z: -0.06 }, 10);
        }
        p.cyl(0.009, 0.007, 0.012, 0xffa040, GLOW, { z: -0.115, rx: Math.PI / 2 }, 8);
      }),
    ],
    height: 0.03,
    radius: 0.14,
  }),
  bomber: () => ({
    parts: [
      part((p) => {
        p.slab(
          [[0, 0.13], [0.2, -0.04], [0.16, -0.07], [0.12, -0.04], [0.06, -0.07], [0.0, -0.04], [-0.06, -0.07], [-0.12, -0.04], [-0.16, -0.07], [-0.2, -0.04]],
          0.01,
          0x3c4046,
          FIXED,
        );
        p.sphere(0.03, 0x3c4046, FIXED, { y: 0.008, z: 0.03, sy: 0.4, sz: 1.8 }, 10);
        p.box(0.03, 0.006, 0.012, GLASS, FIXED, { y: 0.018, z: 0.08 });
        for (const s of [-1, 1]) p.cyl(0.014, 0.014, 0.001, 0xffffff, TEAM, { x: s * 0.12, y: 0.011, z: -0.02 }, 10);
      }),
    ],
    height: 0.03,
    radius: 0.2,
  }),

  // --- Naval ------------------------------------------------------------------
  fac: () => ({
    parts: [
      part((p) => {
        p.slab([[0, 0.13], [0.03, 0.06], [0.032, -0.12], [-0.032, -0.12], [-0.03, 0.06]], 0.028, NAVY, FIXED, { y: -0.012 });
        p.box(0.04, 0.026, 0.06, 0xb7bdc2, FIXED, { y: 0.028, z: -0.01 });
        p.box(0.036, 0.008, 0.004, GLASS, FIXED, { y: 0.036, z: 0.021 });
        p.cyl(0.002, 0.002, 0.05, METAL, FIXED, { y: 0.06, z: -0.02 }, 4);
        for (const s of [-1, 1]) p.tube(0.005, 0.04, 0x7f878c, FIXED, { x: s * 0.014, y: 0.022, z: -0.1, ry: s * 0.25 }, 8);
        p.box(0.03, 0.002, 0.04, 0xffffff, TEAM, { y: 0.0425, z: -0.01 });
      }),
      part(
        (p) => {
          p.cyl(0.009, 0.011, 0.01, 0xb7bdc2, FIXED, {}, 8);
          p.tube(0.0018, 0.03, GUN, FIXED, { y: 0.003 }, 6);
        },
        'turret',
        v(0, 0.022, 0.07),
      ),
    ],
    height: 0.07,
    radius: 0.12,
  }),
  frigate: () => ({
    parts: [
      part((p) => {
        p.slab([[0, 0.26], [0.05, 0.12], [0.055, -0.22], [-0.055, -0.22], [-0.05, 0.12]], 0.04, NAVY, FIXED, { y: -0.015 });
        p.box(0.08, 0.04, 0.12, 0xb7bdc2, FIXED, { y: 0.045, z: 0.0 });
        p.box(0.06, 0.04, 0.05, 0xb7bdc2, FIXED, { y: 0.085, z: 0.02 });
        p.box(0.056, 0.01, 0.004, GLASS, FIXED, { y: 0.095, z: 0.046 });
        p.cyl(0.012, 0.016, 0.06, 0xb7bdc2, FIXED, { y: 0.13, z: 0.0 }, 6);
        p.box(0.07, 0.02, 0.06, 0xb7bdc2, FIXED, { y: 0.035, z: -0.12 });
        p.box(0.07, 0.002, 0.07, 0x5a6064, FIXED, { y: 0.025, z: -0.185 });
        for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) p.box(0.012, 0.004, 0.012, 0x3c4246, FIXED, { x: -0.02 + j * 0.04, y: 0.026, z: 0.12 + i * 0.014 });
        p.box(0.05, 0.003, 0.05, 0xffffff, TEAM, { y: 0.066, z: -0.03 });
        p.box(0.004, 0.003, 0.003, LIGHT_G, GLOW, { x: 0.04, y: 0.1, z: 0.03 });
        p.box(0.004, 0.003, 0.003, LIGHT_R, GLOW, { x: -0.04, y: 0.1, z: 0.03 });
      }),
      part(
        (p) => {
          p.cyl(0.016, 0.02, 0.016, 0xb7bdc2, FIXED, {}, 10);
          p.tube(0.003, 0.05, GUN, FIXED, { y: 0.004 }, 6);
        },
        'turret',
        v(0, 0.025, 0.17),
      ),
      part((p) => p.box(0.05, 0.016, 0.004, 0x2e3438, FIXED), 'spin', v(0, 0.17, 0.0), 'y', 1.6),
    ],
    height: 0.18,
    radius: 0.22,
  }),
  sub: () => ({
    parts: [
      part((p) => {
        p.tube(0.024, 0.32, 0x22262a, FIXED, { y: 0.0, z: -0.16 }, 12, 0.02);
        p.sphere(0.024, 0x22262a, FIXED, { z: 0.16, sz: 1.8 }, 12);
        p.slab([[-0.012, 0.03], [0.012, 0.03], [0.012, -0.03], [-0.012, -0.03]], 0.035, 0x22262a, FIXED, { y: 0.015, z: 0.06 });
        p.box(0.07, 0.003, 0.016, 0x22262a, FIXED, { y: 0.0, z: -0.15 });
        p.box(0.003, 0.05, 0.016, 0x22262a, FIXED, { y: 0.0, z: -0.15 });
        p.box(0.022, 0.003, 0.02, 0xffffff, TEAM, { y: 0.051, z: 0.06 });
      }),
    ],
    height: 0.06,
    radius: 0.16,
  }),
};

/** Per-country camouflage colours (sRGB). */
const CAMO_BY_ISO: Record<string, number> = {
  TUR: 0x5d6446,
  AZE: 0x606a49,
  ARM: 0x58603f,
  GEO: 0x5a6343,
  ISR: 0x8a8a78,
  IRN: 0xa39773,
  CYP: 0x6b7050,
  LBN: 0x7a7556,
  GRC: 0x5c6347,
  RUS: 0x5b6145,
};
export function camoFor(iso: string): number {
  return CAMO_BY_ISO[iso] ?? 0xb9a57d;
}
