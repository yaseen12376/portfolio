/**
 * Moving a fixture by hand, with collision.
 *
 * A fixture has a footprint (half extents in its own x/z, from Blender). While
 * it is dragged, a ghost on the floor shows where the pointer is asking for:
 * turquoise where it fits, red where it would overlap a wall, a fixture or
 * another moving piece. The fixture itself only ever moves to places that fit,
 * so it slides along obstacles instead of passing through them. On release
 * its footprint is stamped on the nav grid and every figure re-plans.
 */
import { Color, EdgesGeometry, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';

import { OVERLAY_LAYER } from '../overlays/lines.js';
import { footprint } from './grid.js';

export const OK = new Color('#06d6a0');
export const BLOCKED = new Color('#f0506e');

export class FixtureDrag {
  /**
   * @param {{ grid, scene, object, key?: string, half: [number, number], offset?: [number, number],
   *           snap?: number, onChange?: (state: string) => void }} o
   */
  constructor({ grid, scene, object, key, half, offset = [0, 0], snap = 0.05, onChange }) {
    this.grid = grid;
    this.object = object;
    this.key = key ?? object.name;
    this.half = half;
    this.offset = offset;
    this.snap = snap;
    this.onChange = onChange;
    this.home = { x: object.position.x, z: object.position.z };
    this.grab = { dx: 0, dz: 0 };
    this.valid = true;

    const geo = new PlaneGeometry(half[0] * 2, half[1] * 2);
    geo.rotateX(-Math.PI / 2);
    geo.translate(offset[0], 0, offset[1]);
    this.fill = new MeshBasicMaterial({ color: OK, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false });
    this.edge = new LineBasicMaterial({ color: OK, transparent: true, opacity: 0.9, toneMapped: false });
    this.ghost = new Mesh(geo, this.fill);
    this.ghost.add(new LineSegments(new EdgesGeometry(geo), this.edge));
    this.ghost.position.y = 0.008;
    this.ghost.renderOrder = 3;
    this.ghost.traverse((o) => o.layers.set(OVERLAY_LAYER));
    this.ghost.visible = false;
    scene.add(this.ghost);
    this.stamp();
  }

  poly(x, z) {
    return footprint(x, z, this.half[0], this.half[1], this.object.rotation.y, this.offset[0], this.offset[1]);
  }

  stamp() {
    this.grid.stamp(this.key, this.poly(this.object.position.x, this.object.position.z));
  }

  fits(x, z) {
    return this.grid.fits(this.poly(x, z), this.key);
  }

  /** point: where the pointer ray meets the floor (Vector3). */
  start(point) {
    this.anim = null;
    this.grab.dx = this.object.position.x - point.x;
    this.grab.dz = this.object.position.z - point.z;
    this.ghost.visible = true;
    this.show(this.object.position.x, this.object.position.z, true);
    this.onChange?.('dragging');
  }

  move(point) {
    const s = (v) => Math.round(v / this.snap) * this.snap;
    const x = s(point.x + this.grab.dx);
    const z = s(point.z + this.grab.dz);
    const ok = this.fits(x, z);
    this.show(x, z, ok);
    if (ok) {
      this.object.position.x = x;
      this.object.position.z = z;
    }
    this.valid = ok;
  }

  end() {
    this.ghost.visible = false;
    this.stamp();
    this.onChange?.('placed');
  }

  show(x, z, ok) {
    this.ghost.position.x = x;
    this.ghost.position.z = z;
    this.ghost.rotation.y = this.object.rotation.y;
    this.fill.color.copy(ok ? OK : BLOCKED);
    this.edge.color.copy(ok ? OK : BLOCKED);
  }

  /**
   * Move it in code (a chapter's button, a reset, QA), only to a place that
   * fits. It glides there on the scene's own clock (update()), so it pauses
   * with the scene and QA can step it.
   */
  moveTo(x, z, { duration = 0.9 } = {}) {
    if (!this.fits(x, z)) return false;
    const p = this.object.position;
    this.anim = { x0: p.x, z0: p.z, x, z, t: 0, duration };
    // Stamped at the destination at once: nobody plans a route through it.
    this.grid.stamp(this.key, this.poly(x, z));
    return true;
  }

  update(dt) {
    const a = this.anim;
    if (!a) return;
    a.t = Math.min(1, a.t + dt / a.duration);
    const k = a.t < 0.5 ? 4 * a.t ** 3 : 1 - (-2 * a.t + 2) ** 3 / 2; // ease in and out
    this.object.position.x = a.x0 + (a.x - a.x0) * k;
    this.object.position.z = a.z0 + (a.z - a.z0) * k;
    if (a.t >= 1) {
      this.anim = null;
      this.onChange?.('placed');
    }
  }

  reset() {
    return this.moveTo(this.home.x, this.home.z, { duration: 0.7 });
  }

  dispose() {
    this.grid.unstamp(this.key);
    this.ghost.removeFromParent();
    this.ghost.geometry.dispose();
    this.ghost.children[0].geometry.dispose();
    this.fill.dispose();
    this.edge.dispose();
  }
}
