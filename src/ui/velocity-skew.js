/**
 * Scroll-velocity skew.
 *
 * A couple of degrees of skew proportional to scroll speed, easing back to zero
 * when it settles. Almost subliminal individually; collectively it is most of
 * what makes a scroll-led site feel like it has physics.
 *
 * Applied to section content only — never to the pinned hero stage (it would
 * shear the canvas) and never to fixed chrome.
 */
import { gsap, ScrollTrigger } from '../core/motion.js';
import { scrollVelocity } from '../core/smooth-scroll.js';

const MAX_DEG = 2.2;

export function initVelocitySkew({ reduced }) {
  if (reduced) return;

  const targets = gsap.utils.toArray('#about .about-main, #skills .skills-grid, #projects .projects-layout, #experience .exp-wrap, #contact .contact-grid');
  if (!targets.length) return;

  const setters = targets.map((el) => gsap.quickTo(el, 'skewY', { duration: 0.5, ease: 'power3.out' }));

  ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate: () => {
      const skew = gsap.utils.clamp(-MAX_DEG, MAX_DEG, scrollVelocity() / 320);
      setters.forEach((set) => set(skew));
    },
  });
}
