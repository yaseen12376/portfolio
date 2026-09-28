/**
 * Build the project dioramas: Blender (headless) -> optimised web assets.
 *
 *   node scripts/build-3d.mjs [ids...] [--stages light,env,export,still] [--force] [--samples N]
 *   node scripts/build-3d.mjs <id> --stages nav --force   (the floor plan and spots only)
 *   node scripts/build-3d.mjs people          # the shared cast (people.glb)
 *
 * For each scene id (scripts/blender/scenes/<id>.py):
 *   1. Skip if nothing it depends on changed (content hash of the kit, the
 *      scene script and the arguments), unless --force.
 *   2. Run each Blender stage in its OWN process: headless Cycles baking leaks
 *      memory and occasionally crashes, and a fresh process makes both harmless.
 *   3. Optimise the GLB: dedup, GPU instancing for repeated props, meshopt
 *      compression (quantised, so it stays small on the wire and in memory).
 *   4. Encode the lightmap and environment as WebP; composite the Cycles stills
 *      onto the page's backdrop as the posters.
 *   5. Validate (gltf-validator: zero errors) and check the budgets; write
 *      public/3d/<id>/manifest.json with sizes, counts and a content hash the
 *      page appends to every URL (Vercel caches /3d/ for a week).
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, instance, meshopt, prune, resample, weld } from '@gltf-transform/functions';
import validator from 'gltf-validator';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BLENDER = process.env.BLENDER || 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
// A stage that runs longer is killed: 20 minutes suits the laptop's GPU; a
// CPU-only machine bakes slower (BLENDER_TIMEOUT_MIN=120).
const TIMEOUT_MIN = Number(process.env.BLENDER_TIMEOUT_MIN ?? 20);
const BUILD = join(ROOT, 'build', '3d');
const PUBLIC = join(ROOT, 'public', '3d');
const STAGES = ['light', 'env', 'export', 'still'];

// Budgets (see the plan): per scene. The desktop download (geometry, the
// lightmap, the photo tiles, the environment) is capped as a whole at 3.5 MB;
// the lightmap's own line is there to catch a runaway bake, not to squeeze a
// clean one.
const BUDGET = { glbKB: 1500, glbWarnKB: 1100, triangles: 200_000, drawCalls: 120, lightmapKB: 1300, albedoKB: 1500, totalKB: 3500 };

// ---------------------------------------------------------------- args

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const VALUED = new Set(['--stages', '--samples']);
const ids = argv.filter((a, i) => !a.startsWith('--') && !VALUED.has(argv[i - 1]));
const stages = opt('stages', STAGES.join(',')).split(',');
const samples = opt('samples', '256');

// ---------------------------------------------------------------- blender

function blender(script, args, label) {
  return new Promise((ok, fail) => {
    const t0 = Date.now();
    const p = spawn(BLENDER, ['--background', '--factory-startup', '--python', join(ROOT, script), '--', ...args], { cwd: ROOT });
    let tail = '';
    const keep = /BAKED|RENDERED|EXPORTED|MERGED|NAV|Error|Traceback|File "|Exception/;
    const onData = (b) => {
      for (const line of b.toString().split(/\r?\n/)) {
        if (!line) continue;
        tail = (tail + '\n' + line).slice(-4000);
        if (keep.test(line) && !/HIPEW/.test(line)) console.log(`    ${label}: ${line.trim()}`);
      }
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    const timer = setTimeout(() => p.kill(), TIMEOUT_MIN * 60 * 1000);
    p.on('close', (code) => {
      clearTimeout(timer);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (code === 0 && !/Traceback/.test(tail)) return ok(secs);
      fail(new Error(`${label} failed (exit ${code}) after ${secs}s\n${tail.slice(-1500)}`));
    });
  });
}

async function runStage(id, stage) {
  const args = ['--scene', id, '--stage', stage, '--samples', stage === 'export' ? '128' : samples];
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const s = await blender('scripts/blender/bake_scene.py', args, stage);
      console.log(`  ${stage.padEnd(7)} ${s}s`);
      return;
    } catch (e) {
      if (attempt === 2) throw e;
      console.log(`  ${stage} failed, retrying once: ${String(e.message).split('\n')[0]}`);
    }
  }
}

// ---------------------------------------------------------------- hashing

async function hashInputs(id) {
  const h = createHash('sha256');
  const files = [
    'scripts/blender/common.py',
    'scripts/blender/bake_scene.py',
    ...(await readdir(join(ROOT, 'scripts/blender/kit'))).filter((f) => f.endsWith('.py')).map((f) => `scripts/blender/kit/${f}`),
    `scripts/blender/scenes/${id}.py`,
  ];
  for (const f of files.sort()) h.update(f).update(await readFile(join(ROOT, f)));
  h.update(JSON.stringify({ samples, stages }));
  return h.digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------- glTF

const io = () =>
  new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

/**
 * Drop animation channels that never move: bones never scale, most never
 * translate, and a clip keys every bone. Each channel costs a sampler, two
 * accessors and their buffer views in the glTF JSON, which for a cast of
 * twenty clips was most of the file. A channel is static when every keyframe
 * equals the node's rest value.
 */
function dropStaticChannels(eps = 1e-4) {
  return (doc) => {
    let dropped = 0;
    for (const anim of doc.getRoot().listAnimations()) {
      for (const ch of anim.listChannels()) {
        const node = ch.getTargetNode();
        const path = ch.getTargetPath();
        const out = ch.getSampler()?.getOutput();
        if (!node || !out || !['translation', 'rotation', 'scale'].includes(path)) continue;
        const rest = path === 'translation' ? node.getTranslation() : path === 'rotation' ? node.getRotation() : node.getScale();
        const n = out.getElementSize();
        const arr = out.getArray();
        let still = true;
        for (let i = 0; i < arr.length && still; i += n) {
          // q and -q are the same rotation.
          const same = (sgn) => rest.every((r, k) => Math.abs(arr[i + k] * sgn - r) < eps);
          still = same(1) || (path === 'rotation' && same(-1));
        }
        if (still) {
          const sampler = ch.getSampler();
          ch.dispose();
          if (!sampler.listParents().some((p) => p.propertyType === 'AnimationChannel')) sampler.dispose();
          dropped++;
        }
      }
    }
    console.log(`  animation: dropped ${dropped} static channels`);
  };
}

async function optimise(src, dst, { animations = false, quantize = {} } = {}) {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const doc = await io().read(src);
  // No prune of attributes or empty nodes: the lightmap UV (TEXCOORD_1) is
  // referenced by no material, and anchors are empty nodes the page reads.
  // Materials are never merged: in the tiled era their names say which photo
  // tile the page draws (Blender exports them with identical defaults).
  const steps = [dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }), weld()];
  if (!animations) steps.push(instance({ min: 2 }));
  if (animations) steps.push(resample(), dropStaticChannels());
  steps.push(prune({ propertyTypes: ['accessor', 'material', 'texture', 'animation'], keepAttributes: true, keepLeaves: true }));
  // 8-bit normals are invisible at diorama scale and halve their bytes.
  steps.push(meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizeNormal: 8, ...quantize }));
  await doc.transform(...steps);
  await io().write(dst, doc);
  return doc;
}

function stats(doc) {
  const root = doc.getRoot();
  let triangles = 0;
  let drawCalls = 0;
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const inst = node.getExtension('EXT_mesh_gpu_instancing');
    const count = inst ? inst.getAttribute('TRANSLATION')?.getCount() ?? 1 : 1;
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const tris = (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
      triangles += tris * count;
      drawCalls += 1; // an instanced primitive is still one draw
    }
  }
  return { triangles: Math.round(triangles), drawCalls, nodes: root.listNodes().length, animations: root.listAnimations().length };
}

async function validate(path) {
  const r = await validator.validateBytes(new Uint8Array(await readFile(path)), {
    externalResourceFunction: () => Promise.reject(new Error('no external resources')),
  });
  return { errors: r.issues.numErrors, warnings: r.issues.numWarnings, first: r.issues.messages.filter((m) => m.severity === 0).slice(0, 3) };
}

// ---------------------------------------------------------------- images

/** The page's backdrop behind every diorama: a soft radial lift on near-black. */
function backdrop(w, h) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><radialGradient id="g" cx="50%" cy="46%" r="70%">
      <stop offset="0" stop-color="#1b1a22"/><stop offset="0.55" stop-color="#101015"/><stop offset="1" stop-color="#09090b"/>
    </radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * The same miniature treatment the page applies live (src/three/post.js):
 * tilt-shift by screen height (a sharp band, soft above and below), a gentle
 * saturation lift and a vignette. Applied to the stills so a poster and the
 * live scene that replaces it look alike.
 */
async function miniature(png, w, h, post) {
  const focus = post.focus ?? 0.5;
  const band = post.band ?? 0.16;
  const ramp = post.ramp ?? 0.3;
  const sharpImg = await sharp(png).ensureAlpha().raw().toBuffer();
  const soft = await sharp(png).ensureAlpha().blur(Math.max(0.3, w / 520)).raw().toBuffer();
  const out = Buffer.alloc(sharpImg.length);
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    const d = Math.max(0, Math.abs(v - focus) - band);
    const m = Math.min(1, d / ramp);
    const k = m * m * (3 - 2 * m);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) out[i + c] = Math.round(sharpImg[i + c] * (1 - k) + soft[i + c] * k);
    }
  }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } })
    .modulate({ saturation: post.sat ?? 1.06 })
    .png()
    .toBuffer();
}

async function posters(id, post) {
  const src = join(BUILD, id);
  const dst = join(PUBLIC, id);
  const made = [];
  for (const [aspect, name] of [['16x9', 'poster'], ['sq', 'poster-sq'], ['wide', 'poster-wide']]) {
    const f = join(src, `still-${aspect}.png`);
    if (!existsSync(f)) continue;
    const meta = await sharp(f).metadata();
    const { width: w, height: h } = meta;
    const comp = await sharp(await backdrop(w, h)).composite([{ input: f }]).png().toBuffer();
    const mini = await miniature(comp, w, h, post);
    // Vignette last, over the backdrop and the scene alike.
    const vig = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs><radialGradient id="v" cx="50%" cy="50%" r="75%"><stop offset="0.55" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="${post.vignette ?? 0.3}"/></radialGradient></defs>
      <rect width="100%" height="100%" fill="url(#v)"/></svg>`);
    // Flatten to a buffer first: sharp resizes BEFORE compositing regardless
    // of call order, so a resize chained here would meet a full-size overlay.
    const final = await sharp(mini).composite([{ input: vig }]).removeAlpha().png().toBuffer();
    await sharp(final).webp({ quality: 82, effort: 6 }).toFile(join(dst, `${name}.webp`));
    made.push(`${name}.webp`);
    if (aspect === '16x9') {
      await sharp(final).resize(960).webp({ quality: 80, effort: 6 }).toFile(join(dst, 'poster-960.webp'));
      made.push('poster-960.webp');
    }
  }
  return made;
}

// ---------------------------------------------------------------- one scene

async function buildScene(id) {
  const hash = await hashInputs(id);
  const src = join(BUILD, id);
  const dst = join(PUBLIC, id);
  await mkdir(src, { recursive: true });
  await mkdir(dst, { recursive: true });
  const hashFile = join(src, '.hash');
  if (!flag('force') && existsSync(hashFile) && (await readFile(hashFile, 'utf8')) === hash && existsSync(join(dst, 'manifest.json'))) {
    console.log(`${id}: unchanged (${hash}), skipping. --force to rebuild.`);
    return JSON.parse(await readFile(join(dst, 'manifest.json'), 'utf8'));
  }
  console.log(`${id}: building (${hash})`);
  for (const s of STAGES) if (stages.includes(s)) await runStage(id, s);
  // The floor plan alone (after a layout or nav fix), without baking light again.
  if (stages.includes('nav')) await runStage(id, 'nav');

  const scene = JSON.parse(await readFile(join(src, 'scene.json'), 'utf8'));
  const doc = await optimise(join(src, 'scene.glb'), join(dst, 'scene.glb'));
  const st = stats(doc);

  // The baked light: full size on desktop, half (at least 1k) for phones.
  const lmSize = (await sharp(join(src, 'lightmap.png')).metadata()).width;
  await sharp(join(src, 'lightmap.png')).webp({ quality: lmSize > 2048 ? 84 : 92, effort: 6 }).toFile(join(dst, 'lightmap.webp'));
  const lmSmall = Math.max(1024, lmSize / 2);
  await sharp(join(src, 'lightmap.png')).resize(lmSmall, lmSmall).webp({ quality: 88, effort: 6 }).toFile(join(dst, 'lightmap-small.webp'));
  // The tiled era: each photo tile once, shared by every scene that uses it,
  // named by its content so the week-long cache never serves a stale one.
  let tilesBytes = 0;
  for (const [name, m] of Object.entries(scene.materials ?? {})) {
    if (!m.tile) continue;
    const png = await readFile(join(src, m.tile));
    const h = createHash('sha1').update(png).digest('hex').slice(0, 10);
    const file = `${m.tile.replace(/\.png$/, '')}-${h}.webp`;
    const out = join(PUBLIC, '_shared', 'tiles', file);
    await mkdir(dirname(out), { recursive: true });
    if (!existsSync(out)) await sharp(png).webp({ quality: 86, effort: 6 }).toFile(out);
    tilesBytes += (await stat(out)).size;
    scene.materials[name] = { ...m, map: `/3d/_shared/tiles/${file}` };
  }
  if (scene.albedo && existsSync(join(src, 'albedo.png'))) {
    // The set's colour atlas: full size on desktop, 2k for phones.
    await sharp(join(src, 'albedo.png')).webp({ quality: 86, effort: 6, smartSubsample: true }).toFile(join(dst, 'albedo.webp'));
    await sharp(join(src, 'albedo.png')).resize(2048, 2048).webp({ quality: 86, effort: 6, smartSubsample: true }).toFile(join(dst, 'albedo-2k.webp'));
  }
  // Outputs of an earlier pipeline that this build no longer makes: gone, so
  // they are neither shipped nor counted.
  for (const f of [...(scene.albedo ? [] : ['albedo.webp', 'albedo-2k.webp']), ...(scene.materials ? ['lightmap-1k.webp'] : [])]) {
    if (existsSync(join(dst, f))) await unlink(join(dst, f));
  }
  if (existsSync(join(src, 'env.png'))) {
    await sharp(join(src, 'env.png')).resize(512, 256).webp({ quality: 90, effort: 6 }).toFile(join(dst, 'env.webp'));
  }
  const postersMade = await posters(id, scene.post ?? {});

  const val = await validate(join(dst, 'scene.glb'));
  const sizes = {};
  for (const f of await readdir(dst)) sizes[f] = (await stat(join(dst, f))).size;
  const glbKB = sizes['scene.glb'] / 1024;
  const lmKB = sizes['lightmap.webp'] / 1024;
  const problems = [];
  if (val.errors) problems.push(`gltf-validator: ${val.errors} errors ${JSON.stringify(val.first)}`);
  if (glbKB > BUDGET.glbKB) problems.push(`scene.glb ${glbKB.toFixed(0)} KB > ${BUDGET.glbKB}`);
  if (st.triangles > BUDGET.triangles) problems.push(`${st.triangles} triangles > ${BUDGET.triangles}`);
  if (st.drawCalls > BUDGET.drawCalls) problems.push(`${st.drawCalls} draw calls > ${BUDGET.drawCalls}`);
  if (lmKB > BUDGET.lightmapKB) problems.push(`lightmap ${lmKB.toFixed(0)} KB > ${BUDGET.lightmapKB}`);
  const abKB = (sizes['albedo.webp'] ?? 0) / 1024;
  if (abKB > BUDGET.albedoKB) problems.push(`albedo ${abKB.toFixed(0)} KB > ${BUDGET.albedoKB}`);
  const desktopKB = (['scene.glb', 'lightmap.webp', 'albedo.webp', 'env.webp'].reduce((n, f) => n + (sizes[f] ?? 0), 0) + tilesBytes) / 1024;
  if (desktopKB > BUDGET.totalKB) problems.push(`desktop download ${desktopKB.toFixed(0)} KB > ${BUDGET.totalKB}`);

  const manifest = { id, hash, ...st, validator: { errors: val.errors, warnings: val.warnings }, sizes, posters: postersMade };
  await writeFile(join(dst, 'scene.json'), JSON.stringify({ ...scene, hash }));
  await writeFile(join(dst, 'manifest.json'), JSON.stringify(manifest, null, 1));
  await writeFile(hashFile, hash);

  const warn = glbKB > BUDGET.glbWarnKB ? ' (over the 1.1 MB target)' : '';
  console.log(`${id}: ${glbKB.toFixed(0)} KB glb${warn}, ${st.triangles} tris, ${st.drawCalls} draws, lightmap ${lmKB.toFixed(0)} KB${abKB ? `, albedo ${abKB.toFixed(0)} KB` : ''}, validator ${val.errors} errors / ${val.warnings} warnings`);
  if (problems.length) {
    console.log(`${id}: OVER BUDGET OR INVALID\n  - ${problems.join('\n  - ')}`);
    process.exitCode = 1;
  }
  return manifest;
}

async function buildPeople() {
  console.log('people: building');
  const t = await blender('scripts/blender/people_build.py', flag('preview') ? ['--preview'] : [], 'people');
  console.log(`  blender ${t}s`);
  const dst = join(PUBLIC, '_shared');
  await mkdir(dst, { recursive: true });
  // A figure is under 1.5 m: 12-bit positions are still 0.4 mm apart.
  const doc = await optimise(join(BUILD, '_shared', 'people.glb'), join(dst, 'people.glb'), { animations: true, quantize: { quantizePosition: 12 } });
  await copyFile(join(BUILD, '_shared', 'people.json'), join(dst, 'people.json'));
  const val = await validate(join(dst, 'people.glb'));
  const kb = (await stat(join(dst, 'people.glb'))).size / 1024;
  console.log(`people: ${kb.toFixed(0)} KB, ${stats(doc).animations} clips, validator ${val.errors} errors / ${val.warnings} warnings`);
  if (val.errors) process.exitCode = 1;
}

// ---------------------------------------------------------------- main

const todo = ids.length ? ids : (await readdir(join(ROOT, 'scripts/blender/scenes'))).filter((f) => f.endsWith('.py') && !f.startsWith('__')).map((f) => f.slice(0, -3));
for (const id of todo) {
  if (id === 'people') await buildPeople();
  else await buildScene(id);
}
