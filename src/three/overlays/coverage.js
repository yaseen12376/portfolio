/**
 * Coverage and blind spots, as the platform's store plan works them out
 * (Buttons: cv_pipeline/store_plan.py, floor.py, dashboard StoreView3D.jsx):
 * the floor on a 0.5 m grid, each cell
 *   - measured: an installed camera sees the floor there (feet included)
 *   - estimated: a camera sees a person's chest there but not the floor
 *     (feet hidden behind a fixture: the position is inferred)
 *   - planned: only the camera being planned would see it
 *   - blind: no camera does
 * A camera sees a point if it projects inside the picture, within the
 * camera's useful range, and the ray from the lens meets none of the set's
 * tall pieces on the way (walls, racking, booths: the occluder boxes Blender
 * exports, standing in for the plan's fixture heights).
 */
import { Box3, Color, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, Ray, Vector3 } from 'three';

import { OVERLAY_LAYER } from './lines.js';

export const CELL = 0.5;
const STATES = { measured: '#2ee6b4', estimated: '#5eead4', planned: '#a78bfa', blind: '#fb6f8a' };

export class Coverage {
  /**
   * @param {import('three').Scene} scene
   * @param {{ area: {x0:number,x1:number,z0:number,z1:number}, free: (x:number, z:number) => boolean,
   *           occluders: Box3[], range?: number }} o
   */
  constructor(scene, { area, free, occluders, range = 12 }) {
    this.occluders = occluders;
    this.range = range;
    this.cells = [];
    for (let x = area.x0 + CELL / 2; x < area.x1; x += CELL) {
      for (let z = area.z0 + CELL / 2; z < area.z1; z += CELL) if (free(x, z)) this.cells.push({ x, z, state: 'blind' });
    }
    const geo = new PlaneGeometry(CELL * 0.9, CELL * 0.9).rotateX(-Math.PI / 2);
    this.material = new MeshBasicMaterial({ transparent: true, opacity: 0.34, depthWrite: false, toneMapped: false });
    this.mesh = new InstancedMesh(geo, this.material, Math.max(1, this.cells.length));
    this.mesh.layers.set(OVERLAY_LAYER);
    this.mesh.renderOrder = 2;
    const m = new Matrix4();
    this.cells.forEach((c, i) => this.mesh.setMatrixAt(i, m.makeTranslation(c.x, 0.016, c.z)));
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.colors = Object.fromEntries(Object.entries(STATES).map(([k, v]) => [k, new Color(v)]));
    this.stats = { measured: 0, estimated: 0, planned: 0, blind: 0 };
    this._ray = new Ray();
    this._hit = new Vector3();
    this._v = new Vector3();
  }

  /** Does `cam` see the point (x, y, z)? */
  sees(cam, x, y, z) {
    const v = this._v.set(x, y, z);
    const d = v.distanceTo(cam.position);
    if (d > this.range) return false;
    v.project(cam);
    if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return false;
    const p = new Vector3(x, y, z);
    this._ray.origin.copy(cam.position);
    this._ray.direction.subVectors(p, cam.position).normalize();
    for (const box of this.occluders) {
      if (box.containsPoint(p)) continue;
      if (this._ray.intersectBox(box, this._hit) && this._hit.distanceTo(cam.position) < d - 0.05) return false;
    }
    return true;
  }

  /**
   * Work every cell out again: `cams` the installed cameras (those with a
   * fault don't count), `planned` the camera being planned, or null.
   */
  measure(cams, planned = null) {
    for (const c of [...cams, planned].filter(Boolean)) {
      c.updateMatrixWorld();
      c.updateProjectionMatrix();
    }
    const n = { measured: 0, estimated: 0, planned: 0, blind: 0 };
    this.cells.forEach((c, i) => {
      let state = 'blind';
      if (cams.some((cam) => this.sees(cam, c.x, 0.05, c.z))) state = 'measured';
      else if (cams.some((cam) => this.sees(cam, c.x, 1.0, c.z))) state = 'estimated';
      else if (planned && (this.sees(planned, c.x, 0.05, c.z) || this.sees(planned, c.x, 1.0, c.z))) state = 'planned';
      c.state = state;
      n[state]++;
      this.mesh.setColorAt(i, this.colors[state]);
    });
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    // Square metres, as the plan reports them.
    this.stats = Object.fromEntries(Object.entries(n).map(([k, v]) => [k, v * CELL * CELL]));
    return this.stats;
  }

  set visible(v) {
    this.mesh.visible = v;
  }

  get visible() {
    return this.mesh.visible;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

