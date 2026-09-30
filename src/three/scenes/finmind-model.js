/**
 * FinMind's own arithmetic, ported line for line from the product
 * (HYDRABATH_HACK/ai-money-mentor, backend/src/main/java/ai/money/mentor/backend)
 * so the diorama recomputes what the product computes instead of replaying
 * canned numbers:
 *
 *  - engine/FireProjection.simulate: 1,000 scenarios on java.util.Random(42),
 *    including Java's LCG and its polar nextGaussian, so the bands match the
 *    product to the rupee;
 *  - engine/FireProjection.solveSip and the FIRE number;
 *  - engine/TaxEngine: slabs, the rebate with marginal relief, surcharge, 4%
 *    cess, rounding to 10, and the old regime's break-even (salary income);
 *  - rag/KnowledgeService: reciprocal-rank fusion, k = 60, top 4;
 *  - safety/SafetyLayer: the numbers check (2% or 100 either way; x12 and /12
 *    of each engine figure allowed) and the trust weights.
 *
 * Plain functions, no three.js, so the QA can check them in Node too.
 */

// ---------------------------------------------------------------- rules (rules/limits.json, rules/tax-*.json)
export const ASSUMPTIONS = { inflationPct: 6, equityReturnPct: 12, debtReturnPct: 7, withdrawalRatePct: 3.5, equityVolatilityPct: 18, debtVolatilityPct: 4, hybridReturnPct: 9.5 };
export const GLIDE = [[15, 80], [8, 70], [3, 50], [0, 30]]; // [minYearsLeft, equityPct]
export const SCENARIOS = 1000;

const NEW_SLABS = [[400000, 0], [800000, 5], [1200000, 10], [1600000, 15], [2000000, 20], [2400000, 25], [null, 30]];
const OLD_SLABS = [[250000, 0], [500000, 5], [1000000, 20], [null, 30]];
const NEW_SURCHARGE = [[5000000, 10], [10000000, 15], [20000000, 25]];
const OLD_SURCHARGE = [[5000000, 10], [10000000, 15], [20000000, 25], [50000000, 37]];
export const TAX_YEARS = {
  '2025-26': {
    label: 'FY 2025-26 (AY 2026-27)', act: 'Income-tax Act, 1961',
    newRegime: { slabs: NEW_SLABS, std: 75000, rebate: { section: '87A', former: null, max: 60000, limit: 1200000, relief: true }, surcharge: NEW_SURCHARGE, section: '115BAC' },
    oldRegime: { slabs: OLD_SLABS, std: 50000, rebate: { section: '87A', former: null, max: 12500, limit: 500000, relief: false }, surcharge: OLD_SURCHARGE },
    sections: { sec80C: ['80C', null], sec80D: ['80D', null], sec80CCD1B: ['80CCD(1B)', null], employerNps: ['80CCD(2)', null], homeLoan: ['24(b)', null] },
  },
  '2026-27': {
    label: 'Tax Year 2026-27', act: 'Income-tax Act, 2025',
    newRegime: { slabs: NEW_SLABS, std: 75000, rebate: { section: '156', former: '87A', max: 60000, limit: 1200000, relief: true }, surcharge: NEW_SURCHARGE, section: '202' },
    oldRegime: { slabs: OLD_SLABS, std: 50000, rebate: { section: '156', former: '87A', max: 12500, limit: 500000, relief: false }, surcharge: OLD_SURCHARGE },
    sections: { sec80C: ['123', '80C'], sec80D: ['126', '80D'], sec80CCD1B: ['124', '80CCD(1B)'], employerNps: ['124', '80CCD(2)'], homeLoan: ['22', '24(b)'] },
  },
};
export const CESS_PCT = 4;
export const DEDUCTION_LIMITS = { sec80C: 150000, sec80D: 25000, sec80CCD1B: 50000 };

// ---------------------------------------------------------------- java.util.Random
// A 48-bit linear congruential generator, kept in two 24-bit halves so plain
// doubles hold every intermediate exactly.
const MUL_HI = 0x5de; // 0x5DEECE66D = 0x5DE * 2^24 + 0xECE66D
const MUL_LO = 0xece66d;
const TWO24 = 16777216;

export function javaRandom(seed) {
  // (seed ^ 0x5DEECE66D) & (2^48 - 1), for a small non-negative seed.
  let hi = (Math.floor(seed / TWO24) ^ MUL_HI) % TWO24;
  let lo = ((seed % TWO24) ^ MUL_LO) >>> 0;
  let nextNext = 0;
  let haveNext = false;
  function next(bits) {
    // seed = seed * 0x5DEECE66D + 0xB (mod 2^48)
    const l = lo * MUL_LO + 0xb;
    const carry = Math.floor(l / TWO24);
    const nlo = l - carry * TWO24;
    const h = (hi * MUL_LO + lo * MUL_HI + carry) % TWO24;
    hi = h;
    lo = nlo;
    // (int)(seed >>> (48 - bits)): the top `bits` bits, as a signed 32-bit int.
    const top = hi * TWO24 + lo; // < 2^48, exact
    const v = Math.floor(top / 2 ** (48 - bits));
    return v | 0;
  }
  function nextDouble() {
    return ((next(26) >>> 0) * 134217728 + (next(27) >>> 0)) / 9007199254740992;
  }
  function nextGaussian() {
    if (haveNext) {
      haveNext = false;
      return nextNext;
    }
    let v1;
    let v2;
    let s;
    do {
      v1 = 2 * nextDouble() - 1;
      v2 = 2 * nextDouble() - 1;
      s = v1 * v1 + v2 * v2;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    nextNext = v2 * m;
    haveNext = true;
    return v1 * m;
  }
  return { next, nextDouble, nextGaussian };
}

// ---------------------------------------------------------------- FIRE
export const equityPct = (yearsLeft) => GLIDE.find(([min]) => yearsLeft >= min)?.[1] ?? 30;
const blended = (as, yearsLeft) => {
  const eq = equityPct(yearsLeft) / 100;
  return eq * as.equityReturnPct + (1 - eq) * as.debtReturnPct;
};

/** The FIRE number: today's annual expenses, inflated to retirement, over the withdrawal rate. */
export function fireNumber(monthlyExpenses, years, as = ASSUMPTIONS) {
  const atRetire = monthlyExpenses * 12 * (1 + as.inflationPct / 100) ** years;
  return { annualToday: monthlyExpenses * 12, atRetire, fireNumber: atRetire / (as.withdrawalRatePct / 100) };
}

function corpus(c0, sip, years, as) {
  let c = c0;
  for (let y = 1; y <= years; y++) {
    const r = blended(as, years - (y - 1)) / 100 / 12;
    for (let m = 0; m < 12; m++) c = c * (1 + r) + sip;
  }
  return c;
}

/** The monthly SIP that makes the glide-path projection reach the target: bisection, then up to the next 100. */
export function solveSip(corpus0, years, target, as = ASSUMPTIONS) {
  if (corpus(corpus0, 0, years, as) >= target) return 0;
  let lo = 0;
  let hi = target / 12;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (corpus(corpus0, mid, years, as) >= target) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi / 100) * 100;
}

/**
 * 1,000 market scenarios: each year a return drawn for equity (sigma 18%) and
 * debt (sigma 4%), blended by the glide path, the year's SIP added half-grown.
 * Returns the success rate and every path (for drawing), plus P10/P50/P90.
 */
export function simulate({ corpus0, sip, years, age, target, as = ASSUMPTIONS, keep = false }) {
  const rnd = javaRandom(42);
  const n = SCENARIOS;
  const paths = Array.from({ length: years + 1 }, () => new Float64Array(n));
  let success = 0;
  for (let s = 0; s < n; s++) {
    let c = corpus0;
    paths[0][s] = c;
    for (let y = 1; y <= years; y++) {
      const eq = equityPct(years - (y - 1)) / 100;
      const re = as.equityReturnPct + rnd.nextGaussian() * as.equityVolatilityPct;
      const rd = as.debtReturnPct + rnd.nextGaussian() * as.debtVolatilityPct;
      const r = eq * re + (1 - eq) * rd;
      c = c * (1 + r / 100) + sip * 12 * (1 + r / 200);
      c = Math.max(0, c);
      paths[y][s] = c;
    }
    if (c >= target) success++;
  }
  const bands = paths.map((col, y) => {
    const v = Float64Array.from(col).sort();
    return { age: age + y, p10: v[Math.floor(n * 0.1)], p50: v[n / 2], p90: v[Math.floor(n * 0.9)] };
  });
  return { successPct: (success * 100) / n, bands, paths: keep ? paths : null };
}

// ---------------------------------------------------------------- tax
const roundTo = (v, step) => Math.round(v / step) * step;
const slabTaxOn = (taxable, slabs) => {
  let tax = 0;
  let prev = 0;
  const lines = [];
  for (const [upTo, rate] of slabs) {
    const upper = upTo ?? Infinity;
    if (taxable > prev) {
      const inSlab = Math.min(taxable, upper) - prev;
      const t = Math.round(inSlab * rate) / 100; // BigDecimal, 2 places, half up
      tax += t;
      lines.push({ from: prev, upTo, rate, amount: inSlab, tax: t });
    }
    prev = upper;
    if (taxable <= upper) break;
  }
  return { tax, lines };
};

/**
 * One regime's tax on a salary (TaxEngine.compute, salary income only):
 * gross less the standard deduction and deductions, rounded to 10, through
 * the slabs; the rebate or its marginal relief; surcharge with relief; 4% cess;
 * the total rounded to 10.
 */
export function regimeTax(gross, year, regime, deductions = 0) {
  const r = TAX_YEARS[year][regime === 'new' ? 'newRegime' : 'oldRegime'];
  const taxable = roundTo(Math.max(0, gross - r.std - (regime === 'new' ? 0 : deductions)), 10);
  const { tax, lines } = slabTaxOn(taxable, r.slabs);
  let rebate = 0;
  let relief = 0;
  if (taxable <= r.rebate.limit) rebate = Math.min(tax, r.rebate.max);
  else if (r.rebate.relief) {
    const excess = taxable - r.rebate.limit;
    if (tax > excess) relief = tax - excess;
  }
  const after = tax - rebate - relief;
  let surcharge = 0;
  for (let i = r.surcharge.length - 1; i >= 0; i--) {
    const [above, rate] = r.surcharge[i];
    if (taxable > above) {
      surcharge = (after * rate) / 100;
      const prevRate = i === 0 ? 0 : r.surcharge[i - 1][1];
      const cap = slabTaxOn(above, r.slabs).tax * (1 + prevRate / 100) + (taxable - above);
      if (after + surcharge > cap) surcharge = Math.max(0, cap - after);
      break;
    }
  }
  const cess = ((after + surcharge) * CESS_PCT) / 100;
  const total = roundTo(after + surcharge + cess, 10);
  return { year, regime, gross, std: r.std, taxable, lines, rebate, relief, surcharge, cess, total, rebateSection: r.rebate };
}

/** Extra old-regime deductions that would make it no dearer than the new one (bisection, up to the next 1,000). */
export function breakEven(gross, year, newTotal, oldTotal) {
  if (oldTotal <= newTotal) return 0;
  let lo = 0;
  let hi = gross;
  if (regimeTax(gross, year, 'old', hi).total > newTotal) return 0;
  for (let i = 0; i < 40 && hi - lo > 100; i++) {
    const mid = (lo + hi) / 2;
    if (regimeTax(gross, year, 'old', mid).total <= newTotal) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi / 1000) * 1000;
}

// ---------------------------------------------------------------- retrieval
/** Reciprocal-rank fusion (k = 60): each list adds 1 / (k + rank); keyword hits only count if trusted. */
export function rrf(vectorIds, keywordIds, { useKeyword, k = 60, top = 4 }) {
  const fused = new Map();
  vectorIds.forEach((id, i) => fused.set(id, (fused.get(id) ?? 0) + 1 / (k + i + 1)));
  if (useKeyword) keywordIds.forEach((id, i) => fused.set(id, (fused.get(id) ?? 0) + 1 / (k + i + 1)));
  return [...fused.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([id, s]) => ({ id, score: Math.round(s * 10000) / 10000 }));
}

// ---------------------------------------------------------------- safety
export const WEIGHTS = { numbers: 40, source: 25, output: 15, products: 10, consistency: 10 };
export const CHECKS = [
  ['source', 'Sources'],
  ['numbers', 'Numbers match calculator'],
  ['output', 'Output validated'],
  ['products', 'Category-level only'],
  ['consistency', 'Consistent with calculator'],
];
export const trustScore = (passed) => Object.entries(WEIGHTS).reduce((n, [k, w]) => n + (passed[k] ? w : 0), 0);

/** Every figure the engine produced, with the x12 and /12 of each, as the numbers check accepts them. */
export function allowedFrom(values) {
  const out = [0];
  for (const v of values) out.push(v, v * 12, v / 12);
  return out;
}
/** A rupee figure passes if it is within 2% (or 100) of an allowed one. */
export const figureOk = (a, allowed) => allowed.some((v) => Math.abs(a - v) <= Math.max(Math.abs(v) * 0.02, 100));

/** Indian digit grouping, as Money.inr prints it. */
export function inr(v) {
  const s = String(Math.round(Math.abs(v)));
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${v < 0 ? '-' : ''}₹${rest ? `${rest},${last3}` : last3}`;
}
/** Money.compact: crores and lakhs. */
export function compact(v) {
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`;
  return inr(v);
}
