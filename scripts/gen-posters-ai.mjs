/**
 * Generate project posters with FLUX via Pollinations.ai.
 *
 * Free, no API key, no signup. Companion to gen-posters.mjs, which produces the
 * deterministic SVG versions — this one produces photographic/rendered art from
 * the prompts in docs/image-prompts.md.
 *
 * Output: public/posters/<id>.webp at 1920x1080, which is exactly the slot the
 * site already expects. Switch a project over by changing its one `poster:`
 * line in src/data/projects.js from .svg to .webp.
 *
 * Run: npm run gen:posters:ai                    (all of them)
 *      npm run gen:posters:ai -- constructsafe   (just one)
 *
 * Seeds are fixed so re-running reproduces the same images. Change a seed to
 * roll a different composition for that project.
 */
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { overlaySvg } from './gen-posters.mjs';

const OUT = 'public/posters';
const W = 1920;
const H = 1080;

/**
 * Short. Deliberately.
 *
 * The first cut used ~150-word prompts with negative phrasing ("no text, no
 * logos"). FLUX truncates long prompts and ignores negatives in a positive
 * prompt, so the PPE poster came back as an empty room — all mood words, none
 * of the subject. Front-loaded subject, minimal style tail, works far better.
 */
const STYLE = 'cinematic dark teal and violet lighting, volumetric haze, shallow depth of field, photographic';

const PROJECTS = [
  {
    id: 'constructsafe',
    seed: 2277,
    prompt:
 'Two construction workers on a dark building site at night, steel scaffolding silhouettes behind them, one wearing a hard hat and one bare-headed, split lighting',
  },
  {
    id: 'attendance',
    seed: 3319,
    prompt:
 'A dark empty office corridor at night seen from a ceiling CCTV camera, doorway at the far end, cold violet light',
  },
  {
    id: 'indoor-tracking',
    seed: 4507,
    prompt:
 'A dark empty warehouse interior shot from high above, concrete floor, racking in shadow, faint teal light pools',
  },
  {
    id: 'observex',
    seed: 5623,
    prompt:
 'A suburban house exterior at night, porch and driveway, seen from a security camera, grainy low light, violet cast',
  },
  {
    id: 'adraf',
    seed: 6781,
    prompt:
 'A close-up human face in profile half-lit against deep black, soft teal rim light, editorial portrait',
  },
];

async function generate({ id, prompt, seed }) {
  const full = `${prompt} ${STYLE}`;
  const params = new URLSearchParams({
    width: String(W),
    height: String(H),
    // NOTE: Pollinations' free endpoint only serves 'sana' — a request for
    // 'flux' silently falls back to it (check the EXIF: manufacturer=sana).
    model: 'flux',
    nologo: 'true',
    seed: String(seed),
  });
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(full)}?${params}`;

  const t0 = Date.now();
  const res = await fetch(url, {
    headers: { Accept: 'image/*' },
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const raw = Buffer.from(await res.arrayBuffer());
  if (raw.length < 2048) throw new Error(`implausibly small response (${raw.length} B)`);

  const meta = await sharp(raw).metadata();

  // Pollinations caps output at 1024x576 whatever you request (verified: the
  // same bytes come back for 1280x720 and 1920x1080), so upscale with a light
  // sharpen, push it darker to sit in the site's palette, then lay the precise
  // detection overlay on top. FLUX supplies photographic depth; the SVG
  // supplies the bounding boxes and HUD that FLUX cannot draw cleanly.
  const base = await sharp(raw)
    .resize(W, H, { fit: 'cover', position: 'centre', kernel: 'lanczos3' })
    .sharpen({ sigma: 0.8 })
    .modulate({ brightness: 0.72, saturation: 0.9 })
    .toBuffer();

  // Rasterise the overlay to the base's exact size first — sharp would
  // otherwise place the SVG at its intrinsic 1600x900 in the top-left corner.
  const overlay = await sharp(Buffer.from(overlaySvg(id)))
    .resize(W, H, { fit: 'fill' })
    .png()
    .toBuffer();

  const out = await sharp(base)
    .composite([{ input: overlay, blend: 'over' }])
    .webp({ quality: 86, effort: 5 })
    .toBuffer();

  await writeFile(`${OUT}/${id}.webp`, out);
  return { got: `${meta.width}x${meta.height}`, kb: (out.length / 1024).toFixed(0), secs: ((Date.now() - t0) / 1000).toFixed(1) };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const list = only.length ? PROJECTS.filter((p) => only.includes(p.id)) : PROJECTS;
  if (!list.length) {
    console.error(`No matching project. Known ids: ${PROJECTS.map((p) => p.id).join(', ')}`);
    process.exit(1);
  }

  console.log(`Generating ${list.length} poster(s) at ${W}x${H} via Pollinations (FLUX)\n`);
  let ok = 0;
  for (const p of list) {
    process.stdout.write(`  ${p.id.padEnd(18)}`);
    try {
      const r = await generate(p);
      console.log(`OK  source ${r.got} -> ${W}x${H}  ${r.kb} KB  ${r.secs}s`);
      ok++;
    } catch (e) {
      console.log(`FAILED  ${e.message}`);
    }
  }
  console.log(`\n  ${ok}/${list.length} written to ${OUT}/`);
  if (ok) console.log(`  Switch a project over by editing its \`poster:\` line in src/data/projects.js to /posters/<id>.webp\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
