/**
 * Small things every diorama's controller needs: a seeded random stream,
 * the scene's named spots, the tasks a routine hands the crowd, the clock
 * and event feed a scene keeps, a place's everyday name, and somewhere out
 * of everyone's way to wait a moment.
 */
import { inPoly } from '../../sim/grid.js';

/** A seeded random stream (a small LCG): the same seed, the same run. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/** The z of the cross product of two 2D vectors. */
export const cross = (ax, az, bx, bz) => ax * bz - az * bx;

/** Seconds as m:ss. */
export const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** The scene's named spots (Blender's `spots`): spot(name) -> { x, z, face (radians) } or null. */
export function spotsOf(data) {
  return (name) => {
    const s = data.spots?.[name];
    return s ? { x: s.at[0], z: s.at[2], face: ((s.face ?? 0) * Math.PI) / 180 } : null;
  };
}

// Tasks a routine hands the crowd (sim/agents.js): walk there, do something there.
export const go = (s, extra = {}) => ({ go: [s.x, s.z], ...extra });
export const act = (clip, secs, face, extra = {}) => ({ act: clip, secs, face, ...extra });
export const near = (a, s, d = 0.4) => Math.hypot(a.pos.x - s.x, a.pos.y - s.z) < d;

/** Seconds into the day as hh:mm. */
export const hhmm = (t) => `${String(Math.floor(t / 3600) % 24).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}`;

/**
 * A scene's clock and event feed: `time()` the clock as hh:mm, `event(text)`
 * a line in the feed (the last `max` kept). `state.clock` is in seconds.
 */
export function clockFeed(state, max = 30) {
  const time = () => hhmm(state.clock);
  const event = (text) => {
    state.feed.push(`${time()}  ${text}`);
    if (state.feed.length > max) state.feed.shift();
  };
  return { time, event };
}

/**
 * What someone on site would call a place: the nearest spot within 0.9 m,
 * named by `names` (keyed by the spot name's first word), else the spot's
 * own name tidied up, else `fallback`.
 */
export function placeNamer(data, names, fallback = 'the floor') {
  return (x, z) => {
    let best = fallback;
    let bd = 0.9;
    for (const [name, s] of Object.entries(data.spots ?? {})) {
      const d = Math.hypot(s.at[0] - x, s.at[2] - z);
      if (d < bd) {
        bd = d;
        best = names[name.split('_')[0]] ?? name.replace(/_\d$/, '').replace(/_/g, ' ');
      }
    }
    return best;
  };
}

/** Where a pointer ray meets the floor, kept on the island (`b` from base()). */
export function floorPointOn(b, ray) {
  const p = b.floorPoint(ray);
  if (!p) return null;
  const A = b.area(0.05);
  p.x = Math.min(A.x1, Math.max(A.x0, p.x));
  p.z = Math.min(A.z1, Math.max(A.z0, p.z));
  return p;
}

/**
 * Somewhere to wait a moment out of everyone's way: open floor 1.5 to 2.5 m
 * off, inside `within` (a polygon, if given), not in a walk-through district,
 * clear of every station and of other people. Null if there's nowhere.
 */
export function asideFrom(a, { rand, grid, districts, people, within = null }) {
  const all = [...districts.keyOf.values()].map(({ s: q }) => q);
  for (let k = 0; k < 24; k++) {
    const t = rand() * Math.PI * 2;
    const r = 1.5 + rand();
    const x = a.pos.x + Math.sin(t) * r;
    const z = a.pos.y + Math.cos(t) * r;
    if (!grid.free(x, z) || districts.of(x, z)?.walkThrough || (within && !inPoly(x, z, within))) continue;
    if (all.some((q) => Math.hypot(q.x - x, q.z - z) < 1.1)) continue;
    if (people.some((p) => p !== a && p.visible && Math.hypot(p.pos.x - x, p.pos.y - z) < 1)) continue;
    return { x, z };
  }
  return null;
}

/** A hex colour as linear RGB scaled by `k` (the line batch's colours). */
export function hexGlow(hex, k) {
  const c = parseInt(hex.slice(1), 16);
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [lin((c >> 16) & 255) * k, lin((c >> 8) & 255) * k, lin(c & 255) * k];
}
