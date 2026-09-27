/**
 * Who gets a diorama, and what it costs everyone else:
 *
 *   node scripts/qa/gate.mjs [--url http://localhost:3000] [--no-build]
 *
 *  1. reduced motion, Save-Data and no WebGL2: the whole page scrolled and a
 *     case study opened, with zero requests for /3d/ assets or three.js
 *  2. a phone (390 px, touch): nothing 3D loads until "Play in 3D" is tapped,
 *     the button is at least 44 px, and a tap brings the diorama live
 *  3. the production bundle: three.js is never in the entry chunk, and the
 *     entry stays within its gzip budget
 */
import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { OUT, ROOT, args, launch, watchConsole } from './lib.mjs';

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
  return /\/3d\/|[/.]three[./@-]|\/src\/three\/|\/assets\/(three|slot|base|floor|kit|util|cctv|staff|spread|director|retail|constructsafe|finmind|kps-cleano|courier|attendance|indoor-tracking|observex|adraf|airdraw|_calibration)[-.]/.test(path);
};

const { browser } = await launch();

/** Scroll the whole page slowly (so every observer fires), then open the flagship's case study. */
async function tour(page) {
  await page.waitForFunction(() => window.__portfolio, null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 500) {
    // Reduced motion has no Lenis: the page scrolls natively.
    await page.evaluate((y) => {
      const l = window.__portfolio.lenis;
      l ? l.scrollTo(y, { immediate: true, force: true }) : scrollTo(0, y);
    }, y);
    await page.waitForTimeout(120);
  }
  await page.goto(`${opts.url}/#/project/retail-analytics`);
  await page.waitForTimeout(2500);
}

async function stillsOnly(name, setup) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(setup.context ?? {}) });
  if (setup.init) await context.addInitScript(setup.init);
  const page = await context.newPage();
  const errors = watchConsole(page);
  const hits = [];
  page.on('request', (r) => is3d(r.url()) && hits.push(new URL(r.url()).pathname));
  await page.goto(opts.url);
  await tour(page);
  const plays = await page.$$eval('.media-3d-play', (b) => b.length);
  check(`${name}: no 3D requested`, hits.length === 0 && plays === 0, hits.slice(0, 3).join(', ') || `${plays} play buttons`);
  const stills = await page.$$eval('#main-content .media img, #project-detail .media img', (is) => is.filter((i) => i.complete && i.naturalWidth > 0).length);
  check(`${name}: posters shown instead`, stills > 0, `${stills} stills`);
  check(`${name}: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

// ---------------------------------------------------------------- 1. stills only
await stillsOnly('reduced motion', { context: { reducedMotion: 'reduce' } });
await stillsOnly('Save-Data', {
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
  page.on('request', (r) => is3d(r.url()) && hits.push(new URL(r.url()).pathname));
  await page.goto(opts.url);
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
  check('phone: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}
await browser.close();

// ---------------------------------------------------------------- 3. bundle
if (!opts['no-build']) {
  const dist = join(OUT, 'dist');
  const b = spawnSync('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir'], { cwd: ROOT, shell: true, encoding: 'utf8' });
  check('production build succeeds', b.status === 0, b.status ? b.stderr.slice(-400) : '');
  if (b.status === 0) {
    const html = await readFile(join(dist, 'index.html'), 'utf8');
    const entry = html.match(/<script type="module"[^>]*src="\/?([^"]+)"/)?.[1];
    const code = entry ? await readFile(join(dist, entry)) : Buffer.alloc(0);
    const text = code.toString('utf8');
    const kb = gzipSync(code, { level: 9 }).length / 1024;
    check('three.js is not in the entry chunk', !!entry && !/WebGLRenderer|ShaderMaterial|THREE\./.test(text), entry ?? 'no entry');
    check(`entry chunk within ${ENTRY_GZIP_KB} KB gzip`, kb <= ENTRY_GZIP_KB, `${kb.toFixed(1)} KB`);
    const preloads = [...html.matchAll(/modulepreload"[^>]*href="\/?([^"]+)"/g)].map((m) => m[1]);
    const threePre = [];
    for (const p of preloads) if (/WebGLRenderer/.test(await readFile(join(dist, p), 'utf8'))) threePre.push(p);
    check('three.js is not preloaded by the page', threePre.length === 0, threePre.join(', '));
    const chunks = (await readdir(join(dist, 'assets'))).filter((f) => f.endsWith('.js'));
    console.log(`     ${chunks.length} chunks; entry ${entry}`);
  }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
