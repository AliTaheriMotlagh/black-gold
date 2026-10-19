/**
 * Procedural building models, scaled to each building's footprint (km). Origin at the
 * footprint centre on the ground; +z faces "front" (south, toward the exit).
 */
import * as THREE from 'three';
import { CAMO, FIXED, GLOW, type ModelDef, type Part, TEAM, part } from './kit';

export interface BuildingModel extends ModelDef {
  emitters: { kind: 'smoke' | 'steam' | 'flare' | 'dust'; pos: THREE.Vector3 }[];
}

const CONCRETE = 0xb9b3a7;
const CONCRETE_D = 0x8f8a80;
const BRICK = 0xc4ae88;
const ROOF = 0x8c9397;
const ROOF_D = 0x6a7074;
const ASPHALT = 0x3a3b3a;
const METAL = 0x9aa0a4;
const STEEL = 0x6c7377;
const GLASS = 0x40607a;
const DARK = 0x262826;
const WHITE = 0xe8e6e0;
const RED = 0xb8342b;
const RED_L = 0xff3a2a;
const AMBER_L = 0xffb030;
const GREEN_L = 0x50ff80;
const SAND = 0xc9b48f;

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function pad(p: Part, s: number, color = CONCRETE_D) {
  p.box(s, 0.004, s, color, FIXED, { y: 0.002 });
}

function flag(p: Part, x: number, z: number, h: number) {
  p.cyl(0.0015, 0.0015, h, METAL, FIXED, { x, y: h / 2, z }, 5);
  p.box(0.002, h * 0.18, h * 0.3, 0xffffff, TEAM, { x, y: h * 0.86, z: z + h * 0.15 });
}

function hangar(p: Part, w: number, len: number, h: number, color = ROOF, xf: { x?: number; z?: number; ry?: number } = {}) {
  const g = new THREE.CylinderGeometry(w / 2, w / 2, len, 12, 1, false, 0, Math.PI);
  g.rotateZ(Math.PI / 2);
  g.rotateY(Math.PI / 2);
  g.scale(1, (h / w) * 2, 1);
  p.add(g, color, FIXED, { x: xf.x, z: xf.z, ry: xf.ry });
  p.box(w * 0.98, h * 0.9, 0.003, CONCRETE_D, FIXED, { x: xf.x, y: h * 0.45, z: (xf.z ?? 0) + len / 2, ry: xf.ry });
}

function tank(p: Part, r: number, h: number, x: number, z: number, color = WHITE) {
  p.cyl(r, r, h, color, FIXED, { x, y: h / 2, z }, 14);
  p.cyl(r * 0.98, r, 0.004, STEEL, FIXED, { x, y: h + 0.002, z }, 14);
}

function antenna(p: Part, x: number, z: number, h: number) {
  p.cyl(0.0012, 0.002, h, STEEL, FIXED, { x, y: h / 2, z }, 4);
  p.box(0.003, 0.003, 0.003, RED_L, GLOW, { x, y: h, z });
}

type Factory = (s: number) => BuildingModel;

export const BUILDING_MODELS: Record<string, Factory> = {
  hq: (s) => ({
    parts: [
      part((p) => {
        pad(p, s);
        // Perimeter wall
        for (const [x, z, w, d] of [[0, -s / 2, s, 0.008], [0, s / 2, s, 0.008], [-s / 2, 0, 0.008, s], [s / 2, 0, 0.008, s]]) p.box(w, 0.016, d, SAND, FIXED, { x, y: 0.008, z });
        // Main block (stepped), command tower and radome
        p.box(s * 0.5, 0.06, s * 0.32, BRICK, FIXED, { x: -s * 0.08, y: 0.03, z: -s * 0.08 });
        p.box(s * 0.36, 0.05, s * 0.22, BRICK, FIXED, { x: -s * 0.08, y: 0.085, z: -s * 0.1 });
        for (let i = 0; i < 5; i++) p.box(s * 0.44, 0.004, 0.002, GLASS, FIXED, { x: -s * 0.08, y: 0.012 + i * 0.011, z: s * 0.08 + 0.001 });
        p.box(0.06, 0.18, 0.06, CONCRETE, FIXED, { x: s * 0.22, y: 0.09, z: -s * 0.18 });
        p.sphere(0.04, WHITE, FIXED, { x: s * 0.22, y: 0.205, z: -s * 0.18 }, 12);
        p.box(s * 0.5, 0.004, s * 0.32, ROOF_D, FIXED, { x: -s * 0.08, y: 0.112, z: -s * 0.1 });
        // Helipad
        p.cyl(0.07, 0.07, 0.004, ASPHALT, FIXED, { x: s * 0.24, y: 0.004, z: s * 0.24 }, 18);
        p.box(0.05, 0.001, 0.008, WHITE, FIXED, { x: s * 0.24, y: 0.007, z: s * 0.24 });
        p.box(0.008, 0.001, 0.05, WHITE, FIXED, { x: s * 0.24 - 0.02, y: 0.007, z: s * 0.24 });
        p.box(0.008, 0.001, 0.05, WHITE, FIXED, { x: s * 0.24 + 0.02, y: 0.007, z: s * 0.24 });
        // Parked vehicles, dishes, masts
        for (let i = 0; i < 4; i++) p.box(0.022, 0.016, 0.05, 0xffffff, CAMO, { x: -s * 0.36 + i * 0.035, y: 0.008, z: s * 0.3 });
        antenna(p, -s * 0.3, -s * 0.3, 0.2);
        antenna(p, -s * 0.2, -s * 0.34, 0.15);
        p.cyl(0.02, 0.004, 0.006, WHITE, FIXED, { x: -s * 0.02, y: 0.12, z: -s * 0.15, rx: 0.8 }, 12);
        flag(p, s * 0.05, s * 0.2, 0.12);
        p.box(s * 0.3, 0.004, 0.02, 0xffffff, TEAM, { x: -s * 0.08, y: 0.062, z: s * 0.081 });
      }),
      part((p) => p.box(0.07, 0.022, 0.004, 0x2e3438, FIXED), 'spin', v(s * 0.22, 0.25, -s * 0.18), 'y', 1.4),
    ],
    height: 0.26,
    radius: s * 0.75,
    emitters: [],
  }),

  power: (s) => ({
    parts: [
      part((p) => {
        pad(p, s);
        p.box(s * 0.7, 0.07, s * 0.36, ROOF, FIXED, { y: 0.035, z: -s * 0.08 });
        p.box(s * 0.72, 0.004, s * 0.38, ROOF_D, FIXED, { y: 0.072, z: -s * 0.08 });
        for (let i = 0; i < 3; i++) {
          p.cyl(0.018, 0.022, 0.2, CONCRETE, FIXED, { x: -s * 0.25 + i * s * 0.25, y: 0.1, z: -s * 0.32 }, 10);
          p.cyl(0.0185, 0.0185, 0.02, RED, FIXED, { x: -s * 0.25 + i * s * 0.25, y: 0.19, z: -s * 0.32 }, 10);
        }
        // Transformer yard
        for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) p.box(0.03, 0.025, 0.03, STEEL, FIXED, { x: -s * 0.24 + i * 0.05, y: 0.0125, z: s * 0.22 + j * 0.05 });
        for (let i = 0; i < 3; i++) p.box(0.004, 0.06, 0.004, STEEL, FIXED, { x: s * 0.25, y: 0.03, z: s * 0.1 + i * 0.05 });
        p.box(s * 0.3, 0.004, 0.014, 0xffffff, TEAM, { y: 0.06, z: s * 0.101 });
      }),
    ],
    height: 0.22,
    radius: s * 0.7,
    emitters: [0, 1, 2].map((i) => ({ kind: 'smoke' as const, pos: v(-s * 0.25 + i * s * 0.25, 0.21, -s * 0.32) })),
  }),

  nuclear: (s) => {
    const tower = (p: Part, x: number, z: number) => {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        pts.push(new THREE.Vector2(0.07 * (0.75 + 0.45 * (2 * t - 1) * (2 * t - 1)), t * 0.24));
      }
      p.add(new THREE.LatheGeometry(pts, 18), CONCRETE, FIXED, { x, z });
    };
    return {
      parts: [
        part((p) => {
          pad(p, s);
          p.cyl(0.07, 0.07, 0.09, CONCRETE, FIXED, { x: -s * 0.2, y: 0.045, z: s * 0.15 }, 18);
          p.sphere(0.07, WHITE, FIXED, { x: -s * 0.2, y: 0.09, z: s * 0.15, sy: 0.8 }, 16);
          p.box(0.14, 0.05, 0.1, BRICK, FIXED, { x: s * 0.05, y: 0.025, z: s * 0.2 });
          tower(p, s * 0.18, -s * 0.18);
          tower(p, -s * 0.15, -s * 0.22);
          p.box(0.1, 0.004, 0.016, 0xffffff, TEAM, { x: s * 0.05, y: 0.052, z: s * 0.2 });
        }),
      ],
      height: 0.25,
      radius: s * 0.7,
      emitters: [
        { kind: 'steam', pos: v(s * 0.18, 0.25, -s * 0.18) },
        { kind: 'steam', pos: v(-s * 0.15, 0.25, -s * 0.22) },
      ],
    };
  },

  barracks: (s) => ({
    parts: [
      part((p) => {
        pad(p, s, SAND);
        for (let i = 0; i < 3; i++) {
          p.box(s * 0.26, 0.035, s * 0.6, BRICK, FIXED, { x: -s * 0.33 + i * s * 0.33, y: 0.0175, z: -s * 0.08 });
          p.box(s * 0.28, 0.006, s * 0.62, ROOF_D, FIXED, { x: -s * 0.33 + i * s * 0.33, y: 0.038, z: -s * 0.08, rz: 0.05 });
        }
        // Training ground & obstacle course
        for (let i = 0; i < 5; i++) p.box(0.01, 0.012, 0.004, CONCRETE_D, FIXED, { x: -s * 0.3 + i * 0.04, y: 0.006, z: s * 0.36 });
        flag(p, s * 0.38, s * 0.36, 0.09);
        p.box(s * 0.2, 0.004, 0.012, 0xffffff, TEAM, { x: 0, y: 0.036, z: s * 0.221 });
      }),
    ],
    height: 0.09,
    radius: s * 0.7,
    emitters: [],
  }),

  factory: (s) => ({
    parts: [
      part((p) => {
        pad(p, s);
        hangar(p, s * 0.42, s * 0.7, 0.1, ROOF, { x: -s * 0.22, z: -s * 0.05 });
        hangar(p, s * 0.42, s * 0.7, 0.1, ROOF_D, { x: s * 0.22, z: -s * 0.05 });
        p.box(s * 0.9, 0.04, s * 0.16, CONCRETE, FIXED, { y: 0.02, z: s * 0.36 });
        p.cyl(0.016, 0.02, 0.18, CONCRETE_D, FIXED, { x: s * 0.4, y: 0.09, z: -s * 0.42 }, 10);
        // Gantry crane
        for (const x of [-s * 0.45, s * 0.45]) p.box(0.008, 0.12, 0.008, 0xd0a020, FIXED, { x, y: 0.06, z: s * 0.36 });
        p.box(s * 0.92, 0.01, 0.01, 0xd0a020, FIXED, { y: 0.12, z: s * 0.36 });
        p.box(s * 0.36, 0.004, 0.016, 0xffffff, TEAM, { y: 0.041, z: s * 0.36 });
        p.box(0.03, 0.006, 0.003, AMBER_L, GLOW, { x: -s * 0.22, y: 0.04, z: s * 0.3 });
      }),
    ],
    height: 0.18,
    radius: s * 0.7,
    emitters: [{ kind: 'smoke', pos: v(s * 0.4, 0.19, -s * 0.42) }],
  }),

  dronefac: (s) => ({
    parts: [
      part((p) => {
        pad(p, s);
        hangar(p, s * 0.5, s * 0.5, 0.07, ROOF, { x: -s * 0.18, z: -s * 0.15 });
        p.box(s * 0.9, 0.003, 0.06, ASPHALT, FIXED, { y: 0.004, z: s * 0.32 });
        for (let i = 0; i < 6; i++) p.box(0.02, 0.0012, 0.004, WHITE, FIXED, { x: -s * 0.4 + i * s * 0.16, y: 0.006, z: s * 0.32 });
        p.box(0.08, 0.06, 0.08, CONCRETE, FIXED, { x: s * 0.28, y: 0.03, z: -s * 0.2 });
        p.sphere(0.025, WHITE, FIXED, { x: s * 0.28, y: 0.075, z: -s * 0.2 }, 10);
        antenna(p, s * 0.38, -s * 0.38, 0.12);
        p.box(0.06, 0.003, 0.03, 0xffffff, TEAM, { x: s * 0.28, y: 0.061, z: -s * 0.2 });
      }),
    ],
    height: 0.12,
    radius: s * 0.7,
    emitters: [],
  }),

  airbase: (s) => ({
    parts: [
      part((p) => {
        p.box(s, 0.003, s * 0.6, 0x8e8a7c, FIXED, { y: 0.0015 });
        // Runway with markings
        p.box(s * 0.98, 0.004, 0.09, ASPHALT, FIXED, { y: 0.004, z: -s * 0.18 });
        for (let i = 0; i < 14; i++) p.box(0.04, 0.0012, 0.004, WHITE, FIXED, { x: -s * 0.45 + i * s * 0.07, y: 0.0065, z: -s * 0.18 });
        for (const x of [-s * 0.47, s * 0.47]) for (let i = 0; i < 4; i++) p.box(0.016, 0.0012, 0.008, WHITE, FIXED, { x, y: 0.0065, z: -s * 0.18 - 0.03 + i * 0.02 });
        p.box(s * 0.7, 0.004, 0.03, ASPHALT, FIXED, { y: 0.004, z: -s * 0.05 });
        p.box(s * 0.6, 0.004, s * 0.16, 0x4e4f4d, FIXED, { x: -s * 0.1, y: 0.004, z: s * 0.08 });
        // Hardened shelters, control tower
        for (let i = 0; i < 4; i++) hangar(p, 0.09, 0.1, 0.05, 0x7d8170, { x: -s * 0.36 + i * 0.13, z: s * 0.22 });
        p.box(0.04, 0.09, 0.04, CONCRETE, FIXED, { x: s * 0.36, y: 0.045, z: s * 0.12 });
        p.box(0.06, 0.03, 0.06, GLASS, FIXED, { x: s * 0.36, y: 0.105, z: s * 0.12 });
        p.box(0.065, 0.004, 0.065, ROOF_D, FIXED, { x: s * 0.36, y: 0.122, z: s * 0.12 });
        for (let i = 0; i < 10; i++) p.box(0.004, 0.003, 0.004, i % 2 ? GREEN_L : AMBER_L, GLOW, { x: -s * 0.48 + i * s * 0.106, y: 0.007, z: -s * 0.18 + 0.05 });
        p.box(0.08, 0.004, 0.08, 0xffffff, TEAM, { x: s * 0.2, y: 0.0045, z: s * 0.08 });
      }),
      part((p) => p.box(0.04, 0.014, 0.003, 0x2e3438, FIXED), 'spin', v(s * 0.36, 0.14, s * 0.12), 'y', 1.8),
    ],
    height: 0.14,
    radius: s * 0.55,
    emitters: [],
  }),

  shipyard: (s) => ({
    parts: [
      part((p) => {
        pad(p, s);
        p.box(s * 0.3, 0.012, s, CONCRETE, FIXED, { x: -s * 0.35, y: 0.006 });
        p.box(s * 0.3, 0.012, s, CONCRETE, FIXED, { x: s * 0.35, y: 0.006 });
        hangar(p, s * 0.28, s * 0.4, 0.08, ROOF, { x: -s * 0.35, z: -s * 0.2 });
        // Gantry
        for (const x of [-s * 0.22, s * 0.22]) p.box(0.01, 0.16, 0.01, RED, FIXED, { x, y: 0.08, z: s * 0.1 });
        p.box(s * 0.5, 0.014, 0.014, RED, FIXED, { y: 0.16, z: s * 0.1 });
        for (let i = 0; i < 6; i++) p.box(0.03, 0.02, 0.012, [0x2f6fa8, 0xb8342b, 0x3a8f4f, 0xc8a227][i % 4], FIXED, { x: s * 0.35, y: 0.022, z: -s * 0.35 + i * 0.03 });
        p.box(0.1, 0.004, 0.02, 0xffffff, TEAM, { x: -s * 0.35, y: 0.013, z: s * 0.4 });
      }),
    ],
    height: 0.17,
    radius: s * 0.7,
    emitters: [],
  }),

  derrick: (s) => ({
    parts: [
      part((p) => {
        pad(p, s, 0x4a4840);
        p.box(0.03, 0.012, 0.06, DARK, FIXED, { y: 0.006, z: -0.02 });
        // Samson post
        for (const x of [-0.008, 0.008]) p.box(0.004, 0.05, 0.004, 0x2a2a2a, FIXED, { x, y: 0.025, z: 0.0, rz: x > 0 ? -0.1 : 0.1 });
        tank(p, 0.022, 0.04, -s * 0.3, s * 0.25, 0x5a5f5a);
        tank(p, 0.022, 0.04, -s * 0.3, s * 0.05, 0x5a5f5a);
        p.cyl(0.003, 0.004, 0.09, STEEL, FIXED, { x: s * 0.35, y: 0.045, z: -s * 0.35 }, 6);
        p.box(0.01, 0.004, 0.01, 0xffffff, TEAM, { y: 0.014, z: -0.045 });
      }),
      part(
        (p) => {
          p.box(0.008, 0.008, 0.09, 0x2a2a2a, FIXED, { z: 0.0 });
          p.box(0.02, 0.026, 0.01, 0x2a2a2a, FIXED, { y: -0.01, z: 0.045 });
          p.box(0.016, 0.016, 0.018, 0x2a2a2a, FIXED, { y: -0.008, z: -0.042 });
        },
        'rock',
        v(0, 0.052, 0),
        'x',
        2.4,
      ),
    ],
    height: 0.09,
    radius: s * 0.8,
    emitters: [{ kind: 'flare', pos: v(s * 0.35, 0.095, -s * 0.35) }],
  }),

  refinery: (s) => ({
    parts: [
      part((p) => {
        pad(p, s);
        for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) tank(p, 0.045, 0.05, -s * 0.3 + i * 0.11, s * 0.22 + j * 0.11);
        for (let i = 0; i < 3; i++) {
          const h = 0.12 + i * 0.03;
          p.cyl(0.012, 0.014, h, METAL, FIXED, { x: s * 0.12 + i * 0.05, y: h / 2, z: -s * 0.2 }, 10);
          for (let k = 1; k < 4; k++) p.cyl(0.016, 0.016, 0.004, STEEL, FIXED, { x: s * 0.12 + i * 0.05, y: (h * k) / 4, z: -s * 0.2 }, 10);
        }
        // Pipe racks
        for (let i = 0; i < 3; i++) p.tube(0.004, s * 0.8, STEEL, FIXED, { x: -s * 0.4, y: 0.03 + i * 0.008, z: -s * 0.02, ry: Math.PI / 2 }, 6);
        p.cyl(0.004, 0.005, 0.2, STEEL, FIXED, { x: -s * 0.38, y: 0.1, z: -s * 0.38 }, 6);
        p.box(0.08, 0.004, 0.02, 0xffffff, TEAM, { x: -s * 0.2, y: 0.052, z: s * 0.22 });
      }),
    ],
    height: 0.2,
    radius: s * 0.7,
    emitters: [
      { kind: 'flare', pos: v(-s * 0.38, 0.205, -s * 0.38) },
      { kind: 'steam', pos: v(s * 0.22, 0.19, -s * 0.2) },
    ],
  }),

  depot: (s) => ({
    parts: [
      part((p) => {
        pad(p, s, SAND);
        hangar(p, s * 0.4, s * 0.6, 0.05, ROOF, { x: -s * 0.2, z: -s * 0.1 });
        for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) p.box(0.025, 0.02, 0.06, [0x2f6fa8, 0xb8342b, 0x3a8f4f, 0xc8a227][(i + j) % 4], FIXED, { x: s * 0.12 + i * 0.03, y: 0.01 + j * 0.02, z: -s * 0.1 });
        for (let i = 0; i < 5; i++) p.box(0.02, 0.012, 0.02, 0x6b5a3a, FIXED, { x: -s * 0.35 + i * 0.03, y: 0.006, z: s * 0.33 });
        p.box(0.06, 0.004, 0.02, 0xffffff, TEAM, { x: -s * 0.2, y: 0.052, z: s * 0.2 });
      }),
    ],
    height: 0.06,
    radius: s * 0.7,
    emitters: [],
  }),

  research: (s) => ({
    parts: [
      part((p) => {
        pad(p, s);
        p.box(s * 0.6, 0.06, s * 0.3, WHITE, FIXED, { x: -s * 0.1, y: 0.03, z: -s * 0.1 });
        for (let i = 0; i < 4; i++) p.box(s * 0.58, 0.007, 0.002, GLASS, FIXED, { x: -s * 0.1, y: 0.01 + i * 0.013, z: s * 0.05 + 0.001 });
        p.sphere(0.05, 0xdedede, FIXED, { x: s * 0.26, y: 0.02, z: s * 0.2 }, 14);
        p.cyl(0.03, 0.006, 0.008, WHITE, FIXED, { x: s * 0.28, y: 0.08, z: -s * 0.3, rx: 0.9 }, 12);
        p.cyl(0.003, 0.003, 0.06, STEEL, FIXED, { x: s * 0.28, y: 0.04, z: -s * 0.3 }, 5);
        p.box(0.1, 0.004, 0.02, 0xffffff, TEAM, { x: -s * 0.1, y: 0.062, z: -s * 0.1 });
        p.box(0.006, 0.006, 0.006, 0x60c8ff, GLOW, { x: s * 0.26, y: 0.07, z: s * 0.2 });
      }),
    ],
    height: 0.1,
    radius: s * 0.7,
    emitters: [],
  }),

  radar: (s) => ({
    parts: [
      part((p) => {
        pad(p, s);
        p.cyl(0.012, 0.02, 0.1, CONCRETE, FIXED, { y: 0.05 }, 8);
        p.box(0.06, 0.03, 0.04, BRICK, FIXED, { x: s * 0.25, y: 0.015, z: s * 0.25 });
        p.sphere(0.03, WHITE, FIXED, { x: -s * 0.28, y: 0.04, z: s * 0.22 }, 12);
        p.cyl(0.03, 0.03, 0.03, CONCRETE, FIXED, { x: -s * 0.28, y: 0.015, z: s * 0.22 }, 12);
        p.box(0.04, 0.003, 0.03, 0xffffff, TEAM, { x: s * 0.25, y: 0.031, z: s * 0.25 });
      }),
      part(
        (p) => {
          p.box(0.08, 0.035, 0.005, 0x2e3438, FIXED, { rx: -0.25 });
          p.box(0.004, 0.004, 0.004, RED_L, GLOW, { y: 0.02 });
        },
        'spin',
        v(0, 0.12, 0),
        'y',
        1.3,
      ),
    ],
    height: 0.14,
    radius: s * 0.8,
    emitters: [],
  }),

  bunker: (s) => ({
    parts: [
      part((p) => {
        p.cyl(s * 0.45, s * 0.5, 0.025, CONCRETE_D, FIXED, { y: 0.0125 }, 8);
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          p.box(0.025, 0.012, 0.012, SAND, FIXED, { x: Math.sin(a) * s * 0.55, y: 0.006, z: Math.cos(a) * s * 0.55, ry: a });
        }
      }),
      part(
        (p) => {
          p.cyl(0.026, 0.03, 0.022, CONCRETE, FIXED, { y: 0.011 }, 8);
          p.box(0.03, 0.004, 0.004, DARK, FIXED, { y: 0.015, z: 0.028 });
          p.tube(0.002, 0.03, DARK, FIXED, { x: -0.008, y: 0.016, z: 0.02 }, 5);
          p.tube(0.004, 0.025, 0x4b5638, FIXED, { x: 0.012, y: 0.026, z: 0.0 }, 6);
          p.box(0.02, 0.003, 0.01, 0xffffff, TEAM, { y: 0.0235, z: -0.012 });
        },
        'turret',
        v(0, 0.025, 0),
      ),
    ],
    height: 0.06,
    radius: s * 0.7,
    emitters: [],
  }),

  cram: (s) => ({
    parts: [
      part((p) => {
        pad(p, s, SAND);
        p.cyl(0.03, 0.035, 0.02, CONCRETE, FIXED, { y: 0.01 }, 10);
      }),
      part(
        (p) => {
          p.box(0.04, 0.03, 0.04, WHITE, FIXED, { y: 0.015 });
          p.cyl(0.02, 0.02, 0.03, WHITE, FIXED, { y: 0.045 }, 10);
          p.tube(0.006, 0.05, STEEL, FIXED, { y: 0.02, z: 0.01 }, 8);
          for (const s2 of [-1, 1]) for (let i = 0; i < 3; i++) p.tube(0.004, 0.035, 0x4e5a3c, FIXED, { x: s2 * 0.026, y: 0.012 + i * 0.008, z: -0.01 }, 6);
          p.box(0.004, 0.012, 0.03, 0xffffff, TEAM, { x: 0.021, y: 0.015 });
        },
        'turret',
        v(0, 0.02, 0),
      ),
    ],
    height: 0.08,
    radius: s * 0.8,
    emitters: [],
  }),

  samsite: (s) => ({
    parts: [
      part((p) => {
        pad(p, s, SAND);
        // Radar truck + engagement control station
        p.box(0.05, 0.04, 0.09, 0xffffff, CAMO, { x: -s * 0.3, y: 0.02, z: -s * 0.25 });
        p.box(0.07, 0.06, 0.008, 0x3a3f3a, FIXED, { x: -s * 0.3, y: 0.07, z: -s * 0.21, rx: -0.4 });
        p.box(0.05, 0.035, 0.07, 0xffffff, CAMO, { x: s * 0.3, y: 0.0175, z: -s * 0.28 });
        antenna(p, s * 0.38, -s * 0.38, 0.12);
        p.box(0.04, 0.004, 0.06, 0xffffff, TEAM, { x: s * 0.3, y: 0.036, z: -s * 0.28 });
      }),
      part(
        (p) => {
          p.box(0.06, 0.02, 0.1, 0xffffff, CAMO, { y: 0.01 });
          for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) p.tube(0.011, 0.12, 0xffffff, CAMO, { x: -0.012 + i * 0.024, y: 0.03 + j * 0.022, z: -0.05, rx: -0.9 }, 10);
        },
        'turret',
        v(0, 0, s * 0.12),
      ),
    ],
    height: 0.14,
    radius: s * 0.8,
    emitters: [],
  }),

  laser: (s) => ({
    parts: [
      part((p) => {
        pad(p, s);
        p.box(0.06, 0.03, 0.06, WHITE, FIXED, { y: 0.015 });
        p.box(0.06, 0.03, 0.04, 0x2a2f33, FIXED, { x: -s * 0.3, y: 0.015, z: s * 0.3 });
      }),
      part(
        (p) => {
          p.cyl(0.02, 0.024, 0.03, WHITE, FIXED, { y: 0.015 }, 12);
          p.sphere(0.026, 0xdedede, FIXED, { y: 0.045 }, 14);
          p.cyl(0.014, 0.014, 0.006, 0x40c8ff, GLOW, { y: 0.045, z: 0.024, rx: Math.PI / 2 }, 14);
          p.box(0.004, 0.012, 0.03, 0xffffff, TEAM, { x: 0.022, y: 0.015 });
        },
        'turret',
        v(0, 0.03, 0),
      ),
    ],
    height: 0.1,
    radius: s * 0.8,
    emitters: [],
  }),

  silo: (s) => ({
    parts: [
      part((p) => {
        pad(p, s, CONCRETE_D);
        p.cyl(s * 0.25, s * 0.28, 0.02, CONCRETE, FIXED, { y: 0.01 }, 16);
        p.box(s * 0.2, 0.006, s * 0.42, 0x3c4044, FIXED, { x: -s * 0.1, y: 0.023 });
        p.box(s * 0.2, 0.006, s * 0.42, 0x3c4044, FIXED, { x: s * 0.1, y: 0.023 });
        for (let i = 0; i < 6; i++) p.box(0.012, 0.0012, 0.004, i % 2 ? 0xc8a227 : DARK, FIXED, { x: -s * 0.2 + i * 0.012, y: 0.027, z: s * 0.22 });
        p.box(0.08, 0.04, 0.06, CONCRETE, FIXED, { x: s * 0.32, y: 0.02, z: -s * 0.3 });
        antenna(p, s * 0.4, -s * 0.4, 0.1);
        p.box(0.05, 0.004, 0.03, 0xffffff, TEAM, { x: s * 0.32, y: 0.041, z: -s * 0.3 });
        p.box(0.006, 0.004, 0.006, RED_L, GLOW, { x: 0, y: 0.03, z: s * 0.27 });
      }),
    ],
    height: 0.06,
    radius: s * 0.8,
    emitters: [],
  }),

  fob: (s) => ({
    parts: [
      part((p) => {
        p.box(s, 0.002, s, 0xa89878, FIXED, { y: 0.001 });
        // HESCO barrier ring
        const n = 18;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          p.box(0.03, 0.018, 0.016, 0xb09a6c, FIXED, { x: Math.sin(a) * s * 0.46, y: 0.009, z: Math.cos(a) * s * 0.46, ry: a });
        }
        for (let i = 0; i < 3; i++) {
          const g = new THREE.CylinderGeometry(0.03, 0.03, 0.08, 8, 1, false, 0, Math.PI);
          g.rotateZ(Math.PI / 2);
          p.add(g, 0xffffff, CAMO, { x: -s * 0.2 + i * 0.07, y: 0.0, z: -s * 0.1 });
        }
        p.box(0.05, 0.03, 0.04, CONCRETE, FIXED, { x: s * 0.2, y: 0.015, z: s * 0.1 });
        antenna(p, s * 0.25, -s * 0.2, 0.1);
        flag(p, 0, s * 0.25, 0.08);
      }),
    ],
    height: 0.1,
    radius: s * 0.6,
    emitters: [],
  }),
};
