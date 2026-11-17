/**
 * Who gets a diorama or a moving piece, and what it costs everyone else:
 *
 *   node scripts/qa/gate.mjs [--url http://localhost:3000] [--no-build]
 *
 *  1. reduced motion, Save-Data and no WebGL2: the whole page scrolled, every
 *     piece on the shelf hovered, and a case study of each diorama and of a
 *     piece opened, with zero requests for /3d/ assets or three.js; under
 *     reduced motion and Save-Data, zero requests for a piece's loop too
 *  2. a phone (390 px, touch): nothing 3D loads until "Play in 3D" is tapped,
 *     the button is at least 44 px, and a tap brings the diorama live; the
 *     shelf shows posters only, and a piece's loop plays in its case study
 *  3. the production bundle: three.js is never in the entry or anything it
 *     imports up front, and those together stay within the gzip budget
 */
import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { projects } from '../../src/data/projects.js';
import { OUT, ROOT, SOFTWARE_GL, args, launch, watchConsole } from './lib.mjs';

const opts = args();
const ENTRY_GZIP_KB = 90;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`);
};

// What a diorama costs: its scene files and the three.js code. Not the gate
// (part of the entry by design) and not the posters, the stills everyone gets.
const is3d = (u) => {
  const path = new URL(u).pathname;
  if (/\/src\/three\/gate\.js$|\/poster[^/]*\.webp$/.test(path)) return false;
  // (Built, each scene's controller is a chunk named after it, with the shared kit's.)
  return /\/3d\/|[/.]three[./@-]|\/src\/three\/|\/assets\/(three|slot|base|floor|kit|util|cctv|staff|spread|director|alerts|living|party|retail|constructsafe|finmind|kps-cleano|courier|attendance|indoor-tracking|observex|adraf|airdraw|_calibration)[-.]/.test(path);
};
// What a moving piece costs: its loop (the poster is the still everyone gets).
const isLoop = (u) => /\/pieces\/[^/]+\/loop-/.test(new URL(u).pathname);

const pieces = JSON.parse(await readFile(join(ROOT, 'src', 'data', 'pieces.json'), 'utf8'));
const dioramaIds = projects.filter((p) => p.scene3d).map((p) => p.id);
const loopIds = projects.filter((p) => pieces[p.piece?.id]?.loop).map((p) => p.id);

const { browser } = await launch();

/** Scroll an element into view, with Lenis when it runs (reduced motion has none). */
const bringIn = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    const l = window.__portfolio.lenis;
    if (l) l.scrollTo(el, { immediate: true, force: true, offset: -200 });
    else el.scrollIntoView({ block: 'center' });
  }, sel);

/**
 * Scroll the whole page slowly (so every observer fires), rest the pointer on
 * every piece, then open each diorama's case study and one piece's.
 */
async function tour(page) {
  await page.waitForFunction(() => window.__portfolio, null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 500) {
    await page.evaluate((y) => {
      const l = window.__portfolio.lenis;
      l ? l.scrollTo(y, { immediate: true, force: true }) : scrollTo(0, y);
    }, y);
    await page.waitForTimeout(120);
  }
  const tiles = await page.$$eval('#work-shelf .media[data-id]', (ms) => ms.map((m) => m.dataset.id));
  for (const id of tiles) {
    const sel = `#work-shelf .media[data-id="${id}"]`;
    await bringIn(page, sel);
    await page.waitForTimeout(100);
    const r = await page.$eval(sel, (e) => {
      const b = e.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    await page.mouse.move(r.x, r.y);
    await page.waitForTimeout(500);
  }
  await page.mouse.move(2, 2);
  for (const id of [...dioramaIds, ...loopIds.slice(0, 1)]) {
    await page.evaluate((pid) => (location.hash = `#/project/${pid}`), id);
    await page.waitForTimeout(2500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }
}

async function stillsOnly(name, setup) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(setup.context ?? {}) });
  if (setup.init) await context.addInitScript(setup.init);
  const page = await context.newPage();
  const errors = watchConsole(page);
  const hits = [];
  const loops = [];
  page.on('request', (r) => {
    if (is3d(r.url())) hits.push(new URL(r.url()).pathname);
    if (isLoop(r.url())) loops.push(new URL(r.url()).pathname);
  });
  await page.goto(opts.url);
  await tour(page);
  const plays = await page.$$eval('.media-3d-play', (b) => b.length);
  check(`${name}: no 3D requested`, hits.length === 0 && plays === 0, hits.slice(0, 3).join(', ') || `${plays} play buttons`);
  if (setup.noLoops) check(`${name}: no piece's loop requested`, loops.length === 0, loops.slice(0, 3).join(', '));
  const stills = await page.$$eval('#main-content .media img, #project-detail .media img', (is) => is.filter((i) => i.complete && i.naturalWidth > 0).length);
  check(`${name}: posters shown instead`, stills > 0, `${stills} stills`);
  check(`${name}: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

// ---------------------------------------------------------------- 1. stills only
await stillsOnly('reduced motion', { context: { reducedMotion: 'reduce' }, noLoops: true });
await stillsOnly('Save-Data', {
  noLoops: true,
  init: () => Object.defineProperty(navigator, 'connection', { value: { saveData: true, effectiveType: '4g', addEventListener() {} }, configurable: true }),
});
await stillsOnly('no WebGL2', {
  init: () => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      return type === 'webgl2' ? null : get.call(this, type, ...rest);
    };
  },
});

// ---------------------------------------------------------------- 2. phone: tap to load
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = watchConsole(page);
  const hits = [];
  const loops = [];
  page.on('request', (r) => {
    if (is3d(r.url())) hits.push(new URL(r.url()).pathname);
    if (isLoop(r.url())) loops.push(new URL(r.url()).pathname);
  });
  // (Off Windows, ?swgl lets the software renderer through the performance
  // caveat once tapped; it changes nothing about the gate itself.)
  await page.goto(`${opts.url}/${SOFTWARE_GL ? '?swgl' : ''}`);
  await page.waitForFunction(() => window.__portfolio, null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  const play = '.flagship .media-3d-play';
  await page.$eval('.flagship .media', (m) => m.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(1500);
  check('phone: nothing 3D before a tap', hits.length === 0, hits.slice(0, 3).join(', '));
  const size = await page.$eval(play, (b) => [b.offsetWidth, b.offsetHeight]).catch(() => null);
  check('phone: "Play in 3D" is offered', !!size);
  check('phone: the button is at least 44 px', !!size && size[0] >= 44 && size[1] >= 44, size ? `${size[0]} x ${size[1]}` : '');
  if (size) {
    await page.tap(play);
    const live = await page
      .waitForFunction(() => ['live', 'paused'].includes(document.querySelector('.flagship .media')?.dataset['3d']), null, { timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    check('phone: a tap brings the diorama live', live, `${hits.length} requests after the tap`);
    await page.screenshot({ path: join(OUT, 'gate-phone-live.png') });
  }

  // The shelf, scrolled through: posters only.
  for (const sel of await page.$$eval('#work-shelf .media[data-id]', (ms) => ms.map((m) => `#work-shelf .media[data-id="${m.dataset.id}"]`))) {
    await page.$eval(sel, (m) => m.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(150);
  }
  check('phone: the shelf shows posters only', loops.length === 0, loops.slice(0, 3).join(', '));
  if (loopIds.length) {
    const id = loopIds[0];
    await page.tap(`#work-shelf .piece:has(.media[data-id="${id}"]) .plate-title a`);
    const plays = await page
      .waitForFunction(() => document.querySelector('#project-detail .pd-piece .media')?.classList.contains('is-playing'), null, { timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    const hold = await page.$eval('#project-detail .pd-hold', (b) => (b.hidden ? null : [b.offsetWidth, b.offsetHeight])).catch(() => null);
    check(`phone: ${id}'s case study plays its loop, with Pause`, plays && loops.some((u) => u.includes('/loop-720.')) && !!hold && hold[0] >= 44 && hold[1] >= 44, `${[...new Set(loops)].join(', ')}; pause ${hold ? hold.join(' x ') : 'none'}`);
  }
  check('phone: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}
await browser.close();

// ---------------------------------------------------------------- 3. bundle
if (!opts['no-build']) {
  const dist = join(OUT, 'dist');
  // Vite's own CLI run by node: no shell, so nothing to quote (and no DEP0190).
  const vite = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const b = spawnSync(process.execPath, [vite, 'build', '--outDir', dist, '--emptyOutDir', '--manifest'], { cwd: ROOT, encoding: 'utf8' });
  check('production build succeeds', b.status === 0, b.status ? b.stderr.slice(-400) : '');
  if (b.status === 0) {
    // The page's entry and every chunk it imports up front: what a visitor
    // downloads before anything runs. (A second page shares chunks with it, so
    // the entry file alone would undercount.)
    const manifest = JSON.parse(await readFile(join(dist, '.vite', 'manifest.json'), 'utf8'));
    const entry = Object.keys(manifest).find((k) => manifest[k].isEntry && k === 'index.html');
    const upFront = [];
    const walk = (k) => {
      const c = manifest[k];
      if (!c || upFront.includes(c.file)) return;
      upFront.push(c.file);
      for (const i of c.imports ?? []) walk(i);
    };
    if (entry) walk(entry);
    let kb = 0;
    const heavy = [];
    for (const f of upFront) {
      const code = await readFile(join(dist, f));
      kb += gzipSync(code, { level: 9 }).length / 1024;
      if (/WebGLRenderer|ShaderMaterial|THREE\./.test(code.toString('utf8'))) heavy.push(f);
    }
    check('three.js is not in the entry or its static imports', !!entry && heavy.length === 0, heavy.join(', ') || upFront.join(', '));
    check(`entry and its static imports within ${ENTRY_GZIP_KB} KB gzip`, !!entry && kb <= ENTRY_GZIP_KB, `${kb.toFixed(1)} KB in ${upFront.length} file${upFront.length > 1 ? 's' : ''}`);
    const html = await readFile(join(dist, 'index.html'), 'utf8');
    const preloads = [...html.matchAll(/modulepreload"[^>]*href="\/?([^"]+)"/g)].map((m) => m[1]);
    const threePre = [];
    for (const p of preloads) if (/WebGLRenderer/.test(await readFile(join(dist, p), 'utf8'))) threePre.push(p);
    check('three.js is not preloaded by the page', threePre.length === 0, threePre.join(', '));
    const chunks = (await readdir(join(dist, 'assets'))).filter((f) => f.endsWith('.js'));
    console.log(`     ${chunks.length} chunks; entry ${upFront[0] ?? 'none'}`);
  }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
