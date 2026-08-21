/**
 * Branded entrance.
 *
 * The page previously just appeared. Almost every scroll-led site opens with a
 * short branded beat, and there is a natural window to fill here anyway: the
 * hero poster, the ladder and the first frames are all loading during it.
 *
 * Deliberately time-boxed. It waits on real progress but hands over after
 * MAX_MS regardless — a preloader that outstays the assets is worse than none.
 */
import { gsap, EASE } from '../core/motion.js';
import { stopScroll, startScroll } from '../core/smooth-scroll.js';

const MIN_MS = 900; // long enough to read the name
const MAX_MS = 2600; // hard ceiling, even on a slow connection

export function initPreloader({ reduced }) {
  const el = document.querySelector('#preloader');
  if (!el) return { done: Promise.resolve() };

  const counter = el.querySelector('#pre-count');
  const bar = el.querySelector('#pre-bar');

  if (reduced) {
    el.remove();
    return { done: Promise.resolve() };
  }

  stopScroll();
  window.scrollTo(0, 0);

  const state = { v: 0 };
  const started = performance.now();

  // Drive the counter off real document progress where we can get it, but never
  // let it stall: it eases toward 100 on its own schedule too.
  const tick = gsap.to(state, {
    v: 100,
    duration: MAX_MS / 1000,
    ease: 'power1.inOut',
    onUpdate: () => {
      const n = Math.min(99, Math.round(state.v));
      if (counter) counter.textContent = String(n).padStart(3, '0');
      if (bar) bar.style.transform = `scaleX(${n / 100})`;
    },
  });

  let settled = false;
  const done = new Promise((resolve) => {
    /**
     * Hard removal, independent of GSAP.
     *
     * The curtain is opaque and covers the whole page, so anything that stops
     * the ticker — an error in another module, or simply being opened in a
     * background tab where rAF is suspended — would otherwise leave a visitor
     * staring at a black screen with no way out. This runs on a plain timer.
     */
    const bail = () => {
      if (settled) return;
      settled = true;
      tick.kill();
      el.remove();
      startScroll();
      resolve();
    };
    setTimeout(bail, MAX_MS + 1200);

    const finish = () => {
      if (settled) return;
      const elapsed = performance.now() - started;
      const wait = Math.max(0, MIN_MS - elapsed);
      gsap.delayedCall(wait / 1000, () => {
        if (settled) return;
        settled = true;
        tick.kill();
        if (counter) counter.textContent = '100';
        if (bar) bar.style.transform = 'scaleX(1)';

        gsap
          .timeline({
            onComplete: () => {
              el.remove();
              startScroll();
              resolve();
            },
          })
          .to(el.querySelectorAll('.pre-row'), {
            yPercent: -110,
            duration: 0.6,
            ease: EASE.expo,
            stagger: 0.06,
          })
          .to(el, { yPercent: -100, duration: 0.8, ease: EASE.expo }, '-=0.35');
      });
    };

    if (document.readyState === 'complete') finish();
    else window.addEventListener('load', finish, { once: true });
    // Belt and braces: never hold the page past the ceiling.
    setTimeout(finish, MAX_MS);
  });

  return { done };
}
