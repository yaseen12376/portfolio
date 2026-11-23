/**
 * A jar's own effects, where the clip and the material tracks cannot carry
 * the render (src/three/scenes/piece.js loads the one a piece names, after
 * its scene). Each module exports create({ stage, pc, tt, renderer }) and
 * returns { update(phase, dt), dispose(), state?() }; phase is the clip's
 * place in its loop (0..1), as the render's animate(t) has it.
 *
 *   courier          the receipt feeding out of the printer's slot
 *   indoor-tracking  the range circles round each anchor, cut to the plan
 *   adraf            the scan ring's light on the voxels it passes
 *   kps-cleano       the soap bubbles' film, which the glTF cannot carry
 */
export const HOOKS = {
  courier: () => import('./courier.js'),
  'indoor-tracking': () => import('./indoor-tracking.js'),
  adraf: () => import('./adraf.js'),
  'kps-cleano': () => import('./kps-cleano.js'),
};
