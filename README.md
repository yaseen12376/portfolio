# Sheik Ahmed Yaseen: portfolio

Scroll-animated personal site. Vanilla JS + Vite, GSAP (ScrollTrigger /
SplitText / Flip) and Lenis for smooth scroll. There is no framework. Type is
Geist and Geist Mono, self-hosted via `@fontsource-variable`, and icons are
Phosphor (light), imported as raw SVG.

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # -> dist/
npm run preview    # serve the build
```

---

## Still needed from you

1. **Résumé: `public/resume.pdf`.** Every résumé link (nav, hero, menu, footer) is hidden until this file exists. Drop it in and restart the dev server or rebuild. `vite.config.js` checks for it at startup.
2. **Contact form endpoint.** Without one, the form opens the visitor's mail client with the message filled in. To make it post:
   ```bash
   cp .env.example .env   # then paste your Formspree URL into VITE_CONTACT_ENDPOINT
   ```
3. **Project footage** for retail-analytics, constructsafe, courier and airdraw. [`docs/image-prompts.md`](docs/image-prompts.md) has the Gemini and Veo prompts and the three wiring steps.
4. **Numbers only you have.** Metrics set to `'TODO_'` in `src/data/projects.js` are hidden until filled in:

   | Project | Needed |
   |---|---|
   | Attendance | Recognition accuracy % on your enrolled set |
   | Indoor Tracking | Number of beacons deployed |
   | ADRAF | Accuracy on FaceForensics++ and on Celeb-DF |

## Content

All copy lives in `src/data/`, apart from the hero, About bio and contact text in `index.html`.

| File | Holds |
|---|---|
| `projects.js` | The eight case studies. `tier` places each one (flagship / featured stack / more builds). Also holds `metrics`, `role`, `team`, `limitations`, `poster`, `video` and `repo` |
| `experience.js` | Work, client and education rows |
| `skills.js` | Toolkit groups. Each tool's `match` list maps to project `techStack` names, which is how the "used in" counts are computed |
| `profile.js` | Name, contact links, location, education |

Rules the renderers rely on:
- **Everything is escaped** (`esc()` in `src/core/util.js`), so write plain text.
- **No em or en dashes** in visible copy. Use commas, colons or full stops.
- **`repo`** is only set for repositories that are public. `private: true` shows "Private repository" instead.
- **`num`** is derived from array order.

## Design system

Everything is in `style.css`, with tokens at the top.
- **Colour:** dark only, because the hero frames are dark. There is one UI accent, violet `#a78bfa`. Turquoise, red and amber appear only inside project media, where they mean safe, unsafe and alert.
- **Shape:** shells are 28px, cores 22px and inputs 14px. Interactive elements are full pills.
- **Motion:** content enters with a fade-up and unblur (`revealOnScroll` in `src/core/motion.js`). Project media get "lock-on" bracket corners when active. Everything collapses under `prefers-reduced-motion`.

## Asset pipelines

```bash
npm run encode:frames   # hero sequence  (needs _source-frames/, see below)
npm run encode:videos   # project loops from "Project vids/*.mp4"
npm run gen:posters     # legacy SVG posters
npm run gen:brand       # favicons, og-image.png, robots.txt
```

- **Hero frames.** `_source-frames/frames_lossless_webp/` holds the 276 lossless 4K frames and is gitignored (7.7 GB). `encode:frames` writes two resolution tiers plus a low-res "ladder" into `public/hero/`. Only one tier is downloaded per device (about 11 MB on desktop, about 4 MB on mobile).
- **Project loops.** `encode:videos` drops audio, crossfades the loop seam, removes the Veo watermark and writes VP9 WebM, an H.264 MP4 fallback and a poster JPG. New ids need an entry in its `ID_MAP`.

## Architecture notes

- `src/core/smooth-scroll.js`: Lenis and ScrollTrigger share one rAF loop in a fixed order. Don't add `scroll-behavior: smooth`; it fights Lenis.
- `src/media/frame-sequence.js`: the hero canvas sequence. It uses `<img>` + `img.decode()` rather than ImageBitmap, deliberately; the reasoning is in the file header.
- `src/sections/hero.js`: a single ScrollTrigger owns the pin, the scrub and the frame index, with `refreshPriority: 1` so every trigger below measures against its spacer.
- `src/sections/projects.js`: the featured stack pins each card with `pinSpacing: false` (desktop only). A card's media plays only while it is the active card.
- `body` uses `overflow-x: clip`, **not** `hidden`. `hidden` makes body a scroll container and silently breaks sticky positioning and every pin.
- `vite.config.js` emits a real `/project/<id>/index.html` per project at build time, with its own title, description, canonical and a `<noscript>` copy of the case study, plus `sitemap.xml`. `vercel.json` redirects the retired `/project/ppe` to ConstructSafe.

## Deploy

Static. `npm run build`, then serve `dist/`. Update the domain in `scripts/gen-brand.mjs` (robots.txt) and `vite.config.js` (`SITE`) before going live; both currently say `sheikahmedyaseen.com`.
