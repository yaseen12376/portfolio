/**
 * Short screen recordings of a diorama on the real page, for review:
 *
 *   node scripts/qa/record.mjs [--url http://localhost:3000] [--project retail-analytics]
 *
 * Writes build/qa/rec/: 1-card-tour.webm (the flagship card's tour, as a
 * visitor scrolling past sees it), 2-case-explorer.webm (the case study, each
 * chapter chosen and its feature operated), 3-phone.webm (390 px: the tap,
 * then the tour). Recorded on the discrete GPU.
 */
import { readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { args, ensureOut, launch } from './lib.mjs';

const opts = args();
const id = opts.project ?? 'retail-analytics';
const out = await ensureOut('rec');
const { browser } = await launch({ discrete: true });

async function record(name, contextOpts, run) {
  const tmp = await ensureOut('rec', '_tmp');
  const context = await browser.newContext({ ...contextOpts, recordVideo: { dir: tmp, size: contextOpts.viewport } });
  const page = await context.newPage();
  await run(page);
  await context.close(); // finishes the file
  const [file] = await readdir(tmp);
  await rename(join(tmp, file), join(out, `${name}.webm`));
  await rm(tmp, { recursive: true, force: true });
  console.log(`${name}.webm`);
}

const pause = (page, ms) => page.waitForTimeout(ms);
const card = `#main-content .media[data-id="${id}"]`;
const hero = '#project-detail .pd-hero-media .media';

// 1. The card's tour.
await record('1-card-tour', { viewport: { width: 1440, height: 900 } }, async (page) => {
  await page.goto(`${opts.url}/?3d=force`);
  await page.waitForFunction(() => window.__portfolio?.lenis, null, { timeout: 15000 });
  await page.evaluate((s) => window.__portfolio.lenis.scrollTo(document.querySelector(s), { force: true, offset: -120, duration: 1.6 }), card);
  await page.waitForFunction((s) => document.querySelector(s)?.dataset['3d'] === 'live', card, { timeout: 30000 });
  await pause(page, 23000); // three chapters of 7.5 s
});

// 2. The case study: every chapter, each feature operated.
await record('2-case-explorer', { viewport: { width: 1440, height: 1000 } }, async (page) => {
  await page.goto(`${opts.url}/?3d=force`);
  await page.waitForFunction(() => window.__portfolio?.lenis, null, { timeout: 15000 });
  await page.evaluate((s) => window.__portfolio.lenis.scrollTo(document.querySelector(s), { immediate: true, force: true, offset: -120 }), card);
  await page.waitForFunction((s) => document.querySelector(s)?.dataset['3d'] === 'live', card, { timeout: 30000 });
  await pause(page, 1500);
  await page.locator(card).click({ position: { x: 16, y: 16 } });
  await page.waitForFunction((s) => document.querySelector(s)?.dataset['3d'] === 'live', hero, { timeout: 30000 });
  await pause(page, 1200);
  await page.evaluate((s) => window.__portfolio.lenis.scrollTo(document.querySelector(s), { force: true, offset: -24, duration: 1.2 }), '#project-detail .pd-hero-media');
  await pause(page, 1500);
  const chapter = async (c, ms = 3500) => {
    await page.click(`#project-detail .pd-chapter[data-chapter="${c}"]`);
    await pause(page, ms);
  };
  const act = async (a, ms = 3000) => {
    await page.click(`#project-detail .pd-act[data-act="${a}"]`).catch(() => {});
    await pause(page, ms);
  };
  await chapter('cameras', 3000);
  await act('checkout', 2500);
  await act('floor', 2500);
  await chapter('track', 5000);
  await chapter('line', 3000);
  // Drag one end of the counting line a little into the store.
  const box = await page.locator(hero).boundingBox();
  const end = await page.evaluate((s) => {
    const slot = [...window.__three.slots].find((x) => x.opts.context === 'case');
    const h = slot.controller.pickables().find((o) => o.userData.handle?.kind === 'line');
    const v = h.position.clone().project(slot.camera);
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }, hero);
  if (end && box) {
    await page.mouse.move(end.x, end.y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(end.x - i * 4, end.y + i * 2);
    await page.mouse.up();
  }
  await pause(page, 3500);
  await chapter('zones', 5000);
  await chapter('heat', 3000);
  await act('swap', 5000);
  await chapter('parties', 4500);
  await chapter('pos', 2000);
  await act('q2', 9000);
  await chapter('staff', 2500);
  await act('consent', 3500);
  await chapter('security', 2000);
  await act('hours', 9000);
  await act('hours', 2500);
  await chapter('dashboard', 4000);
  await act('trt', 3000);
});

// 3. A phone: the tap, then the tour.
await record('3-phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, async (page) => {
  await page.goto(opts.url);
  await page.waitForFunction(() => window.__portfolio, null, { timeout: 15000 });
  await page.$eval('.flagship .media', (m) => m.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  await pause(page, 2500);
  await page.tap('.flagship .media-3d-play');
  await pause(page, 16000);
});

await browser.close();
console.log(`recordings: ${out}`);
