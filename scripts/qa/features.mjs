/**
 * Every feature chapter proves itself: for each scene with chapters, the
 * bench switches to each chapter and runs its qa(), which operates the
 * feature through the simulation and checks what the product would do.
 *
 *   node scripts/qa/features.mjs [ids...] [--url http://localhost:3000]
 */
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { ROOT, args, bench, launch, watchConsole } from './lib.mjs';

const opts = args();
const PUBLIC = resolve(ROOT, 'public', '3d');
const ids = opts._.length ? opts._ : readdirSync(PUBLIC).filter((d) => !d.startsWith('_') && existsSync(resolve(PUBLIC, d, 'scene.json')));
const { browser, context } = await launch();
const page = await context.newPage();
const errors = watchConsole(page);
let failed = 0;
let total = 0;
for (const id of ids) {
  await bench(page, opts.url, id, { w: 640, h: 360, still: true });
  const res = await page.evaluate(() => window.qa.chapterQA());
  console.log(`\n${id}`);
  for (const [chapter, checks] of Object.entries(res)) {
    for (const c of checks) {
      total++;
      if (!c.ok) failed++;
      console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${chapter.padEnd(10)} ${c.name}${c.detail ? ` · ${c.detail}` : ''}`);
    }
  }
}
if (errors.length) console.log('\nconsole:\n  ' + errors.join('\n  '));
console.log(`\n${total - failed}/${total} passed`);
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
