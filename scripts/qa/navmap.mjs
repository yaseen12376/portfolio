/**
 * The floor as the figures see it, as a picture: build/qa/nav-<id>.png.
 * Black: walls and fixtures; grey: the clearance a figure keeps from them
 * (the dilation); white: walkable. Moving pieces are stamped where they
 * start (orange); named spots are dots (green reachable from the first
 * spot, red not), zones are outlined.
 *
 *   node scripts/qa/navmap.mjs [id]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import sharp from 'sharp';

import { ROOT, ensureOut } from './lib.mjs';

const id = process.argv[2] ?? 'retail-analytics';
const scene = JSON.parse(readFileSync(resolve(ROOT, 'public', '3d', id, 'scene.json'), 'utf8'));
const nav = scene.nav;
const { NavGrid, footprint } = await import(new URL('../../src/three/sim/grid.js', import.meta.url));
globalThis.atob ??= (b) => Buffer.from(b, 'base64').toString('binary');
const g = new NavGrid(nav, { radius: 0.2 });
// Moving pieces where the page stamps them at start.
const anchors = {};
for (const [name, fp] of Object.entries(scene.footprints ?? {})) {
  // Positions of dyn objects are not in scene.json; the spots carry the rails.
  anchors[name] = fp;
}
const S = 8;
const W = g.w * S;
const H = g.h * S;
const px = Buffer.alloc(W * H * 3);
for (let j = 0; j < g.h; j++) {
  for (let i = 0; i < g.w; i++) {
    const c = j * g.w + i;
    const col = g.raw[c] ? [20, 20, 24] : g.occ[c] ? [150, 150, 160] : [245, 244, 240];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) px.set(col, ((j * S + y) * W + i * S + x) * 3);
  }
}
const svg = [];
const X = (x) => ((x - g.x0) / g.cell) * S;
const Z = (z) => ((z - g.z0) / g.cell) * S;
for (const [name, pts] of Object.entries(scene.zones ?? {})) {
  svg.push(`<polygon points="${pts.map((p) => `${X(p[0])},${Z(p[2])}`).join(' ')}" fill="none" stroke="#8b5cf6" stroke-width="2"/>`);
  svg.push(`<text x="${X(pts[0][0]) + 4}" y="${Z(pts[0][2]) + 14}" font-size="12" fill="#6d28d9" font-family="monospace">${name}</text>`);
}
const spots = Object.entries(scene.spots ?? {});
const start = spots.find(([k]) => k === 'in_in') ?? spots[0];
for (const [name, s] of spots) {
  const p = g.path([start[1].at[0], start[1].at[2]], [s.at[0], s.at[2]]);
  const ok = !!p && Math.hypot(p[p.length - 1][0] - s.at[0], p[p.length - 1][1] - s.at[2]) < 0.3;
  svg.push(`<circle cx="${X(s.at[0])}" cy="${Z(s.at[2])}" r="5" fill="${s.fixed ? '#71717a' : ok ? '#06d6a0' : '#f0506e'}" stroke="#000" stroke-width="1"/>`);
  svg.push(`<text x="${X(s.at[0]) + 7}" y="${Z(s.at[2]) + 4}" font-size="11" fill="#111" font-family="monospace">${name}</text>`);
}
const out = await ensureOut();
await sharp(px, { raw: { width: W, height: H, channels: 3 } })
  .composite([{ input: Buffer.from(`<svg width="${W}" height="${H}">${svg.join('')}</svg>`) }])
  .png()
  .toFile(resolve(out, `nav-${id}.png`));
console.log(`nav map: build/qa/nav-${id}.png (${g.w}x${g.h} cells, spots ${spots.length})`);
void anchors;
void footprint;
