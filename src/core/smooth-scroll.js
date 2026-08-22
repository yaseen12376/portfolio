/**
 * Lenis <-> ScrollTrigger wiring.
 *
 * Exactly one rAF loop, with a fixed ordering per tick:
 *   Lenis writes scrollY -> ScrollTrigger.update reads it -> GSAP tweens apply
 *   -> the hero canvas blits last (it registers its ticker after this one).
 *
 * Deliberately NOT using ScrollSmoother: it wraps content in a transformed
 * container, which breaks the position:fixed overlays this design is built on
 * (aurora mesh, noise, orbs, nav, scroll progress, page wipe).
 *
 * Deliberately NOT using ScrollTrigger.scrollerProxy or normalizeScroll: Lenis
 * scrolls the document natively here, so ScrollTrigger's default scroller is
 * already correct, and normalizeScroll would fight Lenis for wheel events.
 */
import Lenis from 'lenis';
import { gsap, ScrollTrigger } from './motion.js';
import { prefersReducedMotion } from './device.js';

let lenis = null;

export function initSmoothScroll() {
  if (prefersReducedMotion()) return null;

  lenis = new Lenis({
    autoRaf: false, // GSAP drives the loop
    lerp: 0.085,
    wheelMultiplier: 1,
    smoothWheel: true,
    syncTouch: false, // let iOS keep its native momentum
    anchors: false, // navigation handles anchors itself
  });

  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));

  // Without this, a long decode stall makes GSAP "catch up" by jumping the
  // timeline, desyncing the pinned hero text from the canvas underneath it.
  gsap.ticker.lagSmoothing(0);

  return lenis;
}

export const getLenis = () => lenis;

/** Scroll velocity in px/frame, or 0 when Lenis is disabled. */
export const scrollVelocity = () => lenis?.velocity ?? 0;

export function scrollTo(target, { offset = 0, immediate = false } = {}) {
  if (lenis) {
    lenis.scrollTo(target, { offset, duration: 1.2, immediate });
    return;
  }
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (typeof target === 'number') {
    window.scrollTo({ top: target, behavior: immediate ? 'auto' : 'smooth' });
  } else if (el) {
    window.scrollTo({ top: el.offsetTop + offset, behavior: immediate ? 'auto' : 'smooth' });
  }
}

export const stopScroll = () => lenis?.stop();
export const startScroll = () => lenis?.start();

/**
 * Re-measure the document.
 *
 * Lenis caches the maximum scroll offset and clamps every scrollTo against it.
 * After the project overlay hides #main-content the cached limit is the
 * overlay's height, so restoring the previous scroll position silently lands
 * short until this is called.
 */
export const resizeScroll = () => lenis?.resize();

/**
 * Focus can land inside a pinned section that is currently off-screen, at which
 * point the browser's native scrollIntoView fights Lenis. Take it over.
 */
export function bindFocusScroll() {
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!lenis || !el?.getBoundingClientRect) return;
    const r = el.getBoundingClientRect();
    // Only rescue focus that is genuinely off-screen. Testing whether the
    // element fits entirely in the viewport would drag the page every time a
    // tall element — a project row, say — is clicked.
    const offScreen = r.bottom < 60 || r.top > window.innerHeight - 60;
    if (offScreen) lenis.scrollTo(el, { offset: -120 });
  });
}
