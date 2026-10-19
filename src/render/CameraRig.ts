import * as THREE from 'three';
import { WORLD_H, WORLD_W } from '../geo/geography';

/** Smoothed RTS camera: focus point + distance + yaw; pitch derives from zoom. */
export class CameraRig {
  readonly target = new THREE.Vector3(WORLD_W / 2, 0, WORLD_H / 2);
  private goal = new THREE.Vector3().copy(this.target);
  distance = 80;
  private goalDistance = 80;
  yaw = 0;
  private goalYaw = 0;
  readonly minDist = 16;
  readonly maxDist = 260;
  private shakeAmt = 0;
  private shakeT = 0;
  /** Autopilot orbit for menus. */
  orbit = false;

  constructor(readonly camera: THREE.PerspectiveCamera, private groundAt: (x: number, z: number) => number) {}

  get pitch() {
    const t = (this.distance - this.minDist) / (this.maxDist - this.minDist);
    return THREE.MathUtils.lerp(0.72, 1.22, Math.pow(t, 0.7));
  }

  jumpTo(x: number, z: number, distance?: number) {
    this.goal.set(x, 0, z);
    this.target.copy(this.goal);
    if (distance !== undefined) this.distance = this.goalDistance = distance;
  }

  focus(x: number, z: number) {
    this.goal.set(x, 0, z);
  }

  /** Pan by screen-space pixel delta. */
  panPixels(dx: number, dy: number, viewportH: number) {
    const worldPerPixel = (2 * this.distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / viewportH;
    this.panWorld(-dx * worldPerPixel, (dy * worldPerPixel) / Math.sin(this.pitch));
  }

  /** Pan in camera-aligned world units (right, forward). */
  panWorld(right: number, forward: number) {
    const s = Math.sin(this.goalYaw);
    const c = Math.cos(this.goalYaw);
    this.goal.x += right * c - forward * s;
    this.goal.z += -right * s - forward * c;
    this.clampGoal();
  }

  zoom(factor: number, anchor?: THREE.Vector3) {
    const prev = this.goalDistance;
    this.goalDistance = THREE.MathUtils.clamp(this.goalDistance * factor, this.minDist, this.maxDist);
    if (anchor) {
      // Keep the point under the cursor stable while zooming.
      const k = 1 - this.goalDistance / prev;
      this.goal.x += (anchor.x - this.goal.x) * k;
      this.goal.z += (anchor.z - this.goal.z) * k;
      this.clampGoal();
    }
  }

  rotate(delta: number) {
    this.goalYaw += delta;
  }

  shake(amount: number) {
    this.shakeAmt = Math.min(3, this.shakeAmt + amount);
  }

  private clampGoal() {
    this.goal.x = THREE.MathUtils.clamp(this.goal.x, 0, WORLD_W);
    this.goal.z = THREE.MathUtils.clamp(this.goal.z, 0, WORLD_H);
  }

  update(dt: number) {
    if (this.orbit) {
      this.goalYaw += dt * 0.04;
    }
    const k = 1 - Math.exp(-dt * 10);
    this.target.lerp(this.goal, k);
    this.distance += (this.goalDistance - this.distance) * k;
    this.yaw += (this.goalYaw - this.yaw) * k;
    const ground = Math.max(0, this.groundAt(this.target.x, this.target.z));
    this.target.y += (ground - this.target.y) * k;
    const p = this.pitch;
    const d = this.distance;
    const cam = this.camera;
    cam.position.set(
      this.target.x + Math.sin(this.yaw) * Math.cos(p) * d,
      this.target.y + Math.sin(p) * d,
      this.target.z + Math.cos(this.yaw) * Math.cos(p) * d,
    );
    // Avoid clipping into mountains
    const under = this.groundAt(cam.position.x, cam.position.z) + 3;
    if (cam.position.y < under) cam.position.y = under;
    cam.lookAt(this.target);
    if (this.shakeAmt > 0.01) {
      this.shakeT += dt * 40;
      cam.position.x += Math.sin(this.shakeT * 1.3) * this.shakeAmt * 0.6;
      cam.position.y += Math.sin(this.shakeT * 1.7) * this.shakeAmt * 0.4;
      cam.position.z += Math.cos(this.shakeT * 1.1) * this.shakeAmt * 0.6;
      this.shakeAmt *= Math.exp(-dt * 4);
    }
  }
}
