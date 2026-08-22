/**
 * Re-encode the hero image sequence for the web.
 *
 * Source: _source-frames/frames_lossless_webp/ — 276 frames, lossless 3840x2160.
 *   (Pixel-identical to frames_png/ but 13x smaller on disk, so it reads faster.)
 *
 * The source clip is not uniformly interesting. Measured mean absolute greyscale
 * delta between consecutive frames:
 *
 *     frames   1- 48   0.67 - 0.85   slow drift
 *     frames  49-132   1.00 - 2.35   the action (box opens, camera move)
 *     frames 133-276   0.17 - 0.37   effectively static, grain only
 *
 * So we decimate non-uniformly — keep every frame through the action, thin the
 * drift 2x and the static tail 3x. That drops 276 -> 156 frames with no visible
 * change, and because playback is linear over the decimated set, the dead tail
 * automatically stops eating half the scroll distance.
 *
 * Outputs three resolution tiers plus a ladder. Only ONE tier is downloaded,
 * chosen at runtime from innerWidth * devicePixelRatio so the canvas is never
 * upscaled (upscaling was the cause of the visible softness in the first cut):
 *   desktop  1920x1080  — the ceiling; 1:1 on a maximised window
 *   mobile   1280x720   — phones and tablets
 *   ladder    960x540   — every 4th frame, decoded once and kept, so a fast
 *                         scroll always has *something* sharp enough to draw
 *
 * Run: npm run encode:frames
 */
import sharp from 'sharp';
import { readdir, mkdir, writeFile, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';

const SRC = '_source-frames/frames_lossless_webp';
const OUT = 'public/hero';
const CONCURRENCY = 8;

/** Keep-every-Nth, by source frame range (1-indexed, inclusive). */
const DECIMATION = {
  // Every frame through the drift AND the action — thinning the head made the
  // opening feel stepped. Only the genuinely static tail is decimated.
  full: [
    { from: 1, to: 132, every: 1 },
    { from: 133, to: 276, every: 3 },
  ],
  phone: [
    { from: 1, to: 48, every: 2 },
    { from: 49, to: 132, every: 1 },
    { from: 133, to: 276, every: 4 },
  ],
};

/**
 * Two resolution tiers; only ONE is ever downloaded.
 *
 * 1920x1080 is the deliberate ceiling. A 2560x1440 tier was measured at 27 ms
 * per decode against 15 ms at 1080p, and 180 frames of it can never stay in the
 * browser's decode cache, so every pass through the hero re-decodes and the
 * scrub drops to ~20fps. 1080p is 1:1 on a maximised window on most displays
 * and comfortably decodable.
 */
const TIERS = [
  { name: 'desktop', width: 1920, height: 1080, quality: 85, plan: DECIMATION.full },
  { name: 'mobile', width: 1280, height: 720, quality: 78, plan: DECIMATION.phone },
];

// The ladder is what a fast scroll actually looks at, so it can't be tiny.
// 960x540 upscaled to a 1080p stage is soft but clearly readable; 480x270 was
// not, and that was a real part of the "quality dropped" complaint.
const LADDER = { name: 'ladder', width: 960, height: 540, quality: 72, every: 4 };

function selectFrames(all, plan) {
  const picked = [];
  for (const { from, to, every } of plan) {
    for (let i = from; i <= Math.min(to, all.length); i += every) picked.push(all[i - 1]);
  }
  return picked;
}

async function mapLimit(items, limit, fn) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        await fn(items[i], i);
      }
    })
  );
}

async function dirSize(dir) {
  const files = await readdir(dir);
  const sizes = await Promise.all(files.map((f) => stat(join(dir, f)).then((s) => s.size)));
  return { count: files.length, bytes: sizes.reduce((a, b) => a + b, 0) };
}

const mb = (b) => (b / 1048576).toFixed(2) + ' MB';

async function encodeSet(sources, { name, width, height, quality }) {
  const outDir = join(OUT, name);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const t0 = Date.now();
  let done = 0;
  await mapLimit(sources, CONCURRENCY, async (file, i) => {
    await sharp(join(SRC, file))
      .resize(width, height, { fit: 'cover' })
      .webp({ quality, effort: 5, smartSubsample: true, alphaQuality: 100 })
      .toFile(join(outDir, `f_${String(i).padStart(4, '0')}.webp`));
    done++;
    if (done % 40 === 0 || done === sources.length) {
      process.stdout.write(`\r  ${name}: ${done}/${sources.length}   `);
    }
  });

  const { count, bytes } = await dirSize(outDir);
  console.log(
    `\r  ${name.padEnd(8)} ${String(count).padStart(3)} frames @ ${width}x${height} q${quality}` +
      ` -> ${mb(bytes)} (avg ${(bytes / count / 1024).toFixed(1)} KB) in ${((Date.now() - t0) / 1000).toFixed(1)}s`
  );
  return { count, bytes };
}

async function main() {
  const all = (await readdir(SRC)).filter((f) => f.endsWith('.webp')).sort();
  if (!all.length) throw new Error(`No frames found in ${SRC}`);
  console.log(`Source: ${all.length} frames in ${SRC}\n`);

  const manifest = { tiers: {} };
  let total = 0;
  let desktopSources = [];

  for (const tier of TIERS) {
    const sources = selectFrames(all, tier.plan);
    if (tier.name === 'desktop') desktopSources = sources;
    const { count, bytes } = await encodeSet(sources, tier);
    total += bytes;
    manifest.tiers[tier.name] = {
      dir: `/hero/${tier.name}`,
      count,
      width: tier.width,
      height: tier.height,
      bytes,
    };
  }

  // Ladder: every 4th desktop frame at low resolution. Held in memory for the
  // whole session so getDrawable() can always fall back to something within
  // +/-2 frames instead of leaving a stale image on screen.
  const ladderSources = desktopSources.filter((_, i) => i % LADDER.every === 0);
  const { count: lCount, bytes: lBytes } = await encodeSet(ladderSources, LADDER);
  total += lBytes;
  manifest.ladder = {
    dir: `/hero/${LADDER.name}`,
    count: lCount,
    every: LADDER.every,
    width: LADDER.width,
    height: LADDER.height,
    bytes: lBytes,
  };

  const poster = await sharp(join(SRC, all[0]))
    .resize(1920, 1080, { fit: 'cover' })
    .webp({ quality: 84, effort: 6 })
    .toBuffer();
  await writeFile(join(OUT, 'poster.webp'), poster);
  total += poster.length;
  manifest.poster = '/hero/poster.webp';
  console.log(`  poster     1 frame  @ 1920x1080 q84 -> ${(poster.length / 1024).toFixed(1)} KB`);

  await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\n  Total hero payload: ${mb(total)}  (was 487 MB)\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
