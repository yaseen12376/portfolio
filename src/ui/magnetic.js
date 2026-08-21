/**
 * Magnetic buttons and the role-morph ticker.
 * Both are pointer-only affordances — skipped entirely on coarse pointers.
 */
import { gsap, EASE, DUR } from '../core/motion.js';
import { isCoarsePointer } from '../core/device.js';
import { profile } from '../data/profile.js';

export function initMagnetic({ reduced }) {
  if (reduced || isCoarsePointer()) return;

  document.querySelectorAll('.btn, .row-link, .contact-link').forEach((el) => {
    const strength = el.classList.contains('btn') ? 0.28 : 0.1;
    const xTo = gsap.quickTo(el, 'x', { duration: 0.5, ease: EASE.out });
    const yTo = gsap.quickTo(el, 'y', { duration: 0.5, ease: EASE.out });

    el.addEventListener('mousemove', (e) => {
      const r = el.getBoundingClientRect();
      xTo((e.clientX - (r.left + r.width / 2)) * strength);
      yTo((e.clientY - (r.top + r.height / 2)) * strength);
    });
    el.addEventListener('mouseleave', () => {
      xTo(0);
      yTo(0);
    });
  });
}

export function initRoleMorph({ reduced }) {
  const el = document.querySelector('#hero-role-morph');
  if (!el) return;
  const roles = profile.roles;
  if (reduced) {
    el.textContent = roles[0];
    return;
  }
  let i = 0;
  setInterval(() => {
    i = (i + 1) % roles.length;
    gsap
      .timeline()
      .to(el, { yPercent: -100, autoAlpha: 0, duration: DUR.fast, ease: EASE.in })
      .set(el, { textContent: roles[i], yPercent: 100 })
      .to(el, { yPercent: 0, autoAlpha: 1, duration: DUR.fast, ease: EASE.out });
  }, 3000);
}
