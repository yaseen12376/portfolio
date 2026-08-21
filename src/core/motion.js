/**
 * GSAP setup and shared motion vocabulary.
 *
 * Every plugin used here is free as of GSAP 3.13 — SplitText and Flip included.
 */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { Flip } from 'gsap/Flip';

gsap.registerPlugin(ScrollTrigger, SplitText, Flip);

// Mobile browsers fire resize on every URL-bar collapse. Without this the pin
// spacers get recomputed mid-scroll and sections visibly jump.
ScrollTrigger.config({ ignoreMobileResize: true });

export const EASE = {
  out: 'power3.out',
  in: 'power2.in',
  inOut: 'power3.inOut',
  expo: 'expo.out',
  spring: 'back.out(1.7)',
};

export const DUR = {
  fast: 0.4,
  base: 0.7,
  slow: 1.1,
};

gsap.defaults({ ease: EASE.out, duration: DUR.base });

/**
 * Split an element into masked lines and reveal them on scroll.
 * Returns the SplitText so callers can revert() it on breakpoint change —
 * leaving splits in place across a resize is what causes broken wrapping.
 */
export function revealLines(el, { trigger, start = 'top 78%', stagger = 0.06, delay = 0 } = {}) {
  if (!el) return null;
  const split = new SplitText(el, { type: 'lines', mask: 'lines', linesClass: 'line' });
  gsap.from(split.lines, {
    yPercent: 110,
    opacity: 0,
    duration: DUR.slow,
    ease: EASE.expo,
    stagger,
    delay,
    scrollTrigger: trigger === null ? undefined : { trigger: trigger || el, start, once: true },
  });
  return split;
}

/** Character-level reveal, for short headings only. */
export function revealChars(el, { trigger, start = 'top 80%', stagger = 0.025, delay = 0 } = {}) {
  if (!el) return null;
  const split = new SplitText(el, { type: 'chars,lines', mask: 'lines' });
  gsap.from(split.chars, {
    yPercent: 120,
    opacity: 0,
    duration: DUR.base,
    ease: EASE.expo,
    stagger,
    delay,
    scrollTrigger: trigger === null ? undefined : { trigger: trigger || el, start, once: true },
  });
  return split;
}

/** Staggered entrance for a set of sibling elements. */
export function revealBatch(selector, { start = 'top 82%', stagger = 0.09, y = 34 } = {}) {
  const els = gsap.utils.toArray(selector);
  if (!els.length) return;
  gsap.set(els, { opacity: 0, y });
  ScrollTrigger.batch(els, {
    start,
    once: true,
    onEnter: (batch) =>
      gsap.to(batch, { opacity: 1, y: 0, duration: DUR.base, ease: EASE.out, stagger, overwrite: true }),
  });
}

export { gsap, ScrollTrigger, SplitText, Flip };
