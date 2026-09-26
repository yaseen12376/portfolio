/**
 * Every diorama check, in order, against a running dev server:
 *
 *   npm run qa:3d            (npm run dev in another terminal first)
 *   node scripts/qa/all.mjs [--url http://localhost:3000] [--skip parity,gate]
 *
 *   features  each chapter operates its feature through the simulation
 *   sim       the crowd's invariants: no pops outside portals, no jumps, no overlaps
 *   parity    the live frame against the Cycles poster it replaces
 *   framing   composition and safe areas at card, case, full-screen and phone sizes
 *   site      the real page end to end: live cards, orbit, the explorer, no leaks
 *   gate      who gets 3D (reduced motion, Save-Data, no WebGL2, phones) and the bundle
 *   perf      frame cost on the discrete and integrated GPUs
 *
 * Exits non-zero if any suite fails; prints one line per suite at the end.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { args } from './lib.mjs';

const opts = args();
const skip = new Set(String(opts.skip ?? '').split(',').filter(Boolean));
const SUITES = ['features', 'sim', 'parity', 'framing', 'site', 'gate', 'perf'];
const summary = [];

for (const name of SUITES) {
  if (skip.has(name)) continue;
  console.log(`\n=== ${name}`);
  const t = Date.now();
  const r = spawnSync(process.execPath, [resolve(import.meta.dirname, `${name}.mjs`), '--url', opts.url], { stdio: 'inherit' });
  summary.push({ name, ok: r.status === 0, secs: ((Date.now() - t) / 1000).toFixed(0) });
}

console.log('\n=== summary');
for (const s of summary) console.log(`${s.ok ? 'ok  ' : 'FAIL'} ${s.name.padEnd(9)} ${s.secs} s`);
process.exit(summary.every((s) => s.ok) ? 0 : 1);
