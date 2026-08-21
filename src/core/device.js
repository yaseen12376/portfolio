/**
 * Capability tiering. Decides how much of the experience a given device gets,
 * before anything expensive is fetched or constructed.
 */

const mq = (q) => window.matchMedia(q).matches;

export const prefersReducedMotion = () => mq('(prefers-reduced-motion: reduce)');
export const isCoarsePointer = () => mq('(pointer: coarse)') || mq('(hover: none)');

/**
 * 'low'  — poster only. The frame sequence is never fetched.
 * 'mid'  — phones and tablets: 1280x720 frames, shorter pin.
 * 'high' — desktops: 1920x1080 frames.
 */
export function detectTier() {
  if (prefersReducedMotion()) return 'low';

  const conn = navigator.connection || {};
  // Only genuinely slow connections drop to poster-only. Chrome reports '3g'
  // routinely on perfectly good Wi-Fi — that gets the smaller sequence, not
  // no sequence at all.
  const verySlow = conn.saveData === true || ['slow-2g', '2g'].includes(conn.effectiveType);
  const modestNetwork = conn.effectiveType === '3g';
  const lowMemory = (navigator.deviceMemory ?? 4) <= 2;
  const fewCores = (navigator.hardwareConcurrency ?? 4) <= 2;

  if (verySlow || lowMemory || fewCores) return 'low';
  if (modestNetwork || mq('(max-width: 899px)') || isCoarsePointer()) return 'mid';

  return 'high';
}

/** Which encoded frame set a tier should download. */
export const frameSetFor = (tier) => (tier === 'mid' ? 'mobile' : 'desktop');

