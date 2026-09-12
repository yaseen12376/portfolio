/**
 * Project detail view.
 *
 * A client-side overlay rather than a real route, so #/project/<id> links stay
 * valid (the build also emits /project/<id>/ pages that hand over to this).
 * Scroll position is stored in history state and restored after ScrollTrigger
 * has re-measured, because the overlay hides #main-content while it is open.
 */
import { gsap, ScrollTrigger, Flip, EASE, revealLines, countUp } from '../core/motion.js';
import { getProject, projects, liveMetrics } from '../data/projects.js';
import { scrollTo, stopScroll, startScroll, resizeScroll } from '../core/smooth-scroll.js';
import { esc, icons, brandIcons } from '../core/util.js';
import { mediaMarkup, metricMarkup, playMedia, stopMedia, shortTitle } from './projects.js';

const list = (items, cls) => `<ul class="${cls}">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;

function railMarkup(p) {
  const rows = [
    p.role && ['Role', esc(p.role)],
    p.team && ['Team', esc(p.team)],
    ['Year', esc(p.year)],
    p.status && ['Status', esc(p.status)],
  ].filter(Boolean);
  const code = p.repo
    ? `<a class="btn btn-ghost" href="${esc(p.repo)}" target="_blank" rel="noopener noreferrer">
         <span style="display:inline-flex;gap:8px;align-items:center">${brandIcons.github} View code</span>
         <span class="btn-icon up">${icons.arrowUpRight}</span>
       </a>`
    : `<span class="private-note">${icons.lock} Private repository${p.id === 'courier' ? ', client work' : ''}</span>`;
  return `
    <aside class="pd-rail">
      <dl>
        ${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}
        <div><dt>Stack</dt><dd><div class="chips">${p.techStack.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div></dd></div>
        <div><dt>Code</dt><dd>${code}</dd></div>
      </dl>
    </aside>`;
}

function detailMarkup(p) {
  const idx = projects.findIndex((x) => x.id === p.id);
  const next = projects[(idx + 1) % projects.length];
  const metrics = liveMetrics(p);
  return `
    <article class="pd-inner">
      <div class="pd-bar">
        <button class="pd-back" id="pd-back" type="button">${icons.arrowLeft}<span>All work</span></button>
      </div>

      <header class="pd-head">
        <p class="proj-meta"><span class="num">${p.num}</span><span>${esc(p.year)}</span>
          ${p.status ? `<span class="chip chip-accent">${esc(p.status)}</span>` : ''}</p>
        <h1 class="pd-title">${esc(p.title)}</h1>
        <p class="pd-short">${esc(p.short)}</p>
      </header>

      <div class="shell pd-hero-media is-locked"><div class="core">${mediaMarkup(p, { eager: true })}</div></div>

      <div class="pd-layout">
        ${railMarkup(p)}
        <div class="pd-main">
          <section class="pd-block"><h2>Overview</h2><p>${esc(p.overview)}</p></section>
          <section class="pd-block pd-split">
            <div><h2>The problem</h2><p>${esc(p.problem)}</p></div>
            <div><h2>The approach</h2><p>${esc(p.solution)}</p></div>
          </section>
          <section class="pd-block"><h2>What I built</h2>${list(p.implementation, 'pd-list')}</section>
          <section class="pd-block">
            <h2>Results</h2>
            ${metrics.length ? `<div class="metrics">${metrics.map(metricMarkup).join('')}</div>` : ''}
            ${list(p.outcomes, 'pd-list')}
          </section>
          ${
            p.limitations?.length
              ? `<section class="pd-block"><h2>Limitations, stated plainly</h2><div class="pd-limits">${list(p.limitations, '')}</div></section>`
              : ''
          }
        </div>
      </div>

      <a class="pd-next" href="#/project/${esc(next.id)}">
        <span><span class="pd-next-label">Next project</span><span class="pd-next-title">${esc(next.title)}</span></span>
        <span class="btn-icon">${icons.arrowRight}</span>
      </a>
    </article>`;
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const desktop = () => window.matchMedia('(min-width: 900px)').matches;

const detail = () => document.querySelector('#project-detail');
const main = () => document.querySelector('#main-content');
const siteTitle = document.title;

let isOpen = false;
let splits = [];
let returnFocus = null;

// The case study's markup is thrown away on every open and close, so anything
// scroll-driven inside it has to be killed with it or it accumulates triggers
// pointing at elements that no longer exist.
let detailTriggers = [];
const killDetailTriggers = () => {
  detailTriggers.forEach((t) => t?.kill());
  detailTriggers = [];
};

/**
 * Cross-fade between page and case study. Only opacity on the way out: a
 * transform on #main-content would re-anchor the pinned hero (a position:fixed
 * descendant) to the transformed ancestor and visibly jump it.
 */
function swapViews(from, swap) {
  if (reducedMotion() || !from) {
    swap();
    return;
  }
  gsap.to(from, {
    autoAlpha: 0,
    duration: 0.28,
    ease: EASE.in,
    onComplete: () => {
      gsap.set(from, { clearProps: 'opacity,visibility' });
      swap();
    },
  });
}

export function openProject(id, { push = true } = {}) {
  const p = getProject(id);
  const el = detail();
  if (!p || !el) return;

  const scrollY = isOpen ? history.state?.scrollY ?? 0 : window.scrollY;
  const sourceImg = !isOpen ? main().querySelector(`.media[data-id="${p.id}"] img`) : null;
  const flipState = sourceImg ? Flip.getState(sourceImg) : null;
  if (!isOpen) returnFocus = document.activeElement;

  stopScroll();
  if (push) {
    history.replaceState({ ...history.state, scrollY }, '');
    history.pushState({ project: p.id, scrollY }, '', `#/project/${p.id}`);
  }

  swapViews(isOpen ? el : main(), () => {
    el.querySelectorAll('.media').forEach(stopMedia);
    killDetailTriggers();
    el.innerHTML = detailMarkup(p);
    el.classList.remove('hidden');
    el.setAttribute('aria-hidden', 'false');
    main().style.display = 'none';
    document.body.classList.add('detail-open');
    document.title = `${shortTitle(p)} | Sheik Ahmed Yaseen`;
    window.scrollTo(0, 0);
    resizeScroll();
    ScrollTrigger.refresh();

    const media = el.querySelector('.pd-hero-media .media');
    if (desktop() && !reducedMotion()) playMedia(media);

    // Shared-element morph: the card's poster becomes the detail poster.
    const target = media?.querySelector('img');
    if (flipState && target && !reducedMotion()) {
      Flip.fit(target, flipState, { scale: true });
      gsap.to(target, { scale: 1, x: 0, y: 0, duration: 0.8, ease: EASE.inOut, clearProps: 'transform' });
    }

    el.querySelectorAll('.pd-main .metric-value').forEach((m) => countUp(m, { immediate: true }));

    splits.forEach((s) => s.revert());
    splits = [];
    if (!reducedMotion()) {
      const title = el.querySelector('.pd-title');
      if (title) splits.push(revealLines(title, { trigger: null }));
      gsap.from(el.querySelectorAll('.pd-head .proj-meta, .pd-short, .pd-hero-media'), {
        autoAlpha: 0, y: 22, duration: 0.7, stagger: 0.07, delay: 0.1,
      });
      const blocks = gsap.from(el.querySelectorAll('.pd-block'), {
        autoAlpha: 0, y: 30, duration: 0.7, stagger: 0.06,
        scrollTrigger: { trigger: el.querySelector('.pd-layout'), start: 'top 85%', once: true },
      });
      detailTriggers.push(blocks.scrollTrigger);

      // The facts rail fills in row by row beside the prose.
      gsap.from(el.querySelectorAll('.pd-rail dl > div'), {
        autoAlpha: 0, x: 14, duration: 0.6, stagger: 0.05, delay: 0.4,
      });

      // Parallax waits for the shared-element morph to finish: both drive the
      // same image, and starting now would fight it.
      gsap.delayedCall(0.95, () => {
        const img = el.querySelector('.pd-hero-media img');
        if (!isOpen || !img?.isConnected) return;
        const tween = gsap.fromTo(
          img,
          { yPercent: -3, scale: 1.07 },
          {
            yPercent: 3,
            ease: 'none',
            scrollTrigger: {
              trigger: el.querySelector('.pd-hero-media'),
              start: 'top bottom',
              end: 'bottom top',
              scrub: true,
            },
          }
        );
        detailTriggers.push(tween.scrollTrigger);
      });
    }

    el.querySelector('#pd-back')?.addEventListener('click', () => {
      // Arriving directly on /project/<id>/ means there is no history to pop.
      if (window.__openProject && history.length <= 1) window.location.href = '/';
      else history.back();
    });
    el.querySelector('#pd-back')?.focus({ preventScroll: true });
    isOpen = true;
    startScroll();
  });
}

export function closeProject({ restoreY = 0 } = {}) {
  const el = detail();
  if (!el || !isOpen) return;
  stopScroll();

  swapViews(el, () => {
    el.querySelectorAll('.media').forEach(stopMedia);
    killDetailTriggers();
    el.classList.add('hidden');
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '';
    main().style.display = '';
    document.body.classList.remove('detail-open');
    document.title = siteTitle;
    splits.forEach((s) => s.revert());
    splits = [];
    isOpen = false;

    // While the detail was open #main-content was display:none, so the
    // document had collapsed to the overlay's height. Flush layout to get the
    // full height back BEFORE refreshing and restoring, or the restore is
    // clamped to the shorter page (lands ~1700px short with the hero pin).
    void document.documentElement.scrollHeight;
    ScrollTrigger.refresh();
    resizeScroll();

    const restore = () => {
      resizeScroll();
      scrollTo(restoreY, { immediate: true });
    };
    requestAnimationFrame(() => {
      restore();
      // Pin spacers can settle a frame late; re-assert once they have.
      requestAnimationFrame(() => {
        restore();
        returnFocus?.focus?.({ preventScroll: true });
      });
    });
    startScroll();
  });
}

const hashProject = () =>
  location.hash.startsWith('#/project/') ? decodeURIComponent(location.hash.slice('#/project/'.length)) : null;

export function initProjectRouting() {
  history.scrollRestoration = 'manual';

  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="#/project/"]');
    if (!link || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    const id = link.getAttribute('href').replace('#/project/', '');
    if (isOpen) {
      // Next-project link from inside a detail view: replace, don't stack.
      history.replaceState({ project: id, scrollY: history.state?.scrollY ?? 0 }, '', `#/project/${id}`);
      openProject(id, { push: false });
    } else {
      openProject(id);
    }
  });

  // Back/forward, and also a hand-typed or pasted #/project/<id> on a page that
  // is already open: that is a same-document navigation, which fires popstate
  // with no state. Falling back to the hash is what makes it open the project
  // instead of being treated as "close".
  window.addEventListener('popstate', (e) => {
    const id = e.state?.project ?? hashProject();
    if (id && getProject(id)) {
      if (!e.state) history.replaceState({ project: id, scrollY: window.scrollY }, '');
      openProject(id, { push: false });
    } else {
      closeProject({ restoreY: e.state?.scrollY ?? 0 });
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) history.back();
  });

  // Entry points, in order: a real /project/<id>/ page (window.__openProject is
  // written into those builds), then a #/project/<id> hash link.
  const id = window.__openProject || hashProject();
  if (id && getProject(id)) {
    history.replaceState({ project: id, scrollY: 0 }, '', location.pathname + location.hash);
    openProject(id, { push: false });
  }
}
