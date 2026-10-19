/**
 * Water bodies at their real surface levels (ocean 0 m, Caspian −28 m, Dead Sea −415 m,
 * Lake Van 1645 m…). Geometry is merged row runs of water cells; the shader colours by
 * real bathymetry, adds animated waves, sun glint, fresnel sky reflection and shoreline
 * foam, and respects fog of war.
 */
import * as THREE from 'three';
import type { Theater } from '../../geo/theater';
import { VEX } from '../Stage';

export class Water {
  readonly group = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  readonly depthTex: THREE.DataTexture;

  constructor(
    readonly theater: Theater,
    fogTex: THREE.Texture,
    sunDir: THREE.Vector3,
  ) {
    const t = theater;
    // Depth texture (metres below the body's surface, /400, saturating).
    const depth = new Uint8Array(t.w * t.h);
    for (let i = 0; i < depth.length; i++) {
      const id = t.water[i];
      if (!id) continue;
      const d = t.waterLevel(id) - t.height[i];
      depth[i] = Math.max(1, Math.min(255, Math.round((Math.max(0, d) / 400) * 255)));
    }
    this.depthTex = new THREE.DataTexture(depth, t.w, t.h, THREE.RedFormat);
    this.depthTex.magFilter = THREE.LinearFilter;
    this.depthTex.minFilter = THREE.LinearFilter;
    this.depthTex.needsUpdate = true;

    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uDepth: { value: null },
          uFog: { value: null },
          uWorldSize: { value: new THREE.Vector2(t.worldW, t.worldH) },
          uSun: { value: sunDir.clone() },
          uSky: { value: new THREE.Color(0xa9c3dc) },
        },
      ]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      fog: true,
      transparent: false,
      // Land wins ties at the shoreline (sea floors are pushed down in the terrain).
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 2,
    });
    this.material.uniforms.uDepth.value = this.depthTex;
    this.material.uniforms.uFog.value = fogTex;
    this.build();
  }

  private build() {
    const t = this.theater;
    const levels = new Map<number, number[]>();
    // Dilate each body by one cell so the shoreline is decided by the terrain mesh.
    const body = new Uint8Array(t.w * t.h);
    for (let z = 0; z < t.h; z++)
      for (let x = 0; x < t.w; x++) {
        const i = z * t.w + x;
        if (t.water[i]) {
          body[i] = t.water[i];
          continue;
        }
        for (let dz = -1; dz <= 1 && !body[i]; dz++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const nz = z + dz;
            if (nx < 0 || nz < 0 || nx >= t.w || nz >= t.h) continue;
            const id = t.water[nz * t.w + nx];
            if (id) {
              body[i] = id;
              break;
            }
          }
      }
    const c = t.cell;
    for (let z = 0; z < t.h; z++) {
      let x = 0;
      while (x < t.w) {
        const id = body[z * t.w + x];
        if (!id) {
          x++;
          continue;
        }
        let x2 = x;
        while (x2 + 1 < t.w && body[z * t.w + x2 + 1] === id) x2++;
        let arr = levels.get(id);
        if (!arr) levels.set(id, (arr = []));
        arr.push(x * c, z * c, (x2 + 1) * c, (z + 1) * c);
        x = x2 + 1;
      }
    }
    for (const [id, quads] of levels) {
      const y = t.waterLevel(id) * VEX + 0.0005;
      const n = quads.length / 4;
      const pos = new Float32Array(n * 4 * 3);
      const idx = new Uint32Array(n * 6);
      for (let q = 0; q < n; q++) {
        const [x0, z0, x1, z1] = quads.slice(q * 4, q * 4 + 4);
        pos.set([x0, y, z0, x1, y, z0, x0, y, z1, x1, y, z1], q * 12);
        const b = q * 4;
        idx.set([b, b + 2, b + 1, b + 1, b + 2, b + 3], q * 6);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, this.material);
      mesh.renderOrder = 1;
      this.group.add(mesh);
    }
  }

  update(dt: number) {
    this.material.uniforms.uTime.value += dt;
  }
}

const VERT = /* glsl */ `
#include <fog_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
uniform sampler2D uDepth;
uniform sampler2D uFog;
uniform vec2 uWorldSize;
uniform vec3 uSun;
uniform vec3 uSky;
varying vec3 vWorld;

float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), u.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), u.x), u.y); }

vec3 waveNormal(vec2 p, float scale) {
  float t = uTime;
  vec2 q = p * scale;
  float e = 0.08;
  float h = n2(q + vec2(t * 0.6, t * 0.4)) + 0.5 * n2(q * 2.3 - vec2(t * 0.9, -t * 0.5)) + 0.25 * n2(q * 5.1 + t);
  float hx = n2(q + vec2(e, 0) + vec2(t * 0.6, t * 0.4)) + 0.5 * n2((q + vec2(e, 0)) * 2.3 - vec2(t * 0.9, -t * 0.5)) + 0.25 * n2((q + vec2(e, 0)) * 5.1 + t);
  float hz = n2(q + vec2(0, e) + vec2(t * 0.6, t * 0.4)) + 0.5 * n2((q + vec2(0, e)) * 2.3 - vec2(t * 0.9, -t * 0.5)) + 0.25 * n2((q + vec2(0, e)) * 5.1 + t);
  return normalize(vec3(-(hx - h) / e, 3.0, -(hz - h) / e));
}

void main() {
  vec2 uv = vWorld.xz / uWorldSize;
  float depth = texture2D(uDepth, uv).r;
  vec3 V = normalize(cameraPosition - vWorld);
  float camD = length(cameraPosition - vWorld);
  // Wave scale follows zoom so the surface always has texture.
  float scale = 6.0 / max(0.3, camD * 0.08);
  float far = smoothstep(60.0, 600.0, camD);
  vec3 N = normalize(mix(waveNormal(vWorld.xz, scale), vec3(0.0, 1.0, 0.0), far * 0.85));
  vec3 deep = vec3(0.02, 0.1, 0.17);
  vec3 mid = vec3(0.03, 0.23, 0.32);
  vec3 shallow = vec3(0.09, 0.42, 0.45);
  float d = smoothstep(0.0, 0.35, depth);
  vec3 col = mix(shallow * 0.85, mid, smoothstep(0.0, 0.03, depth));
  col = mix(col, deep, d);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  col = mix(col, uSky * 0.7, fres * 0.3);
  vec3 H = normalize(uSun + V);
  float spec = pow(max(dot(N, H), 0.0), mix(220.0, 40.0, far)) * mix(2.4, 0.35, far);
  col += vec3(1.0, 0.94, 0.82) * spec;
  // Shoreline foam
  float foam = smoothstep(0.004, 0.0, depth) * (0.5 + 0.5 * n2(vWorld.xz * 6.0 + uTime));
  col = mix(col, vec3(0.85, 0.9, 0.9), foam * 0.25);
  float fv = texture2D(uFog, uv).r;
  col *= mix(0.68, 1.0, smoothstep(0.05, 0.45, fv)) * mix(0.85, 1.0, smoothstep(0.55, 0.95, fv));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;
