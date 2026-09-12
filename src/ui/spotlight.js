/**
 * Pointer spotlight on cards.
 *
 * A card lights up from wherever the cursor is, which tells you what you are
 * about to click without moving anything. The highlight itself is a CSS
 * radial-gradient driven by two custom properties; this only feeds it
 * coordinates.
 *
 * One delegated listener rather than one per card: the case study builds its
 * own shells after this runs, and a delegated listener covers those too.
 * Writes are batched into a frame, so a fast pointer can't out-run layout.
 */
import { isCoarsePointer } from '../core/device.js';

export function initSpotlight({ reduced }) {
  if (reduced || isCoarsePointer()) return;

  let frame = 0;
  let pending = null;

  document.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'mouse') return;
      const card = e.target.closest?.('.shell');
      if (!card) return;
      pending = { card, x: e.clientX, y: e.clientY };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const { card: el, x, y } = pending;
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', `${(((x - r.left) / r.width) * 100).toFixed(1)}%`);
        el.style.setProperty('--my', `${(((y - r.top) / r.height) * 100).toFixed(1)}%`);
      });
    },
    { passive: true }
  );
}
