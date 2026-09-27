/**
 * 01 Retail Analytics: the store, running.
 *
 * A small simulation of the boutique Blender built (scripts/blender/scenes/
 * retail-analytics.py), measured the way the platform measures a real store
 * (Buttons/README.md): shoppers come in off the street, cross the entrance
 * line, browse, try things on, queue and pay, and leave; staff work the till,
 * the floor and the stockroom. Every chapter shows one feature of the product
 * operating on that simulation: counts come from real line crossings, dwell
 * from real time in a zone, the heatmap from where people actually stood.
 * Numbers that are properties of the product (till-match confidence, the
 * TensorRT speed-up, throughput) are the measured ones from its docs.
 */
import { Box3, CylinderGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Ray, Vector3 } from 'three';

import { Coverage } from '../overlays/coverage.js';
import { Dashboard } from '../overlays/dashboard.js';
import { confidence, drawDetections } from '../overlays/detect2d.js';
import { HeatMap, Trails, Zone } from '../overlays/floor.js';
import { Rings } from '../overlays/rings.js';
import { GLOW, OVERLAY_LAYER } from '../overlays/lines.js';
import { resolveOutfit } from '../people.js';
import { Director } from '../sim/director.js';
import { Districts } from '../sim/spread.js';
import { footprint, inPoly } from '../sim/grid.js';
import { base } from './base.js';
import { livingSet } from './retail-living.js';

// ---------------------------------------------------------------- measured facts (docs)
// Till matching: LIMITATIONS.md, "Situation at the till".
const MATCH = { 1: 87, 2: 46, 4: 24 };
const TENSORRT = 2.4; // x faster, 0 of 7 test clips changed count
const STREAMS = 6;
const AGG_FPS = 143; // aggregate, six streams, laptop RTX 3050 Ti
// Zone.loiter_seconds is per zone; this store's fitting area: well past a
// try-on (8 to 12 s in a booth, with the walk in and a wait for a free one).
const LOITER_SECS = 30;
// cv_pipeline/modules/camera_health.py: a fault is raised after 30 s of it and
// cleared after 20 s without it.
const HEALTH_RAISE = 30;
const HEALTH_CLEAR = 20;
// entry_exit/processor.py STATIC_SECONDS: a track that hasn't moved in 240 s
// is ended as a static object (a mannequin), out of dwell, heat and occupancy.
const STATIC_SECS = 240;
// security/clips.py: an alert's evidence clip, 5 s before and 8 s after, 6 fps.
const CLIP_BEFORE = 5;
const CLIP_AFTER = 8;
const CLIP_FPS = 6;
// aggregates.py walkout_summary: a till visit of 20 s or more with no sale.
const WALKOUT_SECS = 20;

const ROLE_COLOR = {
  entrance: '#06d6a0',
  checkout: '#8b5cf6',
  floor: '#f59e0b',
  stockroom: '#a1a1aa',
  staff_only: '#f0506e',
  perimeter: '#5eead4',
};
const ROLE_LABEL = {
  entrance: 'Entrance · footfall is counted here',
  checkout: 'Checkout · sales are matched here',
  floor: 'Floor · browsing, dwell, heatmaps',
  stockroom: 'Stockroom · back of house',
  staff_only: 'Staff only · tells staff from customers',
  perimeter: 'Perimeter · watched outside trading hours',
};

const OUTFITS = [
  { top: '#3f6f5d', bottom: '#2b2d33' }, { top: '#c9b79c', bottom: '#3a3530' }, { top: '#6f7f94', bottom: '#2d3340' },
  { top: '#a35d4f', bottom: '#23262d' }, { top: '#e9e4da', bottom: '#4c5d78' }, { top: '#8a5a44', bottom: '#2e3238' },
  { top: '#d8b4a0', bottom: '#33383f' }, { top: '#4d5a6b', bottom: '#3a3530' }, { top: '#7a1f2b', bottom: '#1f2126' },
];
const SKINS = ['#e2b79a', '#b98463', '#7d543b', '#d9a98b'];
const HAIRS = ['#221c19', '#3b2a20', '#5a3a22', '#141111', '#6b4a2e'];

function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

const cross = (ax, az, bx, bz) => ax * bz - az * bx;
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export async function create(ctx) {
  const { stage, labels, context, slot } = ctx;
  const data = stage.data;
  const b = base(ctx);
  const rand = rng(ctx.seed ?? 1234);
  const scene = stage.scene;
  const card = context !== 'case';

  // ---------------------------------------------------------------- places
  const spot = (name) => {
    const s = data.spots?.[name];
    return s ? { x: s.at[0], z: s.at[2], face: ((s.face ?? 0) * Math.PI) / 180 } : null;
  };
  const rails = ['rail_a', 'rail_b'].map((n) => stage.byName.get(n)).filter(Boolean);
  const hasTable2 = !!data.spots?.table_2;
  const drags = new Map(rails.map((r) => [r, b.draggable(r.name, { onChange: (st) => st === 'placed' && ctx.emit('rail', 'moved') })]));
  /**
   * Browse spots either side of a rail, wherever it has been dragged: half a
   * metre out (an arm's reach to the clothes), and only a side there's room
   * to stand at (not the side hard against a wall or another fixture).
   */
  const railSpots = (r) => {
    const th = r.rotation.y;
    const nx = Math.sin(th);
    const nz = Math.cos(th);
    return [1, -1]
      .map((s) => ({ x: r.position.x + nx * 0.5 * s, z: r.position.z + nz * 0.5 * s, look: [r.position.x, r.position.z], key: `${r.name}:${s}` }))
      .filter((q) => !b.grid || b.grid.free(q.x, q.z));
  };
  const zones = Object.fromEntries(
    Object.entries(data.zones ?? {}).map(([k, pts]) => [k, new Zone(scene, { points: pts.map((p) => [p[0], p[2]]), color: k === 'fitting' ? '#f59e0b' : '#8b5cf6', opacity: 0.13 })])
  );
  const line = (() => {
    const l = data.lines?.entrance ?? [[1.6, 0, -0.5], [1.6, 0, 0.3]];
    return { a: [l[0][0], l[0][2]], b: [l[1][0], l[1][2]] };
  })();
  // Just above the mats and rugs, below the shadow catcher's floor.
  const heat = new HeatMap(scene, b.grid, { y: 0.012 });
  const trails = new Trails(scene, { max: 16, len: 60, every: 0.12 });
  // People are marked one of two ways, chapter by chapter: flat camera-style
  // boxes where detection is the story, soft floor rings where a place is.
  const rings = new Rings(scene);
  let detections = [];
  // The boxes' colours, as the dashboard draws them.
  const INK = { turq: '#2ee6b4', grey: '#b4b4bd', amber: '#fbbf24', red: '#fb6f8a', violet: '#a78bfa' };
  const inkOf = (c) => (c === GLOW.turq ? INK.turq : c === GLOW.amber ? INK.amber : c === GLOW.red ? INK.red : c === GLOW.violet ? INK.violet : INK.grey);
  // Hidden from the main view (behind racking, in a booth): the tracker keeps
  // the ID, the box goes dashed. Tested a few times a second against the
  // set's tall pieces (Blender exports their boxes), not every triangle.
  // Only pieces wide enough to hide someone (walls, racking, booths), not posts.
  const occluders = (data.occluders ?? []).filter(([lo, hi]) => Math.max(hi[0] - lo[0], hi[2] - lo[2]) >= 0.5).map(([lo, hi]) => new Box3(new Vector3(...lo), new Vector3(...hi)));
  const hiddenNow = new Map();
  let occClock = 0;
  const ray = new Ray();
  const hit = new Vector3();
  function occluded(a, camera) {
    if (curtained(a)) return true;
    if (!occluders.length) return false;
    const s = a.fig.root.scale.x;
    let hidden = true;
    for (const y of [0.9 * s, 1.4 * s]) {
      const p = new Vector3(a.pos.x, y, a.pos.y);
      ray.origin.copy(camera.position);
      ray.direction.subVectors(p, camera.position);
      const far = ray.direction.length();
      ray.direction.normalize();
      if (!occluders.some((box) => box.containsPoint(p) === false && ray.intersectBox(box, hit) && hit.distanceTo(camera.position) < far - 0.05)) hidden = false;
    }
    return hidden;
  }

  // The back-office monitor shows the live dashboard.
  // Drawn on a plane of its own, the size of the screen Blender modelled and
  // just in front of it: a box's face UVs would turn the picture sideways.
  const dash = new Dashboard();
  const screen = stage.byName.get('dashboard_screen');
  let dashPlane = null;
  if (screen) {
    screen.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(screen);
    const size = box.getSize(new Vector3());
    const c = box.getCenter(new Vector3());
    dashPlane = new Mesh(new PlaneGeometry(Math.max(size.x, size.z), size.y), dash.material);
    // The screen faces the shop floor: +z, or +x if it hangs on a side wall.
    const facingX = size.x < size.z;
    dashPlane.position.copy(c);
    if (facingX) {
      dashPlane.rotation.y = Math.PI / 2;
      dashPlane.position.x += size.x / 2 + 0.002;
    } else dashPlane.position.z += size.z / 2 + 0.002;
    scene.add(dashPlane);
    screen.visible = false;
  }

  // The store's living set: the clock, the booth lamps, the till, the denim
  // wall's stacks, what people carry, the pigeons outside.
  const living = livingSet({ stage, scene, rand: rng(4242) });

  // The store's own cameras, for the camera chapter's picture-in-picture.
  const WALL_MOUNTED = new Set(['perimeter', 'staff_only']);
  const cams = Object.fromEntries(
    Object.entries(data.cameras ?? {}).map(([role, c]) => {
      const cam = new PerspectiveCamera(c.fov ?? 70, 16 / 9, 0.05, 30);
      // The picture comes from the lens, not the mount: a dome's lens sits
      // inside its shell, a wall camera's at the end of its 33 cm body
      // (scripts/blender/scenes/retail-analytics.py puts both kinds up).
      const wall = (c.mount ?? (WALL_MOUNTED.has(role) ? 'wall' : 'dome')) === 'wall';
      const f = new Vector3(...c.look).sub(new Vector3(...c.pos)).normalize();
      cam.position.set(...c.pos).addScaledVector(f, wall ? 0.36 : 0.12);
      cam.lookAt(new Vector3(...c.look));
      cam.updateMatrixWorld();
      return [role, { cam, pos: new Vector3(...c.pos), look: new Vector3(...c.look) }];
    })
  );

  // ---------------------------------------------------------------- camera health
  // Each camera's fault, as camera_health.py sees it: covered (the picture
  // goes flat), knocked (the scene no longer matches its layout), blurred.
  const health = Object.fromEntries(Object.keys(cams).map((r) => [r, { fault: null, t: 0, raised: false, clear: 0 }]));
  const camRest = Object.fromEntries(Object.entries(cams).map(([r, c]) => [r, c.cam.quaternion.clone()]));
  const camMesh = (r) => stage.byName.get(`cam_${r}`);
  const meshRest = Object.fromEntries(Object.keys(cams).map((r) => [r, camMesh(r)?.quaternion.clone()]));
  const FAULT = { occluded: 'covered', moved: 'knocked', defocused: 'blurred' };
  function setFault(role, kind) {
    const h = health[role];
    if (!h) return;
    h.fault = kind;
    h.t = 0;
    h.clear = 0;
    const cam = cams[role].cam;
    cam.quaternion.copy(camRest[role]);
    const m = camMesh(role);
    if (m && meshRest[role]) m.quaternion.copy(meshRest[role]);
    if (kind === 'moved') {
      // Knocked: turned off its aim, as a bump with a ladder would.
      cam.rotateY(0.5);
      cam.rotateX(-0.15);
      m?.rotateY(0.5);
    }
    cam.updateMatrixWorld();
    event(kind ? `camera ${role.replace('_', ' ')} ${FAULT[kind]}` : `camera ${role.replace('_', ' ')} put right`);
  }
  function healthTick(dtStore) {
    for (const [role, h] of Object.entries(health)) {
      if (h.fault) {
        h.t += dtStore;
        if (!h.raised && h.t >= HEALTH_RAISE) {
          h.raised = true;
          store.faults.push({ role, kind: h.fault, at: time() });
          event(`camera_health · ${role.replace('_', ' ')} · ${h.fault} · its counts marked suspect`);
        }
      } else if (h.raised) {
        h.clear += dtStore;
        if (h.clear >= HEALTH_CLEAR) {
          h.raised = false;
          event(`camera_health · ${role.replace('_', ' ')} · clear`);
        }
      }
    }
  }
  const healthText = (role) => {
    const h = health[role];
    if (!h) return 'ok';
    if (h.fault && h.raised) return `${h.fault} · raised`;
    if (h.fault) return `${h.fault}? ${Math.floor(h.t)} of ${HEALTH_RAISE} s`;
    if (h.raised) return `clearing · ${Math.floor(h.clear)} of ${HEALTH_CLEAR} s`;
    return 'ok';
  };

  // ---------------------------------------------------------------- mannequins
  // The window's dress forms look like people to a detector: each gets a
  // track that never moves, ended after STATIC_SECS as a static object
  // (and, left alone, picked up again later as a new track). An IGNORE zone
  // drawn round the display stops them being detected at all.
  const mannequins = ['mannequin_0', 'mannequin_1'].map((n) => stage.byName.get(n)).filter(Boolean).map((o, i) => ({ o, id: null, age: 150 + i * 20, ended: false, gone: 0 }));
  let ignoreZone = false;
  function mannequinTick(dtStore) {
    for (const m of mannequins) {
      if (ignoreZone) continue;
      if (!m.id) m.id = store.nextId++;
      if (!m.ended) {
        m.age += dtStore;
        if (m.age >= STATIC_SECS) {
          m.ended = true;
          m.gone = 0;
          event(`track ended · ID ${m.id} · static_object`);
        }
      } else {
        m.gone += dtStore;
        if (m.gone >= 90) {
          m.ended = false;
          m.age = 0;
          m.id = store.nextId++;
        }
      }
    }
  }
  const displayBox = (() => {
    if (!mannequins.length) return null;
    const bx = new Box3();
    for (const m of mannequins) bx.expandByObject(m.o);
    bx.expandByScalar(0.12);
    return bx;
  })();

  // ---------------------------------------------------------------- evidence clips
  // The camera that saw an alert, 6 frames a second, 5 s before and 8 s
  // after, replayed in the picture-in-picture for the reviewer.
  const clip = { cam: null, frames: [], recording: false, until: 0, play: null, flagAt: 0 };
  const clipCanvas = () => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 144;
    return c;
  };
  let clipClock = 0;
  function recordClip(dt) {
    if (!clip.recording || !clip.cam || !slot.engine) return;
    clipClock += dt;
    if (clipClock < 1 / CLIP_FPS) return;
    clipClock = 0;
    const c = clip.frames.length >= (CLIP_BEFORE + CLIP_AFTER) * CLIP_FPS ? clip.frames.shift().c : clipCanvas();
    const g = c.getContext('2d');
    clip.cam.aspect = 16 / 9;
    clip.cam.updateProjectionMatrix();
    slot.engine.drawView(scene, clip.cam, g, c.width, c.height, { blur: false, cctv: 1, vignette: 0.55, sat: 1 });
    // The flagged person's box, as the product draws it on the clip.
    const who = clip.who;
    if (who?.visible) drawDetections(g, c.width, c.height, clip.cam, [{ x: who.pos.x, z: who.pos.y, yaw: who.heading, height: 1.52, color: INK.red, tag: 'concealment?', alpha: 1 }], { px: c.width / 520 });
    clip.frames.push({ c, t: director.time });
    // Keep only the 5 s before the flag until it happens; then 8 s after.
    if (!clip.flagAt) while (clip.frames.length > CLIP_BEFORE * CLIP_FPS) clip.frames.shift();
    if (clip.flagAt && director.time > clip.flagAt + CLIP_AFTER) clip.recording = false;
  }

  // ---------------------------------------------------------------- store state
  const store = {
    entries: 0, exits: 0, sales: 0, parties: 0, partiesBought: 0, visits: 0,
    series: [], bucket: 0, bucketClock: 0,
    feed: [],
    dwell: {}, // zone -> { sum, n }
    converted: 0, short: 0,
    alerts: [],
    afterHours: false,
    tensorrt: true,
    lastMatch: null,
    nextId: 1,
    clock: 9 * 3600 + 41 * 60, // the store clock: 09:41, mid-morning
    naive: 0, // what a counting line with no hysteresis would have counted
    anchor: 0, // occupancy re-anchored to the floor camera
    faults: [], // camera_health events
    tillVisits: [], // seconds at the till, each visit
    longVisits: 0, // till visits of 20 s or more
    walkouts: 0, // ... of them with no sale
    unattended: { now: 0, episodes: 0 },
    coverGap: 0, // store seconds with nobody at the register
    nextArrival: 0, // director time before which nobody new comes in (one at a time)
    nextExit: 0, // ... nobody else heads out
  };
  const time = () => {
    const t = store.clock;
    return `${String(Math.floor(t / 3600) % 24).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}`;
  };
  const event = (text) => {
    store.feed.push(`${time()}  ${text}`);
    if (store.feed.length > 30) store.feed.shift();
  };

  // ---------------------------------------------------------------- people
  // A pick target for clicking a person: the skinned mesh is costly to raycast.
  const pickGeo = new CylinderGeometry(0.22, 0.22, 1.5, 10);
  const pickMat = new MeshBasicMaterial({ visible: false });
  const cast = data.cast ?? [];
  const people = [];
  let partyLeader = null;
  // Customers are tracked by ID; passers-by on the pavement are people the
  // cameras see too, but never visitors (they never cross the line). Staff
  // are enrolled: recognised, and left out of every customer count.
  const STAFF = new Set(['cashier', 'staff', 'stock', 'manager']);
  const isStaffRole = (r) => STAFF.has(r);
  // Where people don't go: customers stay out of the staff and stock rooms,
  // the office, the alley and behind the counter; passers-by stay on the
  // pavement (they never cross the line, so they are never visitors).
  const BACK_OF_HOUSE = [[0, -3.8], [3.25, -3.8], [3.25, -1.12], [0, -1.12]];
  const OFFICE_X1 = 1.3; // the office's east partition (Blender OFFICE_X): the stock room beyond
  const BEHIND_COUNTER = [[-5.7, 0.2], [-4.9, 0.2], [-4.9, 2.4], [-5.7, 2.4]];
  const INDOORS = [[-5.7, -3.8], [3.25, -3.8], [3.25, 3.8], [-5.7, 3.8]];
  const keepOutFor = (role) => (role === 'passer' ? [INDOORS] : isStaffRole(role) ? null : [BACK_OF_HOUSE, BEHIND_COUNTER]);
  for (const [i, entry] of cast.entries()) {
    const role = entry.role ?? 'shopper';
    // A shirt on its hanger (to the fitting room, or back to a rail) and, for
    // shoppers, a bag once they have paid: made with the figure, shown when needed.
    const extra = role === 'shopper' ? ['garment', 'bag'] : role === 'staff' ? ['garment', 'phone'] : [];
    const withCarry = { ...entry, carry: [...new Set([...(entry.carry ?? []), ...extra])] };
    // Everyone walks at their own pace (0.58 to 0.78 m/s): the quicker overtake.
    const pace = role === 'passer' ? 0.72 + rand() * 0.06 : role === 'shopper' ? 0.58 + rand() * 0.2 : 0.66 + rand() * 0.08;
    const a = b.agent(withCarry, { think: (ag) => brain(ag), fixed: role === 'cashier', speed: pace });
    a.fig.root.getObjectByName('garment') && (a.fig.root.getObjectByName('garment').visible = false);
    for (const piece of ['bag', 'phone']) {
      const o = !(entry.carry ?? []).includes(piece) && a.fig.root.getObjectByName(piece);
      if (o) o.visible = false;
    }
    a.role = role;
    a.keepOut = keepOutFor(role);
    a.party = entry.party ?? null;
    a.material = a.fig.material;
    a.track = isStaffRole(role) ? null : store.nextId++;
    a.staffId = isStaffRole(role) ? `S-0${people.filter((p) => isStaffRole(p.role)).length + 1}` : null;
    a.consent = isStaffRole(role);
    a.entered = role === 'shopper' ? 0 : null;
    a.midVisit = role === 'shopper'; // the page opens part way through their visit
    // Those already in the store came in over the last few minutes (store
    // time), not all at once: they leave at their own pace, the longest-in
    // first (the page opens on a busy moment; the store settles to its usual
    // few, one leaving at a time).
    a.visitStart = store.clock - 60 * (1 + rand() * 6);
    a.st = { tasks: [], phase: initialPhase(entry, role) };
    if (a.party) {
      if (!partyLeader) partyLeader = a;
      a.leader = partyLeader;
    }
    if (role === 'stock') a.walkClip = 'carry';
    // Someone who starts at the till or in the line already holds that place.
    const holds = { pay: 'pay', queue: 'queue_0' }[entry.clip];
    if (holds) {
      b.crowd.claims.set(holds, a);
      a.claim = holds;
    }
    // Carry on with what the page opened on for a few seconds (each their
    // own few), so the store doesn't all set off at once.
    if (!holds && entry.clip && !['walk', 'carry', 'pay', 'queue', 'tryon'].includes(entry.clip) && role !== 'passer' && role !== 'cashier') {
      a.st.tasks.push({ act: entry.clip, secs: 4 + rand() * 12, face: a.heading, opening: true });
    }
    const proxy = new Mesh(pickGeo, pickMat);
    proxy.position.y = 0.75;
    proxy.userData.pick = 'click';
    proxy.userData.agent = a;
    a.fig.root.add(proxy);
    a.proxy = proxy;
    people.push(a);
    void i;
  }
  const shoppers = () => people.filter((p) => p.role === 'shopper' && p.visible);
  // A boutique this size (about 35 m² of shop floor, fixtures and staff in it)
  // is busy with eight customers at once, and crowded past it: nobody new
  // comes along until someone leaves, nor while every part of the floor is
  // taken. (A family counts as the people in it.)
  const MAX_INSIDE = 8;
  const customersIn = () => people.filter((p) => p.role === 'shopper' && p.visible && p.st?.phase !== 'exiting').length;
  const roomFor = (a) =>
    customersIn() + (a.party && a === a.leader ? people.filter((p) => p.leader === a).length : 1) <= MAX_INSIDE &&
    districts.defs.some((d) => d.browse && d.cap > d.groups && (!a.party || d.party));
  const staff = () => people.filter((p) => isStaffRole(p.role));
  const insideStore = (a) => a.side === 'in';
  // Staff whose consent was withdrawn are no longer recognised: to the
  // platform they are just another visitor.
  const counted = (a) => a.visible && (!isStaffRole(a.role) || !a.consent);

  // An intruder for the security chapter: hidden until after hours.
  const intruder = b.agent({ body: 'body_b', hair: 'short', outfit: { top: '#2a2d33', bottom: '#1e1f24', skin: '#b98463', hair: '#141111' }, clip: 'idle', at: [2.4, 0, -1.6] }, { think: (ag) => brain(ag) });
  intruder.role = 'intruder';
  intruder.visible = false;
  intruder.fig.root.visible = false;
  intruder.st = { tasks: [], phase: 'hidden' };
  intruder.track = null;

  function initialPhase(entry, role) {
    if (role === 'passer') return 'stroll';
    if (role !== 'shopper') return role;
    if (entry.clip === 'pay') return 'paying';
    if (entry.clip === 'queue') return 'queued';
    if (entry.clip === 'tryon') return 'fitting';
    return 'browse';
  }

  // ---------------------------------------------------------------- the store's moving parts
  // The automatic doors slide apart as someone comes near (and stay shut
  // after hours); each fitting booth's curtain draws shut while someone tries
  // something on; the shutter rolls down at closing.
  const doorIn = spot('door_in');
  const doorOut = spot('door_out');
  const doorAt = doorIn && doorOut ? { x: (doorIn.x + doorOut.x) / 2, z: (doorIn.z + doorOut.z) / 2 } : null;
  const leaves = ['door_l', 'door_r'].map((n) => stage.byName.get(n)).filter(Boolean);
  const leafHome = leaves.map((l) => l.position.clone());
  const leafDir = leaves.map((l) => (doorAt ? Math.sign(l.position.z - doorAt.z) || 1 : 1));
  const leafSlide = leaves.length === 2 ? Math.abs(leafHome[0].z - leafHome[1].z) * 0.95 : 0;
  let doorOpen = 0;
  const booths = [0, 1, 2].map((i) => ({ curtain: stage.byName.get(`booth_${i}_curtain`), spot: spot(`fit_${i}`), k: 0.26 })).filter((q) => q.curtain && q.spot);
  const shutter = stage.byName.get('shutter_curtain');
  let shutterK = shutter?.scale.y ?? 0.03;
  /** Is someone in a booth with its curtain drawn (the cameras can't see them)? */
  const curtained = (a) => booths.some((q) => q.k > 0.8 && Math.hypot(a.pos.x - q.spot.x, a.pos.y - q.spot.z) < 0.4);
  function moveParts(dt) {
    const ease = (k, want, rate) => k + (want - k) * (1 - Math.exp(-dt * rate));
    if (doorAt && leaves.length === 2) {
      const someone = !store.afterHours && people.concat(intruder).some((p) => p.visible && Math.hypot(p.pos.x - doorAt.x, p.pos.y - doorAt.z) < 1.3);
      doorOpen = ease(doorOpen, someone ? 1 : 0, someone ? 7 : 3.5);
      leaves.forEach((l, i) => {
        l.position.copy(leafHome[i]);
        l.position.z += leafDir[i] * doorOpen * leafSlide;
      });
    }
    booths.forEach((q, i) => {
      const inside = people.some((p) => p.visible && p.clip === 'tryon' && Math.hypot(p.pos.x - q.spot.x, p.pos.y - q.spot.z) < 0.4);
      q.k = ease(q.k, inside ? 1 : 0.26, 4);
      q.curtain.scale.x = q.k;
      // Taken from when someone heads in until they come out.
      living.booth(i, inside || people.some((p) => p.visible && p.claim === `fit_${i}`));
    });
    if (shutter) {
      shutterK = ease(shutterK, store.afterHours ? 1 : 0.03, store.afterHours ? 1.6 : 2.2);
      shutter.scale.y = shutterK;
    }
  }

  // ---------------------------------------------------------------- routines
  const go = (s, extra = {}) => ({ go: [s.x, s.z], ...extra });
  const act = (clip, secs, face, extra = {}) => ({ act: clip, secs, face, ...extra });
  const near = (a, s, d = 0.4) => Math.hypot(a.pos.x - s.x, a.pos.y - s.z) < d;
  const QUEUE = ['pay', 'queue_0', 'queue_1', 'queue_2', 'queue_3'].filter((q) => data.spots?.[q]);
  const FIT = ['fit_0', 'fit_1', 'fit_2'].filter((q) => data.spots?.[q]);

  function newVisitor(a) {
    const o = OUTFITS[Math.floor(rand() * OUTFITS.length)];
    const palette = a.material.userData.palette;
    const full = resolveOutfit({ ...o, skin: SKINS[Math.floor(rand() * SKINS.length)], hair: HAIRS[Math.floor(rand() * HAIRS.length)] });
    // Region order as in people.js REGIONS.
    const order = ['eyes', 'white', 'skin', 'top', 'bottom', 'shoes', 'sole', 'hair', 'mouth', 'accent', 'trim', 'vest', 'strip', 'badge', 'lens', 'belt'];
    order.forEach((r, i) => palette[i].set(full[r]));
    a.track = store.nextId++;
    a.midVisit = false;
    living.carry(a, 'garment', false);
    living.carry(a, 'bag', false);
  }

  function stations() {
    return [
      ...rails.flatMap((r) => railSpots(r).map((s) => ({ ...s, clip: 'browse' }))),
      { ...spot('table_front'), key: 'table_front', clip: 'browse' },
      { ...spot('table_side'), key: 'table_side', clip: 'browse' },
      ...(hasTable2 ? [{ ...spot('table_2'), key: 'table_2', clip: 'browse' }] : []),
      { ...spot('table_2_side'), key: 'table_2_side', clip: 'browse' },
      { ...spot('denim'), key: 'denim', clip: 'browse' },
      { ...spot('denim_2'), key: 'denim_2', clip: 'browse' },
      { ...spot('denim_3'), key: 'denim_3', clip: 'browse' },
      { ...spot('mannequins'), key: 'mannequins', clip: 'point' },
      { ...spot('mirror'), key: 'mirror', clip: 'idle' },
    ].filter((s) => s.x != null);
  }
  // What people look at in passing: the rails, the tables, the denim wall, the window.
  b.crowd.interest = ['table_front', 'fold', 'table_2', 'denim_2', 'mannequins', 'mirror'].map(spot).filter(Boolean).map((q) => [q.x, q.z])
    .concat(rails.map((r) => [r.position.x, r.position.z]));

  // The store's districts: where things happen, so that people spread out
  // over them, each doing something different (sim/spread.js). The till and
  // the booths are reached by their own routines; the rest are browsing
  // errands. A party of three fits at the tables, the denim wall and the window.
  // `then`: what someone might do next at the same place (refold a tee,
  // hold jeans up, point something out, a thumbs-up at the mirror), so the
  // floor shows many different things going on at once.
  const S = (k, clip = 'browse', extra = {}) => (spot(k) ? { ...spot(k), key: k, clip, ...extra } : null);
  const districts = new Districts([
    { name: 'till', stations: () => QUEUE.map((k) => S(k, 'queue')), browse: false, feature: true, queue: true },
    { name: 'fitting', stations: () => [...FIT.map((k) => S(k, 'tryon', { browse: false })), S('mirror', 'idle', { then: ['thumbs', 'point'] })], cap: 2, feature: true },
    { name: 'denim', stations: () => ['denim', 'denim_2', 'denim_3'].map((k) => S(k, 'browse', { then: ['fold', 'point'] })), cap: 2, feature: true, party: true },
    ...rails.map((r) => ({ name: r.name, stations: () => railSpots(r).map((q) => ({ ...q, clip: 'browse', then: ['idle', 'point'] })), cap: 1, feature: true })),
    { name: 'tables', stations: () => [S('table_front', 'browse', { then: ['fold', 'idle'] }), S('table_side', 'browse', { then: ['fold', 'idle'] }), S('fold', 'fold', { browse: false })], cap: 1, feature: true, party: true },
    // (By the door: not for a party of three.)
    { name: 'table_2', stations: () => [hasTable2 ? S('table_2', 'browse', { then: ['fold', 'idle'] }) : null, S('table_2_side', 'browse', { then: ['fold', 'idle'] })], cap: 1, feature: true },
    // The window display sits in a dead end by the glass: one person at a time, and not a party.
    { name: 'window', stations: () => [S('mannequins', 'point', { then: ['idle'] })], cap: 1, feature: true },
    { name: 'entrance', poly: data.zones?.entrance?.map((q) => [q[0], q[2]]), cap: 0, browse: false, walkThrough: true },
  ], { counts: (p) => p.role === 'shopper' });
  let districtT = 0;
  // The entrance is walked through: nobody steps aside or waits in it.
  if (districts.byName.get('entrance')?.poly) b.crowd.noWait = [districts.byName.get('entrance').poly];
  // Those who open at a station hold it while they carry on there.
  for (const p of people) {
    const t = p.st.tasks.find((q) => q.opening);
    const k = t && [...districts.keyOf.values()].find(({ s: q }) => q.key && Math.hypot(q.x - p.pos.x, q.z - p.pos.y) < 0.35);
    if (k && b.crowd.free(k.s.key, p)) t.claim = k.s.key;
  }

  // The denim wall's five columns (Blender: 2 m wide, centred at x -1.2).
  const denimColumn = (x) => Math.max(0, Math.min(4, Math.floor((x + 2.2) / 0.4)));
  /**
   * Where `a` browses next: a free station somewhere quiet, in a district
   * they haven't been to on this visit (sim/spread.js). A party goes where
   * three can stand.
   */
  const nextStation = (a) => districts.pick(a, people, { rand, free: (q) => b.crowd.free(q.key, a), visited: a.st.seen, party: !!a.party });
  /** In the entrance (walked through, never stood in)? */
  const inEntrance = (a) => !!districts.of(a.pos.x, a.pos.y)?.walkThrough;
  /**
   * Somewhere to wait a moment out of everyone's way: open floor 1.5 to 2.5 m
   * off, not in the entrance, clear of every station and of other people.
   */
  const aside = (a) => {
    const all = [...districts.keyOf.values()].map(({ s: q }) => q);
    for (let k = 0; k < 24; k++) {
      const t = rand() * Math.PI * 2;
      const r = 1.5 + rand();
      const x = a.pos.x + Math.sin(t) * r;
      const z = a.pos.y + Math.cos(t) * r;
      if (!b.grid.free(x, z) || districts.of(x, z)?.walkThrough || !inPoly(x, z, INDOORS)) continue;
      if (all.some((q) => Math.hypot(q.x - x, q.z - z) < 1.1)) continue;
      if (people.some((p) => p !== a && p.visible && Math.hypot(p.pos.x - x, p.pos.y - z) < 1)) continue;
      return { x, z };
    }
    return null;
  };

  // The heatmap opens on "today so far": visits like the store's own, walked
  // along the real floor plan (in, one to three stations, the till for about
  // half, out), so the chapter shows a day's shape before the live visitors
  // add theirs. Its own random stream, and a few paths a frame.
  const seedRand = rng(77);
  const seedLegs = [];
  for (let k = 0; k < 40; k++) {
    const all = stations();
    const stops = Array.from({ length: 1 + Math.floor(seedRand() * 3) }, () => all[Math.floor(seedRand() * all.length)]);
    if (seedRand() < 0.5) stops.push(spot('pay'));
    let at = spot(seedRand() < 0.5 ? 'in_in' : 'door_in');
    for (const s of stops) {
      if (s && at) seedLegs.push([at, s, true]);
      at = s ?? at;
    }
    seedLegs.push([at, spot('out_in'), false]); // out without stopping
  }
  function seedHeat(budgetMs = 1.5) {
    const t0 = performance.now();
    while (seedLegs.length && performance.now() - t0 < budgetMs) {
      const [a, s, stay] = seedLegs.shift();
      const path = b.grid.path([a.x, a.z], [s.x, s.z]);
      if (!path) continue;
      // Walking at about 1.1 m/s, then a stay of 6 to 30 s at the stop.
      for (let i = 1; i < path.length; i++) {
        const [x0, z0] = path[i - 1];
        const [x1, z1] = path[i];
        const d = Math.hypot(x1 - x0, z1 - z0);
        for (let t = 0; t < d; t += 0.1) heat.add(x0 + ((x1 - x0) * t) / d, z0 + ((z1 - z0) * t) / d, 0.1 / 1.1);
      }
      if (stay) heat.add(s.x, s.z, 6 + seedRand() * 24);
    }
  }

  function planVisit(a) {
    const st = a.st;
    // Two to four places around the store, each chosen when it's time to go
    // there (wherever is quiet then), never the same district twice. (Those
    // the page opens on are half way round already: one or two to go.)
    const opening = a.midVisit;
    a.midVisit = false;
    st.stops = opening ? 1 + Math.floor(rand() * 2) : 2 + Math.floor(rand() * 3);
    st.seen = new Set(opening ? [districts.of(a.pos.x, a.pos.y)?.name].filter(Boolean) : []);
    st.fit = !a.party && rand() < 0.45;
    st.buy = rand() < (a.party ? 0.65 : 0.6);
  }

  function brain(a) {
    const st = a.st;
    // An errand that happens somewhere (browsing a rail, trying something on)
    // only happens there: if the walk there failed, drop it and re-plan.
    while (st.tasks.length) {
      const t = st.tasks.shift();
      if (t.at && !near(a, t.at, 0.45)) continue;
      return t;
    }
    if (a.role === 'cashier') return cashier(a);
    if (a.role === 'staff') return floorStaff(a);
    if (a.role === 'stock') return stockClerk(a);
    if (a.role === 'manager') return manager(a);
    if (a.role === 'passer') return passer(a);
    if (a.role === 'intruder') return intruderBrain(a);
    if (a.party && a !== a.leader) return follower(a);
    return shopper(a);
  }

  function shopper(a) {
    const st = a.st;
    if (store.afterHours && st.phase !== 'leave' && st.phase !== 'exiting') st.phase = 'leave';
    // Three failed walks in a row: give up this errand (and any place held for it).
    if ((a.failures ?? 0) >= 3) {
      a.failures = 0;
      st.tasks = [];
      if (['checkout', 'queued', 'paying', 'paid'].includes(st.phase)) store.short++;
      if (st.phase !== 'exiting') st.phase = 'leave';
      return act('idle', 0.8);
    }
    switch (st.phase) {
      case 'street': {
        // Coming along the street to the door, keeping to the in lane.
        st.phase = 'enter';
        return go(spot('in_out') ?? spot('door_out'), { via: true });
      }
      case 'enter':
        st.phase = 'browse';
        planVisit(a);
        if (store.tillWanted > 0 && !a.party) {
          store.tillWanted--;
          st.stops = 0;
          st.buy = true;
          st.fit = false;
        }
        return go(spot('in_in') ?? spot('door_in'), { via: true });
      case 'linger': {
        // Standing about by the window display, long past browsing: what the
        // loitering rule is for. Then back to the visit.
        st.phase = 'browse';
        const s = spot('mannequins');
        st.tasks.push(act(rand() < 0.5 ? 'phone' : 'idle', 26 + rand() * 6, s.face, { at: s }));
        return go(s);
      }
      case 'browse': {
        if (st.stops == null) planVisit(a);
        // Nowhere free just now: a moment where they are and look again
        // (twice), then on to the fitting room or the till, or home. (Just
        // in the door, any free place will do rather than wait there.)
        const s = st.stops > 0 ? nextStation(a) ?? (inEntrance(a) ? districts.pick(a, people, { rand, free: (q) => b.crowd.free(q.key, a), party: !!a.party, apart: 0.7, full: true }) : null) : null;
        if (!s && st.stops > 0 && (st.retry = (st.retry ?? 0) + 1) <= 2 && !store.afterHours) {
          // (Not in the entrance or the middle of an aisle: at their last
          // place, or a step aside first.)
          const w = inEntrance(a) || !a.claim ? aside(a) : null;
          if (w) return go(w);
          return act(rand() < 0.5 ? 'idle' : 'point', 2 + rand() * 2, null, { claim: a.claim });
        }
        if (s) {
          st.stops--;
          st.retry = 0;
          st.seen?.add(s.district);
          // Long enough at each to be seen doing it (8 to 14 s), and now and
          // then something else there after (refolding, pointing, a thumbs-up).
          st.tasks.push(act(s.clip, 11 + rand() * 5, s.look ?? s.face, { claim: s.key, at: s }));
          if (s.then && rand() < 0.5) st.tasks.push(act(s.then[Math.floor(rand() * s.then.length)], 2.5 + rand() * 2, s.look ?? s.face, { claim: s.key, at: s }));
          if (/^denim/.test(s.key) && rand() < 0.5) st.tasks.push({ call: () => living.takeDenim(denimColumn(s.x)), at: s });
          return go(s, { claim: s.key });
        }
        st.phase = st.fit ? 'fitting' : st.buy ? 'checkout' : 'leave';
        if (!st.buy && !st.fit) store.short++;
        return act('idle', 0.4, null, { claim: a.claim });
      }
      case 'fitting': {
        const free = FIT.find((k) => b.crowd.free(k, a));
        if (!free) return act('idle', 1.5, [spot('fit_0').x, spot('fit_0').z], { claim: 'fit_wait' });
        st.phase = st.buy ? 'checkout' : 'leave';
        if (!st.buy) store.short++;
        const s = spot(free);
        const i = FIT.indexOf(free);
        // The shirt they chose goes in with them, is tried on, and then either
        // comes out to the till or stays on the booth's hook for the staff.
        living.carry(a, 'garment', true);
        st.tasks.push(
          { call: () => living.carry(a, 'garment', false), at: s },
          act('tryon', 8 + rand() * 4, s.face, { claim: free, at: s }),
          { call: () => (st.buy ? living.carry(a, 'garment', true) : living.leftOnHook(i, true)) },
          go(spot('fit_wait')),
        );
        return go(s, { claim: free });
      }
      case 'checkout':
      case 'queued':
      case 'paying': {
        // Join the end of the line, then move up one place at a time.
        let k = QUEUE.findIndex((q) => a.claim === q);
        if (k < 0) {
          const taken = QUEUE.map((q) => !b.crowd.free(q, a));
          k = taken.lastIndexOf(true) + 1;
          if (k >= QUEUE.length) {
            st.phase = 'leave';
            store.short++;
            return act('idle', 0.5);
          }
          st.phase = 'queued';
          const s = spot(QUEUE[k]);
          return go(s, { claim: QUEUE[k], face: s.face });
        }
        if (k === 0) {
          // At the till (really there): pay, the cashier scans, the sale is matched.
          if (!near(a, spot('pay'), 0.3)) return go(spot('pay'), { claim: 'pay' });
          // "2 together", "4 queuing": the next sale waits (a while) until that
          // many people are at the counter, so the match shows what a busy
          // counter does to its confidence.
          if (st.phase !== 'paid' && store.hold && store.hold.until > store.clock && tillCount() < store.hold.n) {
            return act('queue', 0.5, spot('pay').face, { claim: 'pay' });
          }
          if (st.phase !== 'paid' && !atRegister()) {
            // Nobody at the register: wait a while, then give up and go.
            if ((a.tillT ?? 0) > 32) {
              st.phase = 'leave';
              store.short++;
              return act('idle', 0.6);
            }
            return act('queue', 0.8, spot('pay').face, { claim: 'pay' });
          }
          if (st.phase !== 'paid' && !st.scanned) {
            // The cashier scans what they're buying first (a few seconds).
            st.scanned = true;
            return act('queue', 2.5 + rand() * 2.5, spot('pay').face, { claim: 'pay' });
          }
          if (st.phase !== 'paid') {
            st.phase = 'paid';
            st.tasks.push({ call: () => sale(a) });
            return act('pay', 3.2, spot('pay').face, { claim: 'pay' });
          }
          st.phase = 'leave';
          store.converted++;
          // The receipt, a word, and away.
          return act('idle', 1.2, spot('pay').face, { claim: 'pay' });
        }
        if (b.crowd.free(QUEUE[k - 1], a)) {
          const s = spot(QUEUE[k - 1]);
          return go(s, { claim: QUEUE[k - 1] });
        }
        if (!near(a, spot(QUEUE[k]), 0.3)) return go(spot(QUEUE[k]), { claim: QUEUE[k] });
        return act('queue', 0.8, spot(QUEUE[k]).face, { claim: QUEUE[k] });
      }
      case 'paid':
        st.phase = 'leave';
        store.converted++;
        return act('idle', 0.3);
      case 'leave': {
        // One at a time (5 s apart, a party 8): while someone else is on the
        // way out, anyone done browsing stays a moment longer where they are;
        // from the till or a booth (the next person needs it), a step out of
        // the way first.
        if (!store.afterHours && director.time < store.nextExit && (st.waited = (st.waited ?? 0) + 1) <= 5) {
          const here = a.claim && districts.keyOf.get(a.claim);
          if (here && here.d.browse && here.s.browse !== false) {
            return act(rand() < 0.5 ? 'idle' : 'point', 1.5 + rand(), here.s.look ?? here.s.face, { claim: a.claim });
          }
          const w = !st.stoodAside && aside(a);
          if (w) {
            st.stoodAside = true;
            return go(w);
          }
          return act(rand() < 0.5 ? 'idle' : 'phone', 1.5 + rand(), null);
        }
        if (!store.afterHours) store.nextExit = director.time + (a.party ? 8 : 5);
        // Out through the door, then along the street into a portal, where
        // they fade (the only place anyone leaves the scene).
        st.phase = 'exiting';
        st.exit = pickPortal();
        // Through the out lane without stopping (the lane's spots are waypoints).
        st.tasks.push(go(spot('out_out') ?? spot('door_out'), { via: true }), { exit: st.exit });
        // To the out lane from inside the shop (not across the way in), a
        // party gathered where it is first (never in the doorway), then out
        // in single file behind the leader.
        const lane = spot('out_in') ?? spot('door_in');
        const toLane = [...(lane ? [go({ x: lane.x - 0.9, z: lane.z + 0.1 }, { via: true })] : []), go(lane, { via: true })];
        if (a.party && a.leader === a && !together(a)) {
          st.tasks.unshift(...toLane);
          return act('idle', 4, null, { until: () => together(a) });
        }
        st.tasks.unshift(...toLane.slice(1));
        return toLane[0];
      }
      case 'exiting':
      default:
        return { exit: st.exit ?? pickPortal() };
    }
  }

  // Customers and passers-by come and go along the street (the arcade);
  // staff, and whoever comes after hours, by the alley.
  const street = b.portals.find((p) => p.name === 'arcade')?.name;
  const pickPortal = () => street ?? b.portals[Math.floor(rand() * b.portals.length)]?.name ?? null;

  /** Is the whole party near its leader (in single file, each within their place in the line)? */
  const together = (L) => {
    const fol = people.filter((p) => p.leader === L && p !== L);
    return fol.every((p, k) => !p.visible || Math.hypot(p.pos.x - L.pos.x, p.pos.y - L.pos.y) < Math.max(1.5, FILE * (k + 1) + 0.6));
  };
  /**
   * The leader's footsteps (a point every 15 cm, the last 6 m): through the
   * doorway and on the street, the others walk in them, one behind another.
   */
  b.crowd.onMove((a) => {
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
  const singleFile = (L) => (L.task?.go && L.vel.length() > 0.12) || !inPoly(L.pos.x, L.pos.y, INDOORS);
  /** A pace apart in single file. */
  const FILE = 0.8;

  function follower(a) {
    const L = a.leader;
    // The party leaves together: on the way out they keep their places
    // behind the leader (who slows while anyone lags), and follow them into
    // the same portal once they have gone through it.
    if (!L.visible || L.st.phase === 'exiting') {
      a.st.exit = L.st.exit ?? L.exited ?? a.st.exit;
      a.st.phase = 'exiting';
      if (!L.visible) return { exit: a.st.exit };
    }
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
      if (at && b.grid.free(at[0], at[1]) && Math.hypot(at[0] - a.pos.x, at[1] - a.pos.y) > 0.3) return { go: at, until: on };
      if (at && b.grid.free(at[0], at[1])) return act('idle', 0.6, [L.pos.x, L.pos.y], { until: on });
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
        if (!b.grid.free(x, z) || !b.grid.los(L.pos.x, L.pos.y, x, z) || inEntrance({ pos: { x, y: z } })) continue;
        // Clear of the other one's place, and of anyone else.
        if (other && Math.hypot(other.pos.x - x, other.pos.y - z) < 0.6) continue;
        const crowded = people.filter((p) => p !== a && p.visible && !(p.party && p.leader === L) && Math.hypot(p.pos.x - x, p.pos.y - z) < 0.8).length;
        const narrow = Math.max(0, 0.55 - b.grid.clearAt(x, z));
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

  function cashier(a) {
    const s = spot('cashier');
    if (store.afterHours) return act('type', 2, s.face);
    // Scanning while someone stands at the till (their things, then their card).
    const payer = people.find((p) => p.claim === 'pay' && near(p, spot('pay'), 0.35) && (p.clip === 'pay' || p.clip === 'queue'));
    if (payer) living.scan();
    return payer ? act('scan', 1.2, s.face) : act('type', 1.6, s.face);
  }

  // ---------------------------------------------------------------- staff jobs
  // Every member of staff does many jobs; a job board picks where the next
  // one is: where no other member of staff is and the fewest customers
  // are, leaning to each person's own end of the floor, never the same job
  // twice running. So at any moment the staff are spread over the store.
  const FLOOR_ROLES = ['staff', 'stock', 'manager'];
  const staffIn = (d, a) => (d ? people.filter((p) => p !== a && p.visible && FLOOR_ROLES.includes(p.role) && districts.where(p) === d).length : 0);
  /** Anyone (staff or customer) standing, or about to, within 1.1 m of `at`. */
  const standingBy = (at, a) =>
    people.some((p) => {
      if (p === a || !p.visible || p.role === 'passer' || (p.task?.go && !p.claim)) return false;
      const [x, z] = districts.aim(p);
      return Math.hypot(x - at.x, z - at.z) < 1.1;
    });
  /** Customers standing (or about to) within 1.1 m of `at`: a job there would close the aisle between them. */
  const customerBy = (at, a) =>
    people.some((p) => {
      if (p === a || !p.visible || p.role !== 'shopper' || (p.task?.go && !p.claim)) return false;
      const [x, z] = districts.aim(p);
      return Math.hypot(x - at.x, z - at.z) < 1.1;
    });
  /** Other staff at, or on their way to, somewhere within 1.8 m of `at`. */
  const staffNear = (at, a) =>
    people.filter((p) => {
      if (p === a || !p.visible || !FLOOR_ROLES.includes(p.role)) return false;
      const [x, z] = districts.aim(p);
      return Math.hypot(x - at.x, z - at.z) < 1.8;
    }).length;
  /** Anyone coming or going through the entrance just now (the stock-room door and badge reader are beside it). */
  const entranceBusy = () => people.some((p) => p.visible && !isStaffRole(p.role) && p.role !== 'passer' && districts.of(p.pos.x, p.pos.y)?.walkThrough);
  /** A shopper who has been browsing a while, and could do with a word (not one already being helped). */
  const helpable = (a) =>
    people
      .filter((p) => p.visible && p.role === 'shopper' && !p.party && p.st?.phase === 'browse' && p.task?.act === 'browse' && p.timer > 2 && p.task.secs - p.timer > 5 &&
        !people.some((q) => q.st?.helping === p) && !['till', 'fitting'].includes(districts.of(p.pos.x, p.pos.y)?.name))
      .sort((x, y) => Math.hypot(x.pos.x - a.pos.x, x.pos.y - a.pos.y) - Math.hypot(y.pos.x - a.pos.x, y.pos.y - a.pos.y))[0] ?? null;
  /** Somewhere to stand by `c` to talk: a pace off, on open floor, clear of everyone else. */
  const besideCustomer = (c, a) => {
    let best = null;
    let bd = Infinity;
    for (let k = 0; k < 10; k++) {
      const t = (k / 10) * Math.PI * 2;
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
  };
  const railJob = (a, name, clip = 'browse', secs = 4 + rand() * 2) => {
    const r = rails.find((q) => q.name === name);
    const s = r && railSpots(r).find((q) => b.crowd.free(q.key, a));
    return s && { d: districts.byName.get(name), at: s, run: () => {
      a.st.tasks.push(act(clip, secs, s.look, { claim: s.key, at: s }));
      return go(s, { claim: s.key });
    } };
  };
  const STAFF_JOB = {
    // Folding the table stock.
    fold: (a) => {
      const s = spot('fold');
      return s && b.crowd.free('fold', a) && { d: districts.byName.get('tables'), at: s, run: () => {
        a.st.tasks.push(act('fold', 8 + rand() * 4, s.face, { claim: 'fold', at: s }));
        return go(s, { claim: 'fold' });
      } };
    },
    // Straightening a rail.
    rail_a: (a) => railJob(a, 'rail_a'),
    rail_b: (a) => railJob(a, 'rail_b'),
    // Facing up the denim wall.
    denim: (a) => {
      const key = ['denim_3', 'denim_2', 'denim'].find((k) => spot(k) && b.crowd.free(k, a));
      const s = key && spot(key);
      return s && { d: districts.byName.get('denim'), at: s, run: () => {
        a.st.tasks.push(act(rand() < 0.5 ? 'fold' : 'point', 5 + rand() * 3, s.face, { claim: key, at: s }));
        return go(s, { claim: key });
      } };
    },
    // A word with a shopper who has been browsing a while: they turn to talk.
    help: (a) => {
      const c = helpable(a);
      const at = c && besideCustomer(c, a);
      return at && { d: districts.of(c.pos.x, c.pos.y), at, run: () => {
        a.st.helping = c;
        a.st.tasks.push(
          {
            call: () => {
              // Still there, still browsing: they turn to face each other, and
              // the browse lasts the conversation out.
              if (c.visible && c.task?.act === 'browse' && Math.hypot(c.pos.x - a.pos.x, c.pos.y - a.pos.y) < 1.3) {
                c.task.face = [a.pos.x, a.pos.y];
                c.task.secs = Math.max(c.task.secs, c.timer + 5);
              }
            },
            at,
          },
          act('talk', 4, [c.pos.x, c.pos.y], { at }),
          { call: () => (a.st.helping = null) },
        );
        return go(at);
      } };
    },
    // Into the staff room by the badge reader: now and then, when the entrance beside it is clear.
    badge: (a) => {
      const bd = spot('badge');
      // (Not while someone else is in the stock room already: it's small.)
      const back = people.some((p) => p !== a && p.visible && inPoly(p.pos.x, p.pos.y, BACK_OF_HOUSE) && p.pos.x > OFFICE_X1);
      return bd && { d: null, at: bd, cost: a.st.badgeNow ? -99 : (a.st.jobs ?? 0) % 6 === 5 && !entranceBusy() && !back ? -2 : 99, run: () => {
        a.st.badgeNow = false;
        a.st.tasks.push(
          act('scan', 1.6, bd.face, { at: bd }),
          { call: () => badged(a) },
          go(spot('lockers') ?? spot('stock_shelf')),
          act('idle', 2.5, (spot('lockers') ?? spot('stock_shelf')).face, { at: spot('lockers') ?? spot('stock_shelf') }),
        );
        return go(bd);
      } };
    },
  };
  /** The next job for `a` from `jobs`, where no other staff are and customers fewest; `home` jobs cost less. */
  function staffJob(a, jobs, home) {
    let best = null;
    for (const name of jobs) {
      const j = STAFF_JOB[name](a);
      if (!j) continue;
      // Not facing someone across an aisle (a word with a shopper is the one job beside someone).
      if (name !== 'help' && standingBy(j.at, a)) continue;
      // A part of the floor nobody has used for a while is where a job shows best.
      const quiet = j.d?.feature ? Math.min(3, j.d.idle / 4) : 0;
      const cost = 3 * staffIn(j.d, a) + 2.5 * staffNear(j.at, a) + 2 * (j.d?.groups ?? 0) + (name !== 'help' && customerBy(j.at, a) ? 4 : 0) - quiet + (home.includes(name) ? 0 : 1.2) + (name === a.st.lastJob ? 5 : 0) +
        0.15 * Math.hypot(j.at.x - a.pos.x, j.at.z - a.pos.y) + rand() * 1.2 + (j.cost ?? 0);
      if (!best || cost < best.cost) best = { name, j, cost };
    }
    if (!best || best.cost > 50) return null;
    a.st.lastJob = best.name;
    a.st.jobs = (a.st.jobs ?? 0) + 1;
    return best.j.run();
  }

  function floorStaff(a) {
    const st = a.st;
    const second = staff().filter((p) => p.role === 'staff').indexOf(a) === 1;
    // Closing: one to the lockers, the other by the stock-room door (the
    // stock room is too tight for two to pass).
    if (store.afterHours) {
      const s = spot(second ? 'stock_door' : 'lockers') ?? spot('stock_door');
      return near(a, s, 0.4) ? act('idle', 2, s.face) : go(s);
    }
    // The director asked for a badge-in now.
    if (st.badgeNow) return STAFF_JOB.badge(a)?.run() ?? act('idle', 1);
    // A shirt left in a booth: the first free hand collects it and hangs it back up.
    const hook = [0, 1, 2].find((i) => living.hookHasShirt(i) && b.crowd.free(FIT[i], a) && !people.some((p) => p !== a && p.st?.collect === i));
    if (hook != null && !store.afterHours) {
      const s = spot(FIT[hook]);
      const r = rails[Math.floor(rand() * rails.length)];
      const back = r && railSpots(r).find((q) => b.crowd.free(q.key, a));
      st.collect = hook;
      st.tasks.push(
        act('browse', 1.4, s.face, { claim: FIT[hook], at: s }),
        { call: () => { living.leftOnHook(hook, false); living.carry(a, 'garment', true); } },
        ...(back ? [go(back, { claim: back.key }), act('browse', 3, back.look, { claim: back.key, at: back })] : []),
        { call: () => { living.carry(a, 'garment', false); st.collect = null; } },
      );
      return go(s, { claim: FIT[hook] });
    }
    if ((st.calls = (st.calls ?? 0) + 1) % 7 === 0) {
      // On the phone a moment: sometimes in plain sight, sometimes turned
      // away (the phone hidden by the body: the tier makes no claim then).
      living.carry(a, 'phone', rand() < 0.5);
      st.tasks.push({ call: () => living.carry(a, 'phone', false) });
      return act('phone', 5 + rand() * 3);
    }
    // The first leans to the tables and rails at the front, the second to
    // the denim wall and the badge-ins; both help shoppers.
    const jobs = second ? ['denim', 'rail_a', 'help', 'badge', 'fold', 'rail_b'] : ['fold', 'rail_b', 'rail_a', 'help', 'denim', 'badge'];
    return staffJob(a, jobs, jobs.slice(0, 4)) ?? act('fold', 1.5, null, { claim: a.claim });
  }

  /** A badge at the reader: what the platform logs (recognition, by consent). */
  function badged(a) {
    a.flash = 1;
    event(a.consent ? `badge · ${a.staffId} · staff, not counted` : `badge · ${a.staffId} · consent withdrawn, counted`);
  }

  function stockClerk(a) {
    // Between the stock room and the floor: a carton from the shelf, out to
    // whichever rail (or the denim wall, once a few pairs have gone) needs
    // it and nobody else is at, and back. The stock-room door opens by the
    // entrance, so through it only in a gap in the traffic (a moment's wait
    // at most, then carefully anyway), and any waiting is done in the stock
    // room or at the rail, never in the doorway.
    const st = a.st;
    const box = a.fig.root.getObjectByName('box');
    const shelf = spot('stock_shelf');
    const inStock = inPoly(a.pos.x, a.pos.y, BACK_OF_HOUSE) && a.pos.x > OFFICE_X1;
    const carrying = (on) => {
      st.carton = on;
      if (box) box.visible = on;
      a.walkClip = on ? 'carry' : 'walk';
    };
    st.carton ??= !!box?.visible;
    if (store.afterHours) return near(a, spot('lockers') ?? shelf, 0.4) ? act('idle', 2) : go(spot('lockers') ?? shelf);
    const gap = () => !entranceBusy() || (st.held = (st.held ?? 0) + 1) >= 5;
    if (!st.carton) {
      // Back for a carton (waiting at the rail, never in the entrance).
      if (!inStock && !inEntrance(a) && !gap()) return act('fold', 1.5, null, { claim: a.claim });
      st.held = 0;
      // Now and then a while sorting stock on the shelves first.
      if (rand() < 0.5) st.tasks.push(act('fold', 6 + rand() * 5, shelf.face, { at: shelf, claim: 'stock_shelf' }));
      st.tasks.push(act('idle', 2.5, shelf.face, { at: shelf, claim: 'stock_shelf' }), { call: () => carrying(true), at: shelf });
      return go(shelf, { claim: 'stock_shelf' });
    }
    // With a carton: the denim wall first, once a few pairs have gone from it.
    let job = null;
    if (living.denimMissing() >= 3 && b.crowd.free('denim_2', a) && !customerBy(spot('denim_2'), a)) {
      const s = spot('denim_2');
      job = { at: s, run: () => {
        st.tasks.push(act('browse', 3.5, s.face, { claim: 'denim_2', at: s }), { call: () => { living.restockDenim(); carrying(false); } });
        return go(s, { claim: 'denim_2' });
      } };
    } else {
      // A rail, or the second table's stack: the one with no staff and
      // fewest customers, nearer the better.
      const t2 = spot('table_2_side') && b.crowd.free('table_2_side', a) && !standingBy(spot('table_2_side'), a) && {
        d: districts.byName.get('table_2'), at: spot('table_2_side'), run: () => {
          const s2 = spot('table_2_side');
          a.st.tasks.push(act('fold', 4, s2.face, { claim: 'table_2_side', at: s2 }));
          return go(s2, { claim: 'table_2_side' });
        },
      };
      const pick = [...rails.map((r) => railJob(a, r.name, 'browse', 3.5)), t2].filter(Boolean)
        .map((j) => ({ j, cost: 3 * staffIn(j.d, a) + 2.5 * staffNear(j.at, a) + 1.2 * (j.d?.groups ?? 0) + (customerBy(j.at, a) ? 4 : 0) + 0.4 * Math.hypot(j.at.x - a.pos.x, j.at.z - a.pos.y) + rand() }))
        .sort((x, y) => x.cost - y.cost)[0];
      if (pick) job = { at: pick.j.at, run: () => {
        const walk = pick.j.run();
        st.tasks.push({ call: () => carrying(false) });
        return walk;
      } };
    }
    // Nowhere to take it just now (or the entrance is busy): wait by the shelf.
    if (!job || (inStock && !gap())) return inStock || !shelf ? act('idle', 1.5, shelf?.face) : go(shelf, { claim: 'stock_shelf' });
    st.held = 0;
    return job.run();
  }

  function manager(a) {
    // Works at the office desk (its monitor is the live dashboard), and every
    // sixth job or so walks the floor, to wherever no staff are just now,
    // with a word to the till from there.
    const st = a.st;
    const office = spot('office');
    st.i = ((st.i ?? -1) + 1) % 6;
    if (!office) return act('idle', 2);
    // Out through the office door only when nobody is passing it.
    const door = spot('office_door');
    const passing = door && people.some((p) => p !== a && p.visible && p.task?.go && Math.hypot(p.pos.x - door.x, p.pos.y - door.z) < 1.6);
    if (st.i === 5 && passing && near(a, office, 0.5)) st.i = 4;
    if (st.i < 5 || store.afterHours) {
      if (!near(a, office, 0.35)) return go(office);
      return act(st.i === 1 ? 'type' : 'point', 5 + rand() * 5, office.face);
    }
    // A walk round the floor: to wherever no staff are just now.
    const t = ['table_side', 'table_2_side', 'mirror']
      .filter((k) => spot(k) && b.crowd.free(k, a) && !standingBy(spot(k), a))
      .map((k) => ({ k, s: spot(k), cost: 3 * staffIn(districts.of(spot(k).x, spot(k).z), a) + 2.5 * staffNear(spot(k), a) + 1.2 * (districts.of(spot(k).x, spot(k).z)?.groups ?? 0) + rand() }))
      .sort((x, y) => x.cost - y.cost)[0];
    if (!t) return act('idle', 2);
    st.tasks.push(act('talk', 3 + rand() * 2, [spot('cashier').x, spot('cashier').z], { claim: t.k, at: t.s }), go(office));
    return go(t.s, { claim: t.k });
  }

  function passer(a) {
    // Along the pavement: stop at the window display, maybe by the bench, and
    // on down the street (back into the arcade). Seen by the perimeter
    // camera; never crosses the line, so never a visitor.
    const st = a.st;
    switch (st.phase) {
      case 'stroll':
        st.phase = 'window';
        return go(spot('window_view') ?? spot('door_out'));
      case 'window':
        st.phase = 'bench';
        return act(rand() < 0.5 ? 'point' : 'idle', 3 + rand() * 3, spot('window_view')?.face);
      case 'bench':
        st.phase = 'leave';
        if (rand() < 0.5 && spot('bench_view')) {
          st.tasks.push(act('phone', 4 + rand() * 4, spot('bench_view').face));
          return go(spot('bench_view'));
        }
        return act('idle', 0.5);
      default:
        st.phase = 'exiting';
        st.exit = street;
        return { exit: street };
    }
  }

  function intruderBrain(a) {
    const st = a.st;
    if (st.phase === 'hidden') return act('idle', 1);
    if (st.phase === 'leaving') return { exit: 'alley' };
    if (st.phase === 'enter') {
      // In from the alley through the service door, through the stock room,
      // out onto the dark shop floor.
      st.phase = 'prowl';
      st.tasks.push(act('idle', 2.5, [spot('stock_shelf').x, spot('stock_shelf').z]), go(spot('stock_door')), go(spot('table_side')));
      return go(spot('stock_shelf'));
    }
    return act('idle', 1.5);
  }

  // The heat chapter's busiest places (worked out twice a second).
  let hotClock = 0;
  let hotNow = [];

  // ---------------------------------------------------------------- the director
  // Keeps the store's rhythms going (someone always arriving or leaving by
  // the door, at the till, in a booth, lingering by the window), and when a
  // chapter opens, casts whoever is best placed to show its feature now.
  const director = new Director({ crowd: b.crowd, rand });
  const doorSpot = spot('door_in') ?? { x: 0, z: 0 };
  // Someone on a director's errand is left to finish it: never cast twice.
  const onJob = (a, job) => a.job === job && a.jobUntil > director.time;
  const browsing = (a) => a.role === 'shopper' && !a.party && a.st.phase === 'browse' && !(a.jobUntil > director.time);
  const hire = (a, job, secs) => {
    if (a) {
      a.job = job;
      a.jobUntil = director.time + secs;
    }
    return a;
  };
  const doorBusy = () =>
    people.some((p) => p.visible && !isStaffRole(p.role) && p.role !== 'passer' && ['street', 'enter', 'exiting'].includes(p.st.phase) && Math.hypot(p.pos.x - doorSpot.x, p.pos.y - doorSpot.z) < 6);
  /** How crowded it is where `p` is: the groups in their district and the people within a metre. */
  const crowdAt = (p) => (districts.of(p.pos.x, p.pos.y)?.groups ?? 0) + people.filter((q) => q !== p && q.visible && Math.hypot(q.pos.x - p.pos.x, q.pos.y - p.pos.y) < 1).length;
  /** Cast preferring whoever moving would thin a crowd, then whoever is nearest `to`. */
  const fromCrowd = (to) => (p) => -2 * crowdAt(p) + 0.1 * Math.hypot(p.pos.x - to.x, p.pos.y - to.z);
  const sendToDoor = () => {
    // Someone new along the street (a visitor between visits comes back now),
    // or someone who has been in a good while (a minute or more) heads out:
    // from wherever it is busiest.
    const away = people.find((p) => !p.visible && p.role === 'shopper' && !p.party && (p.st.back ?? 0) > 0.3);
    if (away && roomFor(away)) {
      away.st.back = 0.2;
      return away;
    }
    return hire(director.redirect(director.cast(people, (p) => browsing(p) && store.clock - p.visitStart > 60 * 6 && (p.st.seen?.size ?? 2) >= 2, fromCrowd(doorSpot)), (p) => (p.st.phase = 'leave')), 'door', 20);
  };
  const tillBusy = () => QUEUE.some((q) => !b.crowd.free(q)) || people.some((p) => p.visible && onJob(p, 'till'));
  /** Somewhere seen already this visit (people open the page mid-visit: count them as one). */
  const seenAtLeast = (n) => (p) => browsing(p) && (p.st.seen?.size ?? 1) >= n;
  /** The first of `tests` anyone passes: the best-suited, falling back to anyone free. */
  const castFirst = (tests, to) => {
    for (const ok of tests) {
      const p = director.cast(people, ok, to);
      if (p) return p;
    }
    return null;
  };
  // To the till: someone who has browsed two places, or failing that one.
  const castToTill = () => hire(director.redirect(castFirst([seenAtLeast(2), seenAtLeast(1)], fromCrowd(spot('queue_0'))), (p) => {
    p.st.phase = 'checkout';
    p.st.buy = true;
  }), 'till', 30);
  const fittingBusy = () => people.some((p) => p.visible && (p.clip === 'tryon' || onJob(p, 'fitting')));
  const sendToFit = () => hire(director.redirect(castFirst([seenAtLeast(1)], fromCrowd(spot('fit_wait'))), (p) => (p.st.phase = 'fitting')), 'fitting', 25);
  const lingering = () => people.some((p) => p.visible && (p.loiter || (p.task?.act && p.task.secs >= 20) || onJob(p, 'linger')));
  const sendToLinger = () => hire(director.redirect(castFirst([seenAtLeast(1)], spot('mannequins')), (p) => (p.st.phase = 'linger')), 'linger', 45);
  director.flow('door', { every: 3, when: () => !store.afterHours && !doorBusy(), run: sendToDoor });
  director.flow('till', { every: 5, when: () => !store.afterHours && !tillBusy(), run: castToTill });
  director.flow('fitting', { every: 6, when: () => !store.afterHours && !fittingBusy(), run: sendToFit });
  director.flow('linger', { every: 9, when: () => !store.afterHours && !lingering(), run: sendToLinger });
  // Break up any pile: a district holding more groups than it should for
  // 6 s, or four or more people within a metre of someone for 4 s: whoever
  // has stood there longest moves on to their next stop (somewhere quiet).
  const movable = (p) => p.visible && p.role === 'shopper' && (!p.party || p.leader === p) && p.st?.phase === 'browse' && !(p.jobUntil > director.time) && p.task?.act && p.clip !== 'tryon';
  const moveOn = (p) => director.redirect(p, (q) => q.st.seen?.add(districts.of(q.pos.x, q.pos.y)?.name));
  let knotT = 0;
  director.flow('spread', {
    every: 1,
    when: () => !store.afterHours,
    run: () => {
      const over = districts.worst(6);
      if (over) {
        const p = people.filter((q) => movable(q) && districts.of(q.pos.x, q.pos.y) === over).sort((x, y) => y.timer - x.timer)[0];
        if (p) {
          over.over = 0;
          return moveOn(p);
        }
      }
      const here = people.filter((q) => q.visible && q.role !== 'passer' && !q.fixed && inPoly(q.pos.x, q.pos.y, INDOORS) && !districts.where(q)?.queue);
      const knot = here.find((q) => new Set(here.filter((o) => Math.hypot(o.pos.x - q.pos.x, o.pos.y - q.pos.y) <= 1).map((o) => (o.party ? `p${o.party}` : o.id))).size >= 4);
      knotT = knot ? knotT + 1 : 0;
      if (knotT >= 4) {
        const p = here.filter((q) => movable(q) && Math.hypot(q.pos.x - knot.pos.x, q.pos.y - knot.pos.y) <= 1.2).sort((x, y) => y.timer - x.timer)[0];
        if (p) {
          knotT = 0;
          return moveOn(p);
        }
      }
      return null;
    },
  });
  director.beat('line', () => (doorBusy() ? null : sendToDoor()));
  director.beat('track', () => (fittingBusy() ? null : sendToFit()));
  director.beat('pos', () => (tillBusy() ? null : castToTill()));
  director.beat('zones', () => (lingering() ? null : sendToLinger()));
  director.beat('staff', () => {
    // The floor staff member nearer the reader goes to badge in.
    const bd = spot('badge');
    const floor = staff().filter((p) => p.role === 'staff');
    if (!bd || !floor.length || store.afterHours) return null;
    const s2 = floor.reduce((m, p) => (Math.hypot(p.pos.x - bd.x, p.pos.y - bd.z) < Math.hypot(m.pos.x - bd.x, m.pos.y - bd.z) ? p : m));
    return director.redirect(s2, (a) => {
      a.st.badgeNow = true;
    });
  });
  director.beat('parties', () => {
    const L = people.find((p) => p.party && p.leader === p);
    if (L && !L.visible) L.st.back = Math.min(L.st.back ?? 0.3, 0.3);
    return L;
  });

  // ---------------------------------------------------------------- the till
  function sale(a) {
    a.paidThisVisit = true;
    living.paid();
    living.carry(a, 'garment', false);
    living.carry(a, 'bag', true);
    store.sales++;
    store.hold = null;
    // Conversion per party counts parties the line saw arrive (not people
    // already inside when the page opened), once per party.
    const visit = (a.party ? a.leader : a)?.visit;
    if (visit && !visit.bought) {
      visit.bought = true;
      store.partiesBought++;
    }
    // Who could the sale belong to: everyone in the till area at that moment.
    const till = zones.till;
    const around = people.filter((p) => counted(p) && p.role === 'shopper' && (till?.contains(p.pos.x, p.pos.y) || p === a));
    const n = Math.max(1, around.length);
    const conf = MATCH[n] ?? (n >= 4 ? MATCH[4] : null);
    store.lastMatch = { who: a, others: around.filter((p) => p !== a), n, conf, t: 0, id: a.track };
    event(`sale · ${n === 1 ? 'one customer' : `${n} customers`} at the till · ${conf != null ? `${conf}%` : '46 to 24%'}`);
    ctx.emit('sale', String(store.sales));
  }

  // ---------------------------------------------------------------- measurement
  // Counting with hysteresis, as a real counting line must: a side is only
  // decided 12 cm clear of the line, so someone lingering on it counts once,
  // and a crossing only counts within the doorway's span.
  const outside = spot('door_out') ?? { x: 3, z: 0 };
  const sideOf = (x, z) => {
    const [ax, az] = line.a;
    const [bx, bz] = line.b;
    const ex = bx - ax;
    const ez = bz - az;
    const len = Math.hypot(ex, ez) || 1;
    const d = cross(ex, ez, x - ax, z - az) / len;
    const out = Math.sign(cross(ex, ez, outside.x - ax, outside.z - az)) || 1;
    const t = ((x - ax) * ex + (z - az) * ez) / (len * len);
    return { d: d * out, t };
  };
  b.crowd.onMove((a) => {
    if (!counted(a)) {
      a.side = null;
      return;
    }
    const { d, t } = sideOf(a.pos.x, a.pos.y);
    // A line with no hysteresis and no confirmation frames counts every time
    // the feet cross it: someone hovering in the doorway racks up phantoms.
    const raw = d > 0 ? 'out' : 'in';
    if (a.naiveSide && a.naiveSide !== raw && t >= -0.2 && t <= 1.2) store.naive++;
    a.naiveSide = raw;
    const now = d > 0.12 ? 'out' : d < -0.12 ? 'in' : null;
    if (!now) return;
    const was = a.side;
    a.side = now;
    if (!was || was === now || t < -0.2 || t > 1.2) return;
    if (now === 'in') {
      store.entries++;
      store.bucket++;
      a.visitStart = store.clock;
      a.inAt = director.time;
      // A party's visit: counted once, and converted at most once however
      // many of them buy.
      if (!a.party || a === a.leader) {
        store.parties++;
        a.visit = { bought: false };
      }
      event(`entry · ID ${a.track ?? a.staffId}`);
    } else {
      store.exits++;
      event(`exit · ID ${a.track ?? a.staffId}`);
    }
    a.flash = 1;
    a.flashIn = now === 'in';
    ctx.emit('line', `${store.entries}/${store.exits}`);
  });

  const dwellNow = new Map(); // agent -> zone -> seconds
  /** Is the cashier at the register (not stepped away)? */
  const atRegister = () => {
    const c = people.find((p) => p.role === 'cashier');
    const s = spot('cashier');
    return !!c && !!s && c.visible && Math.hypot(c.pos.x - s.x, c.pos.y - s.z) < 0.6;
  };
  function measureTill(dt) {
    const tz = zones.till;
    if (!tz) return;
    let waiting = 0;
    for (const a of people) {
      if (a.role !== 'shopper' || !counted(a)) continue;
      const inside = tz.contains(a.pos.x, a.pos.y);
      if (inside) {
        a.tillT = (a.tillT ?? 0) + dt;
        waiting++;
      } else if (a.tillT) {
        // A visit ends: its time at the till (being served included), and
        // whether it was a long one that ended without a sale.
        store.tillVisits.push(a.tillT);
        if (store.tillVisits.length > 60) store.tillVisits.shift();
        if (a.tillT >= WALKOUT_SECS) {
          store.longVisits++;
          if (!a.paidThisVisit) {
            store.walkouts++;
            event(`walkout · ID ${a.track} · ${Math.round(a.tillT)} s at the till, no sale`);
          }
        }
        a.tillT = 0;
        a.paidThisVisit = false;
      }
    }
    // Customers at the till with nobody at the register: an unattended episode.
    const alone = waiting > 0 && !atRegister();
    if (alone) store.unattended.now += dt;
    else if (store.unattended.now > 0) {
      store.unattended.episodes++;
      event(`unattended till · ${Math.round(store.unattended.now)} s`);
      store.unattended.now = 0;
    }
    store.coverGap = atRegister() ? 0 : store.coverGap + dt * 6;
  }
  let heatClock = 0;
  function measure(dt) {
    // Presence goes into the heatmap ten times a second (the same sum, fewer adds).
    heatClock += dt;
    const heatNow = heatClock >= 0.1;
    for (const a of people.concat(intruder)) {
      if (!a.visible) continue;
      // The store's floor, as its own cameras see it: not the pavement outside.
      if (heatNow && ((counted(a) && a.role !== 'passer') || a === intruder)) heat.add(a.pos.x, a.pos.y, heatClock);
      let m = dwellNow.get(a);
      if (!m) dwellNow.set(a, (m = new Map()));
      for (const [name, z] of Object.entries(zones)) {
        if (z.contains(a.pos.x, a.pos.y)) {
          const d = (m.get(name) ?? 0) + dt;
          m.set(name, d);
          // Loitering is raised while the person is still in the zone.
          if (name === 'fitting' && counted(a) && d >= LOITER_SECS && !a.loiter) {
            a.loiter = true;
            alert('Loitering', 'fitting area', a);
          }
        } else if (m.has(name)) {
          const d = m.get(name);
          const agg = (store.dwell[name] ??= { sum: 0, n: 0 });
          agg.sum += d;
          agg.n++;
          m.delete(name);
          if (name === 'fitting') a.loiter = false;
        }
      }
    }
    if (heatNow) heatClock = 0;
    measureTill(dt);
    store.bucketClock += dt;
    if (store.bucketClock > 8) {
      store.bucketClock = 0;
      store.series.push(store.bucket);
      store.bucket = 0;
      if (store.series.length > 18) store.series.shift();
    }
  }

  function alert(kind, where, a) {
    const item = { kind, where, id: a.track ?? a.staffId ?? 'unknown', at: time(), state: 'awaiting review', agent: a };
    store.alerts.unshift(item);
    if (store.alerts.length > 6) store.alerts.pop();
    event(`${kind.toLowerCase()} · ${where} · to review`);
  }

  // ---------------------------------------------------------------- after hours
  const lightState = { k: 1, target: 1 };
  const baked = [];
  stage.root.traverse((o) => o.isMesh && [o.material].flat().forEach((m) => m.lightMap && !baked.includes(m) && baked.push(m)));
  const baseIntensity = baked.map((m) => m.lightMapIntensity);
  const lights = [];
  scene.traverse((o) => o.isDirectionalLight && lights.push([o, o.intensity]));
  function setAfterHours(on) {
    store.afterHours = on;
    lightState.target = on ? 0.28 : 1;
    if (on) {
      store.clock = 21 * 3600 + 12 * 60;
      event('store closed · perimeter and intrusion armed');
      intruderTimer = 7;
    } else {
      store.clock = 9 * 3600 + 41 * 60;
      // Whoever came in after hours walks back out the way people leave.
      if (intruder.visible) {
        intruder.st = { tasks: [], phase: 'leaving' };
        intruder.task = null;
      }
      for (const p of people) if (!isStaffRole(p.role) && !p.visible) p.st.back = 0.5;
      event('store open');
    }
  }
  let intruderTimer = 0;

  // ---------------------------------------------------------------- overlays
  let following = null;
  const show = { people: true, boxes: false, track: false, trails: true, line: false, zones: false, heat: false, cams: false, parties: false, pos: false, staffFocus: false, security: false, coverage: false };
  function setShow(o) {
    Object.assign(show, { people: true, boxes: false, track: false, trails: false, line: false, zones: false, heat: false, cams: false, parties: false, pos: false, staffFocus: false, security: false, coverage: false }, o);
    if (typeof coverage !== 'undefined') {
      coverage.visible = show.coverage;
      placePlan();
    }
    // Detection is the story when tracking and counting; elsewhere, rings.
    show.boxes = show.people && (show.track || show.line);
    rings.visible = show.people && !show.boxes;
    heat.visible = show.heat;
    for (const z of Object.values(zones)) z.visible = show.zones || (show.pos && z === zones.till);
    trails.mesh.visible = show.trails || show.heat;
    lineHandles.forEach((h) => (h.visible = show.line));
    zoneHandles.forEach((h) => (h.visible = show.zones));
    if (!show.trails && !show.heat) trails.clear();
  }

  // Handles to reshape the line and zones.
  const handleGeo = new CylinderGeometry(0.06, 0.06, 0.014, 24);
  const handleMat = new MeshBasicMaterial({ color: GLOW.white, toneMapped: false });
  const handle = (kind, key, index) => {
    const m = new Mesh(handleGeo, handleMat);
    m.userData.pick = 'drag';
    m.userData.handle = { kind, key, index };
    m.layers.set(OVERLAY_LAYER);
    m.position.y = 0.014;
    scene.add(m);
    return m;
  };
  const lineHandles = [handle('line', 'a'), handle('line', 'b')];
  const zoneHandles = Object.entries(zones).flatMap(([k, z]) => z.points.map((_, i) => handle('zone', k, i)));
  const placeHandles = () => {
    lineHandles[0].position.set(line.a[0], 0.014, line.a[1]);
    lineHandles[1].position.set(line.b[0], 0.014, line.b[1]);
    for (const h of zoneHandles) {
      const p = zones[h.userData.handle.key].points[h.userData.handle.index];
      h.position.set(p[0], 0.014, p[1]);
    }
  };
  placeHandles();

  let selectedCam = 'entrance';

  // Staff activity, the reliable tiers first (employee/activity.py): where
  // they are, then moving or stationary (45 s still), then, only when the
  // phone is actually seen by the hand, "on phone". Never for appraisal.
  function activity(a) {
    const s = spot('cashier');
    let where = 'on floor';
    if (a.role === 'cashier' && s && Math.hypot(a.pos.x - s.x, a.pos.y - s.z) < 0.6) where = 'at register';
    else if (inPoly(a.pos.x, a.pos.y, BACK_OF_HOUSE) || (spot('stock_door') && Math.hypot(a.pos.x - spot('stock_door').x, a.pos.y - spot('stock_door').z) < 1)) where = 'near stockroom';
    if (a.clip === 'phone') return a.fig.root.getObjectByName('phone')?.visible ? `${where} · on phone` : `${where} · phone not seen, no claim`;
    const still = (a.stillT ?? 0) * 6 >= 45 || !a.task?.go;
    return `${where} · ${still ? 'stationary' : 'moving'}`;
  }

  function labelled(a, flagged, x, z) {
    if (show.track || show.staffFocus || following === a) return true;
    if (show.line) return (a.flash ?? 0) > 0.2;
    if (show.zones) return !!a.loiter || [...(dwellNow.get(a)?.values() ?? [])].some((v) => v > 0);
    if (show.parties) return !!a.party;
    if (show.pos) return !!zones.till?.contains(x, z);
    if (show.security) return flagged;
    return false;
  }

  function drawPeople(dt) {
    const L = b.lines;
    detections = [];
    rings.begin();
    occClock -= dt;
    const recheck = occClock <= 0;
    if (recheck) occClock = 0.2;
    for (const a of people.concat(intruder)) {
      if (!a.visible) continue;
      const x = a.pos.x;
      const z = a.pos.y;
      const s = a.fig.root.scale.x;
      const isStaff = a.role !== 'shopper' && a.role !== 'intruder';
      const recognised = isStaff && a.consent;
      const flagged = a.loiter || a === intruder;
      let color = recognised ? GLOW.grey : GLOW.turq;
      if (show.zones && a.loiter) color = GLOW.amber;
      if (flagged && (show.security || show.zones)) color = GLOW.red;
      if (show.parties && a.party) color = GLOW.violet;
      if (show.staffFocus && isStaff) color = recognised ? GLOW.violet : GLOW.amber;
      a.flash = Math.max(0, (a.flash ?? 0) - dt * 1.5);
      if (show.boxes) {
        if (recheck && slot.camera) hiddenNow.set(a, occluded(a, slot.camera));
        const hidden = hiddenNow.get(a) ?? false;
        const id = a === intruder ? 'unknown' : recognised ? a.staffId : `ID ${String(a.track).padStart(2, '0')}`;
        const crossed = show.line && a.flash > 0.2 ? (a.flashIn ? ' · +1 in' : ' · +1 out') : '';
        const tag = hidden ? `${id} · hidden` : recognised ? `staff · ${id}` : `person ${confidence(a.id, store.clock / 6).toFixed(2)} · ${id}${crossed}`;
        detections.push({ x, z, yaw: a.heading, height: 1.52 * s, color: inkOf(color), tag, dashed: hidden, alpha: a.fade });
      } else if (show.people) {
        rings.add(x, z, color, s, a.fade * (flagged && (show.security || show.zones) ? 0.85 + 0.15 * Math.sin(store.clock) : 1));
      }
      if ((show.trails || show.heat) && counted(a)) {
        trails.push(a.track ?? a.staffId, x, z, show.heat ? (a.st.buy ? GLOW.turq : GLOW.amber) : color, dt);
      }
      // Cards carry only the chapter's key label; case studies label the
      // people the chapter's feature is about, and no one else. In the box
      // chapters, the boxes' own tags say who is who.
      if (card || show.boxes || !labelled(a, flagged, x, z)) continue;
      let text = a === intruder ? 'unknown' : recognised ? a.staffId : `ID ${String(a.track).padStart(2, '0')}`;
      let sub = '';
      let tone = recognised ? 'grey' : 'turq';
      if (isStaff && show.staffFocus) sub = recognised ? activity(a) : 'not recognised · counted';
      if (show.staffFocus && isStaff) tone = recognised ? 'violet' : 'amber';
      if (show.zones) {
        const m = dwellNow.get(a);
        const inFit = m?.get('fitting');
        const any = m && [...m.values()].reduce((q, v) => Math.max(q, v), 0);
        if (any) sub = `${(inFit ?? any).toFixed(0)} s${a.loiter ? ' · loitering' : ''}`;
        if (a.loiter) tone = 'amber';
      }
      if (following === a && a.visitStart) sub = `${mmss(Math.max(0, store.clock - a.visitStart))} in store`;
      if (flagged && (show.security || show.zones)) tone = 'red';
      if (a === intruder) sub = 'after hours · to review';
      if (a.flash > 0.2 && show.line) sub = a.flashIn ? '+1 in' : '+1 out';
      if (show.parties && a.party && a !== a.leader) continue;
      if (show.parties && a.party) {
        text = 'Party of 3';
        sub = '1 party · 3 visitors';
        tone = 'violet';
      }
      labels.set(`p${people.indexOf(a)}_${a === intruder ? 'x' : ''}`, { text, sub, tone, at: [x, 1.72 * s, z] });
    }
    rings.end();
    // Mannequins, to the detector, until they are ended or ignored.
    if (show.boxes && show.track && !ignoreZone) {
      const v = new Vector3();
      for (const m of mannequins) {
        m.o.getWorldPosition(v);
        if (m.ended) detections.push({ x: v.x, z: v.z, yaw: 0, height: 1.55, color: INK.grey, tag: `ID ${m.id} · static_object · ended`, dashed: true, alpha: 0.8 });
        else detections.push({ x: v.x, z: v.z, yaw: 0, height: 1.55, color: INK.turq, tag: `person ${(0.61 + (m.id % 5) * 0.03).toFixed(2)} · ID ${m.id} · still ${mmss(m.age)}`, alpha: 1 });
      }
    }
    if (show.track && ignoreZone && displayBox) {
      const { min, max } = displayBox;
      b.lines.poly([[min.x, 0.014, min.z], [max.x, 0.014, min.z], [max.x, 0.014, max.z], [min.x, 0.014, max.z]], GLOW.grey, true);
      if (!card) labels.set('ignore', { text: 'IGNORE zone', sub: 'nothing here is detected', tone: 'grey', at: [(min.x + max.x) / 2, 0.1, max.z] });
    }
    // Parties: one ring on the floor around the group.
    if (show.parties) {
      const groups = new Map();
      for (const a of people) if (a.party && a.visible) (groups.get(a.leader) ?? groups.set(a.leader, []).get(a.leader)).push(a);
      for (const g of groups.values()) {
        let x0 = Infinity;
        let x1 = -Infinity;
        let z0 = Infinity;
        let z1 = -Infinity;
        for (const a of g) {
          x0 = Math.min(x0, a.pos.x - 0.25);
          x1 = Math.max(x1, a.pos.x + 0.25);
          z0 = Math.min(z0, a.pos.y - 0.25);
          z1 = Math.max(z1, a.pos.y + 0.25);
        }
        const cx = (x0 + x1) / 2;
        const cz = (z0 + z1) / 2;
        L.circle(cx, 0.014, cz, Math.max(x1 - x0, z1 - z0) / 2 + 0.1, GLOW.violet, 40);
      }
    }
  }

  function drawLine() {
    const [ax, az] = line.a;
    const [bx, bz] = line.b;
    const L = b.lines;
    L.seg(ax, 0.012, az, bx, 0.012, bz, GLOW.turq);
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    // "In" points into the store (-x of the doorway line).
    const nx = -0.13;
    for (const k of [0.25, 0.5, 0.75]) {
      const cx = ax + (bx - ax) * k;
      const cz = az + (bz - az) * k;
      L.seg(cx + 0.04, 0.012, cz - uz * 0.06, cx + nx + 0.04, 0.012, cz, GLOW.turq);
      L.seg(cx + 0.04, 0.012, cz + uz * 0.06, cx + nx + 0.04, 0.012, cz, GLOW.turq);
    }
    void ux;
    labels.set('line', { text: `IN ${store.entries}`, sub: `OUT ${store.exits}`, tone: 'plain', at: [(ax + bx) / 2, 0.35, (az + bz) / 2], priority: true });
  }

  function drawZones() {
    for (const [name, z] of Object.entries(zones)) {
      if (!z.mesh.visible) continue;
      const n = people.filter((p) => counted(p) && z.contains(p.pos.x, p.pos.y)).length;
      z.glow(n ? 1 : 0);
      b.lines.poly(z.outline(0.012), name === 'fitting' ? GLOW.amber : GLOW.violet, true);
      const [cx, cz] = z.centroid();
      if (show.zones) {
        const agg = store.dwell[name];
        labels.set(`zone_${name}`, { text: name, sub: `${n} now${agg?.n ? ` · avg ${Math.round(agg.sum / agg.n)} s` : ''}`, tone: name === 'fitting' ? 'amber' : 'violet', at: [cx, 0.05, cz], priority: true });
      }
    }
  }

  function drawCameras() {
    for (const [role, c] of Object.entries(cams)) {
      const col = hexGlow(ROLE_COLOR[role], role === selectedCam ? 1.6 : 0.9);
      const f = c.look.clone().sub(c.pos).normalize();
      const right = new Vector3().crossVectors(f, new Vector3(0, 1, 0)).normalize();
      const up = new Vector3().crossVectors(right, f).normalize();
      const L = role === selectedCam ? 1.3 : 0.7;
      const spread = Math.tan(((data.cameras[role].fov ?? 70) * Math.PI) / 360);
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) =>
        c.pos.clone().addScaledVector(f, L).addScaledVector(right, sx * spread * L).addScaledVector(up, (sy * spread * L * 9) / 16)
      );
      for (const q of corners) b.lines.seg(c.pos.x, c.pos.y, c.pos.z, q.x, q.y, q.z, col);
      b.lines.poly(corners.map((q) => [q.x, q.y, q.z]), col, true);
      labels.set(`cam_${role}`, { text: role.replace('_', ' '), tone: role === selectedCam ? 'plain' : 'grey', at: [c.pos.x, c.pos.y + 0.18, c.pos.z] });
    }
  }

  function drawMatch(dt) {
    const m = store.lastMatch;
    if (!m) return;
    m.t += dt;
    if (m.t > 7) {
      store.lastMatch = null;
      return;
    }
    if (!show.pos) return; // the match is the POS chapter's story
    const t = spot('terminal') ?? { x: -2.0, z: 1.25 };
    const from = new Vector3(t.x, 1.02, t.z);
    const arc = (to, col) => {
      const pts = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        pts.push([from.x + (to.x - from.x) * t, from.y + (1.55 - from.y) * Math.sin(Math.PI * t) + (to.y - from.y) * t, from.z + (to.z - from.z) * t]);
      }
      b.lines.poly(pts, col);
    };
    if (m.who.visible) arc(new Vector3(m.who.pos.x, 1.4, m.who.pos.y), GLOW.violet);
    for (const o of m.others) if (o.visible) arc(new Vector3(o.pos.x, 1.4, o.pos.y), GLOW.grey);
    labels.set('match', { text: m.conf != null ? `match ${m.conf}%` : 'match 46 to 24%', sub: `${m.n} at the counter · by timestamp, not identity`, tone: 'violet', at: [from.x, 1.7, from.z], priority: true });
  }

  // ---------------------------------------------------------------- picture-in-picture
  // A store camera's own picture: its view of the people, drawn with the same
  // boxes as the main view, sized to the picture.
  function pip2d(g, w, h) {
    const cam = cams[selectedCam]?.cam;
    if (!cam) return;
    const hl = health[selectedCam];
    // What the fault does to the picture: covered, it goes flat; blurred, it
    // goes soft (and the detector finds nobody in either).
    if (hl?.fault === 'occluded') {
      g.fillStyle = '#121214';
      g.fillRect(0, 0, w, h);
    } else if (hl?.fault === 'defocused') {
      g.filter = `blur(${Math.max(3, w / 90)}px)`;
      g.drawImage(g.canvas, 0, 0);
      g.filter = 'none';
    }
    const blind = hl?.fault === 'occluded' || hl?.fault === 'defocused';
    const v = new Vector3();
    const items = [];
    for (const a of people.concat(intruder)) {
      if (!a.visible) continue;
      const s = a.fig.root.scale.x;
      const isStaff = a.role !== 'shopper' && a.role !== 'intruder' && a.consent;
      const color = a === intruder ? INK.red : isStaff ? INK.grey : INK.turq;
      const tag = a === intruder ? `person ${confidence(a.id, store.clock / 6).toFixed(2)} · unknown` : isStaff ? `staff · ${a.staffId}` : `person ${confidence(a.id, store.clock / 6).toFixed(2)} · ID ${a.track}`;
      items.push({ x: a.pos.x, z: a.pos.y, yaw: a.heading, height: 1.52 * s, color, tag, alpha: a.fade });
    }
    if (!blind) drawDetections(g, w, h, cam, items, { px: w / 520 });
    g.lineWidth = Math.max(1.5, w / 400);
    // What this role draws on its picture: the counting line, the till zone.
    const poly = (pts, color) => {
      g.strokeStyle = color;
      g.beginPath();
      pts.forEach(([x, z], i) => {
        v.set(x, 0.01, z).project(cam);
        const px = ((v.x + 1) / 2) * w;
        const py = ((1 - v.y) / 2) * h;
        if (i) g.lineTo(px, py);
        else g.moveTo(px, py);
      });
      g.stroke();
    };
    if (selectedCam === 'entrance') poly([line.a, line.b], '#06d6a0');
    if (selectedCam === 'checkout' && zones.till) poly([...zones.till.points, zones.till.points[0]], '#8b5cf6');
    g.fillStyle = 'rgba(5,5,6,0.6)';
    g.fillRect(0, 0, w, Math.round(w / 26));
    g.font = `500 ${Math.round(w / 48)}px "Geist Mono Variable", monospace`;
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#e4e4e7';
    g.fillText(`${selectedCam.replace('_', ' ').toUpperCase()}  ${time()}`, 8, Math.round(w / 38));
    if (hl?.fault || hl?.raised) {
      const band = Math.round(w / 22);
      g.fillStyle = hl.raised && hl.fault ? 'rgba(251,191,36,0.92)' : 'rgba(5,5,6,0.7)';
      g.fillRect(0, h - band, w, band);
      g.fillStyle = hl.raised && hl.fault ? '#1a1406' : '#e4e4e7';
      g.fillText(hl.raised && hl.fault ? `camera_health: ${hl.fault} · counts from this camera marked suspect` : `camera_health: ${healthText(selectedCam)}`, 8, h - band * 0.3);
    }
  }

  /** The evidence clip, frame by frame, with its time bar. */
  function clipPip(g, w, h) {
    const n = clip.frames.length;
    g.fillStyle = '#0b0b0e';
    g.fillRect(0, 0, w, h);
    if (!n) return;
    clip.play = (clip.play ?? 0) + 1;
    const f = clip.frames[clip.play % n];
    g.drawImage(f.c, 0, 0, w, h);
    const band = Math.round(w / 22);
    g.fillStyle = 'rgba(5,5,6,0.72)';
    g.fillRect(0, h - band, w, band);
    g.fillStyle = '#fb6f8a';
    g.fillRect(0, h - 3, (w * ((clip.play % n) + 1)) / n, 3);
    g.fillStyle = '#e4e4e7';
    g.font = `500 ${Math.round(w / 48)}px "Geist Mono Variable", monospace`;
    const rel = f.t - clip.flagAt;
    g.fillText(`EVIDENCE CLIP · ${CLIP_BEFORE} s before, ${CLIP_AFTER} s after · ${CLIP_FPS} fps · ${rel < 0 ? '' : '+'}${rel.toFixed(1)} s`, 8, h - band * 0.3);
  }

  /** The 07:00 report, as the store's inbox gets it. */
  const report = document.createElement('canvas');
  report.width = 960;
  report.height = 540;
  function drawReport() {
    const g = report.getContext('2d');
    const W = report.width;
    g.fillStyle = '#f4f4f5';
    g.fillRect(0, 0, W, report.height);
    g.fillStyle = '#18181b';
    g.font = '600 30px "Geist Variable", system-ui, sans-serif';
    g.fillText('Daily report · Atelier', 48, 70);
    g.font = '400 18px "Geist Mono Variable", monospace';
    g.fillStyle = '#52525b';
    g.fillText('07:00, for yesterday · by email and webhook', 48, 102);
    const rows = [
      ['Visitors', String(store.entries)],
      ['Sales', store.sales ? String(store.sales) : 'none: flagged below'],
      ['Walkouts at the till', `${store.walkouts} of ${store.longVisits} long visits`],
    ];
    g.font = '400 20px "Geist Variable", system-ui, sans-serif';
    rows.forEach(([k, v], i) => {
      g.fillStyle = '#52525b';
      g.fillText(k, 48, 160 + i * 34);
      g.fillStyle = '#18181b';
      g.fillText(v, 380, 160 + i * 34);
    });
    // What needs someone's attention, built from what happened today.
    const attention = [
      ...store.faults.map((f) => `Camera ${f.role.replace('_', ' ')}: ${f.kind} at ${f.at}`),
      ...(store.alerts.some((a) => a.state === 'awaiting review') ? [`Review queue: ${store.alerts.filter((a) => a.state === 'awaiting review').length} alerts waiting`] : []),
      ...(store.sales ? [] : ['No sales recorded']),
      'Footfall against the same weekday: needs 4 weeks of history',
    ];
    g.fillStyle = '#18181b';
    g.font = '600 22px "Geist Variable", system-ui, sans-serif';
    g.fillText('Needs attention', 48, 290);
    g.font = '400 19px "Geist Variable", system-ui, sans-serif';
    attention.slice(0, 6).forEach((line, i) => {
      g.fillStyle = /Camera|Review|No sales/.test(line) ? '#b45309' : '#71717a';
      g.fillText(`•  ${line}`, 48, 326 + i * 32);
    });
  }

  // ---------------------------------------------------------------- coverage and blind spots
  // Things in the store that can be clicked, as well as the buttons: a camera
  // (to choose it), a mannequin (the IGNORE zone), the cashier (steps away).
  const clickables = [];
  for (const role of Object.keys(cams)) {
    const m = camMesh(role);
    if (m) {
      m.userData.pick = 'click';
      m.userData.camRole = role;
      clickables.push(m);
    }
  }
  for (const m of mannequins) {
    m.o.userData.pick = 'click';
    m.o.userData.mannequin = true;
    clickables.push(m.o);
  }

  const coverage = new Coverage(scene, { area: { x0: -5.45, x1: 5.0, z0: -3.75, z1: 3.75 }, free: (x, z) => b.grid.clear(x, z), occluders });
  // A camera being planned (store_plan.py's "plan new camera": 3 m up, 30°
  // down, 90° by 60°, 12 m of useful range): here, up at the ceiling line.
  const plan = { cam: new PerspectiveCamera(60, Math.tan(Math.PI / 4) / Math.tan(Math.PI / 6), 0.05, 12), on: false, x: -3.2, z: 3.4, grid: false };
  const planHandle = handle('plan', 'cam');
  const planMarker = new Mesh(new CylinderGeometry(0.07, 0.05, 0.14, 16), new MeshBasicMaterial({ color: GLOW.violet, toneMapped: false }));
  planMarker.layers.set(OVERLAY_LAYER);
  scene.add(planMarker);
  function placePlan() {
    const c = plan.cam;
    c.position.set(plan.x, 2.3, plan.z);
    // Aimed at the middle of the shop floor, 30° down.
    const dx = -0.8 - plan.x;
    const dz = 0.4 - plan.z;
    const l = Math.hypot(dx, dz) || 1;
    c.lookAt(plan.x + (dx / l) * Math.cos(Math.PI / 6), 2.3 - Math.sin(Math.PI / 6), plan.z + (dz / l) * Math.cos(Math.PI / 6));
    c.updateMatrixWorld();
    planHandle.position.set(plan.x, 0.014, plan.z);
    planMarker.position.set(plan.x, 2.3, plan.z);
    planHandle.visible = planMarker.visible = plan.on && show.coverage;
  }
  const workingCams = () => Object.entries(cams).filter(([r]) => !['occluded', 'defocused'].includes(health[r].fault)).map(([, c]) => c.cam);
  function measureCoverage() {
    placePlan();
    return coverage.measure(workingCams(), plan.on ? plan.cam : null);
  }
  let planMeasured = null; // what the plan adds, measured once when it moves
  function drawCoverage() {
    if (plan.grid) {
      // The 1 m grid the calibration draws over the floor (4 clicked points
      // and a measured rectangle give it metres).
      for (let x = -5; x <= 3; x++) b.lines.seg(x, 0.02, -2.9, x, 0.02, 3.7, GLOW.grey);
      for (let z = -2; z <= 3; z++) b.lines.seg(-5.4, 0.02, z, 3.15, 0.02, z, GLOW.grey);
      if (!card) labels.set('grid', { text: '1 m grid', sub: 'calibrated from 4 points', tone: 'grey', at: [-1, 0.1, 3.4] });
    }
    if (plan.on) {
      const c = plan.cam;
      const f = new Vector3();
      c.getWorldDirection(f);
      const right = new Vector3().crossVectors(f, new Vector3(0, 1, 0)).normalize();
      const up = new Vector3().crossVectors(right, f).normalize();
      const L = 1.1;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => c.position.clone().addScaledVector(f, L).addScaledVector(right, sx * Math.tan(Math.PI / 4) * L).addScaledVector(up, sy * Math.tan(Math.PI / 6) * L));
      for (const q of corners) b.lines.seg(c.position.x, c.position.y, c.position.z, q.x, q.y, q.z, GLOW.violet);
      b.lines.poly(corners.map((q) => [q.x, q.y, q.z]), GLOW.violet, true);
      b.lines.seg(plan.x, 0.014, plan.z, plan.x, 2.3, plan.z, GLOW.violet);
      if (!card) labels.set('plan', { text: 'planned camera', sub: 'drag it · 3 m, 30° down, 90° × 60°', tone: 'violet', at: [plan.x, 2.55, plan.z] });
    }
  }

  // ---------------------------------------------------------------- chapters
  const pairs = new Map(); // two recent arrivals -> seconds together within 1.5 m
  const fps = () => (store.tensorrt ? 15 : Math.round(15 / TENSORRT));
  const chapters = [
    {
      id: 'cameras',
      pip: true,
      enter: () => {
        setShow({ cams: true });
        queueMicrotask(() => slot.chapters?.emit('pipcaption', ROLE_LABEL[selectedCam]));
      },
      readouts: () => [
        { label: 'Cameras', value: STREAMS },
        { label: 'Selected', value: selectedCam.replace('_', ' '), tone: 'violet' },
        { label: 'People in view', value: ['occluded', 'defocused'].includes(health[selectedCam]?.fault) ? 'none (no picture)' : countInView(selectedCam) },
        { label: 'Camera health', value: healthText(selectedCam), tone: health[selectedCam]?.raised ? 'amber' : health[selectedCam]?.fault ? 'grey' : 'turq' },
      ],
      actions: () => {
        const f = health[selectedCam]?.fault;
        return [
          ...Object.keys(cams).map((r) => ({ id: r, label: r.replace('_', ' '), pressed: r === selectedCam })),
          ...(f ? [{ id: 'fix', label: 'Put it right' }] : [{ id: 'cover', label: 'Cover it' }, { id: 'knock', label: 'Knock it' }, { id: 'blur', label: 'Blur it' }]),
        ];
      },
      qa(run) {
        this.act('checkout');
        run(0.2);
        const v = ctx.slot.controller.pip();
        const sees = countInView('checkout');
        this.act('cover');
        run(HEALTH_RAISE / 6 - 1);
        const early = !health.checkout.raised;
        run(2);
        const raised = health.checkout.raised && store.faults.some((f) => f.role === 'checkout' && f.kind === 'occluded');
        this.act('fix');
        run(HEALTH_CLEAR / 6 + 1);
        const cleared = !health.checkout.raised;
        return [
          ['six cameras, one per role', Object.keys(cams).length === 6, Object.keys(cams).join(', ')],
          ['a camera can be chosen', selectedCam === 'checkout' && v?.camera === cams.checkout.cam, selectedCam],
          ['its picture sees people', sees > 0, `${sees} in view`],
          ['a covered camera is raised after 30 s, not before', early && raised, store.faults.map((f) => `${f.role} ${f.kind}`).join(', ')],
          ['and cleared after 20 s put right', cleared],
        ];
      },
      act(id) {
        if (cams[id]) {
          selectedCam = id;
          slot.chapters?.emit('pipcaption', ROLE_LABEL[id]);
        }
        const kind = { cover: 'occluded', knock: 'moved', blur: 'defocused', fix: null }[id];
        if (kind !== undefined) setFault(selectedCam, kind);
      },
    },
    {
      id: 'coverage',
      enter: () => {
        setShow({ coverage: true, people: true });
        measureCoverage();
        planMeasured = plan.on ? coverage.stats.planned : null;
      },
      exit: () => {
        coverage.visible = false;
        placePlan();
      },
      readouts: () => {
        const st = coverage.stats;
        return [
          { label: 'Seen, feet and all', value: `${st.measured.toFixed(1)} m²`, tone: 'turq' },
          { label: 'Seen, feet hidden', value: `${st.estimated.toFixed(1)} m²` },
          { label: 'Blind', value: `${st.blind.toFixed(1)} m²`, tone: 'red' },
          { label: 'The planned camera adds', value: plan.on ? `${st.planned.toFixed(1)} m²` : 'none planned', tone: 'violet' },
        ];
      },
      actions: () => [
        { id: 'plan', label: plan.on ? 'Remove the planned camera' : 'Plan a new camera', pressed: plan.on },
        { id: 'grid', label: '1 m grid', pressed: plan.grid },
      ],
      act(id) {
        if (id === 'plan') {
          plan.on = !plan.on;
          measureCoverage();
        }
        if (id === 'grid') plan.grid = !plan.grid;
      },
      update: () => drawCoverage(),
      qa(run) {
        const before = measureCoverage();
        this.act('plan');
        const blindBefore = before.blind;
        plan.x = -3.2;
        plan.z = 3.4;
        const withPlan = measureCoverage();
        this.act('plan');
        run(0.5);
        return [
          ['the floor is measured on a 0.5 m grid', coverage.cells.length > 100, `${coverage.cells.length} cells`],
          ['blind spots are found', blindBefore > 0, `${blindBefore.toFixed(1)} m² blind`],
          ['a planned camera covers some of them', withPlan.planned > 0 && withPlan.blind < blindBefore, `${withPlan.planned.toFixed(1)} m² more seen`],
        ];
      },
    },
    {
      id: 'track',
      enter: () => {
        setShow({ trails: true, track: true });
        // The dress forms have been standing still a while: their tracks end
        // while the chapter is open.
        for (const m of mannequins) if (!m.ended && !ignoreZone) m.age = Math.max(m.age, STATIC_SECS - 40);
      },
      exit: () => (following = null),
      readouts: () => [
        { label: 'Tracked now', value: people.filter((p) => p.visible).length, tone: 'turq' },
        { label: 'Customers', value: people.filter((p) => counted(p) && p.role === 'shopper').length },
        { label: 'Staff (not counted)', value: staff().filter((p) => p.consent).length, tone: 'grey' },
        ...(following ? [{ label: 'Following', value: `ID ${following.track}`, tone: 'turq' }] : []),
        {
          label: 'Mannequins',
          value: ignoreZone ? 'ignored (IGNORE zone)' : mannequins.every((m) => m.ended) ? 'static, tracks ended' : `still ${mmss(Math.min(...mannequins.map((m) => m.age)))} of 4:00`,
          tone: ignoreZone || mannequins.every((m) => m.ended) ? 'grey' : 'turq',
        },
      ],
      actions: () => [...(following ? [{ id: 'unfollow', label: 'Stop following' }] : []), { id: 'ignore', label: ignoreZone ? 'Remove the IGNORE zone' : 'Draw an IGNORE zone', pressed: ignoreZone }],
      qa(run) {
        const a = people.find((p) => p.role === 'shopper' && p.visible);
        const id = a?.track;
        run(8);
        const ended = mannequins.every((m) => m.ended);
        this.act('ignore');
        run(1);
        const quiet = !detections.some((d) => /static|still/.test(d.tag));
        this.act('ignore');
        return [
          ['everyone in view is tracked', people.filter((p) => p.visible).length >= 6, `${people.filter((p) => p.visible).length} tracked`],
          ['an ID stays with its person', !a?.visible || a.track === id, `ID ${id}`],
          ['staff are told apart', staff().every((p) => p.consent), staff().map((p) => p.staffId).join(', ')],
          ['still mannequins end as static objects', ended, mannequins.map((m) => `ID ${m.id} ${m.ended ? 'ended' : mmss(m.age)}`).join(', ')],
          ['an IGNORE zone stops them being detected', quiet],
        ];
      },
      act(id) {
        if (id === 'ignore') {
          ignoreZone = !ignoreZone;
          event(ignoreZone ? 'IGNORE zone drawn · window display' : 'IGNORE zone removed');
          if (!ignoreZone) for (const m of mannequins) Object.assign(m, { id: null, age: 0, ended: false, gone: 0 });
        }
        if (id === 'unfollow') {
          following = null;
          ctx.rig.setShot(null);
        }
      },
      update() {
        if (following?.visible) ctx.rig.aim(new Vector3(following.pos.x, 0.8, following.pos.y));
        else if (following) {
          following = null;
          ctx.rig.setShot(null);
        }
      },
    },
    {
      id: 'line',
      enter: () => setShow({ line: true }),
      readouts: () => {
        const seen = people.filter((p) => counted(p) && insideStore(p)).length;
        const est = store.entries - store.exits + store.anchor;
        return [
          { label: 'Entries', value: store.entries, tone: 'turq' },
          { label: 'Exits', value: store.exits, tone: 'violet' },
          { label: 'A line with no hysteresis', value: `${store.naive} crossings`, tone: store.naive > store.entries + store.exits ? 'amber' : 'grey' },
          { label: 'Inside, entries − exits', value: est, tone: est === seen ? 'turq' : 'amber' },
          { label: 'Floor camera sees', value: seen },
        ];
      },
      actions: () => [
        { id: 'linger', label: 'Linger in the doorway' },
        { id: 'anchor', label: 'Re-anchor to the floor camera' },
        { id: 'reset_line', label: 'Put the line back' },
      ],
      qa(run) {
        run(60);
        const before = { in: store.entries, out: store.exits };
        // Move the line 25 cm in, as a store manager would: counts are kept.
        line.a = [line.a[0] - 0.25, line.a[1]];
        line.b = [line.b[0] - 0.25, line.b[1]];
        placeHandles();
        const kept = store.entries === before.in && store.exits === before.out;
        run(40);
        return [
          ['crossings count entries and exits', before.in > 0 && before.out > 0, `${before.in} in, ${before.out} out in 60 s`],
          ['moving the line keeps the counts', kept, `${before.in}/${before.out}`],
          ['the moved line keeps counting', store.entries > before.in, `${store.entries} in after`],
          ['no one is counted in twice without leaving', store.entries - store.exits <= people.filter((p) => p.role === 'shopper').length + 1, `${store.entries - store.exits} inside`],
          ...(() => {
            const real = store.entries + store.exits;
            const naive = store.naive;
            this.act('linger');
            run(25);
            return [['someone hovering on the line counts once, not over and over', store.naive - naive > (store.entries + store.exits - real) + 2, `no hysteresis +${store.naive - naive}, this counter +${store.entries + store.exits - real}`]];
          })(),
        ];
      },
      act(id) {
        if (id === 'linger') lingerInDoorway();
        if (id === 'anchor') {
          store.anchor = people.filter((p) => counted(p) && insideStore(p)).length - (store.entries - store.exits);
          event('occupancy re-anchored to the floor camera');
        }
        if (id === 'reset_line') {
          const l = data.lines.entrance;
          line.a = [l[0][0], l[0][2]];
          line.b = [l[1][0], l[1][2]];
          placeHandles();
          event('line moved · applied live, counts kept');
        }
      },
    },
    {
      id: 'zones',
      enter: () => setShow({ zones: true }),
      qa(run) {
        run(45);
        const measured = Object.values(store.dwell).reduce((n, a) => n + a.n, 0);
        return [
          ['dwell is timed per zone', measured > 0, Object.entries(store.dwell).map(([k, a]) => `${k} ${a.n}`).join(', ')],
          ['zones can be reshaped', zoneHandles.length >= 12, `${zoneHandles.length} corners`],
        ];
      },
      readouts: () => {
        const r = Object.entries(zones).map(([k, z]) => ({ label: k, value: `${people.filter((p) => counted(p) && z.contains(p.pos.x, p.pos.y)).length} now`, tone: k === 'fitting' ? 'amber' : 'violet' }));
        r.push({ label: 'Loitering', value: people.filter((p) => p.loiter).length, tone: 'amber' });
        return r;
      },
    },
    {
      id: 'heat',
      enter: () => {
        hotClock = 0;
        setShow({ heat: true });
      },
      update: (dt) => {
        // The five busiest places, numbered: far enough apart to be different
        // places, and each at least 15% of the busiest (twice a second; not on
        // a card, which doesn't show them).
        if (card) return;
        if ((hotClock -= dt ?? 1 / 60) <= 0) {
          hotClock = 0.5;
          hotNow = heat.hottest(5, 0.64).filter((h) => h.v >= 0.15).map((h, i) => ({ text: String(i + 1), sub: nearestPlace(h.x, h.z), tone: 'amber', at: [h.x, 0.08, h.z] }));
        }
        hotNow.forEach((l, i) => labels.set(`hot_${i}`, l));
      },
      readouts: () => {
        const hot = heat.hottest(1)[0];
        const place = hot ? nearestPlace(hot.x, hot.z) : 'building';
        return [
          { label: 'Busiest place', value: place, tone: 'amber' },
          { label: 'Reached the till', value: store.converted, tone: 'turq' },
          { label: 'Stopped short', value: store.short, tone: 'amber' },
        ];
      },
      actions: () => [
        { id: 'swap', label: 'Move a rail' },
        { id: 'reset_heat', label: 'Clear the heatmap' },
      ],
      act(id) {
        if (id === 'reset_heat') heat.reset();
        if (id === 'swap') moveRailSomewhere();
      },
      qa(run) {
        run(10); // the day so far is seeded by now
        const sum = () => heat.v.reduce((n, x) => n + x, 0);
        const before = sum();
        run(30);
        const hot = sum() > before;
        const r = rails[0];
        const from = r && { x: r.position.x, z: r.position.z };
        const v0 = b.grid.version;
        this.act('swap');
        run(20);
        const moved = r && Math.hypot(r.position.x - from.x, r.position.z - from.z) > 0.2;
        const clear = people.every((p) => !p.visible || b.grid.clear(p.pos.x, p.pos.y));
        return [
          ['the heatmap builds from where people stood', hot, `+${(heat.v.reduce((n, x) => n + x, 0) - before).toFixed(0)} over 30 s`],
          ['a rail moves, with collision', moved && b.grid.version > v0, r ? `${r.position.x.toFixed(2)}, ${r.position.z.toFixed(2)}` : 'no rail'],
          ['nobody ends up inside the moved rail', clear],
          ['journeys are split by outcome', store.converted + store.short > 0, `${store.converted} reached the till, ${store.short} did not`],
        ];
      },
    },
    {
      id: 'parties',
      enter: () => setShow({ parties: true }),
      // The camera keeps the family in view as they go round; people who came
      // in within 8 s of each other are joined by a line that fills over the
      // 4 s they must stay within 1.5 m to count as one party.
      update: (dt) => {
        const g = people.filter((p) => p.party && p.visible);
        if (g.length) slot.rig.aim(new Vector3(g.reduce((n, p) => n + p.pos.x, 0) / g.length, 0.7, g.reduce((n, p) => n + p.pos.y, 0) / g.length));
        const recent = people.filter((p) => p.role === 'shopper' && counted(p) && insideStore(p) && p.inAt != null && director.time - p.inAt < 90);
        for (let i = 0; i < recent.length; i++) {
          for (let j = i + 1; j < recent.length; j++) {
            const a = recent[i];
            const q = recent[j];
            const key = `${a.track}-${q.track}`;
            if (Math.abs(a.inAt - q.inAt) > 8) continue;
            const d = Math.hypot(a.pos.x - q.pos.x, a.pos.y - q.pos.y);
            const k = (pairs.get(key) ?? 0);
            const t = d <= 1.5 ? Math.min(4, k + (dt ?? 1 / 60)) : 0;
            pairs.set(key, t);
            const col = t >= 4 ? GLOW.violet : d <= 1.5 ? GLOW.grey : null;
            if (col) b.lines.seg(a.pos.x, 0.9, a.pos.y, q.pos.x, 0.9, q.pos.y, col);
            if (!card && t > 0 && t < 4) labels.set(`pair_${key}`, { text: `together ${t.toFixed(1)} s`, sub: 'of 4 s, within 1.5 m', tone: 'grey', at: [(a.pos.x + q.pos.x) / 2, 1.3, (a.pos.y + q.pos.y) / 2] });
          }
        }
      },
      qa(run) {
        run(60);
        const party = people.filter((p) => p.party);
        return [
          ['a party of three moves together', party.length === 3],
          ['parties are fewer than visitors', store.parties <= store.entries, `${store.parties} parties, ${store.entries} visitors`],
          ['a party converts at most once', store.partiesBought <= store.parties, `${store.partiesBought} of ${store.parties} parties bought`],
        ];
      },
      readouts: () => [
        { label: 'Visitors', value: store.entries, tone: 'turq' },
        { label: 'Parties', value: store.parties, tone: 'violet' },
        { label: 'Sales', value: store.sales },
        { label: 'Conversion per party', value: store.parties ? `${Math.round((store.partiesBought / store.parties) * 100)}%` : 'n/a', tone: 'violet' },
      ],
    },
    {
      id: 'pos',
      enter: () => setShow({ pos: true }),
      readouts: () => {
        const n = people.filter((p) => counted(p) && p.role === 'shopper' && zones.till?.contains(p.pos.x, p.pos.y)).length;
        const m = store.lastMatch;
        const t = [...store.tillVisits].sort((x, y) => x - y);
        const q = (k) => (t.length ? `${Math.round(t[Math.min(t.length - 1, Math.floor(t.length * k))])} s` : 'n/a');
        return [
          { label: 'At the counter', value: n },
          { label: 'Last match', value: m ? (m.conf != null ? `${m.conf}%` : '46 to 24%') : 'waiting for a sale', tone: 'violet' },
          { label: 'Time at the till', value: t.length ? `median ${q(0.5)}, p90 ${q(0.9)}` : 'n/a' },
          { label: 'Unattended', value: store.unattended.now > 0 ? `now ${mmss(store.unattended.now)}` : `${store.unattended.episodes} times`, tone: store.unattended.now > 0 ? 'amber' : 'grey' },
          { label: 'Walkouts', value: `${store.walkouts} of ${store.longVisits} long visits`, tone: store.walkouts ? 'amber' : 'grey' },
        ];
      },
      actions: () => [
        { id: 'q1', label: '1 at the counter' },
        { id: 'q2', label: '2 together' },
        { id: 'q4', label: '4 queuing' },
        { id: 'away', label: atRegister() ? 'The cashier steps away' : 'Back to the register', pressed: !atRegister() },
      ],
      act(id) {
        const n = { q1: 1, q2: 2, q4: 4 }[id];
        if (n) sendToTill(n);
        if (id === 'away') cashierAway();
      },
      qa(run) {
        const seen = [];
        const watch = () => store.lastMatch && seen[seen.length - 1] !== store.lastMatch && seen.push(store.lastMatch);
        this.act('q2');
        for (let i = 0; i < 90 && seen.length < 3; i++) {
          run(1);
          watch();
        }
        const right = seen.every((m) => (MATCH[m.n] ?? (m.n >= 4 ? MATCH[4] : null)) === m.conf);
        const busy = seen.filter((m) => m.n >= 2);
        this.act('away');
        run(3);
        const alone = !atRegister();
        this.act('q1');
        run(20);
        const unattended = store.unattended.now > 0 || store.unattended.episodes > 0;
        cashierAway(true);
        run(12);
        return [
          ['nobody at the register shows as unattended', alone && unattended, `${store.unattended.episodes} episodes, now ${mmss(store.unattended.now)}`],
          ['sales are matched to the shopper at the till', seen.length > 0, `${seen.length} sales`],
          ['confidence follows the measured table', right, seen.map((m) => `${m.n}→${m.conf ?? '46-24'}%`).join(', ')],
          ['a busy counter is less certain', busy.length > 0 && busy.every((m) => (m.conf ?? 46) <= 46), busy.length ? `${busy.length} busy sales` : 'no busy sale seen'],
        ];
      },
    },
    {
      id: 'staff',
      enter: () => setShow({ staffFocus: true }),
      readouts: () => [
        { label: 'Enrolled, not counted', value: staff().filter((p) => p.consent).length, tone: 'violet' },
        { label: 'Withdrawn, counted', value: staff().filter((p) => !p.consent).length, tone: 'amber' },
        { label: 'Ledger rows', value: ledger.length },
        { label: 'Till covered', value: atRegister() ? 'yes' : `gap ${mmss(store.coverGap)}`, tone: atRegister() ? 'turq' : 'amber' },
      ],
      actions: () => {
        const s = staff()[1];
        return [{ id: 'consent', label: s?.consent ? `Withdraw ${s.staffId}’s consent` : `Re-grant ${s?.staffId}’s consent`, pressed: !s?.consent }];
      },
      qa(run) {
        const s = staff()[1];
        const excluded = !counted(s);
        const rows = ledger.length;
        this.act('consent');
        run(0.5);
        const nowCounted = counted(s);
        this.act('consent');
        return [
          ['staff are excluded while enrolled', excluded, s.staffId],
          ['withdrawing consent is a new ledger row', ledger.length === rows + 2, `${ledger.length} rows`],
          ['withdrawn, they are no longer recognised', nowCounted],
        ];
      },
      act(id) {
        const s = staff()[1];
        if (id === 'consent' && s) {
          s.consent = !s.consent;
          ledger.push({ at: time(), who: s.staffId, purpose: 'recognition', state: s.consent ? 'granted' : 'withdrawn' });
          event(`consent ${s.consent ? 'granted' : 'withdrawn'} · ${s.staffId}${s.consent ? '' : ' · enrolment revoked'}`);
        }
      },
    },
    {
      id: 'security',
      enter: () => setShow({ security: true }),
      exit() {
        this.pip = false;
        clip.recording = false;
      },
      readouts: () => [
        { label: 'Hours', value: store.afterHours ? 'after hours' : 'trading', tone: store.afterHours ? 'amber' : 'turq' },
        { label: 'Automatic actions', value: 'none, by design' },
        { label: 'Precision, this camera today', value: (() => {
          const done = store.alerts.filter((a) => a.state === 'confirmed' || a.state === 'dismissed');
          return done.length ? `${done.filter((a) => a.state === 'confirmed').length} of ${done.length} confirmed` : 'nothing reviewed yet';
        })() },
        ...store.alerts.slice(0, 3).map((a, i) => ({ label: `${a.at} ${a.kind}`, value: `${a.where} · ${a.state}`, tone: a.state === 'confirmed' ? 'red' : a.state === 'awaiting review' ? 'amber' : 'grey', key: i })),
      ],
      actions: () => [
        { id: 'hours', label: store.afterHours ? 'Open the store' : 'After hours', pressed: store.afterHours },
        ...(!store.afterHours ? [{ id: 'conceal', label: 'Someone lingers in the fitting area' }] : []),
        ...(clip.frames.length ? [{ id: 'evidence', label: slot.chapters?.current?.pip ? 'Close the clip' : 'Play the evidence clip', pressed: !!slot.chapters?.current?.pip }] : []),
        ...(store.alerts[0]?.state === 'awaiting review'
          ? [{ id: 'confirm', label: 'Confirm' }, { id: 'dismiss', label: 'Dismiss' }, { id: 'unclear', label: 'Unclear' }]
          : []),
      ],
      qa(run) {
        this.act('conceal');
        // The walk there, a look at the display, the concealment, then the 8 s after it.
        for (let t = 0; t < 40 && !(clip.flagAt && !clip.recording); t++) run(1);
        const flagged = store.alerts.find((a) => a.kind === 'Concealment');
        const frames = clip.frames.length;
        this.act('hours');
        run(20);
        const alertRaised = store.alerts.find((a) => a.kind === 'Intrusion');
        const waiting = alertRaised?.state === 'awaiting review';
        // (The review is of whichever alert is on top: another may have come in.)
        const top = store.alerts[0];
        this.act('unclear');
        const reviewed = top?.state === 'unclear';
        this.act('hours');
        run(1);
        return [
          ['during trading, concealment is flagged for review', !!flagged && flagged.state === 'awaiting review', flagged ? `${flagged.where}` : 'none'],
          ['its evidence clip is 5 s before and 8 s after, at 6 fps', frames >= (CLIP_BEFORE + CLIP_AFTER) * CLIP_FPS - 3, `${frames} frames`],
          ['after hours, an intrusion is raised', !!alertRaised],
          ['it waits for a person to review it', waiting],
          ['unclear is a review outcome', reviewed],
          ['nothing acts on its own', !store.feed.some((l) => /lock|alarm|notif/i.test(l))],
        ];
      },
      act(id) {
        // Now, or with the first shopper free in the next 20 s (everyone may
        // be at the till or in a booth when it's asked for).
        if (id === 'conceal' && !concealment()) concealWanted = director.time + 20;
        if (id === 'evidence') {
          this.pip = !this.pip;
          clip.play = 0;
          slot.chapters?.emit('pip', this.pip);
          slot.chapters?.emit('pipcaption', 'Evidence clip · for the reviewer');
        }
        if (id === 'hours') setAfterHours(!store.afterHours);
        const top = store.alerts[0];
        if (top && ['confirm', 'dismiss', 'unclear'].includes(id)) {
          top.state = { confirm: 'confirmed', dismiss: 'dismissed', unclear: 'unclear' }[id];
          event(`review · ${top.kind.toLowerCase()} · ${top.state}`);
        }
      },
    },
    {
      id: 'dashboard',
      // The monitor on the office desk, seen through the glass; the page
      // itself, readable, in the explorer's picture.
      pip: true,
      enter: () => {
        setShow({ people: false });
        queueMicrotask(() => slot.chapters?.emit('pipcaption', 'Overview · live from this store'));
      },
      exit() {
        this.report = false;
      },
      readouts: () => [
        { label: 'Cameras', value: `${STREAMS}, batched on the floor, stockroom and perimeter; not at the entrance` },
        { label: 'Inference', value: store.tensorrt ? `TensorRT, ${TENSORRT}× faster` : 'PyTorch', tone: store.tensorrt ? 'turq' : 'grey' },
        { label: 'Throughput', value: store.tensorrt ? `${AGG_FPS} FPS, all six` : 'baseline', tone: store.tensorrt ? 'turq' : 'grey' },
        { label: 'Counts changed', value: 'TensorRT: 0 of 7 clips · batching: 2 of 82 crossings' },
      ],
      actions() {
        return [{ id: 'trt', label: 'TensorRT', pressed: store.tensorrt }, { id: 'report', label: this.report ? 'Back to the live page' : 'Print today’s report', pressed: !!this.report }];
      },
      qa(run) {
        run(2);
        const drawn = dash.clock < 0.6;
        this.act('trt');
        const off = !store.tensorrt;
        this.act('trt');
        this.act('report');
        const r = slot.controller.pip();
        const shows = r?.image === report;
        this.act('report');
        return [
          ['the monitor shows the live dashboard', !!dashPlane && drawn],
          ['TensorRT can be switched', off && store.tensorrt],
          ['the daily report can be printed', shows],
        ];
      },
      act(id) {
        if (id === 'report') {
          this.report = !this.report;
          if (this.report) drawReport();
          slot.chapters?.emit('pipcaption', this.report ? 'Daily report · 07:00' : 'Overview · live from this store');
        }
        if (id === 'trt') {
          store.tensorrt = !store.tensorrt;
          event(store.tensorrt ? 'model: TensorRT engine' : 'model: PyTorch weights (restart required)');
        }
      },
    },
  ];
  // Each chapter's district, as a shot: three.js x, height, z of what to look
  // at; zoom scales the home distance; yaw and pitch turn from the home view.
  const SHOTS = {
    cameras: { zoom: 0.96, pitch: 0.04 },
    coverage: { zoom: 0.96, pitch: 0.28 },
    track: { target: [0, 0.7, 0.3], zoom: 0.6, yaw: 0.05 },
    line: { target: [2.7, 0.6, -0.1], zoom: 0.42, yaw: 0.32, pitch: -0.02 },
    zones: { target: [-3.7, 0.8, -1.8], zoom: 0.5, yaw: -0.2 },
    heat: { target: [-1.1, 0.3, 0.4], zoom: 0.92, pitch: 0.34, yaw: -0.06 },
    parties: { target: [1.9, 0.7, 2.0], zoom: 0.52, yaw: 0.12 },
    pos: { target: [-3.5, 0.8, 1.9], zoom: 0.46, yaw: -0.22 },
    staff: { target: [1.6, 0.9, -1.2], zoom: 0.5, yaw: 0.05 },
    security: { zoom: 0.96, pitch: 0.06 },
    dashboard: { target: [0.65, 1.0, -2.2], zoom: 0.34, yaw: -0.05, pitch: -0.03 },
  };
  for (const c of chapters) if (SHOTS[c.id]) c.shot = SHOTS[c.id];
  const ledger = staff().map((p) => ({ at: '08:55', who: p.staffId, purpose: 'recognition', state: 'granted' }));

  function countInView(role) {
    const cam = cams[role]?.cam;
    if (!cam) return 0;
    const v = new Vector3();
    return people.filter((a) => a.visible && (v.set(a.pos.x, 0.8, a.pos.y).project(cam), v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1)).length;
  }

  // What a store manager would call each place (the spots' keys are the
  // scene's own names for them).
  const PLACE = {
    rail: 'the rail', table: 'the table', denim: 'the denim wall', fold: 'the table', mannequins: 'the window',
    mirror: 'the mirror', fit: 'fitting rooms', pay: 'the till', queue: 'the till queue', cashier: 'the till',
    terminal: 'the till', door: 'the door', in: 'the door', out: 'the door', street: 'outside', stock: 'the stockroom', office: 'the stockroom',
  };
  function nearestPlace(x, z) {
    let best = 'the floor';
    let bd = 0.9;
    for (const [name, s] of Object.entries(data.spots ?? {})) {
      const d = Math.hypot(s.at[0] - x, s.at[2] - z);
      if (d < bd) {
        bd = d;
        best = PLACE[name.split('_')[0]] ?? name.replace(/_\d$/, '').replace(/_/g, ' ');
      }
    }
    return best;
  }

  function moveRailSomewhere() {
    for (const r of rails) {
      const d = drags.get(r);
      if (!d) continue;
      const away = Math.hypot(r.position.x - d.home.x, r.position.z - d.home.z) > 0.05;
      if (away) {
        if (d.reset()) return;
        continue;
      }
      for (const [dx, dz] of [[0.5, 0], [-0.5, 0], [0, 0.4], [0, -0.4], [0.35, 0.3]]) {
        if (d.moveTo(r.position.x + dx, r.position.z + dz)) return;
      }
    }
  }

  const tillCount = () => people.filter((p) => counted(p) && p.role === 'shopper' && zones.till?.contains(p.pos.x, p.pos.y)).length;

  /** A customer who can be sent somewhere now (not at the till, not trying something on, not already on an errand). */
  // (An errand of the store's own rhythm, the door or the window, gives way
  // to what a visitor to the page asks for now.)
  const castable = (q) => q.role === 'shopper' && !q.party && q.visible && q.clip !== 'tryon' &&
    !['queued', 'paying', 'paid', 'checkout', 'fitting'].includes(q.st.phase) && !(q.jobUntil > director.time && !['door', 'linger'].includes(q.job));
  /** ... and inside the store, not on the way out. */
  const freeCustomer = (q) => castable(q) && insideStore(q) && !['exiting', 'leave'].includes(q.st.phase);

  /** Someone stops in the doorway, on the phone, shifting about across the line. */
  function lingerInDoorway() {
    const mid = { x: (line.a[0] + line.b[0]) / 2, z: (line.a[1] + line.b[1]) / 2 };
    const p = director.cast(people, (q) => castable(q) && Math.hypot(q.pos.x - mid.x, q.pos.y - mid.z) < 6, mid);
    if (!p) return false;
    hire(director.redirect(p, (q) => {
      const t = [];
      // Half a step either side of the line, again and again: inside the
      // counter's dead band, across the naive one's line every time.
      for (let k = 0; k < 5; k++) {
        for (const off of [0.07, -0.07]) {
          t.push({ go: [mid.x + off, mid.z + (k % 2 ? 0.12 : -0.12)] }, act('phone', 0.9 + rand() * 0.6, [mid.x - 2, mid.z]));
        }
      }
      q.st.tasks.push(...t);
    }), 'linger', 30);
    event('someone lingers in the doorway');
    return true;
  }

  /** The cashier leaves the register to help at the fitting rooms (or comes back). */
  function cashierAway(back = !atRegister()) {
    const c = people.find((p) => p.role === 'cashier');
    const home = spot('cashier');
    if (!c || !home) return;
    const help = spot('fit_wait') ?? spot('mirror');
    c.fixed = false;
    c.st.tasks = back
      ? [go(home), { call: () => (c.fixed = true) }]
      : [go(help), act('point', 30, help.face), go(home), { call: () => (c.fixed = true) }];
    c.task = null;
    c.path = null;
    event(back ? 'cashier back at the register' : 'cashier away from the register');
  }

  /**
   * Someone in the fitting area stops, bends a little, and goes hand to hip
   * pocket: two signals with hand-at-hip among them, so the concealment rule
   * (security/detectors.py) flags them for a person to review. The camera
   * that sees them records the clip.
   */
  let concealWanted = 0;
  director.flow('conceal', { every: 1, when: () => concealWanted > director.time && !store.afterHours, run: () => {
    if (!concealment()) return null;
    concealWanted = 0;
    return clip.who;
  } });

  function concealment() {
    // Whoever is free, nearest the middle of the floor, at the display
    // nearest them that nobody holds (the mirror by the fitting rooms if close).
    const mid = spot('fold') ?? { x: 0, z: 0 };
    const p = director.cast(people, (q) => castable(q) && insideStore(q), mid);
    if (!p) return false;
    const at = [spot('mirror'), ...stations().filter((q) => q.clip === 'browse')]
      .filter((q) => q && b.crowd.free(q.key ?? 'mirror', p))
      .sort((m, n) => Math.hypot(m.x - p.pos.x, m.z - p.pos.y) - Math.hypot(n.x - p.pos.x, n.z - p.pos.y))[0];
    if (!at) return false;
    at.face ??= at.look ? Math.atan2(at.look[0] - at.x, at.look[1] - at.z) : 0;
    // Whichever camera sees that corner best keeps a clip from now.
    const best = Object.entries(cams).map(([r, c]) => {
      const v = new Vector3(at.x, 1, at.z).project(c.cam);
      return [r, v.z < 1 && Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95 ? 1 - Math.hypot(v.x, v.y) : -1];
    }).sort((x, y) => y[1] - x[1])[0];
    clip.cam = cams[best?.[0] ?? 'floor']?.cam ?? null;
    clip.frames = [];
    clip.flagAt = 0;
    clip.recording = true;
    clip.who = p;
    hire(director.redirect(p, (q) => {
      q.st.tasks.push(
        { go: [at.x, at.z] },
        act('browse', 2.5, at.face, { at }),
        act('conceal', 6, at.face, { at }),
        {
          call: () => {
            q.flagged = true;
            clip.flagAt = director.time;
            alert('Concealment', nearestPlace(q.pos.x, q.pos.y), q);
          },
        },
        act('idle', 1.5, at.face),
      );
    }), 'conceal', 30);
    return true;
  }

  function sendToTill(n) {
    store.hold = n > 1 ? { n, until: store.clock + 30 * 6 } : null; // 30 s (in store time)
    // The shoppers nearest the queue head for the till until n are there
    // (through the director, so nobody is sent twice).
    const there = () => people.filter((p) => p.role === 'shopper' && p.visible && ['queued', 'paying', 'checkout', 'paid'].includes(p.st.phase));
    let need = n - there().length;
    while (need > 0) {
      // Anyone free inside; or a family, who arrive at the counter together
      // (the leader goes, the rest follow).
      const p = director.cast(people, (q) => q.role === 'shopper' && insideStore(q) && (!q.party || q === q.leader) && ['browse', 'fitting'].includes(q.st.phase) && q.clip !== 'tryon' && !(q.jobUntil > director.time), spot('queue_0'));
      if (!p) break;
      need -= p.party ? people.filter((q) => q.leader === p && q.visible).length : 1;
      hire(director.redirect(p, (q) => {
        q.st.phase = 'checkout';
        q.st.buy = true;
      }), 'till', 30);
    }
    // Not enough free inside: the next customers through the door go straight to the till.
    store.tillWanted = Math.max(0, need);
  }

  // ---------------------------------------------------------------- frame
  const floorPt = (ray) => {
    const p = b.floorPoint(ray);
    if (!p) return null;
    const A = b.area(0.05);
    p.x = Math.min(A.x1, Math.max(A.x0, p.x));
    p.z = Math.min(A.z1, Math.max(A.z0, p.z));
    return p;
  };

  setShow({ trails: true });

  return {
    chapters,
    agents: b.agents,
    grid: b.grid,
    crowd: b.crowd,
    districts,
    /** Is (x, z) inside the shop (not the street, the alley or the pavement)? */
    indoors: (x, z) => inPoly(x, z, INDOORS),
    store,
    heat,
    seeding: () => seedLegs.length,
    director,
    /** A chapter opened (the runner tells us): its beat. */
    onChapter: (id) => director.enter(id),
    /**
     * QA: what each chapter's beat makes happen, as a number that goes up
     * when it does (a crossing, a sale, a badge-in, someone behind a drawn
     * curtain, someone loitering, the family in view).
     */
    beatMeter: {
      line: { event: () => store.entries + store.exits },
      pos: { state: () => people.some((p) => p.visible && p.clip === 'pay') },
      staff: { event: () => store.feed.filter((l) => l.includes('badge')).length },
      track: { state: () => people.some((p) => p.visible && curtained(p)) },
      zones: { state: () => people.some((p) => p.visible && (p.loiter || (p.task?.act && p.task.secs >= 20))) },
      parties: { state: () => people.some((p) => p.party && p.visible && p.fade > 0.9) },
    },
    pip: () => {
      const c = slot.chapters?.current;
      if (!c?.pip) return null;
      if (c.id === 'dashboard') return { image: c.report ? report : dash.canvas, fps: 4 };
      if (c.id === 'security') return { camera: clip.cam ?? cams.floor.cam, fps: CLIP_FPS, draw2d: clipPip };
      return { camera: cams[selectedCam]?.cam, fps: fps(), draw2d: pip2d };
    },
    /** The main view's detection boxes, drawn onto the frame after it lands. */
    draw2d(g, w, h, camera) {
      if (!show.boxes || !detections.length) return;
      // On a small canvas (a phone's card) the tags say only who: the ID.
      const small = (slot.css?.w ?? 1000) < 600;
      const items = small ? detections.map((d) => ({ ...d, tag: d.tag.replace(/^(person [\d.]+|staff) · /, '').replace(/ · \+1 (in|out)$/, ' +1') })) : detections;
      drawDetections(g, w, h, camera, items, { px: slot.css?.w ? w / slot.css.w : 1 });
    },
    pickables: () => [...b.picks, ...clickables, ...lineHandles, ...zoneHandles, planHandle, ...people.filter((p) => p.visible).map((p) => p.proxy)].filter((o) => o.visible !== false),
    onDrag(phase, hit, ev, ray) {
      const p = floorPt(ray);
      if (!p) return;
      const h = hit.object.userData.handle;
      if (h?.kind === 'line') {
        line[h.key] = [p.x, p.z];
        if (phase === 'end') {
          ctx.emit('line', 'moved');
          event('line moved · applied live, counts kept');
        }
      } else if (h?.kind === 'zone') {
        const z = zones[h.key];
        const pts = z.points.map((q) => [...q]);
        pts[h.index] = [p.x, p.z];
        z.setPoints(pts);
        if (phase === 'end') {
          ctx.emit('zone', h.key);
          event(`zone ${h.key} reshaped · applied live`);
        }
      } else if (h?.kind === 'plan') {
        plan.x = p.x;
        plan.z = p.z;
        placePlan();
        if (phase === 'end') {
          measureCoverage();
          event('camera planned · coverage re-measured');
        }
      } else if (drags.has(hit.object)) {
        const d = drags.get(hit.object);
        if (phase === 'start') d.start(p);
        else if (phase === 'move') d.move(p);
        else d.end();
      }
      placeHandles();
    },
    onClick(hit) {
      // A camera, a mannequin: find the piece that was tagged (the hit may be a child).
      let o = hit.object;
      while (o && !o.userData.camRole && !o.userData.mannequin && o.parent) o = o.parent;
      const cur = slot.chapters?.current;
      if (o?.userData.camRole) {
        if (cur?.id !== 'cameras') slot.chapters?.go('cameras');
        slot.chapters?.act(o.userData.camRole);
        return;
      }
      if (o?.userData.mannequin) {
        if (cur?.id !== 'track') slot.chapters?.go('track');
        slot.chapters?.act('ignore');
        return;
      }
      const a = hit.object.userData.agent;
      if (a?.role === 'cashier' && cur?.id === 'pos') {
        slot.chapters.act('away');
        return;
      }
      if (a && slot.chapters?.current?.id === 'track' && a.role === 'shopper') {
        following = a;
        ctx.rig.setShot({ target: [a.pos.x, 0.8, a.pos.y], zoom: 0.45 });
        ctx.emit('follow', String(a.track));
      } else if (a) {
        ctx.emit('person', a.staffId ?? String(a.track));
      }
    },
    update(dt) {
      store.clock += dt * 6; // a store minute passes every ten seconds
      healthTick(dt * 6);
      if ((districtT -= dt) <= 0) {
        districts.tick(0.2 - districtT, people);
        districtT = 0.2;
      }
      mannequinTick(dt * 6);
      recordClip(dt);
      // People who left come back as someone new, a little later.
      for (const a of people) {
        if (a.visible || store.afterHours) continue;
        if (a.st.back == null) {
          // Just left: their trail goes with them, and someone new comes by later.
          trails.drop(a.track);
          a.st.back = 6 + rand() * 8;
        }
        // A party arrives together, by the same way in: the leader first, the
        // rest right behind (they don't wait on timers of their own).
        const follower = a.party && a !== a.leader;
        if (follower && !a.leader.visible) continue;
        // A leader comes back only once the whole party has left.
        if (!follower && a.party && people.some((p) => p.leader === a && p !== a && p.visible)) continue;
        a.st.back -= dt;
        if (!follower && a.st.back > 0) continue;
        if (!follower && a.role === 'shopper' && !roomFor(a)) {
          a.st.back = 1.5;
          continue;
        }
        // One visitor (or party) at a time through the door, 6 to 9 s apart.
        if (!follower && a.role === 'shopper' && director.time < store.nextArrival) {
          a.st.back = 0.5;
          continue;
        }
        const portal = follower ? a.leader.enteredBy : pickPortal();
        if (!b.crowd.enter(a, portal)) continue;
        a.enteredBy = portal;
        if (!follower && a.role === 'shopper') store.nextArrival = director.time + 6 + rand() * 3;
        a.crumbs = [];
        newVisitor(a);
        a.st = { tasks: [], phase: a.role === 'passer' ? 'stroll' : 'street' };
        a.visitStart = store.clock;
        a.loiter = false;
      }
      // After hours: once the shoppers have gone, someone comes in.
      if (store.afterHours && intruderTimer > 0) {
        intruderTimer -= dt;
        if (intruderTimer <= 0 && !intruder.visible && b.crowd.enter(intruder, b.portals.find((p) => p.name === 'alley')?.name ?? b.portals.at(-1)?.name)) {
          intruder.st = { tasks: [], phase: 'enter' };
          alert('Intrusion', 'after hours, shop floor', intruder);
        }
      }
      lightState.k += (lightState.target - lightState.k) * (1 - Math.exp(-dt * 2.5));
      baked.forEach((m, i) => (m.lightMapIntensity = baseIntensity[i] * lightState.k));
      lights.forEach(([l, i]) => (l.intensity = i * lightState.k));

      b.update(dt);
      measure(dt);
      b.lines.begin();
      drawPeople(dt);
      if (show.line) drawLine();
      if (show.zones || show.pos) drawZones();
      if (show.cams) drawCameras();
      if (show.pos || store.lastMatch) drawMatch(dt);
      b.lines.end();
      moveParts(dt);
      living.update(dt, { clock: store.clock, people: people.concat(intruder) });
      director.update(dt);
      if (seedLegs.length) seedHeat();
      heat.update(dt);
      if (trails.mesh.visible) trails.update();
      dash.update(dt, {
        entries: store.entries,
        exits: store.exits,
        occupancy: people.filter((p) => counted(p) && insideStore(p)).length,
        sales: store.sales,
        parties: store.parties,
        series: store.series.concat(store.bucket),
        zones: Object.entries(store.dwell).map(([name, a]) => ({ name, secs: a.n ? a.sum / a.n : 0 })),
        feed: store.feed,
        fps: store.tensorrt ? AGG_FPS : 'PyTorch',
        streams: STREAMS,
      });
    },
    snapshot() {
      return {
        rails: rails.map((r) => ({ name: r.name, x: r.position.x, z: r.position.z })),
        line: { a: line.a, b: line.b },
        store: { entries: store.entries, exits: store.exits, sales: store.sales, parties: store.parties },
      };
    },
    resume(s) {
      for (const r of s?.rails ?? []) {
        const rail = rails.find((q) => q.name === r.name);
        const d = rail && drags.get(rail);
        if (d?.fits(r.x, r.z)) {
          rail.position.x = r.x;
          rail.position.z = r.z;
          d.stamp();
        }
      }
      if (s?.line) Object.assign(line, s.line);
      if (s?.store) Object.assign(store, s.store);
      placeHandles();
    },
    reset() {
      for (const d of drags.values()) d.reset();
      const l = data.lines?.entrance;
      if (l) {
        line.a = [l[0][0], l[0][2]];
        line.b = [l[1][0], l[1][2]];
      }
      placeHandles();
      if (store.afterHours) setAfterHours(false);
    },
    dispose() {
      b.dispose();
      intruder.fig.root.removeFromParent();
      heat.dispose();
      rings.dispose();
      trails.dispose();
      Object.values(zones).forEach((z) => z.dispose());
      [...lineHandles, ...zoneHandles].forEach((h) => h.removeFromParent());
      handleGeo.dispose();
      handleMat.dispose();
      pickGeo.dispose();
      pickMat.dispose();
      dash.dispose();
      living.dispose();
      coverage.dispose();
      planMarker.geometry.dispose();
      planMarker.material.dispose();
      planMarker.removeFromParent();
      planHandle.removeFromParent();
      dashPlane?.geometry.dispose();
      dashPlane?.removeFromParent();
    },
  };
}

function hexGlow(hex, k) {
  const c = parseInt(hex.slice(1), 16);
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [lin((c >> 16) & 255) * k, lin((c >> 8) & 255) * k, lin(c & 255) * k];
}
