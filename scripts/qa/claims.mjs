/**
 * What must never ship, and what must never be written into the repo:
 *
 *   node scripts/qa/claims.mjs
 *
 *  1. no forbidden name or number in the repo's own text files (tracked, or
 *     new and not ignored) or in dist/: the claims project's client, its
 *     deployment and repo names, the real claim files' references, and the
 *     name of the colleague who ran that engagement. The list is kept as
 *     SHA-256 hashes of lowercase words and word pairs, so this file never
 *     spells them out, and a hit is reported by number, not by the word
 *  2. no em or en dash in site copy: every string the data modules export,
 *     and the text and attributes of the pages (source and built)
 *  3. no TODO_ placeholder in a built page: the data keeps them for blanks the
 *     owner has yet to fill, and the site must hide every one
 *
 * The newest build is checked (dist/, or the gate suite's build/qa/dist/), so
 * run npm run build first for the full check.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib.mjs';

// The first 24 hex digits of sha256(lowercase word or "word word").
const FORBIDDEN = [
  '1c5a376b3583126cdeb77c1f',
  'f157a2210d3e93ceb22615d9',
  '09059cd9b51e14758103a65a',
  'cc467f41ef21916e3bebb541',
  '0612b2db90ce9cd23df8621d',
  '74eb996a8eaf61f6e3c84864',
  'f386fcd4f8b924632257d614',
  'f48b8af823a6e950186d7384',
  '56d723917f28bfafff4cda3a',
  'e191f3a1de868a3f79768da3',
  '44b1e3ce4350a346a9402cc1',
  '6cbf5fbfb8a90cd591bdb257',
  'b034c26358ef59a912752e4f',
  'ffa1ababe4105ee5ae1aa2c4',
];
const BANNED = new Map(FORBIDDEN.map((h, i) => [h, i + 1]));

const TEXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.json', '.html', '.css', '.md', '.py', '.txt', '.xml', '.svg', '.yml', '.yaml', '.toml', '.webmanifest', '.glsl', '.vert', '.frag', '.gitignore', '']);
const DASH = /[–—]/;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`);
};

const seen = new Map();
const hashOf = (s) => {
  let h = seen.get(s);
  if (h === undefined) {
    h = createHash('sha256').update(s).digest('hex').slice(0, 24);
    seen.set(s, h);
  }
  return h;
};

/** Forbidden words in a text, as "line:#n" (never the word itself). */
function forbidden(text) {
  const hits = [];
  const lines = text.toLowerCase().split('\n');
  for (const [k, line] of lines.entries()) {
    const words = line.split(/[^a-z0-9_]+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      for (const w of i + 1 < words.length ? [words[i], `${words[i]} ${words[i + 1]}`] : [words[i]]) {
        const n = BANNED.get(hashOf(w));
        if (n) hits.push(`${k + 1}:#${n}`);
      }
    }
  }
  return hits;
}

/** A page's own words: its markup without comments, scripts and styles. */
const pageText = (html) =>
  html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '');

const lineHits = (text, re) =>
  text
    .split('\n')
    .map((l, i) => (re.test(l) ? `${i + 1}: ${l.trim().slice(0, 60)}` : null))
    .filter(Boolean);

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

async function readText(file) {
  if (!TEXT.has(extname(file).toLowerCase())) return null;
  const s = await stat(file).catch(() => null);
  if (!s?.isFile() || s.size > 8 * 1024 * 1024) return null;
  const buf = await readFile(file);
  return buf.includes(0) ? null : buf.toString('utf8');
}

// ---------------------------------------------------------------- 1. the repo
const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
  .toString('utf8')
  .split('\0')
  .filter(Boolean);
const repoHits = [];
let scanned = 0;
for (const rel of new Set(listed)) {
  const text = await readText(join(ROOT, rel));
  if (text == null) continue;
  scanned++;
  for (const h of forbidden(text)) repoHits.push(`${rel}:${h}`);
}
check(`no forbidden word in the repo (${scanned} text files)`, repoHits.length === 0, repoHits.slice(0, 8).join(', '));

// ---------------------------------------------------------------- 2. site copy
const dataDir = join(ROOT, 'src', 'data');
const dashes = [];
for (const f of (await readdir(dataDir)).filter((f) => f.endsWith('.js'))) {
  const mod = await import(pathToFileURL(join(dataDir, f)).href);
  const visit = (v, path) => {
    if (typeof v === 'string') {
      if (DASH.test(v)) dashes.push(`${f} ${path}: ${v.slice(0, 50)}`);
    } else if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) visit(x, path ? `${path}.${k}` : k);
  };
  for (const [k, v] of Object.entries(mod)) visit(v, k);
}
check('no em or en dash in the data modules', dashes.length === 0, dashes.slice(0, 5).join(' | '));

const pages = ['index.html', 'resume/index.html'].filter((p) => existsSync(join(ROOT, p)));
const srcDashes = [];
for (const p of pages) for (const h of lineHits(pageText(await readFile(join(ROOT, p), 'utf8')), DASH)) srcDashes.push(`${p}:${h}`);
check(`no em or en dash in the page sources (${pages.join(', ')})`, srcDashes.length === 0, srcDashes.slice(0, 5).join(' | '));

// ---------------------------------------------------------------- 3. what ships
// The newest build: npm run build's dist/, or the one the gate suite makes.
const dist = [join(ROOT, 'dist'), join(ROOT, 'build', 'qa', 'dist')]
  .filter((d) => existsSync(join(d, 'index.html')))
  .sort((a, b) => statSync(join(b, 'index.html')).mtimeMs - statSync(join(a, 'index.html')).mtimeMs)[0];
if (!dist) {
  console.log('     no build to check: run npm run build for the full check');
} else {
  console.log(`     checking ${relative(ROOT, dist).replaceAll('\\', '/')}/`);
  const distHits = [];
  const distDashes = [];
  const todos = [];
  let files = 0;
  for (const file of await walk(dist)) {
    const text = await readText(file);
    if (text == null) continue;
    files++;
    const rel = relative(ROOT, file).replaceAll('\\', '/');
    for (const h of forbidden(text)) distHits.push(`${rel}:${h}`);
    if (file.endsWith('.html')) {
      const own = pageText(text);
      for (const h of lineHits(own, DASH)) distDashes.push(`${rel}:${h}`);
      for (const h of lineHits(own, /TODO_/)) todos.push(`${rel}:${h}`);
    }
  }
  check(`no forbidden word in the build (${files} text files)`, distHits.length === 0, distHits.slice(0, 8).join(', '));
  check('no em or en dash in the built pages', distDashes.length === 0, distDashes.slice(0, 5).join(' | '));
  check('no TODO_ placeholder in the built pages', todos.length === 0, todos.slice(0, 5).join(' | '));
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
