/**
 * ObserveX: the logo block's glow (scripts/blender/pieces/observex.py, whose
 * gradient also gives off its own colour at half strength, and scene.json
 * piece.glow from its page()). The atlas carries the block's colour; the
 * glow is that colour again, added as light the block gives off, in a copy
 * of the atlas material that the block alone wears (the export keeps the
 * block a mesh of its own for this). The copy keeps the patches the atlas
 * already has, and the controller treats it as the atlas from then on (its
 * light from round it, the ground below it).
 */
export function create({ stage, pc }) {
  const g = pc.glow;
  const node = g ? stage.byName.get(g.mesh) : null;
  const meshes = [];
  node?.traverse((o) => {
    if (o.isMesh) meshes.push(o);
  });
  if (!meshes.length) return { update() {}, dispose() {}, state: () => null };

  const made = new Map();
  for (const mesh of meshes) {
    const src = mesh.material;
    let m = made.get(src);
    if (!m) {
      m = src.clone();
      const before = src.onBeforeCompile;
      const key = src.customProgramCacheKey?.bind(src);
      m.onBeforeCompile = (shader, renderer) => {
        before?.call(src, shader, renderer);
        shader.uniforms.uSelfGlow = { value: g.strength };
        shader.fragmentShader = shader.fragmentShader
          .replace('void main() {', 'uniform float uSelfGlow;\nvoid main() {')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * uSelfGlow;');
      };
      m.customProgramCacheKey = () => `${key ? key() : ''}|self-glow`;
      m.needsUpdate = true;
      made.set(src, m);
    }
    mesh.material = m;
  }

  return {
    update() {},
    dispose() {
      for (const m of made.values()) m.dispose();
    },
    state: () => ({ glow: g.strength, meshes: meshes.length }),
  };
}
