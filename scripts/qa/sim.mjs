/**
 * The simulation's invariants, on the bench, per scene:
 *
 *   node scripts/qa/sim.mjs [ids...] [--url http://localhost:3000] [--secs 150]
 *
 * Over a long run of trading, then a switch to after hours and back (where a
 * scene has one), checks that:
 *   - nobody appears or disappears outside a portal (people only come and go
 *     through places at the island's edge that hide them)
 *   - nobody moves further in one step than 2.5x what walking allows (no jumps)
 *   - no pair overlaps beyond brushing shoulders (8 cm) for longer than 0.3 s
 *   - nobody stands inside a wall or a fixture
 *   - a party stays together: spread beyond 3 m at most 15% of the time and
 *     never for more than 20 s at a stretch (a follower walking the long way
 *     round a fixture, say the queue rope, to catch up; a family that has
 *     split up would be apart far longer)
 */
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { ROOT, args, bench, launch, watchConsole } from './lib.mjs';

const opts = args();
const SECS = Number(opts.secs ?? 150);
const PUBLIC = resolve(ROOT, 'public', '3d');
const ids = opts._.length ? opts._ : readdirSync(PUBLIC).filter((d) => !d.startsWith('_') && existsSync(resolve(PUBLIC, d, 'scene.json')));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`);
};

const { browser, context } = await launch({ discrete: true });
const page = await context.newPage();
const errors = watchConsole(page);
for (const id of ids) {
  await bench(page, opts.url, id, { w: 800, h: 500 });
  const runs = await page.evaluate((secs) => {
    const out = [window.qa.simulate(secs)];
    // After hours and back, where the scene has it: everyone leaves, someone comes and goes.
    const ch = window.qa.slot.chapters;
    const sec = ch?.list?.find((c) => c.actions?.().some((a) => a.id === 'hours'));
    if (sec) {
      ch.go(sec.id);
      out.push(window.qa.simulate(60, 1 / 30, { during: (t) => (Math.abs(t - 1) < 0.02 || Math.abs(t - 40) < 0.02) && ch.act('hours') }));
    }
    return out;
  }, SECS);
  const all = (k, f) => runs.map((r) => r[k]).reduce((a, b) => f(a, b));
  const popped = runs.flatMap((r) => r.popped);
  check(`${id}: nobody appears or vanishes outside a portal`, popped.length === 0, popped.slice(0, 3).join(' | '));
  check(`${id}: no jumps`, all('maxJump', Math.max) <= 2.5, `largest step ${all('maxJump', Math.max)}x walking`);
  const long = all('overlapLong', Math.max);
  check(`${id}: nobody overlaps`, long <= 0.3, `closest ${all('minGap', Math.min)} m, longest deep overlap ${long} s${long > 0.3 ? ` · ${runs.find((r) => r.overlapLong > 0.3)?.overlapAt}` : ''}`);
  check(`${id}: nobody inside a wall or fixture`, all('insideObstacle', (a, b) => a + b) === 0);
  const spread = all('partySpread', Math.max);
  const spreadLong = all('partySpreadLong', Math.max);
  check(`${id}: parties stay together`, spread <= 15 && spreadLong <= 20, `spread out ${spread}% of the time, longest ${spreadLong} s, furthest ${all('followerMax', Math.max)} m`);
}
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
