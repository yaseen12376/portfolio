/**
 * The dev-only bench behind qa/3d.html: one diorama, one fixed size, the same
 * Slot and engine the site uses. scripts/qa/*.mjs drive it through window.qa.
 *
 *   id      scene id (default _calibration)
 *   w, h    size in device pixels (run the page at devicePixelRatio 1)
 *   still   draw the t = 0 frame only: the frame the posters were rendered at
 *   nopost  no blur, saturation or vignette: compare against the raw Cycles still
 */
import { Vector3 } from 'three';

import { projects } from '../data/projects.js';
import { getEngine } from './engine.js';
import { OVERLAY_LAYER } from './overlays/lines.js';
import { Slot } from './slot.js';

const p = new URLSearchParams(location.search);
const id = p.get('id') || '_calibration';
const W = Number(p.get('w')) || 1280;
const H = Number(p.get('h')) || 720;
const dpr = devicePixelRatio || 1;

const media = document.getElementById('media');
media.style.width = `${W / dpr}px`;
media.style.height = `${H / dpr}px`;

const engine = getEngine();
// The project's own chapter words, as the case study gets them.
const meta = projects.find((p) => p.scene3d?.id === id)?.scene3d;
// A still is compared with the posters, which are framed edge to edge (no
// safe area) and graded with the scene's base look (no case-study override).
const still = p.has('still') ? { insets: { t: 0, r: 0, b: 0, l: 0 } } : {};
const slot = new Slot(media, { id, base: `/3d/${id}/`, context: p.get('context') || 'case', tier: 'high', meta, seed: p.has('seed') ? Number(p.get('seed')) : undefined, ...still });
slot.setActive(!p.has('still'));

const ready = slot.load().then(() => {
  if (p.has('still')) {
    const { case: _, ...base } = slot.stage.data.post ?? {};
    slot.postParams = { ...base };
    // The posters show the diorama alone: no overlays, no labels, no boxes.
    slot.camera.layers.disable(OVERLAY_LAYER);
    slot.labels?.root && (slot.labels.root.hidden = true);
    if (slot.controller) slot.controller.draw2d = null;
    // And the home view the posters were rendered from, settled (a chapter
    // may have sent the camera toward its district on load).
    slot.chapters?.pauseTour(true);
    slot.rig.setShot(null);
    for (let i = 0; i < 480; i++) slot.rig.update(1 / 60);
  }
  if (p.has('nopost')) Object.assign(slot.postParams, { blur: false, sat: 1, vignette: 0 });
  engine.draw(slot);
  return engine.info();
});

// A frame counter the harness can read without trusting the engine's own.
let raf = 0;
const loop = () => {
  raf++;
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);

const hud = document.getElementById('hud');
let last = { t: performance.now(), raf: 0 };
setInterval(() => {
  const now = performance.now();
  const fps = ((raf - last.raf) * 1000) / (now - last.t);
  last = { t: now, raf };
  const i = engine.info();
  hud.textContent = `${id} ${slot.px.w}x${slot.px.h} · ${fps.toFixed(0)} fps · ${i.avgMs} ms · ${i.calls} calls · ${(i.triangles / 1000).toFixed(1)}k tris · q${i.quality}`;
}, 500);

window.qa = {
  id,
  ready,
  slot,
  engine,
  /** Advance n frames synchronously (works while rAF is paused). */
  step(n = 1, dt = 1 / 60) {
    const was = slot.active;
    slot.active = true;
    engine.step(n, dt);
    slot.active = was;
  },
  /**
   * Run every chapter's own check: switch to it, let it operate its feature
   * through the simulation (run(secs) advances scene time without drawing),
   * and collect [name, ok, detail] results per chapter.
   */
  chapterQA() {
    const ch = slot.chapters;
    const run = (secs, dt = 1 / 30) => {
      for (let t = 0; t < secs; t += dt) slot.update(dt);
    };
    const out = {};
    for (const c of ch?.list ?? []) {
      ch.go(c.id);
      run(0.5);
      try {
        out[c.id] = c.qa ? c.qa(run).map(([name, ok, detail]) => ({ name, ok: !!ok, detail: detail ?? '' })) : [{ name: 'has a check', ok: false, detail: 'no qa()' }];
      } catch (e) {
        out[c.id] = [{ name: 'check ran', ok: false, detail: String(e) }];
      }
    }
    return out;
  },

  /**
   * Each chapter's beat: open the chapter and time how long until what it
   * shows happens (the controller's beatMeter goes up), up to `limit` seconds.
   * Between chapters the store runs on for a while, as it would.
   */
  beatQA(limit = 15, dt = 1 / 30) {
    const meter = slot.controller?.beatMeter ?? {};
    const ch = slot.chapters;
    const out = {};
    for (const [id, m] of Object.entries(meter)) {
      for (let t = 0; t < 8; t += dt) slot.update(dt);
      ch.go(id);
      // An event must happen after the chapter opens; a state may already hold.
      const m0 = m.event?.();
      const seen = () => (m.event ? m.event() > m0 : m.state());
      let secs = seen() ? 0 : null;
      for (let t = 0; secs == null && t < limit; t += dt) {
        slot.update(dt);
        if (seen()) secs = +t.toFixed(1);
      }
      out[id] = secs;
    }
    return out;
  },

  /** Draw one frame and return what it cost (draw calls, triangles, programs). */
  frameStats() {
    engine.renderer.info.reset();
    engine.draw(slot);
    const i = engine.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, programs: i.programs?.length ?? 0, geometries: i.memory.geometries, textures: i.memory.textures };
  },
  /** The current frame, as a PNG data URL. */
  png: () => slot.canvas.toDataURL('image/png'),
  toy: () => media.dataset['3dToy'] ?? null,
  rafCount: () => raf,

  /**
   * Spheres over a figure's animated skeleton, sized from the body's skin
   * (scripts/blender/kit/people.py RADII, at its width and scale): what two
   * figures would visibly push through if they overlapped.
   */
  bodySpheres(a) {
    const JOINTS = [
      ['hips', 0.148], ['spine', 0.152], ['chest', 0.165], ['neck', 0.066],
      ['upperarmL', 0.074], ['forearmL', 0.061], ['handL', 0.053], ['upperarmR', 0.074], ['forearmR', 0.061], ['handR', 0.053],
      ['thighL', 0.088], ['shinL', 0.071], ['footL', 0.058], ['thighR', 0.088], ['shinR', 0.071], ['footR', 0.058],
    ];
    const f = a.fig;
    if (!f.__joints) {
      const sk = f.mesh.skeleton;
      // Body width from the collision radius (bodyRadius: 0.265 x width x scale).
      const k = a.radius / 0.265;
      f.__joints = JOINTS.map(([n, r]) => ({ bone: sk.getBoneByName(n), r: r * k })).filter((j) => j.bone);
      f.__head = { bone: sk.getBoneByName('head'), r: 0.19 * (f.root.scale.x || 1), up: 0.17 };
      // Mid-points of the arms, so a forearm between elbow and wrist counts too.
      f.__mids = [['upperarmL', 'forearmL', 0.066], ['forearmL', 'handL', 0.056], ['upperarmR', 'forearmR', 0.066], ['forearmR', 'handR', 0.056]].map(([p, q, r]) => ({ p: sk.getBoneByName(p), q: sk.getBoneByName(q), r: r * k }));
    }
    f.root.updateMatrixWorld(true);
    const out = [];
    const v = new Vector3();
    for (const j of f.__joints) out.push({ p: j.bone.getWorldPosition(new Vector3()), r: j.r, arm: /arm|hand/.test(j.bone.name) });
    for (const m of f.__mids) {
      if (m.p && m.q) out.push({ p: m.p.getWorldPosition(new Vector3()).add(m.q.getWorldPosition(v)).multiplyScalar(0.5), r: m.r, arm: true });
    }
    const h = f.__head;
    if (h.bone) out.push({ p: h.bone.localToWorld(new Vector3(0, h.up, 0)), r: h.r, arm: false });
    return out;
  },

  /**
   * Run the scene's simulation for `secs` of scene time without drawing, and
   * measure what collision must guarantee: the closest two figures ever got,
   * any moment a figure stood inside an obstacle, and who stopped moving.
   */
  simulate(secs = 60, dt = 1 / 30, { during } = {}) {
    const agents = slot.controller?.agents ?? [];
    const grid = slot.controller?.grid;
    const crowd = slot.controller?.crowd;
    let minPair = Infinity;
    let inside = 0;
    let crowded = 0;
    // Invariants: nobody appears or disappears outside a portal, nobody moves
    // further in one step than walking allows, parties stay together.
    const popped = [];
    let maxJump = 0;
    let jumpAt = null;
    let followerMax = 0;
    // How often, and for how long at a stretch, a party is spread out (a
    // follower more than 3 m from the leader): catching up is fine, a family
    // that has split up is not.
    let partyFrames = 0;
    let partyFar = 0;
    let farRun = 0;
    let farLong = 0;
    let pairAt = null;
    let followerAt = null;
    // How long any one pair stays overlapped beyond brushing (8 cm): a
    // frame or two while someone stops is invisible; a lasting one is not.
    const deep = new Map();
    let overlapLong = 0;
    let overlapAt = null;
    // What you see: limbs of two figures pushing into each other (deepest,
    // and the longest a pair stays that way), and arms swinging into fixtures.
    let limbDeep = 0;
    let limbAt = null;
    const limbRun = new Map();
    let limbLong = 0;
    let armClip = 0;
    let armAt = null;
    // Personal space when passing: each encounter's closest gap between two walkers.
    const passing = new Map();
    const passGaps = [];
    // Bumps: a walker brought to a stop against someone right in front of it
    // (within touching); hesitations: stopped short, a step away (letting
    // someone by, which people do).
    let bumps = 0;
    let hesitations = 0;
    const hesT = new Map();
    const bumpT = new Map();
    const stats0 = { ...(crowd?.stats ?? {}) };
    const walking = (a) => a.visible && !a.fixed && a.task?.go && a.vel.length() > 0.15 && !a.fadeDir;
    const was = new Map(agents.map((a) => [a, { vis: a.visible, x: a.pos.x, z: a.pos.y }]));
    const last = new Map(agents.map((a) => [a, { x: a.pos.x, z: a.pos.y, t: 0, still: 0 }]));
    const steps = Math.round(secs / dt);
    for (let i = 0; i < steps; i++) {
      during?.(i * dt);
      slot.update(dt);
      for (const a of agents) {
        const w = was.get(a);
        if (w.vis !== a.visible && crowd) {
          const x = a.visible ? a.pos.x : w.x;
          const z = a.visible ? a.pos.y : w.z;
          if (!crowd.inPortal(x, z)) popped.push(`${a.role ?? 'agent'} ${a.id} ${a.visible ? 'appeared' : 'vanished'} at ${x.toFixed(2)},${z.toFixed(2)} t=${(i * dt).toFixed(1)}`);
        } else if (a.visible && !a.fixed) {
          const step = Math.hypot(a.pos.x - w.x, a.pos.y - w.z) / (a.walkSpeed * 1.15 * dt);
          if (step > maxJump) {
            maxJump = step;
            jumpAt = `${a.role ?? 'agent'} ${a.id} t=${(i * dt).toFixed(1)}`;
          }
        }
        if (a.visible && a.party && a.leader && a !== a.leader && a.leader.visible && a.fadeDir === 0 && a.leader.fadeDir === 0) {
          const fd = Math.hypot(a.pos.x - a.leader.pos.x, a.pos.y - a.leader.pos.y);
          if (fd > followerMax) {
            followerMax = fd;
            followerAt = `${a.id} t=${(i * dt).toFixed(1)} leader ${a.leader.task?.go ? 'walking' : a.leader.task?.act ?? '-'} (${a.leader.st?.phase}) follower ${a.task?.go ? 'walking' : a.task?.act ?? '-'} at ${a.pos.x.toFixed(2)},${a.pos.y.toFixed(2)}`;
          }
        }
        w.vis = a.visible;
        w.x = a.pos.x;
        w.z = a.pos.y;
      }
      const lead = agents.find((a) => a.party && a.leader === a && a.visible && !a.fadeDir);
      const fol = lead ? agents.filter((a) => a.leader === lead && a !== lead) : [];
      if (lead && fol.length && fol.every((f) => f.visible && !f.fadeDir)) {
        partyFrames++;
        if (Math.max(...fol.map((f) => Math.hypot(f.pos.x - lead.pos.x, f.pos.y - lead.pos.y))) > 3) {
          partyFar++;
          farRun += dt;
          farLong = Math.max(farLong, farRun);
        } else farRun = 0;
      } else farRun = 0;
      // Every other step: skeletons against each other, arms against fixtures,
      // and each passing encounter's closest gap.
      if (i % 2 === 0) {
        const t = i * dt;
        const vis = agents.filter((a) => a.visible && a.fade > 0.5);
        const spheres = new Map();
        const sph = (a) => spheres.get(a) ?? spheres.set(a, this.bodySpheres(a)).get(a);
        const touching = new Set();
        for (let x = 0; x < vis.length; x++) {
          const a = vis[x];
          for (let y = x + 1; y < vis.length; y++) {
            const b = vis[y];
            const d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
            const key = `${a.id}-${b.id}`;
            // Passing: both walking, near each other.
            if (walking(a) && walking(b) && d < 2) passing.set(key, Math.min(passing.get(key) ?? Infinity, d - a.radius - b.radius));
            else if (passing.has(key)) {
              passGaps.push(passing.get(key));
              passing.delete(key);
            }
            if (d > 1.3) continue;
            let deep = 0;
            for (const p of sph(a)) for (const q of sph(b)) deep = Math.max(deep, p.r + q.r - p.p.distanceTo(q.p));
            if (deep > 0.02) {
              touching.add(key);
              const run = (limbRun.get(key) ?? 0) + 2 * dt;
              limbRun.set(key, run);
              if (run > limbLong) limbLong = run;
            }
            if (deep > limbDeep) {
              limbDeep = deep;
              limbAt = `${a.role ?? 'agent'} ${a.id} (${a.task?.go ? 'walking' : a.task?.act ?? 'standing'}${a.party ? ' party' : ''}) & ${b.role ?? 'agent'} ${b.id} (${b.task?.go ? 'walking' : b.task?.act ?? 'standing'}${b.party ? ' party' : ''}) t=${t.toFixed(1)} at ${a.pos.x.toFixed(2)},${a.pos.y.toFixed(2)}, bodies ${(d - a.radius - b.radius).toFixed(3)} m apart, speeds ${a.vel.length().toFixed(2)}/${b.vel.length().toFixed(2)}`;
            }
          }
          // Arms while walking (reaching into a rail or a till at work is the point of it).
          if (grid && walking(a)) {
            for (const p of sph(a)) {
              if (!p.arm) continue;
              const clip = p.r - grid.clearAt(p.p.x, p.p.z);
              if (clip > armClip) {
                armClip = clip;
                armAt = `${a.role ?? 'agent'} ${a.id} t=${t.toFixed(1)} at ${p.p.x.toFixed(2)},${p.p.z.toFixed(2)} (${p.p.y.toFixed(2)} m up)`;
              }
            }
          }
        }
        for (const key of limbRun.keys()) if (!touching.has(key)) limbRun.delete(key);
      }
      for (let k = 0; k < agents.length; k++) {
        const a = agents[k];
        if (!a.visible) continue; // someone who has left the scene
        // A fixed figure (behind a counter) stands where the scene put it.
        if (grid && !a.fixed && !grid.clear(a.pos.x, a.pos.y)) inside++;
        if (grid && !a.fixed && !grid.free(a.pos.x, a.pos.y)) crowded++;
        for (let m = k + 1; m < agents.length; m++) {
          const b = agents[m];
          if (!b.visible) continue;
          const gap = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) - a.radius - b.radius;
          const key = `${a.id}-${b.id}`;
          if (gap < -0.08) {
            const t = (deep.get(key) ?? 0) + dt;
            deep.set(key, t);
            if (t > overlapLong) {
              overlapLong = t;
              overlapAt = `${a.role ?? 'agent'} ${a.id} & ${b.role ?? 'agent'} ${b.id} t=${(i * dt).toFixed(1)} at ${a.pos.x.toFixed(2)},${a.pos.y.toFixed(2)}`;
            }
          } else deep.delete(key);
          if (gap < minPair) {
            minPair = gap;
            pairAt = `${a.role ?? 'agent'} ${a.id} (${a.task?.go ? 'walking' : a.task?.act ?? 'standing'}${a.fadeDir ? ` fading ${a.fadeDir}` : ''}) & ${b.role ?? 'agent'} ${b.id} (${b.task?.go ? 'walking' : b.task?.act ?? 'standing'}${b.fadeDir ? ` fading ${b.fadeDir}` : ''}) t=${(i * dt).toFixed(1)} at ${a.pos.x.toFixed(2)},${a.pos.y.toFixed(2)}`;
          }
        }
        // Bumps (once a second at most per walker): stopped short, someone within touching in front.
        const pl = a.pref ? Math.hypot(a.pref[0], a.pref[1]) : 0;
        if (a.task?.go && !a.waitGate && !a.fixed && !a.fadeDir && a.path && pl > 0.3 * a.walkSpeed && a.vel.length() < 0.3 * a.walkSpeed) {
          const end = a.path[a.path.length - 1];
          if (Math.hypot(end[0] - a.pos.x, end[1] - a.pos.y) > 0.6 && (bumpT.get(a) ?? -9) < i * dt - 1) {
            let gap = Infinity;
            for (const b of agents) {
              if (b === a || !b.visible || (a.party && b.party === a.party)) continue;
              const dx = b.pos.x - a.pos.x;
              const dz = b.pos.y - a.pos.y;
              const d = Math.hypot(dx, dz);
              if ((dx * a.pref[0] + dz * a.pref[1]) / (d * pl) > 0.5) gap = Math.min(gap, d - a.radius - b.radius);
            }
            if (gap < 0.2 && (hesT.get(a) ?? -9) < i * dt - 1) {
              hesitations++;
              hesT.set(a, i * dt);
            }
            const hit = gap < 0.04;
            if (hit) {
              bumps++;
              bumpT.set(a, i * dt);
              if (crowd?.log) {
                const b = agents.find((b) => b !== a && b.visible && Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y) < a.radius + b.radius + 0.06);
                crowd.log.push({ t: +(i * dt).toFixed(1), type: 'bump', a: `${a.role} ${a.id} (${a.st?.phase ?? ''}) at ${a.pos.x.toFixed(2)},${a.pos.y.toFixed(2)}`, b: b ? `${b.role} ${b.id} (${b.task?.go ? 'walking' : b.task?.act ?? 'standing'} ${b.st?.phase ?? ''})` : null, x: a.pos.x, z: a.pos.y });
              }
            }
          }
        }
        const l = last.get(a);
        l.t += dt;
        if (l.t >= 20) {
          if (Math.hypot(a.pos.x - l.x, a.pos.y - l.z) < 0.3) l.still++;
          l.x = a.pos.x;
          l.z = a.pos.y;
          l.t = 0;
        }
      }
    }
    return {
      limbDeep: +limbDeep.toFixed(3),
      limbLong: +limbLong.toFixed(2),
      limbAt,
      armClip: +armClip.toFixed(3),
      armAt,
      passes: passGaps.length,
      passGap5: passGaps.length ? +passGaps.sort((x, y) => x - y)[Math.floor(passGaps.length * 0.05)].toFixed(3) : null,
      bumpsPerMin: +((bumps / secs) * 60).toFixed(2),
      hesitationsPerMin: +((hesitations / secs) * 60).toFixed(2),
      fallbacks: Object.fromEntries(Object.entries(crowd?.stats ?? {}).map(([k, v]) => [k, v - (stats0[k] ?? 0)])),
      agents: agents.length,
      steps,
      minGap: +minPair.toFixed(3),
      pairAt,
      overlapLong: +overlapLong.toFixed(2),
      overlapAt,
      insideObstacle: inside,
      inDilatedMargin: crowded,
      stillFor20s: [...last.values()].reduce((n, l) => n + l.still, 0),
      popped,
      maxJump: +maxJump.toFixed(2),
      jumpAt,
      followerMax: +followerMax.toFixed(2),
      partySpread: partyFrames ? +((partyFar / partyFrames) * 100).toFixed(1) : 0,
      partySpreadLong: +farLong.toFixed(1),
      followerAt,
    };
  },
};
