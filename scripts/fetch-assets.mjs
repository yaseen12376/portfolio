/**
 * Download the CC0 textures listed in scripts/blender/assets.json from Poly
 * Haven into build/assets/textures/<id>/ (git-ignored), checking each file's
 * md5, and record what was fetched (URL, licence, real-world size) in
 * build/assets/manifest.json for the Blender scenes to read.
 *
 *   node scripts/fetch-assets.mjs [--force]
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'build', 'assets');
const force = process.argv.includes('--force');
const cfg = JSON.parse(await readFile(resolve(ROOT, 'scripts', 'blender', 'assets.json'), 'utf8'));
const api = (p) => fetch(`https://api.polyhaven.com/${p}`).then((r) => {
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  return r.json();
});

const manifest = { source: cfg.source, license: cfg.license, textures: {} };
for (const [id, use] of Object.entries(cfg.textures)) {
  const [files, info] = await Promise.all([api(`files/${id}`), api(`info/${id}`)]);
  const f = files.Diffuse?.[cfg.res]?.jpg;
  if (!f) {
    console.warn(`skip ${id}: no ${cfg.res} diffuse jpg`);
    continue;
  }
  const path = resolve(OUT, 'textures', id, `${id}_diff_${cfg.res}.jpg`);
  let buf = existsSync(path) && !force ? await readFile(path) : null;
  const md5 = (b) => createHash('md5').update(b).digest('hex');
  if (!buf || md5(buf) !== f.md5) {
    const r = await fetch(f.url);
    if (!r.ok) throw new Error(`${f.url}: ${r.status}`);
    buf = Buffer.from(await r.arrayBuffer());
    if (md5(buf) !== f.md5) throw new Error(`${id}: md5 mismatch`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buf);
    console.log(`fetched ${id} (${(buf.length / 1024).toFixed(0)} KB)`);
  } else console.log(`cached  ${id}`);
  manifest.textures[id] = {
    use,
    name: info.name,
    authors: Object.keys(info.authors ?? {}),
    // Real-world size of one tile of the texture, in metres.
    size: (info.dimensions ?? [1000, 1000]).map((mm) => +(mm / 1000).toFixed(4)),
    file: `textures/${id}/${id}_diff_${cfg.res}.jpg`,
    url: f.url,
    page: `https://polyhaven.com/a/${id}`,
  };
}
await writeFile(resolve(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`${Object.keys(manifest.textures).length} textures -> ${OUT}`);
