/**
 * Encode the project panel loops for the web.
 *
 * Source: "Project vids/*.mp4" — Veo output, h264 1280x720 24fps, 10.005s,
 * ~2 Mbps, each carrying an AAC track that is pure dead weight in a panel that
 * is muted by definition.
 *
 * Three things happen here:
 *
 *  1. Audio is dropped.
 *  2. The loop seam is crossfaded. Measured first-vs-last-frame difference was
 *     3-16 (mean abs, 0-255) across the six — no hard cut, but five of them
 *     would show a visible nudge on repeat. Blending the tail over the head and
 *     dropping the duplicated head makes the loop join exact.
 *  3. Two encodes per clip: VP9/WebM as the primary and H.264/MP4 as the
 *     fallback for older Safari. The browser downloads whichever it picks, and
 *     only when the panel actually plays it (preload="none").
 *
 * Also writes a poster frame per clip, used as the <video poster>, the mobile
 * still, and the fallback if the video never loads.
 *
 * Run: npm run encode:videos
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const run = promisify(execFile);

const SRC = 'Project vids';
const OUT = 'public/project-video';
const FADE = 0.6; // seconds of loop-seam crossfade
const DUR = 10.005; // measured source duration

/** Source filenames are inconsistent; map them onto the project ids. */
// Keys are the filename lowercased with spaces and hyphens turned into "_".
// After encoding a new id, add `video: '/project-video/<id>'` to that project
// in src/data/projects.js (constructsafe, retail-analytics, courier, airdraw
// have no video field until their clips exist).
const ID_MAP = {
  retail_analytics: 'retail-analytics',
  constructsafe: 'constructsafe',
  courier: 'courier',
  airdraw: 'airdraw',
  attandance: 'attendance', // sic — source file is misspelled
  attendance: 'attendance',
  indoor_tracking: 'indoor-tracking',
  observex: 'observex',
  adraf: 'adraf',
};

const mb = (b) => (b / 1048576).toFixed(2);

/**
 * body = [FADE, DUR-FADE], then the tail crossfaded over the head.
 * The crossfade ends showing exactly the frame body starts on, so the loop
 * point is continuous.
 */
/**
 * Veo stamps a sparkle watermark in the frame. Measured on a clip with a black
 * corner (Attendance), it occupies x 1137-1184, y 576-622 in the 1280x720
 * source — i.e. 89-93% across and 80-86% down.
 *
 * A 5% corner crop was the first attempt and did not touch it; cropping far
 * enough to exclude it (1011x569, to keep 16:9) would zoom 1.27x and cut the
 * bottom row off the ObserveX camera grid.
 *
 * delogo interpolates the box from its surrounding pixels instead. On flat dark
 * areas it is invisible; on detailed areas it leaves a soft patch roughly
 * 20x20 CSS px at panel size, which is far less conspicuous than the mark. Keep
 * the box tight — a generous margin is what makes the smear obvious.
 */
const WATERMARK = 'delogo=x=1136:y=574:w=50:h=50';

const LOOP_FILTER =
  `[0:v]${WATERMARK},split=3[c0][c1][c2];` +
  `[c0]trim=start=${FADE}:end=${DUR - FADE},setpts=PTS-STARTPTS[body];` +
  `[c1]trim=start=${DUR - FADE}:end=${DUR},setpts=PTS-STARTPTS[tail];` +
  `[c2]trim=start=0:end=${FADE},setpts=PTS-STARTPTS[head];` +
  `[tail][head]blend=all_expr='A*(1-T/${FADE})+B*(T/${FADE})'[xf];` +
  `[body][xf]concat=n=2:v=1:a=0[v]`;

async function encode(srcPath, id) {
  const webm = join(OUT, `${id}.webm`);
  const mp4 = join(OUT, `${id}.mp4`);
  const poster = join(OUT, `${id}.jpg`);

  // VP9. Two-pass would shave a little more but doubles build time for a
  // negligible win at this bitrate; -crf with -b:v 0 is constant-quality.
  await run('ffmpeg', [
    '-v', 'error', '-y', '-i', srcPath,
    '-filter_complex', LOOP_FILTER, '-map', '[v]', '-an',
    '-c:v', 'libvpx-vp9', '-crf', '36', '-b:v', '0',
    '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2',
    '-pix_fmt', 'yuv420p',
    webm,
  ]);

  await run('ffmpeg', [
    '-v', 'error', '-y', '-i', srcPath,
    '-filter_complex', LOOP_FILTER, '-map', '[v]', '-an',
    '-c:v', 'libx264', '-crf', '28', '-preset', 'slow',
    '-profile:v', 'main', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    mp4,
  ]);

  // Poster: a frame from a little way in, so it isn't a fade-in frame.
  await run('ffmpeg', [
    '-v', 'error', '-y', '-ss', '2.0', '-i', srcPath,
    '-vframes', '1', '-vf', WATERMARK, '-q:v', '4', poster,
  ]);

  const [w, m, p] = await Promise.all([stat(webm), stat(mp4), stat(poster)]);
  return { webm: w.size, mp4: m.size, poster: p.size };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const files = (await readdir(SRC)).filter((f) => /\.(mp4|mov|webm)$/i.test(f));
  if (!files.length) throw new Error(`No videos found in ${SRC}/`);

  console.log(`Encoding ${files.length} panel loops -> ${OUT}/\n`);
  const done = [];
  let totalWebm = 0;

  for (const file of files) {
    const key = file.replace(/\.[^.]+$/, '').toLowerCase().replace(/[\s-]+/g, '_');
    const id = ID_MAP[key];
    if (!id) {
      console.log(`  ${file.padEnd(24)} SKIPPED — no id mapping for "${key}"`);
      continue;
    }
    process.stdout.write(`  ${id.padEnd(18)}`);
    const t0 = Date.now();
    try {
      const r = await encode(join(SRC, file), id);
      totalWebm += r.webm;
      done.push(id);
      console.log(
        `webm ${mb(r.webm)} MB  mp4 ${mb(r.mp4)} MB  poster ${(r.poster / 1024).toFixed(0)} KB` +
          `  (${((Date.now() - t0) / 1000).toFixed(0)}s)`
      );
    } catch (e) {
      console.log(`FAILED — ${String(e.stderr || e.message).split('\n')[0].slice(0, 120)}`);
    }
  }

  await writeFile(join(OUT, 'manifest.json'), JSON.stringify({ ids: done }, null, 2));
  console.log(`\n  ${done.length} encoded. WebM total ${mb(totalWebm)} MB`);
  console.log(`  Only the panel actually on screen loads one — preload="none".\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
