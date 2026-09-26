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

import { Dashboard } from '../overlays/dashboard.js';
import { confidence, drawDetections } from '../overlays/detect2d.js';
import { HeatMap, Trails, Zone } from '../overlays/floor.js';
import { Rings } from '../overlays/rings.js';
import { GLOW, OVERLAY_LAYER } from '../overlays/lines.js';
import { resolveOutfit } from '../people.js';
import { Director } from '../sim/director.js';
import { footprint, inPoly } from '../sim/grid.js';
import { base } from './base.js';

// ---------------------------------------------------------------- measured facts (docs)
// Till matching: LIMITATIONS.md, "Situation at the till".
const MATCH = { 1: 87, 2: 46, 4: 24 };
const TENSORRT = 2.4; // x faster, 0 of 7 test clips changed count
const STREAMS = 6;
const AGG_FPS = 143; // aggregate, six streams, laptop RTX 3050 Ti
const LOITER_SECS = 20; // Zone.loiter_seconds is per zone; this store's fitting area

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
  /** Browse spots either side of a rail, wherever it has been dragged. */
  const railSpots = (r) => {
    const th = r.rotation.y;
    const nx = Math.sin(th);
    const nz = Math.cos(th);
    return [1, -1].map((s) => ({ x: r.position.x + nx * 0.44 * s, z: r.position.z + nz * 0.44 * s, look: [r.position.x, r.position.z], key: `${r.name}:${s}` }));
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
  const BEHIND_COUNTER = [[-5.7, 0.2], [-4.9, 0.2], [-4.9, 2.4], [-5.7, 2.4]];
  const INDOORS = [[-5.7, -3.8], [3.25, -3.8], [3.25, 3.8], [-5.7, 3.8]];
  const keepOutFor = (role) => (role === 'passer' ? [INDOORS] : isStaffRole(role) ? null : [BACK_OF_HOUSE, BEHIND_COUNTER]);
  for (const [i, entry] of cast.entries()) {
    const role = entry.role ?? 'shopper';
    const a = b.agent(entry, { think: (ag) => brain(ag), fixed: role === 'cashier' });
    a.role = role;
    a.keepOut = keepOutFor(role);
    a.party = entry.party ?? null;
    a.material = a.fig.material;
    a.track = isStaffRole(role) ? null : store.nextId++;
    a.staffId = isStaffRole(role) ? `S-0${people.filter((p) => isStaffRole(p.role)).length + 1}` : null;
    a.consent = isStaffRole(role);
    a.entered = role === 'shopper' ? 0 : null;
    a.visitStart = 0;
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
    for (const q of booths) {
      const inside = people.some((p) => p.visible && p.clip === 'tryon' && Math.hypot(p.pos.x - q.spot.x, p.pos.y - q.spot.z) < 0.4);
      q.k = ease(q.k, inside ? 1 : 0.26, 4);
      q.curtain.scale.x = q.k;
    }
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
  const randomStation = () => {
    const all = stations();
    return all[Math.floor(rand() * all.length)];
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
    const n = 1 + Math.floor(rand() * 3);
    st.stops = [];
    for (let i = 0; i < n; i++) st.stops.push(randomStation());
    st.fit = !a.party && rand() < 0.35;
    st.buy = rand() < (a.party ? 0.6 : 0.5);
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
        if (!st.stops) planVisit(a);
        let s = st.stops.shift();
        // Someone is already there: try another station rather than wait.
        for (let tries = 0; s && !b.crowd.free(s.key, a) && tries < 4; tries++) s = randomStation();
        if (s && !b.crowd.free(s.key, a)) s = st.stops.shift();
        if (s) {
          st.tasks.push(act(s.clip, 3 + rand() * 4, s.look ?? s.face, { claim: s.key, at: s }));
          return go(s, { claim: s.key });
        }
        st.phase = st.fit ? 'fitting' : st.buy ? 'checkout' : 'leave';
        if (!st.buy && !st.fit) store.short++;
        return act('idle', 0.4);
      }
      case 'fitting': {
        const free = FIT.find((k) => b.crowd.free(k, a));
        if (!free) return act('idle', 1.5, [spot('fit_0').x, spot('fit_0').z], { claim: 'fit_wait' });
        st.phase = st.buy ? 'checkout' : 'leave';
        if (!st.buy) store.short++;
        const s = spot(free);
        st.tasks.push(act('tryon', 5 + rand() * 3, s.face, { claim: free, at: s }), go(spot('fit_wait')));
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
          if (st.phase !== 'paid') {
            st.phase = 'paid';
            st.tasks.push({ call: () => sale(a) });
            return act('pay', 3.2, spot('pay').face, { claim: 'pay' });
          }
          st.phase = 'leave';
          store.converted++;
          return act('idle', 0.3);
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
        // Out through the door, then along the street into a portal, where
        // they fade (the only place anyone leaves the scene).
        st.phase = 'exiting';
        st.exit = pickPortal();
        // Through the out lane without stopping (the lane's spots are waypoints).
        st.tasks.push(go(spot('out_out') ?? spot('door_out'), { via: true }), { exit: st.exit });
        return go(spot('out_in') ?? spot('door_in'), { via: true });
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
    const place = () => {
      // Behind the leader to one side; where a table or rail is in the way,
      // the free place beside the leader nearest to it (never across a fixture).
      const ang = L.heading + Math.PI + (i === 1 ? 0.9 : -0.9);
      // 0.7 m off: two bodies (0.53) and a hand's breadth between them.
      const want = [L.pos.x + Math.sin(ang) * 0.7, L.pos.y + Math.cos(ang) * 0.7];
      if (b.grid.free(want[0], want[1]) && b.grid.los(L.pos.x, L.pos.y, want[0], want[1])) return want;
      let best = [L.pos.x, L.pos.y];
      let bd = Infinity;
      for (let k = 0; k < 12; k++) {
        const t = (k / 12) * Math.PI * 2;
        const x = L.pos.x + Math.sin(t) * 0.7;
        const z = L.pos.y + Math.cos(t) * 0.7;
        if (!b.grid.free(x, z) || !b.grid.los(L.pos.x, L.pos.y, x, z)) continue;
        const dd = Math.hypot(x - want[0], z - want[1]);
        if (dd < bd) {
          bd = dd;
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
    const payer = people.find((p) => p.claim === 'pay' && p.clip === 'pay');
    return payer ? act('scan', 1.2, s.face) : act('type', 1.6, s.face);
  }

  function floorStaff(a) {
    const st = a.st;
    const second = staff().filter((p) => p.role === 'staff').indexOf(a) === 1;
    if (store.afterHours) return near(a, spot('lockers') ?? spot('stock_door'), 0.4) ? act('idle', 2) : go(spot('lockers') ?? spot('stock_door'));
    // The first keeps the tables folded and the rails straight; the second
    // looks after the denim wall and, now and then, badges into the staff
    // room (the reader by its door) for stock.
    st.i = ((st.i ?? -1) + 1) % (second ? 4 : 3);
    if (st.badgeNow) st.i = 2; // the director asked for a badge-in now
    if (!second && st.i === 0) {
      const s = spot('fold');
      st.tasks.push(act('fold', 8 + rand() * 4, s.face, { claim: 'fold', at: s }));
      return go(s, { claim: 'fold' });
    }
    if (second && st.i < 2) {
      const s = spot(st.i ? 'denim_3' : 'denim_2');
      const key = st.i ? 'denim_3' : 'denim_2';
      if (!b.crowd.free(key, a)) return act('idle', 1);
      st.tasks.push(act(st.i ? 'point' : 'fold', 5 + rand() * 3, s.face, { claim: key, at: s }));
      return go(s, { claim: key });
    }
    if (st.i === 2 && spot('badge') && (second || st.badgeNow)) {
      st.badgeNow = false;
      const bd = spot('badge');
      st.tasks.push(
        act('scan', 1.6, bd.face, { at: bd }),
        { call: () => badged(a) },
        go(spot('lockers') ?? spot('stock_shelf')),
        act('idle', 2.5, (spot('lockers') ?? spot('stock_shelf')).face),
      );
      return go(bd);
    }
    const r = rails[(st.i + (second ? 1 : 0)) % rails.length] ?? rails[0];
    const s = railSpots(r).find((q) => b.crowd.free(q.key, a));
    if (!s) return act('idle', 1);
    st.tasks.push(act('browse', 4 + rand() * 2, s.look, { claim: s.key }));
    return go(s, { claim: s.key });
  }

  /** A badge at the reader: what the platform logs (recognition, by consent). */
  function badged(a) {
    a.flash = 1;
    event(a.consent ? `badge · ${a.staffId} · staff, not counted` : `badge · ${a.staffId} · consent withdrawn, counted`);
  }

  function stockClerk(a) {
    const st = a.st;
    st.i = ((st.i ?? -1) + 1) % 2;
    const box = a.fig.root.getObjectByName('box');
    if (st.i === 0) {
      // Pick up a carton in the stockroom.
      const s = spot('stock_shelf');
      st.tasks.push(act('idle', 2.5, s.face, { at: s }), { call: () => { if (box) box.visible = true; a.walkClip = 'carry'; } });
      if (box) box.visible = false;
      a.walkClip = 'walk';
      return go(s, { claim: 'stock_shelf' });
    }
    if (store.afterHours) return go(spot('lockers') ?? spot('stock_shelf'));
    // Restock a rail on the floor.
    const r = rails[Math.floor(rand() * rails.length)];
    const s = railSpots(r).find((q) => b.crowd.free(q.key, a));
    if (!s) return act('idle', 1);
    st.tasks.push(act('browse', 3.5, s.look, { claim: s.key }), { call: () => { if (box) box.visible = false; a.walkClip = 'walk'; } });
    return go(s, { claim: s.key });
  }

  function manager(a) {
    // Works at the office desk (its monitor is the live dashboard), and now
    // and then walks the floor to the till and back.
    const st = a.st;
    const office = spot('office');
    st.i = ((st.i ?? -1) + 1) % 4;
    if (!office) return act('idle', 2);
    if (st.i < 3 || store.afterHours) {
      if (!near(a, office, 0.35)) return go(office);
      return act(st.i === 1 ? 'type' : 'point', 5 + rand() * 5, office.face);
    }
    const t = spot('table_side');
    st.tasks.push(act('talk', 3 + rand() * 2, [spot('cashier').x, spot('cashier').z], { at: t }), go(office));
    return go(t);
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
  const sendToDoor = () => {
    // Someone new along the street (a visitor between visits comes back now),
    // or someone who has browsed long enough heads out.
    const away = people.find((p) => !p.visible && p.role === 'shopper' && !p.party && (p.st.back ?? 0) > 0.3);
    if (away) {
      away.st.back = 0.2;
      return away;
    }
    return hire(director.redirect(director.cast(people, (p) => browsing(p) && store.clock - p.visitStart > 60 * 2, doorSpot), (p) => (p.st.phase = 'leave')), 'door', 20);
  };
  const tillBusy = () => QUEUE.some((q) => !b.crowd.free(q)) || people.some((p) => p.visible && onJob(p, 'till'));
  const castToTill = () => hire(director.redirect(director.cast(people, browsing, spot('queue_0')), (p) => {
    p.st.phase = 'checkout';
    p.st.buy = true;
  }), 'till', 30);
  const fittingBusy = () => people.some((p) => p.visible && (p.clip === 'tryon' || onJob(p, 'fitting')));
  const sendToFit = () => hire(director.redirect(director.cast(people, browsing, spot('fit_wait')), (p) => (p.st.phase = 'fitting')), 'fitting', 25);
  const lingering = () => people.some((p) => p.visible && (p.loiter || (p.task?.act && p.task.secs >= 20) || onJob(p, 'linger')));
  const sendToLinger = () => hire(director.redirect(director.cast(people, browsing, spot('mannequins')), (p) => (p.st.phase = 'linger')), 'linger', 45);
  director.flow('door', { every: 3, when: () => !store.afterHours && !doorBusy(), run: sendToDoor });
  director.flow('till', { every: 5, when: () => !store.afterHours && !tillBusy(), run: castToTill });
  director.flow('fitting', { every: 6, when: () => !store.afterHours && !fittingBusy(), run: sendToFit });
  director.flow('linger', { every: 9, when: () => !store.afterHours && !lingering(), run: sendToLinger });
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
    const now = d > 0.12 ? 'out' : d < -0.12 ? 'in' : null;
    if (!now) return;
    const was = a.side;
    a.side = now;
    if (!was || was === now || t < -0.2 || t > 1.2) return;
    if (now === 'in') {
      store.entries++;
      store.bucket++;
      a.visitStart = store.clock;
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
  function measure(dt) {
    for (const a of people.concat(intruder)) {
      if (!a.visible) continue;
      // The store's floor, as its own cameras see it: not the pavement outside.
      if ((counted(a) && a.role !== 'passer') || a === intruder) heat.add(a.pos.x, a.pos.y, dt);
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
  const show = { people: true, boxes: false, track: false, trails: true, line: false, zones: false, heat: false, cams: false, parties: false, pos: false, staffFocus: false, security: false };
  function setShow(o) {
    Object.assign(show, { people: true, boxes: false, track: false, trails: false, line: false, zones: false, heat: false, cams: false, parties: false, pos: false, staffFocus: false, security: false }, o);
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
      if (isStaff && show.staffFocus) sub = recognised ? 'staff · not counted' : 'not recognised · counted';
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
    labels.set('match', { text: m.conf != null ? `match ${m.conf}%` : 'match 46 to 24%', sub: `${m.n} at the counter`, tone: 'violet', at: [from.x, 1.7, from.z], priority: true });
  }

  // ---------------------------------------------------------------- picture-in-picture
  // A store camera's own picture: its view of the people, drawn with the same
  // boxes as the main view, sized to the picture.
  function pip2d(g, w, h) {
    const cam = cams[selectedCam]?.cam;
    if (!cam) return;
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
    drawDetections(g, w, h, cam, items, { px: w / 520 });
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
  }

  // ---------------------------------------------------------------- chapters
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
        { label: 'People in view', value: countInView(selectedCam) },
      ],
      actions: () => Object.keys(cams).map((r) => ({ id: r, label: r.replace('_', ' '), pressed: r === selectedCam })),
      qa(run) {
        this.act('checkout');
        run(0.2);
        const v = ctx.slot.controller.pip();
        return [
          ['six cameras, one per role', Object.keys(cams).length === 6, Object.keys(cams).join(', ')],
          ['a camera can be chosen', selectedCam === 'checkout' && v?.camera === cams.checkout.cam, selectedCam],
          ['its picture sees people', countInView('checkout') > 0, `${countInView('checkout')} in view`],
        ];
      },
      act(id) {
        if (cams[id]) {
          selectedCam = id;
          slot.chapters?.emit('pipcaption', ROLE_LABEL[id]);
        }
      },
    },
    {
      id: 'track',
      enter: () => setShow({ trails: true, track: true }),
      exit: () => (following = null),
      readouts: () => [
        { label: 'Tracked now', value: people.filter((p) => p.visible).length, tone: 'turq' },
        { label: 'Customers', value: people.filter((p) => counted(p) && p.role === 'shopper').length },
        { label: 'Staff (not counted)', value: staff().filter((p) => p.consent).length, tone: 'grey' },
        ...(following ? [{ label: 'Following', value: `ID ${following.track}`, tone: 'turq' }] : []),
      ],
      actions: () => (following ? [{ id: 'unfollow', label: 'Stop following' }] : []),
      qa(run) {
        const a = people.find((p) => p.role === 'shopper' && p.visible);
        const id = a?.track;
        run(8);
        return [
          ['everyone in view is tracked', people.filter((p) => p.visible).length >= 8, `${people.filter((p) => p.visible).length} tracked`],
          ['an ID stays with its person', !a?.visible || a.track === id, `ID ${id}`],
          ['staff are told apart', staff().every((p) => p.consent), staff().map((p) => p.staffId).join(', ')],
        ];
      },
      act(id) {
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
      readouts: () => [
        { label: 'Entries', value: store.entries, tone: 'turq' },
        { label: 'Exits', value: store.exits, tone: 'violet' },
        { label: 'In store now', value: people.filter((p) => counted(p) && insideStore(p)).length },
      ],
      actions: () => [{ id: 'reset_line', label: 'Put the line back' }],
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
        ];
      },
      act(id) {
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
      enter: () => setShow({ heat: true }),
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
      // The camera keeps the family in view as they go round.
      update: () => {
        const g = people.filter((p) => p.party && p.visible);
        if (g.length) slot.rig.aim(new Vector3(g.reduce((n, p) => n + p.pos.x, 0) / g.length, 0.7, g.reduce((n, p) => n + p.pos.y, 0) / g.length));
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
        return [
          { label: 'At the counter', value: n },
          { label: 'Last match', value: m ? (m.conf != null ? `${m.conf}%` : '46 to 24%') : 'waiting for a sale', tone: 'violet' },
          { label: 'Sales today', value: store.sales },
        ];
      },
      actions: () => [
        { id: 'q1', label: '1 at the counter' },
        { id: 'q2', label: '2 together' },
        { id: 'q4', label: '4 queuing' },
      ],
      act(id) {
        const n = { q1: 1, q2: 2, q4: 4 }[id];
        if (n) sendToTill(n);
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
        return [
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
        ...staff().map((p) => ({ label: p.staffId, value: p.consent ? 'enrolled · excluded' : 'withdrawn · counted', tone: p.consent ? 'violet' : 'amber' })),
        { label: 'Ledger rows', value: ledger.length },
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
      readouts: () => [
        { label: 'Hours', value: store.afterHours ? 'after hours' : 'trading', tone: store.afterHours ? 'amber' : 'turq' },
        { label: 'Automatic actions', value: 'none, by design' },
        ...store.alerts.slice(0, 3).map((a, i) => ({ label: `${a.at} ${a.kind}`, value: `${a.where} · ${a.state}`, tone: a.state === 'confirmed' ? 'red' : a.state === 'awaiting review' ? 'amber' : 'grey', key: i })),
      ],
      actions: () => [
        { id: 'hours', label: store.afterHours ? 'Open the store' : 'After hours', pressed: store.afterHours },
        ...(store.alerts[0]?.state === 'awaiting review'
          ? [{ id: 'confirm', label: 'Confirm' }, { id: 'dismiss', label: 'Dismiss' }, { id: 'unclear', label: 'Unclear' }]
          : []),
      ],
      qa(run) {
        this.act('hours');
        run(20);
        const alertRaised = store.alerts.find((a) => a.kind === 'Intrusion');
        const waiting = alertRaised?.state === 'awaiting review';
        this.act('unclear');
        const reviewed = alertRaised?.state === 'unclear';
        this.act('hours');
        run(1);
        return [
          ['after hours, an intrusion is raised', !!alertRaised],
          ['it waits for a person to review it', waiting],
          ['unclear is a review outcome', reviewed],
          ['nothing acts on its own', !store.feed.some((l) => /lock|alarm|notif/i.test(l))],
        ];
      },
      act(id) {
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
      readouts: () => [
        { label: 'Cameras', value: `${STREAMS} batched` },
        { label: 'Inference', value: store.tensorrt ? `TensorRT, ${TENSORRT}× faster` : 'PyTorch', tone: store.tensorrt ? 'turq' : 'grey' },
        { label: 'Throughput', value: store.tensorrt ? `${AGG_FPS} FPS, all six` : 'baseline', tone: store.tensorrt ? 'turq' : 'grey' },
        { label: 'Counts changed', value: '0 of 7 test clips' },
      ],
      actions: () => [{ id: 'trt', label: 'TensorRT', pressed: store.tensorrt }],
      qa(run) {
        run(2);
        const drawn = dash.clock < 0.6;
        this.act('trt');
        const off = !store.tensorrt;
        this.act('trt');
        return [
          ['the monitor shows the live dashboard', !!dashPlane && drawn],
          ['TensorRT can be switched', off && store.tensorrt],
        ];
      },
      act(id) {
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

  function sendToTill(n) {
    store.hold = n > 1 ? { n, until: store.clock + 20 * 6 } : null; // 20 s of store time
    // The shoppers nearest the queue head for the till until n are there
    // (through the director, so nobody is sent twice).
    const there = () => people.filter((p) => p.role === 'shopper' && p.visible && ['queued', 'paying', 'checkout', 'paid'].includes(p.st.phase));
    let need = n - there().length;
    while (need-- > 0) {
      const p = director.cast(people, (q) => q.role === 'shopper' && !q.party && ['browse', 'fitting', 'enter'].includes(q.st.phase) && !(q.jobUntil > director.time), spot('queue_0'));
      if (!p) break;
      hire(director.redirect(p, (q) => {
        q.st.phase = 'checkout';
        q.st.buy = true;
      }), 'till', 30);
    }
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
      if (c.id === 'dashboard') return { image: dash.canvas, fps: 4 };
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
    pickables: () => [...b.picks, ...lineHandles, ...zoneHandles, ...people.filter((p) => p.visible).map((p) => p.proxy)].filter((o) => o.visible !== false),
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
      } else if (drags.has(hit.object)) {
        const d = drags.get(hit.object);
        if (phase === 'start') d.start(p);
        else if (phase === 'move') d.move(p);
        else d.end();
      }
      placeHandles();
    },
    onClick(hit) {
      const a = hit.object.userData.agent;
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
      // People who left come back as someone new, a little later.
      for (const a of people) {
        if (a.visible || store.afterHours) continue;
        if (a.st.back == null) {
          // Just left: their trail goes with them, and someone new comes by later.
          trails.drop(a.track);
          a.st.back = 2 + rand() * 4;
        }
        // A party arrives together, by the same way in: the leader first, the
        // rest right behind (they don't wait on timers of their own).
        const follower = a.party && a !== a.leader;
        if (follower && !a.leader.visible) continue;
        // A leader comes back only once the whole party has left.
        if (!follower && a.party && people.some((p) => p.leader === a && p !== a && p.visible)) continue;
        a.st.back -= dt;
        if (!follower && a.st.back > 0) continue;
        const portal = follower ? a.leader.enteredBy : pickPortal();
        if (!b.crowd.enter(a, portal)) continue;
        a.enteredBy = portal;
        newVisitor(a);
        a.st = { tasks: [], phase: a.role === 'passer' ? 'stroll' : 'street' };
        a.visitStart = 0;
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
