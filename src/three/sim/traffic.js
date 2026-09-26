/**
 * Taking turns in tight places.
 *
 * Where an aisle or a doorway is too narrow for two people to pass (under
 * SINGLE metres of free floor across the way), people don't meet in the middle
 * and shuffle: whoever gets there first goes through, anyone following the same
 * way may follow them, and someone coming the other way waits at the wide end,
 * a step to the side, until it's clear. People leaving get priority over people
 * arriving (let people out first), and someone who has waited a while is not
 * kept waiting by a stream of new arrivals.
 *
 * The narrow stretches of a route are found from the grid when the route is
 * planned (narrows()); the Crowd asks for each as the walker gets near it
 * (request()), and lets it go once past (release()).
 */

export const SINGLE = 1.05; // m: narrower than this, two people can't pass (two bodies plus room at the walls)
const PAD = 0.35; // m of room claimed either side of the narrow part
const STEP = 0.15; // m between width samples along a route
const PATIENCE = 3; // s: a waiter who has waited this long goes before newcomers
const STALL = 5; // s: a hold whose walker makes no progress for this long lapses

/**
 * The narrow stretches of a route: [{ s0, s1, pts, dir }], s0 and s1 being
 * distances along the route (padded), pts the narrow part's sample points,
 * dir its unit direction. A stretch the route ends inside (the walker is going
 * to stand there) is left out: holding it would shut others out indefinitely.
 */
export function narrows(grid, path, cum) {
  if (path.length < 2) return [];
  const total = cum[cum.length - 1];
  const runs = [];
  let run = null;
  let seg = 1;
  for (let s = 0; s <= total; s += STEP) {
    while (seg < path.length - 1 && cum[seg] < s) seg++;
    const a = path[seg - 1];
    const b = path[seg];
    const len = cum[seg] - cum[seg - 1] || 1;
    const k = Math.min(1, Math.max(0, (s - cum[seg - 1]) / len));
    const x = a[0] + (b[0] - a[0]) * k;
    const z = a[1] + (b[1] - a[1]) * k;
    const narrow = grid.narrowest(x, z, SINGLE) < SINGLE;
    if (narrow) {
      if (run && s - run.e <= 0.3) {
        run.e = s;
        run.pts.push([x, z]);
      } else {
        run = { b: s, e: s, pts: [[x, z]] };
        runs.push(run);
      }
    }
  }
  const out = [];
  for (const r of runs) {
    if (r.e >= total - 0.25) continue;
    const p0 = r.pts[0];
    const p1 = r.pts[r.pts.length - 1];
    let dx = p1[0] - p0[0];
    let dz = p1[1] - p0[1];
    if (Math.hypot(dx, dz) < 0.05) {
      // A doorway only a sample or two deep: its direction is the route's there.
      let i = 1;
      while (i < path.length - 1 && cum[i] < r.b) i++;
      dx = path[i][0] - path[i - 1][0];
      dz = path[i][1] - path[i - 1][1];
    }
    const l = Math.hypot(dx, dz) || 1;
    // A route that starts inside a narrow place is already in it: it goes on through.
    out.push({ s0: Math.max(0, r.b - PAD), s1: Math.min(total, r.e + PAD), pts: r.pts, dir: [dx / l, dz / l], held: false, passed: false, inside: r.b < 0.15 });
  }
  return out;
}

const overlaps = (p, q) => {
  for (const a of p) for (const b of q) if (Math.abs(a[0] - b[0]) < 0.45 && Math.abs(a[1] - b[1]) < 0.45 && Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.45) return true;
  return false;
};

export class Traffic {
  constructor() {
    this.holds = []; // { a, st, since, s, at }: a walker going through a stretch
    this.waits = new Map(); // agent -> { st, since }: a walker waiting for one
  }

  /** Is `h` going against `st` through the same narrow place? */
  clash(h, a, st) {
    if (h.a === a) return false;
    if (a.party && h.a.party === a.party) return false; // a family goes through together
    return h.st.dir[0] * st.dir[0] + h.st.dir[1] * st.dir[1] < 0.3 && overlaps(h.st.pts, st.pts);
  }

  /**
   * May `a` go through `st` now? Granting it holds the stretch for `a`'s
   * direction until release(). `inside`: already in the narrow part (can't
   * back out: goes on regardless).
   */
  request(a, st, now, inside = false) {
    const leaving = (x) => !!(x.outbound || x.task?.exit);
    const blocking = this.holds.filter((h) => this.clash(h, a, st));
    if (blocking.length && !inside) {
      // Let people out first: a hold by someone arriving who hasn't reached the
      // narrow part yet gives way to someone leaving.
      const yieldable = blocking.every((h) => !leaving(h.a) && leaving(a) && h.a.pathS < h.st.s0 + 0.25);
      if (!yieldable) return this.wait(a, st, now);
      for (const h of blocking) this.drop(h);
    }
    // Someone who has been waiting a while goes before a newcomer in the other direction.
    if (!inside) {
      for (const [w, q] of this.waits) {
        if (w !== a && w.visible && now - q.since > PATIENCE && this.clash({ a: w, st: q.st }, a, st)) return this.wait(a, st, now);
      }
    }
    this.waits.delete(a);
    this.holds.push({ a, st, since: now, s: a.pathS ?? 0, at: now });
    st.held = true;
    return true;
  }

  wait(a, st, now) {
    const w = this.waits.get(a);
    if (!w || w.st.pts !== st.pts) this.waits.set(a, { st, since: w?.since ?? now });
    return false;
  }

  /**
   * A route was re-planned: a narrow place `a` was already going through
   * stays theirs under the new route's matching stretch. Holds with no match
   * are let go.
   */
  carry(a, gates) {
    for (const h of this.holds.filter((x) => x.a === a)) {
      const g = gates.find((st) => !st.held && st.dir[0] * h.st.dir[0] + st.dir[1] * h.st.dir[1] > 0.5 && overlaps(st.pts, h.st.pts));
      if (g) {
        g.held = true;
        h.st = g;
      } else this.drop(h);
    }
    const w = this.waits.get(a);
    if (w) {
      const g = gates.find((st) => overlaps(st.pts, w.st.pts));
      if (g) w.st = g;
      else this.waits.delete(a);
    }
  }

  /** Who holds the narrow place `a` is waiting for (to look at them). */
  holder(a, st) {
    return this.holds.find((h) => this.clash(h, a, st))?.a ?? null;
  }

  drop(h) {
    h.st.held = false;
    this.holds = this.holds.filter((x) => x !== h);
  }

  /** `a` is through `st` (or has given up on it); without `st`, everything `a` holds or waits for. */
  release(a, st = null) {
    for (const h of this.holds.filter((x) => x.a === a && (!st || x.st === st))) this.drop(h);
    if (!st || this.waits.get(a)?.st === st) this.waits.delete(a);
  }

  /** Each frame: holds whose walker has left, gone past or stalled lapse. */
  prune(now) {
    for (const h of [...this.holds]) {
      const a = h.a;
      if (!a.visible || !a.path || !a.gates?.includes(h.st)) {
        this.drop(h);
        continue;
      }
      const s = a.pathS ?? 0;
      if (s > h.s + 0.1) {
        h.s = s;
        h.at = now;
      } else if (now - h.at > STALL) this.drop(h);
    }
    for (const [a, w] of this.waits) if (!a.visible || !a.gates?.includes(w.st)) this.waits.delete(a);
  }
}
