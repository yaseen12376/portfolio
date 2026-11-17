/**
 * The résumé PDF, read back the way an applicant tracking system reads it:
 *
 *   node scripts/qa/resume.mjs [--pdf public/resume.pdf]
 *
 *  1. it exists, is exactly two A4 pages, and is a sensible size
 *  2. it was printed from the site's current data (public/resume.meta.json)
 *  3. it is real text, in reading order: the name, then the sections in
 *     order, and all thirteen project titles in the order the site shows them
 *  4. no blank ('TODO_') and no em or en dash anywhere in it
 *  5. its links work as links: the email, LinkedIn, GitHub, the site, and each
 *     project's case study
 *  6. the public copy carries no phone number
 */
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { resumeModel } from '../../src/resume/content.js';
import { resumeHash } from '../lib/resume.mjs';
import { ROOT, args } from './lib.mjs';

const opts = args();
const pdfPath = resolve(ROOT, opts.pdf ?? join('public', 'resume.pdf'));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`);
};

if (!existsSync(pdfPath)) {
  check('the PDF exists', false, `${pdfPath} (npm run gen:resume)`);
  process.exit(1);
}
const kb = (await stat(pdfPath)).size / 1024;
const doc = await getDocument({ data: new Uint8Array(await readFile(pdfPath)), isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;

// ---------------------------------------------------------------- 1. pages
const sizes = [];
let text = '';
const links = [];
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const [, , w, h] = page.view; // points
  sizes.push(`${(w / 72 * 25.4).toFixed(0)} x ${(h / 72 * 25.4).toFixed(0)} mm`);
  const tc = await page.getTextContent();
  text += `${tc.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join('')}\n`;
  for (const a of await page.getAnnotations()) if (a.subtype === 'Link' && a.url) links.push(a.url);
}
check('exactly two pages', doc.numPages === 2, `${doc.numPages} pages`);
check('every page is A4', sizes.every((s) => s === '210 x 297 mm'), [...new Set(sizes)].join(', '));
check('a sensible size', kb < 400, `${kb.toFixed(0)} KB`);

// ---------------------------------------------------------------- 2. current
const meta = JSON.parse(await readFile(join(ROOT, 'public', 'resume.meta.json'), 'utf8').catch(() => '{}'));
const model = resumeModel();
check('printed from the current data', meta.inputs === resumeHash(ROOT, model), meta.inputs ? `printed ${meta.generated}` : 'no public/resume.meta.json');

// ---------------------------------------------------------------- 3. reading order
const flat = text.replace(/\s+/g, ' ');
const lower = flat.toLowerCase();
/** Each needle found after the one before it; returns the first that isn't. */
function inOrder(needles) {
  let at = -1;
  for (const n of needles) {
    const i = lower.indexOf(n.toLowerCase(), at + 1);
    if (i < 0) return n;
    at = i;
  }
  return null;
}
const sections = ['Summary', 'Skills', 'Experience', 'Projects', 'Education', ...(model.certifications.length ? ['Certifications'] : []), 'Languages'];
const lostSection = inOrder([model.name, ...sections]);
check('the name, then every section, in order', !lostSection, lostSection ? `lost at "${lostSection}"` : sections.join(', '));
const titles = model.projects.map((p) => p.title);
const lostTitle = inOrder([`${'Projects'}`, ...titles]);
check(`all ${titles.length} project titles, in the site's order`, !lostTitle, lostTitle ? `lost at "${lostTitle}"` : '');
const words = flat.split(' ').filter(Boolean).length;
check('real text throughout', words > 700, `${words} words`);

// ---------------------------------------------------------------- 4. blanks, dashes
check('no blank (TODO_) printed', !flat.includes('TODO_'));
const dash = flat.match(/.{0,30}[–—].{0,30}/);
check('no em or en dash', !dash, dash ? dash[0] : '');

// ---------------------------------------------------------------- 5. links
const want = [...model.contact.filter((c) => c.href).map((c) => c.href), ...model.projects.map((p) => p.href)];
const missing = want.filter((u) => !links.includes(u));
const odd = links.filter((u) => !/^(https:\/\/|mailto:)/.test(u));
check(`every contact and case study is a working link (${want.length})`, missing.length === 0 && odd.length === 0, [...missing.map((u) => `missing ${u}`), ...odd.map((u) => `odd ${u}`)].slice(0, 4).join(', '));

// ---------------------------------------------------------------- 6. no phone
const digits = flat.replace(/\D/g, '');
let ownPhone = false;
const local = join(ROOT, 'resume.local.json');
if (existsSync(local)) {
  const phone = String(JSON.parse(await readFile(local, 'utf8')).phone ?? '').replace(/\D/g, '');
  // (Its last ten digits, so a missing country code doesn't hide it.)
  ownPhone = phone.length >= 10 && digits.includes(phone.slice(-10));
}
const phoneLike = /(\+\d{1,3}[\s.]?)?\(?\d{3,5}\)?[\s.]?\d{3,5}[\s.]?\d{3,5}\b/.exec(flat.replace(/\d{1,3}(,\d{3})+/g, ''));
check('no phone number in the public copy', !ownPhone && !(phoneLike && phoneLike[0].replace(/\D/g, '').length >= 10 && /\+|\s/.test(phoneLike[0])), ownPhone ? 'the number in resume.local.json is printed' : phoneLike?.[0] ?? '');

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
