/**
 * Work, hung as an exhibition. Each project's `tier` places it:
 *
 *   stage           a diorama on a full-height stage of its own: the live
 *                   scene (src/three/) beside its words, with a stepper that
 *                   follows the diorama's tour and can drive it
 *   large, small    a model under glass on the collection shelf, with a
 *                   museum label. A still that turns while hovered (a loop
 *                   rendered by scripts/build-pieces.mjs)
 *
 * and a plain catalogue of all of them after the shelf, for reading at a glance.
 *
 * A diorama loads only as its stage comes near and runs only while the stage
 * is on screen; phones get it on a tap. A piece's loop is fetched on its first
 * hover, and never on touch, under reduced motion or with Save-Data: those
 * visitors see its poster, and the loop plays in the case study instead.
 */
import { gsap, ScrollTrigger, revealOnScroll, countUp } from '../core/motion.js';
import { projects, liveMetrics } from '../data/projects.js';
import pieces from '../data/pieces.json';
import { esc, icons } from '../core/util.js';
import { attach3d, sceneFor } from '../three/gate.js';

const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen'];
const word = (n) => WORDS[n] ?? String(n);

/** Short name for tight spots: "ConstructSafe" rather than the full title. */
export const shortTitle = (p) => p.title.split(':')[0];

/**
 * A project's piece, as built (src/data/pieces.json, written by the piece
 * build): its own files, or the empty jar while its own is not built yet, or
 * null when neither exists (the media gets a typographic frame). `live` is
 * the version of its live jar, where one is built (its case study turns it).
 */
export function pieceFor(p) {
  const id = p?.piece?.id;
  if (!id) return null;
  if (pieces[id]) return { id, v: pieces[id].v, loop: !!pieces[id].loop, live: pieces[id].live ?? null };
  if (pieces._empty) return { id: '_empty', v: pieces._empty.v, loop: false };
  return null;
}

const typeFrame = (p) => `
  <div class="media-fallback"><strong>${esc(shortTitle(p))}</strong>
    <span class="chips">${p.tags.slice(0, 3).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</span>
  </div>`;

/**
 * A project's media box. Always a `.media[data-id]` with an <img>, which is
 * where the case study's shared-element morph starts and ends.
 *
 *   a diorama   its Cycles poster, which the live scene fades in over. `shape`
 *               'stage' is square; 'hero' is 16:9, and square on a phone
 *   a piece     its poster at `size` (720 or 1080 px square) and its loop,
 *               whose sources are attached on first play
 *   neither     a typographic frame
 */
export function mediaMarkup(p, { eager = false, shape = 'hero', size = 720 } = {}) {
  const loading = eager ? 'eager' : 'lazy';
  const id = esc(p.id);
  if (p.scene3d) {
    const sq = p.poster?.startsWith('/3d/') ? p.poster.replace(/poster\.webp$/, 'poster-sq.webp') : null;
    const still = !p.poster
      ? typeFrame(p)
      : shape === 'stage' && sq
        ? `<img src="${esc(sq)}" alt="" width="1440" height="1440" loading="${loading}" decoding="async" />`
        : `<picture>${sq ? `<source media="(max-width: 599.98px)" srcset="${esc(sq)}" />` : ''}<img src="${esc(p.poster)}" alt="" loading="${loading}" decoding="async" /></picture>`;
    return `<div class="media media-diorama" data-id="${id}"${sceneFor(p) ? ' data-scene' : ''}>${still}</div>`;
  }
  const pc = pieceFor(p);
  if (pc) {
    const base = `/pieces/${pc.id}`;
    const video = pc.loop
      ? `<video data-src="${base}/loop-${size}" data-v="${esc(pc.v)}" muted loop playsinline preload="none"
                aria-hidden="true" tabindex="-1" disablepictureinpicture disableremoteplayback></video>`
      : '';
    return `<div class="media media-piece" data-id="${id}" data-piece="${esc(pc.id)}">
        <img src="${base}/poster-${size}.webp?v=${esc(pc.v)}" alt="" width="${size}" height="${size}" loading="${loading}" decoding="async" />${video}
      </div>`;
  }
  return `<div class="media" data-id="${id}">${typeFrame(p)}</div>`;
}

export const metricMarkup = (m) =>
  `<div class="metric"><span class="metric-value">${esc(m.value)}</span><span class="metric-label">${esc(m.label)}</span></div>`;

const metaMarkup = (p, { role = false } = {}) => `
  <p class="proj-meta">
    <span class="num">${p.num}</span><span>${esc(p.year)}</span>
    ${role && p.role ? `<span>${esc(p.role)}</span>` : ''}
    ${p.status ? `<span class="chip chip-accent">${esc(p.status)}</span>` : ''}
  </p>`;

const caseLink = (p, cls = 'btn btn-ghost') => `
  <a class="${cls}" href="#/project/${esc(p.id)}" aria-label="Read the ${esc(shortTitle(p))} case study">
    <span>Read case study</span><span class="btn-icon">${icons.arrowRight}</span>
  </a>`;

const codeNote = (p) =>
  p.repo
    ? `<a class="private-note" href="${esc(p.repo)}" target="_blank" rel="noopener noreferrer">Code on GitHub ${icons.arrowUpRight}</a>`
    : p.private
      ? `<span class="private-note">${icons.lock} Private repository</span>`
      : '';

/* ────────────────────────── the stages ────────────────────────── */

/**
 * The chapters the stage's diorama tours, numbered as the case study numbers
 * them. Plain text until the diorama is live; then each step becomes a button
 * (bindTour) and its bar fills as the tour moves through it.
 */
function tourMarkup(p) {
  const s = p.scene3d;
  const steps = (s?.tour ?? [])
    .map((id) => {
      const i = s.chapters.findIndex((c) => c.id === id);
      return i < 0
        ? ''
        : `<li class="tour-step" data-chapter="${esc(id)}"><span class="tour-n num">${String(i + 1).padStart(2, '0')}</span><span class="tour-t">${esc(s.chapters[i].title)}</span><i class="tour-fill" aria-hidden="true"></i></li>`;
    })
    .join('');
  if (!steps) return '';
  return `
    <div class="tour">
      <div class="tour-head">
        <p class="tour-label">In the diorama</p>
        <button class="tour-hold" type="button" hidden><span class="hold-icon" aria-hidden="true"></span><span class="tour-hold-label">Pause</span></button>
      </div>
      <ol class="tour-steps">${steps}</ol>
      <p class="tour-more">${s.chapters.length} features to try, one at a time, in the case study.</p>
    </div>`;
}

function stageMarkup(p, i) {
  return `
    <article class="stage${i === 0 ? ' flagship' : ''}${i % 2 ? ' is-flipped' : ''}" data-id="${esc(p.id)}" aria-labelledby="stage-${esc(p.id)}">
      <div class="stage-inner">
        <div class="stage-text">
          ${metaMarkup(p, { role: true })}
          <h3 class="proj-title stage-title" id="stage-${esc(p.id)}">${esc(p.title)}</h3>
          <p class="proj-blurb">${esc(p.short)}</p>
          <div class="metrics">${liveMetrics(p).slice(0, 3).map(metricMarkup).join('')}</div>
          ${tourMarkup(p)}
          <div class="proj-actions">${caseLink(p, 'btn btn-primary')}${codeNote(p)}</div>
        </div>
        <div class="stage-media" data-open="${esc(p.id)}">${mediaMarkup(p, { eager: i === 0, shape: 'stage' })}</div>
      </div>
    </article>`;
}

/* ────────────────────────── the shelf ────────────────────────── */

// A museum label: number, title, a line on what it is, the medium (its
// stack), the year and the role. The title's link covers the whole tile.
// On a phone's rail the label is shorter: number, the title up to its colon
// (.plate-rest hides the rest), and kind and year (.plate-kind).
function pieceMarkup(p) {
  const meta = [p.year, p.role].filter(Boolean).map(esc).join(' · ');
  const [head, ...rest] = p.title.split(':');
  const tail = rest.length ? `<span class="plate-rest">:${esc(rest.join(':'))}</span>` : '';
  return `
    <article class="piece piece-${p.tier === 'small' ? 'small' : 'large'}" data-id="${esc(p.id)}">
      ${mediaMarkup(p)}
      <div class="plate">
        <span class="plate-num num">${p.num}</span>
        <div class="plate-body">
          <h4 class="plate-title"><a href="#/project/${esc(p.id)}">${esc(head)}${tail}</a></h4>
          <p class="plate-note">${esc(p.blurb ?? p.short)}</p>
          <p class="plate-medium">${esc(p.tags.join(', '))}</p>
          <p class="plate-meta">${meta}</p>
          <p class="plate-kind">${[p.kind, p.year].filter(Boolean).map(esc).join(' · ')}</p>
        </div>
      </div>
    </article>`;
}

/* ────────────────────────── the catalogue ────────────────────────── */

function catalogueMarkup(list) {
  const row = (p) => `
    <li class="cat-row">
      <a class="cat-link" href="#/project/${esc(p.id)}">
        <span class="cat-num num">${p.num}</span>
        <span class="cat-title">${esc(p.title)}</span>
        <span class="cat-kind">${esc(p.kind ?? '')}</span>
        <span class="cat-year num">${esc(p.year)}</span>
        <span class="cat-role">${esc(p.role ?? '')}</span>
        <span class="cat-go" aria-hidden="true">${icons.arrowRight}</span>
      </a>
    </li>`;
  return `
    <div class="cat-head" aria-hidden="true"><span>No.</span><span>Project</span><span>Kind</span><span>Year</span><span>Role</span><span></span></div>
    <ol class="cat-list">${list.map(row).join('')}</ol>`;
}

export function renderProjects() {
  const stages = document.querySelector('#work-stages');
  const shelf = document.querySelector('#work-shelf');
  const list = document.querySelector('#work-catalogue-list');
  if (!stages || !shelf || !list) return;

  const onStage = projects.filter((p) => p.tier === 'stage');
  const shelved = projects.filter((p) => p.tier !== 'stage');
  stages.innerHTML = onStage.map(stageMarkup).join('');
  shelf.innerHTML = shelved.map(pieceMarkup).join('');
  list.innerHTML = catalogueMarkup(projects);

  const lede = document.querySelector('#work-lede');
  if (lede) lede.textContent = `${word(projects.length)} projects. Computer vision on real cameras, AI that shows its working, and the software around it.`;
  const shelfLede = document.querySelector('#shelf-lede');
  if (shelfLede) shelfLede.textContent = `${word(shelved.length)} more, each made into a small model under glass.`;
  // The hero's count and the room labels read from the same list, so they can never drift.
  document.querySelectorAll('[data-project-count]').forEach((el) => {
    el.textContent = String(projects.length).padStart(2, '0');
  });
  document.querySelectorAll('[data-project-total]').forEach((el) => {
    el.textContent = String(projects.length);
  });
}

/* ────────────────────────── video playback ────────────────────────── */

/** Attach sources on first use, so nothing is fetched speculatively. */
export function playMedia(media) {
  const v = media?.querySelector('video');
  if (!v) return;
  if (!v.dataset.loaded) {
    const base = v.dataset.src;
    const q = v.dataset.v ? `?v=${encodeURIComponent(v.dataset.v)}` : '';
    v.innerHTML = `<source src="${base}.webm${q}" type='video/webm; codecs="vp9"'><source src="${base}.mp4${q}" type="video/mp4">`;
    v.dataset.loaded = '1';
    v.load();
  }
  // A rejected play() is normal (autoplay policy, background tab); the poster
  // simply stays up.
  v.play().then(() => media.classList.add('is-playing')).catch(() => {});
}

/** Pause where it is: a piece holds its pose rather than snapping back to the poster. */
export function holdMedia(media) {
  media?.querySelector('video')?.pause();
}

export function stopMedia(media) {
  holdMedia(media);
  media?.classList.remove('is-playing');
}

/* ────────────────────────── the stepper ────────────────────────── */

const released = new WeakMap();
const releaseTour = (stage) => {
  released.get(stage)?.();
  released.delete(stage);
};

/**
 * Bind a stage's stepper to its live diorama. Each step becomes a button that
 * takes the diorama to its chapter; the step showing fills as the tour runs
 * through it (the 'progress' event, four times a second, eased by CSS), and
 * Pause holds the whole diorama still until Play. Undone by releaseTour,
 * which puts the plain list back.
 */
function bindTour(stage, slot, { signal, onHold }) {
  const tour = stage.querySelector('.tour');
  const ch = slot.chapters;
  if (!tour || !ch) return;
  releaseTour(stage); // a restored WebGL context reloads the scene and binds again

  const steps = [...tour.querySelectorAll('.tour-step')];
  const order = steps.map((li) => li.dataset.chapter);
  for (const li of steps) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tour-btn';
    b.append(...li.childNodes);
    li.append(b);
  }
  tour.classList.add('is-live');

  let on = null;
  const show = (id) => {
    const at = order.indexOf(id);
    on = steps[at] ?? null;
    // The bars snap to their new state instead of running backwards.
    tour.classList.add('is-jump');
    steps.forEach((li, k) => {
      li.classList.toggle('is-on', k === at);
      li.style.setProperty('--p', k < at ? '1' : '0');
      const b = li.querySelector('.tour-btn');
      if (k === at) b?.setAttribute('aria-current', 'step');
      else b?.removeAttribute('aria-current');
    });
    void tour.offsetWidth;
    tour.classList.remove('is-jump');
  };
  const off = ch.on((type, data) => {
    if (type === 'chapter') show(data.id);
    else if (type === 'progress') on?.style.setProperty('--p', data.toFixed(3));
  });
  show(ch.current?.id);

  const hold = tour.querySelector('.tour-hold');
  const label = hold?.querySelector('.tour-hold-label');
  let held = false;
  const setHold = (v) => {
    held = v;
    tour.classList.toggle('is-held', v);
    if (label) label.textContent = v ? 'Play' : 'Pause';
    onHold(v);
  };
  if (hold) hold.hidden = false;

  const ctl = new AbortController();
  tour.addEventListener(
    'click',
    (e) => {
      const b = e.target.closest('.tour-btn');
      if (b) {
        ch.go(b.parentElement.dataset.chapter);
        if (held) setHold(false);
      } else if (e.target.closest('.tour-hold')) setHold(!held);
    },
    { signal: ctl.signal }
  );

  released.set(stage, () => {
    ctl.abort();
    off();
    for (const li of steps) {
      const b = li.querySelector('.tour-btn');
      if (b) {
        li.append(...b.childNodes);
        b.remove();
      }
      li.classList.remove('is-on');
      li.style.removeProperty('--p');
    }
    tour.classList.remove('is-live', 'is-held');
    if (hold) hold.hidden = true;
    if (label) label.textContent = 'Pause';
  });
  signal.addEventListener('abort', () => releaseTour(stage), { once: true });
}

/* ────────────────────────── init ────────────────────────── */

export function initProjects({ reduced, tier }) {
  const section = document.querySelector('#projects');
  if (!section) return;

  const listeners = new AbortController();
  const { signal } = listeners;
  const openCase = (id) => () => {
    location.hash = `#/project/${id}`;
  };

  // Stages. A diorama draws while its stage is on screen, unless its visitor
  // paused it.
  const dioramas = new Map();
  const inView = new Set();
  const held = new Set();
  const apply = (media) => dioramas.get(media)?.setActive(inView.has(media) && !held.has(media));

  section.querySelectorAll('.stage').forEach((stage) => {
    const media = stage.querySelector('.media[data-scene]');
    const p = projects.find((x) => x.id === stage.dataset.id);
    if (!media || !p) return;
    const h = attach3d(media, p, {
      context: 'stage',
      tier,
      onOpen: openCase(p.id),
      onLive: (slot) =>
        bindTour(stage, slot, {
          signal,
          onHold: (v) => {
            if (v) held.add(media);
            else held.delete(media);
            apply(media);
          },
        }),
    });
    if (h) dioramas.set(media, h);
    ScrollTrigger.create({
      trigger: media,
      start: 'top 80%',
      end: 'bottom 20%',
      onToggle: (self) => {
        if (self.isActive) inView.add(media);
        else inView.delete(media);
        apply(media);
      },
    });
  });

  // The picture opens the case study while it is a picture (before its
  // diorama is live, or where there is none). A live diorama decides for
  // itself: a click on its backdrop opens the case study, a drag turns it.
  section.querySelectorAll('.stage-media[data-open]').forEach((el) => {
    el.addEventListener('click', () => openCase(el.dataset.open)(), { signal });
  });

  // Pieces turn while the pointer rests on them, and hold their pose when it
  // leaves. Only for a mouse or trackpad, with motion and data to spare.
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const saveData = navigator.connection?.saveData === true;
  if (fine && !reduced && !saveData) {
    // A loop scrolled out of sight under a resting pointer stops decoding.
    const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting || holdMedia(e.target)));
    section.querySelectorAll('.piece').forEach((piece) => {
      const media = piece.querySelector('.media-piece');
      if (!media?.querySelector('video')) return;
      io.observe(media);
      const play = () => playMedia(media);
      const hold = () => holdMedia(media);
      piece.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && play(), { signal });
      piece.addEventListener('pointerleave', hold, { signal });
      piece.addEventListener('focusin', play, { signal });
      piece.addEventListener('focusout', hold, { signal });
    });
    signal.addEventListener('abort', () => io.disconnect(), { once: true });
  }
  document.addEventListener(
    'visibilitychange',
    () => document.hidden && section.querySelectorAll('.media.is-playing').forEach(holdMedia),
    { signal }
  );

  gsap.utils.toArray('#projects .metric-value').forEach((el) => countUp(el));
  revealOnScroll('#work-stages .stage-text, #work-shelf .piece, #work-catalogue .cat-row');

  return () => {
    listeners.abort();
    section.querySelectorAll('.media.is-playing').forEach(stopMedia);
    dioramas.forEach((h) => h.destroy());
    dioramas.clear();
  };
}
