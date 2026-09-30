/**
 * Every chapter's own check (controller.chapters[].qa), for one scene over
 * several seeds: a feature that only works on a lucky run shows up here.
 *
 *   node scripts/qa/features-seeds.mjs [seeds, default 1,2,3] [scene id, default constructsafe]
 *
 * Needs the dev server (npm run dev) on :3000.
 */
import { bench, launch, watchConsole } from './lib.mjs';

const { browser, context } = await launch();
const page = await context.newPage();
const errors = watchConsole(page);
const id = process.argv[3] ?? 'constructsafe';
let failed = 0;
for (const seed of (process.argv[2] ?? '1,2,3').split(',').map(Number)) {
  await bench(page, 'http://localhost:3000', id, { w: 640, h: 360, still: true, seed });
  const res = await page.evaluate(() => window.qa.chapterQA());
  const fails = Object.entries(res).flatMap(([ch, cs]) => cs.filter((c) => !c.ok).map((c) => `${ch}: ${c.name} · ${c.detail}`));
  const total = Object.values(res).flat().length;
  failed += fails.length;
  console.log(`seed ${seed}: ${total - fails.length}/${total}${fails.length ? `\n  ${fails.join('\n  ')}` : ''}`);
}
console.log(errors.length ? `console:\n  ${errors.join('\n  ')}` : 'no console errors');
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
