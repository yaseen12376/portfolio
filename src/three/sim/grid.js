/**
 * The floor as the figures see it.
 *
 * Blender rasterises every static footprint between ankle and head height into
 * a 5 cm occupancy grid (scripts/blender/kit/nav.py) and ships it in
 * scene.json. Anything that moves at runtime (a rail being dragged) stamps its
 * own footprint on top. The union is then dilated by a figure's radius, so any
 * path through free cells is a path a whole figure fits along, and a figure
 * can be treated as a point.
 *
 * Coordinates are three.js floor coordinates: x, and z (Blender's -y).
 */

const SQRT2 = Math.SQRT2;

/** Bit-packed rows (MSB first), base64: 1 = blocked. */
function decode(b64, n) {
  const bin = atob(b64);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (bin.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1;
  return out;
}

/** Is point (px, pz) inside polygon [[x, z], ...]? */
export function inPoly(px, pz, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The four corners of a footprint: the piece's position, half extents and
 * centre offset in its own x/z, and its rotation about y.
 */
export function footprint(x, z, hx, hz, rotY = 0, ox = 0, oz = 0) {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  // three.js rotation about +y maps local (x, z) to (x c + z s, -x s + z c).
  return [
    [ox - hx, oz - hz],
    [ox + hx, oz - hz],
    [ox + hx, oz + hz],
    [ox - hx, oz + hz],
  ].map(([lx, lz]) => [x + lx * c + lz * s, z - lx * s + lz * c]);
}

/** A binary min-heap of cells, each pushed with the score it had then. */
class Heap {
  constructor() {
    this.a = [];
    this.s = [];
  }
  push(v, score) {
    const { a, s } = this;
    a.push(v);
    s.push(score);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (s[p] <= s[i]) break;
      [a[p], a[i]] = [a[i], a[p]];
      [s[p], s[i]] = [s[i], s[p]];
      i = p;
    }
  }
  pop() {
    const { a, s } = this;
    const top = a[0];
    const lastA = a.pop();
    const lastS = s.pop();
    if (a.length) {
      a[0] = lastA;
      s[0] = lastS;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && s[l] < s[m]) m = l;
        if (r < a.length && s[r] < s[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        [s[m], s[i]] = [s[i], s[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
}

export class NavGrid {
  /**
   * @param {{ origin: [number, number], cell: number, w: number, h: number, data: string }} nav
   * @param {{ radius?: number }} opts  the figures' radius, for dilation
   */
  constructor(nav, { radius = 0.16 } = {}) {
    this.x0 = nav.origin[0];
    this.z0 = nav.origin[1];
    this.cell = nav.cell;
    this.w = nav.w;
    this.h = nav.h;
    this.n = this.w * this.h;
    this.base = decode(nav.data, this.n);
    this.raw = new Uint8Array(this.n);
    this.occ = new Uint8Array(this.n);
    // Metres from each cell centre to the nearest wall, fixture or plinth
    // edge: routes keep to the middle of aisles, and shortcuts keep arms clear.
    this.clearance = new Float32Array(this.n);
    // The search's working arrays, reused (a stamp per search marks them fresh).
    this.sg = new Float32Array(this.n);
    this.sf = new Float32Array(this.n);
    this.came = new Int32Array(this.n);
    this.seen = new Uint32Array(this.n);
    this.done = new Uint32Array(this.n);
    this.search = 0;
    this.stamps = new Map();
    this.version = 0;
    this.setRadius(radius);
  }

  setRadius(r) {
    this.radius = r;
    const k = Math.ceil(r / this.cell);
    this.kernel = [];
    for (let dj = -k; dj <= k; dj++) {
      for (let di = -k; di <= k; di++) {
        if (Math.hypot(di, dj) * this.cell <= r + this.cell * 0.35) this.kernel.push([di, dj]);
      }
    }
    this.rebuild();
  }

  // ------------------------------------------------------------ cells

  ci(x) {
    return Math.floor((x - this.x0) / this.cell);
  }
  cj(z) {
    return Math.floor((z - this.z0) / this.cell);
  }
  cx(i) {
    return this.x0 + (i + 0.5) * this.cell;
  }
  cz(j) {
    return this.z0 + (j + 0.5) * this.cell;
  }
  inside(i, j) {
    return i >= 0 && j >= 0 && i < this.w && j < this.h;
  }

  /** Free for a figure's centre (dilated). Outside the grid is blocked. */
  free(x, z) {
    const i = this.ci(x);
    const j = this.cj(z);
    return this.inside(i, j) && !this.occ[j * this.w + i];
  }

  /** Free of anything at all (undilated): for placing fixtures. */
  clear(x, z) {
    const i = this.ci(x);
    const j = this.cj(z);
    return this.inside(i, j) && !this.raw[j * this.w + i];
  }

  // ------------------------------------------------------------ dynamic footprints

  cellsIn(poly) {
    // Conservative: a cell counts if its centre is inside the polygon grown by
    // half a cell, so thin fixtures never slip between cell centres.
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const [x, z] of poly) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
    const g = this.cell * 0.5;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const grown = poly.map(([x, z]) => {
      const dx = x - cx;
      const dz = z - cz;
      const l = Math.hypot(dx, dz) || 1;
      return [x + (dx / l) * g * SQRT2, z + (dz / l) * g * SQRT2];
    });
    const out = [];
    for (let j = Math.max(0, this.cj(z0 - g)); j <= Math.min(this.h - 1, this.cj(z1 + g)); j++) {
      for (let i = Math.max(0, this.ci(x0 - g)); i <= Math.min(this.w - 1, this.ci(x1 + g)); i++) {
        if (inPoly(this.cx(i), this.cz(j), grown)) out.push(j * this.w + i);
      }
    }
    return out;
  }

  /** Put (or move) a moving fixture's footprint on the grid. */
  stamp(key, poly) {
    this.stamps.set(key, this.cellsIn(poly));
    this.rebuild();
  }

  unstamp(key) {
    if (this.stamps.delete(key)) this.rebuild();
  }

  /**
   * Would this footprint fit: every cell under it inside the floor and free of
   * walls, fixtures and other moving pieces (ignoring its own stamp)?
   */
  fits(poly, ignore = null) {
    const cells = this.cellsIn(poly);
    if (!cells.length) return false;
    const others = new Set();
    for (const [k, cs] of this.stamps) if (k !== ignore) for (const c of cs) others.add(c);
    for (const [x, z] of poly) if (!this.inside(this.ci(x), this.cj(z))) return false;
    return cells.every((c) => !this.base[c] && !others.has(c));
  }

  rebuild() {
    const { w, h, raw, occ, base } = this;
    raw.set(base);
    for (const cs of this.stamps.values()) for (const c of cs) raw[c] = 1;
    occ.fill(0);
    // The plinth's edge is an obstacle too: nobody stands with a foot over it.
    const edge = Math.ceil(this.radius / this.cell - 0.5);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        if (i < edge || j < edge || i >= w - edge || j >= h - edge) occ[j * w + i] = 1;
      }
    }
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        if (!raw[j * w + i]) continue;
        for (const [di, dj] of this.kernel) {
          const a = i + di;
          const b = j + dj;
          if (a >= 0 && b >= 0 && a < w && b < h) occ[b * w + a] = 1;
        }
      }
    }
    this.measureClearance();
    this.version++;
  }

  /**
   * Distance to the nearest obstacle for every cell: a two-pass chamfer
   * transform (within about 5% of Euclidean), seeded with the distance to the
   * plinth's edge, so the edge counts as a wall too.
   */
  measureClearance() {
    const { w, h, raw, clearance: d, cell } = this;
    const D = cell * SQRT2;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        d[k] = raw[k] ? 0 : Math.min(i + 0.5, j + 0.5, w - i - 0.5, h - j - 0.5) * cell;
      }
    }
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        let v = d[k];
        if (!v) continue;
        if (i > 0) v = Math.min(v, d[k - 1] + cell);
        if (j > 0) {
          v = Math.min(v, d[k - w] + cell);
          if (i > 0) v = Math.min(v, d[k - w - 1] + D);
          if (i < w - 1) v = Math.min(v, d[k - w + 1] + D);
        }
        d[k] = v;
      }
    }
    for (let j = h - 1; j >= 0; j--) {
      for (let i = w - 1; i >= 0; i--) {
        const k = j * w + i;
        let v = d[k];
        if (!v) continue;
        if (i < w - 1) v = Math.min(v, d[k + 1] + cell);
        if (j < h - 1) {
          v = Math.min(v, d[k + w] + cell);
          if (i < w - 1) v = Math.min(v, d[k + w + 1] + D);
          if (i > 0) v = Math.min(v, d[k + w - 1] + D);
        }
        d[k] = v;
      }
    }
  }

  /** Metres from (x, z) to the nearest obstacle (0 inside one or off the floor). */
  clearAt(x, z) {
    const i = this.ci(x);
    const j = this.cj(z);
    return this.inside(i, j) ? this.clearance[j * this.w + i] : 0;
  }

  /**
   * How wide the free floor is at (x, z) across the direction (dx, dz): the
   * distance to the nearest obstacle on either side, each looked for up to
   * `reach` metres. An aisle's width, measured the way two people passing need it.
   */
  /**
   * The narrowest the free floor is through (x, z), in any direction (eight
   * tried): an aisle's width wherever in it the point is, a doorway's even
   * when crossed at an angle. Capped at 2 x `reach`.
   */
  narrowest(x, z, reach = 1.5) {
    let w = Infinity;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI;
      w = Math.min(w, this.width(x, z, Math.cos(a), Math.sin(a), reach));
    }
    return w;
  }

  width(x, z, dx, dz, reach = 1.5) {
    const l = Math.hypot(dx, dz) || 1;
    const px = -dz / l;
    const pz = dx / l;
    const side = (s) => {
      for (let t = 0; t <= reach; t += this.cell * 0.5) {
        const i = this.ci(x + px * t * s);
        const j = this.cj(z + pz * t * s);
        if (!this.inside(i, j) || this.raw[j * this.w + i]) return t;
      }
      return reach;
    };
    return side(1) + side(-1);
  }

  // ------------------------------------------------------------ queries

  /** The free cell centre nearest (x, z), searching outward; null if none. */
  nearestFree(x, z, extra = null) {
    const i0 = Math.min(this.w - 1, Math.max(0, this.ci(x)));
    const j0 = Math.min(this.h - 1, Math.max(0, this.cj(z)));
    const ok = (i, j) => this.inside(i, j) && !this.occ[j * this.w + i] && !extra?.has(j * this.w + i);
    if (ok(i0, j0) && this.free(x, z)) return [x, z];
    const R = Math.max(this.w, this.h);
    for (let r = 1; r < R; r++) {
      let best = null;
      let bd = Infinity;
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r || !ok(i0 + di, j0 + dj)) continue;
          const d = Math.hypot(this.cx(i0 + di) - x, this.cz(j0 + dj) - z);
          if (d < bd) {
            bd = d;
            best = [this.cx(i0 + di), this.cz(j0 + dj)];
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /**
   * Straight line from a to b stays in free space (and, with `minClear`, at
   * least that far from any obstacle all the way).
   */
  los(ax, az, bx, bz, extra = null, minClear = 0) {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(d / (this.cell * 0.34)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      const i = this.ci(x);
      const j = this.cj(z);
      const k = j * this.w + i;
      if (!this.inside(i, j) || this.occ[k] || extra?.has(k) || this.clearance[k] < minClear) return false;
    }
    return true;
  }

  /**
   * A* over the dilated grid (8-connected, no corner cutting), then pulled
   * taut with line-of-sight checks, so figures walk straight lines between
   * real turning points instead of zigzagging along cells.
   *
   * Routes keep to the middle of aisles: a step costs more the closer it runs
   * to a fixture (under `berth` metres), and a shortcut must keep `comfort`
   * metres clear wherever the searched route had that much room, so turns
   * round a table or rail are wide enough that arms never clip its corner.
   *
   * `extra`: a Set of cell indices to treat as blocked for this search only
   * (people standing). `cost(cell, sx, sz)`: an extra cost per metre for a
   * step into that cell in unit direction (sx, sz), from the crowd (room
   * round people standing, other walkers' routes). Returns [[x, z], ...] or null.
   */
  path(from, to, extra = null, { cost = null, comfort = 0.3, berth = 0.55 } = {}) {
    const { w, h, occ, clearance, sg: g, sf: f, came, seen, done } = this;
    const start = this.nearestFree(from[0], from[1]);
    const goal = this.nearestFree(to[0], to[1], extra);
    if (!start || !goal) return null;
    const si = this.ci(start[0]);
    const sj = this.cj(start[1]);
    const gi = this.ci(goal[0]);
    const gj = this.cj(goal[1]);
    const S = sj * w + si;
    const G = gj * w + gi;
    const blocked = (c) => occ[c] || (extra?.has(c) && c !== S);
    const run = ++this.search;
    const hfn = (i, j) => {
      const dx = Math.abs(i - gi);
      const dy = Math.abs(j - gj);
      return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
    };
    // Near a fixture a step costs up to 1.5x more, rising as the square of how
    // far inside the berth it is.
    const span = Math.max(0.05, berth - this.radius);
    const near = (c) => {
      const k = (berth - clearance[c]) / span;
      return k > 0 ? 1.5 * Math.min(1, k) * Math.min(1, k) : 0;
    };
    seen[S] = run;
    g[S] = 0;
    f[S] = hfn(si, sj);
    came[S] = -1;
    const open = new Heap();
    open.push(S, f[S]);
    let found = false;
    while (open.size) {
      const c = open.pop();
      if (done[c] === run) continue;
      if (c === G) {
        found = true;
        break;
      }
      done[c] = run;
      const i = c % w;
      const j = (c / w) | 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const a = i + di;
          const b = j + dj;
          if (a < 0 || b < 0 || a >= w || b >= h) continue;
          const n = b * w + a;
          if (done[n] === run || blocked(n)) continue;
          // No squeezing diagonally between two blocked cells.
          if (di && dj && (blocked(j * w + a) || blocked(b * w + i))) continue;
          const len = di && dj ? SQRT2 : 1;
          const ng = g[c] + len * (1 + near(n) + (cost ? cost(n, di / len, dj / len) : 0));
          if (seen[n] !== run || ng < g[n]) {
            seen[n] = run;
            g[n] = ng;
            f[n] = ng + hfn(a, b);
            came[n] = c;
            open.push(n, f[n]);
          }
        }
      }
    }
    if (!found) return null;
    const trail = [];
    for (let c = G; c !== -1; c = came[c]) trail.push(c);
    trail.reverse();
    const cells = trail.map((c) => [this.cx(c % w), this.cz((c / w) | 0)]);
    const room = trail.map((c) => clearance[c]);
    cells[0] = start;
    cells[cells.length - 1] = goal;
    // String-pull, keeping the room the route had: a shortcut from k to m may
    // come no closer to anything than the tightest point of the route it
    // replaces does (up to `comfort`).
    const out = [cells[0]];
    const tight = new Float32Array(cells.length);
    let k = 0;
    while (k < cells.length - 1) {
      tight[k] = room[k];
      for (let m = k + 1; m < cells.length; m++) tight[m] = Math.min(tight[m - 1], room[m]);
      let far = k + 1;
      for (let m = cells.length - 1; m > k + 1; m--) {
        const need = Math.min(comfort, tight[m]) - 0.01;
        if (this.los(cells[k][0], cells[k][1], cells[m][0], cells[m][1], extra, need)) {
          far = m;
          break;
        }
      }
      out.push(cells[far]);
      k = far;
    }
    return out;
  }
}
