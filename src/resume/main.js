/**
 * The résumé page (/resume/): two A4 sheets, laid out from src/resume/content.js.
 *
 * Content is one column in reading order. Blocks fill the first sheet and
 * flow onto the second; a section heading never ends a sheet without its
 * first entry. If two sheets can't hold it all, the type shrinks a step at a
 * time (to 92% at most). `window.__resume.ready` says how it went, for the
 * generator (scripts/gen-resume.mjs), which prints this page to
 * public/resume.pdf.
 *
 * ?edit=1 adds a picker beside the sheets, to leave projects out of a print.
 */
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './resume.css';
import { resumeModel } from './content.js';

const SHEETS = 2;
const FIT_FLOOR = 92;

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const html = (s) => {
  const t = document.createElement('template');
  t.innerHTML = s.trim();
  return t.content.firstElementChild;
};
const link = (c) => (c.href ? `<a href="${esc(c.href)}">${esc(c.label)}</a>` : `<span>${esc(c.label)}</span>`);
const points = (list) => (list.length ? `<ul class="r-points">${list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');

const editing = new URLSearchParams(location.search).has('edit');
const model = resumeModel({ phone: window.__RESUME_PRINT__?.phone ?? null });
const updated = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

/* ────────────────────────── blocks, in reading order ────────────────────────── */

const head = (t) => html(`<h2 class="r-head">${esc(t)}</h2>`);
const blocks = [];

blocks.push(
  html(`<header class="r-top">
    <h1 class="r-name">${esc(model.name)}</h1>
    <p class="r-role">${esc(model.role)}<span class="r-sep" aria-hidden="true">·</span>${esc(model.location)}</p>
    <p class="r-contact">${model.contact.map(link).join('<span class="r-sep" aria-hidden="true">·</span>')}</p>
  </header>`)
);

blocks.push(head('Summary'), html(`<p class="r-summary">${esc(model.summary)}</p>`));

blocks.push(
  head('Skills'),
  html(`<dl class="r-skills">${model.skills.map((g) => `<div><dt>${esc(g.label)}</dt><dd>${esc(g.items.join(', '))}</dd></div>`).join('')}</dl>`)
);

blocks.push(head('Experience'));
for (const e of model.experience) {
  blocks.push(
    html(`<article class="r-entry">
      <div class="r-line"><h3 class="r-title">${esc(e.org)}</h3><span class="r-when">${esc(e.when)}</span></div>
      <p class="r-meta">${esc(e.role)}</p>
      ${points(e.points)}
      ${e.projects.length ? `<p class="r-meta r-made">Projects: ${esc(e.projects.join(', '))}</p>` : ''}
    </article>`)
  );
}

blocks.push(head('Projects'));
for (const p of model.projects) {
  const meta = p.meta.map(esc).join(' · ');
  blocks.push(
    html(`<article class="r-entry r-project" data-id="${esc(p.id)}">
      <div class="r-line"><h3 class="r-title"><a href="${esc(p.href)}">${esc(p.title)}</a></h3><span class="r-when">${esc(p.when)}</span></div>
      <p class="r-meta">${meta}${p.stack.length ? `<span class="r-stack">${meta ? ' · ' : ''}${esc(p.stack.join(', '))}</span>` : ''}</p>
      ${points(p.bullets)}
    </article>`)
  );
}

if (model.education) {
  const e = model.education;
  blocks.push(
    head('Education'),
    html(`<article class="r-entry">
      <div class="r-line"><h3 class="r-title">${esc(e.degree)}</h3><span class="r-when">${esc(e.when)}</span></div>
      <p class="r-meta">${esc(e.school)}${e.cgpa ? ` · CGPA ${esc(e.cgpa)}` : ''}</p>
      ${e.coursework ? `<p class="r-meta">${esc(e.coursework)}</p>` : ''}
    </article>`)
  );
}

if (model.certifications.length) {
  blocks.push(
    head('Certifications'),
    html(`<ul class="r-points r-certs">${model.certifications.map((c) => `<li>${esc(c.name)}, ${esc(c.issuer)}, ${esc(c.year)}</li>`).join('')}</ul>`)
  );
}

blocks.push(head('Languages'), html(`<p class="r-langs">${esc(model.languages.join(', '))}</p>`));

/* ────────────────────────── sheets ────────────────────────── */

const root = document.getElementById('resume');
const sheets = Array.from({ length: SHEETS }, (_, i) => {
  const sheet = html(`<section class="sheet" aria-label="Page ${i + 1} of ${SHEETS}">
    <div class="sheet-body"></div>
    <footer class="sheet-foot"><span>${esc(model.name)} · Résumé · Updated ${esc(updated)}</span><span>Page ${i + 1} of ${SHEETS}</span></footer>
  </section>`);
  root.append(sheet);
  return sheet.querySelector('.sheet-body');
});

const over = (body) => body.scrollHeight - body.clientHeight;

/** Fill the sheets in order; returns how far each one overflows, in px (0 or less fits). */
function paginate() {
  sheets.forEach((b) => b.replaceChildren());
  let k = 0;
  for (const block of blocks) {
    if (block.hidden) continue;
    sheets[k].append(block);
    if (over(sheets[k]) > 0.5 && k < SHEETS - 1) {
      block.remove();
      // A heading goes over with its first entry.
      const last = sheets[k].lastElementChild;
      k++;
      if (last?.classList.contains('r-head')) sheets[k].append(last);
      sheets[k].append(block);
    }
  }
  return sheets.map(over);
}

function layout() {
  let result = null;
  for (let fit = 100; fit >= FIT_FLOOR; fit--) {
    root.style.setProperty('--fit', String(fit / 100));
    const o = paginate();
    result = { fit: fit / 100, overflow: o.map((x) => Math.max(0, Math.round(x))) };
    if (o.every((x) => x <= 0.5)) break;
  }
  tidyBreaks();
  return result;
}

/**
 * Where the contact line wraps, the dot at the break goes: a dot left at the
 * end of a line is hidden (in place, so nothing moves), and one carried to the
 * start of a line is taken out. Neither is then printed, nor read by a parser.
 */
function tidyBreaks() {
  const seps = [...document.querySelectorAll('.r-contact > .r-sep')];
  for (const s of seps) s.style.display = s.style.visibility = '';
  for (const s of seps) {
    const prev = s.previousElementSibling;
    const next = s.nextElementSibling;
    if (prev && s.offsetTop > prev.offsetTop + 1) s.style.display = 'none';
    else if (next && next.offsetTop > s.offsetTop + 1) s.style.visibility = 'hidden';
  }
}

/* ────────────────────────── on screen ────────────────────────── */

// Narrow screens see the sheets scaled down whole, never reflowed: the page is
// a preview of the print.
const SHEET_PX = (210 * 96) / 25.4;
const fitView = () => root.style.setProperty('--zoom', String(Math.min(1, (window.innerWidth - 24) / SHEET_PX)));
addEventListener('resize', fitView);

// Which projects go in: a picker beside the sheets (never printed).
if (editing) {
  const picker = html(`<fieldset class="r-picker">
    <legend>Projects in this print</legend>
    ${model.projects.map((p) => `<label><input type="checkbox" value="${esc(p.id)}" checked> ${esc(p.title.split(':')[0])}</label>`).join('')}
  </fieldset>`);
  picker.addEventListener('change', (e) => {
    const block = blocks.find((b) => b.dataset.id === e.target.value);
    if (block) block.hidden = !e.target.checked;
    layout();
  });
  root.before(picker);
}

document.querySelector('[data-print]')?.addEventListener('click', () => window.print());
if (!__HAS_RESUME__) document.querySelectorAll('[data-resume]').forEach((el) => (el.hidden = true));

/* ────────────────────────── go ────────────────────────── */

const ready = (async () => {
  await document.fonts.ready;
  await Promise.all([document.fonts.load('400 10pt "Geist Variable"'), document.fonts.load('600 10pt "Geist Variable"'), document.fonts.load('400 10pt "Geist Mono Variable"')]);
  // Layout is measured at full size; the view is scaled after.
  root.style.setProperty('--zoom', '1');
  const r = layout();
  fitView();
  const pages = sheets.filter((b) => b.childElementCount > 0).length;
  return { ...r, pages, updated };
})();
window.__resume = { ready };
