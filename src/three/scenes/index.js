/**
 * Scene controllers, by diorama id. Each is its own lazy chunk, so a visitor
 * downloads only the controllers for the scenes they reach.
 */
export const SCENES = {
  _calibration: () => import('./_calibration.js'),
  'retail-analytics': () => import('./retail-analytics.js'),
  _default: () => import('./_default.js'),
};
