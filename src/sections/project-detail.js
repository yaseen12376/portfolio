/**
 * Project detail view.
 *
 * A client-side overlay rather than a real route, kept from the previous build
 * so existing #/project/<id> links stay valid. Two things the old version got
 * wrong are fixed here: scroll position is stored in history state instead of
 * being guessed as `hero.offsetHeight * 0.82`, and restoration waits for
 * ScrollTrigger to finish refreshing before scrolling.
 */
import { gsap, ScrollTrigger, Flip, EASE, revealLines } from '../core/motion.js';
import { getProject, projects } from '../data/projects.js';
import { scrollTo, stopScroll, startScroll, resizeScroll } from '../core/smooth-scroll.js';

const list = (items, cls = '') =>
  `<ul class="${cls}">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;

function detailMarkup(p) {
  const idx = projects.findIndex((x) => x.id === p.id);
  const next = projects[(idx + 1) % projects.length];
  return `
    <article class="pd-inner" data-accent="${p.accent}">
      <header class="pd-head">
        <button class="pd-back" id="pd-back" type="button">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
          <span>All projects</span>
        </button>
        <div class="pd-meta">
          <span class="pd-num">${p.num}</span>
          <span class="pd-year">${p.year}</span>
        </div>
      </header>

      <div class="pd-hero">
        <h1 class="pd-title">${p.title}</h1>
        <p class="pd-short">${p.short}</p>
        <div class="pd-tags">${p.tags.map((t) => `<span class="pill">${t}</span>`).join('')}</div>
        ${
          p.repo
            ? `<a class="btn btn-primary pd-repo" href="${p.repo}" target="_blank" rel="noopener noreferrer">
                 <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="margin-right:8px"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
                 View on GitHub
               </a>`
            : ''
        }
      </div>

      <figure class="pd-media" id="pd-media">
        <img src="${p.poster}" alt="${p.title}" />
      </figure>

      <div class="pd-body">
        <section class="pd-block">
          <h2 class="pd-h">Overview</h2>
          <p>${p.overview}</p>
        </section>
        <section class="pd-block pd-split">
          <div><h2 class="pd-h">The problem</h2><p>${p.problem}</p></div>
          <div><h2 class="pd-h">The approach</h2><p>${p.solution}</p></div>
        </section>
        <section class="pd-block">
          <h2 class="pd-h">Implementation</h2>
          ${list(p.implementation, 'pd-list')}
        </section>
        <section class="pd-block">
          <h2 class="pd-h">Stack</h2>
          <div class="pd-tags">${p.techStack.map((t) => `<span class="pill">${t}</span>`).join('')}</div>
        </section>
        <section class="pd-block">
          <h2 class="pd-h">Outcomes</h2>
          ${list(p.outcomes, 'pd-list pd-list-check')}
        </section>
      </div>

      <a class="pd-next" href="#/project/${next.id}">
        <span class="pd-next-label">Next project</span>
        <span class="pd-next-title">${next.title}</span>
      </a>
    </article>`;
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** When the DOM swap happens, relative to the wipe covering the screen. */
const swapAt = () => (reducedMotion() ? 0 : 0.5);

const detail = () => document.querySelector('#project-detail');
const main = () => document.querySelector('#main-content');

let isOpen = false;
let splits = [];

function playWipe() {
  const panels = gsap.utils.toArray('#page-transition .wipe-panel');
  // Reduced motion gets an instant swap rather than a 1s curtain.
  if (!panels.length || reducedMotion()) {
    return gsap.timeline();
  }
  return gsap
    .timeline()
    .set('#page-transition', { pointerEvents: 'auto' })
    .to(panels, { scaleY: 1, duration: 0.42, ease: EASE.inOut, stagger: 0.05 })
    .to(panels, { scaleY: 0, duration: 0.42, ease: EASE.inOut, stagger: 0.05, transformOrigin: 'top' }, '+=0.1')
    .set('#page-transition', { pointerEvents: 'none' })
    .set(panels, { transformOrigin: 'bottom' });
}

export function openProject(id, { push = true } = {}) {
  const p = getProject(id);
  const el = detail();
  if (!p || !el) return;

  const scrollY = window.scrollY;
  const sourceImg = document.querySelector(`.panel-layer[data-id="${id}"] img`);
  const flipState = sourceImg ? Flip.getState(sourceImg) : null;

  const wipe = playWipe();
  wipe.add(() => {
    el.innerHTML = detailMarkup(p);
    el.classList.remove('hidden');
    el.setAttribute('aria-hidden', 'false');
    main().style.display = 'none';
    document.body.classList.add('detail-open');
    window.scrollTo(0, 0);
    ScrollTrigger.refresh();

    // Shared-element morph: the panel poster becomes the detail poster.
    const target = el.querySelector('#pd-media img');
    if (flipState && target) {
      Flip.fit(target, flipState, { scale: true });
      gsap.to(target, { scale: 1, x: 0, y: 0, duration: 0.7, ease: EASE.inOut, clearProps: 'transform' });
    }

    splits.forEach((s) => s.revert());
    splits = [];
    const title = el.querySelector('.pd-title');
    if (title) splits.push(revealLines(title, { trigger: null }));

    gsap.from(el.querySelectorAll('.pd-short, .pd-tags, .pd-repo'), {
      autoAlpha: 0,
      y: 22,
      duration: 0.6,
      stagger: 0.06,
      delay: 0.15,
    });
    gsap.from(el.querySelectorAll('.pd-block'), {
      autoAlpha: 0,
      y: 34,
      duration: 0.7,
      stagger: 0.08,
      scrollTrigger: { trigger: el.querySelector('.pd-body'), start: 'top 85%', once: true },
    });

    el.querySelector('#pd-back')?.addEventListener('click', () => history.back());
    isOpen = true;
    startScroll();
  }, swapAt());

  stopScroll();
  if (push) {
    history.replaceState({ ...history.state, scrollY }, '');
    history.pushState({ project: id, scrollY }, '', `#/project/${id}`);
  }
}

export function closeProject({ restoreY = 0 } = {}) {
  const el = detail();
  if (!el || !isOpen) return;

  const wipe = playWipe();
  wipe.add(() => {
    el.classList.add('hidden');
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '';
    main().style.display = '';
    document.body.classList.remove('detail-open');
    splits.forEach((s) => s.revert());
    splits = [];
    isOpen = false;

    // While the detail was open #main-content was display:none, so the document
    // had collapsed to the overlay's height. Flush layout to get the full height
    // back BEFORE refreshing and restoring, or the restore is silently clamped
    // to the shorter page (lands ~1700px short with the hero pin in play).
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
      requestAnimationFrame(restore);
    });
    startScroll();
  }, swapAt());
  stopScroll();
}

export function initProjectRouting() {
  history.scrollRestoration = 'manual';

  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="#/project/"]');
    if (!link) return;
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

  window.addEventListener('popstate', (e) => {
    const id = e.state?.project;
    if (id) openProject(id, { push: false });
    else closeProject({ restoreY: e.state?.scrollY ?? 0 });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) history.back();
  });

  const hash = location.hash;
  if (hash.startsWith('#/project/')) {
    const id = hash.replace('#/project/', '');
    if (getProject(id)) {
      history.replaceState({ project: id, scrollY: 0 }, '', hash);
      openProject(id, { push: false });
    }
  }
}
