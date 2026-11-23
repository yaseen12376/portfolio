/**
 * ADRAF: the scan ring's light on the voxels it passes (scripts/blender/
 * pieces/adraf.py _scan_material(), and scene.json piece.scan from its
 * page()). In the render a voxel's glow is a function of its height: `rest`
 * everywhere, rising to `peak` within `band` of the ring's height, eased
 * (a smoothstep). Here the same function runs in the voxels' own shader,
 * on the world height of each fragment, against the ring's world height
 * this frame (the clip moves the ring; the turntable turns about the
 * vertical, so heights are the same in the jar's frame and the world's).
 */
import { Color, Vector3 } from 'three';

export function create({ stage, pc }) {
  const s = pc.scan;
  const ring = s ? stage.byName.get(s.ring) : null;
  if (!ring) return { update() {}, dispose() {}, state: () => null };

  const uRing = { value: 0 };
  const glow = new Color().setRGB(...s.color);
  const patched = [];
  stage.root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [o.material].flat()) {
      const k = m && s.materials[m.name];
      if (!k || patched.includes(m)) continue;
      patched.push(m);
      const before = m.onBeforeCompile;
      m.onBeforeCompile = (shader, renderer) => {
        before?.call(m, shader, renderer);
        shader.uniforms.uScanRing = uRing;
        shader.uniforms.uScanGlow = { value: glow };
        shader.uniforms.uScanRest = { value: k.rest };
        shader.uniforms.uScanPeak = { value: k.peak };
        shader.uniforms.uScanBand = { value: s.band };
        shader.vertexShader = shader.vertexShader
          .replace('void main() {', 'varying float vScanY;\nvoid main() {')
          .replace('#include <project_vertex>', '#include <project_vertex>\n  vScanY = (modelMatrix * vec4(transformed, 1.0)).y;');
        shader.fragmentShader = shader.fragmentShader
          .replace(
            'void main() {',
            'uniform float uScanRing;\nuniform vec3 uScanGlow;\nuniform float uScanRest;\nuniform float uScanPeak;\nuniform float uScanBand;\nvarying float vScanY;\nvoid main() {'
          )
          .replace(
            '#include <emissivemap_fragment>',
            '#include <emissivemap_fragment>\n  totalEmissiveRadiance = uScanGlow * mix(uScanPeak, uScanRest, smoothstep(0.0, uScanBand, abs(vScanY - uScanRing)));'
          );
      };
      const key = m.customProgramCacheKey?.bind(m);
      m.customProgramCacheKey = () => `${key ? key() : ''}|scan-band`;
      m.needsUpdate = true;
    }
  });

  const at = new Vector3();
  return {
    update() {
      uRing.value = ring.getWorldPosition(at).y;
    },
    dispose() {},
    state: () => ({ ring: +uRing.value.toFixed(4), materials: patched.map((m) => m.name) }),
  };
}
