/**
 * Frame cost on the real GPUs: each frame stepped and timed until the GPU
 * has finished it (CPU simulation + draw + GPU work):
 *
 *   node scripts/qa/perf.mjs [ids...] [--url http://localhost:3000] [--secs 6]
 *
 * For each diorama, on the bench, its stage (733 px square, as at 1440 x 900,
 * pixel ratio 1.5) and a case study (1184 x 740, pixel ratio 2) run; for
 * each live jar, its case study at 1440 x 900 (pixel ratio 2), the jar
 * turning and then lifted. First on the discrete GPU (median budgets: 8 ms a
 * stage, 14 ms a diorama's case study, 8 ms a jar's) and then on the
 * integrated one, where the numbers are reported.
 *
 * A jar is first left to the page's own loop, as a visitor's would be: where
 * its frames come late, the engine steps its quality down by itself (engine.js
 * measure). From its eighth second, over four more, at most one frame in
 * twenty may come late, on either GPU, at whatever quality it settled on
 * (reported; on the discrete GPU it must stay at the best).
 */
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { ROOT, args, gpuName, launch, liveJarIds, onJar, openJar, watchConsole } from './lib.mjs';

const opts = args();
const SECS = Number(opts.secs ?? 6);
const PUBLIC = resolve(ROOT, 'public', '3d');
const jars = liveJarIds();
const ids = opts._.length ? opts._.filter((id) => !jars.includes(id)) : readdirSync(PUBLIC).filter((d) => !d.startsWith('_') && existsSync(resolve(PUBLIC, d, 'scene.json')));
const jarIds = opts._.length ? opts._.filter((id) => jars.includes(id)) : jars;
const SIZES = [
  { ctx: 'stage', w: 733, h: 733, dpr: 1.5, budget: 8 },
  { ctx: 'case', w: 1184, h: 740, dpr: 2, budget: 14 },
];
const JAR = { w: 1440, h: 900, dpr: 2, budget: 8 };
const results = [];
const gpuLabel = (gpu) => gpu.replace(/^ANGLE \(|, D3D11\)$/g, '').split(' (')[0];

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
      if (/SwiftShader/i.test(gpu)) console.log(`     (${gpu}: a software renderer, so these timings mean nothing; run perf on a machine with a GPU)`);
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
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: median ${t.median.toFixed(1)} ms, p95 ${t.p95.toFixed(1)} ms${discrete ? ` (budget ${s.budget})` : ''}, quality ${t.quality}, ${t.calls} calls, ${(t.tris / 1000).toFixed(0)}k tris · ${gpuLabel(gpu)}${errors.length ? ` · ${errors.length} console errors` : ''}`);
      await context.close();
    }
  }

  // Each live jar in its case study: turning by itself, then with the glass
  // lifted (the inside then seen past the glass as well as through it).
  for (const id of jarIds) {
    const context = await browser.newContext({ viewport: { width: JAR.w, height: JAR.h }, deviceScaleFactor: JAR.dpr });
    const page = await context.newPage();
    const errors = watchConsole(page);
    await openJar(page, opts.url, id);
    const gpu = await gpuName(page);
    if (/SwiftShader/i.test(gpu)) console.log(`     (${gpu}: a software renderer, so these timings mean nothing; run perf on a machine with a GPU)`);
    // The page's own loop: settled by its eighth second, then frames on time.
    await page.waitForTimeout(8000);
    const pace = await page.evaluate(async (secs) => {
      const gaps = [];
      let last = 0;
      await new Promise((done) => {
        const end = performance.now() + secs * 1000;
        const f = (t) => {
          if (last) gaps.push(t - last);
          last = t;
          if (t < end) requestAnimationFrame(f);
          else done();
        };
        requestAnimationFrame(f);
      });
      const display = Math.max(Math.min(...gaps), 1000 / 60);
      return { frames: gaps.length, late: gaps.filter((g) => g > display * 1.45).length, quality: window.__three.info().quality };
    }, 4);
    {
      const label = `${discrete ? 'discrete' : 'integrated'} ${id} jar, its own loop`;
      const ok = pace.late <= pace.frames / 20 && (!discrete || pace.quality === 0);
      results.push({ label, ok });
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${pace.frames} frames in 4 s, ${pace.late} late, settled at quality ${pace.quality}`);
    }
    const t = await onJar(
      page,
      async (slot, secs, engine) => {
        const gl = engine.renderer.getContext();
        const px = new Uint8Array(4);
        slot.setActive(false); // the page's own loop stops; frames are stepped here
        const run = async () => {
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
          return { median: q(0.5), p95: q(0.95), frames: d.length };
        };
        const turning = await run();
        slot.controller.onClick({ kind: 'glass' });
        const lifted = await run();
        slot.controller.onClick({ kind: 'glass' });
        engine.renderer.info.reset();
        engine.draw(slot); // one frame's draw calls and triangles
        const i = engine.renderer.info.render;
        return { turning, lifted, w: slot.px.w, h: slot.px.h, quality: engine.info().quality, calls: i.calls, tris: i.triangles };
      },
      SECS / 2
    );
    const label = `${discrete ? 'discrete' : 'integrated'} ${id} jar`;
    const ok = !discrete || (t.turning.median <= JAR.budget && t.lifted.median <= JAR.budget);
    results.push({ label, ok });
    const ms = (r) => `median ${r.median.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms`;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} (${t.w} x ${t.h}): turning ${ms(t.turning)}; lifted ${ms(t.lifted)}${discrete ? ` (budget ${JAR.budget})` : ''}, quality ${t.quality}, ${t.calls} calls, ${(t.tris / 1000).toFixed(0)}k tris · ${gpuLabel(gpu)}${errors.length ? ` · ${errors.length} console errors` : ''}`);
    await context.close();
  }
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
