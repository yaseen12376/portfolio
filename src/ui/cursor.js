/**
 * Contextual cursor.
 *
 * A dot that merely lags the pointer adds nothing. This one changes state: it
 * expands and labels itself over project rows, becomes an arrow over external
 * links, thins out over text, and snaps to buttons.
 *
 * Pointer devices only — never instantiated on touch, where it would be a
 * permanently-stuck artefact in the corner.
 */
import { gsap, EASE } from '../core/motion.js';
import { isCoarsePointer } from '../core/device.js';

export function initCursor({ reduced }) {
  if (reduced || isCoarsePointer()) return;

  const root = document.createElement('div');
  root.className = 'cursor';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <div class="cursor-ring"><span class="cursor-label"></span></div>
    <div class="cursor-dot"></div>`;
  document.body.appendChild(root);
  document.documentElement.classList.add('has-cursor');

  const ring = root.querySelector('.cursor-ring');
  const dot = root.querySelector('.cursor-dot');
  const label = root.querySelector('.cursor-label');

  // Single source of centring — see the note in style.css. Setting these before
  // the quickTo tweens means GSAP writes translate(-50%,-50%) translate(x,y)
  // and the two elements share one origin whatever size the ring is.
  gsap.set([ring, dot], { xPercent: -50, yPercent: -50 });

  // Ring trails, dot tracks tightly — that difference is what reads as weight.
  const ringX = gsap.quickTo(ring, 'x', { duration: 0.5, ease: 'power3.out' });
  const ringY = gsap.quickTo(ring, 'y', { duration: 0.5, ease: 'power3.out' });
  const dotX = gsap.quickTo(dot, 'x', { duration: 0.06, ease: 'power2.out' });
  const dotY = gsap.quickTo(dot, 'y', { duration: 0.06, ease: 'power2.out' });

  let visible = false;
  window.addEventListener(
    'pointermove',
    (e) => {
      if (!visible) {
        visible = true;
        gsap.to(root, { autoAlpha: 1, duration: 0.3 });
      }
      ringX(e.clientX);
      ringY(e.clientY);
      dotX(e.clientX);
      dotY(e.clientY);
    },
    { passive: true }
  );

  document.addEventListener('pointerleave', () => {
    visible = false;
    gsap.to(root, { autoAlpha: 0, duration: 0.25 });
  });

  const setState = (state, text = '') => {
    root.dataset.state = state;
    label.textContent = text;
  };

  // [selector, state, label]
  const RULES = [
    ['.row-link', 'view', 'View'],
    ['.pd-next', 'view', 'Next'],
    ['a[target="_blank"]', 'external', ''],
    ['.btn, button, .nav-links a, .contact-link, .nav-toggle, .back-to-top', 'action', ''],
    ['p, h1, h2, h3, li, input, textarea', 'text', ''],
  ];

  document.addEventListener(
    'pointerover',
    (e) => {
      for (const [sel, state, text] of RULES) {
        if (e.target.closest?.(sel)) return setState(state, text);
      }
      setState('default');
    },
    { passive: true }
  );

  document.addEventListener('pointerdown', () => gsap.to(ring, { scale: 0.82, duration: 0.18, ease: EASE.out }));
  document.addEventListener('pointerup', () => gsap.to(ring, { scale: 1, duration: 0.3, ease: EASE.spring }));
}
