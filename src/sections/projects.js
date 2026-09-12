/**
 * Work: one flagship, a pinned stack of featured case studies, and a bento of
 * smaller builds. Placement comes from each project's `tier`.
 *
 * Video loops are attached lazily: a <video> carries only data-src and
 * preload="none" until it is the thing on screen, so nothing downloads for a
 * project the visitor never reaches. Phones and reduced motion get stills.
 */
import { gsap, ScrollTrigger, EASE, revealOnScroll, countUp } from '../core/motion.js';
import { projects, liveMetrics } from '../data/projects.js';
import { esc, icons } from '../core/util.js';

const LOCK = '<span class="lock" aria-hidden="true"><i></i><i></i><i></i><i></i></span>';
const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];

/** Short name for tight spots: "ConstructSafe" rather than the full title. */
export const shortTitle = (p) => p.title.split(':')[0];

/** Poster (or a typographic frame), an optional lazy loop, and lock brackets. */
export function mediaMarkup(p, { eager = false } = {}) {
  const still = p.poster
    ? `<img src="${esc(p.poster)}" alt="" loading="${eager ? 'eager' : 'lazy'}" decoding="async" />`
    : `<div class="media-fallback"><strong>${esc(shortTitle(p))}</strong>
         <span class="chips">${p.tags.slice(0, 3).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</span>
       </div>`;
  const video = p.video
    ? `<video data-src="${esc(p.video)}" ${p.poster ? `poster="${esc(p.poster)}"` : ''} muted loop playsinline
              preload="none" aria-hidden="true" tabindex="-1" disablepictureinpicture disableremoteplayback></video>`
    : '';
  return `<div class="media" data-id="${esc(p.id)}">${still}${video}${LOCK}</div>`;
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

/**
 * Expandable detail. The button is the accessible base: it works by touch and
 * by keyboard, and it pins the panel open. On a fine pointer, hovering the card
 * opens the same panel. The panel animates on grid-template-rows, so nothing
 * has to be measured and no layout is thrashed.
 */
const detailsToggle = (p) => `
  <button class="card-toggle" type="button" aria-expanded="false" aria-controls="detail-${esc(p.id)}">
    <span class="card-toggle-label">Details</span>
    <span class="card-toggle-icon" aria-hidden="true"></span>
  </button>`;

const detailPanel = (p, { metrics = [] } = {}) => {
  const d = p.detail;
  const rows = d
    ? `<dl class="detail-rows">
         <div><dt>Problem</dt><dd>${esc(d.problem)}</dd></div>
         <div><dt>Built</dt><dd>${esc(d.built)}</dd></div>
         <div><dt>Result</dt><dd>${esc(d.result)}</dd></div>
       </dl>`
    : '';
  return `
    <div class="card-detail" id="detail-${esc(p.id)}">
      <div class="card-detail-inner">
        ${metrics.length ? `<div class="metrics">${metrics.map(metricMarkup).join('')}</div>` : ''}
        ${rows}
      </div>
    </div>`;
};

function flagshipMarkup(p) {
  return `
    <article class="flagship" data-id="${esc(p.id)}">
      <a class="shell flag-media" href="#/project/${esc(p.id)}" tabindex="-1" aria-hidden="true">
        <div class="core">${mediaMarkup(p, { eager: true })}</div>
      </a>
      <div class="flagship-body">
        <div>
          ${metaMarkup(p, { role: true })}
          <h3 class="proj-title">${esc(p.title)}</h3>
          <p class="proj-blurb">${esc(p.blurb ?? p.short)}</p>
          <div class="proj-actions">${caseLink(p, 'btn btn-primary')}${detailsToggle(p)}${codeNote(p)}</div>
          ${detailPanel(p)}
        </div>
        <div class="metrics">${liveMetrics(p).slice(0, 3).map(metricMarkup).join('')}</div>
      </div>
    </article>`;
}

function stackMarkup(p) {
  const facts = [
    p.role && `<dt>Role</dt><dd>${esc(p.role)}</dd>`,
    p.team && `<dt>Team</dt><dd>${esc(p.team)}</dd>`,
  ].filter(Boolean).join('');
  return `
    <article class="stack-card" data-id="${esc(p.id)}" data-num="${p.num}">
      <div class="container stack-inner">
        <span class="card-scrim" aria-hidden="true"></span>
        <div class="shell">
          <div class="core card-core">
            ${mediaMarkup(p)}
            <div class="card-body">
              ${metaMarkup(p)}
              <h3 class="proj-title">${esc(p.title)}</h3>
              <p class="proj-blurb">${esc(p.blurb ?? p.short)}</p>
              ${facts ? `<dl class="card-facts">${facts}</dl>` : ''}
              <!-- Figures stay on the resting card: they are numbers, not prose,
                   and a pinned card's height is fixed, so a panel carrying them
                   as well overflows and gets clipped. -->
              <div class="metrics">${liveMetrics(p).slice(0, 2).map(metricMarkup).join('')}</div>
              <div class="chips">${p.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
              <div class="proj-actions">${caseLink(p)}${detailsToggle(p)}${codeNote(p)}</div>
              ${detailPanel(p)}
            </div>
          </div>
        </div>
      </div>
    </article>`;
}

// An <article>, not an <a>: the card now carries its own Details button, and a
// button inside a link is invalid and unusable by keyboard. The title and the
// case-study link are the click targets instead.
function moreMarkup(p) {
  return `
    <article class="shell more-card" data-id="${esc(p.id)}">
      <div class="core">
        ${mediaMarkup(p)}
        <div class="more-body">
          ${metaMarkup(p)}
          <h3 class="proj-title"><a href="#/project/${esc(p.id)}">${esc(p.title)}</a></h3>
          <p class="proj-blurb">${esc(p.blurb ?? p.short)}</p>
          <div class="chips">${p.tags.slice(0, 3).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
          <div class="proj-actions">
            ${detailsToggle(p)}
            <a class="card-link" href="#/project/${esc(p.id)}" aria-label="Read the ${esc(shortTitle(p))} case study">Read case study ${icons.arrowRight}</a>
          </div>
          ${detailPanel(p)}
        </div>
      </div>
    </article>`;
}

export function renderProjects() {
  const flagship = document.querySelector('#work-flagship');
  const stack = document.querySelector('#work-stack');
  const more = document.querySelector('#work-more');
  const lede = document.querySelector('#work-lede');
  if (!flagship || !stack || !more) return;

  const byTier = (t) => projects.filter((p) => p.tier === t);
  const featured = byTier('featured');
  flagship.innerHTML = byTier('flagship').map(flagshipMarkup).join('');
  // The rail tells you where you are inside the pinned stack, where the usual
  // cue (the page moving) is deliberately absent.
  // The rail counts in project numbers, the same ones printed on the cards.
  // Counting the stack's own position instead would put two different numbering
  // systems on screen at the same time.
  stack.innerHTML =
    `<div class="stack-rail" aria-hidden="true">
       <span class="rail-num">${featured[0]?.num ?? '01'}</span>
       <span class="rail-track"><i></i></span>
       <span class="rail-total">${String(projects.length).padStart(2, '0')}</span>
     </div>` + featured.map(stackMarkup).join('');
  more.innerHTML = byTier('more').map(moreMarkup).join('');

  if (lede) {
    const n = WORDS[projects.length] ?? String(projects.length);
    lede.textContent = `${n} projects. Computer vision on real cameras, and the software around it.`;
  }

}

/**
 * Details: click pins the panel open, hover opens it on a fine pointer only.
 * A pinned panel ignores the pointer leaving, or the card would snap shut
 * under the cursor of someone who just asked to keep it open.
 */
function initCardDetails({ reduced }) {
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  document.querySelectorAll('#projects .card-toggle').forEach((btn) => {
    const root = btn.closest('.flagship, .stack-card, .more-card');
    const label = btn.querySelector('.card-toggle-label');
    if (!root) return;
    // initProjects re-runs whenever the breakpoint context changes, and these
    // are plain DOM listeners on elements that survive it. Without this, one
    // click would toggle twice after a resize.
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';

    let pinned = false;
    let timer;
    const set = (open) => {
      root.classList.toggle('is-detail-open', open);
      btn.setAttribute('aria-expanded', String(open));
      if (label) label.textContent = open ? 'Hide' : 'Details';
    };

    btn.addEventListener('click', () => {
      pinned = !pinned;
      set(pinned);
    });

    if (!fine || reduced) return;
    // Hover belongs to the visible card, not the article. A pinned stack card
    // is full-bleed and viewport-tall, so binding to it would mean the pointer
    // being anywhere on screen counts as hovering it.
    const hoverArea = root.querySelector('.stack-inner') ?? root;
    hoverArea.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse' || pinned) return;
      timer = setTimeout(() => set(true), 130);
    });
    hoverArea.addEventListener('pointerleave', () => {
      clearTimeout(timer);
      if (!pinned) set(false);
    });
  });
}

/* ────────────────────────── video playback ────────────────────────── */

/** Attach sources on first use, so nothing is fetched speculatively. */
export function playMedia(media) {
  const v = media?.querySelector('video');
  if (!v) return;
  if (!v.dataset.loaded) {
    const base = v.dataset.src;
    v.innerHTML = `<source src="${base}.webm" type="video/webm"><source src="${base}.mp4" type="video/mp4">`;
    v.dataset.loaded = '1';
    v.load();
  }
  // A rejected play() is normal (autoplay policy, background tab); the poster
  // simply stays up.
  v.play().then(() => media.classList.add('is-playing')).catch(() => {});
}

export function stopMedia(media) {
  const v = media?.querySelector('video');
  if (!v) return;
  v.pause();
  media.classList.remove('is-playing');
}

let visibilityBound = false;

export function initProjects({ desktop, reduced }) {
  const section = document.querySelector('#projects');
  if (!section) return;

  const useVideo = desktop && !reduced;
  const playing = new Set();
  const setOn = (media, on) => {
    if (!media) return;
    media.closest('.shell, .media')?.classList.toggle('is-locked', on);
    media.classList.toggle('is-locked', on);
    if (!useVideo) return;
    if (on) {
      playMedia(media);
      playing.add(media);
    } else {
      stopMedia(media);
      playing.delete(media);
    }
  };

  // Flagship and bento: active while on screen.
  gsap.utils.toArray('#work-flagship .media, #work-more .media').forEach((media) => {
    ScrollTrigger.create({
      trigger: media,
      start: 'top 80%',
      end: 'bottom 20%',
      onToggle: (self) => setOn(media, self.isActive),
    });
  });

  const cards = gsap.utils.toArray('#work-stack .stack-card');

  // Paint order has to be explicit. A pinned card becomes position:fixed, and
  // leaving every card on z-index auto lets the receding one show through the
  // card arriving over it. Ascending z-index means later always covers earlier.
  cards.forEach((card, i) => {
    card.style.zIndex = String(i + 1);
  });

  // The rail's counter rolls over as each card takes the screen.
  const railNum = section.querySelector('.rail-num');
  const showNum = (next) => {
    if (!railNum || !next || railNum.textContent === next) return;
    if (reduced) {
      railNum.textContent = next;
      return;
    }
    gsap
      .timeline()
      .to(railNum, { yPercent: -100, autoAlpha: 0, duration: 0.18, ease: EASE.in })
      // Set the text by hand: GSAP coerces a numeric-looking string, which
      // turns "03" into 3.
      .add(() => {
        railNum.textContent = next;
      })
      .set(railNum, { yPercent: 100 })
      .to(railNum, { yPercent: 0, autoAlpha: 1, duration: 0.3, ease: EASE.out });
  };

  // Stack: a card is active from when it reaches mid-screen until the next one
  // does. With pinSpacing:false the card's natural bottom is the next card's
  // top, so 'bottom 55%' is exactly that handover.
  cards.forEach((card) => {
    const media = card.querySelector('.media');
    ScrollTrigger.create({
      trigger: card,
      start: 'top 55%',
      end: 'bottom 55%',
      onToggle: (self) => {
        setOn(media, self.isActive);
        if (self.isActive) showNum(card.dataset.num);
      },
    });
  });

  // Rail visibility and fill, driven by progress through the whole stack.
  const stackEl = document.querySelector('#work-stack');
  const rail = section.querySelector('.stack-rail');
  const fill = section.querySelector('.rail-track i');
  if (stackEl && rail && fill) {
    const setFill = gsap.quickSetter(fill, 'scaleY');
    ScrollTrigger.create({
      trigger: stackEl,
      start: 'top top',
      end: 'bottom bottom',
      onToggle: (self) => rail.classList.toggle('is-on', self.isActive),
      onUpdate: (self) => setFill(self.progress),
    });
  }

  // Pinned stack, desktop only. Every card but the last pins at the top; the
  // one underneath recedes as the next slides over it.
  if (desktop && !reduced && cards.length > 1) {
    const last = cards[cards.length - 1];
    cards.forEach((card, i) => {
      if (card === last) return;
      ScrollTrigger.create({
        trigger: card,
        start: 'top top',
        endTrigger: last,
        end: 'top top',
        pin: true,
        pinSpacing: false,
      });
      // The outgoing card recedes behind a scrim, then leaves entirely. It is
      // pinned (position: fixed), so it paints above the card arriving over it:
      // dimming alone leaves a slab of the old card floating on screen through
      // the whole handover. The scrim does the first half, opacity the last.
      gsap
        .timeline({
          scrollTrigger: { trigger: cards[i + 1], start: 'top bottom', end: 'top top', scrub: true },
        })
        .to(card.querySelector('.stack-inner'), { scale: 0.94, ease: 'none' }, 0)
        .to(card.querySelector('.card-scrim'), { opacity: 0.72, ease: 'none', duration: 0.6 }, 0)
        .to(card, { autoAlpha: 0, ease: 'none', duration: 0.4 }, 0.6);
    });
  }

  if (!reduced) {
    // Each card rises the last few pixels as it slides over the one before.
    cards.forEach((card, i) => {
      if (i === 0) return;
      gsap.fromTo(
        card.querySelector('.stack-inner'),
        { yPercent: 5 },
        {
          yPercent: 0,
          ease: 'none',
          scrollTrigger: { trigger: card, start: 'top bottom', end: 'top top', scrub: true },
        }
      );
    });

    // Posters drift inside their frame, so a still has depth too. The stack is
    // left out on purpose: a pinned card doesn't move, so its poster shouldn't.
    gsap.utils.toArray('#work-flagship .media img, #work-more .media img').forEach((img) => {
      gsap.fromTo(
        img,
        { yPercent: -3.5, scale: 1.09 },
        {
          yPercent: 3.5,
          ease: 'none',
          scrollTrigger: { trigger: img.closest('.media'), start: 'top bottom', end: 'bottom top', scrub: true },
        }
      );
    });
  }

  gsap.utils.toArray('#projects .metric-value').forEach((el) => countUp(el));
  initCardDetails({ reduced });

  revealOnScroll('#work-flagship .flagship, #work-more .more-card');

  // Decoding loops nobody can see is wasted battery.
  if (useVideo && !visibilityBound) {
    visibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      document
        .querySelectorAll('#projects .media.is-playing, #projects .media.is-locked')
        .forEach((m) => (document.hidden ? stopMedia(m) : m.classList.contains('is-locked') && playMedia(m)));
    });
  }

  return () => playing.forEach(stopMedia);
}
