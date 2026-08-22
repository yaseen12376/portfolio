/**
 * About: sticky heading beside scrolling prose and stat cards.
 */
import { gsap, ScrollTrigger, EASE, DUR, revealLines, revealBatch } from '../core/motion.js';

let splits = [];

export function initAbout({ reduced }) {
  const section = document.querySelector('#about');
  if (!section) return;

  splits.forEach((s) => s.revert());
  splits = [];

  if (!reduced) {
    const lead = section.querySelector('.about-lead');
    if (lead) splits.push(revealLines(lead, { stagger: 0.07 }));
    section.querySelectorAll('.about-body p').forEach((p, i) => {
      splits.push(revealLines(p, { stagger: 0.05, delay: 0.05 * i }));
    });
  }

  revealBatch('#about .stat-card', { stagger: 0.09 });
  initCounters(section, reduced);

  return () => {
    splits.forEach((s) => s.revert());
    splits = [];
  };
}

/** Count-up on the stat cards, driven by ScrollTrigger rather than its own observer. */
function initCounters(scope, reduced) {
  scope.querySelectorAll('.stat-number[data-count]').forEach((el) => {
    const target = parseFloat(el.dataset.count);
    const suffix = el.dataset.suffix ?? '';
    if (reduced) {
      el.textContent = `${target}${suffix}`;
      return;
    }
    const obj = { v: 0 };
    gsap.to(obj, {
      v: target,
      duration: DUR.slow * 1.4,
      ease: EASE.expo,
      onUpdate: () => {
        el.textContent = `${Math.round(obj.v)}${suffix}`;
      },
      scrollTrigger: { trigger: el, start: 'top 88%', once: true },
    });
  });
}
