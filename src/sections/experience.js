/**
 * Experience: one row per role, organisation pinned beside its points.
 *
 * Each row's rule draws itself in as the row passes, and the points arrive one
 * after another, so the timeline reads in the order it happened.
 */
import { gsap, revealOnScroll } from '../core/motion.js';
import { experience } from '../data/experience.js';
import { esc, icons } from '../core/util.js';

export function renderExperience() {
  const host = document.querySelector('#experience-timeline');
  if (!host) return;
  host.innerHTML = experience
    .map(
      (e) => `
    <article class="tl-row">
      <span class="tl-line" aria-hidden="true"></span>
      <div class="tl-side">
        <p class="tl-period">${esc(e.period)}</p>
        <h3 class="tl-org">${esc(e.org)}</h3>
        <p class="tl-role">${esc(e.role)}</p>
        <span class="chip">${esc(e.badge)}</span>
      </div>
      <div class="tl-points">
        ${e.points
          .map(
            (p) => `
          <div class="tl-point">
            <h4>${esc(p.title)}</h4>
            <p>${esc(p.body)}</p>
            ${p.project ? `<a class="tl-link" href="#/project/${esc(p.project)}">Read the case study ${icons.arrowRight}</a>` : ''}
          </div>`
          )
          .join('')}
      </div>
    </article>`
    )
    .join('');
}

export function initExperience({ reduced } = {}) {
  revealOnScroll('#experience .tl-side, #experience .tl-point');
  if (reduced) return;

  gsap.utils.toArray('#experience .tl-row').forEach((row) => {
    gsap.fromTo(
      row.querySelector('.tl-line'),
      { scaleX: 0 },
      {
        scaleX: 1,
        ease: 'none',
        transformOrigin: 'left center',
        scrollTrigger: { trigger: row, start: 'top 88%', end: 'bottom 70%', scrub: 0.4 },
      }
    );
  });
}
