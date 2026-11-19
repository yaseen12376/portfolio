/**
 * The work section on the real page, end to end, on the real GPU:
 *
 *   node scripts/qa/site.mjs [--url http://localhost:3000] [--cycles 5] [--cal] [--phone] [--live]
 *
 * (--phone runs section 7 only; --live, section 6b only.)
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
 * 6b. every piece with a live jar (src/data/pieces.json `live`): its case
 *     study's jar goes live and takes over from the loop at the loop's own
 *     pose, its canvas fading in as the loop stops; it turns by itself and
 *     offers "Drag to turn"; Pause holds it and Play lets it go; a drag turns
 *     it (and the offer goes), a tap on the dome lifts the glass and another
 *     sets it down, the arrow keys turn it 15 degrees and Enter lifts it; a
 *     numbered spot opens its part in the explorer, and the whole-jar tab
 *     comes back; "Turn right" turns it 45 degrees and "Lift the glass" lifts
 *     it, pressed while up, keeping the keyboard's focus; a chapter with a
 *     closer view of its own (Mission Builder's Dust) comes in only with the
 *     glass off and clear, and backs out before it comes down; its controls are
 *     44 px and named, the jar a named group the keyboard reaches; Escape
 *     lets it go, and opening it again leaves nothing behind. Under reduced
 *     motion its case study keeps the poster.
 *  7. a phone (390 x 844, touch, the gate deciding as it would there): the
 *     page is under 13,000 px with a short hero; each stage shows number and
 *     year and two figures side by side, and its tour steps only once its
 *     diorama runs; the collection is one row that snaps, swiped to its last
 *     piece, which opens its case study; Experience and the form start
 *     folded and open on a tap (and on a computer are open, with no summary);
 *     no reveal blurs; the toolkit says tap; every control is a 44 px target;
 *     a live jar's case study offers "Turn it in 3D", a tap makes it live, a
 *     sideways thumb turns it and an upright one still scrolls the page
 * with zero console errors throughout. --cal shows the calibration scene in
 * every stage (before the real scenes exist).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { projects } from '../../src/data/projects.js';
import { JAR, ROOT, SOFTWARE_GL, args, gpuName, launch, liveJarIds, rgb, watchConsole } from './lib.mjs';

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
// The pieces whose case study turns them in 3D: a live build, and chapters
// to explore it by (project-detail.js livePiece()).
const liveIds = liveJarIds();

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
if (opts.phone) {
  // --phone: only section 7, for working on the phone layout.
  await phoneChecks();
  await finish();
}

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

if (opts.live) {
  // --live: only section 6b, for working on the live jars.
  await liveJars();
  await finish();
}

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

// One piece's case study: the large loop, and a Pause button that works (a
// piece without a live jar, so the loop stays: section 6b has the jars).
const loopOnly = shelfLoops.find((x) => !liveIds.includes(x));
if (loopOnly) {
  const id = loopOnly;
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

// ---------------------------------------------------------------- 6b. live jars
await liveJars();

/** The open case study's jar: its controller's state (state() is there for QA). */
function jarState(pg = page) {
  return pg.evaluate((s) => {
    const m = document.querySelector(s);
    return (m && [...window.__three.slots].find((x) => x.media === m)?.controller?.state?.()) ?? null;
  }, JAR);
}

/** Until the jar's state[key] is above (>), below (<), one of (in) or equal to a value; false if it never is. */
function jarUntil(key, op, value, timeout = 6000, pg = page) {
  return pg
    .waitForFunction(
      ([s, k, o, v]) => {
        const m = document.querySelector(s);
        const st = m && [...window.__three.slots].find((x) => x.media === m)?.controller?.state?.();
        if (!st) return false;
        const x = st[k];
        return o === '>' ? x > v : o === '<' ? x < v : o === 'in' ? v.includes(x) : x === v;
      },
      [JAR, key, op, value],
      { timeout, polling: 100 }
    )
    .then(() => true)
    .catch(() => false);
}

/** Until it is done turning where it was sent: at rest, or turning by itself again. */
function settle() {
  return jarUntil('mode', 'in', ['rest', 'idle'], 5000);
}

/** A place on the jar's canvas with nothing laid over it, near fractions of its box. */
function onCanvas(fx, fy) {
  return page.evaluate(
    ([s, x0, y0]) => {
      const c = document.querySelector(s)?.querySelector('canvas.media-3d');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      for (const dy of [0, 0.05, -0.05, 0.1, -0.1]) {
        const x = r.left + r.width * x0;
        const y = r.top + r.height * (y0 + dy);
        if (document.elementFromPoint(x, y) === c) return { x, y, w: r.width };
      }
      return null;
    },
    [JAR, fx, fy]
  );
}

/** A place where a tap meets the dome (its pick shape) with nothing laid over it. */
function onDome(pg = page) {
  return pg.evaluate((s) => {
    const m = document.querySelector(s);
    const slot = m && [...window.__three.slots].find((x) => x.media === m);
    const c = m?.querySelector('canvas.media-3d');
    if (!slot || !c) return null;
    const r = c.getBoundingClientRect();
    for (let fy = 0.1; fy < 0.7; fy += 0.02) {
      for (const fx of [0.5, 0.4, 0.6]) {
        const x = r.left + r.width * fx;
        const y = r.top + r.height * fy;
        if (document.elementFromPoint(x, y) === c && slot.pick({ clientX: x, clientY: y })?.kind === 'glass') return { x, y };
      }
    }
    return null;
  }, JAR);
}

/**
 * With the glass off: each part a tap can open, at the pixel deepest inside
 * it (every 5 px of the canvas, where nothing lies over it), as the page picks.
 */
function partPixels(pg = page) {
  return pg.evaluate((s) => {
    const m = document.querySelector(s);
    const slot = m && [...window.__three.slots].find((x) => x.media === m);
    const c = m?.querySelector('canvas.media-3d');
    if (!slot || !c) return {};
    const r = c.getBoundingClientRect();
    const step = 5;
    const at = new Map();
    for (let j = 0, y = r.top + step / 2; y < r.bottom; j++, y += step)
      for (let i = 0, x = r.left + step / 2; x < r.right; i++, x += step) {
        if (document.elementFromPoint(x, y) !== c) continue;
        const part = slot.pick({ clientX: x, clientY: y })?.part;
        if (part) at.set(`${i},${j}`, part);
      }
    const best = {};
    for (const [k, part] of at) {
      const [i, j] = k.split(',').map(Number);
      let n = 0;
      for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) n += at.get(`${i + di},${j + dj}`) === part ? 1 : 0;
      if (!best[part] || n > best[part].n) best[part] = { n, x: r.left + (i + 0.5) * step, y: r.top + (j + 0.5) * step };
    }
    return best;
  }, JAR);
}

async function jarChecks(id, p) {
  // The jar takes over at the loop's pose: one turn per loop, so its angle
  // is the loop's phase (the two run at the same pace while the canvas fades in).
  await page.waitForTimeout(250);
  const hand = await page.evaluate((s) => {
    const m = document.querySelector(s);
    const st = [...window.__three.slots].find((x) => x.media === m)?.controller?.state?.();
    const v = m.querySelector('video');
    return { angle: st?.angle ?? null, loop: v && v.duration ? (v.currentTime / v.duration) * 360 : null };
  }, JAR);
  const apart = hand.loop == null || hand.angle == null ? null : Math.abs(((((hand.angle - hand.loop) % 360) + 540) % 360) - 180);
  check(`${id}: the jar takes over at the loop's pose`, apart != null && apart < 15, apart == null ? 'no loop' : `${apart.toFixed(1)} deg apart`);
  await page.waitForTimeout(1500);
  const fade = await page.$eval(JAR, (m) => ({ opacity: getComputedStyle(m.querySelector('canvas.media-3d')).opacity, stopped: m.querySelector('video')?.paused ?? true }));
  check(`${id}: its canvas fades in over the loop, and the loop stops under it`, fade.opacity === '1' && fade.stopped, `opacity ${fade.opacity}, loop ${fade.stopped ? 'stopped' : 'playing'}`);

  const s0 = await jarState();
  await page.waitForTimeout(1000);
  const s1 = await jarState();
  check(`${id}: it turns by itself`, s0.mode === 'idle' && s1.angle - s0.angle > 4, `${(s1.angle - s0.angle).toFixed(1)} deg in 1 s`);
  if (s1.dust) {
    // A piece's dust (Mission Builder's arrays): over one loop each brush
    // sweeps once round, its clean edge only ever moving on, where the
    // clip's eased turn has the brush; parked, all of it has been swept.
    const pc = await page.evaluate((s) => {
      const m = document.querySelector(s);
      return [...window.__three.slots].find((x) => x.media === m)?.stage?.data?.piece?.dust ?? null;
    }, JAR);
    const trail = [];
    const until = Date.now() + 6600;
    while (Date.now() < until) {
      trail.push((await jarState()).dust);
      await page.waitForTimeout(90);
    }
    const D = pc?.sweep ?? 0.375;
    const bad = [];
    for (let i = 0; i < (s1.dust?.length ?? 0); i++) {
      const xs = trail.map((d) => d[i]);
      const sweeping = xs.filter((x) => x.sweeping);
      const off = sweeping.map((x) => {
        const u = x.w / D;
        return Math.abs(x.arm - u * u * (3 - 2 * u));
      });
      const back = xs.slice(1).filter((x, k) => x.sweeping && xs[k].sweeping && x.arm < xs[k].arm - 0.01).length;
      const parked = xs.filter((x) => !x.sweeping && x.arm !== 1).length;
      const span = sweeping.length ? Math.max(...sweeping.map((x) => x.arm)) - Math.min(...sweeping.map((x) => x.arm)) : 0;
      if (span < 0.6 || back || parked || Math.max(0, ...off) > 0.03) bad.push(`${xs[0].mesh}: swept ${span.toFixed(2)} of a turn, ${back} steps back, ${parked} parked unswept, ${Math.max(0, ...off).toFixed(3)} off the ease`);
    }
    check(`${id}: each brush sweeps its dust off once a loop, the clean edge under it`, s1.dust.length === 2 && !bad.length, bad.join('; ') || `${s1.dust.length} arrays, ${trail.length} frames`);
  }
  const offered = await jarUntil('hint', '===', 'drag', 6000);
  const hint = await page.$eval(`${JAR} .piece-hint`, (h) => h.textContent.trim()).catch(() => '');
  check(`${id}: "Drag to turn" shows while nobody has`, offered && hint === 'Drag to turn', hint);

  // Pause holds the turn it makes by itself; Play lets it go again.
  const hold = '#project-detail .pd-hold';
  await page.click(hold);
  await page.waitForTimeout(1500);
  const h0 = await jarState();
  await page.waitForTimeout(600);
  const h1 = await jarState();
  const paused = await page.$eval(hold, (b) => b.textContent.trim());
  check(`${id}: Pause holds the jar`, h1.held && Math.abs(h1.angle - h0.angle) < 0.3 && paused === 'Play', `${paused}, moved ${Math.abs(h1.angle - h0.angle).toFixed(2)} deg`);
  await page.click(hold);
  await page.waitForTimeout(1500);
  const h2 = await jarState();
  await page.waitForTimeout(800);
  const h3 = await jarState();
  const playing = await page.$eval(hold, (b) => b.textContent.trim());
  check(`${id}: Play lets it turn again`, !h3.held && h3.angle - h2.angle > 2 && playing === 'Pause', `${playing}, ${(h3.angle - h2.angle).toFixed(1)} deg in 0.8 s`);

  // A drag across 40% of the box turns it 90 degrees (225 a whole box).
  const from = await onCanvas(0.25, 0.55);
  check(`${id}: there is bare canvas to drag`, !!from);
  if (from) {
    const d0 = await jarState();
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + from.w * 0.4, from.y, { steps: 24 });
    await page.mouse.up();
    const d1 = await jarState();
    const by = d1.angle - d0.angle;
    check(`${id}: a drag across 40% of it turns it about 90 deg`, by > 60 && by < 140 && ['coast', 'rest'].includes(d1.mode), `${by.toFixed(0)} deg, then ${d1.mode}`);
    check(`${id}: "Drag to turn" goes after the first drag`, !(await jarState()).hint);
  }

  // The dome: a tap lifts it right out of the frame, and the model is the
  // thing to touch: a resting pointer names the part under it, a tap on a
  // part opens it in the explorer. "Put the glass back" sets it down, on the
  // whole jar.
  await settle();
  const dome = await onDome();
  check(`${id}: the dome can be tapped`, !!dome);
  if (dome) {
    await page.mouse.click(dome.x, dome.y);
    const up = await jarUntil('lift', '>', 0.999, 4000);
    const gone = await jarUntil('glassSeen', '===', false, 1000);
    const st = await jarState();
    check(`${id}: a tap on the dome lifts it right out of the frame`, up && gone && st.lifted, `lift ${st.lift.toFixed(2)}, ${st.height} m up, ${st.glassSeen ? 'in' : 'out of'} the frame`);
    check(`${id}: "Put the glass back" shows while it is off`, await jarUntil('back', '===', true, 1500));
    await page.waitForTimeout(600); // the camera in on the model
    const parts = await partPixels();
    const want = p.piece.chapters.slice(1).map((c) => c.id);
    const missing = want.filter((c) => !parts[c]);
    check(`${id}: every part can be pointed at with the glass off`, !missing.length, missing.length ? `not found: ${missing.join(', ')}` : want.join(', '));
    const first = want.find((c) => parts[c]);
    const second = want.findLast((c) => parts[c]);
    if (first) {
      await page.mouse.move(parts[first].x, parts[first].y, { steps: 3 });
      const named = await jarUntil('hover', '===', first, 1500);
      const tip = await page.$eval(`${JAR} .piece-tip`, (t) => ({ in: t.classList.contains('is-in'), text: t.textContent.trim() }));
      const title = p.piece.chapters.find((c) => c.id === first)?.title ?? first;
      check(`${id}: a resting pointer names the part under it (${first})`, named && tip.in && tip.text.includes(title), `"${tip.text}"`);
      await page.waitForTimeout(400);
      check(`${id}: the model holds still with the glass off`, ['rest', 'coast'].includes((await jarState()).mode));
    }
    if (second) {
      await page.mouse.click(parts[second].x, parts[second].y);
      const on = await jarUntil('focus', '===', second, 3000);
      const tab = await page.$eval('#project-detail .pd-chapter[aria-selected="true"]', (b) => b.dataset.chapter).catch(() => null);
      check(`${id}: a tap on a part opens it in the explorer (${second})`, on && tab === second, `tab ${tab}`);
    }
    await page.click(`${JAR} .piece-back`);
    const down = await jarUntil('lift', '<', 0.001, 4000);
    const st2 = await jarState();
    check(`${id}: "Put the glass back" sets it down, on the whole jar`, down && !st2.lifted && st2.glassSeen && st2.focus === null && !st2.back, `lift ${st2.lift.toFixed(2)}, focus ${st2.focus}`);
  }

  // The keyboard, on the jar itself.
  await settle();
  await page.evaluate((s) => document.querySelector(s).focus({ preventScroll: true }), JAR);
  const k0 = await jarState();
  await page.keyboard.press('ArrowRight');
  await settle();
  const k1 = await jarState();
  await page.keyboard.press('ArrowLeft');
  await settle();
  const k2 = await jarState();
  check(`${id}: the arrow keys turn it 15 deg each way`, Math.abs(k1.angle - k0.angle - 15) < 2.5 && Math.abs(k2.angle - k1.angle + 15) < 2.5, `${(k1.angle - k0.angle).toFixed(1)}, ${(k2.angle - k1.angle).toFixed(1)} deg`);
  await page.keyboard.press('Enter');
  const kUp = await jarUntil('lift', '>', 0.97, 4000);
  await page.keyboard.press('Enter');
  const kDown = await jarUntil('lift', '<', 0.02, 4000);
  check(`${id}: Enter lifts the glass and sets it down`, kUp && kDown);

  // A numbered spot opens its part; the whole-jar tab comes back.
  await settle();
  const spot = await page.evaluate((s) => {
    const m = document.querySelector(s);
    const st = [...window.__three.slots].find((x) => x.media === m)?.controller?.state?.();
    const els = [...m.querySelectorAll('.piece-spot')];
    for (let i = 0; i < els.length; i++) {
      if (!st?.dots[i] || st.dots[i].opacity < 0.9) continue;
      const b = els[i].getBoundingClientRect();
      const x = b.left + b.width / 2;
      const y = b.top + b.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (hit && (hit === els[i] || els[i].contains(hit))) return { id: st.dots[i].id, x, y };
    }
    return null;
  }, JAR);
  check(`${id}: a numbered spot faces the camera`, !!spot);
  if (spot) {
    await page.mouse.click(spot.x, spot.y);
    const on = await jarUntil('focus', '===', spot.id, 3000);
    await page.waitForTimeout(500);
    const ui = await page.evaluate(() => ({
      tab: document.querySelector('#project-detail .pd-chapter[aria-selected="true"]')?.dataset.chapter ?? null,
      title: document.querySelector('#project-detail .pd-chapter-panel .pd-chapter-title .t')?.textContent.trim() ?? '',
    }));
    const want = p.piece.chapters.find((c) => c.id === spot.id)?.title;
    check(`${id}: a spot opens its part in the explorer (${spot.id})`, on && ui.tab === spot.id && ui.title === want, `tab ${ui.tab}, "${ui.title}"`);
    await page.click(`#project-detail .pd-chapter[data-chapter="${p.piece.chapters[0].id}"]`);
    check(`${id}: the whole-jar tab goes back to the whole jar`, await jarUntil('focus', '===', null, 3000));
  }

  // The explorer's buttons, for touch and for the keyboard.
  await settle();
  const a0 = await jarState();
  await page.click('#project-detail .pd-act[data-act="right"]');
  await settle();
  const a1 = await jarState();
  check(`${id}: "Turn right" turns it 45 deg`, Math.abs(a1.angle - a0.angle - 45) < 3, `${(a1.angle - a0.angle).toFixed(1)} deg`);
  const lift = '#project-detail .pd-act[data-act="lift"]';
  const liftState = () => page.$eval(lift, (b) => ({ pressed: b.getAttribute('aria-pressed'), kept: document.activeElement === b }));
  await page.focus(lift);
  await page.keyboard.press('Enter');
  const lUp = await jarUntil('lift', '>', 0.97, 4000);
  const l1 = await liftState();
  await page.keyboard.press('Enter');
  const lDown = await jarUntil('lift', '<', 0.02, 4000);
  const l2 = await liftState();
  check(`${id}: "Lift the glass" lifts it and sets it down, pressed while up`, lUp && lDown && l1.pressed === 'true' && l2.pressed === 'false', `${l1.pressed} then ${l2.pressed}`);
  check(`${id}: the button keeps the keyboard's focus`, l1.kept && l2.kept);

  // A chapter with a closer view of its own (Mission Builder's Dust): with
  // the glass on it keeps to the usual one (close up, the glass smears); the
  // glass lifted, it comes in once the glass is clear of the way in; set
  // down, it backs out before the glass comes down.
  const near = p.piece.chapters.find((c) => c.view);
  if (near) {
    const zoom = () => page.evaluate((s) => [...window.__three.slots].find((x) => x.media === document.querySelector(s))?.rig?.shot?.zoom ?? null, JAR);
    await page.click(`#project-detail .pd-chapter[data-chapter="${near.id}"]`);
    const on = await jarUntil('focus', '===', near.id, 3000);
    const z0 = await zoom();
    await page.click(lift);
    const zEarly = await zoom();
    const clear = await jarUntil('lift', '>', 0.999, 4000);
    await page.waitForTimeout(100);
    const z1 = await zoom();
    await page.click(lift);
    const z2 = await zoom();
    const high = (await jarState()).lift;
    const down = await jarUntil('lift', '<', 0.001, 4000);
    check(
      `${id}: lifted, its ${near.title} chapter comes in closer once the glass is clear, and backs out before it comes down`,
      on && clear && down && z0 !== near.view.zoom && zEarly === z0 && z1 === near.view.zoom && z2 === z0 && high > 0.8,
      `zoom ${z0}, ${zEarly} as it lifts, ${z1} lifted, ${z2} with the glass still ${high.toFixed(2)} up`
    );
    await page.click(`#project-detail .pd-chapter[data-chapter="${p.piece.chapters[0].id}"]`);
    await jarUntil('focus', '===', null, 3000);
  }

  const small = await page.$$eval('#project-detail .pd-chapter, #project-detail .pd-tool, #project-detail .pd-act, #project-detail .pd-hold', (bs) =>
    bs.filter((x) => x.offsetParent && (x.offsetWidth < 44 || x.offsetHeight < 44)).map((x) => x.dataset.chapter ?? x.dataset.tool ?? x.dataset.act ?? x.className)
  );
  check(`${id}: its controls are at least 44 px`, small.length === 0, small.join(', '));
  const unnamed = await page.$$eval('#project-detail .pd-explorer button', (bs) => bs.filter((x) => !(x.getAttribute('aria-label') || x.textContent.trim())).length);
  check(`${id}: its controls are named`, unnamed === 0);
  const jar = await page.$eval(JAR, (m) => ({
    role: m.getAttribute('role'),
    label: m.getAttribute('aria-label') ?? '',
    tab: m.tabIndex,
    hidden: ['canvas.media-3d', '.piece-spots', '.piece-hint'].every((q) => m.querySelector(q)?.getAttribute('aria-hidden') === 'true'),
  }));
  check(`${id}: the jar is a named group the keyboard reaches`, jar.role === 'group' && /arrow keys/.test(jar.label) && jar.tab === 0 && jar.hidden, jar.label);
}

/** Open a piece's case study from its label; with `full`, every check on its jar. */
async function liveJar(id, full) {
  const p = projects.find((x) => x.id === id);
  const link = `#work-shelf .piece:has(.media[data-id="${id}"]) .plate-title a`;
  await scrollTo(link, -300);
  const l = await target(link);
  await page.mouse.click(l.x, l.y);
  const live = await page
    .waitForFunction((s) => document.querySelector(s)?.dataset['3d'] === 'live', JAR, { timeout: 90000 })
    .then(() => true)
    .catch(() => false);
  if (full) check(`${id}: its case study's jar goes live`, live);
  if (live && full) await jarChecks(id, p);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.body.classList.contains('detail-open'), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(600);
  if (full) {
    check(`${id}: Escape closes it`, await page.evaluate(() => !document.body.classList.contains('detail-open')));
    check(`${id}: its case slot is released`, await page.evaluate(() => ![...window.__three.slots].some((s) => s.opts.context === 'case')));
  }
}

/**
 * The engine's counts once the page's own dioramas near where it is have all
 * come (by the shelf, the stages above it go live a moment after the page
 * gets there): the same slots for 1.5 s.
 */
async function quietSlots() {
  const key = () => page.evaluate(() => [...window.__three.slots].map((s) => `${s.opts.context}:${s.media?.dataset?.id}`).join());
  let last = await key();
  let since = Date.now();
  for (const end = Date.now() + 15000; Date.now() < end && Date.now() - since < 1500; ) {
    await page.waitForTimeout(250);
    const k = await key();
    if (k !== last) {
      last = k;
      since = Date.now();
    }
  }
  return page.evaluate(() => window.__three.info());
}

async function liveJars() {
  if (!liveIds.length) {
    check('live jars: none built yet', true, 'skipped');
    return;
  }
  await page.mouse.move(2, 450);
  // Each one twice: every check the first time, then what closing leaves behind.
  for (const id of liveIds) await liveJar(id, true);
  // Counted from where the next round opens each one, once the page's own
  // dioramas near there have come: a stage that goes live as the page passes
  // it is the page's, not something a jar left behind.
  for (const id of liveIds) {
    await scrollTo(`#work-shelf .piece:has(.media[data-id="${id}"]) .plate-title a`, -300);
    await quietSlots();
  }
  const warm = await quietSlots();
  for (const id of liveIds) await liveJar(id, false);
  const after = await quietSlots();
  for (const k of ['geometries', 'textures', 'programs', 'slots']) {
    check(`live jars: opening them again leaves no ${k} behind`, after[k] <= warm[k], `${warm[k]} -> ${after[k]}`);
  }
  await reducedChecks(liveIds[0]);
}

/** Reduced motion: a live jar's case study keeps its poster (no 3D, no loop). */
async function reducedChecks(id) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const pg = await ctx.newPage();
  const errs = watchConsole(pg);
  // No ?3d=force: the gate decides as it would for this visitor.
  await pg.goto(`${opts.url}/#/project/${id}`);
  await pg.waitForFunction(() => document.body.classList.contains('detail-open'), null, { timeout: 15000 }).catch(() => {});
  await pg.waitForTimeout(3000);
  const st = await pg.evaluate((s) => {
    const m = document.querySelector(s);
    const v = m?.querySelector('video');
    return {
      open: !!m,
      canvas: !!m?.querySelector('canvas.media-3d'),
      offer: !!m?.querySelector('.media-3d-play'),
      playing: !!v && !v.paused,
      pause: !(document.querySelector('#project-detail .pd-hold')?.hidden ?? true),
    };
  }, JAR);
  check(
    `reduced motion: ${id}'s case study keeps its poster`,
    st.open && !st.canvas && !st.offer && !st.playing && !st.pause,
    Object.entries(st)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(', ')
  );
  check('reduced motion: no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- 7. the phone
await phoneChecks();
await finish();

async function phoneChecks() {
  // A computer first: the folds are open there, and their summaries hidden.
  const desk = await page.$$eval('details[data-fold]', (ds) => ds.map((d) => d.open && getComputedStyle(d.querySelector('summary')).display === 'none'));
  check('computer: every fold is open, with no summary', desk.length >= 5 && desk.every(Boolean), `${desk.filter(Boolean).length} of ${desk.length}`);

  const phoneCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  });
  const ph = await phoneCtx.newPage();
  const phoneErrors = watchConsole(ph);
  // No ?3d=force: the gate decides as it would on a phone.
  await ph.goto(`${opts.url}/`);
  await ph.waitForLoadState('load');
  await ph.waitForFunction(() => window.__portfolio?.lenis, null, { timeout: 15000 });
  await ph.waitForTimeout(1500);
  const go = (sel, offset = -120) =>
    ph.evaluate(
      async ([s, o]) => {
        window.__portfolio.lenis.scrollTo(document.querySelector(s), { immediate: true, offset: o, force: true });
        await new Promise((r) => setTimeout(r, 500));
      },
      [sel, offset]
    );

  const size = await ph.evaluate(() => ({ h: document.documentElement.scrollHeight, hero: document.querySelector('#hero').offsetHeight / innerHeight }));
  check('phone: the page is under 13,000 px', size.h < 13000, `${size.h} px, ${(size.h / 844).toFixed(1)} screens`);
  check('phone: the hero runs at most 2.6 screens', size.hero <= 2.6, `${size.hero.toFixed(2)} screens`);

  const stages = await ph.$$eval('#work-stages .stage', (ss) =>
    ss.map((s) => {
      const shown = (sel) => [...s.querySelectorAll(sel)].filter((e) => e.offsetParent !== null);
      const m = shown('.metric').map((e) => e.getBoundingClientRect().top);
      return { id: s.dataset.id, meta: shown('.proj-meta > *').map((e) => e.textContent.trim()), figures: m.length, row: m.length === 2 && Math.abs(m[0] - m[1]) < 2, tour: shown('.tour').length };
    })
  );
  check('phone: each stage shows number and year, then two figures side by side', stages.length > 0 && stages.every((s) => s.meta.length === 2 && s.figures === 2 && s.row), stages.map((s) => `${s.id}: ${s.meta.join(' ')}, ${s.figures} figures`).join('; '));
  check('phone: no tour steps before a diorama runs', stages.every((s) => s.tour === 0));
  const first = stages[0]?.id;
  if (first && (await ph.$(`#work-stages .stage[data-id="${first}"] .media-3d-play`))) {
    await go(`#work-stages .stage[data-id="${first}"]`, -100);
    await ph.tap(`#work-stages .stage[data-id="${first}"] .media-3d-play`);
    await ph.waitForFunction((id) => document.querySelector(`#work-stages .stage[data-id="${id}"] .tour.is-live`)?.offsetParent, first, { timeout: 30000 }).catch(() => {});
    const live = await ph.$eval(`#work-stages .stage[data-id="${first}"] .tour`, (t) => t.classList.contains('is-live') && t.offsetParent !== null).catch(() => false);
    check(`phone: ${first}'s tour steps appear once its diorama runs`, live);
  }

  await go('#work-shelf', -260);
  const rail = await ph.$eval('#work-shelf', (r) => ({ snap: getComputedStyle(r).scrollSnapType, over: r.scrollWidth > r.clientWidth + 10, tiles: r.querySelectorAll('.piece').length }));
  check('phone: the collection is one row that snaps', rail.over && /x/.test(rail.snap) && /mandatory/.test(rail.snap), `${rail.tiles} pieces, snap ${rail.snap}`);
  const cdp = await phoneCtx.newCDPSession(ph);
  // From near the right edge, leftwards, the way a thumb swipes (and never off the screen).
  const at = await ph.$eval('#work-shelf .piece .media', (m) => { const b = m.getBoundingClientRect(); return { x: Math.round(innerWidth - 40), y: Math.round(b.top + b.height / 2) }; });
  const y0 = await ph.evaluate(() => scrollY);
  const pos = () => ph.$eval('#work-shelf', (r) => ({ left: r.scrollLeft, max: r.scrollWidth - r.clientWidth }));
  // A real touch drag, point by point (Input.synthesizeScrollGesture moves
  // nothing in headless Chromium). The finger rests a moment before it
  // lifts: a synthetic lift straight off the last move can leave headless
  // Chromium's scroll unfinished, so it never snaps (a programmatic scroll
  // snaps fine, and so does this).
  const swipe = async (dx) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y, id: 1 }] });
    for (let k = 1; k <= 12; k++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: at.x + (dx * k) / 12, y: at.y, id: 1 }] });
      await ph.waitForTimeout(16);
    }
    await ph.waitForTimeout(120);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await ph.waitForTimeout(900);
  };
  let swipes = 0;
  let snapped = null;
  for (; swipes < 14 && (await pos()).left < (await pos()).max - 2; swipes++) {
    await swipe(-240);
    snapped ??= await ph.$eval('#work-shelf', (r) => {
      // After the first swipe a piece's left edge sits on the row's gutter.
      const edge = r.getBoundingClientRect().left + parseFloat(getComputedStyle(r).scrollPaddingLeft);
      return Math.min(...[...r.querySelectorAll('.piece')].map((p) => Math.abs(p.getBoundingClientRect().left - edge)));
    });
  }
  const end = await ph.$eval('#work-shelf .piece:last-child', (p) => { const b = p.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth + 1; });
  check('phone: a swipe moves the row and comes to rest on a piece', snapped != null && snapped < 2, `off by ${snapped?.toFixed(1)} px`);
  check(`phone: swiping reaches the last of the ${rail.tiles} pieces`, end, `${swipes} swipes`);
  check('phone: swiping the row leaves the page where it was', Math.abs((await ph.evaluate(() => scrollY)) - y0) < 2);
  const lastId = await ph.$eval('#work-shelf .piece:last-child', (p) => p.dataset.id);
  // A tap on the picture (force: the title's link covers the whole piece, which is the point).
  await ph.tap('#work-shelf .piece:last-child .media', { force: true });
  const opened = await ph.waitForFunction(() => document.body.classList.contains('detail-open'), null, { timeout: 8000 }).then(() => true).catch(() => false);
  check(`phone: tapping the last piece opens ${lastId}`, opened && (await ph.evaluate(() => location.hash)) === `#/project/${lastId}`);
  await ph.keyboard.press('Escape');
  await ph.waitForFunction(() => !document.body.classList.contains('detail-open'), null, { timeout: 5000 }).catch(() => {});
  await ph.waitForTimeout(700);

  // A live jar on a phone: its case study offers "Turn it in 3D"; once it
  // runs, a sideways thumb turns it and an upright one still scrolls the page.
  const jarId = liveIds[0];
  if (jarId) {
    const touch = async (x, y, dx, dy) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      for (let k = 1; k <= 12; k++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * k) / 12, y: y + (dy * k) / 12, id: 1 }] });
        await ph.waitForTimeout(16);
      }
      await ph.waitForTimeout(120);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await ph.waitForTimeout(700);
    };
    await ph.evaluate((pid) => {
      location.hash = `#/project/${pid}`;
    }, jarId);
    await ph.waitForFunction(() => document.body.classList.contains('detail-open'), null, { timeout: 8000 }).catch(() => {});
    const play = `${JAR} .media-3d-play`;
    const offer = await ph
      .waitForSelector(play, { timeout: 8000 })
      .then(() => ph.$eval(play, (b) => ({ text: b.textContent.trim(), w: b.offsetWidth, h: b.offsetHeight })))
      .catch(() => null);
    check(`phone: ${jarId}'s case study offers "Turn it in 3D"`, !!offer && offer.text === 'Turn it in 3D' && offer.h >= 44, offer ? `${offer.text}, ${offer.w}x${offer.h}` : 'none');
    if (offer) {
      await ph.tap(play);
      const went = await ph
        .waitForFunction((s) => document.querySelector(s)?.dataset['3d'] === 'live', JAR, { timeout: 90000 })
        .then(() => true)
        .catch(() => false);
      check(`phone: a tap makes ${jarId}'s jar live`, went);
      if (went) {
        await ph.waitForTimeout(1500);
        const angle = () =>
          ph.evaluate((s) => {
            const m = document.querySelector(s);
            return [...window.__three.slots].find((x) => x.media === m)?.controller?.state?.().angle ?? null;
          }, JAR);
        const box = await ph.$eval(`${JAR} canvas.media-3d`, (c) => {
          const r = c.getBoundingClientRect();
          return { x: r.left, y: r.top, w: r.width, h: r.height };
        });
        const a0 = await angle();
        await touch(Math.round(box.x + box.w * 0.3), Math.round(box.y + box.h * 0.6), Math.round(box.w * 0.4), 0);
        const a1 = await angle();
        check('phone: a sideways thumb turns the jar', a1 - a0 > 45, `${(a1 - a0).toFixed(0)} deg`);
        // A tap lifts the glass right off; a tap on a part opens it; the pill sets the glass back.
        const dome = await onDome(ph);
        check('phone: the glass can be tapped', !!dome);
        if (dome) {
          await ph.touchscreen.tap(dome.x, dome.y);
          const off = (await jarUntil('lift', '>', 0.999, 4000, ph)) && (await jarUntil('glassSeen', '===', false, 1000, ph));
          check('phone: a tap lifts the glass right off', off);
          await ph.waitForTimeout(600);
          const parts = await partPixels(ph);
          const pid = Object.keys(parts)[0];
          check('phone: the parts can be tapped with the glass off', !!pid, Object.keys(parts).join(', '));
          if (pid) {
            await ph.touchscreen.tap(parts[pid].x, parts[pid].y);
            check(`phone: a tap on a part opens it (${pid})`, await jarUntil('focus', '===', pid, 3000, ph));
          }
          await ph.tap(`${JAR} .piece-back`);
          check('phone: "Put the glass back" sets it down', await jarUntil('lift', '<', 0.001, 4000, ph));
          await ph.waitForTimeout(400);
        }
        const y0 = await ph.evaluate(() => scrollY);
        await touch(Math.round(box.x + box.w * 0.5), Math.round(box.y + box.h * 0.75), 0, -220);
        const y1 = await ph.evaluate(() => scrollY);
        check('phone: an upright thumb on the jar scrolls the page', y1 - y0 > 60, `${Math.round(y1 - y0)} px`);
      }
    }
    await ph.keyboard.press('Escape');
    await ph.waitForFunction(() => !document.body.classList.contains('detail-open'), null, { timeout: 5000 }).catch(() => {});
    await ph.waitForTimeout(700);
  }

  const folds = await ph.$$eval('details[data-fold]', (ds) => ds.map((d) => !d.open && getComputedStyle(d.querySelector('summary')).display !== 'none'));
  check('phone: Experience and the form start folded, each behind its summary', folds.length >= 5 && folds.every(Boolean), `${folds.filter(Boolean).length} of ${folds.length}`);
  await go('#experience .tl-fold', -300);
  await ph.tap('#experience .tl-fold > summary');
  await ph.waitForTimeout(900);
  const unfolded = await ph.$eval('#experience .tl-fold', (d) => d.open && [...d.querySelectorAll('.tl-point')].every((p) => p.offsetHeight > 0 && getComputedStyle(p).opacity === '1'));
  check('phone: a tap opens a fold and shows all its points', unfolded);
  await ph.tap('#experience .tl-fold > summary');
  await ph.waitForTimeout(300);
  check('phone: a second tap folds it again', await ph.$eval('#experience .tl-fold', (d) => !d.open));
  await go('#contact .form-fold', -400);
  await ph.tap('#contact .form-fold > summary');
  await ph.waitForTimeout(400);
  check('phone: "Write a message here" opens the form', await ph.$eval('#contact-form', (f) => f.offsetHeight > 200));

  const blurred = await ph.$$eval('.reveal', (els) => els.filter((e) => getComputedStyle(e).filter !== 'none').length);
  check('phone: no reveal animates a blur', blurred === 0, `${blurred} blurred`);
  const lede = await ph.$eval('#skills .section-lede', (p) => p.innerText);
  check('phone: the toolkit says tap, not hover', /Tap one/.test(lede) && !/Hover/.test(lede), lede);

  // Every control a thumb can reach is a 44 px target: its own box, or the
  // ::before that grows it (probed 21 px above and below its centre).
  const small = await ph.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('main a, main button, main summary, main input, main textarea, footer a, #navbar a, #navbar button')) {
      if (el.closest('.tool-where, [aria-hidden="true"], [hidden], #project-detail')) continue; // links inside a sentence, or not shown
      const fold = el.closest('details');
      if (fold && !fold.open && !el.closest('summary')) continue; // folded away
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || (el.offsetParent === null && st.position !== 'fixed')) continue;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      if (r.width <= 2 || r.height <= 2 || r.height >= 44) continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const hits = (y) => {
        const h = document.elementFromPoint(cx, y);
        return !!h && (h === el || el.contains(h));
      };
      if (hits(cy - 21) && hits(cy + 21)) continue;
      out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent).trim().replace(/\s+/g, ' ').slice(0, 28)}" ${Math.round(r.height)} px`);
    }
    scrollTo(0, 0);
    return out;
  });
  check('phone: every control is a 44 px target', small.length === 0, small.slice(0, 6).join(', '));

  check('phone: no console errors', phoneErrors.length === 0, phoneErrors.slice(0, 5).join(' | '));
  await phoneCtx.close();
}

async function finish() {
  check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
