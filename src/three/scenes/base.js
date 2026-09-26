/**
 * What every diorama shares: the nav grid and the crowd that walks it, the
 * cast from scene.json, fixtures that can be moved by hand (with collision),
 * the pickable pieces (anything Blender tagged with `pick`: 'drag' or 'click'),
 * one batch for all overlay lines, and a floor-plane helper.
 */
import { Plane, Vector3 } from 'three';

import { SegmentBatch } from '../overlays/lines.js';
import { makeFigure, Path } from '../people.js';
import { Agent, Crowd } from '../sim/agents.js';
import { FixtureDrag } from '../sim/drag.js';
import { footprint, NavGrid } from '../sim/grid.js';

/**
 * The least a figure's centre keeps from a wall or fixture: the grid is
 * dilated by this. (Routes keep more where there's room: see grid.path.)
 */
export const FIGURE_RADIUS = 0.2;

/**
 * A figure's half-width, arms included, for keeping people apart: the
 * shoulder joint plus its skin (kit/people.py: 0.162 + 0.074, the hanging
 * wrist reaches 0.265) for the standard body, scaled by each body's width
 * (VARIANTS there), plus a vest's shell. Two people this far apart don't touch.
 */
const BODY_HALF = 0.265;
const BODY_WIDTH = { body_a: 1.0, body_b: 1.12, body_c: 0.92 };
export function bodyRadius(entry) {
  const [body, extra] = String(entry.body ?? 'body_a').split('+');
  return (BODY_HALF * (BODY_WIDTH[body] ?? 1) + (extra === 'vest' ? 0.012 : 0)) * (entry.scale ?? 1);
}

export function base(ctx, { radius = FIGURE_RADIUS, lineCapacity = 1024 } = {}) {
  const { stage, people } = ctx;
  const data = stage.data;
  const grid = data.nav ? new NavGrid(data.nav, { radius }) : null;
  // Where people come and go: places at the island's edge that hide them.
  // Scenes declare them; older scenes fall back to their street ends.
  const portals = Object.entries(data.portals ?? {}).map(([name, p]) => ({ name, x: p.at[0], z: p.at[2], r: p.r ?? 0.5 }));
  if (!portals.length) {
    for (const [name, s] of Object.entries(data.spots ?? {})) if (/^street_/.test(name)) portals.push({ name, x: s.at[0], z: s.at[2], r: 0.8 });
  }
  const crowd = grid ? new Crowd(grid, { portals }) : null;
  const figures = [];
  const agents = [];
  const drags = new Map();

  // Everything that can move is an obstacle where it stands now; draggable()
  // takes over the stamp (same key) for pieces people can move.
  if (grid) {
    for (const [name, fp] of Object.entries(data.footprints ?? {})) {
      const o = stage.byName.get(name);
      if (o) grid.stamp(name, footprint(o.position.x, o.position.z, fp.half[0], fp.half[1], o.rotation.y, fp.offset[0], fp.offset[1]));
    }
  }

  const picks = [];
  stage.root.traverse((o) => {
    if (o.userData?.pick) picks.push(o);
  });

  const lines = new SegmentBatch({ capacity: lineCapacity, width: ctx.context === 'case' ? 1.6 : 1.3 });
  stage.scene.add(lines.mesh);

  // Without live shadows (cards), each figure's contact shadow does all the work.
  const contact = stage.key?.castShadow ? 1 : 1.6;
  const grounded = (f) => {
    if (f.contact) f.contact.material.opacity = contact;
    return f;
  };

  const floor = new Plane(new Vector3(0, 1, 0), 0);
  const hit = new Vector3();

  /** Where a cast entry starts: its path position, or its spot. */
  const startOf = (entry) => {
    if (entry.path && data.paths?.[entry.path]) {
      const { pos, tan } = new Path(data.paths[entry.path]).at(entry.along ?? 0);
      return { at: [pos.x, 0, pos.z], face: (Math.atan2(tan.x, tan.z) * 180) / Math.PI };
    }
    return { at: entry.at ?? [0, 0, 0], face: entry.face ?? 0 };
  };

  return {
    grid,
    crowd,
    portals,
    figures,
    agents,
    drags,
    picks,
    lines,

    /** A figure that walks a fixed path or stands (no simulation). */
    figure(entry) {
      const f = grounded(makeFigure(people, entry, data.paths ?? {}));
      stage.scene.add(f.root);
      figures.push(f);
      return f;
    },

    /**
     * A figure with a routine, moving through the crowd on the nav grid.
     * @param {object} entry  a cast entry (body, outfit, clip, and a path/along or at/face to start from)
     * @param {{ think: (a: Agent) => object, tags?: object, speed?: number }} o
     */
    agent(entry, o) {
      const start = startOf(entry);
      const f = grounded(makeFigure(people, { ...entry, path: undefined, at: start.at, face: start.face }, {}));
      stage.scene.add(f.root);
      const k = entry.scale ?? 1; // a smaller person takes smaller steps
      const a = new Agent(f, { id: agents.length + 1, radius: bodyRadius(entry), ...o, speed: (o.speed ?? 0.67) * k });
      crowd.add(a);
      agents.push(a);
      return a;
    },

    /** Make a Blender 'dyn' piece movable by hand, with its footprint from Blender. */
    draggable(name, opts = {}) {
      const object = stage.byName.get(name);
      const fp = data.footprints?.[name];
      if (!object || !fp || !grid) return null;
      const d = new FixtureDrag({ grid, scene: stage.scene, object, half: fp.half, offset: fp.offset, ...opts });
      drags.set(object, d);
      return d;
    },

    /** Where a ray meets the floor (y = 0), or null. */
    floorPoint(ray) {
      return ray.ray.intersectPlane(floor, hit) ? hit.clone() : null;
    },

    /** The plinth's walkable area in three.js x/z. */
    area(margin = 0.25) {
      if (grid) {
        return { x0: grid.x0 + margin, x1: grid.x0 + grid.w * grid.cell - margin, z0: grid.z0 + margin, z1: grid.z0 + grid.h * grid.cell - margin };
      }
      const [lo, hi] = data.view.bounds;
      return { x0: lo[0] + margin, x1: hi[0] - margin, z0: Math.min(lo[2], hi[2]) + margin, z1: Math.max(lo[2], hi[2]) - margin };
    },

    /** A random free point on the floor (for wandering), or null. */
    randomFree(rand = Math.random, tries = 40) {
      if (!grid) return null;
      for (let i = 0; i < tries; i++) {
        const x = grid.x0 + rand() * grid.w * grid.cell;
        const z = grid.z0 + rand() * grid.h * grid.cell;
        if (grid.free(x, z)) return [x, z];
      }
      return null;
    },

    /** Fat lines need the size of what they draw into. */
    resolution(w, h) {
      lines.setResolution(w, h);
    },

    update(dt) {
      for (const d of drags.values()) d.update(dt);
      crowd?.update(dt);
      for (const f of figures) f.update(dt);
      if (ctx.slot) lines.setResolution(ctx.slot.px.w, ctx.slot.px.h);
    },

    dispose() {
      for (const d of drags.values()) d.dispose();
      for (const f of [...figures, ...agents.map((a) => a.fig)]) {
        f.root.removeFromParent();
        f.dispose();
      }
      lines.dispose();
    },
  };
}
