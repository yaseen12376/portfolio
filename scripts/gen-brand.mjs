/**
 * Generate brand assets: favicons and the social share card.
 *
 * The share card matters more than it looks — a portfolio circulates as a
 * pasted link, and without og:image LinkedIn/WhatsApp/Slack render a blank
 * grey box. This composites the hero poster under a scrim so the card carries
 * the same image as the site itself.
 *
 * Run: npm run gen:brand
 */
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';

const OUT = 'public';
const TEAL = '#06d6a0';
const PURPLE = '#a78bfa';
const BG = '#070709';

/** Monogram mark, used for every favicon size and as an inline SVG favicon. */
const mark = (size = 512) => {
  const r = Math.round(size * 0.22);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${PURPLE}"/>
      <stop offset="100%" stop-color="${TEAL}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${(r / size) * 512}" fill="${BG}"/>
  <rect x="8" y="8" width="496" height="496" rx="${(r / size) * 512 - 6}" fill="none" stroke="url(#g)" stroke-width="10" opacity="0.5"/>
  <text x="50%" y="52%" text-anchor="middle" dominant-baseline="central"
        font-family="'Space Grotesk',system-ui,sans-serif" font-size="188" font-weight="700"
        letter-spacing="-6" fill="url(#g)">SAY</text>
  <circle cx="404" cy="352" r="18" fill="${TEAL}"/>
</svg>`;
};

/** 1200x630 share card: hero poster, scrim, name, role, accent rule. */
const cardOverlay = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#050507" stop-opacity="0.97"/>
      <stop offset="55%" stop-color="#050507" stop-opacity="0.82"/>
      <stop offset="100%" stop-color="#050507" stop-opacity="0.35"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${PURPLE}"/>
      <stop offset="100%" stop-color="${TEAL}"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#scrim)"/>
  <rect x="72" y="150" width="86" height="4" fill="url(#accent)"/>
  <text x="72" y="128" font-family="ui-monospace,'JetBrains Mono',monospace" font-size="20"
        letter-spacing="6" fill="${TEAL}">PORTFOLIO</text>
  <text x="72" y="248" font-family="'Space Grotesk',system-ui,sans-serif" font-size="76"
        font-weight="700" letter-spacing="-2" fill="#ededef">Sheik Ahmed</text>
  <text x="72" y="330" font-family="'Space Grotesk',system-ui,sans-serif" font-size="76"
        font-weight="700" letter-spacing="-2" fill="url(#accent)">Yaseen</text>
  <text x="72" y="396" font-family="Inter,system-ui,sans-serif" font-size="27" fill="#9a9aa8">AI Solutions Developer</text>
  <text x="72" y="436" font-family="Inter,system-ui,sans-serif" font-size="27" fill="#9a9aa8">Computer Vision &amp; Embedded AI</text>
  <text x="72" y="546" font-family="ui-monospace,'JetBrains Mono',monospace" font-size="21"
        letter-spacing="2" fill="#6f6f80">github.com/yaseen12376</text>
</svg>`;

async function main() {
  await mkdir(OUT, { recursive: true });

  await writeFile(`${OUT}/favicon.svg`, mark());
  const png = (n) => sharp(Buffer.from(mark())).resize(n, n).png().toFile(`${OUT}/favicon-${n}.png`);
  await Promise.all([png(32), png(180), png(512)]);
  console.log('  favicon.svg + 32/180/512 png');

  const card = await sharp('public/hero/poster.webp')
    .resize(1200, 630, { fit: 'cover', position: 'right' })
    .composite([{ input: Buffer.from(cardOverlay) }])
    .png({ quality: 90 })
    .toBuffer();
  await writeFile(`${OUT}/og-image.png`, card);
  console.log(`  og-image.png  ${(card.length / 1024).toFixed(0)} KB  1200x630`);

  await writeFile(
    `${OUT}/robots.txt`,
    'User-agent: *\nAllow: /\n\nSitemap: https://sheikahmedyaseen.com/sitemap.xml\n'
  );
  console.log('  robots.txt');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
