/**
 * Districts: the parts of a scene where things happen (a rail, the denim
 * wall, the fitting rooms, the till), and a way of choosing where someone's
 * next errand is so that people spread out over them, each doing something
 * different, instead of piling up wherever a random pick happens to fall.
 *
 * A district is a set of stations (spots people stand at to do something)
 * and, optionally, a floor polygon. Someone is in a district when they stand
 * inside its polygon or within `near` of one of its stations (the nearest
 * district wins), and heading into it when the spot they have claimed, or
 * the end of their walk, is one of its stations. A party counts once.
 *
 * pick() scores every free station someone could go to next:
 *   - a district already holding its `cap` of groups is out (unless asked)
 *   - so is a station within `apart` (1.1 m) of where someone else stands or
 *     is heading: two people at places that close, facing across an aisle,
 *     close it to everyone else
 *   - how many people are around that station now, or soon will be
 *   - a district this person has already been to on this visit, so a visit
 *     tours the store rather than circling one corner
 *   - a bonus for a feature district nobody has used for a while, so every
 *     part of the store, and what it shows, keeps getting visited
 *   - a little for the walk
 * and takes one of the best few at random, weighted to the best, so the
 * choice is never predictable.
 */
import { inPoly } from './grid.js';

export const groupOf = (a) => (a.party ? `party:${a.party}` : `id:${a.id}`);

export class Districts {
  /**
   * @param {{ name: string, stations?: object[] | (() => object[]), poly?: number[][], cap?: number,
   *           feature?: boolean, party?: boolean, browse?: boolean, near?: number }[]} defs
   *   `browse: false`: none of its stations are errands a customer picks
   *   (the till, the booths: their own routines lead there); a station can
   *   say so for itself too. `party`: somewhere a party of three can stand.
   * @param {{ near?: number, counts?: (a) => boolean }} [o]  counts: who takes up a place (customers)
   */
  constructor(defs, { near = 1.2, counts = () => true } = {}) {
    this.defs = defs.map((d) => ({ cap: Infinity, near, browse: true, ...d, idle: 0, over: 0, groups: 0, lit: false }));
    this.byName = new Map(this.defs.map((d) => [d.name, d]));
    this.counts = counts;
    this.keyOf = new Map(); // station key -> { district, station }
    this.refresh();
  }

  /** A district's stations as they are now (a rail may have been dragged). */
  stations(d) {
    const list = typeof d.stations === 'function' ? d.stations() : d.stations ?? [];
    return list.filter((s) => s && s.x != null);
  }

  /** Re-read every station (keys to districts): cheap, done on each tick. */
  refresh() {
    this.keyOf.clear();
    for (const d of this.defs) for (const s of this.stations(d)) if (s.key) this.keyOf.set(s.key, { d, s });
  }

  /** The district (x, z) is in, or null. */
  of(x, z) {
    let best = null;
    let bd = Infinity;
    for (const d of this.defs) {
      if (d.poly && inPoly(x, z, d.poly)) return d;
      for (const s of this.stations(d)) {
        const dd = Math.hypot(s.x - x, s.z - z);
        if (dd < d.near && dd < bd) {
          bd = dd;
          best = d;
        }
      }
    }
    return best;
  }

  /** Where someone is, or will shortly be: their claimed spot, the end of their walk, or where they stand. */
  aim(a) {
    const k = a.claim && this.keyOf.get(a.claim);
    if (k) return [k.s.x, k.s.z];
    const g = a.task?.go;
    if (g && !a.task.via) return g;
    return [a.pos.x, a.pos.y];
  }

  /** The district someone is in or heading into. */
  where(a) {
    const k = a.claim && this.keyOf.get(a.claim);
    if (k) return k.d;
    const [x, z] = this.aim(a);
    return this.of(x, z);
  }

  /** The groups in, or heading into, district `d` (people who count), leaving out group `except`. */
  groupsIn(d, people, except = null) {
    const seen = new Set();
    for (const p of people) {
      if (!p.visible || p.fadeDir === -1 || !this.counts(p)) continue;
      const g = groupOf(p);
      if (g === except || seen.has(g)) continue;
      if (this.where(p) === d) seen.add(g);
    }
    return seen.size;
  }

  /**
   * Keep the books: which districts are in use, how long each has gone
   * unused (`idle`), and how long each has held more groups than its cap
   * (`over`). Call a few times a second.
   */
  tick(dt, people) {
    this.refresh();
    for (const d of this.defs) {
      d.groups = this.groupsIn(d, people);
      // In use: someone who counts standing there, doing something.
      d.lit = people.some((p) => p.visible && this.counts(p) && !p.task?.go && this.of(p.pos.x, p.pos.y) === d);
      d.idle = d.lit ? 0 : d.idle + dt;
      d.over = d.groups > Math.max(1, d.cap) ? d.over + dt : 0;
    }
  }

  /**
   * Where `a` should go next.
   * @param {object} a
   * @param {object[]} people  everyone in the scene
   * @param {{ rand?: () => number, free?: (s) => boolean, visited?: Set<string>, party?: boolean,
   *           only?: string[], exclude?: string[], full?: boolean, weight?: (p) => number }} [o]
   *   free: is the station free for `a` (its spot unclaimed); visited: district
   *   names already seen on this visit; party: only districts a party fits;
   *   full: fall back to a full district when nothing else is free;
   *   weight: how much a neighbour counts towards crowding (a party, more).
   * @returns the station (with `district`), or null
   */
  pick(a, people, { rand = Math.random, free = () => true, visited = null, party = false, only = null, exclude = null, full = false, weight = () => 1, apart = 1.1, walk = 0.25 } = {}) {
    const own = groupOf(a);
    const open = [];
    const shut = [];
    const others = people.filter((p) => p.visible && p.fadeDir !== -1 && groupOf(p) !== own);
    const aims = others.map((p) => [p, this.aim(p)]);
    for (const d of this.defs) {
      if (d.browse === false || (party && !d.party)) continue;
      if (only && !only.includes(d.name)) continue;
      if (exclude?.includes(d.name)) continue;
      const groups = this.groupsIn(d, people, own);
      for (const s of this.stations(d)) {
        if (s.browse === false || !free(s)) continue;
        // People around the station, now or soon: within 1.2 m in full,
        // fading out to 2.4 m; nobody within `apart` of it at all (bar
        // someone walking past, who will have gone by then).
        let around = 0;
        let close = false;
        for (const [p, [x, z]] of aims) {
          const dd = Math.hypot(x - s.x, z - s.z);
          if (dd < apart && (p.claim || !p.task?.go)) close = true;
          if (dd < 2.4) around += (dd < 1.2 ? 1 : (2.4 - dd) / 1.2) * weight(p);
        }
        if (close) continue;
        let score = 2.5 * groups + 1.6 * around + walk * Math.hypot(s.x - a.pos.x, s.z - a.pos.y);
        if (visited?.has(d.name)) score += 3;
        if (d.feature) score -= Math.min(2.5, d.idle / 8);
        (groups >= d.cap ? shut : open).push({ s, d, score });
      }
    }
    const list = open.length ? open : full ? shut : [];
    if (!list.length) return null;
    list.sort((x, y) => x.score - y.score);
    const top = list.slice(0, 3);
    const w = top.map((c) => Math.exp(-(c.score - top[0].score) / 0.8));
    let r = rand() * w.reduce((x, y) => x + y, 0);
    let k = 0;
    while (k < top.length - 1 && (r -= w[k]) > 0) k++;
    return { ...top[k].s, district: top[k].d.name };
  }

  /** The district holding the most groups over its cap for longest, or null. */
  worst(secs = 6) {
    let best = null;
    for (const d of this.defs) if (d.over > secs && (!best || d.over > best.over)) best = d;
    return best;
  }
}
