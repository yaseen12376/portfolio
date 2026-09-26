/**
 * Cycles vs WebGL: does the live diorama look like the poster it replaces?
 *
 *   node scripts/qa/parity.mjs [ids...] [--url http://localhost:3000] [--max 10] [--tone 3]
 *
 * For each scene, the bench draws the t = 0 frame at 1920 x 1080 through the
 * posters' camera, twice:
 *   - with the miniature post, against poster.webp (what a visitor sees swap)
 *   - without it, against the raw Cycles still (lighting and colour alone)
 * Writes build/qa/parity/<id>.png boards (Cycles | WebGL | difference) and
 * fails on either of two measures, both CIE76 on the diorama's own pixels:
 *   tone   the difference between the two frames' mean colours: what a
 *          visitor sees when the live scene fades in over the poster
 *          (--tone, default 3; below about 2 is invisible side by side)
 *   pixels the mean per-pixel difference: structure (--max, default 10). The
 *          figures are lit live and the poster path-traces them, so a busy
 *          scene never reaches the empty calibration room's 6; a framing,
 *          lighting or material error pushes it well past 10.
 */
import { existsSync, readdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ROOT, args, bench, board, compare, ensureOut, framePNG, gpuName, launch, watchConsole } from './lib.mjs';

const opts = args();
const MAX = Number(opts.max ?? 10);
const TONE = Number(opts.tone ?? 3);
const toneDE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const PUBLIC = resolve(ROOT, 'public', '3d');
const BUILD = resolve(ROOT, 'build', '3d');
// Project scenes; internal fixtures (_calibration) only when named.
const ids = opts._.length ? opts._ : readdirSync(PUBLIC).filter((d) => !d.startsWith('_') && existsSync(resolve(PUBLIC, d, 'scene.json')));

const { browser, context } = await launch();
const page = await context.newPage();
const errors = watchConsole(page);
const out = await ensureOut('parity');
let failed = 0;

await page.goto(`${opts.url}/qa/3d.html?id=${ids[0]}&w=64&h=64&still`);
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

  for (const [what, r] of rows) {
    const tone = toneDE(r.labA, r.labB);
    const ok = r.deltaE <= MAX && tone <= TONE;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${id} vs ${what}: tone dE ${tone.toFixed(2)}, pixels dE ${r.deltaE} (Lab Cycles ${r.labA.join('/')} · WebGL ${r.labB.join('/')}, ${(r.coverage * 100).toFixed(0)}% of frame)`);
  }
}

if (errors.length) {
  console.log('\nconsole:');
  for (const e of errors) console.log('  ' + e);
}
console.log(`\nboards: ${out}`);
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
