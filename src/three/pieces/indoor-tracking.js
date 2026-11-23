/**
 * Indoor Tracking: each anchor's range circle, as wide as the anchor is far
 * from the crate, drawn only where it lies on the plan (scripts/blender/
 * pieces/indoor-tracking.py set_arcs(), and scene.json piece.ranges from its
 * page()). The render rebuilds the three meshes every frame; so does this,
 * into buffers made once: a band of quads round the circle, with the quads
 * off the plan left out of the index.
 *
 * Piece space is Blender's (z up); the glTF turned it y-up, so a point
 * (x, y, z) there is (x, z, -y) in the meshes' own frame, the turntable's.
 */
import { BufferAttribute, BufferGeometry } from 'three';

export function create({ stage, pc }) {
  const r = pc.ranges;
  const crate = r ? stage.byName.get(r.crate) : null;
  const rings = (r?.meshes ?? []).map((n) => stage.byName.get(n)).filter((m) => m?.isMesh);
  if (!crate || rings.length !== r.anchors.length) return { update() {}, dispose() {}, state: () => null };

  const n = r.segs;
  const geos = rings.map((mesh) => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array((n + 1) * 2 * 3), 3));
    // Flat on the plan, facing up (three's y).
    const nor = new Float32Array((n + 1) * 2 * 3);
    for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
    g.setAttribute('normal', new BufferAttribute(nor, 3));
    g.setIndex(new BufferAttribute(new Uint16Array(n * 6), 1));
    mesh.geometry.dispose();
    mesh.geometry = g;
    // It moves every frame: no stale bounds to cull it by.
    mesh.frustumCulled = false;
    return g;
  });
  const radii = new Array(rings.length).fill(0);

  function draw(g, cx, cy, radius) {
    const pos = g.attributes.position.array;
    const idx = g.index.array;
    const [lx, ly] = r.lim;
    const r0 = radius - r.width / 2;
    const r1 = radius + r.width / 2;
    let count = 0;
    let prev = -1;
    for (let k = 0; k <= n; k++) {
      const a = (2 * Math.PI * k) / n;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const x = cx + radius * c;
      const y = cy + radius * s;
      const v = k * 2;
      pos[v * 3] = cx + r0 * c;
      pos[v * 3 + 1] = r.z;
      pos[v * 3 + 2] = -(cy + r0 * s);
      pos[v * 3 + 3] = cx + r1 * c;
      pos[v * 3 + 4] = r.z;
      pos[v * 3 + 5] = -(cy + r1 * s);
      if (Math.abs(x) < lx && Math.abs(y) < ly) {
        if (prev >= 0) {
          // (prev, prev + 1, v + 1, v), as set_arcs() makes its faces.
          idx[count++] = prev;
          idx[count++] = prev + 1;
          idx[count++] = v + 1;
          idx[count++] = prev;
          idx[count++] = v + 1;
          idx[count++] = v;
        }
        prev = v;
      } else prev = -1;
    }
    g.setDrawRange(0, count);
    g.attributes.position.needsUpdate = true;
    g.index.needsUpdate = true;
  }

  return {
    update() {
      // Where the clip has the crate now, in piece space.
      const cx = crate.position.x;
      const cy = -crate.position.z;
      r.anchors.forEach(([ax, ay], i) => {
        radii[i] = Math.hypot(cx - ax, cy - ay);
        draw(geos[i], ax, ay, radii[i]);
      });
    },
    dispose() {
      for (const g of geos) g.dispose();
    },
    state: () => ({ radii: radii.map((v) => +v.toFixed(4)) }),
  };
}
