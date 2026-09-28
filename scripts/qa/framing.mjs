/**
 * Framing on the real page: is the collectible composed, and clear of the UI?
 *
 *   node scripts/qa/framing.mjs [--url http://localhost:3000]
 *
 * For every project with a diorama: as a card (1024, 1440 and 1920 wide), in
 * its case study and in full screen (at 1440), and on a phone after the tap,
 * it projects the silhouette hull (the same points the fit uses) into the
 * media box and checks:
 *   - the binding dimension is filled 70 to 96% (the rest is breathing room)
 *   - every edge keeps a margin of at least 3%
 *   - on a card, the caption chip never overlaps the silhouette's box
 * and writes build/qa/framing-<name>.png with the box drawn on.
 */
import { join } from 'node:path';

import { OUT, SOFTWARE_GL, args, launch, watchConsole } from './lib.mjs';

const opts = args();
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`);
};

const measure = (page, sel) =>
  page.$eval(sel, async (media) => {
    const { Vector3 } = await import('/node_modules/.vite/deps/three.js');
    const slot = [...window.__three.slots].find((s) => s.media === media);
    if (!slot) return null;
    // The composition under test is the home view (chapters fly to their
    // districts from there): stop the tour, send the camera home, let it land.
    slot.chapters?.pauseTour(true);
    slot.rig.setShot(null);
    for (let i = 0; i < 240; i++) slot.rig.update(1 / 60);
    const cam = slot.camera;
    cam.updateMatrixWorld();
    let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
    for (const p of slot.stage.data.view.hull) {
      const v = new Vector3(...p).project(cam);
      x0 = Math.min(x0, (v.x + 1) / 2);
      x1 = Math.max(x1, (v.x + 1) / 2);
      y0 = Math.min(y0, (1 - v.y) / 2);
      y1 = Math.max(y1, (1 - v.y) / 2);
    }
    const r = media.getBoundingClientRect();
    const chip = media.querySelector('.media-3d-caption');
    const c = chip && !chip.hidden && getComputedStyle(chip).opacity !== '0' ? chip.getBoundingClientRect() : null;
    const box = { l: r.left + x0 * r.width, r: r.left + x1 * r.width, t: r.top + y0 * r.height, b: r.top + y1 * r.height };
    const overlap = c ? c.left < box.r && c.right > box.l && c.top < box.b && c.bottom > box.t : false;
    return { x0, x1, y0, y1, w: r.width, h: r.height, overlap, chip: !!c, box };
  });

async function judge(page, name, sel) {
  const m = await measure(page, sel);
  if (!m) return check(`${name}: diorama measured`, false, 'no live slot');
  const fw = m.x1 - m.x0;
  const fh = m.y1 - m.y0;
  const aspectBox = (fw * m.w) / (fh * m.h);
  const fill = aspectBox > m.w / m.h ? fw : fh; // the dimension that binds
  const margin = Math.min(m.x0, 1 - m.x1, m.y0, 1 - m.y1);
  check(`${name}: filled 70 to 96%`, fill >= 0.7 && fill <= 0.96, `${(fill * 100).toFixed(0)}% (${fw > fh ? 'w' : 'h'} ${(fw * 100).toFixed(0)} x ${(fh * 100).toFixed(0)})`);
  check(`${name}: margins at least 3%`, margin >= 0.03, `${(margin * 100).toFixed(1)}%`);
  if (m.chip) check(`${name}: caption chip clear of the diorama`, !m.overlap);
  await page.evaluate((b) => {
    const d = document.createElement('div');
    d.id = '__frame';
    Object.assign(d.style, { position: 'fixed', left: `${b.l}px`, top: `${b.t}px`, width: `${b.r - b.l}px`, height: `${b.b - b.t}px`, outline: '1px solid #ff3b6b', zIndex: 99999, pointerEvents: 'none' });
    document.body.appendChild(d);
  }, m.box);
  await page.locator(sel).screenshot({ path: join(OUT, `framing-${name.replace(/\W+/g, '-')}.png`) });
  await page.evaluate(() => document.getElementById('__frame')?.remove());
}

const { browser } = await launch();
const cardOf = (id) => `#main-content .media[data-id="${id}"]`;
const hero = '#project-detail .pd-hero-media .media';
let ids = null;

for (const w of [1024, 1440, 1920]) {
  const context = await browser.newContext({ viewport: { width: w, height: Math.round(w * 0.6) } });
  const page = await context.newPage();
  const errors = watchConsole(page);
  await page.goto(`${opts.url}/?3d=force`);
  await page.waitForFunction(() => window.__portfolio?.lenis, null, { timeout: 15000 });
  ids ??= await page.$$eval('#main-content .media[data-scene]', (ms) => ms.map((m) => m.dataset.id));
  for (const id of ids) {
    const sel = cardOf(id);
    await page.evaluate((q) => window.__portfolio.lenis.scrollTo(document.querySelector(q), { immediate: true, force: true, offset: -120 }), sel);
    const live = await page.waitForFunction((q) => document.querySelector(q)?.dataset['3d'] === 'live', sel, { timeout: 30000 }).then(() => true).catch(() => false);
    check(`card ${id} ${w}: goes live`, live);
    if (!live) continue;
    await page.waitForTimeout(1800);
    await judge(page, `card ${id} ${w}`, sel);
  }

  if (w === 1440) {
    // Each one's case study, then full screen.
    for (const id of ids) {
      await page.evaluate((pid) => (location.hash = `#/project/${pid}`), id);
      const live = await page.waitForFunction((s) => document.querySelector(s)?.dataset['3d'] === 'live', hero, { timeout: 30000 }).then(() => true).catch(() => false);
      check(`case ${id} 1440: goes live`, live);
      if (live) {
        await page.waitForTimeout(1500);
        await page.$eval(hero, (m) => m.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(400);
        await judge(page, `case ${id} 1440`, hero);
        await page.click('#project-detail [data-tool="full"]').catch(() => {});
        await page.waitForTimeout(1500);
        if (await page.evaluate(() => !!document.fullscreenElement)) {
          await judge(page, `full screen ${id}`, hero);
          await page.evaluate(() => document.exitFullscreen?.());
          await page.waitForTimeout(600);
        } else console.log(`     full screen not available headless (${id})`);
      }
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.body.classList.contains('detail-open'), null, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(600);
    }
  }
  check(`page ${w}: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

// A phone: each diorama after its tap. (Off Windows, ?swgl lets the software
// renderer through the performance caveat; the gate still asks for the tap.)
for (const id of ids ?? []) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const sel = cardOf(id);
  await page.goto(`${opts.url}/${SOFTWARE_GL ? '?swgl' : ''}`);
  await page.waitForFunction(() => window.__portfolio, null, { timeout: 15000 });
  await page.$eval(sel, (m) => m.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(1200);
  await page.tap(`${sel} .media-3d-play`);
  const live = await page.waitForFunction((s) => ['live', 'paused'].includes(document.querySelector(s)?.dataset['3d']), sel, { timeout: 30000 }).then(() => true).catch(() => false);
  check(`phone 390 ${id}: goes live after the tap`, live);
  if (live) {
    await page.waitForTimeout(1500);
    await judge(page, `phone 390 ${id}`, sel);
  }
  await context.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
