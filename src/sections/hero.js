/**
 * Hero: pinned frame sequence with a scrubbed text choreography over it.
 *
 * ONE ScrollTrigger owns everything — the pin, the scrub, the timeline and the
 * frame index. An earlier version used two triggers over the same range (one to
 * pin, one for the timeline) with different scrub values, which let the canvas
 * and the text drift apart during fast scrolling. They cannot desync now.
 *
 * The scroll length is owned by ScrollTrigger rather than a CSS height, and
 * `end` is a function (not '+=400%') so it is recomputed on every refresh —
 * a static string is measured once against the initial viewport and goes wrong
 * the moment a mobile URL bar collapses.
 *
 * Note there is deliberately no `height` on #hero in the stylesheet: the pin
 * spacer needs to grow to the full scroll distance, and an explicit height on
 * the section caps it, which drops the next section on top of the pinned hero.
 */
import { gsap, ScrollTrigger, EASE } from '../core/motion.js';
import { FrameSequence } from '../media/frame-sequence.js';

// Pin length as a multiple of viewport height.
//
// This is really a frame-density setting: 180 frames over 4x a 980px viewport
// is ~22px of scroll per frame, which reads as stepped. At 3.2x it is ~17px,
// and the hero also stops feeling like a slog to scroll past.
const SCROLL_VH = { high: 3.2, mid: 2.5 };

export function initHero({ tier, reduced }) {
  const section = document.querySelector('#hero');
  const stage = section?.querySelector('.hero-stage');
  const canvas = document.querySelector('#hero-canvas');
  const poster = section?.querySelector('.hero-poster');
  if (!section || !stage) return null;

  // Low tier and reduced motion never fetch the sequence at all — the poster
  // is the hero, and the copy is simply visible.
  if (reduced || tier === 'low' || !canvas) {
    canvas?.remove();
    gsap.set(section.querySelectorAll('.reveal-hero'), { clearProps: 'all' });
    return null;
  }

  const sequence = new FrameSequence(canvas, { tier });
  let resizeRaf;

  sequence
    .init()
    .then(() => {
      gsap.to(poster, { autoAlpha: 0, duration: 0.6, ease: 'none' });
      ScrollTrigger.refresh();
    })
    .catch((err) => console.warn('[hero] sequence failed, keeping poster', err));

  // The blit runs last in the tick, after ScrollTrigger has updated and GSAP has
  // written this frame's transforms, so the composited result is coherent.
  gsap.ticker.add(() => sequence.draw());

  const left = section.querySelector('.hero-left');
  const right = section.querySelector('.hero-right');
  const hint = section.querySelector('.hero-scroll-hint');
  const outro = section.querySelector('.hero-outro');
  const vignette = section.querySelector('.hero-vignette');
  const hud = section.querySelector('.hero-hud');
  const statements = gsap.utils.toArray('#hero .hero-statement');
  const hudFrame = section.querySelector('#hud-frame');
  const hudProgress = section.querySelector('#hud-progress');

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: section,
      start: 'top top',
      end: () => '+=' + window.innerHeight * (SCROLL_VH[tier] ?? 4),
      pin: stage,
      pinSpacing: true,
      anticipatePin: 1,
      invalidateOnRefresh: true,
      // This pin inserts ~3x viewport of spacer, so every trigger below it
      // depends on it having been measured first. Without this the nav and
      // footer triggers keep the positions they had before the spacer existed
      // (the footer's range started 2800px too early), and they were created
      // earlier so refresh order alone doesn't save us.
      refreshPriority: 1,
      // A little catch-up smoothing on top of Lenis. Not enough to let the
      // canvas visibly lag the copy, which is what a larger value would do.
      scrub: 0.5,
      onUpdate: (self) => {
        sequence.setProgress(self.progress, self.direction);
        // Live readouts. Writing text every tick is cheap, but only when it
        // actually changed — otherwise this is a layout thrash for nothing.
        const f = String(sequence.index + 1).padStart(3, '0');
        if (hudFrame && hudFrame.textContent !== f) hudFrame.textContent = f;
        const pct = String(Math.round(self.progress * 100)).padStart(2, '0') + '%';
        if (hudProgress && hudProgress.textContent !== pct) hudProgress.textContent = pct;
      },
      onLeave: () => sequence.shrink(),
      onLeaveBack: () => sequence.shrink(),
    },
  });

  // 0.00 – 0.06  the hint retires
  tl.to(hint, { autoAlpha: 0, y: 18, duration: 0.06 }, 0);

  // 0.05 – 0.28  columns drift apart
  tl.to(left, { x: -30, y: -44, duration: 0.23, ease: 'none' }, 0.05)
    .to(right, { x: 30, y: -44, duration: 0.23, ease: 'none' }, 0.05);

  // 0.28 – 0.42  copy exits on blur, left leading right
  tl.to(left, { yPercent: -16, autoAlpha: 0, filter: 'blur(9px)', duration: 0.12, ease: EASE.in }, 0.28)
    .to(right, { yPercent: -16, autoAlpha: 0, filter: 'blur(9px)', duration: 0.12, ease: EASE.in }, 0.32);

  // 0.34 – 0.92  the HUD holds the frame while the copy is gone
  tl.fromTo(hud, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.06 }, 0.34)
    .to(hud, { autoAlpha: 0, duration: 0.05 }, 0.9);

  // 0.42 – 0.74  two statements carry the middle of the sequence
  statements.forEach((el, i) => {
    const at = 0.44 + i * 0.16;
    tl.fromTo(
      el,
      { autoAlpha: 0, y: 26, filter: 'blur(8px)' },
      { autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: 0.05, ease: EASE.out },
      at
    ).to(el, { autoAlpha: 0, y: -22, filter: 'blur(8px)', duration: 0.04, ease: EASE.in }, at + 0.1);
  });

  // 0.68 – 0.96  slow push in, vignette closes, handoff title arrives
  tl.to(canvas, { scale: 1.05, duration: 0.26, ease: 'none' }, 0.68)
    .to(vignette, { opacity: 0.9, duration: 0.26, ease: 'none' }, 0.68)
    .fromTo(outro, { autoAlpha: 0, y: 44 }, { autoAlpha: 1, y: 0, duration: 0.08 }, 0.78)
    .to(outro, { autoAlpha: 0, y: -30, duration: 0.05 }, 0.95);

  // Width-only resize handling. Height-only changes are the mobile URL bar and
  // must not trigger a refresh, or sections jump on every scroll reversal.
  let lastWidth = window.innerWidth;
  const onResize = () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      sequence.resize();
      if (Math.abs(window.innerWidth - lastWidth) > 40) {
        lastWidth = window.innerWidth;
        ScrollTrigger.refresh();
      }
    });
  };
  window.addEventListener('resize', onResize);

  return {
    sequence,
    destroy() {
      window.removeEventListener('resize', onResize);
      tl.scrollTrigger?.kill();
      tl.kill();
      sequence.dispose();
    },
  };
}

/** Entrance animation for the hero copy, played once on load. */
export function playHeroIntro({ reduced }) {
  const lines = gsap.utils.toArray('#hero .hero-name-line');
  const items = gsap.utils.toArray('#hero .reveal-hero');
  if (reduced) {
    gsap.set([...lines, ...items], { clearProps: 'all', autoAlpha: 1, y: 0 });
    document.documentElement.classList.add('intro-done');
    return;
  }
  // fromTo, not from: the .js CSS guard pre-hides these, and gsap.from() would
  // read that hidden state as the animation's END value.
  //
  // No clearProps either, for the same reason — clearing the inline transform
  // would hand control back to the CSS guard and snap the name off-screen
  // again. The guard is switched off with .intro-done once we're done.
  const tl = gsap.timeline({
    delay: 0.15,
    onComplete: () => document.documentElement.classList.add('intro-done'),
  });
  // `y: 0` is not redundant: GSAP parses the CSS translateY(110%) guard into an
  // internal pixel `y`, and animating only yPercent would leave that offset
  // behind for good.
  tl.fromTo(
    lines,
    { yPercent: 115, y: 0 },
    { yPercent: 0, y: 0, duration: 1.05, ease: EASE.expo, stagger: 0.08 },
    0
  ).fromTo(
    items,
    { autoAlpha: 0, y: 26 },
    { autoAlpha: 1, y: 0, duration: 0.8, ease: EASE.out, stagger: 0.07 },
    0.25
  );
  return tl;
}
