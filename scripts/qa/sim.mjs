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
 * and what you see (movement v3):
 *   - limbs: spheres over every figure's animated skeleton never push more
 *     than 5 cm into another figure's, nor more than 2 cm for longer than 0.3 s
 *   - arms clear fixtures while walking: over 4 cm into one at most once a
 *     minute, over all the time simulated
 *   - personal space: 95% of passing encounters keep at least 5 cm between bodies
 *   - no bumps (walking into someone and stopping), and the last resorts
 *     (sidesteps, wedged pairs) at most 2 a minute, asking someone standing
 *     to make way at most 4, giving up an errand at most 3
 *   - the scene keeps moving: where it counts visitors, at least 7 come in
 *     (a crossing of the door every 10 s or so, with the exits) and 5 buy in
 *     the run
 * and, where the scene has districts (sim/spread.js), that people spread out:
 *   - nobody piles up: of the people standing about (at a rail, a table,
 *     waiting), at most one other within a metre of anyone 95% of the time
 *     (a queue and a party's own members aside); four stopped in a knot (a
 *     jam at a junction) sorted out within 3 s; with the walkers counted
 *     too, at most two others 95% of the time
 *   - many things at once, all over: on average three and a half or more
 *     districts in use at any moment (about as many as seven customers and
 *     the staff can fill, spread out), two or more 90% of the time; every
 *     feature district in use at least a fifth of the time, the till and
 *     the booths 30%
 *   - no district holds more groups than it should for longer than 8 s
 *   - the entrance is walked through: under one person in it on average,
 *     nobody standing in it for more than 3 s (bar the lingering feature)
 *   - variety: four or more different things customers are doing in a
 *     typical 10 s, fewer than two in no more than one 10 s stretch of a
 *     run; visits take in 1.6 districts or more
 *   - staff apart: two members of staff standing within 1.5 m of each other
 *     at most 15% of the time
 * Each scene is run from --seeds different random starts (default 1,2).
 */
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { ROOT, args, bench, launch, watchConsole } from './lib.mjs';

const opts = args();
const SECS = Number(opts.secs ?? 150);
const SEEDS = String(opts.seeds ?? '1,2').split(',').map(Number);
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
  const runs = [];
  for (const seed of SEEDS) {
  await bench(page, opts.url, id, { w: 800, h: 500, seed });
  runs.push(...(await page.evaluate((secs) => {
    const out = [window.qa.simulate(secs)];
    // After hours and back, where the scene has it: everyone leaves, someone comes and goes.
    const ch = window.qa.slot.chapters;
    const sec = ch?.list?.find((c) => c.actions?.().some((a) => a.id === 'hours'));
    if (sec) {
      ch.go(sec.id);
      out.push(window.qa.simulate(60, 1 / 30, { during: (t) => (Math.abs(t - 1) < 0.02 || Math.abs(t - 40) < 0.02) && ch.act('hours') }));
    }
    const store = window.qa.slot.controller.store;
    out[0].flow = store ? { entries: store.entries, sales: store.sales } : null;
    return out;
  }, SECS)));
  }
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
  // What you see.
  const deep = all('limbDeep', Math.max);
  const deepLong = all('limbLong', Math.max);
  check(`${id}: limbs never push into another figure`, deep <= 0.05 && deepLong <= 0.3, `deepest ${(deep * 100).toFixed(1)} cm, longest over 2 cm ${deepLong} s · ${runs.find((r) => r.limbDeep === deep)?.limbAt}`);
  const arm = all('armClip', Math.max);
  // Over all the time simulated (a rate, not the worst minute of one run).
  const armRate = +(runs.reduce((n, r) => n + (r.armClipsPerMin ?? 0) * (r.steps / 30 / 60), 0) / (runs.reduce((n, r) => n + r.steps / 30, 0) / 60)).toFixed(2);
  const armRun = [...runs].sort((x, y) => (y.armClipsPerMin ?? 0) - (x.armClipsPerMin ?? 0))[0];
  check(`${id}: arms clear fixtures while walking`, armRate <= 1, `${armRate} times a minute an arm goes over 4 cm into a table, counter or wall (brushing a rail's clothes aside; deepest of any kind ${(arm * 100).toFixed(1)} cm)${armRate > 1 ? ` · ${armRun?.armWhere.slice(0, 3).join(' | ')}` : ''}`);
  const gap5 = Math.min(...runs.filter((r) => r.passGap5 != null).map((r) => r.passGap5));
  check(`${id}: personal space when passing`, gap5 >= 0.05, `95% of passes keep ${(gap5 * 100).toFixed(1)} cm or more`);
  const main = runs.filter((r) => r.flow !== undefined);
  const perMin = (k) => Math.max(...main.map((r) => ((r.fallbacks?.[k] ?? 0) / SECS) * 60));
  check(`${id}: no bumps`, all('bumpsPerMin', Math.max) <= 0.5, `${all('bumpsPerMin', Math.max)} a minute`);
  check(`${id}: last resorts are rare`, Math.max(...main.map((r) => (((r.fallbacks?.sidestep ?? 0) + (r.fallbacks?.wedged ?? 0)) / SECS) * 60)) <= 2 && perMin('makeWay') <= 4 && perMin('gaveUp') <= 3,
    `a minute at most: sidesteps and wedged ${Math.max(...main.map((r) => (((r.fallbacks?.sidestep ?? 0) + (r.fallbacks?.wedged ?? 0)) / SECS) * 60)).toFixed(1)}, make way ${perMin('makeWay').toFixed(1)}, gave up ${perMin('gaveUp').toFixed(1)}`);
  const sp = main.map((r) => r.spread).filter(Boolean);
  if (sp.length) {
    const max = (k) => Math.max(...sp.map((r) => r[k]));
    const min = (k) => Math.min(...sp.map((r) => r[k]));
    check(`${id}: nobody piles up`, max('stillP95') <= 2 && max('knotLong') <= 3 && max('dense1p95') <= 3,
      `standing within 1 m of anyone, 95% of the time: ${max('stillP95')}; a knot of four lasted at most ${max('knotLong')} s (most ever ${max('stillMax')}${max('knotLong') > 3 ? ` · ${sp.find((r) => r.stillMax === max('stillMax'))?.stillAt}` : ''}); walkers too: ${max('dense1p95')}`);
    const lit = Object.keys(sp[0].lit);
    const low = lit.filter((k) => sp.some((r) => r.lit[k] < (['till', 'fitting'].includes(k) ? 30 : 20)));
    check(`${id}: many things at once, all over the store`, min('litMean') >= 3.5 && min('litP10') >= 2 && low.length === 0,
      `districts in use at once: ${min('litMean')} on average, ${min('litP10')} or more 90% of the time · ${lit.map((k) => `${k} ${Math.min(...sp.map((r) => r.lit[k]))}%`).join(', ')}`);
    check(`${id}: no district holds too many`, max('doubleLong') <= 8, `longest ${max('doubleLong')} s${max('doubleLong') > 8 ? ` · ${sp.find((r) => r.doubleLong === max('doubleLong'))?.doubleAt}` : ''}`);
    check(`${id}: the entrance is walked through`, max('entranceMean') <= 1 && max('entranceLong') <= 3,
      `${max('entranceMean')} people in it on average, longest anyone stood there ${max('entranceLong')} s${max('entranceLong') > 3 ? ` · ${sp.find((r) => r.entranceLong === max('entranceLong'))?.entranceAt}` : ''}`);
    check(`${id}: customers doing different things`, min('activitiesMean') >= 4 && min('activitiesLow') >= 2 && min('districtsPerVisit') >= 1.6,
      `${min('activitiesMean')} activities in a typical 10 s (fewest ${min('activitiesMin')}, then ${min('activitiesLow')}); ${min('districtsPerVisit')} districts a visit`);
    check(`${id}: staff apart`, max('staffStill') <= 15, `two standing within 1.5 m ${max('staffStill')}% of the time${max('staffStill') > 15 ? ` · ${sp.find((r) => r.staffStill === max('staffStill'))?.staffPairs.join(', ')}` : ''}`);
  }
  const flows = main.map((r) => r.flow).filter(Boolean);
  if (flows.length) check(`${id}: the store keeps moving`, flows.every((f) => f.entries >= 7 && f.sales >= 5), flows.map((f) => `${f.entries} in, ${f.sales} sales`).join(' · '));
}
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
