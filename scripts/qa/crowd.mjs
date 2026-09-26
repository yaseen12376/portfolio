/**
 * The crowd engine on its own, in Node: scripted encounters on small synthetic
 * floors, measured the way you see them.
 *
 *   node scripts/qa/crowd.mjs [names...] [--verbose]
 *
 * Each case builds a nav grid (walls and aisles of a known width), puts a few
 * people on it with a script of places to walk to, runs the real Crowd
 * (src/three/sim/) and checks what a viewer would notice:
 *   - gap: how close two bodies ever came (centre distance minus both body
 *     radii). Below zero, one figure is visibly inside another.
 *   - early: how far apart two people were when one first turned aside for the
 *     other (people steer round each other a metre or two ahead, not at arm's length)
 *   - speed: the slowest a walker went mid-route (bump and stop, or flow past)
 *   - fallbacks: the crowd's last resorts (sidesteps, asking someone to make
 *     way, wedged pairs); in a good crowd they almost never fire
 *   - arrival times, and the cost of one crowd update
 */
import { Crowd, Agent } from '../../src/three/sim/agents.js';
import { tune } from '../../src/three/sim/avoid.js';
import { NavGrid } from '../../src/three/sim/grid.js';

// TUNE='toi=3,side=1' tries other avoidance weights.
for (const kv of (process.env.TUNE ?? '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  tune[k] = +v;
}

const argv = process.argv.slice(2);
const verbose = argv.includes('--verbose');
const only = argv.filter((a) => !a.startsWith('--'));

/** 0.265 m: the figure's half-width at the shoulders and arms (kit/people.py). */
const BODY = 0.265;
const WALL = 0.2; // the grid's dilation: the least a figure's centre keeps from a wall
const CELL = 0.05;

/** A w x h metre floor with rectangles [x0, z0, x1, z1] blocked. */
function floor(w, h, blocks = []) {
  const gw = Math.round(w / CELL);
  const gh = Math.round(h / CELL);
  const bytes = new Uint8Array(Math.ceil((gw * gh) / 8));
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const x = (i + 0.5) * CELL;
      const z = (j + 0.5) * CELL;
      if (blocks.some(([x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1)) {
        const k = j * gw + i;
        bytes[k >> 3] |= 1 << (7 - (k & 7));
      }
    }
  }
  return new NavGrid({ origin: [0, 0], cell: CELL, w: gw, h: gh, data: Buffer.from(bytes).toString('base64') }, { radius: WALL });
}

/** Just enough of a figure for the crowd: a root to place, clips to ignore. */
function stubFigure(x, z, face = 0) {
  const position = { x, y: 0, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; } };
  return { root: { position, rotation: { y: face }, visible: true }, play() {}, setTimeScale() {}, update() {}, look() {}, twist() {}, setFade() {} };
}

/**
 * Run a case. `people`: { at: [x, z], face?, speed?, radius?, script: task[] | (a) => task, tags? }
 * A script is walked through in order, then the person waits.
 */
function run({ grid, people, secs, dt = 1 / 30, portals = [], during, trace = process.env.TRACE ? +process.env.TRACE : 0 }) {
  const crowd = new Crowd(grid, { portals });
  const agents = people.map((p, k) => {
    const script = p.script ?? [];
    let i = 0;
    const think = typeof script === 'function' ? script : () => (i < script.length ? { ...script[i++] } : { wait: 999 });
    const a = new Agent(stubFigure(p.at[0], p.at[1], p.face ?? 0), { id: k + 1, radius: p.radius ?? BODY, speed: p.speed ?? 0.67, think });
    Object.assign(a, p.tags ?? {});
    if (Array.isArray(script)) a.dest = [...script].reverse().find((x) => x.go)?.go ?? null;
    crowd.add(a);
    return a;
  });
  const m = {
    gap: Infinity,
    gapAt: '',
    overlapSecs: 0,
    minSpeed: new Map(agents.map((a) => [a, Infinity])),
    early: new Map(), // pair key -> centre distance when one first turned aside
    arrived: new Map(),
    stuckLong: 0,
    times: [],
    track: new Map(agents.map((a) => [a, []])),
  };
  const start = new Map(agents.map((a) => [a, a.pos.clone()]));
  const lastMove = new Map(agents.map((a) => [a, { x: a.pos.x, z: a.pos.y, t: 0 }]));
  const steps = Math.round(secs / dt);
  for (let s = 0; s < steps; s++) {
    const t = s * dt;
    during?.(t, agents, crowd);
    const t0 = performance.now();
    crowd.update(dt);
    m.times.push(performance.now() - t0);
    let overlap = false;
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      if (!a.visible) continue;
      m.track.get(a).push([a.pos.x, a.pos.y]);
      // Mid-route speed: walking, and more than half a metre from where the walk starts or ends.
      const goal = a.task?.go;
      if (goal && a.path) {
        const fromStart = a.pos.distanceTo(start.get(a));
        const toEnd = Math.hypot(goal[0] - a.pos.x, goal[1] - a.pos.y);
        if (fromStart > 0.5 && toEnd > 0.5 && !a.waitGate) m.minSpeed.set(a, Math.min(m.minSpeed.get(a), a.vel.length() / a.walkSpeed));
      }
      if (!goal && !m.arrived.has(a) && (!a.dest || Math.hypot(a.pos.x - a.dest[0], a.pos.y - a.dest[1]) < 0.3)) m.arrived.set(a, t);
      // Stuck: walking but not getting anywhere for 3 s, unless waiting at a narrow place on purpose.
      const lm = lastMove.get(a);
      if (Math.hypot(a.pos.x - lm.x, a.pos.y - lm.z) > 0.1 || !goal || a.waitGate) Object.assign(lm, { x: a.pos.x, z: a.pos.y, t });
      else if (t - lm.t > 1 && t - lm.t > m.stuckLong) {
        m.stuckLong = t - lm.t;
        const nb = agents.filter((b) => b !== a && b.visible && b.pos.distanceTo(a.pos) < 1.2).map((b) => `${b.id}@${b.pos.x.toFixed(2)},${b.pos.y.toFixed(2)}${b.task?.go ? ' walking' : ' standing'}`);
        m.stuckAt = `${a.id} at ${a.pos.x.toFixed(2)},${a.pos.y.toFixed(2)} going ${goal.map((v) => v.toFixed(2))} pref ${a.pref?.map((v) => v.toFixed(2))} chose ${a.chose?.map((v) => v.toFixed(2))} t=${t.toFixed(1)} near: ${nb.join('; ')}`;
      }
      for (let j = i + 1; j < agents.length; j++) {
        const b = agents[j];
        if (!b.visible) continue;
        const gap = a.pos.distanceTo(b.pos) - a.radius - b.radius;
        if (gap < m.gap) {
          m.gap = gap;
          m.gapAt = `${a.id}&${b.id} t=${t.toFixed(1)}`;
        }
        if (gap < -0.005) overlap = true;
      }
    }
    if (overlap) m.overlapSecs += dt;
    if (trace && s % Math.round(trace / dt) === 0) {
      console.log(`t=${t.toFixed(1)} ` + agents.filter((a) => a.visible).map((a) => `${a.id}:${a.pos.x.toFixed(2)},${a.pos.y.toFixed(2)} v${a.vel.length().toFixed(2)}${a.waitGate ? ' WAIT' : ''}${a.detour ? ' DET' : ''}${a.task?.go ? '' : ' ' + (a.task?.act ?? (a.task?.wait != null ? 'wait' : '-'))}${a.gates?.length ? ` g${a.gates.map((g) => (g.passed ? 'p' : g.held ? 'h' : '.')).join('')}` : ''} s${a.stuck.tries}${process.env.TRACEV && a.pref ? ` p${a.pref.map((v) => v.toFixed(2))} c${a.chose.map((v) => v.toFixed(2))} wp${a.wp}/${a.path?.length} h${a.heading.toFixed(2)}` : ''}`).join(' | '));
    }
  }
  m.times.sort((x, y) => x - y);
  m.update = m.times[m.times.length >> 1];
  m.stats = { ...(crowd.stats ?? {}) };
  m.fallbacks = (crowd.stats?.sidestep ?? 0) + (crowd.stats?.makeWay ?? 0) + (crowd.stats?.wedged ?? 0);
  m.agents = agents;
  m.crowd = crowd;
  return m;
}

/** How far apart a and b were when either first left its straight line by more than 5 cm. */
function firstTurn(m, a, b, line) {
  const ta = m.track.get(a);
  const tb = m.track.get(b);
  for (let k = 0; k < Math.min(ta.length, tb.length); k++) {
    const off = (p, l) => Math.abs((p[0] - l[0][0]) * (l[1][1] - l[0][1]) - (p[1] - l[0][1]) * (l[1][0] - l[0][0])) / Math.hypot(l[1][0] - l[0][0], l[1][1] - l[0][1]);
    if (off(ta[k], line.a) > 0.05 || off(tb[k], line.b) > 0.05) return Math.hypot(ta[k][0] - tb[k][0], ta[k][1] - tb[k][1]);
  }
  return Infinity;
}

const go = (x, z, extra = {}) => ({ go: [x, z], ...extra });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`);
};
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));
const slowest = (m, list = m.agents) => Math.min(...list.map((a) => m.minSpeed.get(a)));

const cases = {
  headOn() {
    const grid = floor(9, 6);
    const m = run({ grid, secs: 16, people: [
      { at: [1, 3], face: Math.PI / 2, script: [go(8, 3)] },
      { at: [8, 3], face: -Math.PI / 2, script: [go(1, 3)] },
    ] });
    const [a, b] = m.agents;
    const early = firstTurn(m, a, b, { a: [[1, 3], [8, 3]], b: [[8, 3], [1, 3]] });
    check('head-on, open floor: steer early', early >= 1.5, `first turned aside ${f2(early)} m apart (centres)`);
    check('head-on, open floor: comfortable gap', m.gap >= 0.1, `closest ${f2(m.gap)} m`);
    check('head-on, open floor: no stopping', slowest(m) >= 0.4, `slowest ${f2(slowest(m) * 100)}% of walking pace`);
    check('head-on, open floor: both arrive', m.arrived.size === 2, `${[...m.arrived.values()].map(f2).join(', ')} s`);
    return m;
  },
  crossing() {
    const grid = floor(9, 7);
    const m = run({ grid, secs: 16, people: [
      { at: [1, 3.5], face: Math.PI / 2, script: [go(8, 3.5)] },
      { at: [4.5, 0.3], face: 0, script: [go(4.5, 6.7)] },
    ] });
    check('90° crossing: no stopping', slowest(m) >= 0.3, `slowest ${f2(slowest(m) * 100)}%`);
    check('90° crossing: gap', m.gap >= 0.08, `closest ${f2(m.gap)} m`);
    return m;
  },
  overtake() {
    // An aisle 1.5 m wide between two long fixtures.
    const grid = floor(9, 6, [[0, 0, 9, 2.25], [0, 3.75, 9, 6]]);
    const m = run({ grid, secs: 22, people: [
      { at: [2, 3], face: Math.PI / 2, speed: 0.42, script: [go(8.5, 2.7)] },
      { at: [0.5, 3], face: Math.PI / 2, speed: 0.8, script: [go(8.5, 3.3)] },
    ] });
    const [slow, fast] = m.agents;
    check('overtaking in a 1.5 m aisle: passes', m.arrived.get(fast) < m.arrived.get(slow), `fast ${f2(m.arrived.get(fast))} s, slow ${f2(m.arrived.get(slow))} s`);
    check('overtaking in a 1.5 m aisle: no contact', m.gap >= 0.02, `closest ${f2(m.gap)} m`);
    return m;
  },
  aisle12() {
    const grid = floor(9, 6, [[0, 0, 9, 2.4], [0, 3.6, 9, 6]]);
    const m = run({ grid, secs: 20, people: [
      { at: [0.5, 3], face: Math.PI / 2, script: [go(8.5, 3)] },
      { at: [8.5, 3], face: -Math.PI / 2, script: [go(0.5, 3)] },
    ] });
    check('head-on in a 1.2 m aisle: both through', m.arrived.size === 2, `${[...m.arrived.values()].map(f2).join(', ')} s`);
    check('head-on in a 1.2 m aisle: no contact', m.gap >= 0.02, `closest ${f2(m.gap)} m`);
    check('head-on in a 1.2 m aisle: no fallbacks', m.fallbacks === 0, JSON.stringify(m.stats));
    return m;
  },
  aisle08() {
    // Open floor either end, a 3 m single-file passage 0.8 m wide in the middle.
    const grid = floor(10, 6, [[3.5, 0, 6.5, 2.6], [3.5, 3.4, 6.5, 6]]);
    const m = run({ grid, secs: 30, people: [
      { at: [0.8, 3], face: Math.PI / 2, script: [go(9.2, 3)] },
      { at: [9.2, 3], face: -Math.PI / 2, script: [go(0.8, 3)] },
    ] });
    const free = 8.4 / 0.67;
    const worst = Math.max(...m.agents.map((a) => m.arrived.get(a) ?? Infinity));
    check('head-on in a 0.8 m aisle: nobody overlaps', m.overlapSecs === 0, `closest ${f2(m.gap)} m`);
    check('head-on in a 0.8 m aisle: one waits, both through', worst <= free + 3 / 0.67 + 1.5 + 1, `last arrived ${f2(worst)} s (alone: ${f2(free)} s)`);
    return m;
  },
  doorway() {
    // A wall across the floor with a 1.0 m door; three go out, three come in.
    const grid = floor(10, 7, [[4.9, 0, 5.1, 3.0], [4.9, 4.0, 5.1, 7]]);
    const out = [[2, 2.5], [1.2, 3.6], [2.4, 4.6]];
    const inn = [[8, 2.6], [8.6, 3.8], [7.6, 4.8]];
    const m = run({ grid, secs: 30, people: [
      ...out.map((p, k) => ({ at: p, face: Math.PI / 2, tags: { outbound: true }, script: [go(8.8, 1.2 + k * 1.6)] })),
      ...inn.map((p, k) => ({ at: p, face: -Math.PI / 2, script: [go(1.2, 1.2 + k * 1.6)] })),
    ] });
    const through = (a) => m.track.get(a).findIndex((p, k, t) => k && (t[k - 1][0] - 5) * (p[0] - 5) <= 0);
    const outT = m.agents.filter((a) => a.outbound).map(through);
    const inT = m.agents.filter((a) => !a.outbound).map(through);
    const mean = (l) => l.reduce((s, v) => s + v, 0) / l.length;
    check('doorway: nobody overlaps', m.overlapSecs === 0, `closest ${f2(m.gap)} m`);
    check('doorway: all six through', m.arrived.size === 6, `${m.arrived.size} arrived`);
    check('doorway: people leaving go first', mean(outT) < mean(inT), `mean crossing ${f2(mean(outT) / 30)} s out, ${f2(mean(inT) / 30)} s in`);
    return m;
  },
  browsing12() {
    // Someone browsing at the side of a 1.2 m aisle; a walker passes.
    const grid = floor(9, 6, [[0, 0, 9, 2.4], [0, 3.6, 9, 6]]);
    const m = run({ grid, secs: 18, people: [
      { at: [4.5, 2.75], face: Math.PI, script: [{ act: 'browse', secs: 60, face: Math.PI }] },
      { at: [0.5, 3.1], face: Math.PI / 2, script: [go(8.5, 3.1)] },
    ] });
    check('passing someone browsing (1.2 m aisle): no contact', m.gap >= 0, `closest ${f2(m.gap)} m`);
    check('passing someone browsing (1.2 m aisle): no one asked to move', (m.stats.makeWay ?? 0) === 0, JSON.stringify(m.stats));
    return m;
  },
  browsing09() {
    // A 3 m run of 0.9 m aisle, open floor either end (somewhere to step aside to).
    const grid = floor(9, 6, [[3, 0, 6, 2.55], [3, 3.45, 6, 6]]);
    const m = run({ grid, secs: 24, people: [
      { at: [4.5, 2.85], face: Math.PI, script: [{ act: 'browse', secs: 60, face: Math.PI }] },
      { at: [0.5, 3.0], face: Math.PI / 2, script: [go(8.5, 3.0)] },
    ] });
    const w = m.agents[1];
    check('passing someone browsing (0.9 m aisle): gets through', m.arrived.has(w), `arrived ${f2(m.arrived.get(w))} s`);
    check('passing someone browsing (0.9 m aisle): no overlap', m.overlapSecs === 0, `closest ${f2(m.gap)} m`);
    check('passing someone browsing (0.9 m aisle): at most one make-way', (m.stats.makeWay ?? 0) <= 1, JSON.stringify(m.stats));
    return m;
  },
  party() {
    // An L-shaped corridor 1.4 m wide; a family of three walks it.
    const grid = floor(9, 9, [[0, 0, 9, 1.3], [0, 2.7, 6.3, 9], [7.7, 1.3, 9, 9]]);
    let L;
    const follower = (slot) => (a) => {
      const d = L.vel.lengthSq() > 0.01 ? L.vel.clone().normalize() : { x: Math.sin(L.heading), y: Math.cos(L.heading) };
      const tx = L.pos.x - d.x * 0.7 + d.y * slot * 0.4;
      const tz = L.pos.y - d.y * 0.7 - d.x * slot * 0.4;
      const from = L.pos.clone();
      const p = grid.nearestFree(tx, tz) ?? [L.pos.x, L.pos.y];
      return { go: p, until: () => L.pos.distanceTo(from) > 0.45 };
    };
    const m = run({ grid, secs: 26, people: [
      { at: [0.7, 2.0], face: Math.PI / 2, script: [go(7.0, 2.0), go(7.0, 8.5)] },
      { at: [0.4, 1.7], tags: { party: 1 }, script: follower(1) },
      { at: [0.4, 2.3], tags: { party: 1 }, script: follower(-1), radius: BODY * 0.82 },
    ], during: (t, ag) => {
      if (t === 0) {
        L = ag[0];
        L.party = 1;
        for (const x of ag) x.leader = L;
      }
    } });
    const [lead, ...fol] = m.agents;
    let far = 0;
    const tl = m.track.get(lead);
    for (const f of fol) m.track.get(f).forEach((p, k) => k > 60 && (far = Math.max(far, Math.hypot(p[0] - tl[k][0], p[1] - tl[k][1]))));
    check('party through a turn: stays together', far <= 1.5, `furthest ${f2(far)} m from the leader`);
    check('party through a turn: no overlap', m.overlapSecs === 0, `closest ${f2(m.gap)} m`);
    check('party through a turn: the leader arrives', Math.hypot(lead.pos.x - 7, lead.pos.y - 8.5) < 0.3, `at ${f2(lead.pos.x)},${f2(lead.pos.y)}`);
    return m;
  },
  busy() {
    // A 9 x 8 m room with four fixtures and twelve people wandering: the real test.
    const grid = floor(9, 8, [[2, 2, 3.2, 2.6], [5.8, 2, 7, 2.6], [2, 5.4, 3.2, 6], [5.8, 5.4, 7, 6], [4.2, 3.6, 4.8, 4.4]]);
    let seed = +(process.env.SEED ?? 7);
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const wander = () => {
      let mode = 0;
      return () => {
        mode ^= 1;
        if (!mode) return { wait: 0.8 + rand() * 2.2 };
        for (let k = 0; k < 30; k++) {
          const x = 0.5 + rand() * 8;
          const z = 0.5 + rand() * 7;
          if (grid.free(x, z)) return go(x, z);
        }
        return { wait: 1 };
      };
    };
    const people = [];
    const N = +(process.env.N ?? 12);
    for (let k = 0; k < N; k++) people.push({ at: [0.8 + (k % 4) * 2.3, 0.8 + Math.floor(k / 4) * (N > 12 ? 1.6 : 3.2)], speed: 0.58 + rand() * 0.2, script: wander() });
    const m = run({ grid, secs: 120, people });
    check('12 people, 120 s: nobody overlaps', m.overlapSecs === 0, `closest ${f2(m.gap)} m (${m.gapAt}), overlapped ${f2(m.overlapSecs)} s`);
    // Twelve people wandering at random through one room (a harder crowd than
    // any store's) do meet in fours round a pillar now and then: a pause of a
    // few seconds while they sort it out is what people do; longer is a jam.
    check('12 people, 120 s: nobody held up over 5 s', m.stuckLong <= 5, `longest ${f2(m.stuckLong)} s${m.stuckAt ? ` · ${m.stuckAt}` : ''}`);
    check('12 people, 120 s: last resorts at most 3 a minute', (m.stats.sidestep ?? 0) + (m.stats.wedged ?? 0) <= 6, JSON.stringify(m.stats));
    check('12 people, 120 s: "excuse me" at most 3 a minute', (m.stats.makeWay ?? 0) <= 6, `${m.stats.makeWay} people asked to make way`);
    check('12 people: one crowd update', m.update <= 0.5, `${f2(m.update)} ms median`);
    return m;
  },
};

for (const [name, fn] of Object.entries(cases)) {
  if (only.length && !only.includes(name)) continue;
  const m = fn();
  if (verbose) console.log(`     ${name}: update ${f2(m.update)} ms, stats ${JSON.stringify(m.stats)}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
