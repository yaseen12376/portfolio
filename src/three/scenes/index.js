/**
 * Scene controllers, by diorama id. Each is its own lazy chunk, so a visitor
 * downloads only the controllers for the scenes they reach.
 */
export const SCENES = {
  // The calibration fixture (?3d=cal and the QA bench) exists on the dev
  // server only: a production build drops this branch, so it never ships.
  ...(import.meta.env.DEV ? { _calibration: () => import('./_calibration.js') } : {}),
  'retail-analytics': () => import('./retail-analytics.js'),
  constructsafe: () => import('./constructsafe.js'),
  finmind: () => import('./finmind.js'),
  _default: () => import('./_default.js'),
};
