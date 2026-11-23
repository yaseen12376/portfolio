/**
 * Many small things a jar's clip moves each on its own (a track's trail of
 * dots, a cloud's drops, a scrubber's bubbles) cost a draw call each, and the
 * glass draws the model more than once a frame. Those that share a material
 * are drawn as one here (three's BatchedMesh), each instance following its
 * node. The nodes stay where they are, hidden: the clip still moves them, a
 * tap still meets them (a ray meets what is hidden), and the bounds the glass
 * was given came from them.
 *
 * Left alone: what a piece's hook drives (`hooked`, pieces/live.py), what has
 * several materials, morphs or a skin, and groups of fewer than MIN. A batch
 * is kept out of the layers in `off`: the glass's ground map, which draws the
 * model from below in materials of its own (the lowest surface wins there,
 * and what moves stands on the ground or over it).
 */
import { BatchedMesh, Matrix4, PropertyBinding } from 'three';

const MIN = 4;

/** What a geometry must share with the others in a batch: its attributes, as stored. */
function layout(g) {
  const attrs = Object.keys(g.attributes)
    .sort()
    .map((k) => {
      const a = g.attributes[k];
      return `${k}:${a.itemSize}:${a.array.constructor.name}:${a.normalized ? 1 : 0}`;
    });
  return `${g.index ? 'indexed' : 'flat'}|${attrs.join(',')}`;
}

/**
 * Batch the turntable's moving meshes. Returns { meshes, batches, dispose },
 * or null when there is nothing worth batching.
 * @param {import('three').Object3D} tt   the turntable (the batches ride on it)
 * @param {import('three').AnimationClip | null} clip
 * @param {{ off?: number[] }} [o]
 */
export function batchMovers(tt, clip, { off = [] } = {}) {
  if (!tt || !clip) return null;
  const moving = new Set(clip.tracks.map((t) => PropertyBinding.parseTrackName(t.name).nodeName));
  const groups = new Map();
  tt.traverse((o) => {
    if (!o.isMesh || o.isBatchedMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.visible) return;
    if (Array.isArray(o.material) || o.morphTargetInfluences) return;
    let moves = false;
    for (let q = o; q && q !== tt; q = q.parent) {
      if (q.userData?.hooked) return;
      if (moving.has(q.name)) moves = true;
    }
    if (!moves) return;
    const key = [o.material.uuid, layout(o.geometry), o.castShadow, o.receiveShadow, o.renderOrder, o.layers.mask].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  });

  const batches = [];
  const hidden = [];
  const inv = new Matrix4();
  const rel = new Matrix4();
  for (const meshes of groups.values()) {
    if (meshes.length < MIN) continue;
    const geos = [...new Set(meshes.map((m) => m.geometry))];
    let verts = 0;
    let index = 0;
    for (const g of geos) {
      verts += g.attributes.position.count;
      index += g.index ? g.index.count : 0;
    }
    const first = meshes[0];
    const batch = new BatchedMesh(meshes.length, verts, index, first.material);
    batch.name = `batch_${first.material.name || 'movers'}`;
    const ids = new Map(geos.map((g) => [g, batch.addGeometry(g)]));
    const items = meshes.map((m) => ({ m, id: batch.addInstance(ids.get(m.geometry)) }));
    batch.castShadow = first.castShadow;
    batch.receiveShadow = first.receiveShadow;
    batch.renderOrder = first.renderOrder;
    batch.layers.mask = first.layers.mask;
    for (const l of off) batch.layers.disable(l);
    batch.userData.role = first.userData.role;
    // (Taps go to the hidden nodes, which know their part.)
    batch.raycast = () => {};
    // Each instance where its node is, relative to the turntable, just before
    // the batch is drawn (the renderer has brought every node up to date by
    // then, the hidden ones too).
    const sync = () => {
      inv.copy(tt.matrixWorld).invert();
      for (const { m, id } of items) batch.setMatrixAt(id, rel.multiplyMatrices(inv, m.matrixWorld));
    };
    const draw = batch.onBeforeRender;
    batch.onBeforeRender = function (...a) {
      sync();
      return draw.apply(this, a);
    };
    const shade = batch.onBeforeShadow;
    batch.onBeforeShadow = function (...a) {
      sync();
      return shade.apply(this, a);
    };
    tt.updateMatrixWorld(true);
    sync();
    tt.add(batch);
    for (const { m } of items) {
      m.visible = false;
      hidden.push(m);
    }
    batches.push(batch);
  }
  if (!batches.length) return null;
  return {
    meshes: hidden.length,
    batches,
    dispose() {
      for (const b of batches) {
        b.removeFromParent();
        b.dispose();
      }
      for (const m of hidden) m.visible = true;
    },
  };
}
