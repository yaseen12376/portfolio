/**
 * Skills: a velocity-reactive marquee over a grouped grid.
 *
 * The marquee is GSAP-driven rather than a CSS @keyframes loop, because a CSS
 * animation can't react to scroll — here it surges and skews with scroll
 * velocity and reverses with direction.
 */
import { gsap, ScrollTrigger, EASE, revealBatch } from '../core/motion.js';
import { skills, skillGroups } from '../data/skills.js';
import { scrollVelocity } from '../core/smooth-scroll.js';

export function renderSkills() {
  const track = document.querySelector('#skills-track');
  const grid = document.querySelector('#skills-grid');

  if (track) {
    // Two copies so the -50% loop is seamless.
    const pills = skills.map((s) => `<span class="skill-pill">${s}</span>`).join('');
    track.innerHTML = `<div class="skills-set">${pills}</div><div class="skills-set" aria-hidden="true">${pills}</div>`;
  }

  if (grid) {
    grid.innerHTML = skillGroups
      .map(
        (g) => `
        <div class="skill-group">
          <h3 class="skill-group-label">${g.label}</h3>
          <ul class="skill-group-items">
            ${g.items.map((i) => `<li>${i}</li>`).join('')}
          </ul>
        </div>`
      )
      .join('');
  }
}

export function initSkills({ reduced }) {
  revealBatch('#skills-grid .skill-group', { stagger: 0.08 });

  const track = document.querySelector('#skills-track');
  if (!track) return;

  if (reduced) {
    track.classList.add('is-static');
    return;
  }

  const loop = gsap.to(track, {
    xPercent: -50,
    duration: 28,
    ease: 'none',
    repeat: -1,
  });

  const skewTo = gsap.quickTo(track, 'skewX', { duration: 0.5, ease: EASE.out });

  ScrollTrigger.create({
    trigger: '#skills',
    start: 'top bottom',
    end: 'bottom top',
    onUpdate: (self) => {
      const v = scrollVelocity();
      const boost = 1 + Math.min(Math.abs(v) / 900, 3);
      loop.timeScale(self.direction * boost || boost);
      skewTo(gsap.utils.clamp(-8, 8, v / 260));
    },
    onLeave: () => skewTo(0),
    onLeaveBack: () => skewTo(0),
  });

  const wrapper = document.querySelector('.skills-marquee');
  wrapper?.addEventListener('mouseenter', () => gsap.to(loop, { timeScale: 0.15, duration: 0.4 }));
  wrapper?.addEventListener('mouseleave', () => gsap.to(loop, { timeScale: 1, duration: 0.4 }));
}
