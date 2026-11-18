/**
 * Short screen recordings of a diorama or a live jar on the real page, for review:
 *
 *   node scripts/qa/record.mjs [--url http://localhost:3000] [--project retail-analytics]
 *
 * Writes build/qa/rec/<project>/. A diorama: 1-card-tour.webm (the card's
 * tour, as a visitor scrolling past sees it), 2-case-explorer.webm (the case
 * study, each chapter chosen and its feature operated), 3-phone.webm (390 px:
 * the tap, then the tour). A live jar, filmed frame by frame at 60 fps
 * (smooth.mjs): 1-jar.mp4 (its case study at 1440 x 1080, pixel ratio 2:
 * turning by itself, dragged round, the glass lifted off, three parts named
 * under a resting pointer, the model turned and tilted, two parts tapped,
 * the glass put back), 1-jar-closeup.mp4 (the jar alone, every pixel),
 * 2-phone.mp4 (390 x 844, pixel ratio 3: a sideways thumb, the glass lifted,
 * two parts tapped, the glass put back), and stills/. `--only computer` or
 * `--only phone` films one. Recorded on the discrete GPU.
 */
import { readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { JAR, SOFTWARE_GL, args, ensureOut, launch, liveJarIds, onJar, watchConsole } from './lib.mjs';
import { smoothFilm } from './smooth.mjs';

const opts = args();
const id = opts.project ?? 'retail-analytics';
const out = await ensureOut('rec', id);
const { browser } = await launch({ discrete: true });

async function record(name, contextOpts, run) {
  const tmp = await ensureOut('rec', id, '_tmp');
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

if (liveJarIds().includes(id)) await recordJar();
else await recordDiorama();
await browser.close();
console.log(`recordings: ${out}`);

async function recordJar() {
  const box = (page, sel = JAR) => page.$eval(sel, (m) => { const b = m.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  const live = (page, timeout = 90000) => page.waitForFunction((s) => ['live', 'paused'].includes(document.querySelector(s)?.dataset['3d']), JAR, { timeout });
  const stills = await ensureOut('rec', id, 'stills');
  /**
   * Where a part shows, as the page picks it: of its pixels (every `step`,
   * where nothing lies over the canvas), the one deepest inside it.
   */
  const partAt = (page, part, step = 4) =>
    onJar(page, (slot, [part, step]) => {
      const r = slot.canvas.getBoundingClientRect();
      const on = new Set();
      const key = (i, j) => i * 4096 + j;
      for (let j = 0, y = r.top + step / 2; y < r.bottom; j++, y += step)
        for (let i = 0, x = r.left + step / 2; x < r.right; i++, x += step) {
          if (document.elementFromPoint(x, y) !== slot.canvas) continue;
          if (slot.pick({ clientX: x, clientY: y })?.part === part) on.add(key(i, j));
        }
      let best = null;
      for (const k of on) {
        const i = Math.floor(k / 4096);
        const j = k % 4096;
        let n = 0;
        for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) n += on.has(key(i + di, j + dj)) ? 1 : 0;
        if (!best || n > best.n) best = { n, x: r.left + (i + 0.5) * step, y: r.top + (j + 0.5) * step };
      }
      return best;
    }, [part, step]);

  const only = String(opts.only ?? 'computer,phone').split(',');

  // 1. A computer: the case study, the jar live (past its takeover from the
  // loop). It turns by itself; the pointer comes to rest on it, drags it
  // round and lets go; lifts the glass; rests on three parts, each named;
  // turns and tilts the model; taps two parts (each its chapter, the camera
  // in on it); puts the glass back; and leaves it turning by itself.
  if (only.includes('computer')) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const log = watchConsole(page);
    await page.goto(`${opts.url}/?3d=force#/project/${id}`);
    await live(page);
    await pause(page, 3000);
    const b = await box(page);
    const ex = await box(page, '#project-detail .pd-explorer');
    const top = Math.floor(b.y - 16);
    const clip = { x: Math.floor(ex.x - 16), y: top, width: Math.ceil(ex.w + 32), height: Math.ceil(ex.y + ex.h + 16 - top) };
    // The jar alone, in the screenshot's own pixels (twice the page's).
    const crop = [b.x - clip.x, b.y - clip.y, b.w, b.h].map((v) => 2 * Math.round(v));
    const film = await smoothFilm(page, {
      clip,
      from: { x: clip.x + 220, y: clip.y + clip.height * 0.62 },
      outputs: [{ file: join(out, '1-jar.mp4'), width: 1920, crf: 17 }, { file: join(out, '1-jar-closeup.mp4'), crop }],
    });
    const at = (fx, fy) => [b.x + b.w * fx, b.y + b.h * fy];
    const still = (name) => film.still(join(stills, `${name}.png`), crop);
    await film.wait(1.5);
    await film.glide(...at(0.5, 0.56), 1.1);
    await film.wait(0.5);
    await film.down();
    await film.drag(250, 8, 0.55);
    await film.up();
    await film.wait(1.6);
    await film.glide(...at(0.4, 0.3), 0.6);
    await still('01-glass');
    await film.click();
    for (const [sec, n] of [[0.25, '02'], [0.3, '03'], [0.3, '04'], [0.45, '05']]) {
      await film.wait(sec);
      await still(`${n}-lifting`);
    }
    await film.glide(...at(0.1, 0.7), 0.6);
    await film.wait(0.9);
    await still('06-lifted');
    for (const part of ['checks', 'dust', 'signal']) {
      const p = await partAt(page, part);
      if (!p) continue;
      await film.glide(p.x, p.y, 0.75);
      await film.wait(0.75);
      if (part === 'dust') await still('07-hover');
    }
    await film.glide(...at(0.3, 0.64), 0.5);
    await film.down();
    await film.drag(-170, 110, 0.9);
    await film.wait(0.3);
    await still('08-tilted');
    await film.up();
    await film.wait(1.0);
    for (const [part, name] of [['signal', '09-part-dish'], ['checks', '10-part-lander']]) {
      const p = await partAt(page, part);
      if (!p) continue;
      await film.glide(p.x, p.y, 0.7);
      await film.click();
      await film.wait(2.4);
      await still(name);
    }
    const pill = await box(page, `${JAR} .piece-back`);
    await film.glide(pill.x + pill.w / 2, pill.y + pill.h / 2, 0.8);
    await film.click();
    await film.wait(0.6);
    await still('11-lowering');
    await film.glide(clip.x + 240, clip.y + clip.height * 0.6, 1.0);
    await film.wait(2.4);
    await still('12-back');
    const r = await film.end();
    console.log('1-jar.mp4, 1-jar-closeup.mp4', JSON.stringify(r), log.length ? log.join(' | ') : 'console clean');
    await context.close();
  }

  // 2. A phone: "Turn it in 3D" tapped; a sideways thumb turns it; a tap
  // lifts the glass; two parts tapped; the glass put back. The jar near the
  // top of the screen, under the menu, and its explorer's words below it.
  if (only.includes('phone')) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const log = watchConsole(page);
    await page.goto(`${opts.url}/${SOFTWARE_GL ? '?swgl' : ''}#/project/${id}`);
    await page.waitForSelector(`${JAR} .media-3d-play`, { timeout: 15000 });
    await page.$eval(JAR, (m) => m.scrollIntoView({ block: 'center' }));
    await pause(page, 1500);
    await page.screenshot({ path: join(stills, 'phone-1-button.png') });
    await page.tap(`${JAR} .media-3d-play`);
    await live(page);
    await pause(page, 1500);
    await page.evaluate((s) => {
      const y = scrollY + document.querySelector(s).getBoundingClientRect().top - 84;
      const lenis = window.__portfolio?.lenis;
      if (lenis) lenis.scrollTo(y, { immediate: true, force: true });
      else scrollTo({ top: y, behavior: 'instant' });
    }, JAR);
    await pause(page, 1500);
    const b = await box(page);
    const film = await smoothFilm(page, { clip: { x: 0, y: 0, width: 390, height: 844 }, touch: true, outputs: [{ file: join(out, '2-phone.mp4'), crf: 18 }] });
    const at = (fx, fy) => [b.x + b.w * fx, b.y + b.h * fy];
    const still = (name) => film.still(join(stills, `${name}.png`));
    await film.wait(1.2);
    film.place(...at(0.8, 0.62));
    await film.down();
    await film.drag(-210, 6, 0.4);
    await film.up();
    await film.wait(1.6);
    film.place(...at(0.45, 0.3));
    await film.click();
    await film.wait(2.4);
    await still('phone-2-lifted');
    for (const [part, name] of [['checks', 'phone-3-part'], ['dust', 'phone-4-part']]) {
      const p = await partAt(page, part);
      if (!p) continue;
      film.place(p.x, p.y);
      await film.click();
      await film.wait(2.6);
      await still(name);
    }
    const pill = await box(page, `${JAR} .piece-back`);
    film.place(pill.x + pill.w / 2, pill.y + pill.h / 2);
    await film.click();
    await film.wait(2.6);
    await still('phone-5-back');
    const r = await film.end();
    console.log('2-phone.mp4', JSON.stringify(r), log.length ? log.join(' | ') : 'console clean');
    await context.close();
  }
}

async function recordDiorama() {
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
    // (A pinned stack card that isn't the current one doesn't open on a click: go by its address.)
    if (!(await page.evaluate(() => location.hash.startsWith('#/project/')))) await page.evaluate((pid) => (location.hash = `#/project/${pid}`), id);
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
    // The scene's own walkthrough (its controller's `demo.record`).
    const steps = (await page.evaluate(() => [...window.__three.slots].find((x) => x.opts.context === 'case')?.controller?.demo?.record)) ?? [];
    for (const [what, arg, ms] of steps) {
      if (what === 'chapter') await chapter(arg, ms);
      else if (what === 'act') await act(arg, ms);
      else if (what === 'drag') {
        // A handle, by its kind, dragged by [dx, dy] px in small steps.
        const end = await page.evaluate(({ s, kind }) => {
          const slot = [...window.__three.slots].find((x) => x.opts.context === 'case');
          const h = slot.controller.pickables().find((o) => o.userData.handle?.kind === kind);
          if (!h) return null;
          const v = h.position.clone().project(slot.camera);
          const r = document.querySelector(s).getBoundingClientRect();
          return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
        }, { s: hero, kind: arg.kind });
        if (end) {
          await page.mouse.move(end.x, end.y);
          await page.mouse.down();
          for (let i = 1; i <= 12; i++) await page.mouse.move(end.x + (arg.by[0] * i) / 12, end.y + (arg.by[1] * i) / 12);
          await page.mouse.up();
        }
        await pause(page, ms);
      }
    }
  });

  // 3. A phone: the tap, then the tour.
  await record('3-phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, async (page) => {
    // (Off Windows, ?swgl lets the software renderer through the performance caveat once tapped.)
    await page.goto(`${opts.url}/${SOFTWARE_GL ? '?swgl' : ''}`);
    await page.waitForFunction(() => window.__portfolio, null, { timeout: 15000 });
    await page.$eval(card, (m) => m.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    await pause(page, 2500);
    await page.tap(`${card} .media-3d-play`);
    await pause(page, 16000);
  });
}
