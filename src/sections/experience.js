/**
 * Experience: one row per role, organisation pinned beside its points.
 *
 * Each row's rule draws itself in as the row passes, and the points arrive one
 * after another, so the timeline reads in the order it happened.
 *
 * On a phone the points fold away (src/core/fold.js): the row shows what was
 * done there as a line of titles, and a tap opens the full points.
 */
import { gsap, revealOnScroll } from '../core/motion.js';
import { foldOnPhone } from '../core/fold.js';
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
      <details class="fold tl-fold" data-fold open>
        <summary class="fold-sum">
          <span class="fold-list">${e.points.map((p) => esc(p.title)).join(' · ')}</span>
          <span class="fold-more"><span class="fold-open">Read more</span><span class="fold-close">Show less</span>${icons.caretDown}</span>
        </summary>
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
      </details>
    </article>`
    )
    .join('');
  foldOnPhone(host);
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
