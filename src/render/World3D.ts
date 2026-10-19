/**
 * The 3D world view: stage + camera + terrain + water + overlays. Owns no game state;
 * Game.ts feeds it the simulation each frame.
 */
import * as THREE from 'three';
import type { Theater } from '../geo/theater';
import { Stage, type Quality } from './Stage';
import { CameraRig } from './CameraRig';
import { Terrain } from './terrain/Terrain';
import { Water } from './terrain/Water';

export class World3D {
  readonly stage: Stage;
  readonly rig: CameraRig;
  readonly terrain: Terrain;
  readonly water: Water;
  private elapsed = 0;

  constructor(
    canvas: HTMLCanvasElement,
    readonly theater: Theater,
    baseTexture: THREE.Texture,
    quality: Quality,
  ) {
    this.stage = new Stage(canvas, quality);
    this.rig = new CameraRig(this.stage.camera);
    this.rig.bounds = { w: theater.worldW, h: theater.worldH };
    this.terrain = new Terrain(theater, baseTexture);
    this.terrain.lod = this.stage.profile.lod;
    this.terrain.maxZoom = this.stage.profile.maxZoom;
    this.stage.scene.add(this.terrain.group);
    this.water = new Water(theater, this.terrain.fogTex, this.stage.sunDir);
    this.stage.scene.add(this.water.group);
    this.rig.groundAt = (x, z) => this.terrain.surfaceAt(x, z);
  }

  /** Per-frame camera/terrain/water update and render. */
  frame(dt: number) {
    this.elapsed += dt;
    this.rig.update(dt);
    this.terrain.update(this.stage.camera, dt);
    this.water.update(dt);
    this.stage.updateLighting(this.rig.target, this.rig.dist);
    // Political tint fades in as you zoom out to the strategic map.
    const strat = THREE.MathUtils.smoothstep(this.rig.dist, 80, 400);
    this.terrain.shared.uTerritoryAlpha.value = strat * 0.32 + this.politicalBoost * 0.3;
  }

  politicalBoost = 0;

  render(dt: number) {
    this.stage.render(dt);
  }

  pickGround(ndcX: number, ndcY: number): THREE.Vector3 | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.stage.camera);
    return this.terrain.raycast(ray.ray);
  }
}
