import * as THREE from 'three';

/**
 * RTS camera: orbits a ground target. Zoom spans tactical (≈1 km) to strategic
 * (whole theater). Pitch flattens toward a map view as you zoom out, every motion is
 * critically damped, and focus/jump transitions glide.
 */
export class CameraRig {
  readonly target = new THREE.Vector3();
  /** Desired values (input writes these), current values are damped toward them. */
  goal = { x: 0, z: 0, dist: 60, yaw: 0, tilt: 0 };
  dist = 60;
  yaw = 0;
  /** User tilt offset added to the automatic pitch (radians). */
  tilt = 0;
  minDist = 0.9;
  maxDist = 5200;
  bounds = { w: 4000, h: 3600 };
  groundAt: (x: number, z: number) => number = () => 0;
  private shakeAmt = 0;
  private shakeT = 0;
  private groundY = 0;
  orbit = false;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  /** Automatic pitch from zoom: 48° at tactical range → 82° at strategic range. */
  pitchFor(dist: number) {
    const t = THREE.MathUtils.clamp((Math.log(dist) - Math.log(2)) / (Math.log(2500) - Math.log(2)), 0, 1);
    return THREE.MathUtils.degToRad(48 + 34 * t * t);
  }

  jumpTo(x: number, z: number, dist?: number) {
    this.goal.x = this.target.x = x;
    this.goal.z = this.target.z = z;
    if (dist !== undefined) this.goal.dist = this.dist = dist;
  }

  focus(x: number, z: number, dist?: number) {
    this.goal.x = x;
    this.goal.z = z;
    if (dist !== undefined) this.goal.dist = THREE.MathUtils.clamp(dist, this.minDist, this.maxDist);
  }

  /** Pan in screen space, scaled by zoom. */
  pan(dx: number, dz: number) {
    const s = this.dist * 0.0016;
    const c = Math.cos(this.yaw);
    const sn = Math.sin(this.yaw);
    this.goal.x += (dx * c + dz * sn) * s;
    this.goal.z += (-dx * sn + dz * c) * s;
    this.clampGoal();
  }

  /** Pan by a world-space delta (drag-to-pan keeps the grabbed point under the finger). */
  panWorld(dx: number, dz: number) {
    this.goal.x += dx;
    this.goal.z += dz;
    this.target.x += dx;
    this.target.z += dz;
    this.clampGoal();
  }

  zoom(factor: number, anchor?: { x: number; z: number }) {
    const before = this.goal.dist;
    this.goal.dist = THREE.MathUtils.clamp(this.goal.dist * factor, this.minDist, this.maxDist);
    if (anchor) {
      // Zoom toward the cursor.
      const k = 1 - this.goal.dist / before;
      this.goal.x += (anchor.x - this.goal.x) * k;
      this.goal.z += (anchor.z - this.goal.z) * k;
      this.clampGoal();
    }
  }

  rotate(da: number) {
    this.goal.yaw += da;
  }

  addTilt(d: number) {
    this.goal.tilt = THREE.MathUtils.clamp(this.goal.tilt + d, -0.5, 0.25);
  }

  shake(amount: number) {
    this.shakeAmt = Math.min(1.2, this.shakeAmt + amount);
  }

  private clampGoal() {
    this.goal.x = THREE.MathUtils.clamp(this.goal.x, 0, this.bounds.w);
    this.goal.z = THREE.MathUtils.clamp(this.goal.z, 0, this.bounds.h);
  }

  update(dt: number) {
    if (this.orbit) this.goal.yaw += dt * 0.02;
    const k = 1 - Math.exp(-dt * 9);
    const kz = 1 - Math.exp(-dt * 7);
    this.target.x += (this.goal.x - this.target.x) * k;
    this.target.z += (this.goal.z - this.target.z) * k;
    // Zoom in log space so it feels uniform across scales.
    this.dist = Math.exp(Math.log(this.dist) + (Math.log(this.goal.dist) - Math.log(this.dist)) * kz);
    this.yaw += (this.goal.yaw - this.yaw) * k;
    this.tilt += (this.goal.tilt - this.tilt) * k;
    const gy = this.groundAt(this.target.x, this.target.z);
    this.groundY += (gy - this.groundY) * (1 - Math.exp(-dt * 4));
    this.target.y = this.groundY;

    const pitch = THREE.MathUtils.clamp(this.pitchFor(this.dist) + this.tilt, 0.35, 1.53);
    const horiz = Math.cos(pitch) * this.dist;
    const cam = this.camera;
    cam.position.set(this.target.x + Math.sin(this.yaw) * horiz, this.target.y + Math.sin(pitch) * this.dist, this.target.z + Math.cos(this.yaw) * horiz);
    // Never dip below the terrain at low pitch.
    const under = this.groundAt(cam.position.x, cam.position.z) + this.dist * 0.05;
    if (cam.position.y < under) cam.position.y = under;
    if (this.shakeAmt > 0.001) {
      this.shakeT += dt * 38;
      const s = this.shakeAmt * this.dist * 0.004;
      cam.position.x += Math.sin(this.shakeT * 1.3) * s;
      cam.position.y += Math.sin(this.shakeT * 1.7) * s;
      this.shakeAmt *= Math.exp(-dt * 6);
    }
    cam.lookAt(this.target);
    cam.near = Math.max(0.004, this.dist * 0.004);
    cam.far = Math.max(200, this.dist * 12 + 600);
    cam.updateProjectionMatrix();
  }

  /** Approximate visible ground half-width (km) for LOD decisions. */
  get viewRadius() {
    return this.dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect * 1.2;
  }
}
