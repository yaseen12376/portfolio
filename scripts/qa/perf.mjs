/**
 * Frame cost on the real GPUs, on the bench: each frame stepped and timed
 * until the GPU has finished it (CPU simulation + draw + GPU work):
 *
 *   node scripts/qa/perf.mjs [ids...] [--url http://localhost:3000] [--secs 6]
 *
 * For each scene, a flagship card (1170 x 505, pixel ratio 1.5) and a case
 * study (1184 x 740, pixel ratio 2) run, first on the discrete GPU (median
 * budgets: 8 ms a card, 14 ms a case study) and then on the integrated one,
 * where the numbers are reported: there the engine's adaptive loop steps the
 * pixel density down on its own once frames run over 22 ms.
 */
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { ROOT, args, gpuName, launch, watchConsole } from './lib.mjs';

const opts = args();
const SECS = Number(opts.secs ?? 6);
const PUBLIC = resolve(ROOT, 'public', '3d');
const ids = opts._.length ? opts._ : readdirSync(PUBLIC).filter((d) => !d.startsWith('_') && existsSync(resolve(PUBLIC, d, 'scene.json')));
const SIZES = [
  { ctx: 'card', w: 1170, h: 505, dpr: 1.5, budget: 8 },
  { ctx: 'case', w: 1184, h: 740, dpr: 2, budget: 14 },
];
const results = [];

for (const discrete of [true, false]) {
  const { browser } = await launch({ discrete });
  for (const id of ids) {
    for (const s of SIZES) {
      const context = await browser.newContext({ viewport: { width: s.w + 40, height: s.h + 80 }, deviceScaleFactor: s.dpr });
      const page = await context.newPage();
      const errors = watchConsole(page);
      await page.goto(`${opts.url}/qa/3d.html?id=${id}&w=${Math.round(s.w * s.dpr)}&h=${Math.round(s.h * s.dpr)}&context=${s.ctx}&3d=force`);
      await page.evaluate(() => window.qa.ready);
      const gpu = await gpuName(page);
      await page.waitForTimeout(2500); // warm up: shaders, the first uploads, the tour
      // Frame cost, not frame pacing: headless Chromium paces rAF on its own
      // (alternate frames wait ~16 ms whatever the work), so each frame is
      // stepped by hand and timed until the GPU has finished it.
      const t = await page.evaluate(async (secs) => {
        const { slot, engine } = window.qa;
        const gl = engine.renderer.getContext();
        const px = new Uint8Array(4);
        slot.setActive(false); // the page's own loop stops; frames are stepped here
        const d = [];
        const end = performance.now() + secs * 1000;
        while (performance.now() < end) {
          const t0 = performance.now();
          slot.update(1 / 60);
          engine.draw(slot);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // waits for the GPU
          d.push(performance.now() - t0);
          if (d.length % 20 === 0) await new Promise((r) => setTimeout(r, 0));
        }
        d.sort((a, b) => a - b);
        const q = (p) => d[Math.min(d.length - 1, Math.floor(p * d.length))];
        const one = window.qa.frameStats(); // one frame's draw calls and triangles
        return { frames: d.length, median: q(0.5), p95: q(0.95), quality: engine.info().quality, calls: one.calls, tris: one.triangles };
      }, SECS);
      const label = `${discrete ? 'discrete' : 'integrated'} ${id} ${s.ctx}`;
      // The budget is on the median; p95 is reported (it includes the forced
      // GPU sync each frame, which a real frame never waits for).
      const ok = !discrete || t.median <= s.budget;
      results.push({ label, ok });
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: median ${t.median.toFixed(1)} ms, p95 ${t.p95.toFixed(1)} ms${discrete ? ` (budget ${s.budget})` : ''}, quality ${t.quality}, ${t.calls} calls, ${(t.tris / 1000).toFixed(0)}k tris · ${gpu.replace(/^ANGLE \(|, D3D11\)$/g, '').split(' (')[0]}${errors.length ? ` · ${errors.length} console errors` : ''}`);
      await context.close();
    }
  }
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
