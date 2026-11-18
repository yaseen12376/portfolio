/**
 * Smooth films of the real page, for review: stepped frame by frame, so a
 * film runs at 60 frames a second of the page's own time however long each
 * frame takes to capture. (A screen recording runs at 25 a second and drops
 * frames while the machine is busy recording: a jar's turn judders in it
 * that does not on screen.)
 *
 * The engine's own loop is held (engine.hold); then, for every frame:
 *   1. that frame's input (a mouse move, a press, a touch), sent as real
 *      input, so the page handles it as it would a person's, and waited for
 *      (a move reaches the page with its next frame);
 *   2. engine.frame(1 / fps): every live slot updated and drawn;
 *   3. the page's CSS transitions and animations moved on by the same step
 *      (each is held when it starts, then stepped: on the clock they would
 *      run several times too fast);
 *   4. a PNG of the clip, piped to ffmpeg: H.264, BT.709, yuv420p, faststart.
 * Headless screenshots have no pointer, so one is drawn into the page: an
 * arrow, or a hand where the page's own cursor is one (over what can be
 * pressed, or turned), with a ring where a button goes down; on touch, a
 * fingertip while it is down.
 *
 *   const film = await smoothFilm(page, { clip, outputs: [{ file, width: 1920 }, { file, crop: [x, y, w, h] }] });
 *   await film.wait(2); await film.glide(x, y, 0.8); await film.click();
 *   const { frames, repeats } = await film.end();
 *
 * `clip` is in CSS pixels on the screen (the page's scroll is added to it
 * each frame); a crop is in the screenshot's own (CSS times the device
 * scale). Needs ffmpeg with libx264 on the PATH (or FFMPEG).
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

import { ROOT } from './lib.mjs';

const phosphor = (name) => readFileSync(resolve(ROOT, 'node_modules', '@phosphor-icons', 'core', 'assets', 'fill', `${name}.svg`), 'utf8');

// Each cursor: its picture, its size (CSS px) and its hot spot within it.
const CURSORS = {
  arrow: {
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4.5 2.5v17.2l4.6-4.4 3.1 7 3-1.3-3.1-6.9h6.4z" fill="#fff" stroke="#09090b" stroke-width="1.3" stroke-linejoin="round"/></svg>',
    size: 24,
    hot: [4.5, 2.5],
  },
  pointer: { svg: phosphor('hand-pointing-fill'), size: 28, hot: [12.3, 1.8] },
  grab: { svg: phosphor('hand-fill'), size: 28, hot: [14, 13] },
  grabbing: { svg: phosphor('hand-grabbing-fill'), size: 28, hot: [14, 15] },
};

/** Slow off, quick across, slow in. */
export const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (2 - 2 * x) ** 3 / 2);
/** A hand dragging: up to speed in its first sixth, then steady to the end (it lets go moving). */
const handDrag = (x) => (x < 1 / 6 ? 3 * x * x : x - 1 / 12) / (11 / 12);

/** One ffmpeg, fed PNGs on stdin, writing every output from the same frames. */
function encoder(outputs, fps) {
  const n = outputs.length;
  const chains = outputs.map((o, i) => {
    const f = [];
    if (o.crop) f.push(`crop=${o.crop[2]}:${o.crop[3]}:${o.crop[0]}:${o.crop[1]}`);
    f.push(`scale=${o.width ? `${o.width}:-2:flags=lanczos:` : ''}out_color_matrix=bt709:out_range=tv`);
    f.push('format=yuv420p');
    // On the frames: ffmpeg 8 tags the stream from them, not from -color_* (left unknown).
    f.push('setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv');
    return `[s${i}]${f.join(',')}[o${i}]`;
  });
  const split = n > 1 ? `[0:v]split=${n}${outputs.map((_, i) => `[s${i}]`).join('')}` : '[0:v]null[s0]';
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-c:v', 'png', '-framerate', String(fps), '-i', 'pipe:0', '-filter_complex', [split, ...chains].join(';')];
  outputs.forEach((o, i) =>
    args.push(
      '-map', `[o${i}]`,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', String(o.crf ?? 16), '-profile:v', 'high',
      '-g', String(fps * 2), '-r', String(fps),
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-movflags', '+faststart', o.file
    )
  );
  const p = spawn(process.env.FFMPEG || 'ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (b) => (err += b));
  const done = new Promise((ok, fail) => {
    p.on('error', (e) => fail(new Error(`ffmpeg did not start (${e.message}): install it, or set FFMPEG`)));
    p.on('close', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exit ${code}: ${err.slice(-600)}`))));
  });
  return {
    write: (buf) => new Promise((ok) => (p.stdin.write(buf) ? ok() : p.stdin.once('drain', ok))),
    end: () => (p.stdin.end(), done),
  };
}

/** In the page: hold the engine and the CSS clock, and draw the pointer. */
function setup({ cursors, touch }) {
  const engine = window.__three;
  engine.hold(true);
  const root = document.createElement('div');
  root.setAttribute('aria-hidden', 'true');
  root.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
  const ring = document.createElement('div');
  ring.style.cssText = 'position:absolute;left:0;top:0;border-radius:50%;opacity:0;box-sizing:border-box;';
  const cur = document.createElement('div');
  cur.style.cssText = 'position:absolute;left:0;top:0;color:#fff;filter:drop-shadow(0 0 0.7px #09090b) drop-shadow(0 0 0.7px #09090b) drop-shadow(0 1.5px 2.5px rgba(0,0,0,0.5));';
  root.append(ring, cur);
  document.body.appendChild(root);
  // What runs now is held where it is; what starts later starts held.
  const seen = new WeakSet();
  for (const a of document.getAnimations()) {
    seen.add(a);
    a.pause();
  }
  // Where the page last saw the pointer, to wait for a move to arrive.
  const last = { x: NaN, y: NaN };
  const note = (e) => {
    last.x = e.clientX;
    last.y = e.clientY;
  };
  addEventListener('pointermove', note, { capture: true, passive: true });
  addEventListener('pointerdown', note, { capture: true, passive: true });
  let kind = '';
  let was = false;
  const S = (window.__smooth = {
    t: 0,
    last,
    press: -9,
    release: -9,
    step(dt, p) {
      engine.frame(dt);
      S.t += dt;
      for (const a of document.getAnimations()) {
        if (!seen.has(a)) {
          seen.add(a);
          a.pause();
          if (a.currentTime == null) a.currentTime = 0;
          continue;
        }
        if (a.playState !== 'paused') a.pause();
        a.currentTime = (a.currentTime ?? 0) + dt * 1000;
      }
      S.pointer(p);
      // Where the screen is on the page (a screenshot's clip is on the page, not the screen).
      const v = window.visualViewport;
      return v ? [v.pageLeft, v.pageTop] : [scrollX, scrollY];
    },
    pointer({ x, y, down, shown }) {
      if (down && !was) S.press = S.t;
      if (!down && was) S.release = S.t;
      was = down;
      root.style.display = shown ? '' : 'none';
      root.style.transform = `translate(${x}px, ${y}px)`;
      const since = S.t - S.press;
      if (touch) {
        // A fingertip: in as it touches, out after it lifts.
        cur.style.display = 'none';
        const k = down ? Math.min(1, since / 0.1) : Math.max(0, 1 - (S.t - S.release) / 0.25);
        const d = 38 * (0.85 + 0.15 * Math.min(1, since / 0.1));
        Object.assign(ring.style, {
          width: `${d}px`,
          height: `${d}px`,
          transform: `translate(${-d / 2}px, ${-d / 2}px)`,
          background: 'rgba(255,255,255,0.26)',
          border: '1.5px solid rgba(255,255,255,0.78)',
          opacity: String(k),
        });
        return;
      }
      const under = document.elementFromPoint(x, y);
      const c = under ? getComputedStyle(under).cursor : 'auto';
      const k = c === 'grabbing' || c === 'grab' || c === 'pointer' ? c : 'arrow';
      if (k !== kind) {
        kind = k;
        const { svg, size, hot } = cursors[k];
        cur.innerHTML = svg;
        // (Sized here, not by the page's own rules for its icons.)
        cur.firstElementChild.style.cssText = 'display:block;width:100%;height:100%;max-width:none;max-height:none;';
        Object.assign(cur.style, { width: `${size}px`, height: `${size}px`, transform: `translate(${-hot[0]}px, ${-hot[1]}px)` });
      }
      // A ring where a button goes down.
      const f = Math.min(1, since / 0.42);
      const d = 12 + 30 * (1 - (1 - f) ** 3);
      Object.assign(ring.style, {
        width: `${d}px`,
        height: `${d}px`,
        transform: `translate(${-d / 2}px, ${-d / 2}px)`,
        background: 'none',
        border: '2px solid rgba(167,139,250,0.95)',
        opacity: String(since < 0.42 ? 1 - f : 0),
      });
    },
  });
}

/**
 * @param {import('playwright').Page} page  with the jar (or any slot) live
 * @param {{ clip: {x,y,width,height}, outputs: {file, width?, crop?, crf?}[], fps?: number, touch?: boolean, from?: {x,y} }} o
 */
export async function smoothFilm(page, { clip, outputs, fps = 60, touch = false, from = null }) {
  const cdp = await page.context().newCDPSession(page);
  // (The screenshot's scale is the page's own: every device pixel, none made up.)
  const dpr = await page.evaluate(() => devicePixelRatio);
  await page.evaluate(setup, { cursors: CURSORS, touch });
  const enc = encoder(outputs, fps);
  const ptr = { x: from?.x ?? clip.x + clip.width * 0.2, y: from?.y ?? clip.y + clip.height * 0.6, down: false };
  let frames = 0;
  let repeats = 0;
  let lastHash = '';
  let lastPng = null;

  /** Wait (a frame at a time) until the page has seen the pointer at x, y. */
  const arrive = async (x, y) => {
    for (let i = 0; i < 8; i++) {
      const ok = await page.evaluate(
        ([x, y]) => new Promise((r) => requestAnimationFrame(() => r(Math.abs(window.__smooth.last.x - x) < 0.75 && Math.abs(window.__smooth.last.y - y) < 0.75))),
        [x, y]
      );
      if (ok) return;
    }
  };
  const touchPoint = () => ({ x: ptr.x, y: ptr.y, id: 1, radiusX: 9, radiusY: 9, force: 1 });

  async function frame() {
    const [sx, sy] = await page.evaluate(([dt, p]) => window.__smooth.step(dt, p), [1 / fps, { x: ptr.x, y: ptr.y, down: ptr.down, shown: true }]);
    // The clip is on the screen; the screenshot wants it on the page (as Playwright does).
    const at = { x: clip.x + sx, y: clip.y + sy, width: clip.width, height: clip.height, scale: dpr };
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: at, optimizeForSpeed: true });
    const png = Buffer.from(data, 'base64');
    const h = createHash('md5').update(png).digest('hex');
    if (h === lastHash) repeats++;
    lastHash = h;
    lastPng = png;
    await enc.write(png);
    frames++;
  }

  /** The pointer to x, y this frame (a touch moves only while it is down). */
  async function moveTo(x, y) {
    ptr.x = x;
    ptr.y = y;
    if (!touch) {
      await page.mouse.move(x, y);
      await arrive(x, y);
    } else if (ptr.down) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touchPoint()] });
      await arrive(x, y);
    }
    await frame();
  }

  const film = {
    get seconds() {
      return frames / fps;
    },
    get at() {
      return { x: ptr.x, y: ptr.y };
    },
    /** Frames with no input. */
    async wait(sec) {
      for (let i = Math.round(sec * fps); i > 0; i--) await frame();
    },
    moveTo,
    /** Glide to x, y over `sec`, one move a frame. */
    async glide(x, y, sec, ease = easeInOut) {
      const [x0, y0] = [ptr.x, ptr.y];
      const n = Math.max(1, Math.round(sec * fps));
      for (let i = 1; i <= n; i++) {
        const k = ease(i / n);
        await moveTo(x0 + (x - x0) * k, y0 + (y - y0) * k);
      }
    },
    /** Glide by dx, dy (a drag, when the button or finger is down): steady, as a hand drags. */
    async drag(dx, dy, sec, ease = handDrag) {
      await film.glide(ptr.x + dx, ptr.y + dy, sec, ease);
    },
    async down() {
      ptr.down = true;
      if (touch) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint()] });
        await arrive(ptr.x, ptr.y);
      } else await page.mouse.down();
      await frame();
    },
    async up() {
      ptr.down = false;
      if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      else await page.mouse.up();
      await frame();
    },
    /**
     * Press and let go where the pointer is. A tap lets go after one frame:
     * frames take far longer than 1/60 s to capture, and a finger held half a
     * second of real time is a long press to the browser, which clicks nothing.
     */
    async click(holdFrames = touch ? 1 : 4) {
      await film.down();
      for (let i = 1; i < holdFrames; i++) await frame();
      await film.up();
    },
    /** On touch: put the finger at x, y (unseen until it touches). */
    place(x, y) {
      ptr.x = x;
      ptr.y = y;
    },
    /** The last frame, as a PNG file (`crop`: [x, y, w, h] of it, in its own pixels). */
    async still(file, crop = null) {
      if (!lastPng) return;
      if (!crop) return writeFile(file, lastPng);
      const [left, top, width, height] = crop;
      await sharp(lastPng).extract({ left, top, width, height }).png().toFile(file);
    },
    /** Finish the files; the engine's own loop runs again. */
    async end() {
      await enc.end();
      await page.evaluate(() => window.__three.hold(false)).catch(() => {});
      await cdp.detach().catch(() => {});
      return { frames, seconds: +(frames / fps).toFixed(2), repeats };
    },
  };
  return film;
}

