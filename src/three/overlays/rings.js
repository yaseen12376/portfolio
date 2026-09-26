/**
 * Floor rings: a soft ring on the floor under each tracked person, at the
 * point the tracker uses (the feet, where lines are crossed and zones
 * entered). Calmer than boxes, for the chapters where the story is a place,
 * not a detection. One instanced mesh, one draw call for everyone; colour
 * carries state (shopper, staff, dwelling, flagged, party).
 */
import { CanvasTexture, Color, InstancedMesh, MeshBasicMaterial, Object3D, PlaneGeometry, SRGBColorSpace } from 'three';

import { OVERLAY_LAYER } from './lines.js';

/** Each set of rings owns its texture (disposed with it): no GPU leftovers. */
function ring() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  // A crisp ring with a soft glow either side and a faint fill.
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0.10)');
  grd.addColorStop(0.62, 'rgba(255,255,255,0.14)');
  grd.addColorStop(0.72, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.78, 'rgba(255,255,255,1)');
  grd.addColorStop(0.84, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

const o = new Object3D();
const col = new Color();

export class Rings {
  /** @param {import('three').Object3D} parent */
  constructor(parent, { capacity = 48, size = 0.62, y = 0.016 } = {}) {
    const geo = new PlaneGeometry(size, size);
    geo.rotateX(-Math.PI / 2);
    this.material = new MeshBasicMaterial({ map: ring(), transparent: true, depthWrite: false, toneMapped: false });
    this.mesh = new InstancedMesh(geo, this.material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.layers.set(OVERLAY_LAYER);
    this.mesh.count = 0;
    this.y = y;
    this.capacity = capacity;
    this.n = 0;
    parent.add(this.mesh);
  }

  begin() {
    this.n = 0;
  }

  /** A ring at (x, z): `color` (css or Color), `scale` (1 is a person's), `strength` 0..1. */
  add(x, z, color, scale = 1, strength = 1) {
    if (this.n >= this.capacity) return;
    o.position.set(x, this.y, z);
    o.scale.setScalar(scale);
    o.updateMatrix();
    this.mesh.setMatrixAt(this.n, o.matrix);
    this.mesh.setColorAt(this.n, col.set(color).multiplyScalar(1.25 * strength));
    this.n++;
  }

  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  set visible(v) {
    this.mesh.visible = v;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.map.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
