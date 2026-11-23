/**
 * KPS Clean-O: the soap bubbles (scripts/blender/pieces/kps-cleano.py
 * _bubble_material(), and scene.json piece.film from its page()). In the
 * render a bubble is a film of water (its thickness and index from the
 * material) round a sphere of air: it refracts nothing, has no colour of its
 * own, and shows what it reflects, faintly face on and strongly at its rim,
 * in the colours the film's two faces make between them. The glTF carries
 * none of that, so the export leaves a faint white stand-in, which lit live
 * reads as a grey ball. Here the stand-in becomes the film: black (no light
 * of its own), the film as three.js's iridescence over a base that is air
 * (ior 1, as the render's), added to what is behind it (all a bubble takes
 * away is what it reflects, a few percent), both walls drawn (the far one's
 * reflection shows through the near one). Added, it covers nothing: the
 * frame's alpha is left as it was, and the glass, which draws it again on
 * its own, lays it over whatever a bent ray meets beyond it, undimmed
 * (piece-glass.js seeThrough).
 */
import { AddEquation, Color, CustomBlending, DoubleSide, MeshPhysicalMaterial, OneFactor, ZeroFactor } from 'three';

export function create({ stage, pc }) {
  const f = pc.film;
  const meshes = [];
  if (f) {
    stage.root.traverse((o) => {
      if (o.isMesh && o.material?.name === f.material) meshes.push(o);
    });
  }
  if (!meshes.length) return { update() {}, dispose() {}, state: () => null };

  const film = new MeshPhysicalMaterial({
    name: f.material,
    color: new Color(0, 0, 0),
    metalness: 0,
    roughness: 0,
    ior: 1,
    iridescence: 1,
    iridescenceIOR: f.ior,
    // With no thickness map three.js takes the top of the range.
    iridescenceThicknessRange: [0, f.thickness],
    transparent: true,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
    depthWrite: false,
    side: DoubleSide,
  });
  for (const o of meshes) {
    o.material = film;
    o.castShadow = false;
  }

  return {
    update() {},
    dispose() {
      film.dispose();
    },
    state: () => ({ films: meshes.length, thickness: f.thickness, ior: f.ior }),
  };
}
