/**
 * A contact sheet of a scene's operated shots, for review at a glance:
 *
 *   node scripts/qa/board.mjs [--project constructsafe] [--width 1440] [--cols 3] [--fresh] [--dir build/qa/film/<id>/case] [--name case]
 *
 * Takes the shots shots.mjs --operate wrote (running it first if there are
 * none, or with --fresh), or the images in --dir (film.mjs's stills, say),
 * and lays them out in a grid, captioned with each file's name. Writes
 * build/qa/board-<project>[-<name>].png.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import sharp from 'sharp';

import { OUT, ROOT, args, board } from './lib.mjs';

const opts = args();
const id = opts.project ?? 'retail-analytics';
const W = Number(opts.width ?? 1440);
const COLS = Number(opts.cols ?? 3);
const dir = opts.dir ? resolve(ROOT, opts.dir) : resolve(OUT, 'shots', `${id}-${W}-operated`);

if (!opts.dir && (opts.fresh || !existsSync(dir) || !readdirSync(dir).some((f) => f.endsWith('.png')))) {
  const r = spawnSync('node', ['scripts/qa/shots.mjs', '--project', id, '--width', String(W), '--operate', ...(opts.url ? ['--url', opts.url] : [])], { cwd: ROOT, stdio: 'inherit' });
  if (r.status) process.exit(r.status);
}
const files = readdirSync(dir).filter((f) => /\.(png|jpe?g)$/.test(f)).sort();
const rows = [];
for (let k = 0; k < files.length; k += COLS) {
  rows.push(await board(files.slice(k, k + COLS).map((f) => ({ img: resolve(dir, f), label: f.replace(/\.\w+$/, '') })), { w: 640, h: opts.dir ? 360 : 520 }));
}
const metas = await Promise.all(rows.map((r) => sharp(r).metadata()));
const width = Math.max(...metas.map((m) => m.width));
const height = metas.reduce((n, m) => n + m.height, 0);
let y = 0;
const out = resolve(OUT, `board-${id}${opts.name ? `-${opts.name}` : ''}.png`);
await sharp({ create: { width, height, channels: 3, background: '#18181b' } })
  .composite(rows.map((input, k) => ({ input, left: 0, top: (y += k ? metas[k - 1].height : 0) })))
  .png()
  .toFile(out);
console.log(`${files.length} shots: ${out}`);
