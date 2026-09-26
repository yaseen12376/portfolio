/**
 * Every line an overlay draws (detection brackets, zone outlines, counting
 * lines, skeletons, beams) goes through a SegmentBatch: one fat-line mesh
 * (three's LineSegments2: real pixel widths, antialiased) with a fixed
 * capacity whose buffers are rewritten in place each frame, so a crowd of
 * brackets is one draw call and no allocation.
 *
 * Colours may exceed 1: the post chain's bloom picks those up as glow.
 */
import { Color } from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

/**
 * Overlays live on their own layer: the diorama's camera sees them, a CCTV
 * camera inside the scene does not (its picture gets 2D boxes instead, as the
 * real product draws them).
 */
export const OVERLAY_LAYER = 1;

export class SegmentBatch {
  /**
   * @param {{ capacity?: number, width?: number, opacity?: number, depthTest?: boolean, renderOrder?: number }} o
   */
  constructor({ capacity = 512, width = 2, opacity = 1, depthTest = false, renderOrder = 5 } = {}) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 6);
    this.col = new Float32Array(capacity * 6);
    this.geometry = new LineSegmentsGeometry();
    this.geometry.setPositions(this.pos);
    this.geometry.setColors(this.col);
    this.material = new LineMaterial({
      linewidth: width,
      vertexColors: true,
      transparent: true,
      opacity,
      depthTest,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new LineSegments2(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.layers.set(OVERLAY_LAYER);
    this.n = 0;
  }

  begin() {
    this.n = 0;
    return this;
  }

  /** One segment, a to b, coloured c (a Color, or [r, g, b]); c2 for a gradient. */
  seg(ax, ay, az, bx, by, bz, c, c2 = c) {
    if (this.n >= this.capacity) return this;
    const i = this.n * 6;
    const p = this.pos;
    p[i] = ax;
    p[i + 1] = ay;
    p[i + 2] = az;
    p[i + 3] = bx;
    p[i + 4] = by;
    p[i + 5] = bz;
    const k = this.col;
    const [r, g, b] = c.isColor ? [c.r, c.g, c.b] : c;
    const [r2, g2, b2] = c2.isColor ? [c2.r, c2.g, c2.b] : c2;
    k[i] = r;
    k[i + 1] = g;
    k[i + 2] = b;
    k[i + 3] = r2;
    k[i + 4] = g2;
    k[i + 5] = b2;
    this.n++;
    return this;
  }

  /** A closed or open polyline of [x, y, z] points. */
  poly(points, c, closed = false) {
    for (let i = 0; i < points.length - (closed ? 0 : 1); i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      this.seg(a[0], a[1], a[2], b[0], b[1], b[2], c);
    }
    return this;
  }

  /** A circle on the floor (y), centre (x, z), radius r. */
  circle(x, y, z, r, c, seg = 40) {
    let px = x + r;
    let pz = z;
    for (let i = 1; i <= seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      const nx = x + Math.cos(t) * r;
      const nz = z + Math.sin(t) * r;
      this.seg(px, y, pz, nx, y, nz, c);
      px = nx;
      pz = nz;
    }
    return this;
  }

  /**
   * Detection brackets: the corners of a box around a figure, turned to its
   * heading. (x, z) floor centre, hw/hd half width/depth, h height; `grow`
   * 0..1 animates the corner arms in when a detection first locks on.
   */
  bracket(x, z, heading, hw, hd, h, c, grow = 1) {
    const cs = Math.cos(heading);
    const sn = Math.sin(heading);
    const L = Math.min(hw, hd, h) * 0.42 * grow;
    const w = (lx, lz) => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (const y of [0.02, h]) {
          const [px, pz] = w(sx * hw, sz * hd);
          const [ax, az] = w(sx * (hw - L), sz * hd);
          const [bx, bz] = w(sx * hw, sz * (hd - L));
          const vy = y === h ? h - L : 0.02 + L;
          this.seg(px, y, pz, ax, y, az, c);
          this.seg(px, y, pz, bx, y, bz, c);
          this.seg(px, y, pz, px, vy, pz, c);
        }
      }
    }
    return this;
  }

  end() {
    this.geometry.instanceCount = this.n;
    this.geometry.attributes.instanceStart.data.needsUpdate = true;
    this.geometry.attributes.instanceColorStart.data.needsUpdate = true;
    this.mesh.visible = this.n > 0;
    return this;
  }

  /** LineMaterial needs the size of the target it draws into, in pixels. */
  setResolution(w, h) {
    this.material.resolution.set(w, h);
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Brand colours for overlays, at glow strength (values above 1 bloom). */
export const GLOW = {
  violet: new Color('#8b5cf6').multiplyScalar(1.6),
  turq: new Color('#06d6a0').multiplyScalar(1.5),
  red: new Color('#f0506e').multiplyScalar(1.6),
  amber: new Color('#f59e0b').multiplyScalar(1.5),
  white: new Color('#ffffff').multiplyScalar(1.2),
  grey: new Color('#a1a1aa'),
};
