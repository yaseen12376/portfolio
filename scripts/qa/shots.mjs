/**
 * Full-resolution screenshots of the dioramas on the real page, for review:
 *
 *   node scripts/qa/shots.mjs [--cal] [--width 1440] [--height 900] [--project retail-analytics]
 *
 * Writes build/qa/shots/: the project's card as the tour shows it, then its
 * case study with every chapter selected in turn (diorama and explorer).
 */
import { resolve } from 'node:path';

import { args, ensureOut, gpuName, launch, watchConsole } from './lib.mjs';

const opts = args();
const W = Number(opts.width ?? 1440);
const H = Number(opts.height ?? 900);
const id = opts.project ?? 'retail-analytics';
const out = await ensureOut('shots', `${id}-${W}`);
const { browser, context } = await launch();
const page = await context.newPage();
await page.setViewportSize({ width: W, height: H });
const errors = watchConsole(page);
await page.goto(`${opts.url}/${opts.cal ? '?3d=cal' : '?3d=force'}`);
await page.waitForFunction(() => window.__portfolio?.lenis && !window.__portfolio.lenis.isStopped, null, { timeout: 30000 });
console.log(`GPU: ${await gpuName(page)}`);

const card = `#main-content .media[data-id="${id}"]`;
await page.evaluate((s) => window.__portfolio.lenis.scrollTo(document.querySelector(s), { immediate: true, force: true, offset: -140 }), card);
await page.waitForFunction((s) => document.querySelector(s)?.dataset['3d'] === 'live', card, { timeout: 30000 });
await page.waitForTimeout(2500);
await page.locator(card).screenshot({ path: resolve(out, '01-card.png') });
console.log('card');

// Open the case study from the card's backdrop.
const box = await page.locator(card).boundingBox();
await page.mouse.click(box.x + 16, box.y + box.height - 16);
const hero = '#project-detail .pd-hero-media .media';
await page.waitForFunction((s) => document.querySelector(s)?.dataset['3d'] === 'live', hero, { timeout: 30000 });
await page.waitForSelector('#project-detail .pd-explorer.is-live', { timeout: 10000 }).catch(() => {});
// Tall enough to hold the diorama and its explorer in one frame.
await page.setViewportSize({ width: W, height: Math.max(H, 1500) });
await page.evaluate(() => window.__portfolio.lenis.scrollTo(document.querySelector('#project-detail .pd-hero-media'), { immediate: true, force: true, offset: -24 }));
await page.waitForTimeout(1500);

const tabs = await page.$$eval('#project-detail .pd-chapter', (ts) => ts.map((t) => t.dataset.chapter));
if (!tabs.length) await page.locator('#project-detail .pd-hero-media').screenshot({ path: resolve(out, '02-case.png') });
for (const [i, ch] of tabs.entries()) {
  await page.click(`#project-detail .pd-chapter[data-chapter="${ch}"]`);
  await page.waitForTimeout(2600); // the camera move, and some life
  const a = await page.locator('#project-detail .pd-hero-media').boundingBox();
  const b = await page.locator('#project-detail .pd-explorer').boundingBox();
  await page.screenshot({
    path: resolve(out, `${String(i + 2).padStart(2, '0')}-case-${ch}.png`),
    clip: { x: a.x, y: a.y, width: a.width, height: b.y + b.height - a.y },
  });
  console.log('chapter', ch);
}
if (errors.length) console.log(errors.join('\n'));
console.log(`shots: ${out}`);
await browser.close();
