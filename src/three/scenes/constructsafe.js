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
import { AdditiveBlending, Box3, Color, CylinderGeometry, Mesh, MeshBasicMaterial, PlaneGeometry, SphereGeometry, Vector3 } from 'three';

import { drawDetections } from '../overlays/detect2d.js';
import { GLOW } from '../overlays/lines.js';
import { Rings } from '../overlays/rings.js';
import { Director } from '../sim/director.js';
import { inPoly } from '../sim/grid.js';
import { Districts } from '../sim/spread.js';
import { base } from './base.js';
import { alertQueue } from './kit/alerts.js';
import { Evidence, countInView, drawCctv, drawFrustums, occlusion, siteCameras } from './kit/cctv.js';
import { particles, spin } from './kit/living.js';
import { besideOf as besideFor, jobBoard } from './kit/staff.js';
import { act, asideFrom, clockFeed, go, near, placeNamer, rng, spotsOf } from './kit/util.js';

// ---------------------------------------------------------------- the product's numbers
// backend/detection_system/app.py and config.py unless noted.
const FRAME = 2; // FRAME_CAPTURE_INTERVAL: one frame a camera, every 2 s
const STAGGER = [0, 2, 4, 6]; // cameras start 0, 2, 4 and 6 s apart
const COOLDOWN = 10; // an alert type, per camera (not per person)
const PPE_CONF = 0.5; // the PPE model, on each person's crop (15% padding)
const PERSON_CONF = 0.3; // the person detector (COCO YOLOv8n), CPU pass
const SMOOTH = 2; // a PPE item counts once seen in 2 of the last 3 frames
const WINDOW = 3; // ... and a person's verdict waits for 3 frames of them
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
  // (lens: the indoor camera's is narrower, the floor it watches filling its picture)
  cam03: { name: 'CAM-03', area: 'Indoor · ground floor', mode: 'fall', color: '#fbbf24', lens: 58 },
  cam04: { name: 'CAM-04', area: 'High-Risk Zone · welding bay', mode: 'fire', color: '#fb6f8a' },
};
const MODE_NAME = { face: 'Face', ppe: 'PPE', fall: 'Fall', fire: 'Fire', ppe_fall: 'PPE+Fall', all: 'All' };
// The combined modes are shown doing what they reliably do: the PPE check,
// with names. They exist only while the cameras chapter is open, and never
// while a fire burns or someone is down (see hazard()).
const COMBINED = new Set(['ppe_fall', 'all']);
const MODEL_OF = { face: 'face', ppe: 'ppe', fall: 'fall', fire: 'fire', ppe_fall: 'ppe', all: 'ppe' };
const TOOLS = ['hammer', 'broom', 'torch', 'box', 'clipboard'];
const REGIONS = ['eyes', 'white', 'skin', 'top', 'bottom', 'shoes', 'sole', 'hair', 'mouth', 'accent', 'trim', 'vest', 'strip', 'badge', 'lens', 'belt'];

export async function create(ctx) {
  const { stage, labels, context, slot } = ctx;
  const data = stage.data;
  const b = base(ctx);
  // The barrier's arm is overhead (it lifts for anyone at the gate), not a
  // wall: left on the walk grid it would seal the gate shut.
  b.grid?.unstamp('barrier_arm');
  const rand = rng(ctx.seed ?? 2718);
  // Sparks, flames and smoke draw from a stream of their own, so how many
  // particles a frame spawns never changes what anyone decides to do.
  const fxRand = rng((ctx.seed ?? 2718) + 1);
  const scene = stage.scene;
  const card = context !== 'case';
  // The baked spots, and one of the page's own: on the open floor south of
  // the blocks pallet, where a delivery is counted (the pallets' baked spots
  // stand in the yard's single-file aisle, so they're only ever pickups).
  const baked = spotsOf(data);
  const OWN_SPOTS = { pallet_count: { x: 0.2, z: -1.95, face: 0 } };
  const spot = (k) => OWN_SPOTS[k] ?? baked(k);

  // ---------------------------------------------------------------- the site's state
  const site = {
    clock: 9 * 3600 + 40 * 60, // 09:40
    feed: [],
    alerts: [],
    frames: 0,
    models: { ppe: true, fall: true, fire: true, face: true },
    attendance: [], // { name, in, out }
    shift: [...SHIFT], // the workers' shift: attendance is logged inside it
    lastEntry: null, // { name, logged, clock, who }
    entryLog: [], // the last few of them
    entries: 0,
    exits: 0,
    enrolled: 0,
    tests: 0,
  };
  const { time, event } = clockFeed(site);
  // Things that happen a while from now, on the site's clock (so they pause
  // with the scene, run under QA's stepping and never outlive it).
  let timers = [];
  const later = (secs, fn) => timers.push({ at: site.clock + secs, fn });
  function runTimers() {
    if (!timers.length) return;
    const due = timers.filter((t) => site.clock >= t.at);
    if (!due.length) return;
    timers = timers.filter((t) => site.clock < t.at);
    for (const t of due) t.fn();
  }
  const stamp = () => {
    const t = site.clock;
    const p = (n) => String(Math.floor(n)).padStart(2, '0');
    return `20260927_${p(t / 3600)}${p((t / 60) % 60)}${p(t % 60)}`;
  };

  // ---------------------------------------------------------------- cameras
  const cams = siteCameras(data, { wall: Object.keys(CAMS), far: 30 });
  for (const [r, c] of Object.entries(CAMS)) {
    if (!c.lens || !cams[r]) continue;
    cams[r].cam.fov = cams[r].fov = c.lens;
    cams[r].cam.updateProjectionMatrix();
  }
  const occluded = occlusion(data);
  const camState = Object.fromEntries(Object.keys(cams).map((r, i) => [r, { mode: CAMS[r]?.mode ?? 'ppe', t: -(STAGGER[i] ?? 0), frame: 0, items: [], seen: new Map(), fall: null, fire: null }]));
  let selectedCam = 'cam02';
  const zones = Object.fromEntries(Object.entries(data.zones ?? {}).map(([k, pts]) => [k, pts.map((q) => [q[0], q[2]])]));
  // Where the new starter waits to be enrolled: the nearest open floor to the
  // hut's counter that is clear of the gate (walked through, never stood in:
  // a pace inside it counts) and of the road's portal (where people appear).
  const enrolAt = (() => {
    const e = spot('enrol');
    const road = b.portals.find((p) => p.name === 'road');
    if (!e || !b.grid) return e;
    const inGate = (x, z) => zones.gate && [[0, 0], [0.2, 0], [-0.2, 0], [0, 0.2], [0, -0.2]].some(([dx, dz]) => inPoly(x + dx, z + dz, zones.gate));
    const ok = (x, z) => b.grid.free(x, z) && b.grid.clearAt(x, z) >= 0.3 && !inGate(x, z) && (!road || Math.hypot(x - road.x, z - road.z) > road.r + 0.8);
    if (ok(e.x, e.z)) return e;
    let best = null;
    for (let r = 0.1; r <= 1.5 && !best; r += 0.05) {
      for (let k = 0; k < 24; k++) {
        const t = (k / 24) * Math.PI * 2;
        const x = e.x + Math.sin(t) * r;
        const z = e.z + Math.cos(t) * r;
        if (ok(x, z)) {
          best = { x, z };
          break;
        }
      }
    }
    return best ? { ...best, face: [e.x, e.z] } : e; // facing the counter
  })();
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
    a.tool = tool;
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
  // The new starter isn't on site yet: they come in from the road in a moment,
  // past the gate camera (face to face with it), to the hut to be enrolled.
  if (newStarter) {
    b.crowd.hide(newStarter);
    newStarter.st.back = 3;
  }

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
    { name: 'groundworks', stations: () => ['rebar_0', 'rebar_1', 'form_a', 'form_b'].map((k) => S(k, 'hammer')), cap: 2, feature: true, key: true },
    // The mixer and the barrow stand in a pocket with one way in: one worker at a time.
    { name: 'mixer', stations: () => [S('mixer', 'point'), S('barrow', 'sweep')], poly: [[-1.45, 1.95], [0.45, 1.95], [0.45, 3.35], [-1.45, 3.35]], cap: 1, feature: true, solo: true },
    { name: 'scaffold', stations: () => [S('scaffold_foot', 'point')], cap: 1, feature: true },
    // The ground floor is reached single file, between the block stacks: one worker at a time.
    { name: 'ground_floor', stations: () => ['blockwork', 'blocks', 'mortar', 'trestle'].map((k) => S(k, 'fold')), poly: zones.ground_floor, cap: 1, feature: true, key: true, solo: true },
    { name: 'yard', stations: () => ['yard_blocks', 'yard_bags', 'timber', 'skip', 'van', 'pallet_count'].map((k) => S(k, 'fold')), cap: 2, feature: true },
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
  // Those who open at a station hold it while they carry on there (in a
  // one-at-a-time district, only the first of them; the others finish soon).
  for (const p of people) {
    const t = p.st.tasks.find((q) => q.opening);
    const k = t && [...districts.keyOf.values()].find(({ s: q }) => q.key && Math.hypot(q.x - p.pos.x, q.z - p.pos.y) < 0.35);
    if (k && b.crowd.free(k.s.key, p)) t.claim = k.s.key;
    const d = t && districts.of(p.pos.x, p.pos.y);
    if (d?.solo) {
      if (people.some((q) => q !== p && q.soloFor === d)) t.secs = Math.min(t.secs, 3);
      else p.soloFor = d;
    }
  }

  // ---------------------------------------------------------------- work
  // Each job happens at a place, with its tool: hammering at the rebar and the
  // footings, laying blocks on the ground floor, welding in the bay; and
  // carrying: a load picked up in the yard and set down where it's needed.
  const board = jobBoard({ people, districts, rand, staff: ['worker'], customer: 'visitor' });
  // A walk across the site costs more than the board's own reckoning: site
  // work is done where you are, and fewer long crossings keep the lanes clear.
  const walkCost = (s, a) => 0.6 * Math.hypot(s.x - a.pos.x, s.z - a.pos.y);
  /** A one-at-a-time district with someone else in it, or on their way. */
  const soloBusy = (d, a) => !!d?.solo && people.some((p) => p !== a && p.visible && (p.soloFor === d || districts.where(p) === d || districts.of(p.pos.x, p.pos.y) === d));
  /** A job into a one-at-a-time district holds it until the job is done. */
  const reserve = (a, ...ds) => (a.soloFor = ds.find((d) => d?.solo) ?? null);
  const at = (k, clip, tool, [lo, hi] = [14, 22]) => (a) => {
    const s = spot(k);
    if (!s || !b.crowd.free(k, a) || soloBusy(districts.of(s.x, s.z), a)) return null;
    return {
      d: districts.of(s.x, s.z), at: s, cost: walkCost(s, a),
      run: () => {
        reserve(a, districts.of(s.x, s.z));
        a.st.tasks.push({ call: () => hold(a, tool), at: s }, act(clip, lo + rand() * (hi - lo), s.face, { claim: k, at: s }));
        return go(s, { claim: k });
      },
    };
  };
  const carry = (from, to) => (a) => {
    const s = spot(from);
    const e = spot(to);
    if (!s || !e || !b.crowd.free(from, a) || !b.crowd.free(to, a) || soloBusy(districts.of(s.x, s.z), a) || soloBusy(districts.of(e.x, e.z), a)) return null;
    return {
      d: districts.of(e.x, e.z), at: s, cost: walkCost(s, a) + 0.5 * Math.hypot(e.x - s.x, e.z - s.z),
      run: () => {
        reserve(a, districts.of(e.x, e.z), districts.of(s.x, s.z));
        a.st.tasks.push(
          act('fold', 3, s.face, { claim: from, at: s }),
          { call: () => hold(a, 'box') },
          go(e, { claim: to }),
          act('fold', 3, e.face, { claim: to, at: e }),
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
    mix: at('mixer', 'point', null, [14, 20]),
    barrow: at('barrow', 'sweep', 'broom'),
    scaffold: at('scaffold_foot', 'point', null, [8, 12]),
    blockwork: at('blockwork', 'fold', null),
    mortar: at('mortar', 'fold', null),
    sweep: at('trestle', 'sweep', 'broom'),
    weld: at('weld', 'weld', 'torch'),
    beam: at('beam', 'hammer', 'hammer'),
    bottles: at('bottles', 'point', null, [7, 11]),
    // The yard: a delivery counted, timber cut to length, the van unloaded.
    count: at('pallet_count', 'point', null, [12, 18]),
    cut: at('timber', 'hammer', 'hammer', [12, 18]),
    unload: carry('van', 'yard_bags'),
    blocks_in: carry('yard_blocks', 'blocks'),
    bags_to_mixer: carry('yard_bags', 'mixer'),
    timber_to_forms: carry('timber', 'form_b'),
    rubble_out: carry('trestle', 'skip'),
    // Tools change hands: over to someone working with a hammer or a broom
    // nearby, a word, and it's passed across (they go on to their next job).
    lend: (a) => {
      const q = people
        .filter((p) => p !== a && p.visible && p.role === 'worker' && p.task?.act && ['hammer', 'broom'].includes(p.tool) && !director.busy(p) && Math.hypot(p.pos.x - a.pos.x, p.pos.y - a.pos.y) < 6)
        .sort((x, y) => Math.hypot(x.pos.x - a.pos.x, x.pos.y - a.pos.y) - Math.hypot(y.pos.x - a.pos.x, y.pos.y - a.pos.y))[0];
      const at = q && besideOf(q, a);
      if (!at || soloBusy(districts.of(at.x, at.z), a)) return null;
      return {
        d: districts.of(q.pos.x, q.pos.y), at, cost: walkCost(at, a) + 1,
        run: () => {
          hold(a, null);
          a.st.tasks.push(
            { call: () => { if (q.task?.act) { q.task.face = [a.pos.x, a.pos.y]; q.task.secs = Math.max(q.task.secs, q.timer + 3.5); } }, at },
            act('talk', 2.5, [q.pos.x, q.pos.y], { at }),
            { call: () => {
              const t = q.tool;
              if (!q.visible || !t) return;
              hold(q, null);
              hold(a, t);
              if (q.task?.act) q.task.secs = Math.min(q.task.secs, q.timer + 0.5);
              event(`${q.name} passes ${a.name} the ${t}`);
            }, at },
          );
          return go(at);
        },
      };
    },
  };
  // Each worker leans to a part of the site, but does many jobs.
  const HOMES = {
    Ravi: ['rebar_0', 'rebar_1', 'form_b', 'barrow'],
    Arun: ['form_a', 'timber_to_forms', 'cut', 'mix'],
    Meena: ['blockwork', 'blocks_in', 'mortar'],
    Karthik: ['mortar', 'sweep', 'rubble_out', 'blockwork'],
    Vijay: ['weld', 'beam', 'bottles'],
    Divya: ['count', 'unload', 'blocks_in', 'cut'],
    Mani: ['mix', 'bags_to_mixer', 'barrow', 'scaffold'],
    [newStarterName]: ['cut', 'count', 'unload', 'sweep'],
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
    // (An idle stand, below, holds its ground; the next task lets it go.)
    if (a.stood) {
      a.fixed = false;
      a.stood = false;
    }
    if (st.phase === 'arriving') {
      // New on site: to the hut's counter, to be enrolled (a photo and an ID).
      st.phase = 'waiting';
      return go(enrolAt, { claim: 'enrol' });
    }
    if (st.phase === 'waiting') {
      return act(rand() < 0.5 ? 'idle' : 'phone', 3, enrolAt?.face, { claim: 'enrol' });
    }
    if (st.phase === 'out') return { exit: 'road' };
    if (st.phase === 'idle') {
      // Stood still on the phone (the productivity chapter's): long enough to be marked idle.
      st.phase = 'work';
      hold(a, null);
      // Standing their ground meanwhile (nobody asks them to make way).
      a.fixed = true;
      a.stood = true;
      return act('phone', st.idleFor ?? 50, null, { claim: a.claim });
    }
    a.soloFor = null; // the last job is done
    const home = HOMES[a.name] ?? [];
    const next = board.next(a, [...home, ...ALL_JOBS.filter((j) => !home.includes(j))], home, JOBS, { beside: ['lend'] });
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
      const beside = w.visible && besideOf(w, a);
      if (beside) {
        st.onFix = { who: w, until: site.clock + 90 };
        st.tasks.push(
          { call: () => { if (w.task?.act) { w.task.face = [a.pos.x, a.pos.y]; w.task.secs = Math.max(w.task.secs, w.timer + 4); } }, at: beside },
          act('talk', 3, [w.pos.x, w.pos.y], { at: beside }),
          { call: () => {
            st.onFix = null;
            // Handed over only within reach (they may have moved on meanwhile: then again, shortly).
            if (Math.hypot(w.pos.x - a.pos.x, w.pos.y - a.pos.y) > 1.4 || !w.ppeFix) {
              if (w.ppeFix) w.ppeFix.sent = false;
              return;
            }
            setPPE(w, fix.item, true);
            w.ppeFix = null;
            event(`${fix.item === 'hat' ? 'hard hat' : fix.item} handed to ${w.name}`);
          }, at: beside },
        );
        return go(beside);
      }
      // Nowhere to stand by them just now (or they're out): try again shortly.
      if (w.ppeFix) {
        w.ppeFix.sent = false;
        w.ppeFix.due = site.clock + 4;
      }
    }
    st.i = ((st.i ?? -1) + 1) % 4;
    const desk = spot('desk');
    if (st.i === 0) {
      // At the desk, on the dashboard for a while.
      hold(a, 'clipboard');
      st.tasks.push(act('type', 16 + rand() * 10, desk.face, { claim: 'desk', at: desk }));
      return go(desk, { claim: 'desk' });
    }
    if (st.i === 1) {
      const p = spot('plans');
      st.tasks.push(act('point', 8 + rand() * 4, p.face, { claim: 'plans', at: p }));
      return go(p, { claim: 'plans' });
    }
    // A walk round: to a worker at work nearby (the yard, the welding bay,
    // the gate side of the site), a word with them.
    const w = workers().filter((q) => q.task?.act && q.onSite && !near(q, desk, 3) && Math.hypot(q.pos.x - desk.x, q.pos.y - desk.z) < 7 && !districts.of(q.pos.x, q.pos.y)?.solo).sort(() => rand() - 0.5)[0];
    const beside = w && besideOf(w, a);
    if (!beside) return act('idle', 2);
    st.tasks.push(act('talk', 3 + rand() * 2, [w.pos.x, w.pos.y], { at: beside }));
    return go(beside);
  }

  /** Somewhere to stand by `c` for a word: a pace off, on open floor, clear of everyone else. */
  function besideOf(c, a) {
    return besideFor(c, a, { grid: b.grid, districts, people, n: 12 });
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
      // Not someone who has only just come back in (a run is a while on site, then out).
      const p = director.cast(people, (q) => working(q) && q !== newStarter && q.task?.act && !q.ppeFix && site.clock - (q.backAt ?? -Infinity) > 90, spot('gate_in'));
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
    // Not while a hand-over is under way (one whose walk failed lapses after 90 site s).
    when: () => supervisor && !supervisor.st.fixing && !(supervisor.st.onFix && site.clock < supervisor.st.onFix.until),
    run: () => {
      // To someone standing at work (a moving target is caught at their next job).
      const w = people.find((p) => p.role === 'worker' && p.visible && p.task?.act && p.ppeFix && (!p.ppeFix.sent || site.clock > p.ppeFix.sentAt + 90) && site.clock > p.ppeFix.due);
      if (!w) return null;
      w.ppeFix.sent = true;
      w.ppeFix.sentAt = site.clock;
      // They're told she's on her way: they keep at what they're doing till she's there.
      if (w.task?.act) w.task.secs = Math.max(w.task.secs, w.timer + 30);
      supervisor.st.fixing = { who: w, item: w.ppeFix.item };
      return director.redirect(supervisor, () => {});
    },
  });

  // Two walkers head-on in a narrow aisle (the yard's, between the pallets and
  // the timber) can end up waiting on each other. After 6 s of neither
  // getting anywhere, the one on the lesser errand steps aside a moment, then
  // carries on. (Counted with the crowd's last resorts, so QA sees each one.)
  const errand = (p) => (p.st?.phase === 'out' || p.st?.phase === 'arriving' || director.busy(p) || p.tool === 'box' ? 2 : 1);
  function unstick() {
    for (const a of people) {
      if (!a.visible || a.fixed || !(a.task?.go || a.task?.exit)) {
        a.stuckAt = null;
        continue;
      }
      const at = a.stuckAt;
      if (!at || Math.hypot(a.pos.x - at.x, a.pos.y - at.z) > 0.2) a.stuckAt = { x: a.pos.x, z: a.pos.y, t: site.clock };
    }
    for (const a of people) {
      if (!a.stuckAt || site.clock - a.stuckAt.t < 6 * RATE) continue;
      const o = people.find((q) => q !== a && q.stuckAt && site.clock - q.stuckAt.t >= 6 * RATE && Math.hypot(q.pos.x - a.pos.x, q.pos.y - a.pos.y) < 1.6);
      if (!o) continue;
      const y = errand(a) < errand(o) || (errand(a) === errand(o) && a.id > o.id) ? a : o;
      const to = asideFrom(y, { rand, grid: b.grid, districts, people });
      if (!to) continue;
      const phase = y.st.phase;
      director.redirect(y, (q) => q.st.tasks.push(go(to), act('idle', 1.5, null)));
      y.st.phase = phase;
      a.stuckAt = o.stuckAt = null;
      if (b.crowd.stats) b.crowd.stats.gaveUp = (b.crowd.stats.gaveUp ?? 0) + 1;
      b.crowd.note?.('unstick', y, y === a ? o : a);
    }
  }
  let unstickT = 0;

  // ---------------------------------------------------------------- living parts
  const drum = stage.byName.get('mixer_drum');
  const arm = stage.byName.get('barrier_arm');
  const armRest = arm?.quaternion.clone();
  let armLift = 0;
  const binSpot = spot('fire_bin') ?? { x: 4.75, z: -2.55 };
  // Fire and smoke: points rising from the bin (the fire chapter's).
  const fire = { phase: 'none', t: 0, smoke: 0, flame: 0 };
  // (Sized to read from the fire chapter's shot: a flame a hand across, smoke in puffs.)
  const flames = particles({ scene, rand: fxRand, n: 90, color: new Color(2.2, 0.9, 0.25), size: 0.24, blending: AdditiveBlending });
  const smoke = particles({ scene, rand: fxRand, n: 46, color: new Color(0.2, 0.2, 0.21), size: 0.6, opacity: 0.6 });
  const sparks = particles({ scene, rand: fxRand, n: 40, color: new Color(2.4, 1.6, 0.6), size: 0.05, blending: AdditiveBlending });
  const mixer = spin(drum, 1.8);
  const welder = () => people.find((p) => p.visible && p.clip === 'weld');
  function moveParts(dt) {
    mixer.update(dt);
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
    flames.step(dt, (i, pos, vel) => {
      // A flame half a metre tall over the bin, narrowing as it rises.
      const dx = (fxRand() - 0.5) * 0.3;
      const dz = (fxRand() - 0.5) * 0.3;
      pos.set([binSpot.x + dx, 0.62, binSpot.z + dz], i * 3);
      vel.set([-dx * 0.5, 0.25 + fxRand() * 0.35, -dz * 0.5], i * 3);
    }, fire.phase === 'fire');
    smoke.step(dt * 0.6, (i, pos, vel) => {
      pos.set([binSpot.x + (fxRand() - 0.5) * 0.25, 0.95, binSpot.z + (fxRand() - 0.5) * 0.25], i * 3);
      vel.set([(fxRand() - 0.5) * 0.15, 0.45 + fxRand() * 0.3, (fxRand() - 0.5) * 0.15 - 0.05], i * 3);
    }, burning || fire.smoke > 0.35);
    const w = welder();
    sparks.step(dt, (i, pos, vel) => {
      const hand = piece(w.fig, 'torch')?.getWorldPosition(new Vector3()) ?? new Vector3(w.pos.x, 0.9, w.pos.y);
      pos.set([hand.x, hand.y, hand.z], i * 3);
      vel.set([(fxRand() - 0.5) * 1.6, fxRand() * 1.2 - 0.2, (fxRand() - 0.5) * 1.6], i * 3);
    }, !!w);
    // Sparks fall.
    const sv = sparks.vel;
    for (let i = 0; i < sparks.n; i++) sv[i * 3 + 1] -= dt * 4;
  }

  // ---------------------------------------------------------------- the pipeline, a frame at a time
  const INKS = { safe: '#4ade80', unsafe: '#fb6f8a', person: '#fbbf24', face: '#22d3ee', smoke: '#b4b4bd', fire: '#fb923c' };
  const SHORT = { Hardhat: 'Hardhat', Mask: 'Mask', 'Safety Vest': 'Vest' };
  const personBox = (s, extra) => ({ x: s.x, z: s.z, yaw: s.yaw, height: 1.62 * s.s, base: s.base, alpha: 1, ...extra });

  const binInPicture = (cam) => {
    const v = new Vector3(binSpot.x, 0.8, binSpot.z).project(cam);
    return v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1;
  };
  /** A fire burning or someone down: the combined modes are not offered then. */
  const hazard = () => fire.phase === 'smoke' || fire.phase === 'fire' || people.some((p) => p.visible && ['slip', 'down', 'getup'].includes(p.clip));
  /** A camera to a mode: what it saw in the old one is dropped. */
  function setMode(r, mode) {
    const cs = camState[r];
    cs.mode = mode;
    cs.items = [];
    cs.seen.clear();
    cs.fall = null;
    cs.fire = null;
  }
  /** Every camera back to the site's own mode (a staged fall or fire, and leaving the cameras chapter). */
  function siteModes() {
    for (const [r, c] of Object.entries(CAMS)) if (camState[r].mode !== c.mode) setMode(r, c.mode);
  }

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
    // (QA's watch: a camera in a combined mode must never have a fire or a
    // fall in its picture. Staging either restores the site's modes first.)
    if (COMBINED.has(cs.mode) && ((fire.phase === 'smoke' || fire.phase === 'fire') && binInPicture(cam) || seen.some((q) => ['slip', 'down', 'getup'].includes(q.who.clip)))) site.comboHazard = (site.comboHazard ?? 0) + 1;
    if (cs.mode === 'ppe' || COMBINED.has(cs.mode)) ppeFrame(r, cs, cam, seen);
    else if (cs.mode === 'face') faceFrame(r, cs, cam, seen);
    else if (cs.mode === 'fall') fallFrame(r, cs, cam, seen);
    else if (cs.mode === 'fire') fireFrame(r, cs, cam);
  }

  function nameOf(cs, s, face) {
    const st = cs.seen.get(s.who) ?? {};
    // Recognised every 5th frame, cached between; no face seen: Unknown.
    if (cs.frame % FACE_EVERY === 0 || st.name == null) st.name = face && s.who.enrolled && site.models.face ? s.who.name : 'Unknown';
    cs.seen.set(s.who, st);
    // (Whether the new starter's face was ever seen, and called Unknown, before they were enrolled.)
    if (face && s.who === newStarter && !s.who.enrolled && st.name === 'Unknown') site.unknownSeen = true;
    // (... and when a camera first named them, once enrolled.)
    if (s.who === newStarter && s.who.enrolled && st.name === newStarterName) site.newStarterNamed ??= site.clock;
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
      const st = cs.seen.get(p) ?? {};
      cs.seen.set(p, st);
      st.h ??= {};
      st.frames = (st.frames ?? 0) + 1;
      const face = faceToward(cam, s);
      // What the model can find on the crop: a hat or bare head and a vest or
      // not from any side; a mask, or a bare face, only from the front.
      const found = {
        Hardhat: p.ppe.hat, 'NO-Hardhat': !p.ppe.hat,
        Mask: p.ppe.mask && face, 'NO-Mask': !p.ppe.mask && face,
        'Safety Vest': p.ppe.vest, 'NO-Safety Vest': !p.ppe.vest,
      };
      for (const [k, on] of Object.entries(found)) {
        const h = (st.h[k] ??= []);
        h.push(on);
        if (h.length > WINDOW) h.shift();
      }
      const has = (k) => (st.h[k] ?? []).filter(Boolean).length >= SMOOTH;
      st.face = face;
      st.name = nameOf(cs, s, face);
      // Too new to judge (smoothing needs its three frames): the person, named, no verdict yet.
      if (st.frames < WINDOW) {
        st.unsafe = false;
        st.missing = null;
        items.push(personBox(s, { color: INKS.person, tag: st.name, who: p }));
        continue;
      }
      const missing = ['Hardhat', 'Mask', 'Safety Vest'].filter((k) => !has(k));
      const bad = missing.length > 0 || ['NO-Hardhat', 'NO-Mask', 'NO-Safety Vest'].some(has);
      st.unsafe = bad;
      st.missing = missing;
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
  // MoveNet's 17 keypoints: the face's five (nose, eyes, ears) from the head
  // bone's own frame (+y up the head, +z the way it faces, +x its left), so
  // they fall with it; the other twelve at the joints.
  const FACE = { nose: [0, 0.12, 0.09], eyeL: [0.035, 0.15, 0.075], eyeR: [-0.035, 0.15, 0.075], earL: [0.075, 0.13, 0], earR: [-0.075, 0.13, 0] };
  const bonesOf = (fig) => {
    const sk = fig.mesh.skeleton;
    const g = (n) => sk.getBoneByName(n);
    return { head: g('head'), sl: g('upperarmL'), sr: g('upperarmR'), hl: g('thighL'), hr: g('thighR'), el: g('forearmL'), er: g('forearmR'), wl: g('handL'), wr: g('handR'), kl: g('shinL'), kr: g('shinR'), al: g('footL'), ar: g('footR') };
  };
  const SKELETON = [['nose', 'eyeL'], ['nose', 'eyeR'], ['eyeL', 'earL'], ['eyeR', 'earR'], ['nose', 'sl'], ['nose', 'sr'], ['sl', 'el'], ['el', 'wl'], ['sr', 'er'], ['er', 'wr'], ['sl', 'sr'], ['sl', 'hl'], ['sr', 'hr'], ['hl', 'hr'], ['hl', 'kl'], ['kl', 'al'], ['hr', 'kr'], ['kr', 'ar']];
  /** A person's 17 keypoints: in the world, and in `cam`'s picture (0..1, y down). */
  function poseOf(who, cam) {
    const bones = bonesOf(who.fig);
    const world = {};
    const img = {};
    for (const [k, bn] of Object.entries(bones)) {
      if (!bn || k === 'head') continue;
      world[k] = bn.getWorldPosition(new Vector3());
    }
    if (bones.head) {
      bones.head.updateWorldMatrix(true, false);
      for (const [k, o] of Object.entries(FACE)) world[k] = bones.head.localToWorld(new Vector3(...o));
    }
    for (const [k, w] of Object.entries(world)) {
      const p = w.clone().project(cam);
      img[k] = { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
    }
    return { world, img };
  }

  function fallFrame(r, cs, cam, seen) {
    // The one pose MoveNet returns: the person whose centre is nearest the
    // middle of the frame (its centre heatmap is weighted by distance from
    // it), a small, distant figure counting for less (less sure of it);
    // judged by the body as it is: standing, bent or lying.
    let best = null;
    let top = 0;
    for (const s of seen) {
      const pose = poseOf(s.who, cam);
      const xs = Object.values(pose.img).map((q) => q.x);
      const ys = Object.values(pose.img).map((q) => q.y);
      if (!xs.length) continue;
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const off = Math.hypot((x0 + x1) / 2 - 0.5, (y0 + y1) / 2 - 0.5);
      const sure = Math.min(1, Math.max(x1 - x0, y1 - y0) / 0.2);
      const w = sure / (0.1 + off);
      if (w > top) {
        top = w;
        best = { ...s, pose };
      }
    }
    cs.considered = seen.map((s) => s.who.name ?? s.who.id);
    if (!best) {
      cs.fall = null;
      cs.items = [];
      return;
    }
    const { world, img } = best.pose;
    if (!img.sl || !img.hl) return;
    const mid = (a, c) => ({ x: (img[a].x + img[c].x) / 2, y: (img[a].y + img[c].y) / 2 });
    const sh = mid('sl', 'sr');
    const hp = mid('hl', 'hr');
    const dx = sh.x - hp.x;
    const dy = sh.y - hp.y;
    const angle = (Math.atan2(Math.abs(dx), Math.abs(dy)) * 180) / Math.PI;
    const align = 1 - Math.min(2 * Math.abs(sh.y - hp.y), 1);
    // The body's height in the frame: its keypoints' extent, top to bottom.
    const ys = Object.values(img).map((q) => q.y);
    const height = Math.max(...ys) - Math.min(...ys);
    const low = (img.nose ?? sh).y > 0.88 || hp.y > 0.5;
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
  const alerts = alertQueue({ list: site.alerts, max: 20, cooldown: COOLDOWN, now: () => site.clock });
  function raise(type, r, title, severity, who = []) {
    const a = alerts.raise(`${type}_${r}`, () => {
      const cards = [];
      for (const p of who) {
        const st = camState[r].seen.get(p);
        if (type === 'ppe' && st?.missing?.includes('Hardhat')) cards.push(`Helmet missing · ${st.name}`);
        if (type === 'ppe' && st?.missing?.includes('Safety Vest')) cards.push(`Safety vest not detected · ${st.name}`);
        // Fall mode matches no faces: the card has no name.
        if (type === 'fall') cards.push('Man Fall Detected');
      }
      if (type === 'fire') cards.push('Fire Alarm');
      return { type, cam: r, title, severity, at: time(), clock: site.clock, file: `alert_${type}_${CAMS[r]?.name ?? r}_${stamp()}.jpg`, shot: snap(r), cards };
    });
    if (a) event(`${title} · ${CAMS[r]?.name ?? r} · screenshot to S3`);
    return !!a;
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
    const inShift = site.clock >= site.shift[0] && site.clock <= site.shift[1];
    if (now === 'in') {
      site.entries++;
      a.onSite = true;
      const logged = a.enrolled && inShift;
      site.lastEntry = { name: a.enrolled ? a.name : 'Unknown', logged, clock: site.clock, who: a };
      site.entryLog.push(site.lastEntry);
      if (site.entryLog.length > 12) site.entryLog.shift();
      if (logged) {
        const row = site.attendance.find((q) => q.name === a.name && !q.out) ?? { name: a.name, in: time(), out: null };
        if (!site.attendance.includes(row)) site.attendance.push(row);
        event(`entry · ${a.name} · attendance`);
      } else if (a.enrolled) event(`entry · ${a.name} · outside the shift, not logged`);
      else event('entry · Unknown · not logged');
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
      // Of a box about 1.8 m on the diagonal: moving more than 5% of it starts
      // the count again; someone marked idle is cleared once they move 8%.
      const limit = (a.idle ? IDLE_CLEAR : IDLE_MOVE) * 1.8;
      if (moved > limit) {
        a.idleAt = { x: a.pos.x, z: a.pos.y };
        a.stillFor = 0;
        a.idle = false;
      } else {
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
  // minutes here (the server keeps 12 h), to scrub back through and play
  // again. The camera's own H.264 is passed straight through: nothing is drawn
  // on the recording. Each segment notes whether a fall was on screen.
  const tape = new Evidence({ before: 0, after: 0, width: 256, height: 144 });
  const rec = { cam: 'cam03', t: 0, pos: 0, max: 90, want: null };
  function recordTick(dt) {
    if (card || !slot.engine) return;
    rec.t += dt * RATE;
    if (rec.t < SEGMENT) return;
    rec.t = 0;
    tape.cam = cams[rec.cam].cam;
    const reuse = tape.frames.length >= rec.max ? tape.frames.shift().c : null;
    tape.frames.push({ c: tape.shoot(slot, scene, reuse), t: site.clock, fall: !!camState[rec.cam].fall?.fallen });
    if (rec.want === 'fall') toTheFall();
  }
  /** The newest fall on the tape: the index of its first segment, or null. */
  function fallOnTape() {
    const f = tape.frames;
    let k = -1;
    for (let i = f.length - 1; i >= 0; i--) {
      if (f[i].fall) {
        k = i;
        break;
      }
    }
    if (k < 0) return null;
    while (k > 0 && f[k - 1].fall) k--;
    return k;
  }
  /** Scrub to a segment before the newest fall began (once a few segments of it are in). */
  function toTheFall() {
    const k = fallOnTape();
    const n = tape.frames.length;
    if (k == null || n - 1 - k < 3) return false;
    rec.pos = (n - 1 - Math.max(0, k - 1)) * SEGMENT;
    rec.fallAt = tape.frames[k].t;
    rec.want = null;
    return true;
  }
  const hhmm = (t) => `${String(Math.floor(t / 3600) % 24).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}`;
  const recPip = (g, w, h) => {
    const n = tape.frames.length;
    const i = Math.max(0, n - 1 - Math.round(rec.pos / SEGMENT));
    tape.drawFrame(g, w, h, i, { caption: `${CAMS[rec.cam].name} · ${rec.pos ? `−${Math.round(rec.pos)} s` : 'LIVE'} · 2 s segments`, bar: rec.pos ? '#fbbf24' : '#fb6f8a' });
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
        site.alerts.slice(0, 3).forEach((a, i) => {
          g.fillStyle = a.severity === 'critical' ? '#fb923c' : a.severity === 'high' ? '#fbbf24' : '#fb6f8a';
          g.fillRect(24, 204 + i * 44, 4, 34);
          g.fillStyle = '#e4e4e7';
          g.font = `500 14px ${FONT}`;
          g.fillText(a.title, 36, 220 + i * 44);
          g.fillStyle = '#8b8b94';
          g.font = `400 12px ${MONO}`;
          g.fillText(`${CAMS[a.cam]?.name} · ${a.at} · ${a.cards[0] ?? 'screenshot saved'}`, 36, 236 + i * 44);
        });
        // The log: what the product itself records (entries, enrolments, idle, models), newest last.
        g.fillStyle = '#e4e4e7';
        g.font = `600 15px ${FONT}`;
        g.fillText('Log', 24, 352);
        g.font = `400 12px ${MONO}`;
        g.fillStyle = '#8b8b94';
        site.feed.filter((l) => /\s(entry|exit|enrolled|idle) ·|model (loaded|unloaded)/.test(l)).slice(-3).forEach((l, i) => g.fillText(l.length > 52 ? `${l.slice(0, 51)}…` : l, 24, 374 + i * 20));
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
  /**
   * The worker a PPE chapter button acts on: wearing the item, in CAM-02's
   * picture, and staying there a while (at work with time left, or on the
   * scaffold), nearest the camera first; null if there's nobody.
   */
  function ppeTarget(item) {
    const cam = cams.cam02.cam;
    const list = subjects().filter((s) => s.who.role !== 'guard' && s.who.role !== 'supervisor' && inPicture(cam, s) && s.who.ppe?.[item] && !s.who.ppeFix && !director.busy(s.who));
    const near = (x) => cam.position.distanceTo(new Vector3(x.x, 1, x.z));
    // Someone at work with time left first (so the supervisor's hand-over
    // shows), then anyone walking, then a figure on the scaffold; nearest first.
    const rank = (p) => (!p.pos ? 2 : p.task?.act && p.task.secs - p.timer > 5 ? 0 : 1);
    const pick = list.sort((x, y) => rank(x.who) - rank(y.who) || near(x) - near(y))[0];
    return pick?.who ?? null;
  }
  function takeOff(item) {
    const w = ppeTarget(item);
    if (!w) return null;
    setPPE(w, item, false);
    // An agent is put right by the supervisor after the alert; a figure on the scaffold after a while.
    if (w.pos) w.ppeFix = { item, due: site.clock + 12, sent: false };
    else later(90, () => setPPE(w, item, true));
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
    // The camera scores one pose a frame, its most prominent person's, so the
    // one who slips is whoever it is watching (walking or at work), or, with
    // nobody in its picture, someone sent to the bench in the middle of it.
    // (Once a slip is under way, asking again is the same slip.)
    const already = people.find((p) => p.slipping);
    if (already) return already;
    siteModes(); // no camera in a combined mode sees it

    const aim = { x: cams.cam03.look.x, z: cams.cam03.look.z };
    const dist = (p) => Math.hypot(p.x - aim.x, p.z - aim.z);
    const watched = camState.cam03.fall?.who;
    const central = (p) => {
      const v = new Vector3(p.pos.x, 0.9, p.pos.y).project(cams.cam03.cam);
      return Math.hypot(v.x, v.y) < 0.5;
    };
    let w = watched && people.includes(watched) && watched.visible && watched.role === 'worker' && zones.ground_floor && inPoly(watched.pos.x, watched.pos.y, zones.ground_floor) && !director.busy(watched) && central(watched) ? watched : null;
    if (!w) {
      const k = ['blocks', 'mortar', 'blockwork', 'trestle'].filter((q) => spot(q) && b.crowd.free(q)).sort((x, y) => dist(spot(x)) - dist(spot(y)))[0] ?? 'mortar';
      const s = spot(k);
      w = director.cast(people, (p) => working(p), s);
      if (!w) return null;
      w.slipping = true;
      director.hire(director.redirect(w, (q) => {
        // Wherever the walk ends by the bench (a pace off counts).
        q.st.tasks.push(go(s, { claim: k }), { call: () => slipNow(q) });
      }), 'slip', 40);
      return w;
    }
    slipNow(w);
    return w;
  }
  function slipNow(w) {
    // Across CAM-03's picture, so the camera sees a body on the floor (lying
    // along its line of sight, a body foreshortens to look upright), for the
    // clips' own lengths.
    const cam = cams.cam03.cam.position;
    const dx = w.pos.x - cam.x;
    const dz = w.pos.y - cam.z;
    const across = Math.atan2(dz, -dx);
    const secs = (n, d) => ctx.people?.clips?.get(n)?.duration ?? d;
    director.hire(director.redirect(w, (q) => {
      hold(q, null);
      q.st.tasks.push(act('slip', secs('slip', 1.4), across, { claim: q.claim }), act('down', 7, across, { claim: q.claim }), act('getup', secs('getup', 1.8), across, { claim: q.claim }), { call: () => (q.slipping = false) });
    }), 'slip', 20);
    w.slipping = true;
    event('someone slips on the ground floor');
  }
  function ignite() {
    if (fire.phase === 'smoke' || fire.phase === 'fire') return;
    siteModes(); // no camera in a combined mode sees it
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
      // To the fire point for the extinguisher, then to the bin with it.
      q.st.tasks.push(go(e, { claim: 'extinguisher' }), act('fold', 1.2, e.face, { at: e, claim: 'extinguisher' }), go(by), act('point', 3, [bin.x, bin.z], { at: by }), { call: done });
      q.st.phase = 'work';
    }), 'fire', 30);
    return w;
  }
  function enrol() {
    if (!newStarter || newStarter.enrolled) return;
    newStarter.enrolled = true;
    newStarter.st.phase = 'work';
    site.enrolled++;
    for (const cs of Object.values(camState)) cs.seen.delete(newStarter);
    event(`enrolled · ${newStarterName} · photo uploaded, faces reloaded (${site.enrolled})`);
    // A newcomer's first job: the formwork, with a hammer (in CAM-02's view, facing it).
    director.redirect(newStarter, (q) => {
      const k = ['form_a', 'rebar_0'].find((x) => spot(x) && b.crowd.free(x, q));
      if (!k) return;
      const at = spot(k);
      q.st.tasks.push(go(at, { claim: k }), { call: () => hold(q, 'hammer'), at }, act('hammer', 14 + rand() * 6, at.face, { claim: k, at }));
    });
  }
  /** Someone clocks in at the gate: whoever is out on a run comes back now, or someone is sent out and straight back. */
  function clockIn() {
    const out = people.find((p) => p.role === 'worker' && !p.visible && p !== newStarter);
    if (out) {
      out.st.back = 0;
      return out;
    }
    const can = (q) => working(q) && q !== newStarter && !q.ppeFix && !q.slipping;
    const p = director.cast(people, (q) => can(q) && q.task?.act, spot('gate_in')) ?? director.cast(people, can, spot('gate_in'));
    if (!p) return null;
    director.hire(director.redirect(p, (q) => {
      hold(q, null);
      q.st.phase = 'out';
      q.st.tasks.push(go(spot('gate_out'), { via: true }), go(spot('gate_road_out'), { via: true }));
    }), 'gate', 60);
    p.st.back = 0.5; // back in a moment once through
    return p;
  }
  // A button pressed when nobody is free is kept for the first worker free in
  // the next 20 s (everyone may be on their way somewhere just then).
  const wanted = { idle: 0, clockin: 0 };
  const soon = (kind, fn) => fn() ?? ((wanted[kind] = site.clock + 20 * RATE), null);
  function wantedTick() {
    if (wanted.idle > site.clock && idleOne()) wanted.idle = 0;
    if (wanted.clockin > site.clock && clockIn()) wanted.clockin = 0;
  }
  function idleOne() {
    const w = director.cast(people, (p) => working(p) && p !== newStarter && p.task?.act, spot('yard_blocks'));
    if (!w) return null;
    director.hire(director.redirect(w, (q) => {
      q.st.phase = 'idle';
      q.st.idleFor = (IDLE_SECS + 60) / RATE;
    }), 'idle', (IDLE_SECS + 70) / RATE);
    return w;
  }

  // ---------------------------------------------------------------- chapters
  /** The feed's latest enrolment line (photo uploaded, faces reloaded), without its time. */
  const lastEnrol = () => site.feed.filter((l) => /enrolled ·/.test(l)).slice(-1)[0]?.replace(/^\S+\s+/, '') ?? null;
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
      // The site's own modes again on the way out: a combined mode is only ever a look.
      exit: () => siteModes(),
      readouts: () => [
        { label: 'Cameras', value: 4 },
        camReadout(selectedCam),
        { label: 'Mode', value: MODE_NAME[camState[selectedCam].mode], tone: 'turq' },
        { label: 'Frames', value: 'one every 2 s, each camera' },
        { label: 'Start-up', value: 'staggered 0, 2, 4 and 6 s' },
        { label: 'People in view', value: countInView(cams[selectedCam].cam, people) },
      ],
      actions: () => [
        ...Object.keys(CAMS).map((r) => ({ id: r, label: CAMS[r].name, pressed: r === selectedCam })),
        ...Object.keys(MODE_NAME).filter((m) => !COMBINED.has(m) || !hazard()).map((m) => ({ id: `mode_${m}`, label: MODE_NAME[m], pressed: camState[selectedCam].mode === m })),
      ],
      act(id) {
        if (CAMS[id]) {
          selectedCam = id;
          slot.chapters?.emit('pipcaption', `${CAMS[id].name} · ${CAMS[id].area}`);
        }
        if (id.startsWith('mode_')) {
          const m = id.slice(5);
          if (!MODE_NAME[m] || (COMBINED.has(m) && hazard())) return;
          setMode(selectedCam, m);
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
        // A combined mode runs the PPE check, with names.
        this.act('mode_all');
        run(4);
        const combined = camState.cam02.mode === 'all' && camState.cam02.items.some((i) => /PPE Compliant|Missing/.test(i.tag ?? ''));
        // Staging a fall puts every camera back in its own mode first.
        const w = slip();
        const restored = Object.entries(CAMS).every(([r, c]) => camState[r].mode === c.mode);
        for (let k = 0; k < 30 && !hazard(); k++) run(0.5);
        const down = hazard();
        const offered = this.actions().some((a) => COMBINED.has(a.id.slice(5)));
        this.act('mode_all');
        const refused = down && camState[selectedCam].mode !== 'all';
        for (let k = 0; k < 14 && hazard(); k++) run(1);
        this.act('mode_ppe');
        run(2);
        return [
          ['four cameras, each with its mode', Object.keys(cams).length === 4 && Object.values(camState).every((c) => c.mode), Object.entries(camState).map(([r, c]) => `${CAMS[r].name} ${c.mode}`).join(', ')],
          ['a camera can be chosen', pip?.camera === cams.cam02.cam],
          ['a frame each every 2 s', Math.abs(perFrame - FRAME) < 0.8, `${perFrame.toFixed(2)} s a frame`],
          ['its mode can be switched', switched],
          ['PPE+Fall and All run the PPE check', combined, `${camState.cam02.items.length} boxes`],
          ['a staged fall restores every camera’s own mode', !!w && restored],
          ['and the combined modes wait while someone is down', down && !offered && refused],
          ['its picture sees people', camState.cam02.checked > 0, `${camState.cam02.checked} checked`],
          ['no combined-mode camera ever sees a fire or a fall', !site.comboHazard, `${site.comboHazard ?? 0} frames`],
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
          { label: 'Detectors', value: `person ${PERSON_CONF.toFixed(2)} · crop +15% · PPE ${PPE_CONF.toFixed(2)}` },
          { label: 'Smoothing', value: `an item counts in ${SMOOTH} of the last ${WINDOW} frames` },
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
        // (The chapter's beat may have taken a hat already: that's the one to watch.)
        const w = people.find((p) => p.ppeFix?.item === 'hat' && p.visible) ?? takeOff('hat');
        // Until CAM-02 has judged them (three frames of them, two without the hat): up to 12 s.
        for (let k = 0; k < 12 && w && !camState.cam02.seen.get(w)?.missing?.includes('Hardhat'); k++) run(1);
        const st = w && camState.cam02.seen.get(w);
        const flagged = !!st?.unsafe && !!st.missing?.includes('Hardhat') && camState.cam02.items.some((i) => i.who === w && /Missing Hardhat/.test(i.tag));
        const tag = st?.missing ? `${st.name}: Missing ${st.missing.map((m) => SHORT[m]).join(', ')}` : 'nobody in view';
        const alerted = site.alerts.some((a) => a.type === 'ppe');
        // The supervisor comes over from wherever she is (the office, say), once
        // they're standing at work: up to 70 s.
        for (let k = 0; k < 70 && w && !w.ppe.hat; k++) run(1);
        const fixed = !!w && w.ppe.hat;
        run(3);
        const safe = !!w && !camState.cam02.seen.get(w)?.missing?.includes('Hardhat');
        const t = turnAway();
        run(4);
        const back = t && camState.cam02.seen.get(t);
        return [
          ['a missing hard hat is flagged, with the name', flagged, tag],
          ['and raises a PPE alert', alerted],
          ['the supervisor hands one over', fixed],
          ['and the box turns safe', safe],
          ['a mask the camera can’t see counts as missing', !t || (back?.missing?.includes('Mask') ?? true), back?.missing ? back.missing.join(', ') || 'none' : 'nobody to turn'],
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
          { label: 'Model', value: 'InsightFace (ArcFace), CLAHE first' },
          { label: 'A match', value: `similarity above ${MATCH.toFixed(2)}` },
          { label: 'Enrolled', value: site.enrolled },
          { label: 'At the gate now', value: named.length ? named.join(', ') : 'nobody facing it' },
          { label: 'New starter', value: newStarter?.enrolled ? `${newStarterName}, enrolled` : 'Unknown until enrolled', tone: newStarter?.enrolled ? 'turq' : 'amber' },
          ...(lastEnrol() ? [{ label: 'Last enrolment', value: lastEnrol() }] : []),
        ];
      },
      actions: () => (newStarter && !newStarter.enrolled ? [{ id: 'enrol', label: 'Enrol the new starter' }] : []),
      act(id) {
        if (id === 'enrol') enrol();
      },
      qa(run) {
        // Enrol them now if the guard hasn't already (the page opens with them walking in).
        if (newStarter && !newStarter.enrolled) {
          if (!newStarter.visible) run(4);
          run(6);
          this.act('enrol');
        }
        // Named by a camera since (maybe already, if the guard enrolled them earlier).
        let named = site.newStarterNamed != null;
        for (let k = 0; k < 60 && !named; k++) {
          run(1);
          named = site.newStarterNamed != null;
        }
        return [
          ['a worker not enrolled is Unknown', !!site.unknownSeen, site.unknownSeen ? `${newStarterName}'s face, before enrolment` : 'never seen'],
          ['enrolling adds their face', site.enrolled > 0 && newStarter?.enrolled, `${site.enrolled} enrolled`],
          ['and they are named from then on', named, named ? `by ${hhmm(site.newStarterNamed)}` : 'not yet'],
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
          // (Fall mode matches no faces: nobody is named here.)
          { label: 'Seen', value: 'one pose a frame, the most prominent person' },
        ];
      },
      actions: () => [{ id: 'slip', label: 'Someone slips' }],
      act(id) {
        if (id === 'slip') slip();
      },
      qa(run) {
        let w = slip();
        let peak = 0;
        let fallAlert = false;
        const instead = new Set(); // anyone scored in their place while they were down
        // Until they're back on their feet (a walk to the bench first, maybe).
        // One pose a frame: if someone else was the one scored, a second slip.
        for (let k = 0, tries = 1; k < 80 && (k < 4 || w?.slipping || (peak < FALL_AT && tries < 2 && (w = slip(), tries++, true))); k++) {
          run(1);
          const f = camState.cam03.fall;
          if (f?.who === w) peak = Math.max(peak, f.score);
          else if (f && w && ['down', 'slip'].includes(w.clip)) instead.add(f.who.name ?? f.who.id);
          fallAlert ||= site.alerts.some((a) => a.type === 'fall');
        }
        run(8);
        const after = camState.cam03.fall;
        return [
          ['a fall scores 4 or more of 6', peak >= FALL_AT, `peak ${peak}/6${instead.size ? ` (scored instead: ${[...instead].join(', ')})` : ''}`],
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
        // Someone fetches the extinguisher from the fire point and puts it out.
        for (let k = 0; k < 40 && fire.phase !== 'out'; k++) run(1);
        return [
          ['smoke and fire are found on the frame', seenSmoke],
          ['0.6 or more raises it, on one frame', alerted],
          ['put out, it clears', fire.phase === 'out' || fire.phase === 'none'],
        ];
      },
    },
    {
      id: 'alerts',
      pip: false,
      enter: () => setShow({}),
      exit() {
        this.pip = false;
      },
      readouts: () => {
        const last = site.alerts[0];
        return [
          ...site.alerts.slice(0, 3).map((a, i) => ({ label: `${a.at} ${CAMS[a.cam]?.name}`, value: a.title, tone: a.severity === 'critical' ? 'red' : a.severity === 'high' ? 'amber' : 'red', key: i })),
          { label: 'Cooldown', value: `${COOLDOWN} s per camera, per type (not per person)` },
          { label: 'Held back', value: `${alerts.suppressed} in cooldown` },
          { label: 'Evidence', value: `one JPEG an alert, boxes drawn, to S3 (link ${S3_DAYS} days)` },
          ...(last?.cards?.length ? [{ label: 'Dashboard card', value: last.cards.join(' · ') }] : []),
        ];
      },
      actions() {
        const shot = site.alerts.some((a) => a.shot);
        return [
          { id: 'burst', label: 'Two violations, back to back' },
          ...(shot ? [{ id: 'shot', label: this.pip ? 'Close the screenshot' : 'Open the screenshot', pressed: this.pip }] : []),
        ];
      },
      act(id) {
        if (id === 'burst') {
          takeOff('hat');
          later(2.7, () => takeOff('vest'));
        }
        if (id === 'shot') {
          const a = site.alerts.find((q) => q.shot);
          this.pip = !!a && !this.pip;
          slot.chapters?.emit('pip', this.pip);
          if (a) slot.chapters?.emit('pipcaption', `${a.file} · on S3, a link good for ${S3_DAYS} days`);
        }
      },
      qa(run) {
        const n0 = site.alerts.filter((a) => a.type === 'ppe' && a.cam === 'cam02').length;
        const s0 = alerts.suppressed;
        takeOff('hat');
        run(3);
        takeOff('vest');
        run(2);
        const n1 = site.alerts.filter((a) => a.type === 'ppe' && a.cam === 'cam02').length;
        const latest = site.alerts[0];
        const withCard = site.alerts.find((a) => a.type === 'ppe' && a.cards.length);
        this.act('shot');
        const opened = this.pip && ctx.slot.controller.pip()?.image === site.alerts.find((q) => q.shot)?.shot;
        this.act('shot');
        return [
          ['one alert a camera and type in 10 s', n1 - n0 <= 1 && alerts.suppressed > s0, `${n1 - n0} raised, ${alerts.suppressed - s0} held back`],
          ['each with a screenshot named for S3', !!latest && /^alert_\w+_CAM-0\d_\d{8}_\d{6}\.jpg$/.test(latest.file), latest?.file],
          ['the screenshot opens', opened || card],
          ['and the dashboard gets a card for each person', !!withCard, withCard?.cards.join(' · ')],
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
        { label: 'The fall', value: rec.fallAt != null ? `at ${hhmm(rec.fallAt)}, on the tape` : rec.want ? 'waiting for it on the tape' : 'none on the tape yet', tone: rec.fallAt != null ? 'amber' : 'grey' },
        { label: 'Kept here', value: `${Math.round(tape.frames.length * SEGMENT)} s (the server keeps ${REWIND_H} h)` },
        { label: 'Segments', value: `${SEGMENT} s, the camera’s H.264 passed through` },
        { label: 'Timelapse', value: 'a snapshot every 10 min, played at 24 fps' },
      ],
      actions: () => [
        ...Object.keys(CAMS).map((r) => ({ id: `rec_${r}`, label: CAMS[r].name, pressed: rec.cam === r })),
        { id: 'fall', label: 'Back to the fall' },
        { id: 'back', label: '−10 s' },
        { id: 'fwd', label: '+10 s' },
        { id: 'live', label: 'GO LIVE', pressed: !rec.pos },
      ],
      act(id) {
        if (id.startsWith('rec_')) {
          rec.cam = id.slice(4);
          tape.frames = [];
          rec.pos = 0;
          rec.want = null;
          rec.fallAt = null;
        }
        if (id === 'fall') {
          // CAM-03's tape (the fall camera): the newest fall on it, or the next one.
          if (rec.cam !== 'cam03') {
            rec.cam = 'cam03';
            tape.frames = [];
            rec.pos = 0;
          }
          if (!toTheFall()) {
            rec.want = 'fall';
            if (!people.some((p) => p.slipping)) slip();
          }
          return;
        }
        const kept = tape.frames.length * SEGMENT;
        if (['back', 'fwd', 'live'].includes(id)) rec.want = null;
        if (id === 'back') rec.pos = Math.min(Math.max(0, kept - SEGMENT), rec.pos + 10);
        if (id === 'fwd') rec.pos = Math.max(0, rec.pos - 10);
        if (id === 'live') rec.pos = 0;
      },
      qa(run) {
        run(12);
        const kept = tape.frames.length;
        this.act('back');
        const back = rec.pos;
        this.act('live');
        // Back to the fall: the tape shows a body on the floor, from a moment before.
        this.act('fall');
        let shown = false;
        for (let k = 0; k < 45 && !card; k++) {
          run(1);
          if (rec.pos > 0 && !rec.want) {
            const n = tape.frames.length;
            const i = Math.max(0, n - 1 - Math.round(rec.pos / SEGMENT));
            shown = tape.frames.slice(i, i + 3).some((f) => f.fall);
            break;
          }
        }
        const cam = rec.cam;
        this.act('live');
        return [
          ['the picture is kept in 2 s segments', kept >= 3 || card, `${kept} segments`],
          ['it scrubs back 10 s', back === 10 || kept < 6, `${back} s`],
          ['it goes back to the fall', card || (cam === 'cam03' && shown), rec.fallAt != null ? `the fall at ${hhmm(rec.fallAt)}` : 'none found'],
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
          { label: 'Shift', value: `${hhmm(site.shift[0])} to ${hhmm(site.shift[1])}${site.lastEntry ? ` · ${site.lastEntry.name} ${site.lastEntry.logged ? 'logged' : 'not logged'}` : ''}`, tone: site.lastEntry && !site.lastEntry.logged ? 'amber' : 'grey' },
        ];
      },
      actions: () => [{ id: 'idle', label: 'Someone stands idle' }, { id: 'clockin', label: 'Someone clocks in at the gate' }],
      act(id) {
        if (id === 'idle') soon('idle', idleOne);
        if (id === 'clockin') soon('clockin', clockIn);
      },
      qa(run) {
        let w = idleOne();
        for (let k = 0; k < 20 && !w; k++) run(1), (w = idleOne());
        for (let k = 0; k < 70 && w && !w.idle; k++) run(1);
        const idled = !!w?.idle;
        const still = w ? `${w.name}: ${Math.round(w.stillFor ?? 0)} s still` : 'nobody free';
        // A clock-in inside the shift is logged; with the shift over, it isn't.
        const entry = (who, since) => {
          for (let k = 0; k < 60 && who; k++) {
            run(1);
            const e = site.entryLog.find((q) => q.clock > since && q.who === who);
            if (e) return e;
          }
          return null;
        };
        const someone = () => {
          let c = clockIn();
          for (let k = 0; k < 20 && !c; k++) run(1), (c = clockIn());
          return c;
        };
        const missed = (who) => (who ? `${who.name} did not come in (${who.visible ? who.st.phase ?? 'on site' : 'off site'}, ${who.pos.x.toFixed(1)}, ${who.pos.y.toFixed(1)})` : 'nobody came in');
        const rows0 = site.attendance.length;
        const c1 = someone();
        const e1 = entry(c1, site.clock);
        const rows1 = site.attendance.length;
        const shift = site.shift;
        site.shift = [SHIFT[0], site.clock - 60];
        const c2 = someone();
        const e2 = entry(c2, site.clock);
        site.shift = shift;
        return [
          ['a clock-in inside the shift is logged', !!e1?.logged && rows1 >= rows0, e1 ? `${e1.name}, ${hhmm(e1.clock)}` : missed(c1)],
          ['one outside the shift is not', !!e2 && !e2.logged, e2 ? `${e2.name}, after the shift` : missed(c2)],
          ['standing still 120 s marks a worker idle', idled, still],
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
          { label: 'ONNX export benchmark', value: `YOLOv8s: ${Math.round(BENCH.torch)} → ${Math.round(BENCH.onnx)} ms (${(BENCH.torch / BENCH.onnx).toFixed(2)}×)` },
          { label: 'Test alerts', value: site.tests || site.testsHeld ? `${site.tests} sent${site.testsHeld ? `, ${site.testsHeld} held back (cooldown)` : ''}` : 'none yet' },
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
          // Through the same pipeline: a second one inside 10 s is held back.
          if (raise('test', 'cam01', 'TEST ALERT', 'medium', [])) site.tests++;
          else site.testsHeld = (site.testsHeld ?? 0) + 1;
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
          ['over the whole run, no combined-mode camera saw a fire or a fall', !site.comboHazard, `${site.comboHazard ?? 0} frames`],
        ];
      },
    },
  ];
  const SHOTS = {
    cameras: { zoom: 0.96, pitch: 0.06 },
    ppe: { target: [-3.4, 0.8, 1.9], zoom: 0.55, yaw: -0.12 },
    faces: { target: [5.2, 0.9, -0.4], zoom: 0.46, yaw: 0.22 },
    falls: { target: [-3.6, 0.7, -2.3], zoom: 0.5, yaw: -0.08, pitch: 0.06 },
    // (Turned left of the gate hut, which would hide the bin.)
    fire: { target: [3.8, 0.8, -3.0], zoom: 0.48, yaw: -0.45 },
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
    later(42, () => extinguish());
    return null;
  });

  const clickables = [];
  // Each camera can be clicked: its own node where Blender exported one,
  // otherwise an invisible target on its mount.
  const camPickGeo = new SphereGeometry(0.22, 10, 8);
  for (const r of Object.keys(CAMS)) {
    let m = stage.byName.get(`cam_${r}`);
    if (!m && cams[r]) {
      m = new Mesh(camPickGeo, pickMat);
      m.position.copy(cams[r].pos);
      scene.add(m);
    }
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
    // Workers are on site all day: QA counts the districts each works in over a run, not a visit.
    roles: { customer: 'worker', staff: ['supervisor', 'guard'], resident: true },
    site,
    camState, // what each camera's pipeline saw last (QA reads it)
    director,
    onChapter: (id) => director.enter(id),
    // What each tour chapter's beat is for, as QA times it (qa.beatQA).
    beatMeter: {
      ppe: { state: () => camState.cam02.items.some((i) => /Missing/.test(i.tag ?? '')) },
      falls: { state: () => !!camState.cam03.fall?.fallen },
      fire: { state: () => fire.phase === 'smoke' || fire.phase === 'fire' },
    },
    demo: {
      // Per chapter, what to press (and how long to let it play) before its shot.
      shots: {
        cameras: [['cam02', 800], ['mode_all', 3500]],
        ppe: [['hat', 5000]],
        faces: [['enrol', 5000]],
        falls: [['slip', 6000]],
        fire: [['ignite', 7000]],
        alerts: [['burst', 4000], ['shot', 1500]],
        playback: [['fall', 12000]],
        productivity: [['clockin', 14000]],
        office: [['model_fire', 1500], ['test', 1500]],
      },
      // The case study, walked through for the recording.
      record: [
        ['chapter', 'cameras', 3000], ['act', 'cam01', 2500], ['act', 'cam03', 2500], ['act', 'cam04', 2500], ['act', 'cam02', 2000], ['act', 'mode_all', 3500], ['act', 'mode_ppe', 2000],
        ['chapter', 'ppe', 3000], ['act', 'hat', 9000], ['act', 'turn', 6000],
        ['chapter', 'faces', 4000], ['act', 'enrol', 6000],
        ['chapter', 'falls', 2500], ['act', 'slip', 10000],
        ['chapter', 'fire', 2500], ['act', 'ignite', 8000], ['act', 'out', 7000],
        ['chapter', 'alerts', 3000], ['act', 'burst', 5000], ['act', 'shot', 3000], ['act', 'shot', 1000],
        ['chapter', 'playback', 2500], ['act', 'fall', 12000], ['act', 'back', 3000], ['act', 'live', 2000],
        ['chapter', 'productivity', 3000], ['act', 'clockin', 14000], ['act', 'idle', 16000],
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
      runTimers();
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
      if ((unstickT -= dt) <= 0) {
        unstickT = 1;
        unstick();
        wantedTick();
      }
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
        a.backAt = site.clock;
        const arriving = a === newStarter && !a.enrolled;
        a.st = { tasks: [go(spot('gate_road_in'), { via: true }), go(spot('gate_in'), { via: true })], phase: arriving ? 'arriving' : 'work' };
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
      timers = [];
      b.dispose();
      rings.dispose?.();
      for (const P of [flames, smoke, sparks]) P.dispose();
      dash.dispose();
      dashPlane?.geometry.dispose();
      dashPlane?.removeFromParent();
      pickGeo.dispose();
      camPickGeo.dispose();
      for (const m of clickables) if (m.geometry === camPickGeo) m.removeFromParent();
      pickMat.dispose();
    },
  };
}
