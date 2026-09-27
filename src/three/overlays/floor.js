/**
 * What the analytics paint on the floor: zones, a heatmap that builds up
 * from where people actually walked and stood, and fading trails behind
 * tracked figures. All of it sits a few millimetres above the baked floor,
 * drawn after it, never written to depth.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RGBAFormat,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
} from 'three';

import { inPoly } from '../sim/grid.js';
import { OVERLAY_LAYER } from './lines.js';

// ---------------------------------------------------------------- zones

export class Zone {
  /**
   * @param {import('three').Object3D} parent
   * @param {{ points: number[][], color: string | Color, opacity?: number, y?: number }} o  points: [[x, z], ...]
   */
  constructor(parent, { points, color, opacity = 0.16, y = 0.006 }) {
    this.color = new Color(color);
    this.material = new MeshBasicMaterial({
      color: this.color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    });
    this.base = opacity;
    this.mesh = new Mesh(new BufferGeometry(), this.material);
    this.mesh.position.y = y;
    this.mesh.renderOrder = 2;
    this.mesh.layers.set(OVERLAY_LAYER);
    parent.add(this.mesh);
    this.setPoints(points);
  }

  setPoints(points) {
    this.points = points.map((p) => [...p]);
    const shape = new Shape(this.points.map(([x, z]) => ({ x, y: -z })));
    const g = new ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
  }

  contains(x, z) {
    return inPoly(x, z, this.points);
  }

  /** [x, y, z] outline points, for a SegmentBatch. */
  outline(y = 0.008) {
    return this.points.map(([x, z]) => [x, y, z]);
  }

  centroid() {
    const n = this.points.length;
    return this.points.reduce((a, [x, z]) => [a[0] + x / n, a[1] + z / n], [0, 0]);
  }

  /** 0..1: how strongly the zone is lit (occupied, selected). */
  glow(k) {
    this.material.opacity = this.base * (1 + k * 1.6);
  }

  set visible(v) {
    this.mesh.visible = v;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

// ---------------------------------------------------------------- heatmap

// Transparent, then violet, amber and a hot rose-white: the dashboard's ramp.
// Opaque enough to read on a warm wooden floor, where violet and amber at
// half strength all but vanish.
const RAMP = [
  [0.0, [124, 77, 240], 0],
  [0.12, [124, 77, 240], 0.5],
  [0.45, [245, 158, 11], 0.74],
  [0.8, [236, 64, 104], 0.86],
  [1.0, [255, 232, 220], 0.92],
];
// Logarithmic, as heatmaps of footfall are drawn: one busy spot would
// otherwise flatten every lane and aisle to nothing.
const LOG_K = 24;
const LOG_NORM = 1 / Math.log1p(LOG_K);

function ramp(t) {
  for (let i = 1; i < RAMP.length; i++) {
    const [t1, c1, a1] = RAMP[i];
    if (t <= t1) {
      const [t0, c0, a0] = RAMP[i - 1];
      const k = (t - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k, a0 + (a1 - a0) * k];
    }
  }
  return [...RAMP[RAMP.length - 1][1], RAMP[RAMP.length - 1][2]];
}

export class HeatMap {
  /**
   * Summed floor occupancy, like the product's GET /stats/heatmap: every
   * frame each tracked person adds a soft splat where they stand, so places
   * people linger glow hotter than places they pass through.
   * @param {import('three').Object3D} parent
   * @param {import('../sim/grid.js').NavGrid} grid  for the floor's extent
   */
  constructor(parent, grid, { res = 2, sigma = 0.16, y = 0.005 } = {}) {
    this.cell = grid.cell / res;
    this.w = grid.w * res;
    this.h = grid.h * res;
    this.x0 = grid.x0;
    this.z0 = grid.z0;
    this.v = new Float32Array(this.w * this.h);
    this.px = new Uint8Array(this.w * this.h * 4);
    this.tex = new DataTexture(this.px, this.w, this.h, RGBAFormat);
    this.tex.colorSpace = SRGBColorSpace;
    this.tex.magFilter = LinearFilter;
    this.tex.minFilter = LinearFilter;
    this.tex.needsUpdate = true;
    const r = Math.ceil((sigma * 2.5) / this.cell);
    this.kernel = [];
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        const d2 = (di * di + dj * dj) * this.cell * this.cell;
        const k = Math.exp(-d2 / (2 * sigma * sigma));
        if (k > 0.02) this.kernel.push([di, dj, k]);
      }
    }
    const geo = new PlaneGeometry(this.w * this.cell, this.h * this.cell);
    geo.rotateX(-Math.PI / 2);
    this.material = new MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, toneMapped: false });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.position.set(this.x0 + (this.w * this.cell) / 2, y, this.z0 + (this.h * this.cell) / 2);
    this.mesh.renderOrder = 1;
    this.mesh.layers.set(OVERLAY_LAYER);
    parent.add(this.mesh);
    this.max = 1e-6;
    this.clock = 0;
    this.dirty = true;
  }

  /** Add `w` (seconds of presence) at (x, z). */
  add(x, z, w) {
    const i0 = Math.floor((x - this.x0) / this.cell);
    const j0 = Math.floor((z - this.z0) / this.cell);
    for (const [di, dj, k] of this.kernel) {
      const i = i0 + di;
      const j = j0 + dj;
      if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
      const c = j * this.w + i;
      this.v[c] += w * k;
      if (this.v[c] > this.max) this.max = this.v[c];
    }
    this.dirty = true;
  }

  /** Re-colour the texture at most `hz` times a second. */
  update(dt, hz = 6) {
    this.clock += dt;
    // Hidden, it keeps counting (add) but isn't re-coloured until it's shown.
    if (!this.mesh.visible || !this.dirty || this.clock < 1 / hz) return;
    this.clock = 0;
    this.dirty = false;
    const { w, h, v, px } = this;
    const inv = 1 / this.max;
    for (let j = 0; j < h; j++) {
      // DataTexture row 0 is v = 0, which the rotated plane puts at the far (+z) edge.
      const row = (h - 1 - j) * w;
      for (let i = 0; i < w; i++) {
        const t = Math.log1p(Math.min(1, v[j * w + i] * inv) * LOG_K) * LOG_NORM;
        const o = (row + i) * 4;
        if (t < 0.05) {
          px[o + 3] = 0;
          continue;
        }
        const [r, g, b, a] = ramp(t);
        px[o] = r;
        px[o + 1] = g;
        px[o + 2] = b;
        px[o + 3] = a * 255;
      }
    }
    this.tex.needsUpdate = true;
  }

  /**
   * The n hottest places, far enough apart to be different places. One pass
   * keeps the hottest few dozen cells (a full sort of the grid every call
   * cost milliseconds a frame); only if they all crowd one spot is the whole
   * grid sorted.
   */
  hottest(n = 3, apart = 0.6) {
    const v = this.v;
    const K = Math.max(48, n * 16);
    const top = [];
    let floor = 0;
    for (let c = 0; c < v.length; c++) {
      const x = v[c];
      if (x <= floor) continue;
      let k = top.length;
      while (k > 0 && v[top[k - 1]] < x) k--;
      top.splice(k, 0, c);
      if (top.length > K) top.pop();
      if (top.length === K) floor = v[top[K - 1]];
    }
    const pick = (idx) => {
      const out = [];
      for (const c of idx) {
        if (v[c] <= 0 || out.length >= n) break;
        const x = this.x0 + ((c % this.w) + 0.5) * this.cell;
        const z = this.z0 + (Math.floor(c / this.w) + 0.5) * this.cell;
        if (out.every((p) => Math.hypot(p.x - x, p.z - z) > apart)) out.push({ x, z, v: v[c] / this.max });
      }
      return out;
    };
    const out = pick(top);
    if (out.length >= n || top.length < K) return out;
    return pick([...v.keys()].sort((a, b) => v[b] - v[a]));
  }

  reset() {
    this.v.fill(0);
    this.max = 1e-6;
    this.dirty = true;
  }

  set visible(v) {
    this.mesh.visible = v;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.tex.dispose();
  }
}

// ---------------------------------------------------------------- trails

export class Trails {
  /** Fading ribbons on the floor behind tracked figures. */
  constructor(parent, { max = 16, len = 44, width = 0.035, every = 0.1, y = 0.007 } = {}) {
    this.max = max;
    this.len = len;
    this.width = width;
    this.every = every;
    this.y = y;
    this.tracks = new Map();
    const verts = max * len * 2;
    this.geometry = new BufferGeometry();
    this.pos = new Float32Array(verts * 3);
    this.col = new Float32Array(verts * 4);
    this.geometry.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geometry.setAttribute('color', new BufferAttribute(this.col, 4));
    const idx = [];
    for (let t = 0; t < max; t++) {
      for (let k = 0; k < len - 1; k++) {
        const a = (t * len + k) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    this.geometry.setIndex(idx);
    this.material = new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide, toneMapped: false });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.layers.set(OVERLAY_LAYER);
    parent.add(this.mesh);
  }

  /** Record where track `id` is now (sampled every `every` seconds). */
  push(id, x, z, color, dt) {
    let t = this.tracks.get(id);
    if (!t) {
      if (this.tracks.size >= this.max) return;
      t = { pts: [], clock: 0, color: new Color(), slot: this.freeSlot() };
      this.tracks.set(id, t);
    }
    t.color.copy(color);
    t.clock += dt;
    const last = t.pts[t.pts.length - 1];
    if (!last || (t.clock >= this.every && Math.hypot(last[0] - x, last[1] - z) > 0.02)) {
      t.pts.push([x, z]);
      if (t.pts.length > this.len) t.pts.shift();
      t.clock = 0;
    } else {
      t.pts[t.pts.length - 1] = [x, z]; // the head follows the figure between samples
    }
  }

  freeSlot() {
    const used = new Set([...this.tracks.values()].map((t) => t.slot));
    for (let s = 0; s < this.max; s++) if (!used.has(s)) return s;
    return 0;
  }

  drop(id) {
    const t = this.tracks.get(id);
    if (!t) return;
    this.col.fill(0, t.slot * this.len * 2 * 4, (t.slot + 1) * this.len * 2 * 4);
    this.tracks.delete(id);
  }

  clear() {
    for (const id of [...this.tracks.keys()]) this.drop(id);
  }

  update() {
    const { len, width, y, pos, col } = this;
    for (const t of this.tracks.values()) {
      const n = t.pts.length;
      const base = t.slot * len * 2;
      for (let k = 0; k < len; k++) {
        const p = t.pts[Math.min(n - 1, Math.max(0, n - len + k))];
        const q = t.pts[Math.min(n - 1, Math.max(0, n - len + k + 1))];
        const r = t.pts[Math.min(n - 1, Math.max(0, n - len + k - 1))];
        let dx = q[0] - r[0];
        let dz = q[1] - r[1];
        const l = Math.hypot(dx, dz) || 1;
        dx /= l;
        dz /= l;
        const age = n - len + k < 0 ? 0 : (k + 1) / len; // oldest samples fade out
        const hw = width * (0.35 + 0.65 * age) * 0.5;
        for (const s of [0, 1]) {
          const v = base + k * 2 + s;
          const sign = s ? 1 : -1;
          pos[v * 3] = p[0] - dz * hw * sign;
          pos[v * 3 + 1] = y;
          pos[v * 3 + 2] = p[1] + dx * hw * sign;
          col[v * 4] = t.color.r;
          col[v * 4 + 1] = t.color.g;
          col[v * 4 + 2] = t.color.b;
          col[v * 4 + 3] = Math.pow(age, 1.6) * 0.85;
        }
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
