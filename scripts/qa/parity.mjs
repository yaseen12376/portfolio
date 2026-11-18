/**
 * Cycles vs WebGL: does the live scene look like the poster it replaces?
 *
 *   node scripts/qa/parity.mjs [ids...] [--url http://localhost:3000] [--max 10] [--jar-max 16] [--tone 3]
 *
 * For each diorama, the bench draws the t = 0 frame at 1920 x 1080 through
 * the posters' camera, twice:
 *   - with the miniature post, against poster.webp (what a visitor sees swap)
 *   - without it, against the raw Cycles still (lighting and colour alone)
 * For each live jar, its case study at 1440 x 900 (pixel ratio 2), the jar
 * held at the loop's first frame, against poster-1080.webp: that same frame,
 * and what the canvas fades in over.
 * Ids name either; with none, every diorama and every live jar.
 * Writes build/qa/parity/<id>.png boards (Cycles | WebGL | difference) and
 * fails on either of two measures, both CIE76 on the subject's own pixels:
 *   tone   the difference between the two frames' mean colours: what a
 *          visitor sees when the live scene fades in over the poster
 *          (--tone, default 3; below about 2 is invisible side by side)
 *   pixels the mean per-pixel difference: structure (--max, default 10). The
 *          figures are lit live and the poster path-traces them, so a busy
 *          scene never reaches the empty calibration room's 6; a framing,
 *          lighting or material error pushes it well past 10.
 *          A jar has its own (--jar-max, default 16): its inside is seen
 *          through glass the live frame bends by approximation, and its
 *          rims and highlights are thin bright lines, so it never lines up
 *          pixel for pixel. Mission Builder's scores 14; the same frame
 *          misframed by 1% scores 19, and without its glass 25.
 */
import { existsSync, readdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { projects } from '../../src/data/projects.js';
import { ROOT, args, bench, board, compare, ensureOut, framePNG, gpuName, jarAtPoster, launch, liveJarIds, openJar, watchConsole } from './lib.mjs';

const opts = args();
const MAX = Number(opts.max ?? 10);
const JAR_MAX = Number(opts['jar-max'] ?? 16);
const TONE = Number(opts.tone ?? 3);
const toneDE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const PUBLIC = resolve(ROOT, 'public', '3d');
const BUILD = resolve(ROOT, 'build', '3d');
const jars = liveJarIds();
// Project scenes; internal fixtures (_calibration) only when named.
const ids = opts._.length ? opts._.filter((id) => !jars.includes(id)) : readdirSync(PUBLIC).filter((d) => !d.startsWith('_') && existsSync(resolve(PUBLIC, d, 'scene.json')));
const jarIds = opts._.length ? opts._.filter((id) => jars.includes(id)) : jars;

const { browser, context } = await launch();
const page = await context.newPage();
const errors = watchConsole(page);
const out = await ensureOut('parity');
let failed = 0;

const report = (id, what, r, max = MAX) => {
  const tone = toneDE(r.labA, r.labB);
  const ok = r.deltaE <= max && tone <= TONE;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${id} vs ${what}: tone dE ${tone.toFixed(2)}, pixels dE ${r.deltaE} (Lab Cycles ${r.labA.join('/')} · WebGL ${r.labB.join('/')}, ${(r.coverage * 100).toFixed(0)}% of frame)`);
};

await page.goto(ids.length ? `${opts.url}/qa/3d.html?id=${ids[0]}&w=64&h=64&still` : 'about:blank');
console.log(`GPU: ${await gpuName(page)}`);

for (const id of ids) {
  const rows = [];
  // 1. With the miniature post, against the poster.
  await bench(page, opts.url, id, { still: true });
  const live = await framePNG(page);
  await writeFile(resolve(out, `${id}-live.png`), live);
  const poster = resolve(PUBLIC, id, 'poster.webp');
  const a = await compare(poster, live);
  rows.push(['poster', a]);
  const boards = [
    { img: poster, label: `${id} · Cycles poster` },
    { img: live, label: 'WebGL, t = 0' },
    { img: a.diff, label: `difference · mean dE ${a.deltaE}` },
  ];

  // 2. Without it, against the raw Cycles still.
  const raw = resolve(BUILD, id, 'still-16x9.png');
  if (existsSync(raw)) {
    await bench(page, opts.url, id, { still: true, nopost: true });
    const flat = await framePNG(page);
    await writeFile(resolve(out, `${id}-flat.png`), flat);
    const b = await compare(raw, flat);
    rows.push(['raw', b]);
    boards.push({ img: raw, label: 'Cycles raw' }, { img: flat, label: 'WebGL, no post' }, { img: b.diff, label: `difference · mean dE ${b.deltaE}` });
  }

  const top = await board(boards.slice(0, 3));
  const bottom = boards.length > 3 ? await board(boards.slice(3)) : null;
  const sharp = (await import('sharp')).default;
  const img = bottom
    ? await sharp(top).extend({ bottom: 406, background: '#18181b' }).composite([{ input: bottom, top: 406, left: 0 }]).png().toBuffer()
    : top;
  await writeFile(resolve(out, `${id}.png`), img);

  for (const [what, r] of rows) report(id, what, r);
}

// Each live jar, as its case study shows it, against the poster it fades in over.
for (const id of jarIds) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const jarPage = await ctx.newPage();
  const jarErrors = watchConsole(jarPage);
  await openJar(jarPage, opts.url, id);
  const live = await jarAtPoster(jarPage);
  await writeFile(resolve(out, `${id}-live.png`), live);
  const poster = resolve(ROOT, 'public', 'pieces', projects.find((p) => p.id === id).piece.id, 'poster-1080.webp');
  const r = await compare(poster, live, { w: 480, h: 480 });
  const tiles = [
    { img: poster, label: `${id} · Cycles poster` },
    { img: live, label: "WebGL, the loop's first frame" },
    { img: r.diff, label: `difference · mean dE ${r.deltaE}` },
  ];
  await writeFile(resolve(out, `${id}.png`), await board(tiles, { w: 480, h: 480 }));
  report(id, 'poster', r, JAR_MAX);
  errors.push(...jarErrors.map((e) => `${id}: ${e}`));
  await ctx.close();
}

if (errors.length) {
  console.log('\nconsole:');
  for (const e of errors) console.log('  ' + e);
}
console.log(`\nboards: ${out}`);
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
