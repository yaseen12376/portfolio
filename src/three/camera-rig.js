/**
 * Camera rig for a diorama.
 *
 *  - fit(): the mirror of bake_scene.py fit(). Given the scene's bounds, view
 *    direction and field of view, the target and distance that frame the whole
 *    collectible at a given aspect, inside a safe area: `insets` reserve a
 *    fraction of each edge (for a caption chip on a card), and a lens shift
 *    centres the collectible in what is left, the way a view camera's rising
 *    front does, so nothing tilts.
 *  - Shots: a chapter can ask for a close-up (a point to look at, a turn, a
 *    zoom). Every part of the camera moves on critically damped springs, so a
 *    change of shot is one continuous, unhurried move.
 *  - Orbit: drag turns the diorama around the current shot and lets go back
 *    to it. Limited, so it stays a display piece, not a free-flying camera.
 *  - Parallax: a few degrees toward the cursor, so it feels alive at rest.
 */
import { MathUtils, PerspectiveCamera, Vector3 } from 'three';

const UP = new Vector3(0, 1, 0);
const NONE = { t: 0, r: 0, b: 0, l: 0 };

export function fit(bounds, dir, fovDeg, aspect, margin = 1.06, insets = NONE, hull = null) {
  const [lo, hi] = bounds;
  const box = [];
  for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) box.push(new Vector3(x, y, z));
  const target = box.reduce((a, c) => a.add(c), new Vector3()).multiplyScalar(1 / 8);
  // The silhouette's hull where the scene has one: the box's empty corners
  // would make the collectible smaller than the frame allows.
  const corners = hull?.length ? hull.map((p) => new Vector3(...p)) : box;
  const d = new Vector3(...dir).normalize();
  const F = d.clone().negate();
  const R = F.clone().cross(UP).normalize();
  const U = R.clone().cross(F).normalize();
  const tv = Math.tan(MathUtils.degToRad(fovDeg) / 2) * (1 - insets.t - insets.b);
  const th = Math.tan(MathUtils.degToRad(fovDeg) / 2) * aspect * (1 - insets.l - insets.r);
  const q = new Vector3();
  const distanceFor = () => {
    let need = 0;
    for (const p of corners) {
      q.subVectors(p, target);
      const depth = q.dot(F);
      need = Math.max(need, Math.abs(q.dot(R)) / th - depth, Math.abs(q.dot(U)) / tv - depth);
    }
    return need;
  };
  // Aim at the middle of what the camera sees, not the middle of the box:
  // a few passes of fit, measure the projected extents, recentre.
  let dist = distanceFor();
  for (let pass = 0; pass < 4; pass++) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of corners) {
      q.subVectors(p, target);
      const z = q.dot(F) + dist;
      const x = q.dot(R) / (z * th);
      const y = q.dot(U) / (z * tv);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    target.addScaledVector(R, ((x0 + x1) / 2) * dist * th).addScaledVector(U, ((y0 + y1) / 2) * dist * tv);
    dist = distanceFor();
  }
  return { target, distance: dist * margin };
}

/** A critically damped spring (stiffness k), stepped with dt. */
function spring(state, target, k, dt) {
  const w = Math.sqrt(k);
  const x = state.x - target;
  const a = -k * x - 2 * w * state.v;
  state.v += a * dt;
  state.x += state.v * dt;
}

const sp = (x = 0) => ({ x, v: 0 });

export class CameraRig {
  /**
   * @param {{ bounds, dir, fov, margin? }} view  from scene.json
   * @param {{ maxYaw?: number, maxPitch?: number, parallax?: number, insets?: {t,r,b,l} }} o
   */
  constructor(view, { maxYaw = 0.6, maxPitch = 0.18, parallax = 0.05, insets = NONE } = {}) {
    this.view = view;
    this.camera = new PerspectiveCamera(view.fov, 1, 0.05, 200);
    this.camera.layers.enable(1); // overlays (overlays/lines.js OVERLAY_LAYER)
    this.home = { target: new Vector3(), distance: 1 };
    this.insets = { ...NONE, ...insets };
    this.yaw = sp();
    this.pitch = sp();
    this.zoom = sp(1);
    this.focus = [sp(), sp(), sp()];
    this.shot = { yaw: 0, pitch: 0, zoom: 1, target: null };
    this.want = { yaw: 0, pitch: 0, zoom: 1 };
    this.drag = null;
    this.hover = { x: 0, y: 0 };
    this.limits = { maxYaw, maxPitch, parallax };
    this.aspect = 1;
    this.dir = new Vector3(...view.dir).normalize();
    this.frame(1, true);
  }

  frame(aspect, snap = false) {
    this.aspect = aspect;
    const { target, distance } = fit(this.view.bounds, this.view.dir, this.view.fov, aspect, this.view.margin ?? 1.06, this.insets, this.view.hull);
    this.home.target.copy(target);
    this.home.distance = distance;
    const c = this.camera;
    c.aspect = aspect;
    const { t, r, b, l } = this.insets;
    if (t || r || b || l) {
      const W = 1000 * aspect;
      c.setViewOffset(W, 1000, (-(l - r) / 2) * W, ((b - t) / 2) * 1000, W, 1000);
    } else c.clearViewOffset();
    c.updateProjectionMatrix();
    if (snap || !this.shot.target) {
      const f = this.shot.target ?? target;
      this.focus.forEach((s, i) => {
        if (snap || !this.shot.target) s.x = f.getComponent(i);
      });
    }
    this.apply();
  }

  setInsets(insets) {
    this.insets = { ...NONE, ...insets };
    this.frame(this.aspect);
  }

  /**
   * Ease to a shot: { target?: [x, y, z], yaw?, pitch?, zoom? } (yaw and pitch
   * in radians, relative to the home view; zoom scales the home distance).
   * Null returns home.
   */
  setShot(s) {
    this.shot = {
      yaw: s?.yaw ?? 0,
      pitch: s?.pitch ?? 0,
      zoom: s?.zoom ?? 1,
      target: s?.target ? new Vector3(...s.target) : null,
    };
    this.drag = null;
    this.want.yaw = this.shot.yaw;
    this.want.pitch = this.shot.pitch;
    this.want.zoom = this.shot.zoom;
  }

  /**
   * Keep looking at a moving point (a followed shopper) without restarting
   * the shot: the focus springs chase it, the turn and zoom stay put.
   */
  aim(target) {
    if (!this.shot.target) this.shot.target = new Vector3();
    this.shot.target.copy(target);
  }

  /** Pointer position over the card, -1..1, for parallax. */
  setHover(x, y) {
    this.hover.x = x;
    this.hover.y = y;
  }

  beginDrag() {
    this.drag = { yaw: this.want.yaw, pitch: this.want.pitch };
  }

  /** dx, dy: pointer travel as a fraction of the card's width/height. */
  dragBy(dx, dy) {
    if (!this.drag) return;
    const { maxYaw, maxPitch } = this.limits;
    const s = this.shot;
    this.want.yaw = MathUtils.clamp(this.drag.yaw - dx * 2.4, s.yaw - maxYaw, s.yaw + maxYaw);
    this.want.pitch = MathUtils.clamp(this.drag.pitch + dy * 1.2, s.pitch - maxPitch, s.pitch + maxPitch);
  }

  endDrag() {
    this.drag = null;
    this.want.yaw = this.shot.yaw;
    this.want.pitch = this.shot.pitch;
  }

  /** Back to the home view, on the springs. */
  reset() {
    this.setShot(null);
  }

  setZoom(z) {
    this.want.zoom = MathUtils.clamp(z, 0.3, 1.15);
  }

  /** True while anything is still moving. */
  get moving() {
    const v = Math.abs(this.yaw.v) + Math.abs(this.pitch.v) + Math.abs(this.zoom.v) + this.focus.reduce((a, s) => a + Math.abs(s.v), 0);
    return v > 1e-4 || !!this.drag;
  }

  update(dt) {
    const p = this.limits.parallax;
    const dragging = !!this.drag;
    const ty = this.want.yaw + (dragging ? 0 : this.hover.x * p);
    const tp = this.want.pitch + (dragging ? 0 : -this.hover.y * p * 0.6);
    spring(this.yaw, ty, dragging ? 160 : 30, dt);
    spring(this.pitch, tp, dragging ? 160 : 30, dt);
    spring(this.zoom, this.want.zoom, 22, dt);
    const f = this.shot.target ?? this.home.target;
    this.focus.forEach((s, i) => spring(s, f.getComponent(i), 22, dt));
    this.apply();
  }

  apply() {
    const dir = this.dir.clone().applyAxisAngle(UP, this.yaw.x);
    const right = dir.clone().cross(UP).normalize();
    dir.applyAxisAngle(right, this.pitch.x);
    const target = new Vector3(this.focus[0].x, this.focus[1].x, this.focus[2].x);
    this.camera.position.copy(target).addScaledVector(dir, this.home.distance * this.zoom.x);
    this.camera.lookAt(target);
  }
}
