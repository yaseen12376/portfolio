/**
 * Magnetic pull on the primary calls to action.
 *
 * Deliberately narrow: only the filled buttons and the two icon buttons, never
 * whole cards or links. It exists to make the thing you are about to click feel
 * physical, not to make the page wobble.
 *
 * quickTo writes straight to the transform outside the render cycle, so a
 * pointermove never causes layout work.
 */
import { gsap, EASE } from '../core/motion.js';
import { isCoarsePointer } from '../core/device.js';

const STRENGTH = 0.24;

export function initMagnetic({ reduced }) {
  if (reduced || isCoarsePointer()) return;

  document.querySelectorAll('.btn-primary, .copy-btn, .nav-cta, .pd-next').forEach((el) => {
    const xTo = gsap.quickTo(el, 'x', { duration: 0.55, ease: EASE.out });
    const yTo = gsap.quickTo(el, 'y', { duration: 0.55, ease: EASE.out });
    // A wide element shouldn't slide as far sideways as a round one.
    const scale = el.classList.contains('pd-next') ? 0.06 : STRENGTH;

    el.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const r = el.getBoundingClientRect();
      xTo((e.clientX - (r.left + r.width / 2)) * scale);
      yTo((e.clientY - (r.top + r.height / 2)) * (scale * 1.3));
    });
    el.addEventListener('pointerleave', () => {
      xTo(0);
      yTo(0);
    });
  });
}
