/**
 * 02 ConstructSafe: a building site at night, watched by four cameras.
 *
 * A small simulation of the site Blender built (scripts/blender/scenes/
 * constructsafe.py), run through the product's own pipeline
 * (repos/FINAL_EIT_PPE/construct_safe, backend/detection_system): each camera
 * takes a frame every 2 s and, in its mode, finds people and checks their
 * PPE, names faces, scores one pose for a fall, or looks for fire and smoke.
 * Alerts carry a screenshot and a 10 s cooldown per camera and type. Every
 * rule and number here is the code's (see the constants), including where it
 * falls short: a mask it can't see counts as missing, a fall and a fire are
 * raised on one frame, and one pose per frame is all a fall check sees.
 *
 * Site time runs three times real time; every product timing below is in
 * site seconds.
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, Box3, Color, Mesh, PlaneGeometry, Points, PointsMaterial, Vector3 } from 'three';

import { CylinderGeometry, MeshBasicMaterial } from 'three';
import { drawDetections, projectBox } from '../overlays/detect2d.js';
import { GLOW } from '../overlays/lines.js';
import { Rings } from '../overlays/rings.js';
import { Director } from '../sim/director.js';
import { inPoly } from '../sim/grid.js';
import { Districts } from '../sim/spread.js';
import { base } from './base.js';
import { Evidence, INK, countInView, drawCctv, drawFrustums, occlusion, siteCameras } from './kit/cctv.js';
import { jobBoard } from './kit/staff.js';
import { act, clockFeed, floorPointOn, go, near, placeNamer, rng, spotsOf } from './kit/util.js';

// ---------------------------------------------------------------- the product's numbers
// backend/detection_system/app.py and config.py unless noted.
const FRAME = 2; // FRAME_CAPTURE_INTERVAL: one frame a camera, every 2 s
const STAGGER = [0, 2, 4, 6]; // cameras start 0, 2, 4 and 6 s apart
const COOLDOWN = 10; // an alert type, per camera (not per person)
const PPE_CONF = 0.5; // the PPE model, on each person's crop (15% padding)
const PERSON_CONF = 0.3; // the person detector (COCO YOLOv8n), CPU pass
const SMOOTH = 2; // a PPE item counts once seen in 2 of the last 3 frames
const FACE_EVERY = 5; // faces recognised every 5th frame (CPU), cached between
const MATCH = 0.35; // a match: 1 - similarity < 0.65
const FALL_AT = 4; // fall_score_threshold: 4 of 6 points
const FIRE_CONF = 0.6; // fire or smoke, full frame, one frame raises it
const IDLE_SECS = 120; // idle: moving no more than 5% of the box's diagonal for 120 s
const IDLE_MOVE = 0.05;
const IDLE_CLEAR = 0.08; // ... and moving 8% clears it
const SHIFT = [8 * 3600, 19 * 3600]; // the default shift, 08:00 to 19:00
const SEGMENT = 2; // the playback server: 2 s HLS segments, H.264 passed through
const REWIND_H = 12; // max_rewind_seconds 43200
const S3_DAYS = 7; // the screenshot's presigned link
const MEMORY = { ppe: 250, fall: 180, fire: 200, face: 150 }; // estimated_memory_mb
// ppe-detection/benchmark_results.txt: YOLOv8s, 50 random 640x640 frames, CPU.
const BENCH = { torch: 97.21, onnx: 74.02 };
const RATE = 3; // site seconds a real second

const CAMS = {
  cam01: { name: 'CAM-01', area: 'Outdoor · the gate', mode: 'face', color: '#22d3ee' },
  cam02: { name: 'CAM-02', area: 'Outdoor · groundworks', mode: 'ppe', color: '#4ade80' },
  cam03: { name: 'CAM-03', area: 'Indoor · ground floor', mode: 'fall', color: '#fbbf24' },
  cam04: { name: 'CAM-04', area: 'High-Risk Zone · welding bay', mode: 'fire', color: '#fb6f8a' },
};
const MODE_NAME = { face: 'Face', ppe: 'PPE', fall: 'Fall', fire: 'Fire' };
const MODEL_OF = { face: 'face', ppe: 'ppe', fall: 'fall', fire: 'fire' };
const TOOLS = ['hammer', 'broom', 'torch', 'box', 'clipboard'];
const REGIONS = ['eyes', 'white', 'skin', 'top', 'bottom', 'shoes', 'sole', 'hair', 'mouth', 'accent', 'trim', 'vest', 'strip', 'badge', 'lens', 'belt'];

export async function create(ctx) {
  const { stage, labels, context, slot } = ctx;
  const data = stage.data;
  const b = base(ctx);
  const rand = rng(ctx.seed ?? 2718);
  const scene = stage.scene;
  const card = context !== 'case';
  const spot = spotsOf(data);

  // ---------------------------------------------------------------- the site's state
  const site = {
    clock: 9 * 3600 + 40 * 60, // 09:40
    feed: [],
    alerts: [],
    suppressed: 0,
    frames: 0,
    models: { ppe: true, fall: true, fire: true, face: true },
    attendance: [], // { name, in, out }
    entries: 0,
    exits: 0,
    enrolled: 0,
    tests: 0,
  };
  const { time, event } = clockFeed(site);
  const stamp = () => {
    const t = site.clock;
    const p = (n) => String(Math.floor(n)).padStart(2, '0');
    return `20260927_${p(t / 3600)}${p((t / 60) % 60)}${p(t % 60)}`;
  };

  // ---------------------------------------------------------------- cameras
  const cams = siteCameras(data, { wall: Object.keys(CAMS), far: 30 });
  const occluded = occlusion(data);
  const camState = Object.fromEntries(Object.keys(cams).map((r, i) => [r, { mode: CAMS[r]?.mode ?? 'ppe', t: -(STAGGER[i] ?? 0), frame: 0, items: [], seen: new Map(), fall: null, fire: null }]));
  let selectedCam = 'cam02';
  const zones = Object.fromEntries(Object.entries(data.zones ?? {}).map(([k, pts]) => [k, pts.map((q) => [q[0], q[2]])]));
  const gateLine = (() => {
    const l = data.lines?.gate ?? [[5.7, 0, 0.87], [5.7, 0, -0.87]];
    return { a: [l[0][0], l[0][2]], b: [l[1][0], l[1][2]] };
  })();

  // ---------------------------------------------------------------- people
  const cast = data.cast ?? [];
  const people = []; // agents: workers, the supervisor, the guard
  const posed = []; // figures on the scaffold's lifts
  const pickGeo = new CylinderGeometry(0.22, 0.22, 1.5, 10);
  const pickMat = new MeshBasicMaterial({ visible: false });
  const piece = (fig, name) => fig.root.getObjectByName(name);
  const hold = (a, tool) => {
    for (const t of TOOLS) {
      const o = piece(a.fig, t);
      if (o) o.visible = t === tool;
    }
    a.walkClip = tool === 'box' ? 'carry' : 'walk';
  };
  // PPE, as worn: the hard hat and mask are pieces on the head, the vest is
  // the body's hi-vis regions (off: the shirt's colour shows through).
  function setPPE(p, item, on) {
    p.ppe[item] = on;
    if (item === 'hat' || item === 'mask') {
      const o = piece(p.fig, item);
      if (o) o.visible = on;
    } else if (item === 'vest') {
      const pal = p.fig.material?.userData.palette;
      if (!pal) return;
      p.vestColors ??= [pal[REGIONS.indexOf('vest')].clone(), pal[REGIONS.indexOf('strip')].clone()];
      pal[REGIONS.indexOf('vest')].copy(on ? p.vestColors[0] : pal[REGIONS.indexOf('top')]);
      pal[REGIONS.indexOf('strip')].copy(on ? p.vestColors[1] : pal[REGIONS.indexOf('top')]);
    }
  }
  const newStarterName = 'Rahul';
  for (const entry of cast) {
    const role = entry.role ?? 'worker';
    if (role === 'scaffolder') {
      const f = b.figure({ ...entry, carry: [...new Set([...(entry.carry ?? []), 'hammer'])] });
      f.root.position.y = entry.lift ?? 0;
      const s = { fig: f, role, name: entry.name, enrolled: true, ppe: { hat: true, mask: true, vest: true }, base: entry.lift ?? 0, visible: true, id: 100 + posed.length };
      posed.push(s);
      continue;
    }
    const worker = role === 'worker';
    const carry = worker ? [...new Set([...(entry.carry ?? []), ...TOOLS.filter((t) => t !== 'clipboard')])] : entry.carry ?? [];
    const pace = 0.62 + rand() * 0.14;
    const a = b.agent({ ...entry, carry }, { think: (ag) => brain(ag), fixed: role === 'guard', speed: pace });
    a.role = role;
    a.name = entry.name === 'new starter' ? newStarterName : entry.name;
    a.enrolled = entry.name !== 'new starter';
    a.ppe = { hat: (entry.wear ?? []).includes('hat'), mask: (entry.wear ?? []).includes('mask'), vest: /vest/.test(entry.body) };
    a.st = { tasks: [], phase: entry.name === 'new starter' ? 'arriving' : 'work' };
    a.base = 0;
    a.onSite = true;
    if (worker) hold(a, (entry.carry ?? []).find((t) => TOOLS.includes(t)) ?? null);
    // Carry on with what the page opened on for a few seconds (each their own few).
    if (entry.clip && !['walk', 'carry'].includes(entry.clip) && role !== 'guard') a.st.tasks.push({ act: entry.clip, secs: 4 + rand() * 10, face: a.heading, opening: true });
    const proxy = new Mesh(pickGeo, pickMat);
    proxy.position.y = 0.75;
    proxy.userData.pick = 'click';
    proxy.userData.agent = a;
    a.fig.root.add(proxy);
    a.proxy = proxy;
    people.push(a);
  }
  site.enrolled = people.filter((p) => p.enrolled).length + posed.length;
  const workers = () => people.filter((p) => p.role === 'worker' && p.visible);
  const supervisor = people.find((p) => p.role === 'supervisor');
  const guard = people.find((p) => p.role === 'guard');
  const newStarter = people.find((p) => !p.enrolled);

  /** Everyone a camera could see: agents and the posed figures, as { who, x, z, yaw, base, s }. */
  function subjects() {
    const out = [];
    for (const a of people) if (a.visible && a.fade > 0.5) out.push({ who: a, x: a.pos.x, z: a.pos.y, yaw: a.heading, base: 0, s: a.fig.root.scale.x });
    for (const p of posed) out.push({ who: p, x: p.fig.root.position.x, z: p.fig.root.position.z, yaw: p.fig.root.rotation.y, base: p.base, s: p.fig.root.scale.x });
    return out;
  }
  const v3 = new Vector3();
  /** In the picture (in front, inside the frame, within 16 m) and not hidden behind the frame's walls. */
  function inPicture(cam, s) {
    const ok = [1.0, 1.5].some((y) => (v3.set(s.x, s.base + y * s.s, s.z).project(cam), v3.z < 1 && Math.abs(v3.x) < 1 && Math.abs(v3.y) < 1));
    if (!ok || cam.position.distanceTo(v3.set(s.x, s.base + 1, s.z)) > 16) return false;
    return !(s.base === 0 && s.who.pos && occluded(s.who, cam));
  }
  /** Facing the camera enough for the face (and a mask on it) to be seen: within 70 degrees. */
  function faceToward(cam, s) {
    const fx = Math.sin(s.yaw);
    const fz = Math.cos(s.yaw);
    const dx = cam.position.x - s.x;
    const dz = cam.position.z - s.z;
    const l = Math.hypot(dx, dz) || 1;
    return (fx * dx + fz * dz) / l > 0.34;
  }

  // ---------------------------------------------------------------- places and districts
  const S = (k, clip, extra = {}) => (spot(k) ? { ...spot(k), key: k, clip, ...extra } : null);
  const districts = new Districts([
    { name: 'groundworks', stations: () => ['rebar_0', 'rebar_1', 'form_a', 'form_b', 'barrow'].map((k) => S(k, 'hammer')), cap: 2, feature: true, key: true },
    { name: 'mixer', stations: () => [S('mixer', 'point')], cap: 1, feature: true },
    { name: 'scaffold', stations: () => [S('scaffold_foot', 'point')], cap: 1, feature: true },
    { name: 'ground_floor', stations: () => ['blockwork', 'blocks', 'mortar', 'trestle'].map((k) => S(k, 'fold')), cap: 2, feature: true, key: true },
    { name: 'yard', stations: () => ['yard_blocks', 'yard_bags', 'timber', 'skip'].map((k) => S(k, 'fold')), cap: 2, feature: true },
    { name: 'welding', stations: () => ['weld', 'beam', 'bottles', 'extinguisher'].map((k) => S(k, 'weld')), cap: 2, feature: true, key: true },
    { name: 'office', stations: () => [S('desk', 'type', { browse: false }), S('plans', 'point', { browse: false })], feature: true, browse: false },
    { name: 'gate', poly: zones.gate, cap: 0, browse: false, walkThrough: true },
  ], { counts: (p) => p.role === 'worker' });
  let districtT = 0;
  if (zones.gate) b.crowd.noWait = [zones.gate];
  b.crowd.interest = ['rebar_0', 'form_a', 'mixer', 'blockwork', 'weld', 'desk'].map(spot).filter(Boolean).map((q) => [q.x, q.z]);
  const nearestPlace = placeNamer(data, {
    rebar: 'the rebar mat', form: 'the footings', mixer: 'the mixer', barrow: 'the groundworks', scaffold: 'the scaffold', blockwork: 'the ground floor',
    blocks: 'the ground floor', mortar: 'the ground floor', trestle: 'the ground floor', yard: 'the yard', timber: 'the yard', skip: 'the skip',
    weld: 'the welding bay', beam: 'the welding bay', bottles: 'the welding bay', extinguisher: 'the fire point', fire: 'the welding bay',
    desk: 'the site office', plans: 'the site office', office: 'the site office', gate: 'the gate', guard: 'the gate', enrol: 'the gate hut', van: 'the yard',
  }, 'the site');
  // Those who open at a station hold it while they carry on there.
  for (const p of people) {
    const t = p.st.tasks.find((q) => q.opening);
    const k = t && [...districts.keyOf.values()].find(({ s: q }) => q.key && Math.hypot(q.x - p.pos.x, q.z - p.pos.y) < 0.35);
    if (k && b.crowd.free(k.s.key, p)) t.claim = k.s.key;
  }

  // ---------------------------------------------------------------- work
  // Each job happens at a place, with its tool: hammering at the rebar and the
  // footings, laying blocks on the ground floor, welding in the bay; and
  // carrying: a load picked up in the yard and set down where it's needed.
  const board = jobBoard({ people, districts, rand, staff: ['worker'], customer: 'visitor' });
  const at = (k, clip, tool, secs = 10 + rand() * 5) => (a) => {
    const s = spot(k);
    if (!s || !b.crowd.free(k, a)) return null;
    return {
      d: districts.of(s.x, s.z), at: s,
      run: () => {
        a.st.tasks.push({ call: () => hold(a, tool), at: s }, act(clip, secs, s.face, { claim: k, at: s }));
        return go(s, { claim: k });
      },
    };
  };
  const carry = (from, to) => (a) => {
    const s = spot(from);
    const e = spot(to);
    if (!s || !e || !b.crowd.free(from, a) || !b.crowd.free(to, a)) return null;
    return {
      d: districts.of(e.x, e.z), at: s,
      run: () => {
        a.st.tasks.push(
          act('fold', 2, s.face, { claim: from, at: s }),
          { call: () => hold(a, 'box') },
          go(e, { claim: to }),
          act('fold', 2.2, e.face, { claim: to, at: e }),
          { call: () => hold(a, null) },
        );
        hold(a, null);
        return go(s, { claim: from });
      },
    };
  };
  const JOBS = {
    rebar_0: at('rebar_0', 'hammer', 'hammer'),
    rebar_1: at('rebar_1', 'hammer', 'hammer'),
    form_a: at('form_a', 'hammer', 'hammer'),
    form_b: at('form_b', 'hammer', 'hammer'),
    mix: at('mixer', 'point', null, 7 + rand() * 4),
    barrow: at('barrow', 'sweep', 'broom'),
    scaffold: at('scaffold_foot', 'point', null, 6 + rand() * 3),
    blockwork: at('blockwork', 'fold', null),
    mortar: at('mortar', 'fold', null),
    sweep: at('trestle', 'sweep', 'broom'),
    weld: at('weld', 'weld', 'torch'),
    beam: at('beam', 'hammer', 'hammer'),
    bottles: at('bottles', 'point', null, 5 + rand() * 3),
    blocks_in: carry('yard_blocks', 'blocks'),
    bags_to_mixer: carry('yard_bags', 'mixer'),
    timber_to_forms: carry('timber', 'form_b'),
    rubble_out: carry('trestle', 'skip'),
  };
  // Each worker leans to a part of the site, but does many jobs.
  const HOMES = {
    Ravi: ['rebar_0', 'rebar_1', 'form_b', 'barrow'],
    Arun: ['form_a', 'timber_to_forms', 'rebar_1', 'mix'],
    Meena: ['blockwork', 'blocks_in', 'mortar'],
    Karthik: ['mortar', 'sweep', 'rubble_out', 'blockwork'],
    Vijay: ['weld', 'beam', 'bottles'],
    Divya: ['blocks_in', 'bags_to_mixer', 'rubble_out', 'scaffold'],
    Mani: ['mix', 'bags_to_mixer', 'barrow', 'scaffold'],
    [newStarterName]: ['blocks_in', 'timber_to_forms', 'sweep', 'beam'],
  };
  const ALL_JOBS = Object.keys(JOBS);

  function brain(a) {
    const st = a.st;
    // A job that happens somewhere only happens there: a walk that failed drops it.
    while (st.tasks.length) {
      const t = st.tasks.shift();
      if (t.at && !near(a, t.at, 0.45)) continue;
      return t;
    }
    if (a.role === 'guard') return guardBrain(a);
    if (a.role === 'supervisor') return supervisorBrain(a);
    return workerBrain(a);
  }

  function workerBrain(a) {
    const st = a.st;
    if (st.phase === 'arriving') {
      // New on site: to the hut's counter, to be enrolled (a photo and an ID).
      st.phase = 'waiting';
      const e = spot('enrol');
      return go(e, { claim: 'enrol' });
    }
    if (st.phase === 'waiting') {
      const e = spot('enrol');
      return act(rand() < 0.5 ? 'idle' : 'phone', 3, e?.face, { claim: 'enrol' });
    }
    if (st.phase === 'out') return { exit: 'road' };
    if (st.phase === 'idle') {
      // Stood still on the phone (the productivity chapter's): long enough to be marked idle.
      st.phase = 'work';
      hold(a, null);
      return act('phone', st.idleFor ?? 50, null, { claim: a.claim });
    }
    const home = HOMES[a.name] ?? [];
    const next = board.next(a, [...home, ...ALL_JOBS.filter((j) => !home.includes(j))], home, JOBS);
    return next ?? act('idle', 2, null, { claim: a.claim });
  }

  function guardBrain(a) {
    const s = spot('guard');
    return act(rand() < 0.3 ? 'type' : 'idle', 4 + rand() * 3, s?.face);
  }

  function supervisorBrain(a) {
    const st = a.st;
    // A PPE problem first: to the worker, a word, and the missing item handed over.
    const fix = st.fixing;
    if (fix) {
      st.fixing = null;
      const w = fix.who;
      const beside = besideOf(w, a);
      if (w.visible && beside) {
        st.tasks.push(
          { call: () => { if (w.task?.act) { w.task.face = [a.pos.x, a.pos.y]; w.task.secs = Math.max(w.task.secs, w.timer + 4); } }, at: beside },
          act('talk', 3, [w.pos.x, w.pos.y], { at: beside }),
          { call: () => { setPPE(w, fix.item, true); event(`${fix.item === 'hat' ? 'hard hat' : fix.item} handed to ${w.name}`); fix.done = true; } },
        );
        return go(beside);
      }
    }
    st.i = ((st.i ?? -1) + 1) % 4;
    const desk = spot('desk');
    if (st.i === 0) {
      if (!near(a, desk, 0.4)) return go(desk, { claim: 'desk' });
      hold(a, 'clipboard');
      return act('type', 8 + rand() * 6, desk.face, { claim: 'desk' });
    }
    if (st.i === 1) {
      const p = spot('plans');
      return go(p, { claim: 'plans', then: act('point', 6, p.face, { claim: 'plans' }) });
    }
    // A walk round: to a worker at work, a word with them.
    const w = workers().filter((q) => q.task?.act && q.onSite && !near(q, desk, 3)).sort(() => rand() - 0.5)[0];
    const beside = w && besideOf(w, a);
    if (!beside) return act('idle', 2);
    st.tasks.push(act('talk', 3 + rand() * 2, [w.pos.x, w.pos.y], { at: beside }));
    return go(beside);
  }

  /** Somewhere to stand by `c` for a word: a pace off, on open floor, clear of everyone else. */
  function besideOf(c, a) {
    let best = null;
    let bd = Infinity;
    for (let k = 0; k < 12; k++) {
      const t = (k / 12) * Math.PI * 2;
      const x = c.pos.x + Math.sin(t) * 0.85;
      const z = c.pos.y + Math.cos(t) * 0.85;
      if (!b.grid.free(x, z) || !b.grid.los(c.pos.x, c.pos.y, x, z) || districts.of(x, z)?.walkThrough) continue;
      if (people.some((p) => p !== a && p !== c && p.visible && Math.hypot(p.pos.x - x, p.pos.y - z) < 0.7)) continue;
      const d = Math.hypot(x - a.pos.x, z - a.pos.y);
      if (d < bd) {
        bd = d;
        best = { x, z };
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- the director
  const director = new Director({ crowd: b.crowd, rand });
  const working = (p) => p.role === 'worker' && p.visible && p.onSite && p.st.phase === 'work' && !director.busy(p);
  // A run out through the gate now and then (to the van, for a delivery), and
  // back a while later: the gate camera's entries and exits.
  director.flow('gate', {
    every: 25,
    when: () => people.filter((p) => p.role === 'worker' && !p.visible).length === 0,
    run: () => {
      const p = director.cast(people, (q) => working(q) && q !== newStarter && q.task?.act && !q.ppeFix, spot('gate_in'));
      if (!p) return null;
      return director.hire(director.redirect(p, (q) => {
        hold(q, null);
        q.st.phase = 'out';
        q.st.tasks.push(go(spot('gate_out'), { via: true }), go(spot('gate_road_out'), { via: true }));
      }), 'gate', 60);
    },
  });
  // The new starter is enrolled at the hut by the guard, if nobody does it first.
  let enrolWait = 0;
  director.breakUpPiles({
    districts,
    people: () => people,
    here: () => people.filter((q) => q.visible && q.role === 'worker'),
    movable: (p) => working(p) && p.task?.act && !p.ppeFix,
    moveOn: (p) => director.redirect(p, () => {}),
  });
  // PPE put right: the supervisor takes the missing item over.
  director.flow('ppe_fix', {
    every: 2,
    when: () => supervisor && !supervisor.st.fixing,
    run: () => {
      const w = people.find((p) => p.role === 'worker' && p.visible && p.ppeFix && !p.ppeFix.sent && site.clock > p.ppeFix.due);
      if (!w) return null;
      w.ppeFix.sent = true;
      supervisor.st.fixing = { who: w, item: w.ppeFix.item };
      return director.redirect(supervisor, () => {});
    },
  });

  // ---------------------------------------------------------------- living parts
  const drum = stage.byName.get('mixer_drum');
  const arm = stage.byName.get('barrier_arm');
  const armRest = arm?.quaternion.clone();
  let armLift = 0;
  const binSpot = spot('fire_bin') ?? { x: 4.75, z: -2.55 };
  // Fire and smoke: points rising from the bin (the fire chapter's).
  const fire = { phase: 'none', t: 0, smoke: 0, flame: 0 };
  function particles(n, color, size, blending) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
    const m = new PointsMaterial({ color, size, transparent: true, opacity: 0.8, depthWrite: false, blending, sizeAttenuation: true });
    const pts = new Points(g, m);
    pts.frustumCulled = false;
    pts.visible = false;
    scene.add(pts);
    return { pts, n, life: new Float32Array(n), vel: new Float32Array(n * 3) };
  }
  const flames = particles(70, new Color(2.2, 0.9, 0.25), 0.09, AdditiveBlending);
  const smoke = particles(46, new Color(0.35, 0.34, 0.36), 0.26, undefined);
  smoke.pts.material.opacity = 0.55;
  const sparks = particles(40, new Color(2.4, 1.6, 0.6), 0.035, AdditiveBlending);
  function stepParticles(P, dt, spawn, on) {
    const pos = P.pts.geometry.attributes.position.array;
    let any = false;
    for (let i = 0; i < P.n; i++) {
      if (P.life[i] <= 0) {
        if (!on || rand() > 0.35) {
          pos[i * 3 + 1] = -10;
          continue;
        }
        spawn(i, pos, P.vel);
        P.life[i] = 0.6 + rand() * 0.8;
      }
      P.life[i] -= dt;
      pos[i * 3] += P.vel[i * 3] * dt;
      pos[i * 3 + 1] += P.vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += P.vel[i * 3 + 2] * dt;
      any = true;
    }
    P.pts.visible = any;
    P.pts.geometry.attributes.position.needsUpdate = true;
  }
  const welder = () => people.find((p) => p.visible && p.clip === 'weld');
  function moveParts(dt) {
    if (drum) drum.rotateY(dt * 1.8);
    if (arm && armRest) {
      const g = spot('gate_in');
      const someone = g && people.some((p) => p.visible && Math.hypot(p.pos.x - g.x, p.pos.y - g.z) < 1.4);
      armLift += ((someone ? 1 : 0) - armLift) * (1 - Math.exp(-dt * 3));
      arm.quaternion.copy(armRest);
      arm.rotateZ(armLift * 1.2);
    }
    // Fire: smoke first, then flame; out when put out.
    const burning = fire.phase === 'smoke' || fire.phase === 'fire';
    if (burning) {
      fire.t += dt * RATE;
      fire.smoke = Math.min(0.86, 0.3 + fire.t * 0.06);
      if (fire.phase === 'smoke' && fire.t > 6) fire.phase = 'fire';
      fire.flame = fire.phase === 'fire' ? Math.min(0.9, 0.4 + (fire.t - 6) * 0.08) : 0;
    } else {
      fire.smoke = Math.max(0, fire.smoke - dt);
      fire.flame = 0;
    }
    stepParticles(flames, dt, (i, pos, vel) => {
      pos.set([binSpot.x + (rand() - 0.5) * 0.3, 0.62, binSpot.z + (rand() - 0.5) * 0.3], i * 3);
      vel.set([(rand() - 0.5) * 0.2, 0.6 + rand() * 0.6, (rand() - 0.5) * 0.2], i * 3);
    }, fire.phase === 'fire');
    stepParticles(smoke, dt * 0.6, (i, pos, vel) => {
      pos.set([binSpot.x + (rand() - 0.5) * 0.25, 0.8, binSpot.z + (rand() - 0.5) * 0.25], i * 3);
      vel.set([(rand() - 0.5) * 0.15, 0.45 + rand() * 0.3, (rand() - 0.5) * 0.15 - 0.05], i * 3);
    }, burning || fire.smoke > 0.35);
    const w = welder();
    stepParticles(sparks, dt, (i, pos, vel) => {
      const hand = piece(w.fig, 'torch')?.getWorldPosition(new Vector3()) ?? new Vector3(w.pos.x, 0.9, w.pos.y);
      pos.set([hand.x, hand.y, hand.z], i * 3);
      vel.set([(rand() - 0.5) * 1.6, rand() * 1.2 - 0.2, (rand() - 0.5) * 1.6], i * 3);
    }, !!w);
    // Sparks fall.
    const sv = sparks.vel;
    for (let i = 0; i < sparks.n; i++) sv[i * 3 + 1] -= dt * 4;
  }

  // ---------------------------------------------------------------- the pipeline, a frame at a time
  const INKS = { safe: '#4ade80', unsafe: '#fb6f8a', person: '#fbbf24', face: '#22d3ee', smoke: '#b4b4bd', fire: '#fb923c' };
  const SHORT = { Hardhat: 'Hardhat', Mask: 'Mask', 'Safety Vest': 'Vest' };
  const cooling = new Map(); // `${type}_${cam}` -> site time it's clear
  const personBox = (s, extra) => ({ x: s.x, z: s.z, yaw: s.yaw, height: 1.62 * s.s, base: s.base, alpha: 1, ...extra });

  function processFrame(r) {
    const cs = camState[r];
    const cam = cams[r].cam;
    cs.frame++;
    site.frames++;
    const model = MODEL_OF[cs.mode];
    if (!site.models[model]) {
      cs.items = [];
      cs.fall = null;
      cs.fire = null;
      return;
    }
    const seen = subjects().filter((s) => inPicture(cam, s));
    if (cs.mode === 'ppe') ppeFrame(r, cs, cam, seen);
    else if (cs.mode === 'face') faceFrame(r, cs, cam, seen);
    else if (cs.mode === 'fall') fallFrame(r, cs, cam, seen);
    else if (cs.mode === 'fire') fireFrame(r, cs, cam);
  }

  function nameOf(cs, s, face) {
    const st = cs.seen.get(s.who) ?? {};
    // Recognised every 5th frame, cached between; no face seen: Unknown.
    if (cs.frame % FACE_EVERY === 0 || st.name == null) st.name = face && s.who.enrolled && site.models.face ? s.who.name : 'Unknown';
    cs.seen.set(s.who, st);
    return st.name;
  }

  /** PPE mode: a person box, the PPE model on its crop, safe only if every required item is seen. */
  function ppeFrame(r, cs, cam, seen) {
    const items = [];
    let unsafe = 0;
    const now = new Set();
    for (const s of seen) {
      const p = s.who;
      now.add(p);
      const st = cs.seen.get(p) ?? { n: {} };
      cs.seen.set(p, st);
      st.n ??= {};
      const face = faceToward(cam, s);
      // What the model can find on the crop: a hat or bare head and a vest or
      // not from any side; a mask, or a bare face, only from the front.
      const found = {
        Hardhat: p.ppe.hat, 'NO-Hardhat': !p.ppe.hat,
        Mask: p.ppe.mask && face, 'NO-Mask': !p.ppe.mask && face,
        'Safety Vest': p.ppe.vest, 'NO-Safety Vest': !p.ppe.vest,
      };
      for (const [k, on] of Object.entries(found)) st.n[k] = on ? Math.min(3, (st.n[k] ?? 0) + 1) : 0;
      const has = (k) => st.n[k] >= SMOOTH;
      const missing = ['Hardhat', 'Mask', 'Safety Vest'].filter((k) => !has(k));
      const bad = missing.length > 0 || ['NO-Hardhat', 'NO-Mask', 'NO-Safety Vest'].some(has);
      st.unsafe = bad;
      st.missing = missing;
      st.face = face;
      st.name = nameOf(cs, s, face);
      if (bad) unsafe++;
      const col = bad ? INKS.unsafe : INKS.safe;
      items.push(personBox(s, { color: col, tag: `${st.name}: ${bad ? `Missing ${missing.map((m) => SHORT[m]).join(', ')}` : 'PPE Compliant'}`, who: p }));
      // The items themselves, as small boxes inside the person's.
      const sc = s.s;
      if (has('Hardhat') || has('NO-Hardhat')) items.push({ x: s.x, z: s.z, yaw: s.yaw, base: s.base + 1.52 * sc, height: 0.22 * sc, halfW: 0.15, halfD: 0.15, color: has('Hardhat') ? INKS.safe : INKS.unsafe, thin: true });
      if (has('Mask') || has('NO-Mask')) items.push({ x: s.x, z: s.z, yaw: s.yaw, base: s.base + 1.36 * sc, height: 0.12 * sc, halfW: 0.08, halfD: 0.1, color: has('Mask') ? INKS.safe : INKS.unsafe, thin: true });
      if (has('Safety Vest') || has('NO-Safety Vest')) items.push({ x: s.x, z: s.z, yaw: s.yaw, base: s.base + 0.9 * sc, height: 0.48 * sc, halfW: 0.2, halfD: 0.14, color: has('Safety Vest') ? INKS.safe : INKS.unsafe, thin: true });
    }
    for (const p of cs.seen.keys()) if (!now.has(p)) cs.seen.delete(p);
    cs.items = items;
    cs.unsafe = unsafe;
    cs.checked = seen.length;
    if (unsafe) raise('ppe', r, `PPE VIOLATION (${unsafe} person(s))`, 'medium', items.filter((i) => i.color === INKS.unsafe && !i.thin).map((i) => i.who));
  }

  /** Face mode: a face box and a name for everyone facing the camera. */
  function faceFrame(r, cs, cam, seen) {
    const items = [];
    for (const s of seen) {
      const face = faceToward(cam, s);
      if (!face) continue;
      const name = nameOf(cs, s, face);
      const sim = name === 'Unknown' ? 0.12 + ((s.who.id * 37) % 20) / 100 : 0.52 + ((s.who.id * 13) % 22) / 100;
      items.push({ x: s.x, z: s.z, yaw: s.yaw, base: s.base + 1.36 * s.s, height: 0.34 * s.s, halfW: 0.13, halfD: 0.12, color: name === 'Unknown' ? INKS.person : INKS.face, tag: `${name} · ${sim.toFixed(2)}`, who: s.who });
    }
    cs.items = items;
  }

  /**
   * Fall mode: MoveNet sees one pose a frame (the most prominent person),
   * and four rules score it out of 6 (app.py FallDetector): the torso more
   * than 60 degrees from vertical (+2), shoulders level with hips (+2), a
   * short body in the frame (+1), and lying low in it (+1). 4 or more: a fall.
   */
  const bonesOf = (fig) => {
    const sk = fig.mesh.skeleton;
    const g = (n) => sk.getBoneByName(n);
    return { head: g('head'), sl: g('upperarmL'), sr: g('upperarmR'), hl: g('thighL'), hr: g('thighR'), el: g('forearmL'), er: g('forearmR'), wl: g('handL'), wr: g('handR'), kl: g('shinL'), kr: g('shinR'), al: g('footL'), ar: g('footR') };
  };
  const SKELETON = [['sl', 'sr'], ['sl', 'el'], ['el', 'wl'], ['sr', 'er'], ['er', 'wr'], ['sl', 'hl'], ['sr', 'hr'], ['hl', 'hr'], ['hl', 'kl'], ['kl', 'al'], ['hr', 'kr'], ['kr', 'ar'], ['head', 'sl'], ['head', 'sr']];
  function fallFrame(r, cs, cam, seen) {
    // The most prominent: the biggest in the picture.
    let best = null;
    let area = 0;
    for (const s of seen) {
      const bx = projectBox(cam, s.x, s.z, s.yaw, 1.62 * s.s, 0.24, 0.17, s.base);
      const a = (bx.x1 - bx.x0) * (bx.y1 - bx.y0);
      if (a > area) {
        area = a;
        best = s;
      }
    }
    if (!best) {
      cs.fall = null;
      cs.items = [];
      return;
    }
    const bones = bonesOf(best.who.fig);
    const world = {};
    const img = {};
    for (const [k, bn] of Object.entries(bones)) {
      if (!bn) continue;
      const w = bn.getWorldPosition(new Vector3());
      world[k] = w;
      const p = w.clone().project(cam);
      img[k] = { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
    }
    if (!img.sl || !img.hl) return;
    const mid = (a, c) => ({ x: (img[a].x + img[c].x) / 2, y: (img[a].y + img[c].y) / 2 });
    const sh = mid('sl', 'sr');
    const hp = mid('hl', 'hr');
    const dx = sh.x - hp.x;
    const dy = sh.y - hp.y;
    const angle = (Math.atan2(Math.abs(dx), Math.abs(dy)) * 180) / Math.PI;
    const align = 1 - Math.min(2 * Math.abs(sh.y - hp.y), 1);
    const height = Math.hypot(dx, dy);
    const low = img.head.y > 0.88 || hp.y > 0.5;
    const rules = [
      { name: 'Torso from vertical', value: `${angle.toFixed(0)}°`, rule: '> 60°', points: angle > 60 ? 2 : 0 },
      { name: 'Shoulders level with hips', value: align.toFixed(2), rule: '> 0.7', points: align > 0.7 ? 2 : 0 },
      { name: 'Body height in frame', value: height.toFixed(2), rule: '< 0.25', points: height < 0.25 ? 1 : 0 },
      { name: 'Low in the frame', value: `hips at ${(hp.y * 100).toFixed(0)}%`, rule: 'head in bottom 12% or hips below 50%', points: low ? 1 : 0 },
    ];
    const score = rules.reduce((n, q) => n + q.points, 0);
    const fallen = score >= FALL_AT;
    cs.fall = { who: best.who, rules, score, fallen, world, img };
    // The box: the keypoints' extent, 20 px out, and its label.
    cs.items = [];
    if (fallen) raise('fall', r, 'FALL DETECTED (1 person(s))', 'high', [best.who]);
  }

  /** Fire mode: fire and smoke on the full frame; either at 0.6 or more raises it, on one frame. */
  function fireFrame(r, cs, cam) {
    const bin = new Vector3(binSpot.x, 0.8, binSpot.z).project(cam);
    const visible = bin.z < 1 && Math.abs(bin.x) < 1 && Math.abs(bin.y) < 1;
    const items = [];
    const smokeC = visible && fire.smoke > 0.25 ? fire.smoke : 0;
    const flameC = visible && fire.flame > 0 ? fire.flame : 0;
    if (smokeC) items.push({ x: binSpot.x, z: binSpot.z, yaw: 0, base: 0.7, height: 1.1 + smokeC * 0.8, halfW: 0.45, halfD: 0.45, color: INKS.smoke, tag: `smoke ${smokeC.toFixed(2)}` });
    if (flameC) items.push({ x: binSpot.x, z: binSpot.z, yaw: 0, base: 0.55, height: 0.55 + flameC * 0.3, halfW: 0.28, halfD: 0.28, color: INKS.fire, tag: `fire ${flameC.toFixed(2)}` });
    cs.items = items;
    cs.fire = { smoke: smokeC, flame: flameC, detected: Math.max(smokeC, flameC) >= FIRE_CONF };
    if (cs.fire.detected) raise('fire', r, 'FIRE/SMOKE DETECTED!', 'critical', []);
  }

  // ---------------------------------------------------------------- alerts
  // One alert a camera and type every 10 s, a screenshot with the boxes
  // drawn, uploaded to S3 (a link good for 7 days). The dashboard turns
  // them into per-person cards in the browser: helmet, vest, fall, fire (a
  // missing mask makes no card there).
  function snap(r) {
    if (!slot.engine || card) return null;
    const ev = new Evidence({ before: 0, after: 0, width: 320, height: 180, draw: (g, w, h, cam) => {
      drawDetections(g, w, h, cam, camState[r].items, { px: w / 520 });
      if (camState[r].fall) drawSkeleton(g, w, h, cam, camState[r].fall);
    } });
    ev.cam = cams[r].cam;
    return ev.shoot(slot, scene);
  }
  function raise(type, r, title, severity, who = []) {
    const key = `${type}_${r}`;
    if (site.clock < (cooling.get(key) ?? -Infinity)) {
      site.suppressed++;
      return false;
    }
    cooling.set(key, site.clock + COOLDOWN);
    const cards = [];
    for (const p of who) {
      const st = camState[r].seen.get(p);
      if (type === 'ppe' && st?.missing?.includes('Hardhat')) cards.push(`Helmet missing · ${st.name}`);
      if (type === 'ppe' && st?.missing?.includes('Safety Vest')) cards.push(`Safety vest not detected · ${st.name}`);
      if (type === 'fall') cards.push(`Man Fall Detected · ${p.name ?? 'Unknown'}`);
    }
    if (type === 'fire') cards.push('Fire Alarm');
    const a = { type, cam: r, title, severity, at: time(), file: `alert_${type}_${CAMS[r]?.name ?? r}_${stamp()}.jpg`, shot: snap(r), cards };
    site.alerts.unshift(a);
    if (site.alerts.length > 20) site.alerts.pop();
    event(`${title} · ${CAMS[r]?.name ?? r} · screenshot to S3`);
    return true;
  }

  // ---------------------------------------------------------------- attendance and idle
  // The gate camera logs a recognised worker in and out (inside their shift);
  // idle is a box that hasn't moved 5% of its size in 120 s.
  const cross2 = (ax, az, bx, bz) => ax * bz - az * bx;
  const outside = spot('gate_road_in') ?? { x: 6.2, z: -0.35 };
  const sideOf = (x, z) => {
    const [ax, az] = gateLine.a;
    const [bx, bz] = gateLine.b;
    const ex = bx - ax;
    const ez = bz - az;
    const out = Math.sign(cross2(ex, ez, outside.x - ax, outside.z - az)) || 1;
    return (cross2(ex, ez, x - ax, z - az) / (Math.hypot(ex, ez) || 1)) * out;
  };
  b.crowd.onMove((a) => {
    if (!a.visible || a.role === 'guard') return;
    const d = sideOf(a.pos.x, a.pos.y);
    const now = d > 0.12 ? 'out' : d < -0.12 ? 'in' : null;
    if (!now) return;
    const was = a.side;
    a.side = now;
    if (!was || was === now) return;
    const inShift = site.clock >= SHIFT[0] && site.clock <= SHIFT[1];
    if (now === 'in') {
      site.entries++;
      a.onSite = true;
      if (a.enrolled && inShift) {
        const row = site.attendance.find((q) => q.name === a.name && !q.out) ?? { name: a.name, in: time(), out: null };
        if (!site.attendance.includes(row)) site.attendance.push(row);
        event(`entry · ${a.name} · attendance`);
      } else event('entry · Unknown · not logged');
    } else {
      site.exits++;
      a.onSite = false;
      const row = site.attendance.find((q) => q.name === a.name && !q.out);
      if (row) row.out = time();
      event(`exit · ${a.enrolled ? a.name : 'Unknown'}`);
    }
  });
  function idleTick(dtSite) {
    for (const a of people) {
      if (a.role !== 'worker' || !a.visible || !a.enrolled) continue;
      const anchor = (a.idleAt ??= { x: a.pos.x, z: a.pos.y });
      const moved = Math.hypot(a.pos.x - anchor.x, a.pos.y - anchor.z);
      // Of a box about 1.8 m on the diagonal.
      if (moved > IDLE_CLEAR * 1.8) {
        a.idleAt = { x: a.pos.x, z: a.pos.y };
        a.stillFor = 0;
        a.idle = false;
      } else if (moved <= IDLE_MOVE * 1.8) {
        a.stillFor = (a.stillFor ?? 0) + dtSite;
        if (!a.idle && a.stillFor >= IDLE_SECS) {
          a.idle = true;
          event(`idle · ${a.name} · ${Math.round(a.stillFor)} s without moving`);
        }
      }
    }
  }
  const status = (a) => {
    const st = camState.cam02.seen.get(a);
    if (st?.unsafe) return 'PPE Violation';
    return a.idle ? 'Idle' : 'Active';
  };

  // ---------------------------------------------------------------- playback
  // The selected camera's picture, a segment every 2 s, kept for the last few
  // minutes (the server keeps 12 h), to scrub back through and play again.
  const rec = { cam: 'cam03', frames: [], t: 0, pos: 0, max: 90 };
  function recordTick(dt) {
    if (card || !slot.engine) return;
    rec.t += dt * RATE;
    if (rec.t < SEGMENT) return;
    rec.t = 0;
    const ev = new Evidence({ before: 0, after: 0, width: 256, height: 144, draw: (g, w, h, cam) => drawDetections(g, w, h, cam, camState[rec.cam].items, { px: w / 520 }) });
    ev.cam = cams[rec.cam].cam;
    const reuse = rec.frames.length >= rec.max ? rec.frames.shift().c : null;
    rec.frames.push({ c: ev.shoot(slot, scene, reuse), t: site.clock });
  }
  const recPip = (g, w, h) => {
    g.fillStyle = '#0b0b0e';
    g.fillRect(0, 0, w, h);
    const n = rec.frames.length;
    if (!n) return;
    const i = Math.max(0, n - 1 - Math.round(rec.pos / SEGMENT));
    const f = rec.frames[i];
    g.drawImage(f.c, 0, 0, w, h);
    const band = Math.round(w / 22);
    g.fillStyle = 'rgba(5,5,6,0.72)';
    g.fillRect(0, h - band, w, band);
    g.fillStyle = rec.pos ? '#fbbf24' : '#fb6f8a';
    g.fillRect(0, h - 3, (w * (i + 1)) / n, 3);
    g.fillStyle = '#e4e4e7';
    g.font = `500 ${Math.round(w / 48)}px "Geist Mono Variable", monospace`;
    g.fillText(`${CAMS[rec.cam].name} · ${rec.pos ? `−${Math.round(rec.pos)} s` : 'LIVE'} · 2 s segments`, 8, h - band * 0.3);
  };

  // ---------------------------------------------------------------- the dashboard on the office monitor
  const dash = siteDashboard();
  const screen = stage.byName.get('dashboard_screen');
  let dashPlane = null;
  if (screen) {
    screen.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(screen);
    const size = box.getSize(new Vector3());
    const c = box.getCenter(new Vector3());
    dashPlane = new Mesh(new PlaneGeometry(Math.max(size.x, size.z), size.y), dash.material);
    dashPlane.position.copy(c);
    if (size.x < size.z) {
      dashPlane.rotation.y = Math.PI / 2;
      dashPlane.position.x += size.x / 2 + 0.002;
    } else dashPlane.position.z += size.z / 2 + 0.002;
    scene.add(dashPlane);
    screen.visible = false;
  }
  function siteDashboard() {
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 448;
    const g = canvas.getContext('2d');
    const material = new MeshBasicMaterial({ color: new Color(1.3, 1.3, 1.3), toneMapped: false });
    let tex = null;
    let clock = Infinity;
    const FONT = '"Geist Variable", system-ui, sans-serif';
    const MONO = '"Geist Mono Variable", monospace';
    return {
      canvas,
      material,
      async init() {
        const { CanvasTexture, SRGBColorSpace } = await import('three');
        tex = new CanvasTexture(canvas);
        tex.colorSpace = SRGBColorSpace;
        material.map = tex;
        material.needsUpdate = true;
      },
      update(dt) {
        clock += dt;
        if (clock < 0.5) return;
        clock = 0;
        const W = canvas.width;
        const H = canvas.height;
        g.fillStyle = '#0c0d11';
        g.fillRect(0, 0, W, H);
        g.fillStyle = '#e4e4e7';
        g.font = `600 22px ${FONT}`;
        g.fillText('ConstructSafe · Site 1 · Tower 1', 24, 38);
        g.font = `400 14px ${MONO}`;
        g.fillStyle = '#8b8b94';
        g.fillText(`${time()} · 4 cameras · a frame each every 2 s`, 24, 60);
        const onSite = people.filter((p) => p.visible && p.role === 'worker').length + posed.length;
        const tiles = [
          ['Workers', onSite, '#e4e4e7'],
          ['PPE violations', site.alerts.filter((a) => a.type === 'ppe').length, '#fb6f8a'],
          ['Falls', site.alerts.filter((a) => a.type === 'fall').length, '#fbbf24'],
          ['Fire / smoke', site.alerts.filter((a) => a.type === 'fire').length, '#fb923c'],
        ];
        const tw = (W - 24 * 5) / 4;
        tiles.forEach(([k, v, c], i) => {
          const x = 24 + i * (tw + 24);
          g.fillStyle = '#15161c';
          g.fillRect(x, 78, tw, 78);
          g.fillStyle = '#8b8b94';
          g.font = `500 13px ${FONT}`;
          g.fillText(k, x + 14, 102);
          g.fillStyle = c;
          g.font = `600 30px ${FONT}`;
          g.fillText(String(v), x + 14, 140);
        });
        g.fillStyle = '#e4e4e7';
        g.font = `600 15px ${FONT}`;
        g.fillText('Alerts', 24, 190);
        site.alerts.slice(0, 5).forEach((a, i) => {
          g.fillStyle = a.severity === 'critical' ? '#fb923c' : a.severity === 'high' ? '#fbbf24' : '#fb6f8a';
          g.fillRect(24, 204 + i * 44, 4, 34);
          g.fillStyle = '#e4e4e7';
          g.font = `500 14px ${FONT}`;
          g.fillText(a.title, 36, 220 + i * 44);
          g.fillStyle = '#8b8b94';
          g.font = `400 12px ${MONO}`;
          g.fillText(`${CAMS[a.cam]?.name} · ${a.at} · ${a.cards[0] ?? 'screenshot saved'}`, 36, 236 + i * 44);
        });
        g.fillStyle = '#e4e4e7';
        g.font = `600 15px ${FONT}`;
        g.fillText('Workers', W / 2 + 20, 190);
        people.filter((p) => p.role === 'worker' && p.visible).slice(0, 7).forEach((p, i) => {
          const s = status(p);
          g.fillStyle = s === 'Active' ? '#4ade80' : s === 'Idle' ? '#fbbf24' : '#fb6f8a';
          g.beginPath();
          g.arc(W / 2 + 28, 212 + i * 30, 5, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = '#e4e4e7';
          g.font = `500 14px ${FONT}`;
          g.fillText(p.enrolled ? p.name : 'Unknown', W / 2 + 42, 217 + i * 30);
          g.fillStyle = '#8b8b94';
          g.font = `400 12px ${MONO}`;
          g.fillText(s, W / 2 + 190, 217 + i * 30);
        });
        if (tex) tex.needsUpdate = true;
      },
      dispose() {
        tex?.dispose();
        material.dispose();
      },
    };
  }
  await dash.init();

  // ---------------------------------------------------------------- overlays
  const rings = new Rings(scene);
  const show = { boxes: false, cams: false, skeleton: false, rings: true };
  function setShow(o) {
    Object.assign(show, { boxes: false, cams: false, skeleton: false, rings: true }, o);
    rings.visible = show.rings && !show.boxes;
  }
  /** The main view's boxes: the chapter's camera's detections, drawn from where we look. */
  const mainItems = () => {
    const c = slot.chapters?.current?.id;
    const r = { cameras: selectedCam, ppe: 'cam02', faces: 'cam01', falls: 'cam03', fire: 'cam04', productivity: 'cam02' }[c];
    return r ? camState[r].items : [];
  };
  function drawSkeleton(g, w, h, cam, fall) {
    if (!fall?.world) return;
    const P = (v) => {
      const p = v.clone().project(cam);
      return [((p.x + 1) / 2) * w, ((1 - p.y) / 2) * h, p.z < 1];
    };
    const col = fall.fallen ? '#fb6f8a' : '#4ade80';
    g.save();
    g.strokeStyle = col;
    g.fillStyle = col;
    g.lineWidth = Math.max(1.5, w / 320);
    const pts = {};
    for (const [k, v] of Object.entries(fall.world)) pts[k] = P(v);
    for (const [a, c] of SKELETON) {
      if (!pts[a]?.[2] || !pts[c]?.[2]) continue;
      g.beginPath();
      g.moveTo(pts[a][0], pts[a][1]);
      g.lineTo(pts[c][0], pts[c][1]);
      g.stroke();
    }
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of Object.values(pts)) {
      if (!p[2]) continue;
      g.beginPath();
      g.arc(p[0], p[1], Math.max(2, w / 260), 0, Math.PI * 2);
      g.fill();
      x0 = Math.min(x0, p[0]);
      y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]);
      y1 = Math.max(y1, p[1]);
    }
    // The keypoints' extent, 20 px out (in the camera's 640 px frame), and the verdict.
    const pad = (20 / 640) * w;
    g.setLineDash([]);
    g.strokeRect(x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad);
    g.font = `500 ${Math.max(10, Math.round(w / 48))}px "Geist Mono Variable", monospace`;
    const label = `${fall.fallen ? 'FALL DETECTED' : 'Normal'} (Score: ${fall.score}/6)`;
    const tw = g.measureText(label).width + 10;
    g.fillRect(x0 - pad, y0 - pad - Math.round(w / 32), tw, Math.round(w / 32));
    g.fillStyle = '#07070a';
    g.fillText(label, x0 - pad + 5, y0 - pad - Math.round(w / 110));
    g.restore();
  }
  function drawPeopleRings(dt) {
    rings.begin();
    if (show.rings && !show.boxes) {
      for (const a of people) {
        if (!a.visible) continue;
        const st = camState.cam02.seen.get(a);
        const col = st?.unsafe ? GLOW.red : a.role === 'worker' ? GLOW.turq : GLOW.grey;
        rings.add(a.pos.x, a.pos.y, col, a.fig.root.scale.x, a.fade);
      }
    }
    rings.end();
    void dt;
  }

  // ---------------------------------------------------------------- interactions
  /** The worker a PPE chapter button acts on: the most visible in CAM-02's picture, wearing the item. */
  function ppeTarget(item) {
    const cam = cams.cam02.cam;
    const list = subjects().filter((s) => s.who.role === 'worker' && inPicture(cam, s) && s.who.ppe[item] !== undefined);
    const wearing = list.filter((s) => s.who.ppe[item] && !s.who.ppeFix);
    const pick = (wearing.length ? wearing : list).sort((x, y) => cam.position.distanceTo(new Vector3(x.x, 1, x.z)) - cam.position.distanceTo(new Vector3(y.x, 1, y.z)))[0];
    return pick?.who ?? null;
  }
  function takeOff(item) {
    const w = ppeTarget(item);
    if (!w) return null;
    if (!w.ppe[item]) {
      setPPE(w, item, true);
      w.ppeFix = null;
      return w;
    }
    setPPE(w, item, false);
    // An agent is put right by the supervisor after the alert; a figure on the scaffold after a while.
    if (w.pos) w.ppeFix = { item, due: site.clock + 12, sent: false };
    else setTimeout(() => setPPE(w, item, true), 30000);
    event(`${w.name}: ${item === 'hat' ? 'hard hat' : item} off`);
    return w;
  }
  function turnAway() {
    const cam = cams.cam02.cam;
    const w = people.filter((p) => p.role === 'worker' && p.visible && inPicture(cam, { who: p, x: p.pos.x, z: p.pos.y, yaw: p.heading, base: 0, s: 1 }) && p.task?.act)[0];
    if (!w) return null;
    const away = [w.pos.x * 2 - cam.position.x, w.pos.y * 2 - cam.position.z];
    w.task.face = away;
    w.task.secs = Math.max(w.task.secs, w.timer + 14);
    return w;
  }
  function slip() {
    // On the ground floor, in CAM-03's picture: slips, lies a moment, gets up.
    const cam = cams.cam03.cam;
    const inside = (p) => p.visible && p.role === 'worker' && zones.ground_floor && inPoly(p.pos.x, p.pos.y, zones.ground_floor) && inPicture(cam, { who: p, x: p.pos.x, z: p.pos.y, yaw: p.heading, base: 0, s: 1 });
    let w = people.find((p) => inside(p) && p.task?.act);
    if (!w) {
      w = director.cast(people, (p) => working(p), spot('mortar'));
      if (!w) return null;
      director.hire(director.redirect(w, (q) => {
        const s = spot('mortar');
        q.st.tasks.push(go(s, { claim: 'mortar' }), { call: () => slipNow(q), at: s });
      }), 'slip', 40);
      return w;
    }
    slipNow(w);
    return w;
  }
  function slipNow(w) {
    director.hire(director.redirect(w, (q) => {
      hold(q, null);
      q.st.tasks.push(act('slip', 1.1, null, { claim: q.claim }), act('down', 7, null, { claim: q.claim }), act('getup', 1.6, null, { claim: q.claim }));
    }), 'slip', 20);
    event(`${w.name} slips on the ground floor`);
  }
  function ignite() {
    if (fire.phase === 'smoke' || fire.phase === 'fire') return;
    fire.phase = 'smoke';
    fire.t = 0;
    event('sparks catch the bin in the welding bay');
  }
  function extinguish() {
    if (fire.phase !== 'smoke' && fire.phase !== 'fire') return null;
    const w = director.cast(people, (p) => working(p), spot('extinguisher'));
    const done = () => {
      fire.phase = 'out';
      event('fire put out with the extinguisher');
    };
    if (!w) {
      done();
      return null;
    }
    director.hire(director.redirect(w, (q) => {
      hold(q, null);
      const e = spot('extinguisher');
      const bin = spot('fire_bin');
      const by = besideOf({ pos: { x: bin.x, y: bin.z } }, q) ?? e;
      q.st.tasks.push(act('fold', 1.2, e.face, { at: e }), go(by), act('point', 3, [bin.x, bin.z], { at: by }), { call: done });
      q.st.phase = 'work';
    }), 'fire', 30);
    void e;
    return w;
  }
  const e = null;
  function enrol() {
    if (!newStarter || newStarter.enrolled) return;
    newStarter.enrolled = true;
    newStarter.st.phase = 'work';
    site.enrolled++;
    for (const cs of Object.values(camState)) cs.seen.delete(newStarter);
    event(`enrolled · ${newStarterName} · photo uploaded, faces reloaded (${site.enrolled})`);
    director.redirect(newStarter, () => {});
  }
  function idleOne() {
    const w = director.cast(people, (p) => working(p) && p !== newStarter && p.task?.act, spot('yard_blocks'));
    if (!w) return null;
    director.hire(director.redirect(w, (q) => {
      q.st.phase = 'idle';
      q.st.idleFor = (IDLE_SECS + 30) / RATE;
    }), 'idle', (IDLE_SECS + 40) / RATE);
    return w;
  }

  // ---------------------------------------------------------------- chapters
  const camReadout = (r) => ({ label: 'Camera', value: `${CAMS[r].name} · ${CAMS[r].area}`, tone: 'violet' });
  const pipFor = (r, extra) => ({ camera: cams[r].cam, fps: 6, draw2d: (g, w, h) => {
    const cs = camState[r];
    drawCctv(g, w, h, { cam: cams[r].cam, items: cs.items, header: `${CAMS[r].name}  ${MODE_NAME[cs.mode].toUpperCase()}  ${time()}  · frame ${cs.frame}` });
    extra?.(g, w, h);
  } });
  const chapters = [
    {
      id: 'cameras',
      pip: true,
      enter: () => {
        setShow({ cams: true, boxes: true });
        queueMicrotask(() => slot.chapters?.emit('pipcaption', `${CAMS[selectedCam].name} · ${CAMS[selectedCam].area}`));
      },
      readouts: () => [
        { label: 'Cameras', value: 4 },
        camReadout(selectedCam),
        { label: 'Mode', value: MODE_NAME[camState[selectedCam].mode], tone: 'turq' },
        { label: 'Frames', value: 'one every 2 s, each camera' },
        { label: 'People in view', value: countInView(cams[selectedCam].cam, people) },
      ],
      actions: () => [
        ...Object.keys(CAMS).map((r) => ({ id: r, label: CAMS[r].name, pressed: r === selectedCam })),
        ...Object.keys(MODE_NAME).map((m) => ({ id: `mode_${m}`, label: MODE_NAME[m], pressed: camState[selectedCam].mode === m })),
      ],
      act(id) {
        if (CAMS[id]) {
          selectedCam = id;
          slot.chapters?.emit('pipcaption', `${CAMS[id].name} · ${CAMS[id].area}`);
        }
        if (id.startsWith('mode_')) {
          camState[selectedCam].mode = id.slice(5);
          camState[selectedCam].items = [];
          camState[selectedCam].seen.clear();
        }
      },
      qa(run) {
        this.act('cam02');
        run(2);
        const pip = ctx.slot.controller.pip();
        const f0 = camState.cam02.frame;
        run(4);
        const perFrame = (4 * RATE) / Math.max(1, camState.cam02.frame - f0);
        this.act('mode_fire');
        run(1.5);
        const switched = camState.cam02.mode === 'fire' && !camState.cam02.items.some((i) => /PPE|Missing/.test(i.tag ?? ''));
        this.act('mode_ppe');
        run(2);
        return [
          ['four cameras, each with its mode', Object.keys(cams).length === 4 && Object.values(camState).every((c) => c.mode), Object.entries(camState).map(([r, c]) => `${CAMS[r].name} ${c.mode}`).join(', ')],
          ['a camera can be chosen', pip?.camera === cams.cam02.cam],
          ['a frame each every 2 s', Math.abs(perFrame - FRAME) < 0.8, `${perFrame.toFixed(2)} s a frame`],
          ['its mode can be switched', switched],
          ['its picture sees people', camState.cam02.checked > 0, `${camState.cam02.checked} checked`],
        ];
      },
    },
    {
      id: 'ppe',
      pip: true,
      enter: () => {
        setShow({ boxes: true });
        queueMicrotask(() => slot.chapters?.emit('pipcaption', 'CAM-02 · PPE: hard hat, mask and vest on every person'));
      },
      readouts: () => {
        const cs = camState.cam02;
        const all = [...cs.seen.values()].filter((s) => s.missing);
        const bad = all.filter((s) => s.unsafe);
        const unseen = bad.filter((s) => !s.face && s.missing.includes('Mask') && s.missing.length === 1).length;
        return [
          { label: 'Checked now', value: all.length },
          { label: 'Safe', value: all.length - bad.length, tone: 'turq' },
          { label: 'Unsafe', value: bad.length ? `${bad.length}${unseen ? ` (${unseen}: mask not seen, facing away)` : ''}` : 'none', tone: bad.length ? 'red' : 'grey' },
          { label: 'Required', value: 'Hardhat · Mask · Safety Vest' },
          { label: 'The rule', value: 'any NO- class, or a required item not seen' },
        ];
      },
      actions: () => [
        { id: 'hat', label: 'Take a hard hat off' },
        { id: 'mask', label: 'Take a mask off' },
        { id: 'vest', label: 'Take a vest off' },
        { id: 'turn', label: 'Turn someone away' },
      ],
      act(id) {
        if (id === 'turn') turnAway();
        else takeOff(id);
      },
      qa(run) {
        const w = takeOff('hat');
        run(3);
        const st = w && camState.cam02.seen.get(w);
        const flagged = !!st?.unsafe && st.missing.includes('Hardhat') && camState.cam02.items.some((i) => i.who === w && /Missing Hardhat/.test(i.tag));
        const alerted = site.alerts.some((a) => a.type === 'ppe');
        run(20);
        const fixed = !!w && w.ppe.hat;
        run(3);
        const safe = !!w && !camState.cam02.seen.get(w)?.missing?.includes('Hardhat');
        const t = turnAway();
        run(4);
        const back = t && camState.cam02.seen.get(t);
        return [
          ['a missing hard hat is flagged, with the name', flagged, st ? `${st.name}: Missing ${st.missing.join(', ')}` : 'nobody in view'],
          ['and raises a PPE alert', alerted],
          ['the supervisor hands one over', fixed],
          ['and the box turns safe', safe],
          ['a mask the camera can’t see counts as missing', !t || (back?.missing?.includes('Mask') ?? true), back ? back.missing.join(', ') || 'none' : 'nobody to turn'],
        ];
      },
    },
    {
      id: 'faces',
      pip: true,
      enter: () => {
        setShow({ boxes: true });
        queueMicrotask(() => slot.chapters?.emit('pipcaption', 'CAM-01 · the gate: faces named from the enrolled'));
      },
      readouts: () => {
        const named = camState.cam01.items.map((i) => i.tag.split(' · ')[0]);
        return [
          { label: 'Enrolled', value: site.enrolled },
          { label: 'A match', value: 'similarity above 0.35' },
          { label: 'At the gate now', value: named.length ? named.join(', ') : 'nobody facing it' },
          { label: 'New starter', value: newStarter?.enrolled ? `${newStarterName}, enrolled` : 'Unknown until enrolled', tone: newStarter?.enrolled ? 'turq' : 'amber' },
        ];
      },
      actions: () => (newStarter && !newStarter.enrolled ? [{ id: 'enrol', label: 'Enrol the new starter' }] : []),
      act(id) {
        if (id === 'enrol') enrol();
      },
      qa(run) {
        const before = newStarter && !newStarter.enrolled;
        if (newStarter && !newStarter.visible) run(4);
        run(6);
        this.act('enrol');
        run(10);
        const namedNow = [...Object.values(camState)].some((cs) => cs.seen.get(newStarter)?.name === newStarterName);
        return [
          ['a worker not enrolled is Unknown', before],
          ['enrolling adds their face', site.enrolled > 0 && newStarter?.enrolled, `${site.enrolled} enrolled`],
          ['and they are named from then on', namedNow || !newStarter?.visible],
        ];
      },
    },
    {
      id: 'falls',
      pip: true,
      enter: () => {
        setShow({ boxes: true, skeleton: true });
        queueMicrotask(() => slot.chapters?.emit('pipcaption', 'CAM-03 · the ground floor: one pose a frame, scored out of 6'));
      },
      readouts: () => {
        const f = camState.cam03.fall;
        if (!f) return [{ label: 'Pose', value: 'nobody in the picture' }];
        return [
          ...f.rules.map((q) => ({ label: q.name, value: `${q.value} · +${q.points}`, tone: q.points ? 'amber' : 'grey' })),
          { label: 'Score', value: `${f.score}/6 · ${f.fallen ? 'FALL DETECTED' : 'Normal'}`, tone: f.fallen ? 'red' : 'turq' },
          { label: 'Seen', value: `${f.who.name ?? 'someone'}: one pose a frame` },
        ];
      },
      actions: () => [{ id: 'slip', label: 'Someone slips' }],
      act(id) {
        if (id === 'slip') slip();
      },
      qa(run) {
        const w = slip();
        let peak = 0;
        let fallAlert = false;
        for (let k = 0; k < 12; k++) {
          run(1);
          const f = camState.cam03.fall;
          if (f?.who === w) peak = Math.max(peak, f.score);
          fallAlert ||= site.alerts.some((a) => a.type === 'fall');
        }
        run(8);
        const after = camState.cam03.fall;
        return [
          ['a fall scores 4 or more of 6', peak >= FALL_AT, `peak ${peak}/6`],
          ['and raises a fall alert', fallAlert],
          ['standing again, it is normal', !after?.fallen, after ? `${after.score}/6` : 'nobody in view'],
        ];
      },
    },
    {
      id: 'fire',
      pip: true,
      enter: () => {
        setShow({ boxes: true });
        queueMicrotask(() => slot.chapters?.emit('pipcaption', 'CAM-04 · High-Risk Zone: fire and smoke on the whole frame'));
      },
      readouts: () => {
        const f = camState.cam04.fire;
        return [
          { label: 'Smoke', value: f?.smoke ? f.smoke.toFixed(2) : 'none', tone: f?.smoke >= FIRE_CONF ? 'red' : 'grey' },
          { label: 'Fire', value: f?.flame ? f.flame.toFixed(2) : 'none', tone: f?.flame >= FIRE_CONF ? 'red' : 'grey' },
          { label: 'Raised at', value: '0.6, on a single frame' },
          { label: 'Model', value: 'YOLOv8n on fire and smoke, mAP50 0.861' },
        ];
      },
      actions: () => (fire.phase === 'smoke' || fire.phase === 'fire' ? [{ id: 'out', label: 'Put it out' }] : [{ id: 'ignite', label: 'Sparks catch the bin' }]),
      act(id) {
        if (id === 'ignite') ignite();
        if (id === 'out') extinguish();
      },
      qa(run) {
        this.act('ignite');
        let seenSmoke = false;
        let alerted = false;
        for (let k = 0; k < 10; k++) {
          run(1);
          seenSmoke ||= (camState.cam04.fire?.smoke ?? 0) > 0;
          alerted ||= site.alerts.some((a) => a.type === 'fire');
        }
        this.act('out');
        run(14);
        return [
          ['smoke and fire are found on the frame', seenSmoke],
          ['0.6 or more raises it, on one frame', alerted],
          ['put out, it clears', fire.phase === 'out' || fire.phase === 'none'],
        ];
      },
    },
    {
      id: 'alerts',
      pip: true,
      enter: () => {
        setShow({});
        queueMicrotask(() => slot.chapters?.emit('pipcaption', 'The latest alert’s screenshot, as uploaded'));
      },
      readouts: () => [
        ...site.alerts.slice(0, 3).map((a, i) => ({ label: `${a.at} ${CAMS[a.cam]?.name}`, value: a.title, tone: a.severity === 'critical' ? 'red' : a.severity === 'high' ? 'amber' : 'red', key: i })),
        { label: 'Cooldown', value: '10 s per camera, per type (not per person)' },
        { label: 'Held back', value: `${site.suppressed} in cooldown` },
        { label: 'Evidence', value: 'a screenshot a alert, to S3 (link 7 days)' },
      ],
      actions: () => [{ id: 'burst', label: 'Two violations, back to back' }],
      act(id) {
        if (id === 'burst') {
          takeOff('hat');
          setTimeout(() => takeOff('vest'), 900);
        }
      },
      qa(run) {
        const n0 = site.alerts.filter((a) => a.type === 'ppe' && a.cam === 'cam02').length;
        const s0 = site.suppressed;
        takeOff('hat');
        run(3);
        takeOff('vest');
        run(2);
        const n1 = site.alerts.filter((a) => a.type === 'ppe' && a.cam === 'cam02').length;
        const latest = site.alerts[0];
        return [
          ['one alert a camera and type in 10 s', n1 - n0 <= 1 && site.suppressed > s0, `${n1 - n0} raised, ${site.suppressed - s0} held back`],
          ['each with a screenshot named for S3', !!latest && /^alert_\w+_CAM-0\d_\d{8}_\d{6}\.jpg$/.test(latest.file), latest?.file],
        ];
      },
    },
    {
      id: 'playback',
      pip: true,
      enter: () => {
        setShow({});
        rec.pos = 0;
        queueMicrotask(() => slot.chapters?.emit('pipcaption', `${CAMS[rec.cam].name} · recorded, 2 s segments`));
      },
      readouts: () => [
        { label: 'Position', value: rec.pos ? `${Math.round(rec.pos)} s back` : 'LIVE', tone: rec.pos ? 'amber' : 'red' },
        { label: 'Kept here', value: `${Math.round(rec.frames.length * SEGMENT)} s (the server keeps 12 h)` },
        { label: 'Segments', value: '2 s, the camera’s H.264 passed through' },
        { label: 'Timelapse', value: 'a snapshot every 10 min, played at 24 fps' },
      ],
      actions: () => [
        ...Object.keys(CAMS).map((r) => ({ id: `rec_${r}`, label: CAMS[r].name, pressed: rec.cam === r })),
        { id: 'back', label: '−10 s' },
        { id: 'fwd', label: '+10 s' },
        { id: 'live', label: 'GO LIVE', pressed: !rec.pos },
      ],
      act(id) {
        if (id.startsWith('rec_')) {
          rec.cam = id.slice(4);
          rec.frames = [];
          rec.pos = 0;
        }
        const kept = rec.frames.length * SEGMENT;
        if (id === 'back') rec.pos = Math.min(Math.max(0, kept - SEGMENT), rec.pos + 10);
        if (id === 'fwd') rec.pos = Math.max(0, rec.pos - 10);
        if (id === 'live') rec.pos = 0;
      },
      qa(run) {
        run(12);
        const kept = rec.frames.length;
        this.act('back');
        const back = rec.pos;
        this.act('live');
        return [
          ['the picture is kept in 2 s segments', kept >= 3 || card, `${kept} segments`],
          ['it scrubs back 10 s', back === 10 || kept < 6, `${back} s`],
          ['and goes live again', rec.pos === 0],
        ];
      },
    },
    {
      id: 'productivity',
      enter: () => setShow({ rings: true }),
      readouts: () => {
        const ws = people.filter((p) => p.role === 'worker' && p.visible && p.enrolled);
        const c = (s) => ws.filter((p) => status(p) === s).length;
        const onSite = site.attendance.filter((r) => !r.out).length;
        return [
          { label: 'Active', value: c('Active'), tone: 'turq' },
          { label: 'Idle', value: c('Idle'), tone: c('Idle') ? 'amber' : 'grey' },
          { label: 'PPE Violation', value: c('PPE Violation'), tone: c('PPE Violation') ? 'red' : 'grey' },
          { label: 'Idle, by the rule', value: 'moved under 5% of the box in 120 s' },
          { label: 'Attendance', value: `${site.entries} in, ${site.exits} out at the gate${onSite ? `, ${onSite} logged` : ''}` },
        ];
      },
      actions: () => [{ id: 'idle', label: 'Someone stands idle' }],
      act(id) {
        if (id === 'idle') idleOne();
      },
      qa(run) {
        const w = idleOne();
        run(IDLE_SECS / RATE + 6);
        return [
          ['standing still 120 s marks a worker idle', !!w?.idle, w ? `${w.name}: ${Math.round(w.stillFor ?? 0)} s still` : 'nobody free'],
          ['cards say Active, Idle or PPE Violation', people.filter((p) => p.role === 'worker').every((p) => ['Active', 'Idle', 'PPE Violation'].includes(status(p)))],
        ];
      },
    },
    {
      id: 'office',
      enter: () => setShow({ rings: true }),
      readouts: () => {
        const mem = Object.entries(site.models).filter(([, on]) => on).reduce((n, [k]) => n + MEMORY[k], 0);
        return [
          { label: 'Models loaded', value: Object.entries(site.models).filter(([, on]) => on).map(([k]) => MODE_NAME[k]).join(', ') || 'none' },
          { label: 'Memory, estimated', value: `${mem} MB` },
          { label: 'ONNX Runtime, benchmark', value: `YOLOv8s: ${BENCH.torch} → ${BENCH.onnx} ms (${(BENCH.torch / BENCH.onnx).toFixed(2)}×)` },
          { label: 'Test alerts', value: site.tests },
        ];
      },
      actions: () => [
        ...Object.keys(MEMORY).map((k) => ({ id: `model_${k}`, label: `${MODE_NAME[k]} · ${MEMORY[k]} MB`, pressed: site.models[k] })),
        { id: 'test', label: 'Send a test alert' },
      ],
      act(id) {
        if (id.startsWith('model_')) {
          const k = id.slice(6);
          site.models[k] = !site.models[k];
          event(`${MODE_NAME[k]} model ${site.models[k] ? 'loaded' : 'unloaded'}`);
        }
        if (id === 'test') {
          site.tests++;
          raise('test', 'cam01', 'TEST ALERT', 'medium', []);
        }
      },
      qa(run) {
        this.act('model_fire');
        ignite();
        run(4);
        const blind = !camState.cam04.fire?.detected && !camState.cam04.items.length;
        this.act('model_fire');
        fire.phase = 'none';
        this.act('test');
        run(0.5);
        return [
          ['a model can be unloaded (and its camera sees nothing)', blind],
          ['a test alert goes through', site.alerts.some((a) => a.title === 'TEST ALERT')],
          ['the ONNX figure is labelled a benchmark', /benchmark/.test(this.readouts().find((r) => /ONNX/.test(r.label))?.label ?? '')],
        ];
      },
    },
  ];
  const SHOTS = {
    cameras: { zoom: 0.96, pitch: 0.06 },
    ppe: { target: [-3.4, 0.8, 1.9], zoom: 0.55, yaw: -0.12 },
    faces: { target: [5.2, 0.9, -0.4], zoom: 0.46, yaw: 0.22 },
    falls: { target: [-3.6, 0.7, -2.3], zoom: 0.5, yaw: -0.08, pitch: 0.06 },
    fire: { target: [3.8, 0.8, -3.0], zoom: 0.48, yaw: 0.1 },
    alerts: { target: [4.6, 1.0, 2.9], zoom: 0.42, yaw: 0.05 },
    playback: { zoom: 0.96, pitch: 0.06 },
    productivity: { zoom: 0.92, pitch: 0.22 },
    office: { target: [5.0, 1.0, 3.0], zoom: 0.36, yaw: 0.02, pitch: -0.02 },
  };
  for (const c of chapters) if (SHOTS[c.id]) c.shot = SHOTS[c.id];

  // Beats: when a chapter opens (on a card's tour too), its feature happens.
  director.beat('ppe', () => (people.some((p) => p.ppeFix) ? null : (takeOff(rand() < 0.5 ? 'hat' : 'mask'), null)));
  director.beat('falls', () => (camState.cam03.fall?.fallen ? null : slip()));
  director.beat('fire', () => {
    if (fire.phase === 'smoke' || fire.phase === 'fire') return null;
    ignite();
    setTimeout(() => extinguish(), 14000);
    return null;
  });

  const clickables = [];
  for (const r of Object.keys(CAMS)) {
    const m = stage.byName.get(`cam_${r}`);
    if (m) {
      m.userData.camRole = r;
      m.userData.pick = 'click';
      clickables.push(m);
    }
  }

  // ---------------------------------------------------------------- frame
  setShow({ rings: true });
  return {
    chapters,
    agents: b.agents,
    grid: b.grid,
    crowd: b.crowd,
    districts,
    roles: { customer: 'worker', staff: ['supervisor', 'guard'] },
    site,
    director,
    onChapter: (id) => director.enter(id),
    demo: {
      shots: {
        cameras: [['cam03', 1200]],
        ppe: [['hat', 5000]],
        faces: [[null, 3000]],
        falls: [['slip', 4500]],
        fire: [['ignite', 7000]],
        alerts: [[null, 1500]],
        playback: [['back', 1500]],
        productivity: [[null, 1500]],
        office: [[null, 2000]],
      },
      record: [
        ['chapter', 'cameras', 3000], ['act', 'cam01', 2500], ['act', 'cam03', 2500], ['act', 'cam04', 2500], ['act', 'cam02', 2500],
        ['chapter', 'ppe', 3000], ['act', 'hat', 9000], ['act', 'turn', 6000],
        ['chapter', 'faces', 4000], ['act', 'enrol', 6000],
        ['chapter', 'falls', 2500], ['act', 'slip', 9000],
        ['chapter', 'fire', 2500], ['act', 'ignite', 8000], ['act', 'out', 6000],
        ['chapter', 'alerts', 3000], ['act', 'burst', 5000],
        ['chapter', 'playback', 2500], ['act', 'back', 3000], ['act', 'back', 3000], ['act', 'live', 2000],
        ['chapter', 'productivity', 3000], ['act', 'idle', 16000],
        ['chapter', 'office', 3000], ['act', 'model_fire', 2000], ['act', 'model_fire', 1500], ['act', 'test', 3000],
      ],
    },
    pip: () => {
      const c = slot.chapters?.current;
      if (!c?.pip) return null;
      if (c.id === 'cameras') return pipFor(selectedCam, (g, w, h) => camState[selectedCam].fall && drawSkeleton(g, w, h, cams[selectedCam].cam, camState[selectedCam].fall));
      if (c.id === 'ppe') return pipFor('cam02');
      if (c.id === 'faces') return pipFor('cam01');
      if (c.id === 'falls') return pipFor('cam03', (g, w, h) => drawSkeleton(g, w, h, cams.cam03.cam, camState.cam03.fall));
      if (c.id === 'fire') return pipFor('cam04');
      if (c.id === 'playback') return { camera: cams[rec.cam].cam, fps: 4, draw2d: recPip };
      if (c.id === 'alerts') {
        const a = site.alerts.find((q) => q.shot);
        return a ? { image: a.shot, fps: 2 } : null;
      }
      return null;
    },
    draw2d(g, w, h, camera) {
      const items = show.boxes ? mainItems() : [];
      const px = slot.css?.w ? w / slot.css.w : 1;
      if (items.length) drawDetections(g, w, h, camera, (slot.css?.w ?? 1000) < 600 ? items.map((i) => ({ ...i, tag: i.tag?.split(':')[0] })) : items, { px });
      if (show.skeleton && camState.cam03.fall) drawSkeleton(g, w, h, camera, camState.cam03.fall);
      if (show.cams && !card) {
        // (frustums are drawn in the line batch)
      }
    },
    pickables: () => [...b.picks, ...clickables, ...people.filter((p) => p.visible).map((p) => p.proxy)],
    onClick(hit) {
      let o = hit.object;
      while (o && !o.userData.camRole && o.parent) o = o.parent;
      if (o?.userData.camRole) {
        if (slot.chapters?.current?.id !== 'cameras') slot.chapters?.go('cameras');
        slot.chapters?.act(o.userData.camRole);
        return;
      }
      const a = hit.object.userData.agent;
      if (a) ctx.emit('person', a.enrolled ? a.name : 'Unknown');
    },
    onDrag() {},
    update(dt) {
      const dts = dt * RATE;
      site.clock += dts;
      if ((districtT -= dt) <= 0) {
        districts.tick(0.2 - districtT, people);
        districtT = 0.2;
      }
      // The pipeline: a frame a camera every 2 s (site time), started 2 s apart.
      for (const [r, cs] of Object.entries(camState)) {
        cs.t += dts;
        if (cs.t >= FRAME) {
          cs.t -= FRAME;
          processFrame(r);
        }
      }
      idleTick(dts);
      // The new starter waits at the hut; the guard enrols them after a while.
      if (newStarter && !newStarter.enrolled && newStarter.st.phase === 'waiting') {
        enrolWait += dt;
        if (enrolWait > 45) enrol();
      }
      // Workers out on a run come back a while later.
      for (const a of people) {
        if (a.visible || a.role !== 'worker') continue;
        a.st.back = (a.st.back ?? 20 + rand() * 20) - dt;
        if (a.st.back > 0) continue;
        if (!b.crowd.enter(a, 'road')) continue;
        a.st = { tasks: [go(spot('gate_road_in'), { via: true }), go(spot('gate_in'), { via: true })], phase: 'work' };
        a.st.back = null;
        hold(a, null);
      }
      b.update(dt);
      recordTick(dt);
      b.lines.begin();
      if (show.cams) drawFrustums(b.lines, labels, cams, { selected: selectedCam, color: (r) => CAMS[r]?.color ?? '#a1a1aa', name: (r) => CAMS[r]?.name ?? r });
      b.lines.end();
      drawPeopleRings(dt);
      moveParts(dt);
      director.update(dt);
      dash.update(dt);
      // Labels on the case study: whoever the chapter is about.
      if (!card) {
        const cur = slot.chapters?.current?.id;
        if (cur === 'productivity') {
          for (const a of people) {
            if (!a.visible || a.role !== 'worker') continue;
            const s = status(a);
            labels.set(`w${a.id}`, { text: a.enrolled ? a.name : 'Unknown', sub: s, tone: s === 'Active' ? 'turq' : s === 'Idle' ? 'amber' : 'red', at: [a.pos.x, 1.8, a.pos.y] });
          }
        }
        if (cur === 'fire' && (fire.phase === 'smoke' || fire.phase === 'fire')) labels.set('fire', { text: fire.phase === 'fire' ? 'Fire' : 'Smoke', sub: nearestPlace(binSpot.x, binSpot.z), tone: 'red', at: [binSpot.x, 1.6, binSpot.z], priority: true });
      }
    },
    snapshot() {
      return { site: { entries: site.entries, exits: site.exits } };
    },
    resume(s) {
      if (s?.site) Object.assign(site, s.site);
    },
    reset() {},
    dispose() {
      b.dispose();
      rings.dispose?.();
      for (const P of [flames, smoke, sparks]) {
        P.pts.removeFromParent();
        P.pts.geometry.dispose();
        P.pts.material.dispose();
      }
      dash.dispose();
      dashPlane?.geometry.dispose();
      dashPlane?.removeFromParent();
      pickGeo.dispose();
      pickMat.dispose();
    },
  };
}
