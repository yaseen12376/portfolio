/**
 * The work section on the real page, end to end, on the real GPU:
 *
 *   node scripts/qa/site.mjs [--url http://localhost:3000] [--cycles 5] [--cal]
 *
 *  0. the exhibition is all there, in the order of src/data/projects.js: a
 *     media box per project, a stage per diorama, a piece per shelf project,
 *     a catalogue row per project linking its case study, every count the
 *     same; the résumé links show exactly when public/resume.pdf exists; and
 *     no piece's loop has been fetched by merely loading the page
 *  1. every stage's diorama reaches data-3d="live" as it scrolls in, and its
 *     canvas is not blank; its stepper turns into a button per toured
 *     chapter that follows the tour, fills as it runs, takes the diorama to
 *     a chapter when clicked, and Pause holds the diorama still until Play
 *  2. an orbit drag on the first stage turns the camera and springs back home
 *  3. for every diorama, a click on its stage's backdrop opens the case study
 *     at the chapter the stage was showing; its diorama goes live and drives the
 *     feature explorer: every chapter moves the scene and shows live readouts,
 *     the arrow keys walk the tablist, Reset brings the camera home, controls
 *     are 44 px and named, and nothing is laid over the diorama itself
 *  4. Escape closes it and the case slot is released
 *  5. open/close each N times: GPU geometries, textures and programs, engine
 *     slots and ScrollTriggers return to where they started
 *  6. every piece with a loop plays it while hovered (the tile size only),
 *     holds its pose when the pointer leaves, and its backdrop is the same
 *     colour, the page's, whether the poster or the loop is showing; one
 *     piece's case study plays the large loop with a working Pause button
 * with zero console errors throughout. --cal shows the calibration scene in
 * every stage (before the real scenes exist).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { projects } from '../../src/data/projects.js';
import { ROOT, SOFTWARE_GL, args, gpuName, launch, rgb, watchConsole } from './lib.mjs';

const opts = args();
const CYCLES = Number(opts.cycles ?? 5);
const q = opts.cal ? '?3d=cal' : '?3d=force';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`);
};
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const PAGE_BG = [9, 9, 11];

const { browser, context } = await launch();
const page = await context.newPage();
await page.setViewportSize({ width: 1440, height: 900 });
const errors = watchConsole(page);
// Every request for a piece's loop, to prove they are fetched on hover only.
const loops = [];
page.on('request', (r) => {
  if (/\/pieces\/[^/]+\/loop-/.test(r.url())) loops.push(new URL(r.url()).pathname);
});
await page.goto(`${opts.url}/${q}`);
await page.waitForLoadState('load');
console.log(`GPU: ${await gpuName(page)}`);
await page.waitForFunction(() => window.__portfolio?.lenis, null, { timeout: 15000 });
await page.waitForTimeout(1200); // preloader curtain

const scrollTo = (sel, offset = -120) =>
  page.evaluate(
    async ([s, o]) => {
      const el = document.querySelector(s);
      // force: Lenis is stopped while a case study is open or closing.
      window.__portfolio.lenis.scrollTo(el, { immediate: true, offset: o, force: true });
      await new Promise((r) => setTimeout(r, 400));
    },
    [sel, offset]
  );

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

/** The centre of an element in the viewport, and whether a click there reaches it. */
const target = (sel) =>
  page.$eval(sel, (e) => {
    const r = e.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, reaches: !!hit && (hit === e || e.contains(hit)) };
  });

// ---------------------------------------------------------------- 0. exhibition
const want = {
  stages: projects.filter((p) => p.tier === 'stage').map((p) => p.id),
  shelf: projects.filter((p) => p.tier !== 'stage').map((p) => p.id),
};
want.all = [...want.stages, ...want.shelf];
const got = await page.evaluate(() => ({
  media: [...document.querySelectorAll('#projects .media[data-id]')].map((e) => e.dataset.id),
  stages: [...document.querySelectorAll('#work-stages .stage')].map((e) => e.dataset.id),
  shelf: [...document.querySelectorAll('#work-shelf .piece')].map((e) => e.querySelector('.media')?.dataset.id),
  rows: [...document.querySelectorAll('#work-catalogue .cat-link')].map((a) => a.getAttribute('href')),
  totals: [...document.querySelectorAll('[data-project-total]')].map((e) => e.textContent.trim()),
  counts: [...document.querySelectorAll('[data-project-count]')].map((e) => e.textContent.trim()),
}));
const n = want.all.length;
check(`a media box for each of the ${n} projects, in order`, same(got.media, want.all), `${got.media.length} boxes`);
check(`${want.stages.length} stages, in order`, same(got.stages, want.stages), got.stages.join(', '));
check(`${want.shelf.length} pieces on the shelf, in order`, same(got.shelf, want.shelf), `${got.shelf.length} pieces`);
check(`${n} catalogue rows, in order, each opening its case study`, same(got.rows, want.all.map((id) => `#/project/${id}`)), `${got.rows.length} rows`);
check(
  'every project count agrees',
  got.totals.length > 0 && got.totals.every((t) => t === String(n)) && got.counts.every((c) => c === String(n).padStart(2, '0')),
  [...got.totals, ...got.counts].join(', ')
);

const hasPdf = existsSync(join(ROOT, 'public', 'resume.pdf'));
const res = await page.evaluate(() => {
  const all = [...document.querySelectorAll('a[href="/resume.pdf"]')];
  return {
    total: all.length,
    shown: all.filter((a) => !a.closest('[hidden]')).length,
    named: all.filter((a) => /\.pdf$/.test(a.getAttribute('download') ?? '')).length,
    swap: document.querySelector('[data-resume-swap]')?.getAttribute('href') ?? null,
  };
});
if (hasPdf) {
  check('résumé: every link is shown and downloads a named PDF', res.total >= 5 && res.shown === res.total && res.named === res.total, `${res.shown} of ${res.total} shown, ${res.named} named (after npm run gen:resume, restart the server)`);
} else {
  check('résumé: no PDF yet, so no link to it shows', res.shown === 0 && res.swap !== '/resume.pdf', `${res.shown} shown, hero button -> ${res.swap}`);
}
check('no loop is fetched by loading the page', loops.length === 0, loops.slice(0, 3).join(', '));

// ---------------------------------------------------------------- 1. stages
const stageOf = (id) => `#work-stages .stage[data-id="${id}"]`;
const readStage = (id) =>
  page.evaluate((s) => {
    const stage = document.querySelector(s);
    const media = stage?.querySelector('.media');
    const slot = [...window.__three.slots].find((x) => x.media === media && x.opts.context === 'stage');
    const tour = stage?.querySelector('.tour');
    const on = stage?.querySelector('.tour-btn[aria-current="step"]');
    return {
      live: !!tour?.classList.contains('is-live'),
      held: !!tour?.classList.contains('is-held'),
      order: [...(stage?.querySelectorAll('.tour-step') ?? [])].map((li) => li.dataset.chapter),
      buttons: stage?.querySelectorAll('.tour-btn').length ?? 0,
      small: [...(stage?.querySelectorAll('.tour-btn, .tour-hold') ?? [])].filter((b) => !b.hidden && b.offsetHeight < 44).map((b) => b.textContent.trim()),
      shown: on?.parentElement.dataset.chapter ?? null,
      p: Number(on?.parentElement.style.getPropertyValue('--p') || 0),
      scene: slot?.chapters?.current?.id ?? null,
      tour: slot?.chapters?.tour ?? [],
      time: slot?.time ?? 0,
      hold: stage?.querySelector('.tour-hold')?.hidden ? null : (stage?.querySelector('.tour-hold')?.textContent.trim() ?? null),
    };
  }, stageOf(id));

async function stepper(id) {
  await scrollTo(stageOf(id), 0);
  await page.waitForFunction((s) => document.querySelector(`${s} .tour.is-live`), stageOf(id), { timeout: 5000 }).catch(() => {});
  const a = await readStage(id);
  check(`${id}: the stepper has a button per toured chapter`, a.live && a.buttons === a.order.length && same(a.order, a.tour), `${a.buttons} buttons for ${a.tour.join(', ')}`);
  check(`${id}: the step shown is the diorama's chapter`, !!a.shown && a.shown === a.scene, `step ${a.shown}, scene ${a.scene}`);
  check(`${id}: stepper controls are at least 44 px`, a.small.length === 0, a.small.join(', '));
  if (!a.live || a.order.length < 2) return;

  // A click on another step takes the diorama there, and its bar fills.
  const next = a.order[(a.order.indexOf(a.shown) + 1) % a.order.length];
  const t = await target(`${stageOf(id)} .tour-step[data-chapter="${next}"] .tour-btn`);
  await page.mouse.click(t.x, t.y);
  await page.waitForTimeout(400);
  const b = await readStage(id);
  check(`${id}: a step takes the diorama to its chapter`, t.reaches && b.scene === next && b.shown === next, `${a.shown} -> ${next}: scene ${b.scene}, step ${b.shown}${t.reaches ? '' : ', the click is covered'}`);
  await page.waitForTimeout(1500);
  const c = await readStage(id);
  check(`${id}: the step's bar fills as the tour runs`, c.shown === next && c.p > b.p && c.p > 0, `${b.p.toFixed(2)} -> ${c.p.toFixed(2)}`);

  // Pause holds the diorama still; Play lets it go on.
  const h = await target(`${stageOf(id)} .tour-hold`);
  await page.mouse.click(h.x, h.y);
  await page.waitForTimeout(300);
  const d = await readStage(id);
  await page.waitForTimeout(800);
  const e = await readStage(id);
  check(`${id}: Pause holds the diorama still`, h.reaches && d.held && d.hold === 'Play' && Math.abs(e.time - d.time) < 0.02, `label ${d.hold}, time ${d.time.toFixed(2)} -> ${e.time.toFixed(2)}`);
  await page.mouse.click(h.x, h.y);
  await page.waitForTimeout(800);
  const f = await readStage(id);
  check(`${id}: Play lets it go on`, !f.held && f.hold === 'Pause' && f.time - e.time > 0.2, `label ${f.hold}, time ${e.time.toFixed(2)} -> ${f.time.toFixed(2)}`);
}

const dioramas = await page.$$eval('#work-stages .media[data-scene]', (els) => els.map((e) => e.dataset.id));
const withScene = [];
for (const [i, id] of dioramas.entries()) {
  const sel = `#work-stages .media[data-id="${id}"]`;
  await scrollTo(sel);
  const t0 = Date.now();
  // The first one also pays for loading the engine.
  const state = await page
    .waitForFunction((s) => ['live', 'paused', 'error'].includes(document.querySelector(s)?.dataset['3d']), sel, { timeout: i ? 12000 : 30000 })
    .then(() => page.$eval(sel, (e) => e.dataset['3d']))
    .catch(() => page.$eval(sel, (e) => e.dataset['3d'] ?? 'none'));
  if (state === 'none') {
    console.log(`     stage ${id}: no diorama`);
    continue;
  }
  if (i === 0) console.log(`     first diorama live after ${((Date.now() - t0) / 1000).toFixed(1)} s (includes the engine)`);
  withScene.push(id);
  const v = await variance(sel);
  check(`stage ${id} goes live`, state === 'live' || state === 'paused', `state ${state}, variance ${v.toFixed(0)}`);
  check(`stage ${id} canvas has content`, v > 20);
  if (!opts.cal) await stepper(id);
}
check('at least one stage has a diorama', withScene.length > 0, withScene.join(', '));

// ---------------------------------------------------------------- 2. orbit
const flag = '.flagship .media';
await scrollTo(flag);
await page.waitForFunction((s) => document.querySelector(s)?.dataset['3d'] === 'live', flag, { timeout: 12000 }).catch(() => {});
const box = await page.$eval(flag, (e) => {
  const r = e.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
// The first stage's own slot, found by its media box (not just any live stage).
const flagSlot = `[...window.__three.slots].find((x) => x.media === document.querySelector('${flag}') && x.opts.context === 'stage')`;
// Relative to the shot the camera is on (a chapter's district, or home).
const cam = () =>
  page.evaluate(`(() => {
    const s = ${flagSlot};
    return s ? { yaw: s.rig.yaw.x - (s.rig.shot?.yaw ?? 0), pitch: s.rig.pitch.x - (s.rig.shot?.pitch ?? 0) } : null;
  })()`);
const sceneTime = () => page.evaluate(`${flagSlot}?.time ?? 0`);
const frames = () => page.evaluate(`${flagSlot}?.frames ?? 0`);
// The camera's springs move only on a drawn frame, so count frames rather than
// wait a fixed time: on a busy machine 250 ms can pass without one.
const drawn = async (n) => {
  const f = await frames();
  await page.waitForFunction(`(${flagSlot})?.frames >= ${f + n}`, null, { timeout: 15000 }).catch(() => {});
};
await drawn(3);
const bx = box.x + 24;
const by = box.y + 24;
const under = await page.evaluate(([x, y]) => {
  const el = document.elementFromPoint(x, y);
  return el ? `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).trim().split(/\s+/).join('.')}` : ''}` : 'nothing';
}, [bx, by]);
await page.mouse.move(bx, by);
await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(bx + i * 30, by + i * 4);
await drawn(4);
const turned = await cam();
// What the slot made of the gesture, for the report if the camera did not turn.
const gesture = await page.evaluate(`(() => {
  const s = ${flagSlot};
  return s && { active: s.active, inView: s.inView, dragging: s.pointer.dragging, hit: s.pointer.hit?.kind ?? null, chapter: s.chapters?.current?.id ?? null };
})()`);
await page.mouse.up();
await page.mouse.move(box.x + box.w / 2, box.y + box.h + 200); // off the stage: no parallax
// 1.5 s of the scene's own time (a frame's step is capped, so on a slow
// software renderer that is longer than 1.5 s on the clock).
const since = await sceneTime();
for (const end = Date.now() + (SOFTWARE_GL ? 120000 : 20000); Date.now() < end && (await sceneTime()) - since < 1.5; ) await page.waitForTimeout(100);
const home = await cam();
const orbited = !!turned && Math.abs(turned.yaw) > 0.15;
check('orbit drag turns the camera', orbited, turned ? `yaw ${turned.yaw.toFixed(2)}${orbited ? '' : `; under the pointer: ${under}; ${JSON.stringify(gesture)}`}` : 'no slot');
check('orbit springs back within 1.5 s', !!home && Math.abs(home.yaw) < 0.02 && Math.abs(home.pitch) < 0.02, home ? `yaw ${home.yaw.toFixed(3)}` : '');

// ---------------------------------------------------------------- 3-5. case study, leaks
// The live stage builds some overlays, and compiles their programs, the
// first time its tour shows them (the heatmap, trails): let it go round
// its tour once on its own before the count is taken, so they aren't
// mistaken for a leak later. (Left to tour, the count settles and holds.)
const mediaOf = (id) => `#work-stages .media[data-id="${id}"]`;
async function tourOnce(sel) {
  await scrollTo(sel);
  await page.waitForFunction((s) => document.querySelector(s)?.dataset['3d'] === 'live', sel, { timeout: 12000 }).catch(() => {});
  await page.evaluate(async (q) => {
    const media = document.querySelector(q);
    const s = [...window.__three.slots].find((x) => x.media === media && x.opts.context === 'stage');
    const ch = s?.chapters;
    if (!ch?.tour?.length) return;
    const seen = new Set();
    for (let k = 0; k < 150 && seen.size < ch.tour.length; k++) {
      seen.add(ch.current?.id);
      await new Promise((r) => setTimeout(r, 500));
    }
    await new Promise((r) => setTimeout(r, 4000)); // the last one's, too
  }, sel);
}
for (const id of withScene) await tourOnce(mediaOf(id));
await scrollTo(flag);
await page.waitForTimeout(800);
const baseline = await page.evaluate(() => ({
  ...window.__three.info(),
  triggers: window.__portfolio.ScrollTrigger.getAll().length,
}));

const unopened = [];
async function openAndClose(i, id) {
  const media = mediaOf(id);
  await scrollTo(media);
  await page.waitForFunction((s) => document.querySelector(s)?.dataset['3d'] === 'live', media, { timeout: 12000 }).catch(() => {});
  const b = await page.$eval(media, (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top };
  });
  const tourAt = await page.evaluate((q) => [...window.__three.slots].find((x) => x.media === document.querySelector(q) && x.opts.context === 'stage')?.chapters?.current?.id, media);
  // The backdrop, clear of the diorama itself.
  await page.mouse.click(b.x + 20, b.y + 20);
  const opened = await page
    .waitForFunction((pid) => location.hash === `#/project/${pid}`, id, { timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  if (!opened) {
    unopened.push(`${id} #${i + 1}`);
    return;
  }
  const sel = '#project-detail .pd-hero-media .media';
  const live = await page
    .waitForFunction((s) => document.querySelector(s)?.dataset['3d'] === 'live', sel, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  if (i === 0) {
    check(`${id}: case study diorama goes live`, live, await page.$eval(sel, (e) => e.dataset['3d'] ?? 'none').catch(() => 'no media'));
    await page.waitForSelector('#project-detail .pd-explorer.is-live', { timeout: 5000 }).catch(() => {});
    const caseCh = () => page.evaluate(() => [...window.__three.slots].find((x) => x.opts.context === 'case')?.chapters?.current?.id);
    const selected = () => page.$eval('#project-detail .pd-chapter[aria-selected="true"]', (t) => t.dataset.chapter).catch(() => null);
    check(`${id}: the explorer is driven by the diorama`, await page.$('#project-detail .pd-explorer.is-live').then(Boolean));
    check(`${id}: it opens at the chapter the stage was showing`, !tourAt || ((await caseCh()) === tourAt && (await selected()) === tourAt), `stage ${tourAt}, case ${await caseCh()}`);

    // Every chapter: the tab, the scene and the readouts agree.
    const tabs = await page.$$eval('#project-detail .pd-chapter', (ts) => ts.map((t) => t.dataset.chapter));
    const bad = [];
    for (const t of tabs) {
      await page.click(`#project-detail .pd-chapter[data-chapter="${t}"]`);
      await page.waitForTimeout(900);
      // (They come with the scene's next frame, a while on a software renderer.)
      await page.waitForFunction(() => document.querySelectorAll('#project-detail .pd-readouts dd').length > 0, null, { timeout: 8000 }).catch(() => {});
      const reads = await page.$$eval('#project-detail .pd-readouts dd', (d) => d.length);
      if ((await caseCh()) !== t || (await selected()) !== t || reads === 0) bad.push(`${t} (scene ${await caseCh()}, ${reads} readouts)`);
    }
    check(`${id}: all ${tabs.length} chapters switch the scene and show readouts`, tabs.length > 0 && bad.length === 0, bad.join(', '));

    // The tablist walks with the arrow keys and keeps focus on the tab.
    await page.focus('#project-detail .pd-chapter[aria-selected="true"]');
    const from = await selected();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    const to = await selected();
    const focusOk = await page.evaluate(() => document.activeElement?.getAttribute('aria-selected') === 'true');
    check(`${id}: ArrowRight moves to the next chapter`, to && to !== from && (await caseCh()) === to && focusOk, `${from} -> ${to}`);
    await page.keyboard.press('Home');
    await page.waitForTimeout(300);
    check(`${id}: Home goes to the first chapter`, (await selected()) === tabs[0]);

    // A chapter offers controls that operate its feature (the first that has any).
    let acts = [];
    for (const t of tabs) {
      await page.click(`#project-detail .pd-chapter[data-chapter="${t}"]`).catch(() => {});
      await page.waitForTimeout(400);
      acts = await page.$$eval('#project-detail .pd-act', (bs) => bs.map((b) => b.dataset.act));
      if (acts.length) break;
    }
    check(`${id}: a chapter offers controls for its feature`, acts.length > 0, acts.join(', '));

    // Reset: orbit away, then the tool brings the camera home.
    const m = await page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width * 0.15, y: r.top + r.height * 0.2 }; });
    await page.mouse.move(m.x, m.y);
    await page.mouse.down();
    for (let k = 1; k <= 8; k++) await page.mouse.move(m.x + k * 30, m.y + k * 3);
    await page.mouse.up();
    await page.click('#project-detail [data-tool="reset"]');
    await page.waitForTimeout(1500);
    // Home is the current chapter's own shot.
    const [yaw, wantYaw] = await page.evaluate(() => {
      const r = [...window.__three.slots].find((x) => x.opts.context === 'case')?.rig;
      return [r?.yaw.x, r?.shot?.yaw ?? 0];
    });
    check(`${id}: Reset brings the camera home`, Math.abs((yaw ?? 1) - wantYaw) < 0.03, `yaw ${yaw?.toFixed(3)}, shot ${wantYaw.toFixed(2)}`);

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
    check(`${id}: no control is laid over the diorama`, covered.length === 0, covered.join(', '));

    const small = await page.$$eval('#project-detail .pd-chapter, #project-detail .pd-tool, #project-detail .pd-act', (bs) => bs.filter((x) => x.offsetWidth < 44 || x.offsetHeight < 44).map((x) => x.dataset.chapter ?? x.dataset.tool ?? x.dataset.act));
    check(`${id}: explorer controls are at least 44 px`, small.length === 0, small.join(', '));
    const unnamed = await page.$$eval('#project-detail .pd-explorer button', (bs) => bs.filter((x) => !(x.getAttribute('aria-label') || x.textContent.trim())).length);
    check(`${id}: explorer controls are named`, unnamed === 0);
    check('canvases are hidden from assistive tech', await page.$$eval('canvas.media-3d', (cs) => cs.every((c) => c.getAttribute('aria-hidden') === 'true')));
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.body.classList.contains('detail-open'), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(600);
  if (i === 0) {
    check(`${id}: Escape closes the case study`, await page.evaluate(() => !document.body.classList.contains('detail-open')));
    check(`${id}: case slot released`, await page.evaluate(() => ![...window.__three.slots].some((s) => s.opts.context === 'case')));
  }
}

// The first cycle compiles programs the renderer keeps for good (the shadow
// pass's depth materials), so leaks are measured from after it.
// Each diorama once (every check), then the rest of the cycles. Only the
// programs may stay up after the first (they're compiled once and kept).
for (const id of withScene) await openAndClose(0, id);
await scrollTo(flag);
await page.waitForTimeout(800);
const warm = await page.evaluate(() => window.__three.info());
baseline.programs = Math.max(baseline.programs, warm.programs);
for (let i = 1; i < CYCLES; i++) for (const id of withScene) await openAndClose(i, id);
check(`a click on a stage's backdrop opens its case study (${withScene.length * CYCLES} tries)`, unopened.length === 0, unopened.join(', '));
await scrollTo(flag);
await page.waitForTimeout(800);
const after = await page.evaluate(() => ({
  ...window.__three.info(),
  triggers: window.__portfolio.ScrollTrigger.getAll().length,
}));
for (const k of ['geometries', 'textures', 'programs', 'slots', 'triggers']) {
  check(`no leak after ${CYCLES} open/close: ${k}`, after[k] <= baseline[k], `${baseline[k]} -> ${after[k]}${warm[k] != null ? ` (after the first ${warm[k]})` : ''}`);
}

// ---------------------------------------------------------------- 6. pieces
/** Mean colour of the four corner patches of an element, inside the soft edge. */
async function corners(sel) {
  const r = await page.$eval(sel, (e) => {
    const b = e.getBoundingClientRect();
    return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) };
  });
  const px = await rgb(await page.screenshot({ clip: { x: r.x, y: r.y, width: r.w, height: r.h } }), 100, 100);
  const sum = [0, 0, 0];
  let k = 0;
  for (const [x0, y0] of [[6, 6], [88, 6], [6, 88], [88, 88]]) {
    for (let y = y0; y < y0 + 6; y++) for (let x = x0; x < x0 + 6; x++) {
      const o = (y * 100 + x) * 3;
      sum[0] += px[o];
      sum[1] += px[o + 1];
      sum[2] += px[o + 2];
      k++;
    }
  }
  return sum.map((s) => s / k);
}
const fmt = (c) => c.map((v) => v.toFixed(1)).join(',');
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

const shelfLoops = await page.$$eval('#work-shelf .media-piece', (ms) => ms.filter((m) => m.querySelector('video')).map((m) => m.dataset.id));
check('at least one piece has a loop', shelfLoops.length > 0, shelfLoops.join(', '));
await page.mouse.move(2, 450);
for (const id of shelfLoops) {
  const tile = `#work-shelf .media[data-id="${id}"]`;
  await scrollTo(tile, -200);
  await page.mouse.move(2, 450);
  await page.waitForTimeout(300);
  const before = loops.length;
  const still = await corners(tile);
  const t = await target(tile);
  await page.mouse.move(t.x, t.y);
  const playing = await page
    .waitForFunction((s) => document.querySelector(s)?.classList.contains('is-playing'), tile, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(900); // the fade
  const t1 = await page.$eval(`${tile} video`, (v) => v.currentTime);
  const moving = await corners(tile);
  await page.waitForTimeout(500);
  const t2 = await page.$eval(`${tile} video`, (v) => v.currentTime);
  const fetched = loops.slice(before);
  check(`${id}: hover plays the loop`, playing && t2 > t1, `t ${t1.toFixed(2)} -> ${t2.toFixed(2)}`);
  check(`${id}: hover fetches the tile loop only`, fetched.length > 0 && fetched.every((u) => u.includes('/loop-720.')), [...new Set(fetched)].join(', '));
  check(`${id}: the backdrop is the page colour, still or playing`, near(still, moving, 2) && near(still, PAGE_BG, 2) && near(moving, PAGE_BG, 2), `still ${fmt(still)}, playing ${fmt(moving)}`);
  await page.mouse.move(2, 450);
  await page.waitForTimeout(300);
  const held = await page.$eval(tile, (m) => ({ paused: m.querySelector('video').paused, t: m.querySelector('video').currentTime, shown: m.classList.contains('is-playing') }));
  await page.waitForTimeout(400);
  const t3 = await page.$eval(`${tile} video`, (v) => v.currentTime);
  check(`${id}: leaving holds its pose`, held.paused && held.shown && Math.abs(t3 - held.t) < 0.01, `paused ${held.paused}, frame kept ${held.shown}`);
}

// One piece's case study: the large loop, and a Pause button that works.
if (shelfLoops.length) {
  const id = shelfLoops[0];
  const triggers = await page.evaluate(() => window.__portfolio.ScrollTrigger.getAll().length);
  const link = `#work-shelf .piece:has(.media[data-id="${id}"]) .plate-title a`;
  await scrollTo(link, -300);
  const l = await target(link);
  await page.mouse.click(l.x, l.y);
  const open = await page
    .waitForFunction((pid) => location.hash === `#/project/${pid}` && document.body.classList.contains('detail-open'), id, { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  check(`${id}: its label opens the case study`, open);
  const hm = '#project-detail .pd-piece .media';
  const plays = await page
    .waitForFunction((s) => document.querySelector(s)?.classList.contains('is-playing'), hm, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  const src = await page.$eval(`${hm} video`, (v) => v.currentSrc).catch(() => '');
  check(`${id}: the case study plays the large loop`, plays && src.includes('/loop-1080.'), src.replace(/^.*\/pieces\//, '/pieces/'));
  const btn = '#project-detail .pd-hold';
  const b0 = await page.$eval(btn, (b) => ({ hidden: b.hidden, w: b.offsetWidth, h: b.offsetHeight, label: b.textContent.trim(), named: !!b.textContent.trim() })).catch(() => null);
  check(`${id}: Pause is shown, named and 44 px`, !!b0 && !b0.hidden && b0.named && b0.w >= 44 && b0.h >= 44, b0 ? `${b0.label}, ${b0.w}x${b0.h}` : 'none');
  if (b0 && !b0.hidden) {
    await page.click(btn);
    await page.waitForTimeout(300);
    const p1 = await page.$eval(hm, (m) => ({ paused: m.querySelector('video').paused, label: document.querySelector('#project-detail .pd-hold').textContent.trim() }));
    await page.click(btn);
    await page.waitForTimeout(300);
    const p2 = await page.$eval(hm, (m) => ({ paused: m.querySelector('video').paused, label: document.querySelector('#project-detail .pd-hold').textContent.trim() }));
    check(`${id}: Pause holds the loop and Play resumes it`, p1.paused && p1.label === 'Play' && !p2.paused && p2.label === 'Pause', `${p1.label}/${p1.paused} then ${p2.label}/${p2.paused}`);
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.body.classList.contains('detail-open'), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(600);
  check(`${id}: Escape closes it, and no trigger is left behind`, await page.evaluate((n0) => !document.body.classList.contains('detail-open') && window.__portfolio.ScrollTrigger.getAll().length <= n0, triggers));
}

check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
