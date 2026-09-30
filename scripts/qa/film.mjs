/**
 * Frame-exact films of a diorama, for review on any machine (a software
 * renderer included, where a screen recording would be a slideshow):
 *
 *   node scripts/qa/film.mjs [--project constructsafe] [--fps 24] [--w 960] [--h 540] [--only tour,case] [--stills]
 *
 * The bench steps the scene 1/fps at a time and draws each frame, so the film
 * runs at the scene's own speed however long a frame takes to draw. Writes
 * build/qa/film/<project>/:
 *   tour.webm  the card's tour (context card), as a visitor scrolling past sees it
 *   case.webm  the scene's own walkthrough (its controller's `demo.record`): each
 *              chapter chosen and its feature operated, with a panel beside the
 *              diorama like the explorer's (chapter, readouts, the camera
 *              picture, the button pressed); and case/NN-<chapter>-<button>.jpg,
 *              the last frame of each step, to check the film against
 * With --stills, the walkthrough is stepped without drawing and only those
 * stills are drawn: the same run in a fraction of the time, and no case.webm.
 * Encoded with the ffmpeg Playwright ships (VP8).
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { args, bench, ensureOut, launch, watchConsole } from './lib.mjs';

const opts = args();
const id = opts.project ?? 'retail-analytics';
const FPS = Number(opts.fps ?? 24);
const W = Number(opts.w ?? 960);
const H = Number(opts.h ?? 540);
const PANEL = 420;
const only = new Set(String(opts.only ?? 'tour,case').split(','));
const STILLS = !!opts.stills;
// The camera picture in the panel: 16:9, as tall as the room under the readouts allows.
const PIP_H = Math.min(Math.round(((PANEL - 24) * 9) / 16), H - 270);
const PIP_W = Math.round((PIP_H * 16) / 9);
const out = await ensureOut('film', id);

function ffmpegPath() {
  // Where Playwright keeps its browsers (and ffmpeg): Linux, Windows and macOS defaults.
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA && resolve(process.env.LOCALAPPDATA, 'ms-playwright'),
    process.env.HOME && resolve(process.env.HOME, '.cache', 'ms-playwright'),
    process.env.HOME && resolve(process.env.HOME, 'Library', 'Caches', 'ms-playwright'),
  ].filter((r) => r && existsSync(r));
  for (const root of roots) {
    const dir = readdirSync(root).find((d) => d.startsWith('ffmpeg'));
    const exe = dir && ['ffmpeg-linux', 'ffmpeg-win64.exe', 'ffmpeg-mac'].map((f) => resolve(root, dir, f)).find(existsSync);
    if (exe) return process.env.FFMPEG || exe;
  }
  return process.env.FFMPEG || 'ffmpeg';
}

/** An encoder fed JPEG frames on stdin. */
function encoder(file) {
  const p = spawn(ffmpegPath(), ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', 'pipe:0', '-c:v', 'libvpx', '-b:v', '5M', '-crf', '8', '-qmin', '0', '-qmax', '30', '-deadline', 'good', file]);
  let err = '';
  p.stderr.on('data', (b) => (err += b));
  const done = new Promise((ok, fail) => p.on('close', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg ${code}: ${err.slice(-400)}`)))));
  return {
    write: (buf) => new Promise((ok) => (p.stdin.write(buf) ? ok() : p.stdin.once('drain', ok))),
    end: () => (p.stdin.end(), done),
  };
}

const { browser, context } = await launch();
const page = await context.newPage();
const errors = watchConsole(page);

/** Set the bench up for filming: the engine's own loop stops driving the slot; a compositor draws each frame. */
const setup = (panel) =>
  page.evaluate(
    ({ panel, W, H, PANEL, PIP_W, PIP_H }) => {
      const { slot } = window.qa;
      slot.setActive(false);
      const pip = document.createElement('canvas');
      Object.assign(pip.style, { position: 'fixed', left: '-10000px', top: '0', width: `${PIP_W}px`, height: `${PIP_H}px` });
      document.body.appendChild(pip);
      const f = (window.__film = { pip, reads: [], title: '', flash: null, cv: document.createElement('canvas') });
      f.cv.width = W + (panel ? PANEL : 0);
      f.cv.height = H;
      const ch = slot.chapters;
      ch?.on((type, data) => {
        if (type === 'readouts') f.reads = data;
        else if (type === 'chapter') f.title = data.title ?? data.id;
        else if (type === 'pip') {
          f.wantPip = !!data;
          if (!f.noPip) slot.setPip(data ? pip : null);
        }
      });
      f.title = ch?.info()?.title ?? '';
      f.wantPip = !!ch?.current?.pip;
      slot.setPip(f.wantPip ? pip : null);
      f.panel = panel;
    },
    { panel, W, H, PANEL, PIP_W, PIP_H }
  );

/** Advance one frame and return it as a JPEG. */
const frame = async () => {
  const b64 = await page.evaluate(
    ({ FPS, W, H, PANEL, PIP_W, PIP_H }) => {
      const { slot } = window.qa;
      const f = window.__film;
      window.qa.step(1, 1 / FPS);
      const g = f.cv.getContext('2d');
      g.fillStyle = '#09090b';
      g.fillRect(0, 0, f.cv.width, f.cv.height);
      g.drawImage(slot.canvas, 0, 0, W, H);
      if (f.panel) {
        const x = W + 12;
        g.fillStyle = '#18181b';
        g.fillRect(W, 0, PANEL, H);
        g.fillStyle = '#fafafa';
        g.font = '600 18px sans-serif';
        g.fillText(f.title, x, 30);
        let y = 56;
        g.font = '12px monospace';
        for (const r of f.reads.slice(0, 9)) {
          g.fillStyle = '#a1a1aa';
          g.fillText(String(r.label).slice(0, 22), x, y);
          g.fillStyle = { red: '#fb6f8a', amber: '#fbbf24', green: '#4ade80' }[r.tone] ?? '#e4e4e7';
          const v = String(r.value);
          g.fillText(v.length > 34 ? `${v.slice(0, 33)}…` : v, x + 150, y);
          y += 18;
        }
        if (slot.pip && f.pip.width) g.drawImage(f.pip, x, H - PIP_H - 44, PIP_W, PIP_H);
        if (f.flash && f.flash.until > slot.time) {
          g.fillStyle = '#fbbf24';
          g.font = '600 14px sans-serif';
          g.fillText(`▶ ${f.flash.label}`, x, H - 18);
        }
      }
      return f.cv.toDataURL('image/jpeg', 0.9).split(',')[1];
    },
    { FPS, W, H, PANEL, PIP_W, PIP_H }
  );
  return Buffer.from(b64, 'base64');
};

/** Advance n frames without drawing (the camera picture off until the last second, when it is wanted). */
const skip = (n) =>
  page.evaluate(
    ({ n, FPS }) => {
      const { slot } = window.qa;
      const f = window.__film;
      for (let i = 0; i < n; i++) {
        const on = f.wantPip && i >= n - FPS;
        if (on !== !!slot.pip) slot.setPip(on ? f.pip : null);
        slot.update(1 / FPS);
      }
    },
    { n, FPS }
  );

async function film(name, secs, steps = null) {
  const enc = STILLS ? null : encoder(resolve(out, `${name}.webm`));
  const t0 = Date.now();
  let n = 0;
  let last = null;
  const run = async (s) => {
    const k = Math.round(s * FPS);
    if (STILLS) {
      await skip(k - 1);
      last = await frame();
      n += k;
      return;
    }
    for (let j = k; j > 0; j--, n++) await enc.write((last = await frame()));
  };
  const stills = steps && (await ensureOut('film', id, name));
  let chapter = '';
  if (steps) {
    for (const [i, [what, arg, ms]] of steps.entries()) {
      if (what === 'chapter') chapter = arg;
      if (what === 'chapter') await page.evaluate((c) => window.qa.slot.chapters.go(c), arg);
      else if (what === 'act') {
        await page.evaluate((a) => {
          const { slot } = window.qa;
          const label = slot.chapters.current?.actions?.().find((x) => x.id === a)?.label ?? a;
          slot.chapters.act(a);
          window.__film.flash = { label, until: slot.time + 2.5 };
        }, arg);
      }
      await run(ms / 1000);
      writeFileSync(resolve(stills, `${String(i + 1).padStart(2, '0')}-${chapter}${what === 'act' ? `-${arg}` : ''}.jpg`), last);
    }
  } else await run(secs);
  await enc?.end();
  console.log(`${name}${STILLS ? ' stills' : '.webm'}: ${n} frames (${(n / FPS).toFixed(1)} s) in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}

if (only.has('tour')) {
  await bench(page, opts.url, id, { w: W, h: H, seed: 1, context: 'card' });
  await setup(false);
  await film('tour', Number(opts.secs ?? 26));
}
if (only.has('case')) {
  await bench(page, opts.url, id, { w: W, h: H, seed: 1, context: 'case' });
  await setup(true);
  if (STILLS) await page.evaluate(() => (window.__film.noPip = true));
  const steps = (await page.evaluate(() => window.qa.slot.controller?.demo?.record)) ?? [];
  // (A drag needs a pointer on the real page: record.mjs does those.)
  await film('case', 0, steps.filter(([what]) => what !== 'drag'));
}
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
await browser.close();
console.log(`films: ${out}`);
