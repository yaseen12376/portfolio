/**
 * GSAP setup and shared motion vocabulary.
 *
 * Every plugin used here is free as of GSAP 3.13, SplitText and Flip included.
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
};

export const DUR = {
  fast: 0.4,
  base: 0.7,
  slow: 1.1,
};

gsap.defaults({ ease: EASE.out, duration: DUR.base });

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Split an element into masked lines and reveal them on scroll.
 * Returns the SplitText so callers can revert() it on breakpoint change;
 * leaving splits in place across a resize is what causes broken wrapping.
 */
export function revealLines(el, { trigger, start = 'top 80%', stagger = 0.06, delay = 0 } = {}) {
  if (!el) return null;
  const split = new SplitText(el, { type: 'lines', mask: 'lines', linesClass: 'line' });
  gsap.from(split.lines, {
    yPercent: 110,
    duration: DUR.slow,
    ease: EASE.expo,
    stagger,
    delay,
    scrollTrigger: trigger === null ? undefined : { trigger: trigger || el, start, once: true },
  });
  return split;
}

/**
 * Fade-up-and-unblur entrance for blocks of content. The transition itself is
 * CSS (.reveal / .is-in in style.css); this only decides when. Elements that
 * enter together are staggered by a few frames so a grid doesn't land as one.
 */
export function revealOnScroll(selector, { start = 'top 88%' } = {}) {
  const els = gsap.utils.toArray(selector);
  if (!els.length) return;
  els.forEach((el) => el.classList.add('reveal'));
  if (reducedMotion()) {
    els.forEach((el) => el.classList.add('is-in'));
    return;
  }
  ScrollTrigger.batch(els, {
    start,
    once: true,
    onEnter: (batch) =>
      batch.forEach((el, i) => {
        el.style.transitionDelay = `${i * 80}ms`;
        el.classList.add('is-in');
        // Clear the delay once it has played, or it lags every hover state.
        setTimeout(() => (el.style.transitionDelay = ''), 1200 + i * 80);
      }),
  });
}

/**
 * Count a display figure up when it arrives.
 *
 * Only the leading number moves; any prefix or suffix is preserved, so "2.4×",
 * "143 FPS", "±3 m" and "+8.1%" all survive. Values with no digits at all
 * ("JWT", "ArcFace") are left alone. The real value stays in the DOM until the
 * tween actually starts, so a figure that is never scrolled to still reads
 * correctly, and so does the crawler's copy.
 */
export function countUp(el, { start = 'top 90%', immediate = false } = {}) {
  if (reducedMotion()) return;
  const match = el.textContent.trim().match(/^(\D*?)(-?[\d.]+)(\D*)$/);
  if (!match) return;
  const [, pre, digits, post] = match;
  const target = parseFloat(digits);
  if (!isFinite(target)) return;
  const decimals = (digits.split('.')[1] ?? '').length;
  const obj = { v: 0 };

  gsap.fromTo(
    obj,
    { v: 0 },
    {
      v: target,
      duration: 1.3,
      ease: EASE.expo,
      immediateRender: false,
      // The case study builds its figures inside a view that is swapped in
      // wholesale, so there is nothing to scroll into: those run on a delay.
      delay: immediate ? 0.35 : 0,
      onUpdate: () => {
        el.textContent = `${pre}${obj.v.toFixed(decimals)}${post}`;
      },
      scrollTrigger: immediate ? undefined : { trigger: el, start, once: true },
    }
  );
}

/** Line-masked reveal for every section heading plus its lede. */
export function revealSectionHeadings() {
  const splits = [];
  gsap.utils.toArray('.section-head, .about-copy').forEach((header) => {
    const title = header.querySelector('.section-title');
    const sub = header.querySelector('.section-lede, .about-bio');

    if (title) {
      const split = new SplitText(title, { type: 'lines', mask: 'lines', linesClass: 'line' });
      splits.push(split);
      gsap.from(split.lines, {
        yPercent: 112,
        duration: DUR.slow,
        ease: EASE.expo,
        stagger: 0.08,
        scrollTrigger: { trigger: header, start: 'top 85%', once: true },
      });
    }
    if (sub) {
      gsap.fromTo(
        sub,
        { autoAlpha: 0, y: 16 },
        {
          autoAlpha: 1, y: 0, duration: DUR.base, ease: EASE.out, delay: 0.2,
          scrollTrigger: { trigger: header, start: 'top 85%', once: true },
        }
      );
    }
  });
  return () => splits.forEach((s) => s.revert());
}

export { gsap, ScrollTrigger, SplitText, Flip };
