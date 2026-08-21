/**
 * Entry point.
 *
 * Boot order matters: content is rendered from data before any ScrollTrigger is
 * created, so triggers measure real layout rather than empty containers.
 *
 * All breakpoint and reduced-motion gating goes through gsap.matchMedia(),
 * which reverts every tween and trigger created inside its callback when the
 * query stops matching — replacing the old scattered innerWidth checks,
 * 'ontouchstart' guards and setTimeout(..., 1200) init deferral.
 */
import { gsap, ScrollTrigger, revealSectionHeadings } from './core/motion.js';
import { detectTier, prefersReducedMotion } from './core/device.js';
import { initSmoothScroll, bindFocusScroll } from './core/smooth-scroll.js';

import { initNav, initScrollProgress } from './ui/nav.js';
import { initMagnetic, initRoleMorph } from './ui/magnetic.js';
import { initPreloader } from './ui/preloader.js';
import { initCursor } from './ui/cursor.js';
import { initVelocitySkew } from './ui/velocity-skew.js';

import { initHero, playHeroIntro } from './sections/hero.js';
import { initAbout } from './sections/about.js';
import { renderSkills, initSkills } from './sections/skills.js';
import { renderProjects, initProjects } from './sections/projects.js';
import { renderExperience, initExperience } from './sections/experience.js';
import { initContact } from './sections/contact.js';
import { initProjectRouting } from './sections/project-detail.js';

function boot() {
  const tier = detectTier();
  const reduced = prefersReducedMotion();
  document.documentElement.dataset.tier = tier;

  // 1. Render everything that comes from data, before triggers are created.
  renderProjects();
  renderSkills();
  renderExperience();

  // 2. Scroll layer.
  initSmoothScroll();
  bindFocusScroll();

  // 3. Chrome that isn't breakpoint-dependent.
  const preloader = initPreloader({ reduced });
  initCursor({ reduced });
  initNav();
  initScrollProgress();
  initProjectRouting();

  // 4. Breakpoint- and motion-gated systems.
  const mm = gsap.matchMedia();
  mm.add(
    {
      desktop: '(min-width: 900px)',
      mobile: '(max-width: 899px)',
      reduce: '(prefers-reduced-motion: reduce)',
    },
    (ctx) => {
      const { desktop, reduce } = ctx.conditions;
      const opts = { tier, desktop, reduced: reduce };

      const hero = initHero({ tier, reduced: reduce });
      const cleanupAbout = initAbout(opts);
      const cleanupHeadings = reduce ? null : revealSectionHeadings();
      initSkills(opts);
      initProjects(opts);
      initExperience(opts);
      initContact(opts);
      initMagnetic(opts);
      initRoleMorph(opts);
      initVelocitySkew(opts);

      return () => {
        hero?.destroy();
        cleanupAbout?.();
        cleanupHeadings?.();
      };
    }
  );

  // The hero copy waits for the preloader curtain so the two don't play at once.
  preloader.done.then(() => playHeroIntro({ reduced }));

  // Fonts change metrics, which changes every trigger's start/end.
  document.fonts?.ready.then(() => ScrollTrigger.refresh());

  // Dev-only handle. Useful for driving the clock manually (gsap.updateRoot) and
  // for watching frame-cache residency while tuning the memory budget.
  if (import.meta.env.DEV) {
    window.__portfolio = { gsap, ScrollTrigger, tier };
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
