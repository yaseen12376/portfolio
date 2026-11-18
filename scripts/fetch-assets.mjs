/**
 * Download the CC0 assets listed in scripts/blender/assets.json into
 * build/assets/textures/<id>/ (git-ignored), and record what was fetched
 * (URL, licence, real-world size) in build/assets/manifest.json for the
 * Blender scenes to read:
 *   - Poly Haven textures: the diffuse JPG, checked against its md5;
 *   - ambientCG materials: the ZIP, checked against the size the API gives,
 *     from which only the listed maps are kept (by their own base names, so
 *     nothing in the archive chooses where a file goes); the manifest keeps
 *     each map's SHA-256.
 *
 *   node scripts/fetch-assets.mjs [--force]
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'build', 'assets');
const force = process.argv.includes('--force');
const cfg = JSON.parse(await readFile(resolve(ROOT, 'scripts', 'blender', 'assets.json'), 'utf8'));
const UA = { 'User-Agent': 'portfolio-asset-fetch' };
const json = (url) => fetch(url, { headers: UA }).then((r) => {
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
});
const api = (p) => json(`https://api.polyhaven.com/${p}`);
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

const manifest = { source: cfg.source, license: cfg.license, textures: {}, materials: {} };
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
    const r = await fetch(f.url, { headers: UA });
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

/** The entries of a ZIP (no ZIP64, no encryption: what ambientCG serves), by name. */
function unzip(buf) {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = new Map();
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('bad zip directory');
    const method = buf.readUInt16LE(at + 10);
    const packed = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const n = buf.readUInt16LE(at + 28);
    const extra = buf.readUInt16LE(at + 30);
    const note = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + n);
    out.set(name, () => {
      if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`bad zip entry ${name}`);
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + packed);
      const raw = method === 0 ? Buffer.from(data) : method === 8 ? inflateRawSync(data) : null;
      if (!raw || raw.length !== size) throw new Error(`zip entry ${name}: method ${method}`);
      return raw;
    });
    at += 46 + n + extra + note;
  }
  return out;
}

const acg = cfg.ambientcg;
for (const [id, want] of Object.entries(acg?.materials ?? {})) {
  const info = (await json(`https://ambientcg.com/api/v2/full_json?id=${id}&include=downloadData,dimensionsData`)).foundAssets?.[0];
  const dl = info?.downloadFolders?.default?.downloadFiletypeCategories?.zip?.downloads?.find((d) => d.attribute === want.res);
  if (!dl) throw new Error(`${id}: no ${want.res} download`);
  const dir = resolve(OUT, 'textures', id);
  // A map's file: the material's own name, its resolution and the map (no path from the archive).
  const file = (map) => `${id}_${want.res}_${map}.jpg`;
  const have = want.maps.every((m) => existsSync(resolve(dir, file(m))));
  if (!have || force) {
    const r = await fetch(dl.downloadLink, { headers: UA });
    if (!r.ok) throw new Error(`${dl.downloadLink}: ${r.status}`);
    const zip = Buffer.from(await r.arrayBuffer());
    if (zip.length !== dl.size) throw new Error(`${id}: ${zip.length} bytes, the API said ${dl.size}`);
    const entries = unzip(zip);
    await mkdir(dir, { recursive: true });
    for (const m of want.maps) {
      const read = entries.get(file(m));
      if (!read) throw new Error(`${id}: no ${file(m)} in the archive`);
      await writeFile(resolve(dir, file(m)), read());
    }
    console.log(`fetched ${id} ${want.res} (${(zip.length / 1048576).toFixed(1)} MB zip; kept ${want.maps.join(', ')})`);
  } else console.log(`cached  ${id}`);
  const maps = {};
  const sums = {};
  for (const m of want.maps) {
    maps[m] = `textures/${id}/${file(m)}`;
    sums[m] = sha256(await readFile(resolve(dir, file(m))));
  }
  manifest.materials[id] = {
    use: want.use,
    name: info.displayName ?? id,
    source: acg.source,
    license: acg.license,
    // Real-world size of one tile, in metres (ambientCG gives centimetres).
    size: [info.dimensionX ?? 100, info.dimensionY ?? 100].map((cm) => +(cm / 100).toFixed(4)),
    maps,
    sha256: sums,
    url: dl.downloadLink,
    page: `https://ambientcg.com/view?id=${id}`,
  };
}

await writeFile(resolve(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`${Object.keys(manifest.textures).length} textures, ${Object.keys(manifest.materials).length} materials -> ${OUT}`);
