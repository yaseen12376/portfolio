/**
 * Navigation: scrolled state, mobile drawer, and active-section tracking.
 *
 * Active state comes from ScrollTrigger rather than a separate
 * IntersectionObserver so there is one scroll authority. Projects is now a real
 * section, so the previous special-casing (scroll to 65% of the hero height,
 * hardcoded in three places) is gone.
 */
import { ScrollTrigger } from '../core/motion.js';
import { scrollTo } from '../core/smooth-scroll.js';

export function initNav() {
  const nav = document.querySelector('#navbar');
  const toggle = document.querySelector('#nav-toggle');
  const links = document.querySelector('#nav-links');
  if (!nav) return;

  ScrollTrigger.create({
    start: 'top -100',
    end: 99999,
    onToggle: (self) => nav.classList.toggle('scrolled', self.isActive),
  });

  const closeMenu = () => {
    links?.classList.remove('open');
    toggle?.classList.remove('open');
    toggle?.setAttribute('aria-expanded', 'false');
  };

  toggle?.addEventListener('click', () => {
    const open = links.classList.toggle('open');
    toggle.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
  });

  document.querySelectorAll('a[data-nav]').forEach((link) => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      if (!href?.startsWith('#') || href.startsWith('#/')) return;
      e.preventDefault();
      closeMenu();
      const target = document.querySelector(href);
      if (target) scrollTo(target, { offset: -70 });
    });
  });

  document.querySelector('#nav-logo')?.addEventListener('click', (e) => {
    e.preventDefault();
    closeMenu();
    scrollTo(0);
  });

  // Active link.
  //
  // Resolved from scroll position on every update rather than with a
  // ScrollTrigger per section: with one trigger each, overlapping enter and
  // enterBack callbacks fire in creation order and the last one wins, which
  // left "Experience" lit while Skills was on screen. This can't get out of
  // order because it recomputes the answer instead of accumulating events.
  const navLinks = [...document.querySelectorAll('.nav-links a[data-nav]')];
  const targets = navLinks
    .map((link) => ({ link, section: document.querySelector(link.getAttribute('href')) }))
    .filter((t) => t.section);

  let current = null;
  const syncActive = () => {
    const line = window.scrollY + window.innerHeight * 0.45;
    let found = null;
    for (const { link, section } of targets) {
      const top = section.getBoundingClientRect().top + window.scrollY;
      if (line >= top && line < top + section.offsetHeight) found = link;
    }
    if (found === current) return;
    current = found;
    navLinks.forEach((l) => l.classList.toggle('active', l === found));
  };

  ScrollTrigger.create({ start: 0, end: 'max', onUpdate: syncActive, onRefresh: syncActive });
}

export function initScrollProgress() {
  const bar = document.querySelector('#scroll-progress');
  const top = document.querySelector('#back-to-top');
  if (bar) {
    ScrollTrigger.create({
      start: 0,
      end: 'max',
      onUpdate: (self) => {
        bar.style.transform = `scaleX(${self.progress})`;
      },
    });
  }
  if (top) {
    let pastFold = false;
    let overFooter = false;
    let inHero = true;
    const sync = () => top.classList.toggle('visible', pastFold && !overFooter && !inHero);

    // The hero pin runs for 2.5-3.2 viewports; a floating "back to top" sitting
    // over it the whole way reads as clutter during what is meant to be a
    // continuous cinematic beat.
    const hero = document.querySelector('#hero');
    if (hero) {
      ScrollTrigger.create({
        trigger: hero,
        start: 'top top',
        end: 'bottom bottom',
        onToggle: (self) => {
          inHero = self.isActive;
          sync();
        },
      });
    } else {
      inHero = false;
    }

    ScrollTrigger.create({
      start: 'top -600',
      end: 99999,
      onToggle: (self) => {
        pastFold = self.isActive;
        sync();
      },
    });

    // The button is fixed bottom-right and would otherwise sit on top of the
    // footer's social links. Retire it once the footer is on screen.
    const footer = document.querySelector('#footer');
    if (footer) {
      ScrollTrigger.create({
        trigger: footer,
        start: 'top bottom-=40',
        end: 'bottom top',
        onToggle: (self) => {
          overFooter = self.isActive;
          sync();
        },
      });
    }

    top.addEventListener('click', () => scrollTo(0));
  }
}
