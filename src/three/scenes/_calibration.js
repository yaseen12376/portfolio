/**
 * The calibration fixture: not a project, and never shown as one. It proves
 * every engine piece a real scene uses, on the smallest room that can: a crowd
 * on the nav grid with collision, a fixture moved by hand (with collision), a
 * counting line and a zone whose corners can be dragged, dwell timers,
 * a heatmap, trails, brackets and labels, and chapters driving all of it.
 * scripts/qa/*.mjs run against it with ?3d=cal and the qa/3d.html bench.
 */
import { CylinderGeometry, Mesh, MeshBasicMaterial } from 'three';

import { GLOW, OVERLAY_LAYER } from '../overlays/lines.js';
import { HeatMap, Trails, Zone } from '../overlays/floor.js';
import { base } from './base.js';
import { cross, floorPointOn, rng } from './kit/util.js';

export const meta = {
  tour: ['track', 'line', 'heat'],
  chapters: [
    { id: 'track', title: 'Detect and track', caption: 'Every figure gets a box and an ID that stays with it.', hint: 'Drag anywhere to turn the room.' },
    { id: 'line', title: 'Line counting', caption: 'Crossing the line counts one in or one out.', hint: 'Drag either end of the line.' },
    { id: 'zone', title: 'Zones and dwell', caption: 'Time spent inside the zone, per person.', hint: 'Drag the zone corners.' },
    { id: 'heat', title: 'Heatmap', caption: 'Where people stood, summed over time.', hint: 'Drag the rail: people re-route around it.' },
  ],
};

export async function create(ctx) {
  const { stage, labels } = ctx;
  const b = base(ctx);
  const rand = rng(7);
  const rail = stage.byName.get('rail');
  const crate = stage.byName.get('crate');
  const railDrag = b.draggable('rail', { onChange: (s) => s === 'placed' && ctx.emit('rail', 'moved') });

  // Where people go: in front of the rail (wherever it is now), the table,
  // the mirror, or anywhere free. One person per spot (crowd claims).
  const spots = () => [
    rail ? { key: 'rail', at: [rail.position.x, rail.position.z + 0.52], face: [rail.position.x, rail.position.z], act: 'browse' } : null,
    { key: 'table', at: [-0.55, -0.05], face: [-0.55, -0.8], act: 'browse' },
    { key: 'mirror', at: [0.55, -0.6], face: [0.55, -1.0], act: 'idle' },
  ].filter(Boolean);
  const think = () => {
    let step = 0;
    let spot = null;
    return (a) => {
      step++;
      if (step % 2 === 1) {
        const open = spots().filter((s) => b.crowd.free(s.key, a));
        spot = open.length && rand() < 0.75 ? open[Math.floor(rand() * open.length)] : { key: null, at: b.randomFree(rand), act: 'idle' };
        return { go: spot.at ?? [0, 0], claim: spot.key ?? undefined };
      }
      return { act: spot?.act ?? 'idle', secs: 2.5 + rand() * 4, face: spot?.face, claim: spot?.key ?? undefined };
    };
  };
  const cast = stage.data.cast ?? [];
  const extra = [
    { body: 'body_b', hair: 'curly', outfit: { top: '#8a5a44', bottom: '#2b2d33', hair: '#1c1612' }, clip: 'idle', at: [1.1, 0, 0.6] },
    { body: 'body_c', hair: 'long', wear: ['glasses'], scale: 0.97, outfit: { top: '#3f6f5d', bottom: '#3a3530', hair: '#6b4a2e' }, clip: 'idle', at: [-0.9, 0, 0.7] },
  ];
  for (const entry of [...cast, ...extra]) b.agent(entry, { think: think() });

  // ---------------------------------------------------------------- overlays
  const heat = new HeatMap(stage.scene, b.grid);
  const trails = new Trails(stage.scene);
  const zone = new Zone(stage.scene, {
    points: [[0.05, -0.75], [1.15, -0.75], [1.15, 0.05], [0.05, 0.05]],
    color: '#8b5cf6',
  });
  const line = { a: [0.95, 0.35], b: [0.95, 1.0], in: 0, out: 0 };
  const handleGeo = new CylinderGeometry(0.055, 0.055, 0.012, 24);
  const handleMat = new MeshBasicMaterial({ color: GLOW.white, toneMapped: false });
  const handle = (kind, key) => {
    const m = new Mesh(handleGeo, handleMat);
    m.userData.pick = 'drag';
    m.userData.handle = { kind, key };
    m.layers.set(OVERLAY_LAYER);
    m.position.y = 0.012;
    stage.scene.add(m);
    return m;
  };
  const lineHandles = [handle('line', 'a'), handle('line', 'b')];
  const zoneHandles = zone.points.map((_, i) => handle('zone', i));
  const dwell = new Map();

  // Crossings: the segment a figure moved along this frame against the line.
  b.crowd.onMove((a, prev) => {
    const [ax, az] = line.a;
    const [bx, bz] = line.b;
    const ex = bx - ax;
    const ez = bz - az;
    const s0 = cross(ex, ez, prev.x - ax, prev.z - az);
    const s1 = cross(ex, ez, a.pos.x - ax, a.pos.y - az);
    if (s0 === 0 || Math.sign(s0) === Math.sign(s1)) return;
    // Within the segment's span, not just its infinite line.
    const t = ((a.pos.x - ax) * ex + (a.pos.y - az) * ez) / (ex * ex + ez * ez);
    if (t < 0 || t > 1) return;
    if (s1 > 0) line.in++;
    else line.out++;
    ctx.emit('line', `${line.in}/${line.out}`);
  });

  const show = { brackets: true, trails: true, line: false, zone: false, heat: false };
  const setShow = (o) => {
    Object.assign(show, { brackets: true, trails: false, line: false, zone: false, heat: false }, o);
    heat.visible = show.heat;
    zone.visible = show.zone;
    trails.mesh.visible = show.trails;
    lineHandles.forEach((h) => (h.visible = show.line));
    zoneHandles.forEach((h) => (h.visible = show.zone));
  };
  setShow({ trails: true });

  const inZone = () => b.agents.filter((a) => zone.contains(a.pos.x, a.pos.y));

  const chapters = [
    {
      id: 'track',
      enter: () => setShow({ trails: true }),
      readouts: () => [
        { label: 'Tracked now', value: b.agents.length, tone: 'turq' },
        { label: 'Walking', value: b.agents.filter((a) => a.moving).length },
      ],
    },
    {
      id: 'line',
      shot: { target: [0.9, 0.3, 0.6], zoom: 0.72, yaw: 0.2 },
      enter: () => setShow({ line: true }),
      readouts: () => [
        { label: 'In', value: line.in, tone: 'turq' },
        { label: 'Out', value: line.out, tone: 'violet' },
      ],
    },
    {
      id: 'zone',
      shot: { target: [0.6, 0.3, -0.35], zoom: 0.7 },
      enter: () => setShow({ zone: true }),
      readouts: () => {
        const now = inZone();
        const times = [...dwell.values()];
        return [
          { label: 'In the zone', value: now.length, tone: 'violet' },
          { label: 'Longest stay', value: `${(times.length ? Math.max(...times) : 0).toFixed(1)} s`, tone: 'amber' },
        ];
      },
    },
    {
      id: 'heat',
      enter: () => setShow({ heat: true }),
      readouts: () => {
        const h = heat.hottest(1)[0];
        return [{ label: 'Hottest spot', value: h ? `${h.x.toFixed(1)}, ${h.z.toFixed(1)} m` : 'building…', tone: 'amber' }];
      },
      actions: () => [
        { id: 'rail', label: 'Move the rail' },
        { id: 'clear', label: 'Clear the heatmap' },
      ],
      act(id) {
        if (id === 'clear') heat.reset();
        if (id === 'rail' && railDrag) {
          const away = Math.abs(rail.position.x - railDrag.home.x) < 0.05;
          const ok = away ? railDrag.moveTo(railDrag.home.x - 0.6, railDrag.home.z) || railDrag.moveTo(railDrag.home.x - 0.4, railDrag.home.z + 0.2) : railDrag.reset();
          if (!ok) ctx.emit('rail', 'blocked');
        }
      },
    },
  ];

  const place = () => {
    lineHandles[0].position.set(line.a[0], 0.012, line.a[1]);
    lineHandles[1].position.set(line.b[0], 0.012, line.b[1]);
    zone.points.forEach(([x, z], i) => zoneHandles[i].position.set(x, 0.012, z));
  };
  place();

  const floorPt = (ray) => floorPointOn(b, ray);

  return {
    chapters,
    agents: b.agents,
    grid: b.grid,
    crowd: b.crowd,
    railDrag,
    pickables: () => [...b.picks, ...lineHandles, ...zoneHandles].filter((o) => o.visible !== false),
    onDrag(phase, hit, ev, ray) {
      const p = floorPt(ray);
      if (!p) return;
      const h = hit.object.userData.handle;
      if (h?.kind === 'line') {
        line[h.key] = [p.x, p.z];
        if (phase === 'end') ctx.emit('line', 'moved');
      } else if (h?.kind === 'zone') {
        const pts = zone.points.map((q) => [...q]);
        pts[h.key] = [p.x, p.z];
        zone.setPoints(pts);
        if (phase === 'end') ctx.emit('zone', 'moved');
      } else if (hit.object === rail && railDrag) {
        if (phase === 'start') railDrag.start(p);
        else if (phase === 'move') railDrag.move(p);
        else railDrag.end();
      }
      place();
    },
    onClick(hit) {
      if (hit.object === crate) ctx.emit('crate', 'clicked');
    },
    update(dt) {
      b.update(dt);
      const zoned = new Set();
      b.lines.begin();
      for (const a of b.agents) {
        const x = a.pos.x;
        const z = a.pos.y;
        heat.add(x, z, dt); // always gathering, like the product: the chapter only shows it
        const inside = zone.contains(x, z);
        if (inside) {
          zoned.add(a.id);
          dwell.set(a.id, (dwell.get(a.id) ?? 0) + dt);
        } else dwell.delete(a.id);
        const d = dwell.get(a.id) ?? 0;
        const color = show.zone && inside ? (d > 6 ? GLOW.amber : GLOW.violet) : GLOW.turq;
        if (show.trails) trails.push(a.id, x, z, color, dt);
        if (show.brackets) b.lines.bracket(x, z, a.heading, 0.24, 0.2, 1.5, color);
        labels.set(`id${a.id}`, {
          text: `ID ${String(a.id).padStart(2, '0')}`,
          sub: show.zone && inside ? `${d.toFixed(1)} s` : '',
          tone: show.zone && inside ? (d > 6 ? 'amber' : 'violet') : 'turq',
          at: [x, 1.62, z],
        });
      }
      if (show.zone) b.lines.poly(zone.outline(), GLOW.violet, true);
      zone.glow(zoned.size ? 1 : 0);
      if (show.line) {
        const [ax, az] = line.a;
        const [bx, bz] = line.b;
        b.lines.seg(ax, 0.01, az, bx, 0.01, bz, GLOW.turq);
        // Chevrons pointing "in": the side the cross product calls positive.
        const mx = (ax + bx) / 2;
        const mz = (az + bz) / 2;
        const len = Math.hypot(bx - ax, bz - az) || 1;
        const nx = -(bz - az) / len;
        const nz = (bx - ax) / len;
        for (const k of [-0.25, 0, 0.25]) {
          const cx = mx + ((bx - ax) / len) * k * len * 0.6;
          const cz = mz + ((bz - az) / len) * k * len * 0.6;
          const tipx = cx + nx * 0.12;
          const tipz = cz + nz * 0.12;
          const ex = ((bx - ax) / len) * 0.06;
          const ez = ((bz - az) / len) * 0.06;
          b.lines.seg(cx - ex + nx * 0.04, 0.01, cz - ez + nz * 0.04, tipx, 0.01, tipz, GLOW.turq);
          b.lines.seg(cx + ex + nx * 0.04, 0.01, cz + ez + nz * 0.04, tipx, 0.01, tipz, GLOW.turq);
        }
        labels.set('line', { text: `IN ${line.in}`, sub: `OUT ${line.out}`, tone: 'plain', at: [mx, 0.25, mz] });
      }
      b.lines.end();
      heat.update(dt);
      if (show.trails) trails.update();
    },
    snapshot() {
      return {
        rail: rail ? { x: rail.position.x, z: rail.position.z } : null,
        line: { a: line.a, b: line.b, in: line.in, out: line.out },
        zone: zone.points,
      };
    },
    resume(s) {
      if (rail && s?.rail && railDrag?.fits(s.rail.x, s.rail.z)) {
        rail.position.set(s.rail.x, rail.position.y, s.rail.z);
        railDrag.stamp();
      }
      if (s?.line) Object.assign(line, s.line);
      if (s?.zone) zone.setPoints(s.zone);
      place();
    },
    reset() {
      railDrag?.reset();
      heat.reset();
    },
    dispose() {
      b.dispose();
      heat.dispose();
      trails.dispose();
      zone.dispose();
      for (const h of [...lineHandles, ...zoneHandles]) h.removeFromParent();
      handleGeo.dispose();
      handleMat.dispose();
    },
  };
}
