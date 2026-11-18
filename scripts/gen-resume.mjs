/**
 * Print the résumé to PDF, from the site's own data:
 *
 *   npm run gen:resume                  public/resume.pdf and public/resume.meta.json,
 *                                       with the phone number from resume.local.json
 *                                       (git-ignored; see resume.local.example.json)
 *   npm run gen:resume -- --no-phone    the same, without a phone number
 *
 * Starts Vite, opens /resume/ in Chromium and lets the page lay itself out on
 * two A4 sheets (it shrinks the type a step at a time, to 92% at most, if it
 * has to), then prints it. Fails, naming the sheet, if it still doesn't fit.
 *
 * The PDF is committed: Vercel's build has no browser to print it. Its meta
 * file records what it was printed from, and the build refuses a PDF that no
 * longer matches (vite.config.js).
 *
 * The phone number is handed to the page while it prints and nowhere else, so
 * the PDF carries it and no page, script or committed source does (the résumé
 * QA checks). It is left out of the input hash, because a hash of a phone
 * number is easily reversed: after changing the number, run this again.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { chromium } from 'playwright';

import { resumeHash } from './lib/resume.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const out = join(ROOT, 'public', 'resume.pdf');

let phone = null;
if (!process.argv.includes('--no-phone')) {
  const local = join(ROOT, 'resume.local.json');
  if (!existsSync(local)) {
    console.error('No resume.local.json: copy resume.local.example.json to it and fill in the phone number (or print without one: npm run gen:resume -- --no-phone).');
    process.exit(1);
  }
  phone = String(JSON.parse(await readFile(local, 'utf8')).phone ?? '').trim() || null;
  if (!phone) {
    console.error('resume.local.json has no "phone".');
    process.exit(1);
  }
}

// The guard in vite.config.js is for builds; this server is about to print a new PDF.
process.env.RESUME_GEN = '1';
const { createServer } = await import('vite');
const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 5190, strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0];

const browser = await chromium.launch();
let failed = false;
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  // The phone number is handed to the page directly, never in its address.
  if (phone) await page.addInitScript((p) => (window.__RESUME_PRINT__ = p), { phone });
  await page.goto(new URL('resume/', base).href, { waitUntil: 'load' });
  const r = await page.evaluate(() => window.__resume.ready);
  if (errors.length) throw new Error(`the page reported errors: ${errors.slice(0, 3).join(' | ')}`);
  const over = r.overflow.map((px, i) => (px > 0 ? `sheet ${i + 1} overflows by ${px} px` : null)).filter(Boolean);
  if (over.length) throw new Error(`the résumé does not fit on two pages even at ${Math.round(r.fit * 100)}% type: ${over.join(', ')}. Shorten something in src/data/resume.js.`);

  await mkdir(join(out, '..'), { recursive: true });
  await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true, tagged: true, outline: true });
  const kb = (await stat(out)).size / 1024;
  console.log(`${relative(ROOT, out)}: ${r.pages} pages, type at ${Math.round(r.fit * 100)}%, ${kb.toFixed(0)} KB, updated ${r.updated}`);

  const { resumeModel } = await server.ssrLoadModule('/src/resume/content.js');
  // (en-CA formats a local date as YYYY-MM-DD; toISOString would give UTC's.)
  // `phone` says only whether one was printed, so the QA knows what to expect.
  const meta = { inputs: resumeHash(ROOT, resumeModel()), generated: new Date().toLocaleDateString('en-CA'), pages: r.pages, fit: r.fit, phone: !!phone };
  await writeFile(join(ROOT, 'public', 'resume.meta.json'), JSON.stringify(meta, null, 2) + '\n');
  console.log(`public/resume.meta.json written${phone ? '' : ' (no phone number)'}. Restart a running dev server so the site links to the PDF.`);
} catch (e) {
  failed = true;
  console.error(`gen:resume failed: ${e.message}`);
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
