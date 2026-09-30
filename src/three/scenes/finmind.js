/**
 * 03 FinMind: the verification works.
 *
 * The product (HYDRABATH_HACK/ai-money-mentor) answers a money question in
 * seven stages, and the island (scripts/blender/scenes/finmind.py) is that
 * pipeline as a small factory: a visitor asks at one of the seven tools'
 * lecterns, and their question rides a belt, as a tray, past a station for
 * each stage: memory (the archive), the deterministic calculation (a press),
 * retrieval from four official documents (the library: 113 books, one a
 * passage), the context the model reads (four folders), the local model (a
 * scribe in a glass booth) and five safety gates, to the counter, where the
 * answer is handed out in English, Hindi, Telugu or Tamil.
 *
 * Every number is the product's: the stage timings of a measured FIRE plan,
 * the rules and the tax each regime charges (recomputed here by a port of the
 * engine), the retrieval rankings (captured from its own index), the trust
 * weights and the retry's feedback, the 1,000-scenario simulation (ported,
 * down to java.util.Random). See finmind-model.js and scripts/finmind/.
 *
 * The belt runs slower than the product (a whole run takes 5.6 s); the true
 * milliseconds are always on show.
 */
import { Box3, BoxGeometry, CanvasTexture, Color, CylinderGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion, SRGBColorSpace, Vector3 } from 'three';

import { GLOW } from '../overlays/lines.js';
import { Rings } from '../overlays/rings.js';
import { Director } from '../sim/director.js';
import { inPoly } from '../sim/grid.js';
import { partyKit } from '../sim/party.js';
import { Districts } from '../sim/spread.js';
import { base } from './base.js';
import CAP from './finmind-captures.js';
import { ASSUMPTIONS, CHECKS, TAX_YEARS, WEIGHTS, allowedFrom, breakEven, compact, figureOk, fireNumber, inr, regimeTax, rrf, simulate, solveSip, trustScore } from './finmind-model.js';
import { besideOf as besideFor, jobBoard } from './kit/staff.js';
import { act, asideFrom, clockFeed, go, near, placeNamer, rng, spotsOf } from './kit/util.js';

// ---------------------------------------------------------------- the product's numbers
const STAGES = ['memory', 'calc', 'retrieve', 'llm', 'safety'];
const STAGE_NAME = { memory: 'Memory', calc: 'Calculation', retrieve: 'Retrieval', llm: 'Local LLM', safety: 'Safety checks' };
// The measured FIRE plan (data/sse-fire.txt): each stage's milliseconds.
const PUBLISHED = Object.fromEntries(CAP.published.stages.map((s) => [s.step, s]));
const TOK_ALL = 51; // tok/s with every layer on the GPU (application.properties: num-gpu 99)
const TOK_SPLIT = 16; // with Ollama's default split, 48% on the GPU (RTX 3050 Ti, 4 GB)
const GROSS = 16_40_000; // the plan's salary and bonus, a year
const MAXED = 1_50_000 + 50_000 + 25_000; // Sec 123 (80C) + NPS 80CCD(1B) + 80D, as the engine maxes them
const MADE_UP = 4_37_000; // the figure the sabotage slips in: not in CALCULATIONS
const TOOLS = [
  { id: 'fire', label: 'FIRE Planner', module: 'fire' },
  { id: 'health', label: 'Money Health Score', module: 'health-score' },
  { id: 'tax', label: 'Tax Wizard', module: 'tax', chat: true },
  { id: 'life', label: 'Life Events', module: 'life-event' },
  { id: 'couples', label: 'Couples Planner', module: 'couples-planner' },
  { id: 'xray', label: 'Portfolio X-Ray', module: 'portfolio' },
  { id: 'scam', label: 'Scam Shield', module: 'scam-shield' },
];
const LANGS = { en: 'English', hi: 'Hindi', te: 'Telugu', ta: 'Tamil' };
// The four documents the library holds (knowledge/manifest.yaml), bookcase by bookcase.
const DOCS = ['FAQs for Mutual Fund Investors', 'Regular and Direct Mutual Fund Plans', 'FAQs on New vs Old Tax Regime', 'Salaried Individuals for AY 2026-27'];
const DOC_TINT = ['#2f4a6b', '#3f5a3a', '#6b2f3a', '#6b5a2f'];
const QUESTIONS = { q_regime: 'regime-80c', q_direct: 'direct-plan', q_form16: 'form16', q_crypto: 'off-topic' };
const INK = { navy: '#0a192f', navy2: '#122844', emerald: '#10b981', glow: '#34d399', cream: '#f5f3ef', amber: '#f59e0b', red: '#f0506e', grey: '#8b93a1' };
const FONT = '"Geist Variable", "Nirmala UI", "Noto Sans Devanagari", "Noto Sans Telugu", "Noto Sans Tamil", system-ui, sans-serif';
const MONO = '"Geist Mono Variable", ui-monospace, monospace';

export async function create(ctx) {
  const { stage, labels, context, slot } = ctx;
  const data = stage.data;
  const b = base(ctx);
  const rand = rng(ctx.seed ?? 3141);
  // The trays, stamps and canvases draw from a stream of their own, so what
  // they do never changes what anyone decides to do.
  const fxRand = rng((ctx.seed ?? 3141) + 1);
  const scene = stage.scene;
  const card = context !== 'case';
  const baked = spotsOf(data);
  // One of the page's own: outside the booth's door, for a word with the scribe.
  const OWN_SPOTS = { booth_door: { x: 4.2, z: 0.42, face: 0 } };
  const spot = (k) => OWN_SPOTS[k] ?? baked(k);
  const zones = Object.fromEntries(Object.entries(data.zones ?? {}).map(([k, pts]) => [k, pts.map((q) => [q[0], q[2]])]));

  // ---------------------------------------------------------------- the works' state
  const works = {
    clock: 10 * 3600 + 15 * 60,
    feed: [],
    requests: 0,
    answers: 0,
    retries: 0,
    fallbacks: 0,
    stamps: 0,
    history: 3, // interactions already filed for the saved profile
    profile: 'guest',
    taxYear: '2026-27',
    language: 'en',
    online: true,
    gpu: 'all',
    sabotage: null,
    question: 'q_regime',
    block: 'blk_calc',
    plan: { retire: 50, inflationPct: ASSUMPTIONS.inflationPct, equityReturnPct: ASSUMPTIONS.equityReturnPct },
    redraws: 0,
  };
  const { time, event } = clockFeed(works);
  let timers = [];
  const later = (secs, fn) => timers.push({ at: works.clock + secs, fn });
  function runTimers() {
    if (!timers.length) return;
    const due = timers.filter((t) => works.clock >= t.at);
    if (!due.length) return;
    timers = timers.filter((t) => works.clock < t.at);
    for (const t of due) t.fn();
  }

  // ---------------------------------------------------------------- the belt
  const beltPts = (data.lines?.belt ?? []).map((p) => [p[0], p[2]]);
  const segs = [];
  let beltLen = 0;
  for (let i = 1; i < beltPts.length; i++) {
    const [ax, az] = beltPts[i - 1];
    const [bx, bz] = beltPts[i];
    const l = Math.hypot(bx - ax, bz - az);
    segs.push({ ax, az, bx, bz, l, s0: beltLen });
    beltLen += l;
  }
  const BELT_TOP = 0.8 + 0.028;
  const pointAt = (s) => {
    const q = Math.min(beltLen, Math.max(0, s));
    const g = segs.find((k) => q <= k.s0 + k.l + 1e-6) ?? segs.at(-1);
    const f = g.l ? (q - g.s0) / g.l : 0;
    return { x: g.ax + (g.bx - g.ax) * f, z: g.az + (g.bz - g.az) * f, dx: (g.bx - g.ax) / (g.l || 1), dz: (g.bz - g.az) / (g.l || 1) };
  };
  const project = (x, z) => {
    let best = 0;
    let bd = Infinity;
    for (const g of segs) {
      const t = Math.max(0, Math.min(1, ((x - g.ax) * (g.bx - g.ax) + (z - g.az) * (g.bz - g.az)) / (g.l * g.l || 1)));
      const px = g.ax + (g.bx - g.ax) * t;
      const pz = g.az + (g.bz - g.az) * t;
      const d = Math.hypot(px - x, pz - z);
      if (d < bd) {
        bd = d;
        best = g.s0 + t * g.l;
      }
    }
    return best;
  };
  const node = (name) => stage.byName.get(name);
  const worldOf = (o) => (o ? o.getWorldPosition(new Vector3()) : null);
  const gateArms = [0, 1, 2, 3, 4].map((i) => node(`gate_arm_${i}`));
  const gateS = gateArms.map((o, i) => (o ? project(worldOf(o).x, worldOf(o).z) : beltLen - 1.5 + i * 0.3));
  const at = (k) => spot(k) ?? { x: 0, z: 0 };
  // Where a tray stops, and for how long (seconds of the diorama's own, not the product's).
  const STOPS = [
    { key: 'memory', s: project(at('archive').x, at('archive').z), dwell: 1.8 },
    { key: 'calc', s: segs[0]?.l ?? 3, dwell: 2.2 },
    { key: 'retrieve', s: project(at('shelf_2').x, at('shelf_2').z), dwell: 3.0 },
    { key: 'fuse', s: project(at('merge').x, at('merge').z), dwell: 1.1 },
    { key: 'context', s: (segs[0]?.l ?? 3) + (segs[1]?.l ?? 6), dwell: 2.0 },
    { key: 'llm', s: project(at('scribe').x, at('scribe').z), dwell: 6.5 },
    ...gateS.map((s, i) => ({ key: `gate${i}`, gate: i, s, dwell: 0.7 })),
    { key: 'end', s: beltLen, dwell: 0 },
  ].sort((x, y) => x.s - y.s);
  const stopIndex = (key) => STOPS.findIndex((q) => q.key === key);
  const LLM_STOP = stopIndex('llm');
  const S_LLM = STOPS[LLM_STOP].s;
  const BELT_SPEED = 0.5;
  const GAP = 0.44;

  // ---------------------------------------------------------------- trays
  const trayGeo = {
    base: new BoxGeometry(0.3, 0.03, 0.22),
    rim: new BoxGeometry(0.31, 0.012, 0.012),
    card: new BoxGeometry(0.1, 0.004, 0.07),
    sheet: new BoxGeometry(0.2, 0.003, 0.15),
    slip: new BoxGeometry(0.05, 0.004, 0.035),
    folder: new BoxGeometry(0.2, 0.006, 0.03),
    answer: new BoxGeometry(0.22, 0.005, 0.16),
    stamp: new CylinderGeometry(0.013, 0.013, 0.003, 12),
  };
  // Every tray's pieces are drawn together: one instanced mesh a kind of piece
  // (8 draw calls however many trays are out), each tray keeping only which
  // of its pieces show and in what colour.
  const TC = (hex, k = 1) => new Color(hex).multiplyScalar(k);
  const trayMat = {
    card: TC('#efe6cf'),
    guest: TC('#b9bec7'),
    sheet: TC('#fbfaf6'),
    slips: DOC_TINT.map((c) => TC(c)),
    folders: ['#2f4a6b', '#3f5a3a', '#6b5a2f', '#6b2f3a'].map((c) => TC(c)),
    answer: TC('#f4efe0'),
    template: TC('#c9ccd3'),
    pass: TC(INK.glow, 1.4),
    fail: TC(INK.red, 1.4),
    warn: TC(INK.amber, 1.4),
  };
  const MAX_TRAYS = 14;
  const inst = {};
  const WHITE = new Color(1, 1, 1);
  const addInst = (key, geo, material, per) => {
    const m = new InstancedMesh(geo, material, MAX_TRAYS * per);
    m.count = 0;
    m.frustumCulled = false;
    m.setColorAt(0, WHITE);
    scene.add(m);
    inst[key] = m;
  };
  const std = (hex, o = {}) => new MeshStandardMaterial({ color: new Color(hex), roughness: 0.6, ...o });
  addInst('base', trayGeo.base, std('#16263d', { metalness: 0.3, roughness: 0.45 }), 1);
  addInst('rim', trayGeo.rim, std(INK.emerald, { roughness: 0.4 }), 2);
  for (const k of ['card', 'sheet', 'slip', 'folder', 'answer']) addInst(k, trayGeo[k], std('#ffffff'), k === 'slip' || k === 'folder' ? 4 : 1);
  addInst('stamp', trayGeo.stamp, new MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), 5);
  // Where each piece sits on its tray.
  const AT = {
    base: [[0, 0.015, 0]],
    rim: [[0, 0.034, 0.105], [0, 0.034, -0.105]],
    card: [[-0.07, 0.034, -0.05]],
    sheet: [[0.02, 0.036, 0.01]],
    slip: [0, 1, 2, 3].map((i) => [-0.09 + i * 0.06, 0.04, 0.07]),
    folder: [0, 1, 2, 3].map((i) => [0.02, 0.042 + i * 0.006, -0.06 + i * 0.035]),
    answer: [[0, 0.068, 0]],
    stamp: [0, 1, 2, 3, 4].map((i) => [-0.08 + i * 0.04, 0.072, -0.055]),
  };
  const piece = (material) => ({ visible: false, material });
  function makeTray() {
    const parts = {
      card: piece(trayMat.card),
      sheet: piece(trayMat.sheet),
      slips: [0, 1, 2, 3].map(() => piece(trayMat.slips[0])),
      folders: [0, 1, 2, 3].map((i) => piece(trayMat.folders[i])),
      answer: piece(trayMat.answer),
      stamps: [0, 1, 2, 3, 4].map(() => piece(trayMat.pass)),
    };
    return { g: { position: new Vector3(), rotation: { y: 0 } }, parts };
  }
  const tm = new Matrix4();
  const lm = new Matrix4();
  const tq = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const one = new Vector3(1, 1, 1);
  function drawTrays() {
    const n = Object.fromEntries(Object.keys(inst).map((k) => [k, 0]));
    const put = (key, slot, color = null) => {
      const m = inst[key];
      const i = n[key]++;
      if (i >= m.instanceMatrix.count) return;
      const [x, y, z] = AT[key][slot];
      lm.makeTranslation(x, y, z);
      m.setMatrixAt(i, lm.premultiply(tm));
      m.setColorAt(i, color ?? WHITE);
    };
    for (const r of trays.slice(-MAX_TRAYS)) {
      tq.setFromAxisAngle(up, r.g.rotation.y);
      tm.compose(r.g.position, tq, one);
      const P = r.parts;
      put('base', 0);
      put('rim', 0);
      put('rim', 1);
      if (P.card.visible) put('card', 0, P.card.material);
      if (P.sheet.visible) put('sheet', 0, P.sheet.material);
      P.slips.forEach((o, i) => o.visible && put('slip', i, o.material));
      P.folders.forEach((o, i) => o.visible && put('folder', i, o.material));
      if (P.answer.visible) put('answer', 0, P.answer.material);
      P.stamps.forEach((o, i) => o.visible && put('stamp', i, o.material));
    }
    for (const [k, m] of Object.entries(inst)) {
      m.count = Math.min(n[k], m.instanceMatrix.count);
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
  const trays = []; // requests on the belt (and on the counter, waiting to be handed over)
  let trayId = 0;
  let focus = null; // the request the chapters talk about: the latest one
  const toolIndex = (id) => TOOLS.findIndex((t) => t.id === id);

  /** A question put in: a request, and its tray at the head of the belt. */
  function submit(tool, visitor = null, { s = 0, opening = false } = {}) {
    const t = TOOLS[tool] ?? TOOLS[0];
    const req = {
      id: ++trayId,
      tool: t,
      visitor,
      profile: works.profile,
      year: works.taxYear,
      lang: visitor?.lang ?? works.language,
      s,
      next: 0,
      hold: 0,
      dir: 1,
      attempt: 1,
      fail: null,
      log: [],
      checks: null,
      trust: null,
      source: 'llm',
      warnings: [],
      state: 'belt',
      born: works.clock,
      writing: 0,
      ...makeTray(),
    };
    while (req.next < STOPS.length && STOPS[req.next].s < s - 1e-3) req.next++;
    // Opened part way along: what the earlier stations put on it is there already.
    if (opening) for (let i = 0; i < req.next; i++) effects(req, STOPS[i], true);
    trays.push(req);
    works.requests++;
    focus = req;
    if (visitor) visitor.request = req;
    placeTray(req);
    event(`${t.label}: a question in${visitor ? ` from ${visitor.name}` : ''}`);
    return req;
  }
  function placeTray(req) {
    if (req.state === 'counter') return;
    const p = pointAt(req.s);
    req.g.position.set(p.x, BELT_TOP, p.z);
    req.g.rotation.y = Math.atan2(p.dx, p.dz);
  }
  const log = (req, step, status, detail = null) => {
    const ms = req.tool.id === 'fire' && status === 'done' && req.attempt === 1 && !req.fail ? PUBLISHED[step]?.ms ?? null : null;
    req.log.push({ step, status, ms, detail, at: works.clock });
  };
  const stageOf = (req) => {
    const l = req.log.at(-1);
    return l ? l.step : 'input';
  };

  /** What a station does to a tray (and its log) when it stops there. */
  function effects(req, stop, quiet = false) {
    const P = req.parts;
    switch (stop.key) {
      case 'memory':
        log(req, 'memory', 'done', req.profile === 'saved' ? 'Profile, goals & history loaded' : 'No saved profile');
        P.card.visible = true;
        P.card.material = req.profile === 'saved' ? trayMat.card : trayMat.guest;
        if (!quiet && req.profile === 'saved') attend('archivist', req);
        break;
      case 'calc':
        log(req, 'calc', 'done', req.tool.id === 'fire' ? `${CAP.steps.length} calculation steps` : 'calculation steps');
        P.sheet.visible = true;
        if (!quiet) {
          press.strokes = req.tool.id === 'fire' ? CAP.steps.length : 24;
          tube.t = 0;
          attend('keeper', req);
        }
        break;
      case 'retrieve': {
        const n = req.tool.id === 'fire' ? CAP.published.citations.length : 4;
        log(req, 'retrieve', 'done', `${n} official passages`);
        const docs = req.tool.id === 'fire' ? CAP.published.citations.map((c) => DOCS.indexOf(c[2])) : [2, 0, 2, 3];
        P.slips.forEach((o, i) => {
          o.visible = i < n;
          o.material = trayMat.slips[Math.max(0, docs[i] ?? 0)];
        });
        if (!quiet) attend('librarian', req);
        break;
      }
      case 'fuse':
        if (!quiet) attend('librarian', req);
        break;
      case 'context':
        P.folders.forEach((o) => (o.visible = true));
        if (!quiet) attend('clerk', req);
        break;
      case 'llm':
        if (quiet) {
          log(req, 'llm', 'done', 'Explanation drafted');
          P.answer.visible = true;
        }
        break;
      default:
        break;
    }
  }

  /** Staff of `role` near the station turn to the tray a moment (if they're at work there). */
  function attend(role, req) {
    const p = pointAt(req.s);
    for (const a of people) {
      if (a.role !== role || !a.visible || !a.task?.act) continue;
      if (Math.hypot(a.pos.x - p.x, a.pos.y - p.z) > 2.6) continue;
      a.task.face = [p.x, p.z];
    }
  }

  function arrive(req, stop) {
    effects(req, stop);
    const P = req.parts;
    if (stop.key === 'llm') {
      // The scribe writes: a tray at a time, at the model's speed.
      log(req, 'llm', 'start', CAP.published.model);
      req.writing = (stop.dwell * TOK_ALL) / tokRate();
      req.hold = req.writing;
      req.written = 0;
      // A sabotage waiting for its tray (the safety chapter's): this one.
      if (works.sabotage && req.attempt === 1 && !req.tool.chat) {
        req.fail = FAILS[works.sabotage];
        req.sabotage = works.sabotage;
        works.sabotage = null;
      }
      return;
    }
    if (stop.gate != null) {
      stampGate(stop.gate, req);
      const [key, label] = CHECKS[stop.gate];
      req.checks ??= {};
      const failsNow = req.fail?.[key] && req.attempt <= req.fail[key];
      if (failsNow && req.tool.chat) {
        // The Tax Wizard's chat is streamed: text can't be taken back, so a failed check is a warning on the badge.
        req.checks[key] = false;
        req.warnings.push(`${label}: flagged after streaming`);
        P.stamps[stop.gate].material = trayMat.warn;
      } else if (failsNow && req.attempt === 1) {
        // Rejected: back to the scribe once, told exactly what was wrong.
        req.checks[key] = false;
        P.stamps[stop.gate].material = trayMat.fail;
        P.stamps[stop.gate].visible = true;
        log(req, 'safety', 'retry', `Asking the model to fix: ${label}`);
        req.feedback = retryFeedback(req, key);
        req.attempt = 2;
        req.dir = -1;
        req.next = LLM_STOP;
        works.retries++;
        event(`${label} failed: back to the model once, told what to fix`);
        wordWithScribe();
        return;
      } else if (failsNow) {
        // Failed twice: the calculator's own explanation instead.
        req.checks[key] = false;
        req.source = 'template';
        req.warnings.push('Model text failed checks twice, so the calculator’s own explanation is shown');
        P.answer.material = trayMat.template;
        P.stamps[stop.gate].material = trayMat.fail;
        works.fallbacks++;
      } else {
        req.checks[key] = true;
        P.stamps[stop.gate].material = trayMat.pass;
      }
      P.stamps[stop.gate].visible = true;
      works.stamps++;
      req.hold = stop.dwell;
      if (stop.gate === 4) finish(req);
      return;
    }
    if (stop.key === 'end') {
      req.state = 'counter';
      req.handAt = works.clock;
      // Onto the counter, where the clerk hands it over.
      const c = counterSpot();
      req.g.position.set(c.x, 1.03, c.z);
      return;
    }
    req.hold = stop.dwell;
  }

  function finish(req) {
    const passed = { ...Object.fromEntries(CHECKS.map(([k]) => [k, true])), ...Object.fromEntries(Object.entries(req.checks ?? {}).filter(([k]) => k !== 'output')) };
    // The last verdict decides the badge: a check that failed and was fixed counts as passed.
    if (req.source === 'llm' && !req.tool.chat) for (const k of Object.keys(passed)) passed[k] = true;
    if (req.source === 'template') passed.numbers = false;
    if (req.tool.chat) for (const [k, v] of Object.entries(req.checks ?? {})) passed[k] = v;
    passed.output = true;
    req.passed = passed;
    req.trust = trustScore(passed);
    const four = ['source', 'numbers', 'products', 'consistency'].filter((k) => passed[k]).length;
    log(req, 'safety', 'done', `${four}/4 checks passed`);
    focus = req;
  }

  function retryFeedback(req, key) {
    if (key === 'numbers') return `Your previous answer failed validation. These figures are NOT in CALCULATIONS: ${inr(MADE_UP)}. Rewrite using only figures copied from CALCULATIONS, or no figures at all.`;
    return 'Your previous answer failed validation. Named fund house(s): a fund house the user doesn’t hold. Rewrite using only figures copied from CALCULATIONS, or no figures at all.';
  }

  function trayTick(dt) {
    // Most advanced first, so each keeps its distance from the one ahead.
    const order = trays.filter((r) => r.state === 'belt').sort((x, y) => y.s - x.s);
    for (const req of order) {
      if (req.hold > 0) {
        req.hold -= dt;
        if (req.writing) {
          req.written = Math.min(1, (req.written ?? 0) + dt / req.writing);
          if (req.hold <= 0) {
            req.writing = 0;
            log(req, 'llm', 'done', 'Explanation drafted');
            req.parts.answer.visible = true;
            req.parts.answer.material = req.source === 'template' ? trayMat.template : trayMat.answer;
            if (req.attempt === 2) for (const o of req.parts.stamps) o.visible = false;
            req.dir = 1;
            req.next = LLM_STOP + 1;
          }
        }
        continue;
      }
      const stop = STOPS[req.next];
      if (!stop) continue;
      if (req.dir < 0) {
        req.s = Math.max(stop.s, req.s - BELT_SPEED * 1.4 * dt);
        if (req.s <= stop.s + 1e-4) arrive(req, stop);
        placeTray(req);
        continue;
      }
      let limit = stop.s;
      for (const o of order) if (o !== req && o.s > req.s) limit = Math.min(limit, o.s - GAP);
      // One answer at a time from the scribe to the counter (the model writes one at a time).
      if (req.next === LLM_STOP && trays.some((o) => o !== req && o.state === 'belt' && o.s >= S_LLM - 0.05)) limit = Math.min(limit, S_LLM - GAP);
      const before = req.s;
      req.s = Math.min(limit, req.s + BELT_SPEED * dt);
      if (req.s < before) req.s = before;
      if (Math.abs(req.s - stop.s) < 1e-4) {
        req.next++;
        arrive(req, stop);
      }
      placeTray(req);
    }
  }

  function dropTray(req) {
    const i = trays.indexOf(req);
    if (i >= 0) trays.splice(i, 1);
    if (focus === req) focus = trays.at(-1) ?? null;
  }

  // ---------------------------------------------------------------- people
  const cast = data.cast ?? [];
  const people = [];
  const pickGeo = new CylinderGeometry(0.22, 0.22, 1.5, 10);
  const pickMat = new MeshBasicMaterial({ visible: false });
  const PIECES = ['clipboard', 'card', 'phone', 'bag'];
  const hold = (a, piece) => {
    for (const t of PIECES) {
      const o = a.fig.root.getObjectByName(t);
      if (o) o.visible = t === piece || (t === 'bag' && a.bag);
    }
    a.tool = piece;
  };
  const STAFF = ['archivist', 'keeper', 'librarian', 'clerk', 'inspector', 'counter'];
  let partyLeader = null;
  const langCycle = ['en', 'hi', 'ta', 'en', 'te', 'en'];
  for (const entry of cast) {
    const role = entry.role ?? 'visitor';
    const visitor = role === 'visitor';
    const carry = visitor ? [...new Set([...(entry.carry ?? []), 'card', 'phone'])] : [...new Set([...(entry.carry ?? []), 'clipboard', 'card'])];
    const pace = visitor ? 0.56 + rand() * 0.14 : 0.62 + rand() * 0.12;
    const a = b.agent({ ...entry, carry }, { think: (ag) => brain(ag), fixed: role === 'scribe', speed: pace });
    a.role = role;
    a.name = entry.name;
    a.bag = (entry.carry ?? []).includes('bag');
    a.st = { tasks: [], phase: 'work' };
    if (visitor) {
      a.lang = langCycle[people.filter((p) => p.role === 'visitor').length % langCycle.length];
      if (a.party) {
        if (!partyLeader) partyLeader = a;
        a.leader = partyLeader;
      }
    }
    hold(a, (entry.carry ?? []).find((t) => PIECES.includes(t) && t !== 'bag') ?? null);
    if (entry.clip && !['walk', 'carry'].includes(entry.clip) && role !== 'scribe') a.st.tasks.push({ act: entry.clip, secs: 4 + rand() * 9, face: a.heading, opening: true });
    const proxy = new Mesh(pickGeo, pickMat);
    proxy.position.y = 0.75;
    proxy.userData.pick = 'click';
    proxy.userData.agent = a;
    a.fig.root.add(proxy);
    a.proxy = proxy;
    people.push(a);
  }
  const visitors = () => people.filter((p) => p.role === 'visitor');
  const staffOf = (role) => people.filter((p) => p.role === role);
  const scribe = people.find((p) => p.role === 'scribe');
  const counterClerk = people.find((p) => p.role === 'counter');
  const inspector = people.find((p) => p.role === 'inspector');

  // ---------------------------------------------------------------- places and districts
  const S = (k, clip, extra = {}) => (spot(k) ? { ...spot(k), key: k, clip, ...extra } : null);
  const booths = TOOLS.map((_, i) => `booth_${i}`);
  const LOUNGE = ['plan_n0', 'plan_n1', 'plan_s0', 'plan_s1', 'plan_w', 'plan_e', 'cooler'];
  const districts = new Districts([
    { name: 'kiosk', stations: () => booths.map((k) => S(k, 'scan', { browse: false })), cap: 3, feature: true, key: true, browse: false },
    { name: 'lounge', stations: () => LOUNGE.map((k) => S(k, k === 'cooler' ? 'phone' : 'point')), poly: zones.lounge, cap: 4, feature: true, key: true, party: true },
    { name: 'counter', stations: () => [S('pickup_a', 'pay', { browse: false }), S('pickup_b', 'pay', { browse: false }), S('clerk', 'talk', { browse: false })], cap: 2, feature: true, key: true, browse: false },
    { name: 'archive', stations: () => ['cab_0', 'cab_1', 'cab_2', 'cab_3', 'archive'].map((k) => S(k, 'fold')), feature: true, browse: false },
    { name: 'engine', stations: () => [S('engine', 'type'), S('binders', 'scan')], feature: true, browse: false },
    { name: 'library', stations: () => ['vector', 'shelf_0', 'shelf_1', 'shelf_2', 'shelf_3', 'keyword'].map((k) => S(k, 'browse')), feature: true, browse: false },
    { name: 'context', stations: () => [S('context', 'fold'), S('merge', 'fold')], feature: true, browse: false },
    { name: 'safety', stations: () => [S('inspector', 'point'), S('booth_door', 'talk')], feature: true, browse: false },
    { name: 'scribe', poly: zones.scribe, cap: 1, browse: false },
    { name: 'door', poly: zones.door, cap: 0, browse: false, walkThrough: true },
  ], { counts: (p) => p.role === 'visitor' });
  let districtT = 0;
  if (zones.door) b.crowd.noWait = [zones.door];
  b.crowd.interest = ['booth_3', 'plan_n0', 'shelf_1', 'engine', 'context', 'inspector', 'clerk'].map(spot).filter(Boolean).map((q) => [q.x, q.z]);
  const nearestPlace = placeNamer(data, {
    booth: 'the kiosk', plan: 'the lounge', cooler: 'the lounge', pickup: 'the counter', clerk: 'the counter', cab: 'the memory archive', archive: 'the memory archive',
    engine: 'the calculation engine', binders: 'the rules binders', vector: 'the library', shelf: 'the library', keyword: 'the library', merge: 'the fusion table',
    context: 'the context desk', scribe: 'the local model', inspector: 'the safety line', door: 'the door', street: 'the street',
  }, 'the works');
  for (const p of people) {
    const t = p.st.tasks.find((q) => q.opening);
    const k = t && [...districts.keyOf.values()].find(({ s: q }) => q.key && Math.hypot(q.x - p.pos.x, q.z - p.pos.y) < 0.35);
    if (k && b.crowd.free(k.s.key, p)) {
      t.claim = k.s.key;
      b.crowd.claims.set(k.s.key, p);
      p.claim = k.s.key;
    }
  }

  // ---------------------------------------------------------------- staff work
  const board = jobBoard({ people, districts, rand, staff: STAFF, customer: 'visitor' });
  const walkCost = (s, a) => 0.5 * Math.hypot(s.x - a.pos.x, s.z - a.pos.y);
  /** Another of the staff standing at, or on the way to, somewhere within 1.6 m of `s`. */
  const staffBy = (s, a) => people.some((p) => p !== a && p.visible && STAFF.includes(p.role) && Math.hypot(districts.aim(p)[0] - s.x, districts.aim(p)[1] - s.z) < 1.6);
  const job = (k, clip, piece, [lo, hi] = [12, 20]) => (a) => {
    const s = spot(k);
    if (!s || !b.crowd.free(k, a) || staffBy(s, a)) return null;
    return {
      d: districts.of(s.x, s.z), at: s, cost: walkCost(s, a),
      run: () => {
        a.st.tasks.push({ call: () => hold(a, piece), at: s }, act(clip, lo + rand() * (hi - lo), s.face, { claim: k, at: s }));
        return go(s, { claim: k });
      },
    };
  };
  const JOBS = {
    file_profile: job('cab_0', 'fold', 'clipboard'),
    file_goals: job('cab_1', 'fold', 'clipboard'),
    file_history: job('cab_2', 'fold', 'clipboard'),
    file_prefs: job('cab_3', 'fold', 'clipboard', [8, 14]),
    to_belt: job('archive', 'fold', 'clipboard', [8, 12]),
    press: job('engine', 'type', null, [14, 20]),
    rules: job('binders', 'scan', 'clipboard', [10, 16]),
    vector: job('vector', 'scan', 'card', [10, 16]),
    keyword: job('keyword', 'scan', 'card', [10, 16]),
    shelf_0: job('shelf_0', 'browse', 'card'),
    shelf_1: job('shelf_1', 'browse', 'card'),
    shelf_2: job('shelf_2', 'browse', 'card'),
    shelf_3: job('shelf_3', 'browse', 'card'),
    merge: job('merge', 'fold', 'card', [8, 14]),
    context: job('context', 'fold', 'clipboard', [12, 18]),
    gates: job('inspector', 'point', 'clipboard', [12, 20]),
    counter: job('clerk', 'type', null, [10, 16]),
  };
  // Each leans to a station, but does several jobs round the works.
  const HOMES = {
    Ananya: ['file_profile', 'file_goals', 'file_history', 'file_prefs', 'to_belt'],
    Farhan: ['press', 'rules', 'shelf_2'],
    Kavya: ['vector', 'shelf_0', 'shelf_1', 'merge'],
    Joseph: ['keyword', 'shelf_2', 'shelf_3', 'merge'],
    Sameer: ['context', 'merge', 'to_belt'],
    Imran: ['gates'],
    Meera: ['counter'],
  };
  // (Those at the belt's two ends stay by it: an answer or a gate is always theirs to watch.)
  const REACH = { Imran: ['gates', 'context'], Meera: ['counter'] };
  const ALL_JOBS = Object.keys(JOBS);

  function brain(a) {
    const st = a.st;
    while (st.tasks.length) {
      const t = st.tasks.shift();
      if (t.at && !near(a, t.at, 0.45)) continue;
      return t;
    }
    if (a.role === 'visitor') return visitorBrain(a);
    if (a.role === 'scribe') return scribeBrain(a);
    if (a.role === 'counter') return counterBrain(a);
    const home = HOMES[a.name] ?? [];
    const pool = REACH[a.name] ?? [...home, ...ALL_JOBS.filter((j) => !home.includes(j) && !['gates', 'counter'].includes(j))];
    const next = board.next(a, pool, home, JOBS);
    return next ?? act('idle', 2, null, { claim: a.claim });
  }

  function scribeBrain(a) {
    const s = spot('scribe');
    const writing = trays.some((r) => r.writing && r.hold > 0);
    return writing ? act('type', 1.2, s?.face) : act(rand() < 0.6 ? 'fold' : 'idle', 2 + rand() * 2, s?.face);
  }

  /** The counter's clerk: an answer on the counter and its visitor at a window: hand it over. */
  function counterBrain(a) {
    const s = spot('clerk');
    if (!near(a, s, 0.3)) return go(s, { claim: 'clerk' });
    const ready = trays.find((r) => r.state === 'counter' && r.visitor?.visible && ['pickup_a', 'pickup_b'].includes(r.visitor.claim) && near(r.visitor, spot(r.visitor.claim), 0.4));
    if (ready) return act('talk', 2.5, [ready.visitor.pos.x, ready.visitor.pos.y], { claim: 'clerk' });
    const waiting = trays.find((r) => r.state === 'counter');
    if (waiting) return act('fold', 2, [waiting.g.position.x, waiting.g.position.z], { claim: 'clerk' });
    return act(rand() < 0.5 ? 'type' : 'fold', 3 + rand() * 3, s.face, { claim: 'clerk' });
  }
  const counterSpot = () => {
    // On the counter top, between the clerk and the windows.
    const c = spot('clerk');
    return { x: c.x + 0.55, z: c.z - 0.2 };
  };

  // ---------------------------------------------------------------- visitors
  // Kiosk, lounge, counter: in through the door, a question at one of the
  // seven lecterns, a wait in the lounge (the planning table, the cooler)
  // while it rides the belt, the answer at the counter, and out.
  const MAX_INSIDE = 5;
  const party = partyKit({ people, crowd: b.crowd, grid: b.grid, rand, outdoors: (x, z) => x > 4.6, avoid: (x, z) => !!zones.door && inPoly(x, z, zones.door) });
  const { together } = party;
  function follower(a) {
    return party.follower(a, (f, L) => {
      if (!L.visible || L.st.phase === 'exiting') {
        f.st.phase = 'exiting';
        if (!L.visible) return { exit: 'street' };
      }
      return null;
    });
  }
  const insideCount = () => visitors().filter((p) => p.visible && p.st.phase !== 'exiting').length;
  const answerReady = (a) => a.request?.state === 'counter';
  const freeBooth = (a, want = null) => {
    const order = want != null ? [want, ...booths.map((_, i) => i).filter((i) => i !== want)] : booths.map((_, i) => i).sort(() => rand() - 0.5);
    for (const i of order) {
      const k = booths[i];
      const s = spot(k);
      if (!s || !b.crowd.free(k, a)) continue;
      if (people.some((p) => p !== a && p.visible && (p.claim === k || Math.hypot(p.pos.x - s.x, p.pos.y - s.z) < 0.5))) continue;
      return i;
    }
    return null;
  };
  const LOUNGE_CLIPS = { plan_n0: 'point', plan_n1: 'browse', plan_s0: 'talk', plan_s1: 'point', plan_w: 'phone', plan_e: 'idle', cooler: 'phone' };

  function visitorBrain(a) {
    const st = a.st;
    if (a.party && a.leader !== a) return follower(a);
    switch (st.phase) {
      case 'arrive':
      case 'kiosk': {
        const i = freeBooth(a, st.want ?? null);
        if (i == null) {
          // Every lectern taken: a word in the lounge first.
          st.phase = 'kiosk';
          const s = districts.pick(a, people, { rand, free: (q) => b.crowd.free(q.key, a), only: ['lounge'], party: !!a.party, full: true });
          if (!s) return act('idle', 2);
          return go(s, { claim: s.key, then: act('idle', 3, s.face, { claim: s.key }) });
        }
        const k = booths[i];
        const s = spot(k);
        st.want = null;
        st.phase = 'asking';
        hold(a, 'phone');
        st.tasks.push(act(rand() < 0.5 ? 'scan' : 'type', 8 + rand() * 4, s.face, { claim: k, at: s }), { call: () => asked(a, i), at: s });
        return go(s, { claim: k });
      }
      case 'asking':
        // (Opened at a lectern: the question goes in now.)
        return asked(a, booths.findIndex((k) => a.claim === k) >= 0 ? booths.findIndex((k) => a.claim === k) : 0) ?? act('idle', 1);
      case 'waiting': {
        if (answerReady(a)) {
          st.phase = 'collect';
          return visitorBrain(a);
        }
        if (a.party && !together(a)) return act('idle', 3, null, { until: () => together(a) });
        const s = districts.pick(a, people, { rand, free: (q) => b.crowd.free(q.key, a), only: ['lounge'], party: !!a.party, visited: st.seenLounge, full: true, apart: 0.9 });
        if (!s) return act('idle', 3, null, { until: () => answerReady(a) });
        (st.seenLounge ??= new Set()).add(s.district);
        hold(a, rand() < 0.4 ? 'phone' : null);
        st.tasks.push(act(LOUNGE_CLIPS[s.key] ?? 'idle', 8 + rand() * 8, s.face, { claim: s.key, at: s, until: () => answerReady(a) }));
        return go(s, { claim: s.key });
      }
      case 'collect': {
        const k = ['pickup_a', 'pickup_b'].find((q) => b.crowd.free(q, a));
        if (!k) return act('idle', 2, null, { claim: a.claim });
        const s = spot(k);
        st.phase = 'receiving';
        st.tasks.push(act('pay', 3.2, s.face, { claim: k, at: s }), { call: () => received(a), at: s });
        return go(s, { claim: k });
      }
      case 'receiving':
        // (Opened at the counter: the answer is theirs.)
        received(a);
        return act('idle', 0.5);
      case 'leaving': {
        // Inside, a pace short of the door, until it's clear (nobody coming in,
        // nobody else on the way out): the doorway is walked through, not waited in.
        // (At the counter's window they collected from: off the way in.)
        st.phase = 'exiting';
        const out = spot('door_out');
        st.tasks.push(
          { call: () => (lastExit = works.clock) },
          go(out, { via: true }), go(spot('street_out') ?? out, { via: true }), { exit: 'street' },
        );
        return act('idle', 0.6, null, { claim: a.claim, until: () => doorClear(a) && (!a.party || a.leader !== a || together(a)) });
      }
      case 'exiting':
      default:
        return { exit: 'street' };
    }
  }
  /** Nobody coming in through the door, or about to, and nobody else going out: the door is `a`'s. */
  function doorClear(a) {
    const d = spot('door_in');
    return !people.some((p) => p !== a && p.visible && (!a.party || p.leader !== a) && (
      (p.st?.phase === 'arrive' && Math.hypot(p.pos.x - d.x, p.pos.y - d.z) < 2.2) ||
      (zones.door && inPoly(p.pos.x, p.pos.y, zones.door))));
  }
  let lastExit = -Infinity;
  let nextArrival = 0;
  function asked(a, i) {
    submit(i, a);
    a.st.phase = 'waiting';
    hold(a, null);
    return null;
  }
  function received(a) {
    const req = a.request;
    if (req && req.state === 'counter') {
      dropTray(req);
      works.answers++;
      if (req.profile === 'saved') works.history++;
      event(`${a.name}: the answer, in ${LANGS[req.lang] ?? 'English'}`);
      lastHanded = { req, at: works.clock, who: a };
    }
    a.request = null;
    hold(a, 'card');
    a.st.phase = 'leaving';
  }
  let lastHanded = null;

  // The opening scene: what each visitor is part way through.
  for (const a of visitors()) {
    const k = a.claim;
    if (a.party && a.leader !== a) continue;
    if (k?.startsWith('booth_')) a.st.phase = 'asking';
    else if (k?.startsWith('pickup_')) {
      a.st.phase = 'receiving';
      const req = submit(toolIndex('xray'), a, { s: beltLen, opening: true });
      finishOpening(req);
    } else if (!a.visible || a.pos.x > 4.4) a.st.phase = 'arrive';
    else {
      a.st.phase = 'waiting';
      // Their question is at the library by now.
      submit(toolIndex('couples'), a, { s: STOPS[stopIndex('retrieve')].s - 0.6, opening: true });
    }
  }
  function finishOpening(req) {
    for (const stp of STOPS) if (stp.key !== 'end') effects(req, stp, true);
    for (const o of req.parts.stamps) o.visible = true;
    finish(req);
    req.state = 'counter';
    const c = counterSpot();
    req.g.position.set(c.x, 1.03, c.z);
  }

  // ---------------------------------------------------------------- the director
  const director = new Director({ crowd: b.crowd, rand });
  director.breakUpPiles({
    districts,
    people: () => people,
    here: () => people.filter((q) => q.visible && q.role === 'visitor'),
    movable: (p) => p.role === 'visitor' && p.st.phase === 'waiting' && (!p.party || p.leader === p) && p.task?.act && !director.busy(p),
    moveOn: (p) => director.redirect(p, () => {}),
  });
  /** A word with the scribe through the booth's door, when an answer comes back to be fixed. */
  function wordWithScribe() {
    const a = inspector;
    if (!a?.visible || director.busy(a)) return;
    const s = spot('booth_door');
    director.hire(director.redirect(a, (q) => {
      hold(q, 'clipboard');
      q.st.tasks.push(act('talk', 3.5, [spot('scribe').x, spot('scribe').z], { at: s }));
      q.st.tasks.push(go(spot('inspector'), { claim: 'inspector' }), act('point', 6, spot('inspector').face, { claim: 'inspector', at: spot('inspector') }));
      q.st.tasks.unshift(go(s));
    }), 'word', 20);
  }
  /** The library chapter's question: the librarians fetch from the bookcases it draws on, then to the fusion table. */
  function fetchFor(qid) {
    const q = CAP.retrieval.find((r) => r.id === QUESTIONS[qid]);
    if (!q) return;
    const docs = [...new Set(q.fused.map((f) => DOCS.indexOf(f[2])).filter((i) => i >= 0))];
    const libs = staffOf('librarian').filter((p) => p.visible);
    libs.forEach((p, i) => {
      const shelf = docs.length ? `shelf_${docs[i % docs.length]}` : i ? 'keyword' : 'vector';
      const s = spot(shelf);
      if (!s) return;
      director.hire(director.redirect(p, (x) => {
        hold(x, 'card');
        x.st.tasks.push(go(s, { claim: shelf }), act('browse', 4 + i, s.face, { claim: shelf, at: s }));
        if (docs.length && !b.crowd.claims.get('merge')) x.st.tasks.push(go(spot('merge'), { claim: 'merge' }), act('fold', 4, spot('merge').face, { claim: 'merge', at: spot('merge') }));
      }), 'fetch', 30);
    });
  }

  // Two walkers head-on in a narrow place: after 6 s of neither getting anywhere,
  // the one on the lesser errand steps aside a moment, then carries on.
  function unstick() {
    for (const a of people) {
      if (!a.visible || a.fixed || !(a.task?.go || a.task?.exit)) {
        a.stuckAt = null;
        continue;
      }
      const s0 = a.stuckAt;
      if (!s0 || Math.hypot(a.pos.x - s0.x, a.pos.y - s0.z) > 0.2) a.stuckAt = { x: a.pos.x, z: a.pos.y, t: works.clock };
    }
    for (const a of people) {
      if (!a.stuckAt || works.clock - a.stuckAt.t < 6) continue;
      const o = people.find((q) => q !== a && q.stuckAt && works.clock - q.stuckAt.t >= 6 && Math.hypot(q.pos.x - a.pos.x, q.pos.y - a.pos.y) < 1.6);
      if (!o) continue;
      const rank = (p) => (p.role === 'visitor' ? 2 : 1);
      const y = rank(a) < rank(o) || (rank(a) === rank(o) && a.id > o.id) ? a : o;
      const to = asideFrom(y, { rand, grid: b.grid, districts, people });
      if (!to) continue;
      const was = y.task;
      y.resume = null;
      y.detour = null;
      y.st.tasks = [go(to, { claim: y.claim }), act('idle', 1.5, null, { claim: y.claim }), ...(was ? [was] : []), ...y.st.tasks];
      b.crowd.next(y);
      a.stuckAt = o.stuckAt = null;
      if (b.crowd.stats) b.crowd.stats.gaveUp = (b.crowd.stats.gaveUp ?? 0) + 1;
      b.crowd.note?.('unstick', y, y === a ? o : a);
    }
  }
  let unstickT = 0;

  // ---------------------------------------------------------------- living parts
  const ram = node('engine_ram');
  const ramRest = ram?.position.clone();
  const press = { strokes: 0, t: 0 };
  const arms = gateArms.map((o) => (o ? { o, rest: o.position.clone(), t: 1 } : null));
  function stampGate(i) {
    if (arms[i]) arms[i].t = 0;
  }
  const binders = { '2025-26': node('binder_2025_26'), '2026-27': node('binder_2026_27') };
  const binderRest = Object.fromEntries(Object.entries(binders).map(([k, o]) => [k, o?.position.clone()]));
  const plug = node('router_plug');
  const plugRest = plug?.position.clone();
  // A printed sheet through the pneumatic tube, the press to the belt's corner (Blender's tube, in three.js axes).
  const TUBE = [[-5.2, 1.72, -3.08], [-5.2, 2.05, -3.08], [-4.7, 2.12, -2.58], [-3.7, 2.1, -1.45], [-3.6, 1.95, -1.2], [-3.6, 1.62, -1.2], [-3.6, 0.9, -1.2]].map((p) => new Vector3(...p));
  const tubeLen = TUBE.slice(1).reduce((n, p, i) => n + p.distanceTo(TUBE[i]), 0);
  const tube = { t: 2, mesh: new Mesh(new PlaneGeometry(0.16, 0.12), new MeshBasicMaterial({ color: new Color('#fbfaf6'), side: 2 })) };
  tube.mesh.visible = false;
  scene.add(tube.mesh);
  const v3 = new Vector3();
  function moveParts(dt) {
    // The press strokes once a calculation step (37 ms in the product; shown slowed).
    if (ram && ramRest) {
      if (press.strokes > 0) {
        press.t += dt;
        const k = press.t / 0.045;
        ram.position.y = ramRest.y - 0.05 * Math.abs(Math.sin(k * Math.PI));
        if (press.t >= 0.045) {
          press.t = 0;
          press.strokes--;
        }
      } else ram.position.y += (ramRest.y - ram.position.y) * Math.min(1, dt * 8);
    }
    for (const a of arms) {
      if (!a) continue;
      a.t = Math.min(1, a.t + dt / 0.35);
      a.o.position.y = a.rest.y - 0.13 * Math.sin(a.t * Math.PI);
    }
    for (const [y, o] of Object.entries(binders)) {
      if (!o) continue;
      const out = y === works.taxYear ? 0.13 : 0;
      o.position.x += (binderRest[y].x + out - o.position.x) * Math.min(1, dt * 5);
    }
    if (plug && plugRest) {
      const ty = works.online ? plugRest.y : 0.04;
      const tx = works.online ? plugRest.x : plugRest.x - 0.12;
      plug.position.y += (ty - plug.position.y) * Math.min(1, dt * 6);
      plug.position.x += (tx - plug.position.x) * Math.min(1, dt * 6);
    }
    if (tube.t < 1) {
      tube.t = Math.min(1, tube.t + dt / 0.9);
      let d = tube.t * tubeLen;
      for (let i = 1; i < TUBE.length; i++) {
        const l = TUBE[i].distanceTo(TUBE[i - 1]);
        if (d <= l) {
          v3.lerpVectors(TUBE[i - 1], TUBE[i], d / l);
          break;
        }
        d -= l;
      }
      tube.mesh.position.copy(v3);
      tube.mesh.rotation.set(-Math.PI / 2, 0, fxRand() * 0.2);
      tube.mesh.visible = tube.t < 1;
    }
  }
  const tokRate = () => (works.gpu === 'all' ? TOK_ALL : TOK_SPLIT);

  // ---------------------------------------------------------------- the scenes' screens
  function screenOn(name, W, H, { flat = false, lift = 0.004, scale = 1 } = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d');
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    const material = new MeshBasicMaterial({ map: tex, color: new Color(1.2, 1.2, 1.2), toneMapped: false });
    const o = node(name);
    let mesh = null;
    if (o) {
      o.updateWorldMatrix(true, true);
      const box = new Box3().setFromObject(o);
      const size = box.getSize(new Vector3());
      const c = box.getCenter(new Vector3());
      if (flat) {
        mesh = new Mesh(new PlaneGeometry(size.x * scale, size.z * scale), material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(c.x, box.max.y + lift, c.z);
      } else if (size.x < size.z) {
        mesh = new Mesh(new PlaneGeometry(size.z * scale, size.y * scale), material);
        mesh.rotation.y = Math.PI / 2;
        mesh.position.set(box.max.x + lift, c.y, c.z);
      } else {
        mesh = new Mesh(new PlaneGeometry(size.x * scale, size.y * scale), material);
        mesh.position.set(c.x, c.y, box.max.z + lift);
      }
      scene.add(mesh);
      o.visible = false;
    }
    return { canvas, g, tex, material, mesh, W, H, dirty: true };
  }
  const table = screenOn('planning_table_screen', 1024, 540, { flat: true });
  const board2 = screenOn('token_board', 512, 288);
  const dial = screenOn('trust_dial', 256, 256, { lift: 0.008 });
  const panel = (() => {
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 540;
    return { canvas, g: canvas.getContext('2d'), W: 960, H: 540 };
  })();

  // ---------------------------------------------------------------- the plan: 1,000 futures
  const REQ = CAP.request;
  let plan = null;
  function computePlan() {
    const age = REQ.currentAge;
    const years = works.plan.retire - age;
    const as = { ...ASSUMPTIONS, inflationPct: works.plan.inflationPct, equityReturnPct: works.plan.equityReturnPct };
    const f = fireNumber(REQ.monthlyExpenses, years, as);
    const corpus0 = REQ.currentSavings + REQ.ppfEpfBalance;
    const sip = solveSip(corpus0, years, f.fireNumber, as);
    const sim = simulate({ corpus0, sip, years, age, target: f.fireNumber, as, keep: true });
    // A sample of the paths to draw (every 1,000th would be one: draw 160).
    const draw = [];
    for (let k = 0; k < 160; k++) draw.push(Math.floor((k * 1000) / 160));
    plan = { age, years, as, fire: f.fireNumber, corpus0, sip, sim, draw, grown: 0 };
    works.redraws++;
    table.dirty = true;
  }
  computePlan();
  function drawFan(g, W, H, { grown = 1, title = true } = {}) {
    g.fillStyle = INK.navy;
    g.fillRect(0, 0, W, H);
    const pad = { l: W * 0.1, r: W * 0.05, t: H * (title ? 0.2 : 0.08), b: H * 0.14 };
    const { sim, years, age, fire } = plan;
    const top = Math.max(fire * 1.25, ...sim.bands.map((q) => q.p90)) * 1.02;
    const X = (y) => pad.l + ((W - pad.l - pad.r) * y) / years;
    const Y = (v) => H - pad.b - ((H - pad.t - pad.b) * Math.min(v, top)) / top;
    // Grid and axes.
    g.strokeStyle = 'rgba(245,243,239,0.12)';
    g.lineWidth = 1;
    g.font = `500 ${Math.round(H * 0.035)}px ${MONO}`;
    g.fillStyle = 'rgba(245,243,239,0.55)';
    for (let k = 0; k <= 4; k++) {
      const v = (top * k) / 4;
      g.beginPath();
      g.moveTo(pad.l, Y(v));
      g.lineTo(W - pad.r, Y(v));
      g.stroke();
      g.fillText(k ? compact(v).replace('₹', '₹ ') : '0', 8, Y(v) + 4);
    }
    for (let y = 0; y <= years; y += 5) g.fillText(String(age + y), X(y) - 8, H - pad.b * 0.35);
    // The paths: 160 of the 1,000, grown in when redrawn.
    const n = Math.max(1, Math.round(years * grown));
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(52,211,153,0.07)';
    for (const s of plan.draw) {
      g.beginPath();
      for (let y = 0; y <= n; y++) {
        const v = sim.paths[y][s];
        if (y) g.lineTo(X(y), Y(v));
        else g.moveTo(X(y), Y(v));
      }
      g.stroke();
    }
    // P10 to P90 band, P50 line.
    g.fillStyle = 'rgba(16,185,129,0.18)';
    g.beginPath();
    for (let y = 0; y <= n; y++) g.lineTo(X(y), Y(sim.bands[y].p90));
    for (let y = n; y >= 0; y--) g.lineTo(X(y), Y(sim.bands[y].p10));
    g.closePath();
    g.fill();
    g.strokeStyle = INK.glow;
    g.lineWidth = 3;
    g.beginPath();
    for (let y = 0; y <= n; y++) g.lineTo(X(y), Y(sim.bands[y].p50));
    g.stroke();
    // The FIRE number.
    g.setLineDash([10, 8]);
    g.strokeStyle = INK.amber;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(pad.l, Y(fire));
    g.lineTo(W - pad.r, Y(fire));
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = INK.amber;
    g.font = `600 ${Math.round(H * 0.04)}px ${FONT}`;
    g.fillText(`FIRE number ${compact(fire)}`, pad.l + 8, Y(fire) - 8);
    if (title) {
      g.fillStyle = INK.cream;
      g.font = `600 ${Math.round(H * 0.07)}px ${FONT}`;
      g.fillText(`${Math.round(plan.sim.successPct)}% of 1,000 futures reach it`, pad.l, H * 0.1);
      g.font = `500 ${Math.round(H * 0.038)}px ${MONO}`;
      g.fillStyle = 'rgba(245,243,239,0.7)';
      g.fillText(`SIP ${inr(plan.sip)}/mo · retire at ${works.plan.retire} · equity σ 18%, debt σ 4% · seeded`, pad.l, H * 0.16);
    }
  }
  let tableT = 0;
  function tableTick(dt) {
    if (plan.grown < 1) {
      plan.grown = Math.min(1, plan.grown + dt / 1.8);
      table.dirty = true;
    }
    // At most 15 redraws a second while it grows in (each is a 1024 px canvas and an upload).
    tableT -= dt;
    if (!table.dirty || !table.mesh || (tableT > 0 && plan.grown < 1)) return;
    tableT = 1 / 15;
    table.dirty = false;
    drawFan(table.g, table.W, table.H, { grown: plan.grown });
    table.tex.needsUpdate = true;
  }
  function boardTick() {
    const req = trays.find((r) => r.writing && r.hold > 0) ?? trays.find((r) => r.state === 'belt' && r.parts.answer.visible && r.s >= S_LLM - 0.01 && r.s < S_LLM + 0.8);
    const key = req ? `${req.id}:${Math.round((req.written ?? 1) * 60)}:${works.gpu}` : 'idle';
    if (key === board2.key || !board2.mesh) return;
    board2.key = key;
    const g = board2.g;
    const { W, H } = board2;
    g.fillStyle = INK.navy;
    g.fillRect(0, 0, W, H);
    g.fillStyle = INK.glow;
    g.font = `600 22px ${MONO}`;
    g.fillText(`qwen3.5:4b · ${tokRate()} tok/s`, 18, 34);
    g.fillStyle = INK.cream;
    g.font = `400 19px ${FONT}`;
    // A FIRE plan's own explanation, as the model wrote it in that visitor's language (captured).
    const text = req ? (req.source === 'template' ? CAP.template.impact : req.tool.id === 'fire' ? (CAP.languages[req.lang] ?? CAP.languages.en).impact : `Explaining the ${req.tool.label} figures…`) : 'Waiting for a question.';
    const shown = req ? text.slice(0, Math.round(text.length * (req.writing ? req.written ?? 0 : 1))) : text;
    wrap(g, shown + (req?.writing ? '▍' : ''), 18, 70, W - 36, 26, 8);
    board2.tex.needsUpdate = true;
  }
  function dialTick() {
    const req = [...trays].reverse().find((r) => r.trust != null) ?? lastHanded?.req;
    const score = req?.trust ?? null;
    const key = `${score}`;
    if (key === dial.key || !dial.mesh) return;
    dial.key = key;
    const g = dial.g;
    const { W, H } = dial;
    g.fillStyle = INK.navy;
    g.fillRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H / 2 + 10;
    g.lineWidth = 18;
    g.strokeStyle = 'rgba(245,243,239,0.15)';
    g.beginPath();
    g.arc(cx, cy, 90, Math.PI * 0.8, Math.PI * 2.2);
    g.stroke();
    if (score != null) {
      g.strokeStyle = score >= 90 ? INK.glow : score >= 60 ? INK.amber : INK.red;
      g.beginPath();
      g.arc(cx, cy, 90, Math.PI * 0.8, Math.PI * (0.8 + 1.4 * (score / 100)));
      g.stroke();
    }
    g.fillStyle = INK.cream;
    g.font = `700 64px ${FONT}`;
    g.textAlign = 'center';
    g.fillText(score == null ? '·' : String(score), cx, cy + 20);
    g.font = `500 20px ${MONO}`;
    g.fillText('TRUST', cx, cy + 56);
    g.textAlign = 'left';
    dial.tex.needsUpdate = true;
  }
  function wrap(g, text, x, y, w, lh, max = 12) {
    const words = String(text).split(/\s+/);
    let line = '';
    let n = 0;
    for (const word of words) {
      const t = line ? `${line} ${word}` : word;
      if (g.measureText(t).width > w && line) {
        g.fillText(line, x, y + n * lh);
        n++;
        line = word;
        if (n >= max) return n;
      } else line = t;
    }
    if (line) g.fillText(line, x, y + n * lh);
    return n + 1;
  }

  // ---------------------------------------------------------------- the app's own panels (the picture-in-picture)
  function panelHead(g, W, title, sub) {
    g.fillStyle = INK.navy;
    g.fillRect(0, 0, W, 540);
    g.fillStyle = INK.cream;
    g.font = `600 30px ${FONT}`;
    g.fillText(title, 36, 56);
    g.fillStyle = 'rgba(245,243,239,0.6)';
    g.font = `400 18px ${MONO}`;
    g.fillText(sub, 36, 86);
  }
  const STATUS_INK = { done: INK.glow, start: INK.amber, retry: INK.red, pending: 'rgba(245,243,239,0.3)' };
  function drawStages(g, req, y0 = 120) {
    const W = panel.W;
    STAGES.forEach((step, i) => {
      const y = y0 + i * 62;
      const entries = req ? req.log.filter((l) => l.step === step) : [];
      const last = entries.at(-1);
      const status = last?.status ?? 'pending';
      g.fillStyle = 'rgba(245,243,239,0.05)';
      g.fillRect(36, y, W - 72, 50);
      g.fillStyle = STATUS_INK[status] ?? INK.grey;
      g.beginPath();
      g.arc(62, y + 25, 8, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = INK.cream;
      g.font = `600 20px ${FONT}`;
      g.fillText(`${i + 3}. ${STAGE_NAME[step]}`, 84, y + 32);
      const done = entries.find((l) => l.status === 'done');
      const retry = entries.find((l) => l.status === 'retry');
      g.font = `400 17px ${MONO}`;
      g.fillStyle = 'rgba(245,243,239,0.75)';
      const detail = [retry?.detail, done?.detail ?? (status === 'start' ? last.detail : null)].filter(Boolean).join(' · ');
      g.fillText(detail || (status === 'pending' ? 'waiting' : ''), 300, y + 32);
      if (done?.ms != null) {
        g.textAlign = 'right';
        g.fillStyle = INK.glow;
        g.fillText(`${done.ms.toLocaleString('en-IN')} ms`, W - 56, y + 32);
        g.textAlign = 'left';
      }
    });
  }
  function drawTrust(g, req, x, y, w) {
    const passed = req?.passed;
    g.fillStyle = 'rgba(245,243,239,0.05)';
    g.fillRect(x, y, w, 330);
    g.fillStyle = INK.cream;
    g.font = `600 22px ${FONT}`;
    g.fillText(`Trust ${req?.trust ?? '·'} / 100`, x + 18, y + 38);
    CHECKS.forEach(([k, label], i) => {
      const yy = y + 76 + i * 46;
      const ok = passed ? passed[k] : null;
      g.fillStyle = ok == null ? INK.grey : ok ? INK.glow : INK.red;
      g.fillText(ok == null ? '·' : ok ? '✓' : '✕', x + 18, yy);
      g.fillStyle = INK.cream;
      g.font = `500 18px ${FONT}`;
      g.fillText(label, x + 48, yy);
      g.fillStyle = 'rgba(245,243,239,0.6)';
      g.font = `400 16px ${MONO}`;
      g.textAlign = 'right';
      g.fillText(`${WEIGHTS[k]}`, x + w - 18, yy);
      g.textAlign = 'left';
      g.font = `600 22px ${FONT}`;
    });
  }
  function drawPanel() {
    const g = panel.g;
    const W = panel.W;
    const id = slot.chapters?.current?.id;
    const req = focus;
    if (id === 'tools') {
      panelHead(g, W, req ? req.tool.label : 'FinMind', req?.tool.chat ? 'Tax Wizard: a streamed chat, checked after it streams' : 'each stage streamed to the app as it finishes (SSE)');
      drawStages(g, req);
      if (req?.tool.id === 'fire' || !req) {
        g.fillStyle = 'rgba(245,243,239,0.55)';
        g.font = `400 16px ${MONO}`;
        g.fillText(`times from one measured FIRE plan: ${CAP.published.latencyMs.toLocaleString('en-IN')} ms in all`, 36, 520);
      }
    } else if (id === 'memory') {
      panelHead(g, W, 'USER MEMORY', works.profile === 'saved' ? 'Profile, goals & history loaded · 1 ms' : 'No saved profile · 1 ms');
      g.font = `400 21px ${MONO}`;
      g.fillStyle = INK.cream;
      memoryLines().forEach((l, i) => wrap(g, l, 36, 140 + i * 64, W - 72, 28, 2));
    } else if (id === 'engine') {
      panelHead(g, W, 'CALCULATIONS', `${TAX_YEARS[works.taxYear].label} · ${TAX_YEARS[works.taxYear].act} · ${CAP.steps.length} steps in ${PUBLISHED.calc.ms} ms`);
      const t = taxNow();
      const rows = [
        ['New regime tax', inr(t.newR.total)], ['Old regime tax', inr(t.oldR.total)], [`Old regime, Sec ${t.sec80C} + NPS + ${t.sec80D} maxed`, inr(t.oldMax.total)],
        ['Better regime for you', `New regime saves ${inr(t.oldR.total - t.newR.total)}`], ['Old regime break-even', inr(t.be)], [`Rebate`, t.rebate],
      ];
      rows.forEach(([k, v], i) => {
        g.fillStyle = 'rgba(245,243,239,0.7)';
        g.font = `400 20px ${FONT}`;
        g.fillText(k, 36, 150 + i * 58);
        g.fillStyle = INK.cream;
        g.font = `600 22px ${MONO}`;
        g.textAlign = 'right';
        g.fillText(v, W - 36, 150 + i * 58);
        g.textAlign = 'left';
      });
    } else if (id === 'library') {
      const q = CAP.retrieval.find((r) => r.id === QUESTIONS[works.question]);
      panelHead(g, W, q.question, `vector (bge-m3, ≥ 0.52) + keyword (FTS5 BM25) → RRF, k 60 → top 4`);
      const col = (list, x, head, fmt) => {
        g.fillStyle = INK.glow;
        g.font = `600 18px ${FONT}`;
        g.fillText(head, x, 124);
        g.font = `400 15px ${MONO}`;
        list.slice(0, 8).forEach((r, i) => {
          g.fillStyle = 'rgba(245,243,239,0.75)';
          g.fillText(`${i + 1}. ${fmt(r)}`, x, 152 + i * 25);
        });
        if (!list.length) {
          g.fillStyle = 'rgba(245,243,239,0.5)';
          g.fillText('nothing', x, 152);
        }
      };
      col(q.vector, 36, `Vector: ${q.vector.length}`, (r) => `${r[1].toFixed(2)} ${short(r[2], 22)}`);
      col(q.keyword, W / 2 + 10, `Keyword: ${q.keyword.length}${q.keywordUsed ? '' : ' (not trusted alone)'}`, (r) => `${r[1].toFixed(1)} ${short(r[2], 22)}`);
      g.fillStyle = INK.cream;
      g.font = `600 18px ${FONT}`;
      g.fillText(q.fused.length ? 'Cited' : 'No matching passages: the answer avoids legal claims', 36, 380);
      g.font = `400 15px ${MONO}`;
      q.fused.forEach((f, i) => {
        g.fillStyle = 'rgba(245,243,239,0.8)';
        g.fillText(`S${i + 1}  ${f[1].toFixed(4)}  ${short(f[2], 34)}${f[4] ? ` · Sec ${f[4]}` : ''}`, 36, 408 + i * 26);
      });
    } else if (id === 'context') {
      const blk = contextBlock();
      panelHead(g, W, blk.title, blk.sub);
      g.font = `400 18px ${MONO}`;
      g.fillStyle = INK.cream;
      let y = 130;
      for (const l of blk.lines) y += 30 * wrap(g, l, 36, y, W - 72, 26, 3);
    } else if (id === 'scribe') {
      panelHead(g, W, `Local model · ${CAP.published.model}`, `Ollama through Spring AI · ${tokRate()} tok/s · ${works.online ? 'online' : 'internet unplugged'}`);
      g.font = `400 20px ${FONT}`;
      g.fillStyle = INK.cream;
      wrap(g, CAP.languages.en.impact, 36, 140, W - 72, 30, 6);
      g.font = `400 16px ${MONO}`;
      g.fillStyle = 'rgba(245,243,239,0.6)';
      g.fillText('temperature 0.2 · thinking off · num-ctx 8192 · all layers on the GPU', 36, 470);
      g.fillText(works.online ? 'nothing about you is sent anywhere' : 'unplugged: the answer still arrives; AMFI’s NAV list waits for tomorrow', 36, 500);
    } else if (id === 'safety') {
      const r = [...trays].reverse().find((q) => q.passed) ?? lastHanded?.req ?? focus;
      panelHead(g, W, 'Safety layer', r?.sabotage ? sabotageLine(r) : 'five checks on every answer before it is shown');
      drawTrust(g, r, 36, 120, 420);
      g.fillStyle = 'rgba(245,243,239,0.8)';
      g.font = `400 16px ${MONO}`;
      if (r?.feedback) wrap(g, r.feedback, 490, 150, W - 520, 24, 9);
      else wrap(g, 'Every ₹ figure must match the engine within 2% (or ₹100); a monthly figure may be a yearly one over 12, or the other way round.', 490, 150, W - 520, 24, 8);
    } else if (id === 'languages') {
      const L = CAP.languages[works.language];
      panelHead(g, W, `${LANGS[works.language]}`, `numbers check: ${L.figures} ₹ figures verified · trust ${L.score}`);
      g.fillStyle = INK.cream;
      g.font = `500 30px ${FONT}`;
      wrap(g, L.line, 36, 170, W - 72, 44, 4);
      g.font = `400 18px ${FONT}`;
      g.fillStyle = 'rgba(245,243,239,0.7)';
      wrap(g, L.impact, 36, 330, W - 72, 28, 5);
    } else if (id === 'montecarlo') {
      drawFan(g, W, panel.H, { grown: plan.grown });
    } else {
      panelHead(g, W, 'FinMind', 'the verification works');
    }
  }
  const short = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
  function memoryLines() {
    if (works.profile !== 'saved') return ['- No saved profile (anonymous session)'];
    return [
      `- Arjun, age ${REQ.currentAge}, Chennai, income ${inr(REQ.monthlyIncome)}/mo, risk tolerance moderate, prefers index investing`,
      `- Goal: ${REQ.lifeGoals[0].name}, ${compact(REQ.lifeGoals[0].amount)} in ${REQ.lifeGoals[0].years} years`,
      `- Earlier: FIRE plan, ${inr(74_500)}/mo needed`,
      `(${works.history} interactions on file)`,
    ];
  }
  function taxNow() {
    const y = works.taxYear;
    const newR = regimeTax(GROSS, y, 'new');
    const oldR = regimeTax(GROSS, y, 'old');
    const oldMax = regimeTax(GROSS, y, 'old', MAXED);
    const [s80c, f80c] = TAX_YEARS[y].sections.sec80C;
    const [s80d, f80d] = TAX_YEARS[y].sections.sec80D;
    const rb = TAX_YEARS[y].newRegime.rebate;
    return {
      newR, oldR, oldMax, be: breakEven(GROSS, y, newR.total, oldR.total),
      sec80C: f80c ? `${s80c} (formerly ${f80c})` : s80c,
      sec80D: f80d ? `${s80d}` : s80d,
      rebate: `Sec ${rb.section}${rb.former ? ` (formerly ${rb.former})` : ''}: up to ${inr(rb.max)} at or under ${compact(rb.limit)}`,
    };
  }
  function contextBlock() {
    const lang = LANGS[works.language];
    switch (works.block) {
      case 'blk_system':
        return {
          title: 'SYSTEM', sub: 'the rules the model is given',
          lines: [
            '1. Numbers: only figures from CALCULATIONS, copied exactly. Never compute.',
            '2. Rules and legal facts only from SOURCES, cited [S1], [S2].',
            '3. Guidance, not advice: fund categories, never a named scheme or fund house.',
            '4. Section numbers as "Section 123 (formerly 80C)".',
            '5. Warm, plain language. Short sentences.',
            ...(works.language !== 'en' ? [`6. Every text field in ${lang}; digits, ₹ amounts and section numbers exactly as given.`] : []),
          ],
        };
      case 'blk_memory':
        return { title: 'USER MEMORY', sub: works.profile === 'saved' ? 'from the archive' : 'anonymous session', lines: memoryLines() };
      case 'blk_sources':
        return {
          title: 'SOURCES', sub: 'the retrieved passages, citable as [S1] to [S4]',
          lines: CAP.published.citations.map(([id, who, title, sec]) => `[${id}] ${who}: ${title}${sec ? ` · Sec ${sec}` : ''}`),
        };
      case 'blk_calc':
      default: {
        const kept = CAP.steps.filter((s) => !s[1].startsWith('Slab '));
        return {
          title: 'CALCULATIONS', sub: `from the engine, authoritative · ${kept.length} of ${CAP.steps.length} lines (slab lines left out)`,
          lines: kept.filter((s) => ['FIRE number', 'Monthly SIP needed', 'Tax', 'Scenario simulation'].includes(s[0])).slice(0, 9).map((s) => `${s[1]}: ${s[3]}`),
        };
      }
    }
  }
  function markedStatus() {
    const r = works.marked;
    if (!r) return 'nothing yet';
    const last = r.log.at(-1);
    if (r.passed) return r.source === 'template' ? 'failed twice: the calculator’s own explanation, trust 60' : `caught, rewritten, passed: trust ${r.trust}`;
    if (last?.status === 'retry') return `caught at ${last.detail.replace('Asking the model to fix: ', '')}: back to the model`;
    if (r.writing && r.hold > 0) return 'being written into the answer now';
    return 'on its way to the model';
  }
  const sabotageLine = (r) => (r.sabotage === 'fund' ? 'sabotage: a fund house named in the answer' : r.sabotage === 'twice' ? 'sabotage: a made-up figure, twice' : `sabotage: ${inr(MADE_UP)}, a figure the engine never produced`);

  // ---------------------------------------------------------------- overlays
  const rings = new Rings(scene);
  function drawRings() {
    rings.begin();
    for (const a of people) {
      if (!a.visible) continue;
      const col = a.role === 'visitor' ? (answerReady(a) ? GLOW.amber : GLOW.grey) : GLOW.turq;
      rings.add(a.pos.x, a.pos.y, col, a.fig.root.scale.x, a.fade);
    }
    rings.end();
  }

  // ---------------------------------------------------------------- interactions
  /** A question at tool `i`: a visitor at a lectern (or the one nearest one), else straight from the app. */
  function ask(i) {
    const k = booths[i];
    // Someone already at that lectern asks now.
    const there = visitors().find((p) => p.visible && p.claim === k && p.st.phase === 'asking' && p.task?.act);
    if (there) {
      there.task.secs = Math.min(there.task.secs, there.timer + 0.6);
      there.st.tasks = there.st.tasks.map((t) => (t.call ? { ...t, call: () => asked(there, i) } : t));
      return there;
    }
    const v = director.cast(visitors(), (p) => ['arrive', 'kiosk'].includes(p.st.phase) && (!p.party || p.leader === p) && !director.busy(p), spot(k));
    if (v && freeBooth(v, i) === i) {
      v.st.want = i;
      director.hire(director.redirect(v, () => {}), 'ask', 20);
      return v;
    }
    submit(i, null);
    return null;
  }
  const FAILS = { figure: { numbers: 1 }, twice: { numbers: 2 }, fund: { products: 1 } };
  function sabotage(kind) {
    // The answer the scribe is writing now, or the next one to be written;
    // with none on the way, whichever comes next.
    // with none on the way, a new question, marked as it goes in.
    const r = trays.filter((q) => q.state === 'belt' && q.attempt === 1 && !q.tool.chat && !q.fail && q.s <= S_LLM + 1e-3).sort((x, y) => y.s - x.s)[0] ?? submit(toolIndex('fire'), null);
    r.fail = FAILS[kind];
    r.sabotage = kind;
    works.sabotage = null;
    works.marked = r;
    event(kind === 'fund' ? 'a fund house slipped into the next answer' : `a made-up figure (${inr(MADE_UP)}) slipped into the next answer${kind === 'twice' ? ', twice' : ''}`);
  }

  // ---------------------------------------------------------------- chapters
  const lastDone = () => [...trays, lastHanded?.req].filter(Boolean).reverse().find((r) => r.passed);
  const runUntil = (run, test, limit, step = 1) => {
    for (let t = 0; t < limit && !test(); t += step) run(step);
    return test();
  };
  const chapters = [
    {
      id: 'tools',
      pip: true,
      enter: () => queueMicrotask(() => slot.chapters?.emit('pipcaption', 'The app, as each stage streams in')),
      readouts: () => {
        const r = focus;
        const st = r ? stageOf(r) : 'input';
        return [
          { label: 'Tool', value: r ? r.tool.label : 'none yet', tone: 'turq' },
          { label: 'Stage now', value: r ? `${STAGE_NAME[st] ?? 'Input'}${r.state === 'counter' ? ', at the counter' : ''}` : 'waiting' },
          { label: 'Seven stages', value: 'input · memory · calculation · retrieval · context · local LLM · safety' },
          { label: 'Measured (FIRE)', value: `${PUBLISHED.calc.ms} ms calc · ${PUBLISHED.retrieve.ms} ms retrieval · ${(PUBLISHED.llm.ms / 1000).toFixed(1)} s LLM · ${PUBLISHED.safety.ms} ms checks` },
          { label: 'On the belt', value: `${trays.filter((q) => q.state === 'belt').length} questions · ${works.answers} answered` },
        ];
      },
      actions: () => TOOLS.map((t) => ({ id: `tool_${t.id}`, label: t.label })),
      act(id) {
        const i = toolIndex(id.replace('tool_', ''));
        if (i >= 0) ask(i);
      },
      qa(run) {
        const n0 = works.requests;
        submit(toolIndex('fire'), null);
        const req = trays.at(-1);
        const ok = runUntil(run, () => req.state === 'counter', 150);
        const order = req.log.filter((l) => l.status === 'done').map((l) => l.step);
        const ms = Object.fromEntries(req.log.filter((l) => l.status === 'done').map((l) => [l.step, l.ms]));
        submit(toolIndex('tax'), null);
        const chat = trays.at(-1);
        this.act('tool_scam');
        return [
          ['a question rides every stage in order', ok && order.join() === STAGES.join(), order.join(' > ')],
          ['with the measured times on a FIRE plan', ms.calc === 37 && ms.retrieve === 222 && ms.llm === 5280 && ms.safety === 6 && ms.memory === 1, JSON.stringify(ms)],
          ['and is trusted 100 when every check passes', req.trust === 100, `${req.trust}`],
          ['the Tax Wizard is the streamed chat (no retry)', !!chat.tool.chat],
          ['a tool can be chosen at its lectern', works.requests >= n0 + 3, `${works.requests - n0} asked`],
        ];
      },
    },
    {
      id: 'memory',
      pip: true,
      enter: () => queueMicrotask(() => slot.chapters?.emit('pipcaption', 'What the model is told about you')),
      readouts: () => [
        { label: 'Profile', value: works.profile === 'saved' ? 'saved: Arjun' : 'guest', tone: works.profile === 'saved' ? 'turq' : 'grey' },
        { label: 'Memory stage', value: works.profile === 'saved' ? 'Profile, goals & history loaded' : 'No saved profile' },
        { label: 'Kept in', value: 'SQLite: profiles, goals, interactions, prefs' },
        { label: 'After each answer', value: `filed back: ${works.history} interactions on file` },
      ],
      actions: () => [
        { id: 'profile_saved', label: 'Sign in as Arjun', pressed: works.profile === 'saved' },
        { id: 'profile_guest', label: 'Guest', pressed: works.profile !== 'saved' },
      ],
      act(id) {
        works.profile = id === 'profile_saved' ? 'saved' : 'guest';
      },
      qa(run) {
        this.act('profile_saved');
        const h0 = works.history;
        const req = submit(toolIndex('fire'), null);
        runUntil(run, () => req.log.some((l) => l.step === 'memory'), 30);
        const loaded = req.log.find((l) => l.step === 'memory')?.detail;
        runUntil(run, () => req.state === 'counter', 150);
        // Handed over (the clerk files it if nobody collects it).
        runUntil(run, () => !trays.includes(req), 30);
        const filed = works.history > h0;
        this.act('profile_guest');
        const g = submit(toolIndex('fire'), null);
        runUntil(run, () => g.log.some((l) => l.step === 'memory'), 30);
        return [
          ['a saved profile is loaded for the model', loaded === 'Profile, goals & history loaded', loaded],
          ['and the answer is filed back', filed, `${h0} to ${works.history}`],
          ['a guest has no memory', g.log.find((l) => l.step === 'memory')?.detail === 'No saved profile'],
        ];
      },
    },
    {
      id: 'engine',
      pip: true,
      enter: () => queueMicrotask(() => slot.chapters?.emit('pipcaption', 'The calculator: every figure, with its steps')),
      readouts: () => {
        const t = taxNow();
        return [
          { label: 'Rules', value: `${TAX_YEARS[works.taxYear].label} · ${TAX_YEARS[works.taxYear].act}`, tone: 'turq' },
          { label: 'New regime', value: inr(t.newR.total) },
          { label: 'Old regime', value: `${inr(t.oldR.total)} (${inr(t.oldMax.total)} with Sec ${t.sec80C}, NPS and ${t.sec80D} maxed)` },
          { label: 'Verdict', value: `New regime saves ${inr(t.oldR.total - t.newR.total)} · old breaks even at ${inr(t.be)} more deductions` },
          { label: 'Rebate', value: t.rebate },
          { label: 'Steps', value: `${CAP.steps.length} in ${PUBLISHED.calc.ms} ms, each with its formula` },
        ];
      },
      actions: () => ['2025-26', '2026-27'].map((y) => ({ id: `year_${y.replace('-', '_')}`, label: y, pressed: works.taxYear === y })),
      act(id) {
        const y = id.replace('year_', '').replace('_', '-');
        if (TAX_YEARS[y]) works.taxYear = y;
      },
      qa(run) {
        const out = {};
        for (const y of ['2025-26', '2026-27']) {
          this.act(`year_${y.replace('-', '_')}`);
          run(0.5);
          out[y] = taxNow();
        }
        const a = out['2025-26'];
        const c = out['2026-27'];
        return [
          ['the ported engine gives the product’s figures', c.newR.total === 119340 && c.oldR.total === 301080 && c.oldMax.total === 230880 && c.be === 583000, `${inr(c.newR.total)} · ${inr(c.oldR.total)} · ${inr(c.oldMax.total)} · ${inr(c.be)}`],
          ['the same in either tax year (same slabs)', a.newR.total === c.newR.total && a.oldR.total === c.oldR.total],
          ['but the section numbers follow the year’s Act', /156 \(formerly 87A\)/.test(c.rebate) && /87A/.test(a.rebate) && !/156/.test(a.rebate) && c.sec80C.startsWith('123'), `${a.sec80C} / ${c.sec80C}`],
          ['the year in use is pulled from the shelf', !binders['2026-27'] || binders['2026-27'].position.x > binderRest['2026-27'].x + 0.05],
        ];
      },
    },
    {
      id: 'library',
      pip: true,
      enter: () => queueMicrotask(() => slot.chapters?.emit('pipcaption', 'Two searches, fused: the product’s own rankings')),
      readouts: () => {
        const q = CAP.retrieval.find((r) => r.id === QUESTIONS[works.question]);
        return [
          { label: 'Question', value: q.question, tone: 'turq' },
          ...(q.expanded !== q.question ? [{ label: 'Expanded', value: q.expanded.split(' | ').slice(1).join(' · ') }] : []),
          { label: 'Vector (bge-m3 ≥ 0.52)', value: `${q.vector.length} passages` },
          { label: 'Keyword (FTS5, BM25)', value: `${q.keyword.length} passages${q.keywordUsed ? '' : ', not trusted alone: no section or form named'}` },
          { label: 'Cited', value: q.fused.length ? q.fused.map((f, i) => `S${i + 1} ${short(f[2], 26)}`).join(' · ') : 'nothing: the answer avoids legal claims', tone: q.fused.length ? 'turq' : 'amber' },
          { label: 'Library', value: '4 documents, 113 passages (one book each)' },
        ];
      },
      actions: () => [
        { id: 'q_regime', label: '80C in the new regime?', pressed: works.question === 'q_regime' },
        { id: 'q_direct', label: 'A direct plan?', pressed: works.question === 'q_direct' },
        { id: 'q_form16', label: 'Form 16?', pressed: works.question === 'q_form16' },
        { id: 'q_crypto', label: 'Crypto on Binance?', pressed: works.question === 'q_crypto' },
      ],
      act(id) {
        if (!QUESTIONS[id]) return;
        works.question = id;
        fetchFor(id);
      },
      qa(run) {
        const res = CAP.retrieval.map((q) => {
          const f = rrf(q.vector.map((v) => v[0]), q.keyword.map((k) => k[0]), { useKeyword: q.keywordUsed });
          return { id: q.id, ok: JSON.stringify(f.map((x) => x.score)) === JSON.stringify(q.app) && f.map((x) => x.id).join() === q.fused.map((x) => x[0]).join() };
        });
        const form = CAP.retrieval.find((q) => q.id === 'form16');
        const crypto = CAP.retrieval.find((q) => q.id === 'off-topic');
        this.act('q_regime');
        run(8);
        const fetched = staffOf('librarian').some((p) => director.onJob(p, 'fetch'));
        return [
          ['RRF (k 60) reproduces the product’s top 4 for every question', res.every((r) => r.ok), res.map((r) => `${r.id} ${r.ok ? 'ok' : 'differs'}`).join(', ')],
          ['"Form 16" is found by keyword alone (an exact term)', form.vector.length === 0 && form.keywordUsed && form.fused.length === 4],
          ['an off-topic question gets no sources', crypto.fused.length === 0 && crypto.keyword.length > 0 && !crypto.keywordUsed],
          ['the librarians fetch from the shelves it draws on', fetched],
        ];
      },
    },
    {
      id: 'context',
      pip: true,
      enter: () => queueMicrotask(() => slot.chapters?.emit('pipcaption', 'Exactly what the model reads')),
      readouts: () => {
        const blk = contextBlock();
        return [
          { label: 'Block', value: blk.title, tone: 'turq' },
          ...blk.lines.slice(0, 4).map((l, i) => ({ label: String(i + 1), value: l })),
          { label: 'Window', value: 'num-ctx 8192 (the default 2048 would cut the sources off)' },
        ];
      },
      actions: () => [
        { id: 'blk_system', label: 'System rules', pressed: works.block === 'blk_system' },
        { id: 'blk_memory', label: 'Memory', pressed: works.block === 'blk_memory' },
        { id: 'blk_calc', label: 'Calculations', pressed: works.block === 'blk_calc' },
        { id: 'blk_sources', label: 'Sources', pressed: works.block === 'blk_sources' },
      ],
      act(id) {
        if (/^blk_/.test(id)) works.block = id;
      },
      qa() {
        this.act('blk_calc');
        const calc = contextBlock();
        this.act('blk_sources');
        const src = contextBlock();
        const was = works.language;
        works.language = 'ta';
        this.act('blk_system');
        const sys = contextBlock();
        works.language = was;
        const slabs = CAP.steps.filter((s) => s[1].startsWith('Slab ')).length;
        return [
          ['slab-by-slab lines are left out of CALCULATIONS', slabs > 0 && calc.sub.includes(`${CAP.steps.length - slabs} of ${CAP.steps.length}`), calc.sub],
          ['four sources, citable S1 to S4', src.lines.length === 4 && src.lines.every((l, i) => l.startsWith(`[S${i + 1}]`))],
          ['in Tamil the model is told to keep ₹ and section numbers exact', sys.lines.some((l) => /^6\. .*Tamil/.test(l))],
        ];
      },
    },
    {
      id: 'scribe',
      pip: true,
      enter: () => queueMicrotask(() => slot.chapters?.emit('pipcaption', 'The local model, writing')),
      readouts: () => [
        { label: 'Model', value: `${CAP.published.model} on Ollama, through Spring AI`, tone: 'turq' },
        { label: 'Settings', value: 'temperature 0.2 · thinking off · num-ctx 8192' },
        { label: 'Speed', value: works.gpu === 'all' ? `${TOK_ALL} tok/s, every layer on the GPU (${TOK_SPLIT} with Ollama’s default split)` : `${TOK_SPLIT} tok/s with Ollama’s default split (${TOK_ALL} with every layer on the GPU)`, tone: works.gpu === 'all' ? 'turq' : 'amber' },
        { label: 'Internet', value: works.online ? 'connected, but nothing about you is sent' : 'unplugged: answers still arrive; AMFI’s public NAV list waits for tomorrow', tone: works.online ? 'grey' : 'amber' },
        { label: 'Measured', value: `${(PUBLISHED.llm.ms / 1000).toFixed(1)} s to explain a FIRE plan` },
      ],
      actions: () => [
        { id: 'unplug', label: works.online ? 'Unplug the internet' : 'Plug it back in', pressed: !works.online },
        { id: 'gpu', label: works.gpu === 'all' ? 'Ollama’s default split' : 'Every layer on the GPU', pressed: works.gpu !== 'all' },
      ],
      act(id) {
        if (id === 'unplug') {
          works.online = !works.online;
          event(works.online ? 'back online' : 'internet unplugged: nothing changes for the answers');
        }
        if (id === 'gpu') works.gpu = works.gpu === 'all' ? 'split' : 'all';
      },
      qa(run) {
        if (works.online) this.act('unplug');
        const req = submit(toolIndex('fire'), null);
        const ok = runUntil(run, () => req.state === 'counter', 170);
        this.act('unplug');
        this.act('gpu');
        const slow = submit(toolIndex('life'), null);
        runUntil(run, () => slow.log.some((l) => l.step === 'llm' && l.status === 'start'), 170);
        const slowFor = slow.hold;
        this.act('gpu');
        return [
          ['unplugged, an answer still arrives (everything is local)', ok && req.trust === 100],
          ['the default GPU split writes about 3× slower', Math.abs(slowFor / (STOPS[LLM_STOP].dwell) - TOK_ALL / TOK_SPLIT) < 0.15, `${slowFor.toFixed(1)} s against ${STOPS[LLM_STOP].dwell} s`],
          ['and back online afterwards', works.online && works.gpu === 'all'],
        ];
      },
    },
    {
      id: 'safety',
      pip: true,
      enter: () => queueMicrotask(() => slot.chapters?.emit('pipcaption', 'The trust badge: five checks, weighted')),
      readouts: () => {
        const r = lastDone();
        return [
          { label: 'Checks', value: 'sources 25 · numbers 40 · output 15 · products 10 · consistency 10' },
          { label: 'Last answer', value: r ? `trust ${r.trust}${r.source === 'template' ? ', the calculator’s own explanation' : ''}` : 'none yet', tone: r?.trust === 100 ? 'turq' : r ? 'amber' : 'grey' },
          { label: 'On a failed check', value: 'one retry, told exactly what was wrong; then the calculator’s explanation' },
          { label: 'Slipped in', value: markedStatus(), tone: !works.marked ? 'grey' : works.marked.source === 'template' ? 'amber' : works.marked.passed ? 'turq' : works.marked.log.at(-1)?.status === 'retry' ? 'red' : 'grey' },
          { label: 'Retries so far', value: `${works.retries} · fallbacks ${works.fallbacks}` },
          { label: 'Numbers rule', value: 'every ₹ within 2% (or ₹100) of the engine’s' },
        ];
      },
      actions: () => [
        { id: 'fake_figure', label: `Slip in ${inr(MADE_UP)}` },
        { id: 'fund_house', label: 'Name a fund house' },
        { id: 'fail_twice', label: 'Fail twice' },
      ],
      act(id) {
        sabotage(id === 'fund_house' ? 'fund' : id === 'fail_twice' ? 'twice' : 'figure');
      },
      qa(run) {
        const allowed = allowedFrom(CAP.steps.map((s) => Number(String(s[3]).replace(/[^\d.]/g, ''))).filter((v) => v > 0).concat(Object.values(REQ).filter((v) => typeof v === 'number')));
        const planted = !figureOk(MADE_UP, allowed);
        const r0 = works.retries;
        this.act('fake_figure');
        const req = trays.find((r) => r.sabotage === 'figure' && r.state === 'belt') ?? trays.at(-1);
        const came = runUntil(run, () => req.state === 'counter', 170);
        const retried = works.retries > r0 && req?.log.some((l) => l.status === 'retry' && /Numbers/.test(l.detail));
        this.act('fail_twice');
        const t2 = trays.find((r) => r.sabotage === 'twice' && r.state === 'belt') ?? trays.at(-1);
        runUntil(run, () => !t2 || t2.state === 'counter', 200);
        return [
          [`${inr(MADE_UP)} isn’t among the engine’s figures`, planted],
          ['a made-up figure fails Numbers and goes back once', retried, req?.log.map((l) => `${l.step} ${l.status}`).join(', ')],
          ['the rewrite passes, trusted 100', came && req?.trust === 100 && req?.source === 'llm', `${req?.trust}`],
          ['failing twice: the calculator’s own explanation, trusted 60', t2?.source === 'template' && t2?.trust === 60, `${t2?.source} ${t2?.trust}`],
        ];
      },
    },
    {
      id: 'languages',
      pip: true,
      enter: () => queueMicrotask(() => slot.chapters?.emit('pipcaption', 'The same plan, explained in four languages')),
      readouts: () => {
        const L = CAP.languages[works.language];
        return [
          { label: 'Language', value: LANGS[works.language], tone: 'turq' },
          { label: 'First step, as written', value: L.line },
          { label: 'Checked', value: `${L.figures} ₹ figures verified against the engine · trust ${L.score}` },
          { label: 'Honestly', value: 'a 4B model’s wording is weakest in Indian languages; the checks guard the numbers' },
        ];
      },
      actions: () => Object.entries(LANGS).map(([k, v]) => ({ id: `lang_${k}`, label: v, pressed: works.language === k })),
      act(id) {
        const k = id.replace('lang_', '');
        if (LANGS[k]) works.language = k;
      },
      qa() {
        const all = Object.entries(CAP.languages);
        this.act('lang_ta');
        const set = works.language === 'ta';
        this.act('lang_en');
        return [
          ['every language keeps ₹54,500 exactly', all.every(([, v]) => v.line.includes('₹54,500')), all.map(([k]) => k).join(', ')],
          ['and each passed the numbers check', all.every(([, v]) => v.score === 100 && v.figures > 0), all.map(([k, v]) => `${k} ${v.figures}`).join(', ')],
          ['a language can be chosen', set],
        ];
      },
    },
    {
      id: 'montecarlo',
      pip: true,
      enter: () => queueMicrotask(() => slot.chapters?.emit('pipcaption', '1,000 market futures for the plan')),
      readouts: () => [
        { label: 'Reach the FIRE number', value: `${Math.round(plan.sim.successPct)}% of 1,000 futures`, tone: plan.sim.successPct >= 50 ? 'turq' : 'amber' },
        { label: 'Needs', value: `SIP ${inr(plan.sip)}/mo to reach ${compact(plan.fire)} by ${works.plan.retire}` },
        { label: `At ${works.plan.retire}`, value: `P10 ${compact(plan.sim.bands[plan.years].p10)} · P50 ${compact(plan.sim.bands[plan.years].p50)} · P90 ${compact(plan.sim.bands[plan.years].p90)}` },
        { label: 'Assumptions', value: `inflation ${works.plan.inflationPct}% · equity ${works.plan.equityReturnPct}% (σ 18%) · debt 7% (σ 4%) · withdraw 3.5%` },
        { label: 'Seeded', value: 'the same inputs always give the same futures' },
      ],
      actions: () => [
        { id: 'retire_earlier', label: `Retire at ${works.plan.retire - 2}` },
        { id: 'retire_later', label: `Retire at ${works.plan.retire + 3}` },
        { id: 'inflation', label: works.plan.inflationPct === 6 ? 'Inflation 7%' : 'Inflation 6%', pressed: works.plan.inflationPct !== 6 },
        { id: 'reset', label: 'As planned (50)', pressed: works.plan.retire === 50 && works.plan.inflationPct === 6 },
      ],
      act(id) {
        if (id === 'retire_earlier') works.plan.retire = Math.max(REQ.currentAge + 5, works.plan.retire - 2);
        if (id === 'retire_later') works.plan.retire = Math.min(70, works.plan.retire + 3);
        if (id === 'inflation') works.plan.inflationPct = works.plan.inflationPct === 6 ? 7 : 6;
        if (id === 'reset') works.plan = { retire: 50, inflationPct: 6, equityReturnPct: 12 };
        computePlan();
        plan.grown = 0;
      },
      qa(run) {
        this.act('reset');
        run(0.5);
        const b30 = plan.sim.bands[1];
        const want = CAP.bands['30'];
        const exact = [b30.p10, b30.p50, b30.p90].map(Math.round).join() === want.join();
        const s0 = plan.sim.successPct;
        const sip0 = plan.sip;
        this.act('retire_later');
        const later = { s: plan.sim.successPct, sip: plan.sip };
        this.act('reset');
        const again = plan.sim.successPct === s0;
        return [
          ['1,000 seeded futures: 37% reach the FIRE number, as the product said', Math.round(s0) === CAP.published.successPct && sip0 === 74500, `${s0}% at ${inr(sip0)}`],
          ['the bands at 30 match the product to the rupee', exact, `${[b30.p10, b30.p50, b30.p90].map(Math.round).join(' · ')}`],
          ['retiring later needs less a month', later.sip < sip0, `${inr(later.sip)} (${later.s}%)`],
          ['and the same inputs give the same futures', again],
        ];
      },
    },
  ];
  const SHOTS = {
    tools: { target: [-3.3, 0.8, 2.2], zoom: 0.55, yaw: -0.1 },
    memory: { target: [-4.5, 0.9, 0.2], zoom: 0.46, yaw: -0.2 },
    engine: { target: [-4.8, 1.1, -2.4], zoom: 0.46, yaw: -0.15 },
    library: { target: [-1.3, 1.0, -2.8], zoom: 0.56, yaw: 0.02 },
    context: { target: [2.8, 1.0, -2.6], zoom: 0.44, yaw: 0.05 },
    scribe: { target: [3.8, 1.1, -0.8], zoom: 0.4, yaw: 0.1 },
    safety: { target: [3.0, 0.9, 0.4], zoom: 0.44, yaw: 0.05 },
    languages: { target: [3.6, 1.0, 2.2], zoom: 0.4, yaw: 0.1 },
    montecarlo: { target: [-0.35, 0.9, 0.5], zoom: 0.42, pitch: 0.28 },
  };
  for (const c of chapters) if (SHOTS[c.id]) c.shot = SHOTS[c.id];

  // Beats: when a chapter opens (on a card's tour too), its feature happens.
  director.beat('tools', () => ask(Math.floor(rand() * TOOLS.length)));
  // (On a card's tour, a made-up figure is slipped in; in a case study the visitor does it.)
  director.beat('safety', () => {
    if (card) chapters.find((c) => c.id === 'safety').act('fake_figure');
    return null;
  });
  director.beat('montecarlo', () => {
    plan.grown = 0;
    works.redraws++;
    return null;
  });

  // ---------------------------------------------------------------- frame
  return {
    chapters,
    agents: b.agents,
    grid: b.grid,
    crowd: b.crowd,
    districts,
    roles: { customer: 'visitor', staff: [...STAFF, 'scribe'] },
    works,
    director,
    onChapter: (id) => director.enter(id),
    beatMeter: {
      tools: { event: () => works.requests },
      safety: { event: () => works.stamps },
      montecarlo: { event: () => works.redraws },
    },
    demo: {
      shots: {
        tools: [['tool_fire', 6000]],
        memory: [['profile_saved', 4000]],
        engine: [['year_2025_26', 1500]],
        library: [['q_form16', 5000]],
        context: [['blk_calc', 1000]],
        scribe: [['unplug', 3000]],
        safety: [['fake_figure', 12000]],
        languages: [['lang_ta', 1500]],
        montecarlo: [['retire_later', 2500]],
      },
      record: [
        ['chapter', 'tools', 3500], ['act', 'tool_fire', 6000], ['act', 'tool_tax', 4000],
        ['chapter', 'memory', 3000], ['act', 'profile_saved', 5000], ['act', 'profile_guest', 2500],
        ['chapter', 'engine', 3000], ['act', 'year_2025_26', 3000], ['act', 'year_2026_27', 3000],
        ['chapter', 'library', 3000], ['act', 'q_regime', 4000], ['act', 'q_form16', 4000], ['act', 'q_crypto', 4000],
        ['chapter', 'context', 3000], ['act', 'blk_system', 3000], ['act', 'blk_calc', 3000], ['act', 'blk_sources', 3000],
        ['chapter', 'scribe', 3000], ['act', 'unplug', 5000], ['act', 'unplug', 2000], ['act', 'gpu', 6000], ['act', 'gpu', 2000],
        ['chapter', 'safety', 3000], ['act', 'fake_figure', 22000], ['act', 'fail_twice', 50000],
        ['chapter', 'languages', 3000], ['act', 'lang_hi', 3000], ['act', 'lang_te', 3000], ['act', 'lang_ta', 3000], ['act', 'lang_en', 2000],
        ['chapter', 'montecarlo', 3500], ['act', 'retire_later', 4000], ['act', 'retire_earlier', 4000], ['act', 'inflation', 4000], ['act', 'reset', 3000],
      ],
    },
    pip: () => {
      const c = slot.chapters?.current;
      if (!c?.pip) return null;
      drawPanel();
      return { image: panel.canvas, fps: 6 };
    },
    draw2d: null,
    pickables: () => [...b.picks, ...people.filter((p) => p.visible).map((p) => p.proxy)],
    onClick(hit) {
      const a = hit.object.userData.agent;
      if (a) ctx.emit('person', a.role === 'visitor' ? `${a.name}${a.request ? `: ${a.request.tool.label}` : ''}` : `${a.name}, ${nearestPlace(a.pos.x, a.pos.y)}`);
    },
    onDrag() {},
    update(dt) {
      works.clock += dt;
      runTimers();
      if ((districtT -= dt) <= 0) {
        districts.tick(0.2 - districtT, people);
        districtT = 0.2;
      }
      trayTick(dt);
      drawTrays();
      // An answer nobody came for is filed by the clerk after a while.
      for (const r of [...trays]) {
        if (r.state !== 'counter') continue;
        if ((!r.visitor || !r.visitor.visible || r.visitor.request !== r) && works.clock - r.handAt > 8) {
          dropTray(r);
          works.answers++;
          if (r.profile === 'saved') works.history++;
          lastHanded = { req: r, at: works.clock, who: null };
        }
      }
      // People who left come back as someone new, a little later: one at a time through the door.
      for (const a of visitors()) {
        if (a.visible) continue;
        const fol = a.party && a !== a.leader;
        if (fol && !a.leader.visible) continue;
        if (!fol && a.party && people.some((p) => p.leader === a && p !== a && p.visible)) continue;
        a.st.back = (a.st.back ?? 6 + rand() * 10) - dt;
        if (!fol && a.st.back > 0) continue;
        if (!fol && insideCount() >= MAX_INSIDE) {
          a.st.back = 2;
          continue;
        }
        const leaving = visitors().some((p) => p.visible && p.st.phase === 'exiting' && Math.hypot(p.pos.x - spot('door_out').x, p.pos.y - spot('door_out').z) < 2.4);
        if (!fol && (works.clock < nextArrival || leaving || works.clock - lastExit < 3)) {
          a.st.back = 0.5;
          continue;
        }
        if (!b.crowd.enter(a, 'street')) continue;
        if (!fol) nextArrival = works.clock + 6 + rand() * 4;
        a.st = { tasks: [go(spot('street_in'), { via: true }), go(spot('door_in'), { via: true })], phase: 'arrive' };
        a.lang = langCycle[(works.requests + a.id) % langCycle.length];
        a.request = null;
        a.crumbs = [];
        hold(a, a.bag ? null : 'phone');
      }
      b.update(dt);
      if ((unstickT -= dt) <= 0) {
        unstickT = 1;
        unstick();
      }
      drawRings();
      moveParts(dt);
      director.update(dt);
      tableTick(dt);
      if (!card || slot.chapters?.current) {
        boardTick();
        dialTick();
      }
      // Labels on the case study: whatever the chapter is about.
      if (!card) {
        const cur = slot.chapters?.current?.id;
        const r = focus;
        if (r && r.state === 'belt' && ['tools', 'scribe', 'safety'].includes(cur)) {
          const st = stageOf(r);
          const last = r.log.at(-1);
          labels.set('tray', { text: r.tool.label, sub: last?.status === 'retry' ? 'back to the model' : STAGE_NAME[st] ?? 'input', tone: last?.status === 'retry' ? 'red' : 'turq', at: [r.g.position.x, 1.05, r.g.position.z], priority: true });
        }
        if (cur === 'montecarlo') labels.set('fan', { text: `${Math.round(plan.sim.successPct)}%`, sub: 'of 1,000 futures', tone: 'turq', at: [-0.35, 1.2, 0.45], priority: true });
        if (cur === 'languages' && lastHanded?.who) labels.set('answer', { text: CAP.languages[works.language].line, sub: LANGS[works.language], tone: 'turq', at: [3.9, 1.8, 2.25], priority: true });
      }
    },
    snapshot() {
      return { works: { requests: works.requests, answers: works.answers } };
    },
    resume(s) {
      if (s?.works) Object.assign(works, s.works);
    },
    reset() {},
    dispose() {
      timers = [];
      b.dispose();
      rings.dispose?.();
      for (const m of Object.values(inst)) {
        m.removeFromParent();
        m.material.dispose();
        m.dispose();
      }
      for (const g of Object.values(trayGeo)) g.dispose();
      for (const s of [table, board2, dial]) {
        s.tex.dispose();
        s.material.dispose();
        s.mesh?.geometry.dispose();
        s.mesh?.removeFromParent();
      }
      tube.mesh.geometry.dispose();
      tube.mesh.material.dispose();
      tube.mesh.removeFromParent();
      pickGeo.dispose();
      pickMat.dispose();
    },
  };
}
