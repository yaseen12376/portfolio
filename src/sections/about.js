/**
 * About: short bio with facts, beside a proof bento.
 *
 * Every figure in the bento is also stated, with its source, in the matching
 * project's data (src/data/projects.js). Keep the two in step.
 */
import { gsap, revealOnScroll, countUp } from '../core/motion.js';
import { profile } from '../data/profile.js';
import { esc, icons } from '../core/util.js';

const PROOF = [
  {
    value: '2.4×',
    label: 'faster inference after moving Retail Analytics to TensorRT, with identical counts on every test clip.',
    project: 'retail-analytics',
    img: '/posters/retail-analytics.webp',
  },
  {
    value: '6 cams',
    label: 'batched through one model on a laptop GPU, above the 15 FPS target per stream.',
    project: 'retail-analytics',
  },
  {
    word: 'Client software',
    label: 'Booking, billing and tracking for a courier franchise, in ASP.NET Core 8 with WhatsApp and SMS updates.',
    project: 'courier',
    soft: true,
  },
  {
    word: 'Top contributor',
    label: 'to the ConstructSafe detection engine: PPE, falls, fire and faces in one pipeline, in a team of seven.',
    project: 'constructsafe',
    img: '/posters/constructsafe.webp',
  },
];

export function renderAbout() {
  const facts = document.querySelector('#about-facts');
  const grid = document.querySelector('#proof-grid');

  if (facts) {
    const rows = [
      ['Based in', profile.location],
      ['Studying', `${profile.education.degree}, graduating ${profile.education.year}`],
      ['Currently', profile.current],
      ['Languages', profile.languages.join(', ')],
    ];
    facts.innerHTML = rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  }

  if (grid) {
    grid.innerHTML = PROOF.map(
      (p) => `
      <div class="proof${p.soft ? ' proof-soft' : ''}">
        ${p.img ? `<img class="proof-img" src="${esc(p.img)}" alt="" loading="lazy" decoding="async" />` : ''}
        ${p.value ? `<span class="proof-value">${esc(p.value)}</span>` : `<span class="proof-word">${esc(p.word)}</span>`}
        <p class="proof-label">${esc(p.label)}</p>
        <a class="proof-link" href="#/project/${esc(p.project)}">View project ${icons.arrowRight}</a>
      </div>`
    ).join('');
  }
}

export function initAbout({ reduced } = {}) {
  revealOnScroll('#proof-grid .proof, #about-facts');
  gsap.utils.toArray('#proof-grid .proof-value').forEach((el) => countUp(el));

  // The image inside a proof tile drifts a little as the tile passes.
  if (reduced) return;
  gsap.utils.toArray('#proof-grid .proof-img').forEach((img) => {
    gsap.fromTo(
      img,
      { yPercent: -4 },
      {
        yPercent: 4,
        ease: 'none',
        scrollTrigger: { trigger: img.closest('.proof'), start: 'top bottom', end: 'bottom top', scrub: true },
      }
    );
  });
}
