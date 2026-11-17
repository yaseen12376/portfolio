/**
 * Project detail view.
 *
 * A client-side overlay rather than a real route, so #/project/<id> links stay
 * valid (the build also emits /project/<id>/ pages that hand over to this).
 * Scroll position is stored in history state and restored after ScrollTrigger
 * has re-measured, because the overlay hides #main-content while it is open.
 */
import { gsap, ScrollTrigger, EASE, revealLines, countUp } from '../core/motion.js';
import { getProject, projects, liveMetrics } from '../data/projects.js';
import { scrollTo, stopScroll, startScroll, resizeScroll } from '../core/smooth-scroll.js';
import { esc, icons, brandIcons } from '../core/util.js';
import { mediaMarkup, metricMarkup, playMedia, holdMedia, stopMedia, shortTitle } from './projects.js';
import { attach3d, snapshot3d } from '../three/gate.js';

// The feature explorer loads with the first case study that has one, not with the page.
let explorerModule = null;
const loadExplorer = () => (explorerModule ??= import('./explorer.js'));

// The long-form copy is its own chunk (src/data/case-copy.js): fetched when
// the browser is idle after load, or on the first open, and merged into the
// projects once. (A failed fetch is tried again on the next open.)
let copyLoaded = false;
let copyModule = null;
export const loadCaseCopy = () =>
  (copyModule ??= import('../data/case-copy.js').then(
    ({ caseCopy }) => {
      for (const p of projects) Object.assign(p, caseCopy[p.id]);
      copyLoaded = true;
    },
    (e) => {
      copyModule = null;
      throw e;
    }
  ));
import { detectTier } from '../core/device.js';

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
  const words = `
        <p class="proj-meta"><span class="num">${p.num}</span><span>${esc(p.year)}</span>
          ${p.status ? `<span class="chip chip-accent">${esc(p.status)}</span>` : ''}</p>
        <h1 class="pd-title">${esc(p.title)}</h1>
        <p class="pd-short">${esc(p.short)}</p>`;
  // A diorama gets the full width (its explorer sits under it); a piece sits
  // beside the words, turning until paused. Both are frameless.
  const head = p.scene3d
    ? `<header class="pd-head">${words}</header>
      <div class="pd-hero-media">${mediaMarkup(p, { eager: true, shape: 'hero' })}</div>
      ${p.scene3d.chapters?.length ? '<div class="pd-explorer-mount"></div>' : ''}`
    : `<header class="pd-head pd-head-split">
        <div class="pd-head-text">${words}</div>
        <figure class="pd-piece pd-hero-media">
          ${mediaMarkup(p, { eager: true, size: desktop() ? 1080 : 720 })}
          <button class="pd-hold" type="button" hidden><span class="hold-icon" aria-hidden="true"></span><span class="pd-hold-label">Pause</span></button>
        </figure>
      </header>`;
  return `
    <article class="pd-inner">
      <div class="pd-bar">
        <button class="pd-back" id="pd-back" type="button">${icons.arrowLeft}<span>All work</span></button>
      </div>

      ${head}

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

/**
 * A piece's loop plays in its case study on every device (the shelf only
 * plays it under a mouse), with Pause beside it. Reduced motion and Save-Data
 * keep the poster.
 */
function playPiece(el, media) {
  const btn = el.querySelector('.pd-hold');
  if (!btn || !media?.querySelector('video') || reducedMotion() || navigator.connection?.saveData === true) return;
  const label = btn.querySelector('.pd-hold-label');
  let held = false;
  btn.hidden = false;
  btn.addEventListener('click', () => {
    held = !held;
    btn.classList.toggle('is-held', held);
    if (label) label.textContent = held ? 'Play' : 'Pause';
    if (held) holdMedia(media);
    else playMedia(media);
  });
  playMedia(media);
}

const detail = () => document.querySelector('#project-detail');
const main = () => document.querySelector('#main-content');
const siteTitle = document.title;

let isOpen = false;
let splits = [];
let returnFocus = null;

// The case study's live diorama, if this visitor gets one. It picks up the toy
// state its card was left in, and is torn down with the overlay.
let caseDiorama = null;
let explorer = null;
const detach3d = () => {
  explorer?.destroy();
  explorer = null;
  caseDiorama?.destroy();
  caseDiorama = null;
};

/**
 * The explorer under the hero: from the project's data, or from the live
 * scene's own chapters (test fixtures). Resolves to null when there are none.
 */
async function explorerFor(el, p, slot) {
  if (explorer) return explorer;
  const chapters = p.scene3d?.chapters?.length
    ? p.scene3d.chapters
    : slot?.chapters?.list.length
      ? slot.chapters.list.map((c) => slot.chapters.info(c))
      : null;
  if (!chapters) return null;
  const { bindExplorer, explorerMarkup } = await loadExplorer();
  if (explorer || !el.isConnected) return explorer;
  let root = el.querySelector('.pd-explorer');
  if (!root) {
    const mount = el.querySelector('.pd-explorer-mount');
    if (mount) mount.outerHTML = explorerMarkup(chapters);
    else el.querySelector('.pd-hero-media')?.insertAdjacentHTML('afterend', explorerMarkup(chapters));
    root = el.querySelector('.pd-explorer');
  }
  explorer = root ? bindExplorer(root, chapters) : null;
  return explorer;
}

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

/**
 * Grow the clicked picture into the case study's header. Both boxes are
 * measured in the viewport, one before the page swaps and one after, so the
 * scroll reset in between is not taken for movement. Only between boxes of
 * the same shape (a square tile into a square header): a square stretched
 * into a wide box would distort on the way, so that one simply fades in.
 * Returns whether it runs.
 */
function morphFrom(rect, media) {
  if (!rect || !media || reducedMotion() || rect.bottom <= 0 || rect.top >= innerHeight) return false;
  const to = media.getBoundingClientRect();
  if (!to.width || !to.height || Math.abs(rect.width / rect.height - to.width / to.height) > 0.05) return false;
  gsap.fromTo(
    media,
    { x: rect.left - to.left, y: rect.top - to.top, scale: rect.width / to.width, transformOrigin: '0 0' },
    { x: 0, y: 0, scale: 1, duration: 0.8, ease: EASE.inOut, clearProps: 'transform,transformOrigin' }
  );
  return true;
}

export function openProject(id, { push = true } = {}) {
  const p = getProject(id);
  const el = detail();
  if (!p || !el) return;
  if (!copyLoaded) {
    loadCaseCopy().then(() => openProject(id, { push }), (e) => console.warn('[case study]', e));
    return;
  }

  const scrollY = isOpen ? history.state?.scrollY ?? 0 : window.scrollY;
  const sourceMedia = !isOpen ? main().querySelector(`.media[data-id="${p.id}"]`) : null;
  const resume = snapshot3d(sourceMedia);
  const from = sourceMedia?.getBoundingClientRect() ?? null;
  if (!isOpen) returnFocus = document.activeElement;

  stopScroll();
  if (push) {
    history.replaceState({ ...history.state, scrollY }, '');
    history.pushState({ project: p.id, scrollY }, '', `#/project/${p.id}`);
  }

  swapViews(isOpen ? el : main(), () => {
    el.querySelectorAll('.media').forEach(stopMedia);
    detach3d();
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
    playPiece(el, media);

    // Shared-element morph: the picture that was clicked becomes the header's.
    const morph = morphFrom(from, media);

    // The live diorama fades in over the poster once the morph has landed, so
    // the two never move at once.
    explorerFor(el, p, null);
    const attach = () => {
      if (!isOpen || !media?.isConnected || caseDiorama || !media.hasAttribute('data-scene')) return;
      caseDiorama = attach3d(media, p, {
        context: 'case',
        tier: document.documentElement.dataset.tier || detectTier(),
        resume,
        onLive: (slot) => explorerFor(el, p, slot).then((x) => x?.attach(slot)),
      });
      caseDiorama?.setActive(true);
    };
    if (morph) gsap.delayedCall(0.85, attach);
    else requestAnimationFrame(attach);

    el.querySelectorAll('.pd-main .metric-value').forEach((m) => countUp(m, { immediate: true }));

    splits.forEach((s) => s.revert());
    splits = [];
    if (!reducedMotion()) {
      const title = el.querySelector('.pd-title');
      if (title) splits.push(revealLines(title, { trigger: null }));
      // (A header picture that morphs in is already moving; it doesn't rise too.)
      gsap.from(el.querySelectorAll(`.pd-head .proj-meta, .pd-short${morph ? '' : ', .pd-hero-media'}`), {
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
      // (No parallax on the header picture: a live diorama or a playing loop
      // sits exactly over it, and a drifting poster would show at the seams.)
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
    detach3d();
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
    // Escape leaves full screen first (the browser handles that), and a toy
    // that used the key has marked it handled.
    if (e.key !== 'Escape' || !isOpen || e.defaultPrevented || document.fullscreenElement) return;
    history.back();
  });

  const idle = window.requestIdleCallback ?? ((f) => setTimeout(f, 1200));
  const prefetch = () => idle(() => loadCaseCopy().catch(() => {}), { timeout: 4000 });
  if (document.readyState === 'complete') prefetch();
  else addEventListener('load', prefetch, { once: true });

  // Entry points, in order: a real /project/<id>/ page (window.__openProject is
  // written into those builds), then a #/project/<id> hash link.
  const id = window.__openProject || hashProject();
  if (id && getProject(id)) {
    history.replaceState({ project: id, scrollY: 0 }, '', location.pathname + location.hash);
    openProject(id, { push: false });
  }
}
