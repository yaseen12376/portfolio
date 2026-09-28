/**
 * Parties: people who come together and stay together (a family, friends).
 * A party has a leader (whose routine decides where it goes) and followers,
 * who keep close: in the leader's footsteps, one behind another, while they
 * walk (and wherever the scene says it is outdoors), and in a loose V beside
 * them while they stand; the leader slows while anyone lags.
 *
 *   partyKit({ people, crowd, grid, rand, outdoors, avoid })
 *     together(L)          is the whole party near its leader?
 *     singleFile(L)        walking one behind another just now?
 *     inFootsteps(L, back) the point `back` metres behind the leader, along the way they came
 *     follower(a, leave?)  a follower's next task
 *     FILE                 a pace, between one and the next in single file
 *
 * `outdoors(x, z)`: single file there even standing (a pavement). `avoid(x,
 * z)`: never a follower's place (an entrance). Registers a crowd hook, so
 * make it where a scene's other hooks are made.
 */

/** Play a clip in place (the crowd's task: sim/agents.js). */
const act = (clip, secs, face, extra = {}) => ({ act: clip, secs, face, ...extra });

export function partyKit({ people, crowd, grid, rand, outdoors = () => false, avoid = () => false }) {
  /** A pace apart in single file. */
  const FILE = 0.8;

  /** Is the whole party near its leader (in single file, each within their place in the line)? */
  const together = (L) => {
    const fol = people.filter((p) => p.leader === L && p !== L);
    return fol.every((p, k) => !p.visible || Math.hypot(p.pos.x - L.pos.x, p.pos.y - L.pos.y) < Math.max(1.5, FILE * (k + 1) + 0.6));
  };
  /**
   * The leader's footsteps (a point every 15 cm, the last 6 m): through the
   * doorway and on the street, the others walk in them, one behind another.
   */
  crowd.onMove((a) => {
    if (!a.party || a.leader !== a || !a.visible) return;
    // How far back the last of them may be before the leader slows: one
    // behind another, a pace each; gathered round, arm's length.
    a.partyGap = singleFile(a) ? FILE * people.filter((p) => p.leader === a && p !== a).length + 0.6 : 1.5;
    const c = (a.crumbs ??= []);
    const l = c[c.length - 1];
    if (!l || Math.hypot(l[0] - a.pos.x, l[1] - a.pos.y) > 0.15) {
      c.push([a.pos.x, a.pos.y]);
      if (c.length > 40) c.shift();
    }
  });
  /** The point `back` metres behind the leader, along the way they came. */
  const inFootsteps = (L, back) => {
    const c = L.crumbs;
    if (!c?.length) return null;
    let px = L.pos.x;
    let pz = L.pos.y;
    let got = 0;
    for (let k = c.length - 1; k >= 0; k--) {
      const [x, z] = c[k];
      const d = Math.hypot(x - px, z - pz);
      if (d > 1e-6 && got + d >= back) {
        const f = (back - got) / d;
        return [px + (x - px) * f, pz + (z - pz) * f];
      }
      got += d;
      px = x;
      pz = z;
    }
    return [px, pz];
  };
  /**
   * Walking in single file: whenever the leader is on the move (three
   * abreast would fill an aisle), and out on the street. Stopped indoors,
   * they gather round in a loose V, on open floor.
   */
  const singleFile = (L) => (L.task?.go && L.vel.length() > 0.12) || outdoors(L.pos.x, L.pos.y);
  /** A pace apart in single file. */
  /**
   * A follower's next task: in the leader's footsteps while they walk, else a
   * place beside them. `leave(a, L)` is the scene's own say first (the party
   * heading out, say): a task to do instead, or null to follow as usual.
   */
  function follower(a, leave = null) {
    const L = a.leader;
    const instead = leave?.(a, L);
    if (instead) return instead;
    // A place in a V behind the leader; walking there ends as soon as the
    // leader has moved on (a fresh place is worked out), and so does lingering.
    const i = people.filter((p) => p.leader === L && p !== L).indexOf(a) + 1;
    if (singleFile(L)) {
      // One behind another in the leader's footsteps, a pace (0.9 m) apart:
      // nobody squeezes in beside the leader in the doorway.
      const at = inFootsteps(L, FILE * i);
      const fx = L.pos.x;
      const fz = L.pos.y;
      const on = () => Math.hypot(L.pos.x - fx, L.pos.y - fz) > 0.3 || !L.visible;
      if (at && grid.free(at[0], at[1]) && Math.hypot(at[0] - a.pos.x, at[1] - a.pos.y) > 0.3) return { go: at, until: on };
      if (at && grid.free(at[0], at[1])) return act('idle', 0.6, [L.pos.x, L.pos.y], { until: on });
    }
    const place = () => {
      // Behind the leader to one side, 0.7 m off (two bodies and a hand's
      // breadth between them); where that's a fixture, the entrance, the
      // middle of a narrow aisle or someone else's place, the free place
      // round the leader nearest to it with room about it (never across a fixture).
      const ang = L.heading + Math.PI + (i === 1 ? 0.9 : -0.9);
      const want = [L.pos.x + Math.sin(ang) * 0.7, L.pos.y + Math.cos(ang) * 0.7];
      const other = people.find((p) => p.leader === L && p !== L && p !== a);
      let best = [L.pos.x, L.pos.y];
      let bc = Infinity;
      for (let k = 0; k < 16; k++) {
        const t = (k / 16) * Math.PI * 2;
        const x = L.pos.x + Math.sin(t) * 0.7;
        const z = L.pos.y + Math.cos(t) * 0.7;
        if (!grid.free(x, z) || !grid.los(L.pos.x, L.pos.y, x, z) || avoid(x, z)) continue;
        // Clear of the other one's place, and of anyone else.
        if (other && Math.hypot(other.pos.x - x, other.pos.y - z) < 0.6) continue;
        const crowded = people.filter((p) => p !== a && p.visible && !(p.party && p.leader === L) && Math.hypot(p.pos.x - x, p.pos.y - z) < 0.8).length;
        const narrow = Math.max(0, 0.55 - grid.clearAt(x, z));
        const c = Math.hypot(x - want[0], z - want[1]) + 3 * narrow + 1.5 * crowded;
        if (c < bc) {
          bc = c;
          best = [x, z];
        }
      }
      return best;
    };
    const target = place();
    const lx = L.pos.x;
    const lz = L.pos.y;
    // Ends once the leader has actually gone somewhere (not on a twitch).
    const moved = () => {
      const p = place();
      return Math.hypot(L.pos.x - lx, L.pos.y - lz) > 0.3 || Math.hypot(p[0] - target[0], p[1] - target[1]) > 0.45 || !L.visible;
    };
    if (Math.hypot(target[0] - a.pos.x, target[1] - a.pos.y) > 0.35) return { go: target, until: moved };
    const clips = ['idle', 'phone', 'point', 'idle'];
    return act(a.fig.root.getObjectByName('phone') ? 'phone' : clips[Math.floor(rand() * clips.length)], 1.5 + rand() * 2, [L.pos.x, L.pos.y], { until: moved });
  }

  return { together, singleFile, inFootsteps, follower, FILE };
}
