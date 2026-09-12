/**
 * Entry point.
 *
 * Boot order matters: content is rendered from data before any ScrollTrigger is
 * created, so triggers measure real layout rather than empty containers.
 *
 * All breakpoint and reduced-motion gating goes through gsap.matchMedia(),
 * which reverts every tween and trigger created inside its callback when the
 * query stops matching.
 */
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource-variable/big-shoulders-display';

import { gsap, ScrollTrigger, revealSectionHeadings } from './core/motion.js';
import { detectTier, prefersReducedMotion } from './core/device.js';
import { initSmoothScroll, bindFocusScroll } from './core/smooth-scroll.js';
import { icons, brandIcons } from './core/util.js';

import { initNav } from './ui/nav.js';
import { initPreloader } from './ui/preloader.js';
import { initMagnetic } from './ui/magnetic.js';
import { initSpotlight } from './ui/spotlight.js';

import { initHero, playHeroIntro } from './sections/hero.js';
import { renderProjects, initProjects } from './sections/projects.js';
import { renderAbout, initAbout } from './sections/about.js';
import { renderSkills, initSkills } from './sections/skills.js';
import { renderExperience, initExperience } from './sections/experience.js';
import { initContact } from './sections/contact.js';
import { initProjectRouting } from './sections/project-detail.js';

/** Static markup marks icon slots with data-icon / data-brand. */
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (!el.firstElementChild) el.innerHTML = icons[el.dataset.icon] ?? '';
  });
  root.querySelectorAll('[data-brand]').forEach((el) => {
    if (!el.firstElementChild) el.innerHTML = brandIcons[el.dataset.brand] ?? '';
  });
}

/**
 * The résumé PDF is supplied separately. Until public/resume.pdf exists every
 * link to it would 404, so they are hidden. `__HAS_RESUME__` is set by
 * vite.config.js from the filesystem when the server or build starts.
 */
function gateResume() {
  if (__HAS_RESUME__) return;
  document.querySelectorAll('[data-resume]').forEach((el) => {
    el.hidden = true;
  });
  // The hero's second button doesn't disappear, it changes job: a lone button
  // reads as a design mistake, and the row was composed for two.
  document.querySelectorAll('[data-resume-swap]').forEach((el) => {
    el.href = el.dataset.fallbackHref;
    el.textContent = el.dataset.fallbackLabel;
    el.removeAttribute('target');
    el.removeAttribute('rel');
  });
}

function boot() {
  const tier = detectTier();
  const reduced = prefersReducedMotion();
  document.documentElement.dataset.tier = tier;

  // 1. Render everything that comes from data, before triggers are created.
  renderProjects();
  renderAbout();
  renderSkills();
  renderExperience();
  hydrateIcons();
  gateResume();

  // 2. Scroll layer.
  initSmoothScroll();
  bindFocusScroll();

  // 3. Chrome that isn't breakpoint-dependent.
  const preloader = initPreloader({ reduced });
  initNav();
  initContact();

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
      initProjects(opts);
      initAbout(opts);
      initSkills(opts);
      initExperience(opts);
      initMagnetic(opts);
      initSpotlight(opts);
      const cleanupHeadings = reduce ? null : revealSectionHeadings();

      return () => {
        hero?.destroy();
        cleanupHeadings?.();
      };
    }
  );

  // The hero copy waits for the preloader curtain so the two don't play at
  // once. Routing waits too: a deep link opened under the curtain would be
  // measured against a page that hasn't been laid out yet.
  preloader.done.then(() => {
    playHeroIntro({ reduced });
    initProjectRouting();
  });

  // Fonts change metrics, which changes every trigger's start/end.
  document.fonts?.ready.then(() => ScrollTrigger.refresh());

  if (import.meta.env.DEV) {
    window.__portfolio = { gsap, ScrollTrigger, tier };
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
