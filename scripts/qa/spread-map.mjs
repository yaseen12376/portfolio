/**
 * Where people went: a top-down map of one long simulated run, per scene.
 *
 *   node scripts/qa/spread-map.mjs [ids...] [--url http://localhost:3000] [--secs 150] [--seed 1]
 *
 * The walk grid (fixtures dark, floor grey), each district's outline or
 * stations with its share of the run in use, and every figure's track by
 * role: a thin line while walking, a dot where they stood. Writes
 * build/qa/spread-<id>.png. The trace only reads positions (qa.simulate's
 * `trace`), so the run is the one sim.mjs measures from the same start.
 */
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import sharp from 'sharp';

import { OUT, ROOT, args, bench, ensureOut, launch, watchConsole } from './lib.mjs';

const opts = args();
const SECS = Number(opts.secs ?? 150);
const SEED = Number(opts.seed ?? 1);
const PUBLIC = resolve(ROOT, 'public', '3d');
const ids = opts._.length ? opts._ : readdirSync(PUBLIC).filter((d) => !d.startsWith('_') && existsSync(resolve(PUBLIC, d, 'scene.json')));
const PX = 90; // pixels a metre
const COLORS = ['#38bdf8', '#fbbf24', '#a78bfa', '#34d399', '#fb6f8a', '#f97316', '#e879f9'];

await ensureOut();
const { browser, context } = await launch({ discrete: true });
const page = await context.newPage();
const errors = watchConsole(page);
for (const id of ids) {
  await bench(page, opts.url, id, { w: 800, h: 500, seed: SEED, still: true });
  const run = await page.evaluate((secs) => {
    const r = window.qa.simulate(secs, 1 / 30, { trace: 0.5 });
    const c = window.qa.slot.controller;
    const g = c.grid;
    const D = c.districts;
    return {
      trace: r.trace,
      lit: r.spread?.lit ?? {},
      grid: g && { x0: g.x0, z0: g.z0, cell: g.cell, w: g.w, h: g.h, raw: [...g.raw] },
      districts: (D?.defs ?? []).map((d) => ({ name: d.name, poly: d.poly ?? null, key: !!d.key, feature: !!d.feature, stations: D.stations(d).map((s) => [s.x, s.z]) })),
    };
  }, SECS);
  if (!run.grid) {
    console.log(`${id}: no walk grid, skipped`);
    continue;
  }
  const { x0, z0, cell, w: gw, h: gh, raw } = run.grid;
  const W = Math.round(gw * cell * PX);
  const H = Math.round(gh * cell * PX);
  const X = (x) => Math.round((x - x0) * PX * 10) / 10;
  const Z = (z) => Math.round((z - z0) * PX * 10) / 10;
  const svg = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 40}"><rect width="${W}" height="${H + 40}" fill="#09090b"/>`];
  // The grid: blocked cells dark, open floor grey.
  const s = cell * PX;
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) if (!raw[j * gw + i]) svg.push(`<rect x="${(i * s).toFixed(1)}" y="${(j * s).toFixed(1)}" width="${(s + 0.5).toFixed(1)}" height="${(s + 0.5).toFixed(1)}" fill="#27272a"/>`);
  }
  // Districts.
  for (const d of run.districts) {
    const col = d.key ? '#fbbf24' : d.feature ? '#71717a' : '#3f3f46';
    if (d.poly?.length) svg.push(`<polygon points="${d.poly.map(([x, z]) => `${X(x)},${Z(z)}`).join(' ')}" fill="none" stroke="${col}" stroke-dasharray="6 4" stroke-width="1.5"/>`);
    for (const [x, z] of d.stations) svg.push(`<rect x="${X(x) - 4}" y="${Z(z) - 4}" width="8" height="8" fill="none" stroke="${col}" stroke-width="1.5"/>`);
    const at = d.poly?.length ? d.poly[0] : d.stations[0];
    if (at) svg.push(`<text x="${X(at[0])}" y="${Z(at[1]) - 7}" fill="${col}" font-family="monospace" font-size="12">${d.name}${run.lit[d.name] != null ? ` ${run.lit[d.name]}%` : ''}</text>`);
  }
  // Tracks: a line while walking, a dot where they stood.
  const roles = [...new Set(run.trace.people.map((p) => p.role))];
  for (const p of run.trace.people) {
    const col = COLORS[roles.indexOf(p.role) % COLORS.length];
    let seg = [];
    const flush = () => {
      if (seg.length > 1) svg.push(`<polyline points="${seg.join(' ')}" fill="none" stroke="${col}" stroke-opacity="0.35" stroke-width="1.2"/>`);
      seg = [];
    };
    for (const pt of p.pts) {
      if (!pt) {
        flush(); // off the island
        continue;
      }
      const [x, z, still] = pt;
      seg.push(`${X(x)},${Z(z)}`);
      if (still) svg.push(`<circle cx="${X(x)}" cy="${Z(z)}" r="2.2" fill="${col}" fill-opacity="0.45"/>`);
    }
    flush();
  }
  svg.push(`<text x="10" y="${H + 26}" fill="#a1a1aa" font-family="monospace" font-size="13">${id} · seed ${SEED} · ${SECS} s · ${roles.map((r, k) => `<tspan fill="${COLORS[k % COLORS.length]}">${r}</tspan>`).join(' ')} · dots: standing, dashes: district outlines (amber: key)</text></svg>`);
  const file = resolve(OUT, `spread-${id}.png`);
  await sharp(Buffer.from(svg.join(''))).png().toFile(file);
  console.log(`${id}: ${file}`);
}
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
await browser.close();
