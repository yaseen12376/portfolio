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
function panelMarkup(p, i) {
  return `
    <figure class="panel-layer${i === 0 ? ' is-active' : ''}" data-id="${p.id}" data-accent="${p.accent}">
      <img src="${p.poster}" alt="${p.title}" loading="${i === 0 ? 'eager' : 'lazy'}" decoding="async" />
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

  const setActive = (i) => {
    if (i === active) return;
    active = i;
    layers.forEach((layer, n) => {
      const isOn = n === i;
      layer.classList.toggle('is-active', isOn);
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
