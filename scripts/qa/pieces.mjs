/**
 * The pieces under glass, as they ship in public/pieces/:
 *
 *   node scripts/qa/pieces.mjs [ids...]
 *
 *  1. every shelf project has its own piece built, and src/data/pieces.json
 *     (what the page reads) agrees with public/pieces/manifest.json
 *  2. every file the page asks for is there and within its budget (the
 *     budgets are read from scripts/build-pieces.mjs, so there is one list)
 *  3. a poster's backdrop is the page colour, #09090b, to within one level,
 *     so the frameless tile has no visible edge
 *  4. each loop, decoded as a browser decodes it (BT.709, limited range):
 *     its backdrop is the page colour too, and its seam is invisible, the
 *     step from the last frame to the first no bigger than an ordinary step
 *     from one frame to the next
 *  5. each live jar (the case study's): its files are there and within
 *     budget, its scene.json is the version the page asks for and describes
 *     the jar, its material tracks and its page hook (src/three/pieces/)
 *     find what they animate in its scene.glb, and its spots and its
 *     project's chapters match one for one, in words the site may use
 *
 * (In the browser, a tile looks the same still and playing: scripts/qa/site.mjs.)
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

import { projects } from '../../src/data/projects.js';
import { ROOT, args } from './lib.mjs';

const opts = args();
const PAGE = [9, 9, 11];
const PUBLIC = join(ROOT, 'public', 'pieces');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`);
};

const src = await readFile(join(ROOT, 'scripts', 'build-pieces.mjs'), 'utf8');
const BUDGET_KB = new Function(`return ${src.match(/const BUDGET_KB = (\{[^}]+\})/)[1]}`)();
const manifest = JSON.parse(await readFile(join(PUBLIC, 'manifest.json'), 'utf8'));
const site = JSON.parse(await readFile(join(ROOT, 'src', 'data', 'pieces.json'), 'utf8'));

// ---------------------------------------------------------------- 1. built, and agreed
const wanted = projects.filter((p) => p.piece?.id).map((p) => p.piece.id);
const missing = wanted.filter((id) => !manifest[id]);
check(`every shelf project has its piece (${wanted.length - missing.length} of ${wanted.length})`, missing.length === 0, missing.length ? `not built yet: ${missing.join(', ')}` : '');
const disagree = [...new Set([...Object.keys(manifest), ...Object.keys(site)])].filter(
  (id) => !manifest[id] || !site[id] || site[id].v !== manifest[id].v || site[id].loop !== manifest[id].frames > 0
);
check('src/data/pieces.json agrees with the manifest', disagree.length === 0, disagree.length ? `${disagree.join(', ')} (node scripts/build-pieces.mjs --stages none)` : '');

/**
 * Raw RGB frames from a video, as a browser shows them, at `size` px square.
 * The colour is converted at full size with accurate rounding and only then
 * scaled: swscale's combined scale-and-convert path is a level or two dark.
 */
function decode(file, picks, size) {
  const select = picks.map((n) => `eq(n\\,${n})`).join('+');
  const vf = `select='${select}',scale=flags=accurate_rnd+full_chroma_int:in_color_matrix=bt709:in_range=limited,format=rgb24,scale=${size}:${size}:flags=area`;
  return new Promise((ok, fail) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', vf, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-']);
    const out = [];
    let err = '';
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', fail);
    p.on('close', (code) => {
      if (code) return fail(new Error(err.slice(-400)));
      const all = Buffer.concat(out);
      const n = size * size * 3;
      ok(picks.map((_, i) => all.subarray(i * n, (i + 1) * n)));
    });
  });
}

/** Mean absolute difference between two frames, in levels. */
const step = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
};

/** The four corner patches of a square RGB frame: their mean, and the worst pixel's distance from the page. */
function corners(px, size) {
  const p = Math.max(4, Math.round(size * 0.03));
  const o = Math.round(size * 0.01);
  const sum = [0, 0, 0];
  let worst = 0;
  let k = 0;
  for (const [x0, y0] of [[o, o], [size - o - p, o], [o, size - o - p], [size - o - p, size - o - p]]) {
    for (let y = y0; y < y0 + p; y++) {
      for (let x = x0; x < x0 + p; x++) {
        const i = (y * size + x) * 3;
        for (let c = 0; c < 3; c++) {
          sum[c] += px[i + c];
          worst = Math.max(worst, Math.abs(px[i + c] - PAGE[c]));
        }
        k++;
      }
    }
  }
  return { mean: sum.map((s) => s / k), worst };
}
const fmt = (c) => c.map((v) => v.toFixed(1)).join(',');
const off = (mean) => Math.max(...mean.map((v, i) => Math.abs(v - PAGE[i])));

// ---------------------------------------------------------------- 2-4. each piece
const ids = opts._.length ? opts._ : Object.keys(manifest).sort();
for (const id of ids) {
  const m = manifest[id];
  if (!m) {
    check(`${id}: in the manifest`, false);
    continue;
  }
  const dir = join(PUBLIC, id);
  const files = ['poster-720.webp', 'poster-1080.webp', ...(m.frames > 0 ? ['loop-720.webm', 'loop-720.mp4', 'loop-1080.webm', 'loop-1080.mp4'] : [])];
  const absent = files.filter((f) => !existsSync(join(dir, f)));
  const over = [];
  for (const f of files.filter((x) => !absent.includes(x))) {
    const kb = (await stat(join(dir, f))).size / 1024;
    if (kb > BUDGET_KB[f]) over.push(`${f} ${kb.toFixed(0)} KB > ${BUDGET_KB[f]}`);
  }
  check(`${id}: all ${files.length} files present and within budget`, absent.length === 0 && over.length === 0, [...absent.map((f) => `missing ${f}`), ...over].join(', '));

  for (const f of ['poster-720.webp', 'poster-1080.webp'].filter((x) => !absent.includes(x))) {
    const { data, info } = await sharp(join(dir, f)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const c = corners(data, info.width);
    // (WebP's own rounding scatters a pixel here and there by a level or two.)
    check(`${id}: ${f} backdrop is the page colour`, info.width === info.height && off(c.mean) <= 0.5 && c.worst <= 2, `mean ${fmt(c.mean)}, worst pixel ${c.worst} off`);
  }

  if (m.frames > 0) {
    const N = m.frames;
    const mid = Math.floor(N / 2);
    const picks = [0, 1, mid, mid + 1, N - 2, N - 1];
    for (const f of ['loop-720.webm', 'loop-720.mp4', 'loop-1080.webm', 'loop-1080.mp4'].filter((x) => !absent.includes(x))) {
      const size = 240;
      const fr = await decode(join(dir, f), picks, size).catch((e) => e);
      if (fr instanceof Error || fr.some((x) => x.length !== size * size * 3)) {
        check(`${id}: ${f} decodes`, false, fr instanceof Error ? fr.message : 'short read');
        continue;
      }
      const c = corners(fr[0], size);
      // (A browser decodes in floating point; ffmpeg's integers can land a level lower.)
      check(`${id}: ${f} backdrop decodes to the page colour`, off(c.mean) <= 1.2 && c.worst <= 2, `mean ${fmt(c.mean)}, worst pixel ${c.worst} off`);
      const steps = [step(fr[0], fr[1]), step(fr[2], fr[3]), step(fr[4], fr[5])];
      const seam = step(fr[5], fr[0]);
      const limit = Math.max(...steps) * 1.25 + 0.2;
      check(`${id}: ${f} loops without a visible seam`, seam <= limit, `seam ${seam.toFixed(2)}, steps ${steps.map((s) => s.toFixed(2)).join('/')}`);
    }
  }
}

// ---------------------------------------------------------------- 5. each live jar
/** The names in a GLB's JSON chunk: its nodes and its materials. */
function gltfNames(buf) {
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
  return {
    nodes: new Set((json.nodes ?? []).map((n) => n.name)),
    materials: new Set((json.materials ?? []).map((m) => m.name)),
  };
}
// The channels src/three/piece-tracks.js sets.
const TRACK_CHANNELS = new Set(['emissive', 'emissiveColor', 'opacity', 'color']);
// The pieces with a module of their own (src/three/pieces/index.js), and what each reads.
const hookIds = new Set([...(await readFile(join(ROOT, 'src', 'three', 'pieces', 'index.js'), 'utf8')).matchAll(/^\s+'?([\w-]+)'?: \(\) => import\(/gm)].map((m) => m[1]));
const HOOK_NEEDS = {
  courier: { key: 'receipt', fields: ['mesh', 'tray', 'slot', 'start', 'feed'], nodes: (v) => [v.mesh, v.tray] },
  'indoor-tracking': {
    key: 'ranges',
    fields: ['meshes', 'anchors', 'crate', 'z', 'lim', 'width', 'segs'],
    nodes: (v) => [...(v.meshes?.length === v.anchors?.length ? v.meshes : ['(as many range meshes as anchors)']), v.crate],
  },
  adraf: { key: 'scan', fields: ['ring', 'band', 'color', 'materials'], nodes: (v) => [v.ring], materials: (v) => Object.keys(v.materials ?? {}) },
  observex: { key: 'glow', fields: ['mesh', 'strength'], nodes: (v) => [v.mesh] },
  'kps-cleano': { key: 'film', fields: ['material', 'thickness', 'ior'], nodes: () => [], materials: (v) => [v.material] },
};
const LIVE_BUDGET_KB = new Function(`return ${src.match(/const LIVE_BUDGET_KB = (\{[^}]+\})/)[1]}`)();
const LIVE_TOTAL_KB = Number(src.match(/const LIVE_TOTAL_KB = (\d+)/)[1]);
const LIVE_OWN_KB = Number(src.match(/const LIVE_OWN_KB = (\d+)/)[1]);
for (const id of ids.filter((x) => site[x]?.live)) {
  const dir = join(PUBLIC, id, 'live');
  const scene = existsSync(join(dir, 'scene.json')) ? JSON.parse(await readFile(join(dir, 'scene.json'), 'utf8')) : null;
  // A piece's own maps (its dust), each within LIVE_OWN_KB.
  const own = Object.values(scene?.piece?.dust?.maps ?? {});
  const files = [...Object.keys(LIVE_BUDGET_KB), ...own];
  const absent = files.filter((f) => !existsSync(join(dir, f)));
  const sizes = {};
  const over = [];
  for (const f of files.filter((x) => !absent.includes(x))) {
    sizes[f] = (await stat(join(dir, f))).size / 1024;
    const cap = LIVE_BUDGET_KB[f] ?? LIVE_OWN_KB;
    if (sizes[f] > cap) over.push(`${f} ${sizes[f].toFixed(0)} KB > ${cap}`);
  }
  // What a computer downloads (a phone takes the 1k colour atlas instead).
  const total = ['scene.glb', 'lightmap.webp', 'albedo.webp', 'env.webp', 'model_color.webp', 'model_orm.webp', ...own].reduce((n, f) => n + (sizes[f] ?? 0), 0);
  if (total > LIVE_TOTAL_KB) over.push(`${total.toFixed(0)} KB in all > ${LIVE_TOTAL_KB}`);
  check(`${id}: live jar's ${files.length} files present and within budget`, !absent.length && !over.length, [...absent.map((f) => `missing ${f}`), ...over].join(', ') || `${total.toFixed(0)} KB in all`);

  check(`${id}: live scene.json is the version the page asks for`, !!scene && scene.hash === site[id].live, `${scene?.hash} vs src/data/pieces.json ${site[id].live}`);
  const pc = scene?.piece ?? {};
  const lacks = ['turntable', 'glass', 'jar', 'probe', 'room'].filter((k) => !pc[k]);
  if ((pc.probe?.lights?.length ?? 0) < 3) lacks.push('probe.lights');
  check(`${id}: live scene.json describes the jar`, lacks.length === 0, lacks.length ? `lacks ${lacks.join(', ')}` : `${pc.probe.lights.length} room lights${pc.sheen ? ', walnut sheen' : ''}`);
  if (pc.dust) {
    // Everything piece-dust.js reads: the two maps, a sheet and a brush per array, the cycle and the look.
    const d = pc.dust;
    const want = ['start', 'sweep', 'min', 'max', 'tile', 'brush'].filter((k) => typeof d[k] !== 'number');
    if (!d.maps?.grain || !d.maps?.mottle) want.push('maps');
    if (!(d.sheets?.length >= 1) || d.sheets.some((x) => !x.mesh || !x.pivot || typeof x.offset !== 'number' || x.shift?.length !== 2)) want.push('sheets');
    const look = ['patch', 'grain', 'streak', 'rings', 'ridge', 'film', 'speck'].filter((k) => !Array.isArray(d.look?.[k]));
    if (look.length) want.push(`look.${look.join(', look.')}`);
    // Each sweep starts and ends on a key of the clip, so the brush is parked exactly while the dust says so.
    const frames = pc.clip?.frames ?? 0;
    const onKey = (x) => Math.abs(x * frames - Math.round(x * frames)) < 1e-6;
    if (!frames || !onKey(d.start) || !onKey(d.start + d.sweep) || d.sheets.some((x) => !onKey(x.offset))) want.push("sweeps on the clip's keys");
    check(`${id}: live dust described for the page`, want.length === 0, want.length ? `lacks ${want.join(', ')}` : `${d.sheets.length} sheets, sweep ${(d.sweep * (pc.clip?.seconds ?? 6)).toFixed(2)} s`);
  }

  // What the scene.glb holds, by name: what the tracks and the hook find there.
  const glb = existsSync(join(dir, 'scene.glb')) ? gltfNames(await readFile(join(dir, 'scene.glb'))) : { nodes: new Set(), materials: new Set() };
  if (pc.tracks) {
    // Each material animate() changes, one value per key for each channel that
    // changes (piece-tracks.js); a colour may instead be one [r, g, b] for the
    // whole loop (its glow's strength changes, not its colour: NeerNaadi's head).
    const t = pc.tracks;
    const want = [];
    if (!(Number.isInteger(t.frames) && t.frames >= 2)) want.push('frames');
    const oneColour = (ch, v) => (ch === 'emissiveColor' || ch === 'color') && v.length === 3 && v.every((x) => typeof x === 'number');
    for (const [name, chans] of Object.entries(t.materials ?? {})) {
      if (!glb.materials.has(name)) want.push(`material ${name} not in scene.glb`);
      for (const [ch, vals] of Object.entries(chans)) {
        if (!TRACK_CHANNELS.has(ch)) want.push(`${name}.${ch} is no channel piece-tracks.js knows`);
        else if (!Array.isArray(vals) || (vals.length !== t.frames && !oneColour(ch, vals))) want.push(`${name}.${ch} has ${vals?.length} keys, not ${t.frames}`);
      }
    }
    check(`${id}: live material tracks match the scene`, want.length === 0, want.length ? want.join('; ') : `${Object.keys(t.materials ?? {}).length} materials, ${t.frames} keys`);
  }
  const hook = HOOK_NEEDS[id];
  if (hookIds.has(id) || hook) {
    // What the piece's own module (src/three/pieces/<id>.js) reads from scene.json, and the nodes it looks up.
    const want = [];
    if (!hookIds.has(id)) want.push(`no hook in src/three/pieces/index.js`);
    if (!hook) want.push('no entry in HOOK_NEEDS (scripts/qa/pieces.mjs)');
    else {
      const v = pc[hook.key];
      if (!v) want.push(`scene.json piece.${hook.key}`);
      else {
        want.push(...hook.fields.filter((f) => v[f] === undefined).map((f) => `${hook.key}.${f}`));
        for (const n of hook.nodes(v)) if (!glb.nodes.has(n)) want.push(`node ${n} not in scene.glb`);
        for (const n of hook.materials?.(v) ?? []) if (!glb.materials.has(n)) want.push(`material ${n} not in scene.glb`);
      }
    }
    check(`${id}: its page hook finds what it needs`, want.length === 0, want.join('; ') || `piece.${hook.key}`);
  }

  const chapters = projects.find((p) => p.piece?.id === id)?.piece?.chapters ?? [];
  const ids2 = chapters.map((c) => c.id);
  const marks = Object.keys(pc.spots ?? {});
  const unmarked = ids2.slice(1).filter((c) => !marks.includes(c));
  const unused = marks.filter((m) => !ids2.includes(m));
  check(
    `${id}: the whole jar, then one chapter per spot the scene marks (${Math.max(0, ids2.length - 1)})`,
    ids2.length >= 4 && !unmarked.length && !unused.length,
    [unmarked.length && `no mark for ${unmarked.join(', ')}`, unused.length && `no chapter for ${unused.join(', ')}`, ids2.length < 4 && 'fewer than three spots'].filter(Boolean).join('; ')
  );
  const words = chapters.flatMap((c) => [c.title, c.caption, c.hint]).filter(Boolean).join(' ');
  const bad = [/[–—]/.test(words) && 'an en or em dash', /TODO_/.test(words) && 'a TODO_ blank'].filter(Boolean);
  check(`${id}: its chapters' words are the site's own`, bad.length === 0, bad.join(', '));
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
