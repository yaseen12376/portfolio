/**
 * Build the collection: one small model under a glass bell jar per project,
 * rendered in Blender (headless) as a turntable loop and a poster.
 *
 *   node scripts/build-pieces.mjs [ids...] [--stages sheet,still,loop,encode,live] [--force]
 *                                 [--frames 144] [--fps 24] [--chunk 48]
 *
 *   sheet   four quick views of one turn on a contact sheet, for review
 *           (build/pieces/<id>/sheet.png). Not part of a default build.
 *   still   the poster frame, clean (build/pieces/<id>/still.png)
 *   loop    the turn's frames (build/pieces/<id>/loop/). Resumable: frames on
 *           disk are kept while the piece's inputs are unchanged, and Blender
 *           is restarted every --chunk frames.
 *   encode  the page colour goes in, then VP9 + H.264 at 720 and 1080 and the
 *           WebP posters, into public/pieces/<id>/, checked against budgets.
 *   live    the jar as a live scene for its case study (turn it, lift the
 *           glass, tap its parts): Blender bakes it as the dioramas are baked
 *           (bake_scene.py --scene piece:<id>, pieces/live.py), then the GLB is
 *           optimised and the maps encoded into public/pieces/<id>/live/.
 *           Not part of a default build.
 *
 * Why the page colour goes in here and not in Blender: the frames are opaque,
 * on black. The dioramas' tone curve maps anything near black to black, so a
 * page-coloured world cannot be rendered. Taking the lighter of each pixel
 * and the page colour (#09090b) makes the background exactly the page, with no
 * alpha video and no CSS blend mode, and lets the pool of light fade into it.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import sharp from 'sharp';

import { ROOT, blender, hashFiles } from './lib/blender.mjs';
import { optimise, stats, validate } from './lib/gltf.mjs';

const PAGE = '#09090b';
const SRC = 'scripts/blender/pieces';
const BUILD = join(ROOT, 'build', 'pieces');
const PUBLIC = join(ROOT, 'public', 'pieces');
const STAGES = ['still', 'loop', 'encode'];
// What a visitor downloads, per file. The tile loop is fetched on hover, the
// header loop when a case study opens.
const BUDGET_KB = { 'loop-720.webm': 600, 'loop-720.mp4': 600, 'loop-1080.webm': 1400, 'loop-1080.mp4': 1400, 'poster-720.webp': 90, 'poster-1080.webp': 160 };
// Raise when the encode changes what a visitor gets, so the version in every
// file's URL changes too (vercel.json lets browsers keep the files for a week).
// The renders' own hash leaves this out: a new encode never re-renders.
const ENCODE_REV = 2;
// The live jar's files (the case study only), per file. The 1k colour atlas
// is what a phone or a slower machine gets.
const LIVE_BUDGET_KB = { 'scene.glb': 600, 'lightmap.webp': 200, 'gloss.webp': 150, 'albedo.webp': 200, 'env.webp': 80, 'model_color.webp': 700, 'model_color-1k.webp': 250, 'model_orm.webp': 400 };
const LIVE_TOTAL_KB = 2000;
// Each of a piece's own maps (scene.json's piece.dust.maps).
const LIVE_OWN_KB = 120;
// Raise to re-bake every jar (Blender) after a change its hash cannot see.
// The files' version is a hash of their bytes, so an encode change needs no bump.
const LIVE_REV = 1;
// The jar's meshes are simplified to within this fraction of each mesh's
// radius: under half a pixel at the case study's largest view.
const LIVE_SIMPLIFY = 1e-3;

// ---------------------------------------------------------------- args

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const VALUED = new Set(['--stages', '--frames', '--fps', '--chunk']);
const asked = argv.filter((a, i) => !a.startsWith('--') && !VALUED.has(argv[i - 1]));
const stages = opt('stages', STAGES.join(',')).split(',');
const FRAMES = Number(opt('frames', 144));
const FPS = Number(opt('fps', 24));
const CHUNK = Number(opt('chunk', 48));

// ---------------------------------------------------------------- helpers

const kb = async (p) => (await stat(p)).size / 1024;

/**
 * Borrowed models: copy each into build/pieces/_src/ so Blender never reads
 * another repo directly. Where each one is on this machine comes from its env
 * variable or the git-ignored sources.local.json, never from a committed path.
 */
async function sources() {
  const cfg = JSON.parse(await readFile(join(ROOT, SRC, 'sources.json'), 'utf8'));
  const localFile = join(ROOT, SRC, 'sources.local.json');
  const local = existsSync(localFile) ? JSON.parse(await readFile(localFile, 'utf8')) : {};
  await mkdir(join(BUILD, '_src'), { recursive: true });
  for (const [name, s] of Object.entries(cfg)) {
    if (name.startsWith('_')) continue;
    const from = process.env[s.env] || local[name];
    const to = join(BUILD, '_src', name);
    if (!from || !existsSync(from)) {
      const why = from ? `not found at ${from}` : `no path (set ${s.env}, or add it to ${SRC}/sources.local.json)`;
      if (!existsSync(to)) console.log(`  source ${name}: ${why} (pieces that need it will fail)`);
      continue;
    }
    const a = await stat(from);
    const b = existsSync(to) ? await stat(to) : null;
    if (!b || b.size !== a.size || b.mtimeMs < a.mtimeMs) {
      await copyFile(from, to);
      console.log(`  source ${name}: copied (${(a.size / 1e6).toFixed(1)} MB)`);
    }
  }
}

/** What a piece's renders and its live jar read, besides the scripts that drive them. */
async function pieceInputs(id) {
  const kit = (await readdir(join(ROOT, 'scripts/blender/kit'))).filter((f) => f.endsWith('.py')).map((f) => `scripts/blender/kit/${f}`);
  const own = await readFile(join(ROOT, SRC, `${id}.py`), 'utf8');
  // The shared parts and borrowed models count only for the pieces that use
  // them, so a change made for one piece does not throw away another's loop.
  const parts = [
    ...(/\b_parts\b/.test(own) ? [`${SRC}/_parts.py`] : []),
    // The scanned surfaces' helper (pieces/_scans.py), for the pieces that use it.
    ...(/\b_scans\b/.test(own) ? [`${SRC}/_scans.py`] : []),
  ];
  const models = [...own.matchAll(/K\.source\(\s*['"]([^'"]+)['"]/g)]
    .map((m) => `build/pieces/_src/${m[1]}`)
    .filter((f) => existsSync(join(ROOT, f)));
  // The scanned materials (ambientCG, scripts/fetch-assets.mjs) it names.
  const manifest = join(ROOT, 'build/assets/manifest.json');
  const scans = existsSync(manifest)
    ? Object.entries(JSON.parse(await readFile(manifest, 'utf8')).materials ?? {})
        .filter(([mid]) => new RegExp(`['"]${mid}['"]`).test(own))
        .flatMap(([, m]) => Object.values(m.maps).map((p) => `build/assets/${p}`))
        .filter((f) => existsSync(join(ROOT, f)))
    : [];
  return { own, files: ['scripts/blender/common.py', `${SRC}/_kit.py`, ...parts, ...kit, ...models, ...scans] };
}

/**
 * The renders' inputs. A piece's own script counts up to its live jar's
 * section (LIVE_MARK): the spots and hooks there are for the live scene only,
 * and tuning them must not throw away a rendered loop.
 */
const LIVE_MARK = '# ---------------------------------------------------------------- the live jar';
async function inputsHash(id) {
  const { own, files } = await pieceInputs(id);
  const i = own.indexOf(LIVE_MARK);
  return hashFiles(['scripts/blender/render_piece.py', ...files], `${id}.py\n${i < 0 ? own : own.slice(0, i)}`);
}

/** The live jar's inputs: the whole piece script, the bake and its adapter. */
async function liveHash(id) {
  const { files } = await pieceInputs(id);
  return hashFiles(['scripts/blender/bake_scene.py', `${SRC}/live.py`, `${SRC}/${id}.py`, ...files], `live:${LIVE_REV}`);
}

/** The lighter of the frame and the page colour: the background becomes the page. */
async function onPage(png) {
  const { width, height } = await sharp(png).metadata();
  // Composite, then start a fresh pipeline: a resize chained after composite()
  // would run before it, and the page colour must go in at full size.
  const buf = await sharp(png)
    .removeAlpha()
    .composite([{ input: { create: { width, height, channels: 3, background: PAGE } }, blend: 'lighten' }])
    .png()
    .toBuffer();
  return sharp(buf);
}

function ffmpeg(args, label) {
  return new Promise((ok, fail) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd: ROOT });
    let err = '';
    p.stderr.on('data', (b) => (err += b));
    p.on('error', (e) => fail(new Error(`${label}: ffmpeg did not start (${e.message})`)));
    p.on('close', (code) => (code === 0 ? ok() : fail(new Error(`${label}: ffmpeg exit ${code}\n${err.slice(-1200)}`))));
  });
}

// ---------------------------------------------------------------- stages

async function sheet(id) {
  const s = await blender('scripts/blender/render_piece.py', ['--piece', id, '--stage', 'sheet'], 'sheet');
  const dir = join(BUILD, id);
  const tiles = await Promise.all(
    ['00', '25', '50', '75'].map(async (q) => (await onPage(join(dir, `view-${q}.png`))).png().toBuffer())
  );
  const n = 540;
  await sharp({ create: { width: n * 4, height: n, channels: 3, background: PAGE } })
    .composite(tiles.map((input, i) => ({ input, left: i * n, top: 0 })))
    .png()
    .toFile(join(dir, 'sheet.png'));
  console.log(`  sheet   ${s}s  build/pieces/${id}/sheet.png`);
}

async function still(id) {
  const s = await blender('scripts/blender/render_piece.py', ['--piece', id, '--stage', 'still'], 'still');
  console.log(`  still   ${s}s`);
}

async function loop(id, hash) {
  const dir = join(BUILD, id, 'loop');
  await mkdir(dir, { recursive: true });
  const mark = join(dir, '.hash');
  const was = existsSync(mark) ? (await readFile(mark, 'utf8')).trim() : '';
  if (was !== hash || flag('force')) {
    // The piece changed: frames from the old model must not be mixed with new ones.
    for (const f of await readdir(dir)) if (f.endsWith('.png')) await rm(join(dir, f));
    await writeFile(mark, hash);
  }
  const have = async () => (await readdir(dir)).filter((f) => /^f_\d{4}\.png$/.test(f)).length;
  const t0 = Date.now();
  let before = await have();
  while (before < FRAMES) {
    await blender('scripts/blender/render_piece.py', ['--piece', id, '--stage', 'loop', '--frames', String(FRAMES), '--max', String(CHUNK)], 'loop', {
      timeoutMin: 45,
      keep: /RENDERED loop|Error|Traceback|File "|Exception/,
    });
    const now = await have();
    if (now <= before) throw new Error(`loop: no new frames (${now}/${FRAMES})`);
    console.log(`  loop    ${now}/${FRAMES} frames, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    before = now;
  }
}

async function encode(id, hash) {
  const dir = join(BUILD, id);
  const out = join(PUBLIC, id);
  await mkdir(out, { recursive: true });
  const stillPng = join(dir, 'still.png');
  if (!existsSync(stillPng)) throw new Error('encode: no still.png (run the still stage)');
  const { width } = await sharp(stillPng).metadata();
  await (await onPage(stillPng)).webp({ quality: 86, effort: 6 }).toFile(join(out, 'poster-1080.webp'));
  await (await onPage(stillPng)).resize(720, 720, { kernel: 'lanczos3' }).webp({ quality: 84, effort: 6 }).toFile(join(out, 'poster-720.webp'));

  const files = ['poster-720.webp', 'poster-1080.webp'];
  const frames = existsSync(join(dir, 'loop')) ? (await readdir(join(dir, 'loop'))).filter((f) => /^f_\d{4}\.png$/.test(f)).length : 0;
  if (frames === FRAMES) {
    // The page colour is made in RGB: the colour source's own default is YUV,
    // and the trip back rounds #09090b's green from 9 to 8, a backdrop a level
    // off the page.
    const input = ['-framerate', String(FPS), '-i', join(dir, 'loop', 'f_%04d.png'), '-f', 'lavfi', '-i', `color=c=0x${PAGE.slice(1)}:s=${width}x${width}:r=${FPS},format=gbrp`];
    // The colour description goes on the frames (setparams): ffmpeg takes the
    // encoder's from the frames, over its own -color_* options. BT.709 matrix
    // and limited range, which every browser decodes alike, and the sRGB
    // transfer, which is what the frames are: a player that manages colour then
    // shows the values as they are, where a BT.709 curve would lift the darks
    // off the page colour.
    const tags = 'setparams=colorspace=bt709:color_primaries=bt709:color_trc=iec61966-2-1:range=tv';
    for (const size of [720, 1080]) {
      // Lighten in RGB (in YUV the chroma planes would be compared as if they
      // were light). accurate_rnd: without it the page colour comes out as
      // Y 24, U 130, V 129 rather than 24, 129, 128, a level or two off the page.
      const filter = `[0:v]format=gbrp[a];[1:v]format=gbrp[b];[a][b]blend=all_mode=lighten:shortest=1,scale=${size}:${size}:flags=lanczos+accurate_rnd+full_chroma_int:out_color_matrix=bt709:out_range=tv,format=yuv420p,${tags}`;
      await ffmpeg(
        [...input, '-filter_complex', filter, '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '1', '-g', String(FRAMES), '-an', join(out, `loop-${size}.webm`)],
        `vp9 ${size}`
      );
      // aq-mode 3 spends bits on dark areas, which is where banding shows.
      await ffmpeg(
        [...input, '-filter_complex', filter, '-c:v', 'libx264', '-crf', '23', '-preset', 'slow', '-profile:v', 'high', '-x264-params', 'aq-mode=3', '-g', String(FRAMES), '-movflags', '+faststart', '-an', join(out, `loop-${size}.mp4`)],
        `h264 ${size}`
      );
      files.push(`loop-${size}.webm`, `loop-${size}.mp4`);
    }
  } else {
    console.log(`  encode  posters only: ${frames}/${FRAMES} loop frames on disk`);
  }

  const sizes = {};
  let over = 0;
  for (const f of files) {
    sizes[f] = Math.round(await kb(join(out, f)));
    if (sizes[f] > BUDGET_KB[f]) {
      over++;
      console.log(`  OVER    ${f}: ${sizes[f]} KB (budget ${BUDGET_KB[f]} KB)`);
    }
  }
  console.log(`  encode  ${files.map((f) => `${f} ${sizes[f]} KB`).join(', ')}`);
  const v = createHash('sha256').update(`${hash}:${ENCODE_REV}`).digest('hex').slice(0, 8);
  return { v, frames: frames === FRAMES ? FRAMES : 0, fps: FPS, kb: sizes, over };
}

/**
 * The jar as a live scene. Blender bakes it in three processes (the light on
 * the set, the panorama inside the jar, then the model's atlas and the
 * export), skipped while nothing it reads has changed; then the GLB is
 * optimised (meshopt, the clip kept) and the maps encoded as WebP.
 */
async function live(id) {
  const src = join(BUILD, id, 'live');
  const dst = join(PUBLIC, id, 'live');
  await mkdir(src, { recursive: true });
  await mkdir(dst, { recursive: true });
  const hash = await liveHash(id);
  const mark = join(src, '.hash');
  const was = existsSync(mark) ? (await readFile(mark, 'utf8')).trim() : '';
  if (was !== hash || flag('force') || !existsSync(join(src, 'scene.glb'))) {
    for (const stage of ['light', 'env', 'export']) {
      const s = await blender('scripts/blender/bake_scene.py', ['--scene', `piece:${id}`, '--stage', stage], `live ${stage}`);
      console.log(`  live    ${stage} ${s}s`);
    }
    await writeFile(mark, hash);
  } else console.log('  live    bake unchanged');

  const scene = JSON.parse(await readFile(join(src, 'scene.json'), 'utf8'));
  // A part's own maps (a borrowed model's: KPS Cleano's grass cards) at most
  // 512 pixels a side: the part is a small piece of a jar a page shows whole.
  const doc = await optimise(join(src, 'scene.glb'), join(dst, 'scene.glb'), { animations: true, simplify: LIVE_SIMPLIFY, level: 'high', webp: 85, maxTexture: 512 });
  const st = stats(doc);
  const val = await validate(join(dst, 'scene.glb'));
  const webp = (file, o) => sharp(join(src, file)).webp({ effort: 6, ...o });
  await webp('lightmap.png', { quality: 92 }).toFile(join(dst, 'lightmap.webp'));
  await webp('gloss.png', { quality: 92 }).toFile(join(dst, 'gloss.webp'));
  await webp('albedo.png', { quality: 86, smartSubsample: true }).toFile(join(dst, 'albedo.webp'));
  await sharp(join(src, 'env.png')).resize(512, 256).webp({ quality: 90, effort: 6 }).toFile(join(dst, 'env.webp'));
  await webp('model_color.png', { quality: 86, smartSubsample: true }).toFile(join(dst, 'model_color.webp'));
  await sharp(join(src, 'model_color.png')).resize(1024, 1024, { kernel: 'lanczos3' }).webp({ quality: 86, effort: 6, smartSubsample: true }).toFile(join(dst, 'model_color-1k.webp'));
  // Three maps in one (occlusion, roughness, metalness). Lossy: every channel
  // is finely graded (lossless costs 900 KB), and the chroma subsampling that
  // lets one channel bleed into another only does so across a material's edge,
  // which sits on an island's border, inside the bake margin.
  await sharp(join(src, 'model_orm.png')).resize(1024, 1024, { kernel: 'lanczos3' }).webp({ quality: 85, effort: 6, smartSubsample: true }).toFile(join(dst, 'model_orm.webp'));
  // A piece's own maps (Mission Builder's dust: its grain and its patches).
  // Grey, so lossy WebP's half-size colour planes carry nothing.
  const own = Object.values(scene.piece?.dust?.maps ?? {});
  for (const f of own) await sharp(join(src, f.replace(/\.webp$/, '.png'))).grayscale().webp({ quality: 88, effort: 6 }).toFile(join(dst, f));
  // The version is the files' own hash, so whatever changes them (a bake or
  // an encode) changes every URL the page asks for.
  const files = ['scene.glb', 'lightmap.webp', 'gloss.webp', 'albedo.webp', 'env.webp', 'model_color.webp', 'model_color-1k.webp', 'model_orm.webp', ...own];
  const vh = createHash('sha256').update(JSON.stringify(scene));
  for (const f of files) vh.update(f).update(await readFile(join(dst, f)));
  const v = vh.digest('hex').slice(0, 8);
  await writeFile(join(dst, 'scene.json'), JSON.stringify({ ...scene, hash: v }));

  const sizes = {};
  let over = 0;
  for (const f of [...Object.keys(LIVE_BUDGET_KB), ...own]) {
    sizes[f] = Math.round(await kb(join(dst, f)));
    const cap = LIVE_BUDGET_KB[f] ?? LIVE_OWN_KB;
    if (sizes[f] > cap) {
      over++;
      console.log(`  OVER    live/${f}: ${sizes[f]} KB (budget ${cap} KB)`);
    }
  }
  const desktop = ['scene.glb', 'lightmap.webp', 'gloss.webp', 'albedo.webp', 'env.webp', 'model_color.webp', 'model_orm.webp', ...own].reduce((n, f) => n + sizes[f], 0);
  if (desktop > LIVE_TOTAL_KB) {
    over++;
    console.log(`  OVER    live download ${desktop} KB (budget ${LIVE_TOTAL_KB} KB)`);
  }
  if (val.errors) {
    over++;
    console.log(`  INVALID live/scene.glb: ${val.errors} errors ${JSON.stringify(val.first)}`);
  }
  console.log(`  live    ${Object.entries(sizes).map(([f, n]) => `${f} ${n} KB`).join(', ')}`);
  console.log(`  live    ${desktop} KB in all, ${st.triangles} triangles, ${st.drawCalls} draws, ${st.animations} clip, validator ${val.errors} errors / ${val.warnings} warnings`);
  return { v, kb: sizes, triangles: st.triangles, drawCalls: st.drawCalls, over };
}

// ---------------------------------------------------------------- main

// Every module here is a piece, except the shared ones (the jar and the small parts).
const SHARED = new Set(['__init__.py', '_kit.py', '_parts.py', '_scans.py', 'live.py']);
const all = (await readdir(join(ROOT, SRC))).filter((f) => f.endsWith('.py') && !SHARED.has(f)).map((f) => f.slice(0, -3));
const ids = asked.length ? asked : all;
for (const id of ids) if (!all.includes(id)) throw new Error(`no piece "${id}" (have: ${all.join(', ')})`);

await sources();
const manifestPath = join(PUBLIC, 'manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : {};
let failed = 0;
for (const id of ids) {
  console.log(`\n${id}`);
  try {
    const hash = await inputsHash(id);
    if (stages.includes('sheet')) await sheet(id);
    if (stages.includes('still')) await still(id);
    if (stages.includes('loop')) await loop(id, hash);
    if (stages.includes('encode')) {
      const m = await encode(id, hash);
      if (m.over) failed++;
      manifest[id] = { ...manifest[id], v: m.v, frames: m.frames, fps: m.fps, kb: m.kb };
      await mkdir(PUBLIC, { recursive: true });
      await writeFile(manifestPath, JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 1) + '\n');
    }
    if (stages.includes('live')) {
      const { over, ...m } = await live(id);
      if (over) failed++;
      manifest[id] = { ...manifest[id], live: m };
      await mkdir(PUBLIC, { recursive: true });
      await writeFile(manifestPath, JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 1) + '\n');
    }
  } catch (e) {
    failed++;
    console.log(`  FAILED  ${e.message}`);
  }
}
// What the site needs to know, in src/ so Vite bundles it: the version that
// busts the cache, whether a loop exists (a piece with posters only shows its
// poster), and the live jar's version where one is built (its case study can
// turn it). A piece not listed here shows the empty jar.
const site = Object.fromEntries(
  Object.entries(manifest)
    .sort()
    .map(([id, m]) => [id, { v: m.v, loop: m.frames > 0, ...(m.live ? { live: m.live.v } : {}) }])
);
await writeFile(join(ROOT, 'src', 'data', 'pieces.json'), JSON.stringify(site) + '\n');
if (failed) {
  console.log(`\n${failed} piece(s) failed or over budget`);
  process.exit(1);
}
