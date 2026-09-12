/**
 * Navigation: the floating island, the mobile overlay, and active-section
 * tracking.
 *
 * Active state is resolved from scroll position on every update rather than
 * with a trigger per section: with one trigger each, overlapping enter and
 * enterBack callbacks fire in creation order and the last one wins, which left
 * the wrong link lit. Recomputing the answer can't get out of order.
 */
import { ScrollTrigger } from '../core/motion.js';
import { scrollTo, stopScroll, startScroll } from '../core/smooth-scroll.js';

export function initNav() {
  const nav = document.querySelector('#navbar');
  const toggle = document.querySelector('#nav-toggle');
  const overlay = document.querySelector('#nav-overlay');
  if (!nav) return;

  // The overlay ships `hidden` so it can't flash before JS; from here on its
  // visibility is driven by .is-open so it can transition.
  if (overlay) overlay.hidden = false;

  // Everything under the open menu is made inert, otherwise Tab walks straight
  // past the four menu links into the page behind the curtain.
  // The skip link is in here too: it targets #main-content, which is inert
  // while the menu is open, so offering it would be a dead end.
  const behind = [
    document.querySelector('#main-content'),
    document.querySelector('#footer'),
    document.querySelector('.skip-link'),
  ].filter(Boolean);

  let open = false;
  const setMenu = (next) => {
    if (!overlay || !toggle || open === next) return;
    open = next;
    overlay.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    document.body.classList.toggle('menu-open', open);
    behind.forEach((el) => {
      el.inert = open;
    });
    if (open) {
      stopScroll();
      overlay.querySelector('a')?.focus({ preventScroll: true });
    } else {
      startScroll();
    }
  };

  toggle?.addEventListener('click', () => setMenu(!open));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) {
      setMenu(false);
      toggle.focus();
    }
  });
  window.addEventListener('resize', () => {
    if (open && window.innerWidth >= 900) setMenu(false);
  });

  document.querySelectorAll('a[data-nav]').forEach((link) => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      if (!href?.startsWith('#') || href.startsWith('#/')) return;
      e.preventDefault();
      setMenu(false);
      const target = document.querySelector(href);
      if (target) scrollTo(target, { offset: 0 });
    });
  });

  document.querySelector('#nav-logo')?.addEventListener('click', (e) => {
    e.preventDefault();
    setMenu(false);
    scrollTo(0);
  });

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
    navLinks.forEach((l) => {
      l.classList.toggle('active', l === found);
      if (l === found) l.setAttribute('aria-current', 'true');
      else l.removeAttribute('aria-current');
    });
  };

  ScrollTrigger.create({ start: 0, end: 'max', onUpdate: syncActive, onRefresh: syncActive });
}
