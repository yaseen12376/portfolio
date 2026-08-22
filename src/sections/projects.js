/**
 * Projects: a sticky media panel beside a scrolling index of project rows.
 *
 * Scrolling the list swaps the panel. The panel is a single, always-on-screen
 * element, which is what makes the Flip transition into the detail view work —
 * the poster physically flies from the panel into the detail hero.
 *
 * Rejected a pinned horizontal track: it hijacks the scroll axis, breaks
 * PageDown and find-in-page, needs a whole second implementation for mobile
 * (which is a vertical list — i.e. this), and makes restoring scroll state
 * after returning from a detail view considerably harder.
 */
import { gsap, ScrollTrigger, EASE, DUR } from '../core/motion.js';
import { projects } from '../data/projects.js';

function rowMarkup(p, i) {
  const tags = p.tags
    .slice(0, 3)
    .map((t) => `<span class="row-tag">${t}</span>`)
    .join('');
  return `
    <li class="project-row" data-id="${p.id}" data-index="${i}">
      <a class="row-link" href="#/project/${p.id}" aria-label="${p.title}">
        <span class="row-num">${p.num}</span>
        <span class="row-body">
          <span class="row-title">${p.title}</span>
          <span class="row-short">${p.short}</span>
          <span class="row-tags">${tags}</span>
        </span>
        <span class="row-arrow" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M7 17 17 7M9 7h8v8"/>
          </svg>
        </span>
        <span class="row-rule" aria-hidden="true"></span>
      </a>
      <div class="row-media" aria-hidden="true">
        <img src="${p.poster}" alt="" loading="lazy" decoding="async" />
      </div>
    </li>`;
}

// No caption here on purpose: the poster art carries its own HUD labelling, and
// the row sitting beside the panel already shows number, title and tags. A
// figcaption would both duplicate that and collide with the artwork's own text.
//
// The <video> carries preload="none" and no src until it is needed — see
// initProjects. Nothing downloads for a project the visitor never reaches, and
// the poster image is what shows until a loop is actually playing.
function panelMarkup(p, i) {
  const media = p.video
    ? `<video class="panel-video" data-src="${p.video}" poster="${p.poster}"
              muted loop playsinline preload="none" aria-hidden="true" tabindex="-1"
              disablepictureinpicture disableremoteplayback
              controlslist="nodownload noplaybackrate noremoteplayback"></video>`
    : '';
  return `
    <figure class="panel-layer${i === 0 ? ' is-active' : ''}" data-id="${p.id}" data-accent="${p.accent}">
      <img src="${p.poster}" alt="${p.title}" loading="${i === 0 ? 'eager' : 'lazy'}" decoding="async" />
      ${media}
    </figure>`;
}

export function renderProjects() {
  const list = document.querySelector('#projects-list');
  const panel = document.querySelector('#projects-panel-stack');
  if (!list || !panel) return;
  list.innerHTML = projects.map(rowMarkup).join('');
  panel.innerHTML = projects.map(panelMarkup).join('');
}

export function initProjects({ desktop, reduced }) {
  const section = document.querySelector('#projects');
  if (!section) return;

  const rows = gsap.utils.toArray('#projects-list .project-row');
  const layers = gsap.utils.toArray('#projects-panel-stack .panel-layer');
  const panel = section.querySelector('.projects-panel');
  if (!rows.length) return;

  const swapDuration = reduced ? 0.01 : 0.45;
  let active = 0;

  // Video only where it earns its place: a phone gets stills (data cost, and
  // the panel is inline rather than sticky there), and reduced motion means a
  // looping clip is exactly what the visitor asked not to see.
  const useVideo = desktop && !reduced;

  /** Attach the source on first use, so nothing is fetched speculatively. */
  const playVideo = (layer) => {
    const v = layer.querySelector('.panel-video');
    if (!v) return;
    if (!v.dataset.loaded) {
      const base = v.dataset.src;
      v.innerHTML =
        `<source src="${base}.webm" type="video/webm">` +
        `<source src="${base}.mp4" type="video/mp4">`;
      v.dataset.loaded = '1';
      v.load();
    }
    // A rejected play() is normal (autoplay policy, tab backgrounded); the
    // poster stays up and nothing breaks.
    v.play().then(() => layer.classList.add('is-playing')).catch(() => {});
  };

  const stopVideo = (layer) => {
    const v = layer.querySelector('.panel-video');
    if (!v) return;
    v.pause();
    layer.classList.remove('is-playing');
  };

  const setActive = (i) => {
    if (i === active) return;
    active = i;
    layers.forEach((layer, n) => {
      const isOn = n === i;
      layer.classList.toggle('is-active', isOn);
      if (useVideo) (isOn ? playVideo : stopVideo)(layer);
      gsap.to(layer, {
        autoAlpha: isOn ? 1 : 0,
        duration: swapDuration,
        ease: EASE.out,
        overwrite: 'auto',
      });
      if (isOn && !reduced) {
        gsap.fromTo(
          layer.querySelector('img'),
          { scale: 1.07 },
          { scale: 1, duration: swapDuration * 1.6, ease: EASE.out, overwrite: 'auto' }
        );
      }
    });
    rows.forEach((r, n) => r.classList.toggle('is-active', n === i));
    section.dataset.accent = layers[i]?.dataset.accent ?? 'purple';
  };

  gsap.set(layers, { autoAlpha: 0 });
  gsap.set(layers[0], { autoAlpha: 1 });
  rows[0].classList.add('is-active');

  if (useVideo) {
    // Decoding a loop nobody can see is wasted battery, so playback is tied to
    // the section being on screen, not just to which row is active.
    ScrollTrigger.create({
      trigger: section,
      start: 'top bottom',
      end: 'bottom top',
      onToggle: (self) => {
        if (self.isActive) playVideo(layers[active]);
        else layers.forEach(stopVideo);
      },
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) layers.forEach(stopVideo);
      else if (ScrollTrigger.isInViewport(section)) playVideo(layers[active]);
    });
  }

  rows.forEach((row, i) => {
    ScrollTrigger.create({
      trigger: row,
      start: 'top 58%',
      end: 'bottom 42%',
      onEnter: () => setActive(i),
      onEnterBack: () => setActive(i),
    });

    if (reduced) return;

    // The rule under each row draws in as it becomes active.
    gsap.fromTo(
      row.querySelector('.row-rule'),
      { scaleX: 0 },
      {
        scaleX: 1,
        ease: 'none',
        scrollTrigger: { trigger: row, start: 'top 78%', end: 'top 45%', scrub: true },
      }
    );

    gsap.from(row, {
      autoAlpha: 0,
      y: 40,
      duration: DUR.base,
      ease: EASE.out,
      scrollTrigger: { trigger: row, start: 'top 88%', once: true },
    });
  });

  // Hovering a row tilts the panel a few degrees toward the pointer. Makes the
  // list feel like it is driving the panel rather than merely indexing it.
  if (desktop && !reduced && panel) {
    const frame = panel.querySelector('.panel-frame');
    const rotX = gsap.quickTo(frame, 'rotationX', { duration: 0.6, ease: EASE.out });
    const rotY = gsap.quickTo(frame, 'rotationY', { duration: 0.6, ease: EASE.out });
    const scale = gsap.quickTo(frame, 'scale', { duration: 0.6, ease: EASE.out });
    gsap.set(frame, { transformPerspective: 900, transformOrigin: 'center' });

    rows.forEach((row) => {
      row.addEventListener('pointermove', (e) => {
        const r = row.getBoundingClientRect();
        rotY(gsap.utils.clamp(-6, 6, ((e.clientX - (r.left + r.width / 2)) / r.width) * 10));
        rotX(gsap.utils.clamp(-5, 5, -((e.clientY - (r.top + r.height / 2)) / r.height) * 8));
        scale(1.02);
      });
      row.addEventListener('pointerleave', () => {
        rotX(0);
        rotY(0);
        scale(1);
      });
    });
  }

  // Slight drift on the panel so it doesn't feel welded to the viewport.
  if (desktop && !reduced && panel) {
    gsap.fromTo(
      panel,
      { y: 18 },
      {
        y: -18,
        ease: 'none',
        scrollTrigger: { trigger: section, start: 'top bottom', end: 'bottom top', scrub: true },
      }
    );
  }
}
