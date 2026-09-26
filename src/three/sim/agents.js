/**
 * People who behave: each figure has a routine (walk somewhere, do something
 * there, move on), plans its route on the nav grid, and moves through a crowd
 * without ever passing through a wall, a fixture or another figure.
 *
 *  - Routes: A* on the dilated grid (grid.js), keeping to the middle of aisles,
 *    giving room to people standing, and away from where other walkers are
 *    about to go the other way. Re-planned every second or so, whenever the
 *    grid changes (a fixture was dragged), and when a figure gets stuck.
 *  - Avoidance: every frame each walker picks the velocity that keeps to its
 *    route without heading into anyone in the next few seconds (avoid.js), so
 *    people curve round each other well before they meet, and pass on the
 *    same side.
 *  - Narrow places: where two can't pass, people take turns (traffic.js).
 *  - Bodies: each figure's radius is its body's half-width, arms included, so
 *    "not overlapping" means what it looks like. A hard constraint and a
 *    resolver below it guarantee nobody ever passes through anyone.
 *  - Motion: the walk clip's playback rate follows actual speed, so feet
 *    don't slide when a figure slows, queues or sidesteps; heads look into
 *    turns and at whoever is coming; shoulders turn to squeeze past.
 *
 * Tasks a routine can hand out (think(agent) returns the next one):
 *   { go: [x, z], face?: radians | [x, z], claim?: key }  walk there
 *   { go, via: true }                                     walk through there without stopping (a doorway lane)
 *   { act: 'browse', secs, face?, claim? }                play a clip in place
 *   { wait: secs, face?, claim? }                         stand
 *   { call: (agent) => void }                             run code, move on at once
 *   { exit: portal }                                      walk into a portal and fade out there
 * Any task may carry `until: (agent) => boolean` (end it early: a follower
 * stops lingering once the leader walks on) and `pace` (a walk's speed factor).
 *
 * Nobody appears or disappears in plain sight: people arrive through a portal
 * (crowd.enter: a bus shelter, a site gate, somewhere that hides them) fading
 * in, and leave by walking into one and fading out. An exit that can't be
 * reached right now is retried, never skipped, so a person is only ever
 * hidden inside a portal.
 *
 * `claim` reserves a spot (a rail, a till, a mirror) for one figure: a routine
 * asks crowd.free(key) before sending anyone there, so two people never walk
 * to the same spot and shove each other for it. A claim lasts until a task
 * without the same key.
 *
 * Someone standing (acting or waiting) is an anchor: passers-by steer around
 * them and are the ones moved if they touch, so nobody slides while browsing.
 *
 * `agent.keepOut`: floor polygons [[x, z], ...] that agent never enters (a
 * shopper and the staff-only rooms): not on a route, not stepping aside, not
 * pushed.
 */
import { Vector2 } from 'three';

import { chooseVelocity, ttc } from './avoid.js';
import { inPoly } from './grid.js';
import { narrows, Traffic } from './traffic.js';

const TURN = 7; // heading catch-up rate, 1/s
const ACCEL = 7; // velocity catch-up rate, 1/s
const FADE = 0.6; // seconds to fade in or out at a portal
const NUDGE = 0.012; // the most the overlap resolver moves anyone per pass, m
const CONTACT = 0.06; // closer than touching plus this, a walker stops pressing into someone standing
// Arms swing a few centimetres past the shoulders: two bodies never come
// closer than this, so hands don't pass through each other.
export const GAP = 0.05;
const NEAR = 3; // m: who a walker looks out for
const MAX_NEAR = 10;
const REPLAN = 1.6; // s between route refreshes while walking (sooner with company: see update)
// Personal space kept beyond touching, where the floor allows it.
const ROOM_WALK = 0.16; // passing another walker
const ROOM_POST = 0.18; // passing someone standing
const ROOM_KIN = 0.1; // walking with one's own party
const LOOK_AHEAD = 1.0; // m before a narrow place that a walker asks to go through
const FLOW_AHEAD = 4; // m of another walker's route that counts against going the other way
const FLOW_W = 0.9; // extra cost per metre, walking straight against someone's route
const BERTH = 0.4; // m of room planned round people standing
const BERTH_W = 1.2;

const angleTo = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

// How far arms reach past the body in each working clip (folding at a table,
// pointing, paying, sweeping): someone doing it needs that much more room.
const REACH = { browse: 0.06, fold: 0.07, point: 0.1, pay: 0.05, scan: 0.05, type: 0.03, tryon: 0.05, talk: 0.05, wave: 0.08, sweep: 0.1, hammer: 0.08, weld: 0.06, thumbs: 0.05 };

export class Agent {
  /**
   * @param {object} fig     a figure from people.js makeFigure()
   * @param {{ id: number, radius?: number, speed?: number, tags?: object, think: (a: Agent) => object }} opts
   */
  constructor(fig, opts) {
    this.fig = fig;
    this.id = opts.id;
    this.radius = opts.radius ?? 0.265;
    this.walkSpeed = opts.speed ?? 0.67;
    this.tags = opts.tags ?? {};
    this.think = opts.think;
    this.pos = new Vector2(fig.root.position.x, fig.root.position.z);
    this.claim = null;
    // A fixed figure (a cashier behind a counter) works in place: never moved,
    // never placed by the grid, but everyone else still keeps clear of it.
    this.fixed = !!opts.fixed;
    this.vel = new Vector2();
    this.heading = fig.root.rotation.y;
    this.task = null;
    this.path = null;
    this.cum = null; // distance along the path to each waypoint
    this.pathS = 0; // how far along the path they are
    this.gates = []; // the path's narrow stretches (traffic.js)
    this.waitGate = null; // waiting to go through one
    this.wp = 0;
    this.pathVersion = -1;
    this.timer = 0;
    this.stuck = { t: 0, remain: Infinity, tries: 0 };
    this.clip = null;
    this.visible = true;
    this.fade = 1; // 0 gone .. 1 fully here
    this.fadeDir = 0; // +1 arriving, -1 leaving
    this.exited = null; // the portal they last left by
    this.retry = 0; // seconds before trying an unreachable exit again
    this.lookYaw = null; // where the head turns while walking (relative), or null
    this.twist = 0; // shoulders turned to squeeze past someone
    this.glance = null; // { who, t }: a look at someone coming the other way
  }

  get moving() {
    return this.vel.lengthSq() > 0.0036;
  }

  /** How far from its centre the figure takes up room now: its body, and its arms at work. */
  get extent() {
    return this.radius + (this.task?.act ? REACH[this.task.act] ?? 0 : 0);
  }

  /** Standing still on purpose: others go round. */
  get anchored() {
    return this.fixed || !!(this.task && !this.task.go);
  }

  /** Where the figure is heading next (for overlays and the CCTV views). */
  get goal() {
    return this.task?.go ?? null;
  }
}

export class Crowd {
  /**
   * @param {import('./grid.js').NavGrid} grid
   * @param {{ portals?: { name: string, x: number, z: number, r: number }[] }} [o]
   */
  constructor(grid, { portals = [] } = {}) {
    this.grid = grid;
    this.agents = [];
    this.time = 0;
    this.listeners = new Set();
    this.claims = new Map();
    this.portals = portals;
    this.traffic = new Traffic();
    // The crowd's last resorts, counted: in a good crowd they almost never fire.
    this.stats = { sidestep: 0, makeWay: 0, wedged: 0, stuck: 0, gaveUp: 0 };
    this.log = null; // set to [] to record each last resort (QA)
    // Route costs from the crowd, rebuilt per plan (a stamp marks them fresh).
    const n = grid.n;
    this.fx = new Float32Array(n);
    this.fz = new Float32Array(n);
    this.fb = new Float32Array(n);
    this.fgen = new Uint32Array(n);
    this.gen = 0;
    this.v2 = [0, 0];
  }

  portal(name) {
    return this.portals.find((p) => p.name === name) ?? null;
  }

  /** The portal nearest (x, z). */
  nearestPortal(x, z) {
    let best = null;
    let bd = Infinity;
    for (const p of this.portals) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /** Inside a portal's volume (any portal, or the one given)? */
  inPortal(x, z, portal = null) {
    return (portal ? [portal] : this.portals).some((p) => Math.hypot(x - p.x, z - p.z) <= p.r);
  }

  /**
   * Bring someone on through a portal, fading in, clear of everyone there.
   * False when the portal is too crowded right now (try again later).
   */
  enter(a, name) {
    const p = this.portal(name) ?? this.portals[0];
    if (!p) return false;
    // Not while someone is in the portal's mouth (on their way out, or just
    // arrived): stepping out into them is a collision. Their own party may follow close.
    if (this.agents.some((b) => b !== a && b.visible && !(a.party && b.party === a.party) && Math.hypot(b.pos.x - p.x, b.pos.y - p.z) < p.r + 0.75)) return false;
    const at = this.grid.nearestFree(p.x, p.z, this.crowdCells(a, false, false));
    if (!at || Math.hypot(at[0] - p.x, at[1] - p.z) > p.r * 0.85) return false;
    a.pos.set(at[0], at[1]);
    a.vel.set(0, 0);
    a.visible = true;
    a.fig.root.visible = true;
    a.fade = 0;
    a.fadeDir = 1;
    a.fig.setFade?.(0);
    a.task = null;
    a.path = null;
    a.gates = [];
    a.waitGate = null;
    a.failures = 0;
    a.retry = 0;
    a.fig.root.position.set(a.pos.x, 0, a.pos.y);
    return true;
  }

  /** Gone from the scene: only ever called once a fade-out inside a portal ends. */
  hide(a) {
    a.visible = false;
    a.fig.root.visible = false;
    a.fadeDir = 0;
    a.fade = 0;
    a.exited = a.task?.exit ?? null;
    if (a.claim) {
      this.claims.delete(a.claim);
      a.claim = null;
    }
    this.traffic.release(a);
    a.task = null;
    a.path = null;
    a.gates = [];
    a.waitGate = null;
    a.vel.set(0, 0);
  }

  /** Is this spot free for `agent` (unclaimed, or already theirs)? */
  free(key, agent = null) {
    const who = this.claims.get(key);
    return !who || who === agent;
  }

  add(agent) {
    // Start on free ground, clear of everyone already here, whatever the cast data said.
    const p = agent.fixed ? null : this.grid.nearestFree(agent.pos.x, agent.pos.y, this.crowdCells(agent, false, false));
    if (p) agent.pos.set(p[0], p[1]);
    this.agents.push(agent);
    return agent;
  }

  remove(agent) {
    this.traffic.release(agent);
    this.agents = this.agents.filter((a) => a !== agent);
  }

  /** Each frame, per agent, after it moves: (agent, prev, dt) => void. */
  onMove(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ------------------------------------------------------------ tasks

  next(a) {
    this.traffic.release(a);
    a.waitGate = null;
    // Back to what they were doing before stepping aside for someone.
    if (a.resume) {
      const r = a.resume;
      a.resume = null;
      a.task = r;
      a.timer = 0;
      a.path = null;
      a.stuck.tries = 0;
      a.stuck.t = 0;
      a.stuck.remain = Infinity;
      return;
    }
    const t = a.think?.(a) ?? { wait: 1 };
    if (a.claim && a.claim !== t.claim) {
      this.claims.delete(a.claim);
      a.claim = null;
    }
    if (t.claim) {
      this.claims.set(t.claim, a);
      a.claim = t.claim;
    }
    // An exit is a walk to the portal's middle; arriving there starts the fade.
    if (t.exit) {
      const p = this.portal(t.exit) ?? this.nearestPortal(a.pos.x, a.pos.y);
      t.exit = p?.name ?? null;
      if (p) t.go = [p.x, p.z];
    }
    a.task = t;
    a.timer = 0;
    a.path = null;
    a.stuck.tries = 0;
    a.stuck.t = 0;
    a.stuck.remain = Infinity;
    if (t.call) {
      t.call(a);
      return this.next(a);
    }
  }

  /**
   * Cells near other figures (only those standing still, with `standing`), so
   * a route can go round them.
   */
  crowdCells(a, standing = false, routing = true) {
    const g = this.grid;
    // A stamp per call marks the cells (cheaper than a Set of thousands).
    this.hard ??= new Uint32Array(g.n);
    const hard = this.hard;
    const run = (this.hardGen = (this.hardGen ?? 0) + 1);
    const out = { has: (c) => hard[c] === run, add: (c) => (hard[c] = run) };
    for (const poly of a.keepOut ?? []) for (const c of (poly.cells ??= g.cellsIn(poly))) out.add(c);
    for (const b of this.agents) {
      if (b === a || !b.visible || (standing && !b.anchored)) continue;
      // A group moves as one: members never wall each other in (routing only;
      // for placing someone, everybody counts).
      if (routing && a.party && b.party === a.party) continue;
      const R = a.radius + b.extent;
      const r = Math.ceil(R / g.cell);
      const i0 = g.ci(b.pos.x);
      const j0 = g.cj(b.pos.y);
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.hypot(di, dj) * g.cell > R) continue;
          if (g.inside(i0 + di, j0 + dj)) out.add((j0 + dj) * g.w + i0 + di);
        }
      }
    }
    return out;
  }

  /**
   * What the crowd adds to the cost of a route for `a`: room round people
   * standing (beyond touching, which is blocked outright), and the next few
   * metres of every other walker's route, costly to walk against, so two
   * people heading opposite ways pick different aisles, or different sides of one.
   */
  routeCost(a) {
    const g = this.grid;
    const { fx, fz, fb, fgen } = this;
    const gen = ++this.gen;
    const touch = (c) => {
      if (fgen[c] !== gen) {
        fgen[c] = gen;
        fx[c] = 0;
        fz[c] = 0;
        fb[c] = 0;
      }
    };
    let any = false;
    // Only people near the way there count (within 2.5 m of the straight line to the goal).
    const [gx, gz] = a.task.go;
    const lx = gx - a.pos.x;
    const lz = gz - a.pos.y;
    const l2 = lx * lx + lz * lz || 1;
    const offLine = (x, z) => {
      const t = Math.min(1, Math.max(0, ((x - a.pos.x) * lx + (z - a.pos.y) * lz) / l2));
      return Math.hypot(x - a.pos.x - lx * t, z - a.pos.y - lz * t);
    };
    for (const b of this.agents) {
      if (b === a || !b.visible || (a.party && b.party === a.party)) continue;
      if (offLine(b.pos.x, b.pos.y) > 2.5) continue;
      if (b.anchored) {
        const R0 = a.radius + b.extent;
        const R1 = R0 + BERTH;
        const r = Math.ceil(R1 / g.cell);
        const i0 = g.ci(b.pos.x);
        const j0 = g.cj(b.pos.y);
        for (let dj = -r; dj <= r; dj++) {
          for (let di = -r; di <= r; di++) {
            const i = i0 + di;
            const j = j0 + dj;
            if (!g.inside(i, j)) continue;
            const d = Math.hypot(g.cx(i) - b.pos.x, g.cz(j) - b.pos.y);
            if (d > R1) continue;
            const c = j * g.w + i;
            touch(c);
            fb[c] = Math.max(fb[c], BERTH_W * Math.min(1, (R1 - d) / BERTH));
            any = true;
          }
        }
      } else if (b.path && b.task?.go && !b.fixed) {
        // Their route from where they are now, for the next few metres.
        let x = b.pos.x;
        let z = b.pos.y;
        let left = FLOW_AHEAD;
        const r = Math.ceil((a.radius + b.radius) * 0.6 / g.cell);
        for (let k = b.wp; k < b.path.length && left > 0; k++) {
          const [tx, tz] = b.path[k];
          const seg = Math.hypot(tx - x, tz - z);
          if (seg < 1e-3) continue;
          const ux = (tx - x) / seg;
          const uz = (tz - z) / seg;
          for (let s = 0; s < Math.min(seg, left); s += 0.15) {
            const i0 = g.ci(x + ux * s);
            const j0 = g.cj(z + uz * s);
            for (let dj = -r; dj <= r; dj++) {
              for (let di = -r; di <= r; di++) {
                if (di * di + dj * dj > r * r || !g.inside(i0 + di, j0 + dj)) continue;
                const c = (j0 + dj) * g.w + i0 + di;
                touch(c);
                fx[c] += ux * 0.35;
                fz[c] += uz * 0.35;
                any = true;
              }
            }
          }
          left -= seg;
          x = tx;
          z = tz;
        }
      }
    }
    if (!any) return null;
    return (c, sx, sz) => {
      if (fgen[c] !== gen) return 0;
      let fl = Math.hypot(fx[c], fz[c]);
      const k = fl > 1 ? 1 / fl : 1;
      const against = -(sx * fx[c] + sz * fz[c]) * k;
      return fb[c] + (against > 0 ? FLOW_W * against : 0);
    };
  }

  /**
   * Route to the task's goal. People standing still are obstacles like any
   * fixture (nobody plans a path through someone browsing); a stuck figure
   * also routes round everyone walking.
   */
  plan(a, avoidCrowd = false) {
    const to = a.task.go;
    const from = [a.pos.x, a.pos.y];
    const cost = this.routeCost(a);
    // Stuck: round everyone, even the rest of one's own party. Where people
    // standing close the only way through, go anyway: they will make way.
    a.path = this.grid.path(from, to, this.crowdCells(a, !avoidCrowd, !avoidCrowd), { cost }) ?? this.grid.path(from, to, null, { cost });
    a.wp = 1;
    a.pathVersion = this.grid.version;
    a.replanIn = REPLAN;
    a.waitGate = null;
    if (a.path) {
      a.cum = [0];
      for (let k = 1; k < a.path.length; k++) a.cum.push(a.cum[k - 1] + Math.hypot(a.path[k][0] - a.path[k - 1][0], a.path[k][1] - a.path[k - 1][1]));
      a.pathS = 0;
      a.gates = narrows(this.grid, a.path, a.cum);
      // Mid-way through a narrow place, it stays theirs.
      this.traffic.carry(a, a.gates);
    } else {
      a.cum = null;
      a.gates = [];
      this.traffic.release(a);
    }
  }

  /** How far along its path `a` is, from its position on the current leg. */
  progress(a) {
    if (!a.path || !a.cum || a.path.length < 2) return 0;
    const k = Math.min(Math.max(1, a.wp), a.path.length - 1);
    const [x0, z0] = a.path[k - 1];
    const [x1, z1] = a.path[k];
    const lx = x1 - x0;
    const lz = z1 - z0;
    const l2 = lx * lx + lz * lz || 1;
    const t = Math.min(1, Math.max(0, ((a.pos.x - x0) * lx + (a.pos.y - z0) * lz) / l2));
    return a.cum[k - 1] + t * Math.sqrt(l2);
  }

  /**
   * The narrow place ahead, if `a` must wait for it: where to stand (a step
   * to the left of the route, before the narrow part) and who is coming
   * through. Null to carry on.
   */
  gateAhead(a) {
    const s = a.pathS;
    for (const st of a.gates) {
      if (st.passed) continue;
      // Through the narrow part (with a body's length to spare): the next
      // person may come the other way; they will pass in the wide part.
      if (s > st.s1 - 0.2) {
        st.passed = true;
        this.traffic.release(a, st);
        continue;
      }
      if (st.held) return null;
      if (s < st.s0 - LOOK_AHEAD) return null;
      const inside = st.inside || s > st.s0 + 0.3;
      if (this.traffic.request(a, st, this.time, inside)) return null;
      // Wait back from the wide end and to the left, clear of whoever comes out.
      if (!st.waitAt) {
        const at = this.pointAt(a, Math.max(0, st.s0 - 0.45));
        const [dx, dz] = st.dir;
        let spot = at;
        for (const side of [0.5, 0.4, 0.3, 0.15]) {
          const x = at[0] + dz * side;
          const z = at[1] - dx * side;
          if (this.grid.free(x, z) && this.allowed(a, x, z) && this.grid.los(at[0], at[1], x, z)) {
            spot = [x, z];
            break;
          }
        }
        st.waitAt = spot;
      }
      return { st, at: st.waitAt, who: this.traffic.holder(a, st) };
    }
    return null;
  }

  /** The point `s` metres along `a`'s path. */
  pointAt(a, s) {
    const { path, cum } = a;
    let k = 1;
    while (k < path.length - 1 && cum[k] < s) k++;
    const l = cum[k] - cum[k - 1] || 1;
    const t = Math.min(1, Math.max(0, (s - cum[k - 1]) / l));
    return [path[k - 1][0] + (path[k][0] - path[k - 1][0]) * t, path[k - 1][1] + (path[k][1] - path[k - 1][1]) * t];
  }

  /**
   * Two people holding the same narrow place, the same way: -1 if `b` is
   * ahead (`a` follows them), +1 if `a` is ahead and `b` is behind it (`a`
   * need not wait for them), 0 otherwise.
   */
  fileOrder(a, b) {
    const sa = a.gates.find((st) => st.held && !st.passed);
    const sb = sa && b.gates.find((st) => st.held && !st.passed);
    if (!sb || sa.dir[0] * sb.dir[0] + sa.dir[1] * sb.dir[1] < 0.5) return 0;
    const ra = sa.s0 + 0.35 - a.pathS; // how far each still has to the narrow part
    const rb = sb.s0 + 0.35 - b.pathS;
    if (Math.abs(ra - rb) < 0.02) return a.id < b.id ? 1 : -1;
    if (rb < ra) return -1;
    // b is behind: ignore them only if they really are behind (not alongside, in front).
    const rel = Math.abs(angleTo(a.heading, Math.atan2(b.pos.x - a.pos.x, b.pos.y - a.pos.y)));
    return rel > 1.4 ? 1 : 0;
  }

  note(type, a, b = null) {
    const who = (x) => `${x.role ?? 'agent'} ${x.id} (${x.task?.go ? 'walking' : x.task?.act ?? (x.task?.wait != null ? 'waiting' : '-')}${x.st?.phase ? ` ${x.st.phase}` : ''}) at ${x.pos.x.toFixed(2)},${x.pos.y.toFixed(2)}`;
    this.log?.push({ t: +this.time.toFixed(1), type, a: who(a), b: b ? who(b) : null, x: a.pos.x, z: a.pos.y, goal: a.task?.go ?? null });
  }

  /** Who `a` should look out for right now, as avoid.js wants them. */
  neighbours(a) {
    const out = [];
    // Personal space shrinks only where the aisle can't afford it: its width
    // across the way they're going, less the walls' margins and two bodies.
    const hx = a.vel.lengthSq() > 1e-4 ? a.vel.x : Math.sin(a.heading);
    const hz = a.vel.lengthSq() > 1e-4 ? a.vel.y : Math.cos(a.heading);
    const spare = this.grid.width(a.pos.x, a.pos.y, hx, hz, 1.5) - 2 * this.grid.radius - 2 * a.radius;
    let room = Math.min(1, Math.max(0, spare / 0.25));
    // Stepping into their own spot (a place at a rail, in a queue): the
    // neighbours there are expected; close is fine.
    const end = a.path?.[a.path.length - 1];
    if (end && !a.waitGate && Math.hypot(end[0] - a.pos.x, end[1] - a.pos.y) < 0.6) room = 0;
    for (const b of this.agents) {
      if (b === a || !b.visible) continue;
      const dx = b.pos.x - a.pos.x;
      const dz = b.pos.y - a.pos.y;
      const d2 = dx * dx + dz * dz;
      if (d2 > NEAR * NEAR) continue;
      const kin = a.party && b.party === a.party;
      const walking = !b.fixed && !!b.task?.go && b.vel.lengthSq() > 0.01 && b.fadeDir >= 0;
      // Going the same way through the same narrow place: single file. Whoever
      // is nearer the narrow part goes first and doesn't wait for the one
      // behind; the one behind follows, doing all the avoiding.
      const order = walking && !kin ? this.fileOrder(a, b) : 0;
      if (order > 0) continue;
      let mode = kin ? 'kin' : walking ? 'walk' : 'post';
      if (order < 0) mode = 'follow';
      const comfort = (kin ? ROOM_KIN : walking ? ROOM_WALK : ROOM_POST) * room;
      out.push({ x: b.pos.x, z: b.pos.y, vx: walking || kin ? b.vel.x : 0, vz: walking || kin ? b.vel.y : 0, r: b.extent, mode, comfort, d2, who: b });
    }
    if (out.length > MAX_NEAR) {
      out.sort((p, q) => p.d2 - q.d2);
      out.length = MAX_NEAR;
    }
    return out;
  }

  // ------------------------------------------------------------ frame

  update(dt) {
    if (!dt) return;
    this.time += dt;
    this.traffic.prune(this.time);
    const d = new Vector2();
    const g = this.grid;

    for (const a of this.agents) {
      if (!a.visible) continue;
      if (!a.task) this.next(a);
      const t = a.task;
      a.timer += dt;
      let px = 0;
      let pz = 0;
      let reach = Infinity; // how far the walker may look for walls (to its next waypoint)
      a.lookYaw = null;
      a.pref = null; // where they wanted to go this frame (set below when walking)

      // Leaving: once inside the portal, fade out there (and stop).
      if (t.exit && a.fadeDir >= 0 && this.inPortal(a.pos.x, a.pos.y, this.portal(t.exit))) a.fadeDir = -1;
      if (a.fadeDir < 0) {
        a.vel.multiplyScalar(Math.exp(-6 * dt));
        this.move(a, dt);
        continue;
      }
      if (t.exit && a.retry > 0) {
        a.retry -= dt;
        a.vel.set(0, 0);
        continue;
      }

      if (t.go && t.until?.(a)) {
        this.next(a);
        continue;
      }
      if (t.go) {
        if (!a.path || a.pathVersion !== this.grid.version) this.plan(a);
        if (!a.path && t.exit) {
          // The way out is blocked for now (a crowd at the door): wait, then try again.
          a.retry = 0.8 + (a.id % 5) * 0.15;
          continue;
        }
        if (!a.path) {
          // No way there right now (walled in by people standing, or the
          // goal is shut away): a failed errand, which the routine hears
          // about, rather than an arrival that never happened.
          a.failures = (a.failures ?? 0) + 1;
          a.vel.set(0, 0);
          this.next(a);
          continue;
        }
        // Keep the route fresh: others move, stop and start (with nobody
        // within a few metres, the route stays good and planning waits).
        a.replanIn = (a.replanIn ?? REPLAN * (0.4 + (a.id % 7) / 10)) - dt;
        if (a.replanIn <= 0 && !this.agents.some((b) => b !== a && b.visible && Math.abs(b.pos.x - a.pos.x) < 3 && Math.abs(b.pos.y - a.pos.y) < 3)) a.replanIn = REPLAN;
        // (Not while waiting a turn, or while going through a narrow place.)
        if (a.replanIn <= 0 && !a.detour && !a.waitGate && !a.gates.some((st) => st.held && !st.passed)) this.plan(a);
        const last = a.path.length - 1;
        let target = a.path[Math.min(a.wp, last)];
        if (a.detour) {
          // Stepping aside: head for the side spot, then plan again from there.
          a.detour.t -= dt;
          const [dx0, dz0] = a.detour.to;
          if (a.detour.t <= 0 || Math.hypot(dx0 - a.pos.x, dz0 - a.pos.y) < 0.06) {
            a.detour = null;
            a.path = null;
            continue;
          }
          target = a.detour.to;
        } else {
          // Advance past waypoints already reached, a little early: turning
          // toward the next one 30 cm before a corner rounds it into an arc
          // (routes keep room at corners), once it's in plain sight.
          while (a.wp < last && Math.hypot(target[0] - a.pos.x, target[1] - a.pos.y) < 0.3 && g.los(a.pos.x, a.pos.y, a.path[a.wp + 1][0], a.path[a.wp + 1][1])) {
            a.wp++;
            target = a.path[a.wp];
          }
        }
        d.set(target[0] - a.pos.x, target[1] - a.pos.y);
        const dist = d.length();
        const final = !a.detour && a.wp >= last;
        // Nearly there, but the last few centimetres are someone's elbow room
        // (the next place in a queue, a spot beside someone at a rail): here is close enough.
        const heldOff = final && dist < 0.25 && a.vel.lengthSq() < 0.01 && this.agents.some((b) => b !== a && b.visible && Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y) < a.radius + b.extent + GAP + 0.03);
        if (final && (dist < (t.via ? 0.3 : 0.06) || heldOff)) {
          a.vel.set(0, 0);
          a.failures = 0;
          this.traffic.release(a);
          if (t.exit) {
            // Arrived: as far into the portal as the floor allows (its middle
            // may sit in a margin nobody can stand in), so fade here. If the
            // route ended short of it (others crowd the portal), wait and go again.
            const p = this.portal(t.exit);
            if (p && Math.hypot(a.pos.x - p.x, a.pos.y - p.z) <= p.r) a.fadeDir = -1;
            else {
              a.retry = 0.8;
              a.path = null;
            }
            continue;
          }
          this.next(a);
          continue;
        }
        // Someone has stopped where this walk ends (after it was planned):
        // plan again, which routes to the nearest free place beside them.
        a.replanT = (a.replanT ?? 0) - dt;
        if (a.replanT <= 0 && final) {
          const end = a.path[last];
          if (this.agents.some((b) => b !== a && b.visible && b.anchored && Math.hypot(b.pos.x - end[0], b.pos.y - end[1]) < a.radius + b.extent)) {
            a.replanT = 0.5;
            this.plan(a);
            continue;
          }
        }

        a.pathS = this.progress(a);
        const waited = a.waitGate;
        const gate = a.detour ? null : this.gateAhead(a);
        a.waitGate = gate;
        if (waited && !gate) {
          // Their turn: from the waiting spot (off the route), plan the way through.
          this.plan(a);
          continue;
        }
        let speed = a.walkSpeed * (t.pace ?? 1) * this.partyPace(a) * (final && !t.via ? Math.min(1, dist / 0.35 + 0.25) : 1);
        if (gate) {
          // Waiting for a narrow place: to the waiting spot, then stand facing it.
          d.set(gate.at[0] - a.pos.x, gate.at[1] - a.pos.y);
          const wd = d.length();
          if (wd > 0.08) {
            speed = Math.min(speed, a.walkSpeed * Math.min(1, wd / 0.35 + 0.2));
            px = (d.x / wd) * speed;
            pz = (d.y / wd) * speed;
          }
          if (gate.who) a.lookAtWho = gate.who;
          a.timer -= dt; // waiting one's turn is not a route that never ends
        } else {
          px = (d.x / Math.max(dist, 1e-6)) * speed;
          pz = (d.y / Math.max(dist, 1e-6)) * speed;
          reach = dist + 0.05;
        }
        // Setting off at a sharp angle to where they face: turn on the spot
        // first, rather than slide away sideways.
        const want = Math.atan2(px, pz);
        if ((px || pz) && a.vel.length() < 0.08 && Math.abs(angleTo(a.heading, want)) > 1.2) {
          a.turnTo = want;
          px = 0;
          pz = 0;
        } else a.turnTo = gate && !(px || pz) ? Math.atan2(gate.st.dir[0], gate.st.dir[1]) : null;

        // Stuck: under 10 cm nearer the goal in a second (shuffling on the
        // spot counts; waiting a turn on purpose doesn't). First plan a way
        // round everyone (those stopped too), then step aside; after four
        // tries give up this errand.
        const remain = a.detour ? Math.hypot(a.detour.to[0] - a.pos.x, a.detour.to[1] - a.pos.y) : a.cum[a.cum.length - 1] - a.pathS;
        a.stuck.t += dt;
        if (gate) {
          a.stuck.t = 0;
          a.stuck.remain = remain;
        } else if (a.stuck.t > 1.0) {
          if ((a.stuck.remain ?? Infinity) - remain < 0.1) {
            a.stuck.tries++;
            this.stats.stuck++;
            this.note('stuck', a);
            if (a.stuck.tries % 2 === 0 && !a.detour && this.sidestep(a, a.stuck.tries >= 4)) {
              a.stuck.t = 0;
              a.stuck.remain = Infinity;
              continue;
            }
            if (a.stuck.tries > 4) {
              a.failures = (a.failures ?? 0) + 1;
              if (t.exit) {
                a.stuck.tries = 0;
                a.retry = 1;
                a.path = null;
                continue;
              }
              this.stats.gaveUp++;
              this.note('gaveUp', a);
              this.next(a);
              continue;
            }
            this.plan(a, true);
            a.stuck.t = 0;
            a.stuck.remain = Infinity; // a new route: measure from its start
            continue;
          }
          a.stuck.t = 0;
          a.stuck.remain = remain;
        }
        if (a.timer > 40 && !t.exit) this.next(a); // a route that never ends is a bug; move on
      } else if ((t.act || t.wait != null) && (a.timer >= (t.secs ?? t.wait ?? 0) || t.until?.(a))) {
        this.next(a);
        continue;
      }

      if (a.fixed) {
        a.vel.set(0, 0);
        continue;
      }

      // Pick this frame's velocity: the route's, bent round whoever is about.
      let vx = 0;
      let vz = 0;
      if (t.go) {
        const near = this.neighbours(a);
        const vmax = a.walkSpeed * 1.15 * Math.max(1, t.pace ?? 1, this.partyPace(a));
        if (near.length) {
          const wall = (wx, wz, maxT) => {
            const sp = Math.hypot(wx, wz);
            const L = Math.min(sp * maxT, reach);
            const step = g.cell * 0.5;
            for (let s = step; s <= L; s += step) {
              if (!g.free(a.pos.x + (wx / sp) * s, a.pos.y + (wz / sp) * s)) return s / sp;
            }
            return Infinity;
          };
          chooseVelocity(a, px, pz, near, wall, vmax, this.v2);
          vx = this.v2[0];
          vz = this.v2[1];
          this.lookOut(a, near);
          // Stopped short by someone standing across the way (the route has
          // nowhere else to go): after a moment, "excuse me", and they make way.
          const pl = Math.hypot(px, pz);
          if (pl > 0.2 && Math.hypot(vx, vz) < 0.25 * pl && !a.waitGate) {
            let block = null;
            for (const n of near) {
              if (n.mode !== 'post' || n.who.fixed || !n.who.anchored) continue;
              const ox = n.x - a.pos.x;
              const oz = n.z - a.pos.y;
              const dd = Math.hypot(ox, oz);
              if (dd < a.radius + n.r + 0.4 && (ox * px + oz * pz) / (dd * pl) > 0.3) block = n.who;
            }
            a.heldT = block ? (a.heldT ?? 0) + dt : 0;
            if (block && a.heldT > 0.7) {
              if (this.makeWay(block, a)) {
                this.stats.makeWay++;
                this.note('makeWay', a, block);
              }
              a.heldT = 0;
            }
          } else a.heldT = 0;
        } else {
          vx = px;
          vz = pz;
        }
      }
      a.pref = [px, pz];
      a.chose = [vx, vz];
      const k = 1 - Math.exp(-ACCEL * dt);
      a.vel.x += (vx - a.vel.x) * k;
      a.vel.y += (vz - a.vel.y) * k;
      const max = a.walkSpeed * 1.15 * Math.max(1, t.pace ?? 1, this.partyPace(a));
      if (a.vel.length() > max) a.vel.setLength(max);
      // Never walk into anyone: take away the part of the actual velocity
      // that presses into them, so the walker slides round or stops.
      a.twist = 0;
      for (const b of this.agents) {
        if (b === a || !b.visible) continue;
        d.subVectors(a.pos, b.pos);
        const dist = d.length();
        const R = a.radius + b.extent;
        // Squeezing past close: shoulders turn toward them (a figure turns its
        // body to pass someone at arm's length).
        if (t.go && dist < R + 0.14 && dist > 1e-6 && a.vel.lengthSq() > 0.01) {
          const rel = angleTo(a.heading, Math.atan2(b.pos.x - a.pos.x, b.pos.y - a.pos.y));
          if (Math.abs(rel) > 0.5 && Math.abs(rel) < 2.6) {
            const tw = Math.sign(rel) * 0.5 * Math.min(1, (R + 0.14 - dist) / 0.14);
            if (Math.abs(tw) > Math.abs(a.twist)) a.twist = tw;
          }
        }
        if (dist >= R + (b.anchored || b.fixed ? CONTACT : GAP) || dist < 1e-6) continue;
        d.multiplyScalar(1 / dist);
        const vn = a.vel.dot(d);
        if (vn < 0) a.vel.addScaledVector(d, -vn);

      }

      this.move(a, dt);
    }

    this.resolve(dt);

    for (const a of this.agents) {
      if (!a.visible) continue;
      if (a.fadeDir) {
        a.fade = Math.min(1, Math.max(0, a.fade + (a.fadeDir * dt) / FADE));
        a.fig.setFade?.(a.fade);
        if (a.fade >= 1) a.fadeDir = 0;
        if (a.fade <= 0) {
          this.hide(a);
          continue;
        }
      }
      const prev = { x: a.fig.root.position.x, z: a.fig.root.position.z };
      this.animate(a, dt);
      for (const fn of this.listeners) fn(a, prev, dt);
    }
  }

  /**
   * Where a walker's head goes: a glance at someone coming the other way who
   * would reach them within two seconds (once per encounter, about a second),
   * else into the turn ahead.
   */
  lookOut(a, near) {
    if (a.glance && (this.time - a.glance.t > 1.1 || !a.glance.who.visible)) a.glance = { ...a.glance, done: true };
    let threat = null;
    let tmin = 2;
    for (const n of near) {
      if (n.mode !== 'walk') continue;
      const t = ttc(n.x - a.pos.x, n.z - a.pos.y, a.vel.x - n.vx, a.vel.y - n.vz, a.radius + n.r + 0.4);
      if (t < tmin) {
        tmin = t;
        threat = n.who;
      }
    }
    if (threat && (!a.glance || a.glance.who !== threat)) a.glance = { who: threat, t: this.time };
    if (a.glance && !a.glance.done) a.lookAtWho = a.glance.who;
  }

  /** Integrate, sliding along blocked cells rather than entering them. */
  move(a, dt) {
    const g = this.grid;
    const nx = a.pos.x + a.vel.x * dt;
    const nz = a.pos.y + a.vel.y * dt;
    // A step (or a slide along a wall) that closes on someone already within
    // touching distance is not taken: sliding one axis at a time otherwise
    // creeps people into each other.
    const ok = (x, z) => g.free(x, z) && !this.closesIn(a, x, z) && this.allowed(a, x, z);
    if (ok(nx, nz)) a.pos.set(nx, nz);
    else if (ok(nx, a.pos.y)) {
      a.pos.x = nx;
      a.vel.y = 0;
    } else if (ok(a.pos.x, nz)) {
      a.pos.y = nz;
      a.vel.x = 0;
    } else if (g.free(nx, nz) || g.free(nx, a.pos.y) || g.free(a.pos.x, nz)) {
      a.vel.multiplyScalar(0.5); // held up by a person: wait for them
    } else {
      a.vel.set(0, 0);
      // Somehow inside a blocked cell (a fixture was dropped on it): step out.
      if (!g.free(a.pos.x, a.pos.y)) {
        const p = g.nearestFree(a.pos.x, a.pos.y);
        if (p) a.pos.set(p[0], p[1]);
      }
    }
  }

  /** Would standing at (x, z) bring `a` closer to anyone it is already touching? */
  closesIn(a, x, z) {
    for (const b of this.agents) {
      if (b === a || !b.visible) continue;
      const min = a.radius + b.extent + GAP;
      const now = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
      const then = Math.hypot(x - b.pos.x, z - b.pos.y);
      if (then < min && then < now) return true;
    }
    return false;
  }

  /**
   * Two people blocking each other in an aisle: the one giving way (the
   * higher id, or anyone facing someone standing) steps aside to a free spot
   * beside the line between them for a moment, then carries on.
   */
  sidestep(a, anyone = false) {
    let other = null;
    let od = Infinity;
    for (const b of this.agents) {
      if (b === a || !b.visible) continue;
      const d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
      if (d < a.radius + b.radius + 0.12 && d < od) {
        od = d;
        other = b;
      }
    }
    // Two walkers: the higher id steps aside (either, once it has gone on a while).
    if (!other || (!anyone && !other.anchored && other.id > a.id)) return false;
    const ux = (a.pos.x - other.pos.x) / (od || 1);
    const uz = (a.pos.y - other.pos.y) / (od || 1);
    const g = this.grid;
    for (const side of [1, -1]) {
      for (const r of [0.35, 0.5]) {
        const x = a.pos.x + (-uz * side + ux * 0.5) * r;
        const z = a.pos.y + (ux * side + uz * 0.5) * r;
        if (g.free(x, z) && this.allowed(a, x, z) && g.los(a.pos.x, a.pos.y, x, z) && this.clearOfAll(a, x, z)) {
          a.detour = { to: [x, z], t: 1.4 };
          a.path = null;
          this.stats.sidestep++;
          this.note('sidestep', a, other);
          return true;
        }
      }
    }
    return false;
  }

  /**
   * `b`, standing, steps aside for `a`: to the nearest free spot clear of the
   * next few metres of `a`'s route (a step to the side in the open; in a
   * narrow aisle, out of its end), then goes back to what they were doing.
   * Nobody fixed (behind a counter) or in the middle of paying moves.
   */
  makeWay(b, a) {
    if (b.fixed || b.resume || b.detour || b.fadeDir || /^(pay|scan|tryon)$/.test(b.task?.act ?? '')) return false;
    const g = this.grid;
    const ux = b.pos.x - a.pos.x;
    const uz = b.pos.y - a.pos.y;
    const l = Math.hypot(ux, uz) || 1;
    // a's way ahead: its route for the next 3 m, or else the line through b.
    const route = [[a.pos.x, a.pos.y]];
    if (a.path) {
      let left = 3;
      let [x, z] = route[0];
      for (let k = a.wp; k < a.path.length && left > 0; k++) {
        const [tx, tz] = a.path[k];
        const seg = Math.hypot(tx - x, tz - z);
        const f = Math.min(1, left / (seg || 1));
        route.push([x + (tx - x) * f, z + (tz - z) * f]);
        left -= seg;
        x = tx;
        z = tz;
      }
    } else route.push([b.pos.x + (ux / l) * 1.5, b.pos.y + (uz / l) * 1.5]);
    const offRoute = (x, z) => {
      let dmin = Infinity;
      for (let k = 1; k < route.length; k++) {
        const [x0, z0] = route[k - 1];
        const [x1, z1] = route[k];
        const lx = x1 - x0;
        const lz = z1 - z0;
        const t = Math.min(1, Math.max(0, ((x - x0) * lx + (z - z0) * lz) / (lx * lx + lz * lz || 1)));
        dmin = Math.min(dmin, Math.hypot(x - x0 - lx * t, z - z0 - lz * t));
      }
      return dmin;
    };
    const need = a.radius + b.radius + 0.05;
    const found = [];
    for (const r of [0.35, 0.5, 0.7, 0.9, 1.2, 1.6, 2.0, 2.6]) {
      for (let k = 0; k < 16; k++) {
        const ang = (k / 16) * Math.PI * 2;
        const dx = Math.cos(ang);
        const dz = Math.sin(ang);
        const x = b.pos.x + dx * r;
        const z = b.pos.y + dz * r;
        if (!g.free(x, z) || !this.allowed(b, x, z) || !this.clearOfAll(b, x, z) || offRoute(x, z) < need) continue;
        const away = (dx * ux + dz * uz) / l; // 1 = straight away from a, -1 = into a
        if (away < -0.3) continue;
        found.push({ x, z, r, sc: r - away * 0.1 });
      }
      if (found.length) break;
    }
    found.sort((p, q) => p.sc - q.sc);
    // Reachable without walking through anyone: in plain sight, or by a short route.
    const best = found.find((f) => (f.r <= 0.9 && g.los(b.pos.x, b.pos.y, f.x, f.z)) || (g.path([b.pos.x, b.pos.y], [f.x, f.z], this.crowdCells(b, true))?.length ?? 99) < 6);
    if (!best) return false;
    const to = [best.x, best.z];
    if (b.task?.go) {
      // Walking: step aside on the way, keeping the errand (and planning the
      // rest of it again from the side, perhaps by another way round).
      b.detour = { to, t: 1.6 };
      b.path = null;
      return true;
    }
    if (b.task) b.resume = b.task;
    b.task = { go: to, claim: b.claim, face: b.task?.face };
    b.timer = 0;
    b.path = null;
    return true;
  }

  /** May `a` stand at (x, z)? (Not in a place it keeps out of.) */
  allowed(a, x, z) {
    return !a.keepOut || !a.keepOut.some((poly) => inPoly(x, z, poly));
  }

  clearOfAll(mover, x, z) {
    return this.agents.every((c) => c === mover || !c.visible || Math.hypot(c.pos.x - x, c.pos.y - z) >= c.extent + mover.radius);
  }

  /** Hard constraint: no two figures closer than their radii allow. */
  resolve(dt = 1 / 60) {
    const g = this.grid;
    const d = new Vector2();
    this.wedged ??= new Map();
    const seen = new Set();
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < this.agents.length; i++) {
        const a = this.agents[i];
        if (!a.visible) continue;
        for (let j = i + 1; j < this.agents.length; j++) {
          const b = this.agents[j];
          if (!b.visible) continue;
          d.subVectors(a.pos, b.pos);
          const min = a.extent + b.extent;
          const dist = d.length();
          if (dist >= min) continue;
          // Wedged together for a while (in a doorway, say, where pushing can't
          // separate them): one of them makes way, whoever is standing, or
          // the later arrival.
          if (pass === 0 && dist < min - 0.06) {
            const key = `${a.id}-${b.id}`;
            seen.add(key);
            const t = (this.wedged.get(key) ?? 0) + dt;
            this.wedged.set(key, t);
            if (t > 0.4) {
              const [mover, other] = a.fixed ? [b, a] : b.fixed ? [a, b] : a.anchored && !b.anchored ? [a, b] : b.anchored && !a.anchored ? [b, a] : a.id > b.id ? [a, b] : [b, a];
              if (this.makeWay(mover, other) || this.makeWay(other, mover)) {
                this.wedged.delete(key);
                this.stats.wedged++;
              }
            }
          }
          const ux = dist > 1e-6 ? d.x / dist : 1;
          const uz = dist > 1e-6 ? d.y / dist : 0;
          // A small correction per pass: overlaps are prevented upstream, and
          // a big one resolved at once reads as someone jumping.
          const full = Math.min(min - dist + 1e-4, NUDGE);
          // An anchor stays put; the one walking takes the whole correction.
          let shareA = a.anchored && !b.anchored ? 0 : b.anchored && !a.anchored ? 1 : 0.5;
          if (a.fixed) shareA = 0;
          if (b.fixed) shareA = 1;
          if (a.fixed && b.fixed) continue;
          const ax = a.pos.x + ux * full * shareA;
          const az = a.pos.y + uz * full * shareA;
          const bx = b.pos.x - ux * full * (1 - shareA);
          const bz = b.pos.y - uz * full * (1 - shareA);
          const okA = g.free(ax, az) && this.allowed(a, ax, az);
          const okB = g.free(bx, bz) && this.allowed(b, bx, bz);
          if (okA && okB) {
            a.pos.set(ax, az);
            b.pos.set(bx, bz);
          } else if (okA && shareA > 0 && g.free(a.pos.x + ux * full, a.pos.y + uz * full) && this.allowed(a, a.pos.x + ux * full, a.pos.y + uz * full)) {
            a.pos.set(a.pos.x + ux * full, a.pos.y + uz * full);
          } else if (okB && shareA < 1 && g.free(b.pos.x - ux * full, b.pos.y - uz * full) && this.allowed(b, b.pos.x - ux * full, b.pos.y - uz * full)) {
            b.pos.set(b.pos.x - ux * full, b.pos.y - uz * full);
          } else {
            // Pinned against something: put the mover on the nearest free
            // spot at arm's length from the other, clear of everyone else too.
            const mover = shareA === 0 ? b : a;
            const other = mover === a ? b : a;
            const sx = mover.pos.x - other.pos.x;
            const sz = mover.pos.y - other.pos.y;
            let best = null;
            let bd = Infinity;
            for (let k = 0; k < 24; k++) {
              const ang = (k / 24) * Math.PI * 2;
              const x = other.pos.x + Math.cos(ang) * (min + 0.01);
              const z = other.pos.y + Math.sin(ang) * (min + 0.01);
              // Never through a wall, and never through the other person: only
              // somewhere on the mover's own side, in plain sight of where they stand.
              if ((x - other.pos.x) * sx + (z - other.pos.y) * sz <= 0) continue;
              if (!g.free(x, z) || !this.allowed(mover, x, z) || !this.clearOfAll(mover, x, z) || !g.los(mover.pos.x, mover.pos.y, x, z)) continue;
              const dd = Math.hypot(x - mover.pos.x, z - mover.pos.y);
              if (dd < bd) {
                bd = dd;
                best = [x, z];
              }
            }
            // Towards it a little at a time: someone pinned slides free over a
            // few frames rather than jumping there in one.
            if (best) {
              const dx = best[0] - mover.pos.x;
              const dz = best[1] - mover.pos.y;
              const k = Math.min(1, NUDGE / (Math.hypot(dx, dz) || 1));
              const nx = mover.pos.x + dx * k;
              const nz = mover.pos.y + dz * k;
              if (g.free(nx, nz)) mover.pos.set(nx, nz);
            }
          }
        }
      }
    }
    for (const key of this.wedged.keys()) if (!seen.has(key)) this.wedged.delete(key);
  }

  /**
   * A party keeps together: the leader slows while anyone lags, and a
   * follower who has fallen behind catches up.
   */
  partyPace(a) {
    if (!a.party || !a.leader || !a.leader.visible) return 1;
    if (a.leader === a) {
      let far = 0;
      for (const b of this.agents) if (b !== a && b.visible && b.leader === a) far = Math.max(far, Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y));
      // A follower's place is about 0.8 m back (behind and to one side).
      return far > 1.5 ? 0.6 : far > 1.15 ? 0.85 : 1;
    }
    const d = Math.hypot(a.leader.pos.x - a.pos.x, a.leader.pos.y - a.pos.y);
    return d > 1.1 ? 1.3 : 1;
  }

  /** Place the figure, turn it, and pick and pace its clip. */
  animate(a, dt) {
    const f = a.fig;
    f.root.position.set(a.pos.x, 0, a.pos.y);
    const t = a.task ?? {};
    let want = a.heading;
    const speed = a.vel.length();
    if (speed > 0.06) want = Math.atan2(a.vel.x, a.vel.y);
    else if (a.turnTo != null) want = a.turnTo;
    else if (t.face != null) {
      want = Array.isArray(t.face) ? Math.atan2(t.face[0] - a.pos.x, t.face[1] - a.pos.y) : t.face;
    }
    a.heading += angleTo(a.heading, want) * (1 - Math.exp(-(a.turnTo != null ? TURN * 1.4 : TURN) * dt));
    f.root.rotation.y = a.heading;
    // Where the head turns: at whoever they are waiting for or glancing at;
    // walking, into the turn ahead; standing, at whoever is close in front
    // (the cashier to the customer, a family to each other).
    if (f.look) {
      let yaw = 0;
      const who = a.lookAtWho;
      a.lookAtWho = null;
      if (who?.visible) yaw = angleTo(a.heading, Math.atan2(who.pos.x - a.pos.x, who.pos.y - a.pos.y));
      else if (speed >= 0.1 && a.path && t.go) {
        const k = Math.min(a.wp + 1, a.path.length - 1);
        const [x, z] = a.path[k];
        if (Math.hypot(x - a.pos.x, z - a.pos.y) > 0.2) yaw = 0.5 * angleTo(a.heading, Math.atan2(x - a.pos.x, z - a.pos.y));
      } else if (speed < 0.1) {
        let bd = 1.5;
        for (const b of this.agents) {
          if (b === a || !b.visible) continue;
          const dd = Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y);
          const rel = angleTo(a.heading, Math.atan2(b.pos.x - a.pos.x, b.pos.y - a.pos.y));
          if (dd < bd && Math.abs(rel) < 1.3) {
            bd = dd;
            yaw = rel;
          }
        }
      }
      f.look(yaw);
    }
    f.twist?.(a.twist ?? 0);

    let clip = t.act ?? 'idle';
    // Someone carrying a carton walks with it held: their own walk clip.
    const walk = a.walkClip ?? 'walk';
    if (t.go) clip = speed > 0.06 ? walk : 'idle';
    if (clip !== a.clip) {
      f.play(clip, clip === walk || a.clip === walk ? 0.25 : 0.4);
      a.clip = clip;
    }
    f.setTimeScale(clip === walk ? Math.min(1.25, Math.max(0.55, speed / a.walkSpeed)) : 1);
    f.update(dt);
  }
}
