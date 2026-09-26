/**
 * The dioramas on the real page, end to end, on the real GPU:
 *
 *   node scripts/qa/site.mjs [--url http://localhost:3000] [--cycles 5] [--cal]
 *
 *  1. every card with a diorama reaches data-3d="live" as it scrolls in, and
 *     its canvas is not blank
 *  2. an orbit drag on the flagship turns the camera and springs back home
 *  3. a click on the flagship's backdrop opens the case study at the chapter
 *     the card was showing; its diorama goes live and drives the feature
 *     explorer: every chapter moves the scene and shows live readouts, the
 *     arrow keys walk the tablist, Reset brings the camera home, controls are
 *     44 px and named, and nothing is laid over the diorama itself
 *  4. Escape closes it and the case slot is released
 *  5. open/close N times: GPU geometries, textures and programs, engine slots
 *     and ScrollTriggers return to where they started
 * with zero console errors throughout. --cal shows the calibration scene in
 * every slot (before the real scenes exist).
 */
import { args, gpuName, launch, watchConsole } from './lib.mjs';

const opts = args();
const CYCLES = Number(opts.cycles ?? 5);
const q = opts.cal ? '?3d=cal' : '?3d=force';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`);
};

const { browser, context } = await launch();
const page = await context.newPage();
await page.setViewportSize({ width: 1440, height: 900 });
const errors = watchConsole(page);
await page.goto(`${opts.url}/${q}`);
await page.waitForLoadState('load');
console.log(`GPU: ${await gpuName(page)}`);
await page.waitForFunction(() => window.__portfolio?.lenis, null, { timeout: 15000 });
await page.waitForTimeout(1200); // preloader curtain

const scrollTo = (sel) =>
  page.evaluate(async (s) => {
    const el = document.querySelector(s);
    // force: Lenis is stopped while a case study is open or closing.
    window.__portfolio.lenis.scrollTo(el, { immediate: true, offset: -120, force: true });
    await new Promise((r) => setTimeout(r, 400));
  }, sel);

/** Mean luminance variance over a 16 x 16 grid of the element's canvas: 0 means blank. */
const variance = (sel) =>
  page.evaluate((s) => {
    const c = document.querySelector(s)?.querySelector('canvas.media-3d');
    if (!c || !c.width) return 0;
    const t = document.createElement('canvas');
    t.width = t.height = 16;
    const g = t.getContext('2d');
    g.drawImage(c, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data;
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += l;
      sq += l * l;
    }
    const n = d.length / 4;
    return sq / n - (sum / n) ** 2;
  }, sel);

// ---------------------------------------------------------------- 1. cards
const cards = await page.$$eval('#main-content .media[data-id]', (els) => els.map((e) => e.dataset.id));
const withScene = [];
for (const [i, id] of cards.entries()) {
  const sel = `#main-content .media[data-id="${id}"]`;
  await scrollTo(sel);
  const t0 = Date.now();
  // The first one also pays for loading the engine.
  const state = await page
    .waitForFunction((s) => ['live', 'paused', 'error'].includes(document.querySelector(s)?.dataset['3d']), sel, { timeout: i ? 12000 : 30000 })
    .then(() => page.$eval(sel, (e) => e.dataset['3d']))
    .catch(() => page.$eval(sel, (e) => e.dataset['3d'] ?? 'none'));
  if (state === 'none') {
    console.log(`     card ${id}: no diorama`);
    continue;
  }
  if (i === 0) console.log(`     first diorama live after ${((Date.now() - t0) / 1000).toFixed(1)} s (includes the engine)`);
  withScene.push(id);
  const v = await variance(sel);
  check(`card ${id} goes live`, state === 'live' || state === 'paused', `state ${state}, variance ${v.toFixed(0)}`);
  check(`card ${id} canvas has content`, v > 20);
}
check('at least one card has a diorama', withScene.length > 0, withScene.join(', '));

// ---------------------------------------------------------------- 2. orbit
const flag = '#work-flagship .media, .flagship .media';
await scrollTo(flag);
await page.waitForFunction((s) => document.querySelector(s)?.dataset['3d'] === 'live', flag, { timeout: 12000 }).catch(() => {});
const box = await page.$eval(flag, (e) => {
  const r = e.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
// Relative to the shot the camera is on (a chapter's district, or home).
const cam = () =>
  page.evaluate(() => {
    const s = [...window.__three.slots].find((x) => x.opts.context === 'card' && x.live && x.inView);
    return s ? { yaw: s.rig.yaw.x - (s.rig.shot?.yaw ?? 0), pitch: s.rig.pitch.x - (s.rig.shot?.pitch ?? 0) } : null;
  });
const bx = box.x + 24;
const by = box.y + 24;
await page.mouse.move(bx, by);
await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(bx + i * 30, by + i * 4);
await page.waitForTimeout(250);
const turned = await cam();
await page.mouse.up();
await page.mouse.move(box.x + box.w / 2, box.y + box.h + 200); // off the card: no parallax
await page.waitForTimeout(1500);
const home = await cam();
check('orbit drag turns the camera', !!turned && Math.abs(turned.yaw) > 0.15, turned ? `yaw ${turned.yaw.toFixed(2)}` : 'no slot');
check('orbit springs back within 1.5 s', !!home && Math.abs(home.yaw) < 0.02 && Math.abs(home.pitch) < 0.02, home ? `yaw ${home.yaw.toFixed(3)}` : '');

// ---------------------------------------------------------------- 3-5. case study, leaks
const baseline = await page.evaluate(() => ({
  ...window.__three.info(),
  triggers: window.__portfolio.ScrollTrigger.getAll().length,
}));

async function openAndClose(i) {
  await scrollTo(flag);
  const b = await page.$eval(flag, (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top };
  });
  const tourAt = await page.evaluate(() => [...window.__three.slots].find((x) => x.opts.context === 'card' && x.live && x.inView)?.chapters?.current?.id);
  await page.mouse.click(b.x + 20, b.y + 20);
  const sel = '#project-detail .pd-hero-media .media';
  const live = await page
    .waitForFunction((s) => document.querySelector(s)?.dataset['3d'] === 'live', sel, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  if (i === 0) {
    check('click on the flagship opens the case study', await page.evaluate(() => location.hash.startsWith('#/project/')));
    check('case study diorama goes live', live, await page.$eval(sel, (e) => e.dataset['3d'] ?? 'none').catch(() => 'no media'));
    await page.waitForSelector('#project-detail .pd-explorer.is-live', { timeout: 5000 }).catch(() => {});
    const caseCh = () => page.evaluate(() => [...window.__three.slots].find((x) => x.opts.context === 'case')?.chapters?.current?.id);
    const selected = () => page.$eval('#project-detail .pd-chapter[aria-selected="true"]', (t) => t.dataset.chapter).catch(() => null);
    check('the explorer is driven by the diorama', await page.$('#project-detail .pd-explorer.is-live').then(Boolean));
    check('it opens at the chapter the card was showing', !tourAt || ((await caseCh()) === tourAt && (await selected()) === tourAt), `card ${tourAt}, case ${await caseCh()}`);

    // Every chapter: the tab, the scene and the readouts agree.
    const tabs = await page.$$eval('#project-detail .pd-chapter', (ts) => ts.map((t) => t.dataset.chapter));
    const bad = [];
    for (const id of tabs) {
      await page.click(`#project-detail .pd-chapter[data-chapter="${id}"]`);
      await page.waitForTimeout(900);
      const reads = await page.$$eval('#project-detail .pd-readouts dd', (d) => d.length);
      if ((await caseCh()) !== id || (await selected()) !== id || reads === 0) bad.push(`${id} (scene ${await caseCh()}, ${reads} readouts)`);
    }
    check(`all ${tabs.length} chapters switch the scene and show readouts`, tabs.length > 0 && bad.length === 0, bad.join(', '));

    // The tablist walks with the arrow keys and keeps focus on the tab.
    await page.focus('#project-detail .pd-chapter[aria-selected="true"]');
    const from = await selected();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    const to = await selected();
    const focusOk = await page.evaluate(() => document.activeElement?.getAttribute('aria-selected') === 'true');
    check('ArrowRight moves to the next chapter', to && to !== from && (await caseCh()) === to && focusOk, `${from} -> ${to}`);
    await page.keyboard.press('Home');
    await page.waitForTimeout(300);
    check('Home goes to the first chapter', (await selected()) === tabs[0]);

    // An action operates its feature (the heat chapter moves a rail).
    await page.click('#project-detail .pd-chapter[data-chapter="heat"]').catch(() => {});
    await page.waitForTimeout(600);
    const acts = await page.$$eval('#project-detail .pd-act', (bs) => bs.map((b) => b.dataset.act));
    check('a chapter offers controls for its feature', acts.length > 0, acts.join(', '));

    // Reset: orbit away, then the tool brings the camera home.
    const m = await page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width * 0.15, y: r.top + r.height * 0.2 }; });
    await page.mouse.move(m.x, m.y);
    await page.mouse.down();
    for (let k = 1; k <= 8; k++) await page.mouse.move(m.x + k * 30, m.y + k * 3);
    await page.mouse.up();
    await page.click('#project-detail [data-tool="reset"]');
    await page.waitForTimeout(1500);
    // Home is the current chapter's own shot.
    const [yaw, want] = await page.evaluate(() => {
      const r = [...window.__three.slots].find((x) => x.opts.context === 'case')?.rig;
      return [r?.yaw.x, r?.shot?.yaw ?? 0];
    });
    check('Reset brings the camera home', Math.abs((yaw ?? 1) - want) < 0.03, `yaw ${yaw?.toFixed(3)}, shot ${want.toFixed(2)}`);

    // Nothing sits on the diorama: with it in full view below the site's
    // floating nav, every point of it hits the canvas.
    await page.$eval(sel, (m) => m.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(500);
    const covered = await page.$eval(sel, (media) => {
      const r = media.getBoundingClientRect();
      const hits = [];
      for (let y = 0.05; y < 1; y += 0.1) for (let x = 0.05; x < 1; x += 0.1) {
        const px = r.left + r.width * x;
        const py = r.top + r.height * y;
        if (py < 0 || py > innerHeight) continue;
        const el = document.elementFromPoint(px, py);
        if (el && !el.matches('canvas.media-3d') && el !== media) hits.push(el.className || el.tagName);
      }
      return [...new Set(hits)];
    });
    check('no control is laid over the diorama', covered.length === 0, covered.join(', '));

    const small = await page.$$eval('#project-detail .pd-chapter, #project-detail .pd-tool, #project-detail .pd-act', (bs) => bs.filter((x) => x.offsetWidth < 44 || x.offsetHeight < 44).map((x) => x.dataset.chapter ?? x.dataset.tool ?? x.dataset.act));
    check('explorer controls are at least 44 px', small.length === 0, small.join(', '));
    const unnamed = await page.$$eval('#project-detail .pd-explorer button', (bs) => bs.filter((x) => !(x.getAttribute('aria-label') || x.textContent.trim())).length);
    check('explorer controls are named', unnamed === 0);
    check('canvases are hidden from assistive tech', await page.$$eval('canvas.media-3d', (cs) => cs.every((c) => c.getAttribute('aria-hidden') === 'true')));
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.body.classList.contains('detail-open'), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(600);
  if (i === 0) {
    check('Escape closes the case study', await page.evaluate(() => !document.body.classList.contains('detail-open')));
    check('case slot released', await page.evaluate(() => ![...window.__three.slots].some((s) => s.opts.context === 'case')));
  }
}

// The first cycle compiles programs the renderer keeps for good (the shadow
// pass's depth materials), so leaks are measured from after it.
await openAndClose(0);
await scrollTo(flag);
await page.waitForTimeout(800);
const warm = await page.evaluate(() => window.__three.info());
baseline.programs = Math.max(baseline.programs, warm.programs);
for (let i = 1; i < CYCLES; i++) await openAndClose(i);
await scrollTo(flag);
await page.waitForTimeout(800);
const after = await page.evaluate(() => ({
  ...window.__three.info(),
  triggers: window.__portfolio.ScrollTrigger.getAll().length,
}));
for (const k of ['geometries', 'textures', 'programs', 'slots', 'triggers']) {
  check(`no leak after ${CYCLES} open/close: ${k}`, after[k] <= baseline[k], `${baseline[k]} -> ${after[k]}`);
}

check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
