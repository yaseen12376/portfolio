/**
 * Shared helpers for the diorama QA scripts: a Chromium with a real GPU, the
 * bench page, and image maths (CIE76 colour difference on downscaled frames).
 *
 * The scripts expect the dev server running (npm run dev) and take
 * --url http://localhost:3000 to point elsewhere.
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { chromium } from 'playwright';
import sharp from 'sharp';

export const ROOT = resolve(import.meta.dirname, '..', '..');
export const OUT = resolve(ROOT, 'build', 'qa');

export function args() {
  const a = process.argv.slice(2);
  const opts = { _: [] };
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) {
      const k = a[i].slice(2);
      opts[k] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
    } else opts._.push(a[i]);
  }
  opts.url ??= 'http://localhost:3000';
  return opts;
}

/**
 * Headless Chromium on the real GPU: ANGLE on D3D11 on Windows (without
 * these flags it falls back to SwiftShader: correct pixels, useless
 * timings), the platform's own GPU elsewhere (a Mac's Metal).
 *
 * On Linux (a cloud container, usually with no GPU) it asks for SwiftShader
 * outright, so WebGL2 works; frame timings there mean nothing.
 * QA_SOFTWARE_GL=1 or 0 says which, on any machine. QA_CHROMIUM points at a
 * browser binary when the installed one doesn't match the Playwright version.
 */
export const SOFTWARE_GL = process.env.QA_SOFTWARE_GL ? process.env.QA_SOFTWARE_GL === '1' : process.platform === 'linux';

export async function launch({ gpu = true, discrete = false, uncapped = false } = {}) {
  // discrete: the laptop's discrete GPU (headless Chromium otherwise takes the
  // integrated one). uncapped: no vsync or frame-rate cap, so frame times
  // measure the work rather than the display's 60 Hz.
  const extra = [...(discrete ? ['--force_high_performance_gpu'] : []), ...(uncapped ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])];
  const flags = SOFTWARE_GL
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...extra]
    : [...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []), '--ignore-gpu-blocklist', '--enable-gpu-rasterization', ...extra];
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.QA_CHROMIUM || undefined,
    args: gpu ? flags : [],
  });
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1920, height: 1080 } });
  return { browser, context };
}

export async function gpuName(page) {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
}

/** Collect console errors and warnings for a page (ANGLE's X4122, and SwiftShader lacking parallel shader compiles, are benign). */
export function watchConsole(page) {
  const log = [];
  page.on('console', (m) => {
    if (!['error', 'warning'].includes(m.type())) return;
    const text = m.text();
    if (/X4122|GPU stall due to ReadPixels|Automatic fallback to software WebGL|KHR_parallel_shader_compile/.test(text)) return;
    log.push(`${m.type()}: ${text}`);
  });
  page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`));
  return log;
}

/** Open the bench for one scene and wait until it has drawn. */
export async function bench(page, base, id, { w = 1920, h = 1080, still = false, nopost = false, seed = null, context = null } = {}) {
  await page.setViewportSize({ width: Math.max(w, 320), height: Math.max(h, 240) });
  const q = new URLSearchParams({ id, w: String(w), h: String(h), '3d': 'force' });
  if (seed != null) q.set('seed', String(seed));
  if (context) q.set('context', context);
  if (still) q.set('still', '');
  if (nopost) q.set('nopost', '');
  await page.goto(`${base}/qa/3d.html?${q}`);
  const info = await page.evaluate(() => window.qa.ready);
  return info;
}

export async function framePNG(page) {
  const url = await page.evaluate(() => window.qa.png());
  return Buffer.from(url.split(',')[1], 'base64');
}

export async function ensureOut(...parts) {
  const dir = resolve(OUT, ...parts);
  await mkdir(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------- image maths

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);

function lab(r, g, b) {
  const R = lin(r / 255);
  const G = lin(g / 255);
  const B = lin(b / 255);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const fy = f(Y);
  return [116 * fy - 16, 500 * (f(X) - fy), 200 * (fy - f(Z))];
}

/** Raw RGB of an image at w x h (flattened on the site background). */
export async function rgb(input, w, h) {
  const { data } = await sharp(input).flatten({ background: '#09090b' }).resize(w, h, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return data;
}

/**
 * Mean CIE76 difference between two images, over the pixels where either is
 * not background (so the empty backdrop does not flatter the score), plus a
 * per-pixel difference image and each image's mean Lab.
 */
export async function compare(a, b, { w = 480, h = 270 } = {}) {
  const [A, B] = await Promise.all([rgb(a, w, h), rgb(b, w, h)]);
  const diff = Buffer.alloc(w * h * 3);
  let sum = 0;
  let n = 0;
  const meanA = [0, 0, 0];
  const meanB = [0, 0, 0];
  for (let i = 0; i < w * h; i++) {
    const la = lab(A[i * 3], A[i * 3 + 1], A[i * 3 + 2]);
    const lb = lab(B[i * 3], B[i * 3 + 1], B[i * 3 + 2]);
    const d = Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
    const v = Math.min(255, d * 8);
    diff[i * 3] = v;
    diff[i * 3 + 1] = v * 0.4;
    diff[i * 3 + 2] = 255 - v;
    if (la[0] > 12 || lb[0] > 12) {
      sum += d;
      n++;
      for (let k = 0; k < 3; k++) {
        meanA[k] += la[k];
        meanB[k] += lb[k];
      }
    }
  }
  const avg = (m) => m.map((x) => +(x / Math.max(1, n)).toFixed(1));
  return {
    deltaE: +(sum / Math.max(1, n)).toFixed(2),
    coverage: +(n / (w * h)).toFixed(3),
    labA: avg(meanA),
    labB: avg(meanB),
    diff: await sharp(diff, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer(),
  };
}

/** Lay images side by side (each resized to w x h) with captions. */
export async function board(items, { w = 640, h = 360 } = {}) {
  const pad = 12;
  const cap = 22;
  const W = items.length * (w + pad) + pad;
  const H = h + cap + pad * 2;
  const tiles = await Promise.all(
    items.map(async ({ img, label }, i) => {
      const buf = await sharp(img).flatten({ background: '#09090b' }).resize(w, h, { fit: 'contain', background: '#09090b' }).png().toBuffer();
      const text = Buffer.from(
        `<svg width="${w}" height="${cap}"><text x="0" y="15" fill="#a1a1aa" font-family="monospace" font-size="13">${label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`
      );
      const x = pad + i * (w + pad);
      return [
        { input: text, left: x, top: pad },
        { input: buf, left: x, top: pad + cap },
      ];
    })
  );
  return sharp({ create: { width: W, height: H, channels: 3, background: '#18181b' } })
    .composite(tiles.flat())
    .png()
    .toBuffer();
}
