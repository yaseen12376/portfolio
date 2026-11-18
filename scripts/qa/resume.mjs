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
 *  6. the phone number from resume.local.json is printed, as a tel: link
 *     (or none at all, when it was printed with --no-phone)
 *  7. and the PDF is the only place it is: no committed file, and nothing
 *     else in dist/, carries it in any spacing
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
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
  for (const a of await page.getAnnotations()) if (a.subtype === 'Link' && (a.url || a.unsafeUrl)) links.push(a.url || a.unsafeUrl);
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
const odd = links.filter((u) => !/^(https:\/\/|mailto:|tel:)/.test(u));
check(`every contact and case study is a working link (${want.length})`, missing.length === 0 && odd.length === 0, [...missing.map((u) => `missing ${u}`), ...odd.map((u) => `odd ${u}`)].slice(0, 4).join(', '));

// ---------------------------------------------------------------- 6. the phone number
const digits = flat.replace(/\D/g, '');
const local = join(ROOT, 'resume.local.json');
const own = existsSync(local) ? String(JSON.parse(await readFile(local, 'utf8')).phone ?? '').replace(/\D/g, '') : '';
// (Its last ten digits, so a missing country code doesn't hide it.)
const ten = own.length >= 10 ? own.slice(-10) : null;
const tel = links.find((u) => u.startsWith('tel:'));
if (meta.phone) {
  if (ten) {
    const printed = digits.includes(ten);
    const linked = !!tel && tel.replace(/\D/g, '').endsWith(ten);
    check('the phone number from resume.local.json is printed, as a tel: link', printed && linked, printed ? (linked ? '' : 'no tel: link to it') : 'not in the text');
  } else {
    check('a phone number is printed, as a tel: link', !!tel, tel ? 'no resume.local.json here, so not compared with it' : 'no tel: link');
  }
} else {
  const phoneLike = /(\+\d{1,3}[\s.]?)?\(?\d{3,5}\)?[\s.]?\d{3,5}[\s.]?\d{3,5}\b/.exec(flat.replace(/\d{1,3}(,\d{3})+/g, ''));
  const ownPrinted = !!ten && digits.includes(ten);
  check('no phone number (printed with --no-phone)', !tel && !ownPrinted && !(phoneLike && phoneLike[0].replace(/\D/g, '').length >= 10 && /\+|\s/.test(phoneLike[0])), ownPrinted ? 'the number in resume.local.json is printed' : tel ?? phoneLike?.[0] ?? '');
}

// ---------------------------------------------------------------- 7. only in the PDF
// The number in any spacing: 0000000000, 00000 00000, 00000-00000...
if (ten) {
  const anySpacing = new RegExp(ten.split('').join('[\\s.\\-]?'));
  const TEXT = /\.(m?js|cjs|ts|json|html?|css|svg|xml|txt|md|py|ya?ml|webmanifest)$/i;
  const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0').filter(Boolean).map((f) => join(ROOT, f));
  const dist = join(ROOT, 'dist');
  const built = existsSync(dist) ? readdirSync(dist, { recursive: true }).map((f) => join(dist, String(f))) : [];
  const hits = [];
  for (const f of [...listed, ...built]) {
    if (!TEXT.test(f)) continue;
    const s = await readFile(f, 'utf8').catch(() => '');
    if (anySpacing.test(s)) hits.push(relative(ROOT, f).replace(/\\/g, '/'));
  }
  check('the PDF is the only place the number is', hits.length === 0,
    hits.length ? hits.slice(0, 4).join(', ') : `${listed.length} repo files${built.length ? `, ${built.length} in dist/` : ', no dist/ yet (npm run build)'}`);
} else {
  console.log('skip the PDF is the only place the number is · no resume.local.json to look for');
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
