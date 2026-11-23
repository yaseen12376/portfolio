/**
 * Courier: the receipt feeding out of the printer (scripts/blender/pieces/
 * courier.py animate(), and scene.json piece.receipt from its page()).
 *
 * The render moves the new sheet's vertices up the tray and folds whatever
 * is still inside the printer flat onto its slot line, out of sight. Here
 * the sheet slides up the tray whole, and a clipping plane at the slot cuts
 * away what is still inside the printer: the same picture, with no vertex
 * rewritten. The sheet leaves the export in materials of its own (copies of
 * the paper and inks), so the cut touches nothing else.
 */
import { Plane, Vector3 } from 'three';

const clamp01 = (x) => Math.min(1, Math.max(0, x));

export function create({ stage, pc, renderer }) {
  const r = pc.receipt;
  const sheet = r ? stage.byName.get(r.mesh) : null;
  const tray = r ? stage.byName.get(r.tray) : null;
  if (!sheet || !tray) return { update() {}, dispose() {}, state: () => null };

  renderer.localClippingEnabled = true;
  const plane = new Plane();
  sheet.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [o.material].flat()) {
      m.clippingPlanes = [plane];
      m.clipShadows = true;
      m.needsUpdate = true;
    }
  });
  // Where it lies in the tray at t = 0 (fully out). Blender's y up the tray
  // is the node's -z: the glTF turns Blender's z-up into y-up.
  const rest = sheet.position.clone();
  const n = new Vector3();
  const at = new Vector3();
  let off = 0;

  return {
    update(phase) {
      // animate(): a new receipt starts a moment after the loop does, feeds
      // with the printer's small stutter, then lies there.
      const u = (phase + r.start) % 1;
      let feed = clamp01(u / r.feed);
      feed += 0.04 * Math.sin(feed * Math.PI * 14) * (1 - feed) * 0.15;
      off = r.slot * (1 - clamp01(feed));
      sheet.position.set(rest.x, rest.y, rest.z - off);
      // Keep what is below the slot (the tray's own z at least -slot), as
      // the turntable has the tray now.
      tray.updateWorldMatrix(true, false);
      n.set(0, 0, 1).transformDirection(tray.matrixWorld);
      at.set(0, 0, -r.slot).applyMatrix4(tray.matrixWorld);
      plane.setFromNormalAndCoplanarPoint(n, at);
    },
    dispose() {},
    state: () => ({ off: +off.toFixed(4) }),
  };
}
