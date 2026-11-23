/**
 * A piece's material tracks (scene.json piece.tracks, written by
 * scripts/blender/pieces/live.py _keyframes): what the piece's animate()
 * changes on a material between frames, sampled at the clip's keys. A glow's
 * strength and colour (NeerNaadi's ticket going red, orange, grey and red
 * again; its zone ring's beat), a see-through ring's opacity (a ripple, a
 * pulse fading as it spreads), a colour. Set here each frame at the clip's
 * phase, between keys as the clip moves between its keys (linearly).
 *
 * Values are Blender's: emission strength as the material's emissive
 * intensity, colours linear (three.js's working space), alpha as opacity.
 */

/**
 * @param {import('three').Object3D} root  the jar's scene (the GLB's root)
 * @param {{ frames: number, materials: Record<string, { emissive?: number[], emissiveColor?: number[] | number[][], opacity?: number[], color?: number[] | number[][] }> } | null} tracks
 * @returns {{ update(phase: number): void, state(): object } | null}
 */
export function pieceTracks(root, tracks) {
  const n = tracks?.frames ?? 0;
  if (!tracks?.materials || n < 2) return null;
  const list = [];
  const seen = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [o.material].flat()) {
      const t = m && tracks.materials[m.name];
      if (!t || seen.has(m)) continue;
      seen.add(m);
      // Fading out (a ripple), it must blend, whatever it was at t = 0.
      if (t.opacity && !m.transparent) {
        m.transparent = true;
        m.depthWrite = false;
        m.needsUpdate = true;
      }
      list.push({ m, t });
    }
  });
  if (!list.length) return null;

  const lerp = (a, i, u) => a[i] + (a[i + 1] - a[i]) * u;
  // A colour track: one value for the loop, or one per key.
  const rgb = (a, i, u, out) => {
    if (typeof a[0] === 'number') return out.setRGB(a[0], a[1], a[2]);
    const p = a[i];
    const q = a[i + 1];
    return out.setRGB(p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u);
  };
  let last = 0;

  return {
    /** Every tracked material as it is at this point of the loop (0..1). */
    update(phase) {
      last = phase;
      const f = (((phase % 1) + 1) % 1) * (n - 1);
      const i = Math.min(n - 2, Math.floor(f));
      const u = f - i;
      for (const { m, t } of list) {
        if (t.emissive) m.emissiveIntensity = lerp(t.emissive, i, u);
        if (t.emissiveColor && m.emissive) rgb(t.emissiveColor, i, u, m.emissive);
        if (t.opacity) m.opacity = lerp(t.opacity, i, u);
        if (t.color) rgb(t.color, i, u, m.color);
      }
    },
    /** QA: the tracked materials and where they are. */
    state: () => ({
      phase: last,
      materials: list.map(({ m }) => ({ name: m.name, emissive: +m.emissiveIntensity.toFixed(3), opacity: +m.opacity.toFixed(3), color: m.emissive?.getHexString() })),
    }),
  };
}
