/**
 * Experience: a timeline whose rail draws with scroll, with each entry's dot
 * lighting up off the rail's own progress rather than its own trigger — so the
 * leading edge and the dots can't drift apart.
 */
import { gsap, ScrollTrigger, EASE, DUR } from '../core/motion.js';
import { experience } from '../data/experience.js';

const ICON = {
  work: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a4 4 0 0 0-8 0v2"/>',
  education: '<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/>',
};

export function renderExperience() {
  const host = document.querySelector('#experience-timeline');
  if (!host) return;
  host.innerHTML = experience
    .map(
      (e) => `
    <article class="exp-card" data-kind="${e.kind}">
      <div class="exp-header">
        <div class="exp-company">
          <div class="exp-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">${ICON[e.kind] ?? ICON.work}</svg>
          </div>
          <div>
            <h3>${e.org}</h3>
            <span class="exp-role">${e.role}</span>
          </div>
        </div>
        <div class="exp-tags">
          <span class="exp-period">${e.period}</span>
          <span class="exp-badge">${e.badge}</span>
        </div>
      </div>
      <ul class="exp-list">
        ${e.points
          .map(
            (p) => `
          <li>
            <span class="exp-dot" aria-hidden="true"></span>
            <div><strong>${p.title}</strong><p>${p.body}</p></div>
          </li>`
          )
          .join('')}
      </ul>
    </article>`
    )
    .join('');
}

export function initExperience({ reduced }) {
  const section = document.querySelector('#experience');
  const rail = section?.querySelector('.exp-rail-fill');
  if (!section) return;

  const dots = gsap.utils.toArray('#experience .exp-dot');
  const items = gsap.utils.toArray('#experience .exp-list li');

  if (reduced) {
    gsap.set(rail, { scaleY: 1 });
    gsap.set(dots, { scale: 1 });
    return;
  }

  gsap.set(dots, { scale: 0 });

  if (rail) {
    gsap.fromTo(
      rail,
      { scaleY: 0 },
      {
        scaleY: 1,
        ease: 'none',
        transformOrigin: 'top',
        scrollTrigger: {
          trigger: '#experience-timeline',
          start: 'top 72%',
          end: 'bottom 78%',
          scrub: 0.5,
          // Light each dot as the rail's leading edge passes it.
          onUpdate: (self) => {
            const reached = Math.floor(self.progress * dots.length + 0.001);
            dots.forEach((dot, i) => {
              const on = i < reached;
              if (dot._on === on) return;
              dot._on = on;
              gsap.to(dot, { scale: on ? 1 : 0, duration: 0.35, ease: on ? EASE.spring : EASE.in });
            });
          },
        },
      }
    );
  }

  items.forEach((li) => {
    gsap.from(li.querySelector('div'), {
      autoAlpha: 0,
      x: 24,
      duration: DUR.base,
      ease: EASE.out,
      scrollTrigger: { trigger: li, start: 'top 82%', once: true },
    });
  });
}
