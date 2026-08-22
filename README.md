# Sheik Ahmed Yaseen — portfolio

Scroll-animated personal site. Vanilla JS + Vite, GSAP (ScrollTrigger / SplitText / Flip)
and Lenis for smooth scroll. No framework.

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # -> dist/
npm run preview    # serve the build
```

---

## Three things you need to add

These are placeholders the site links to but the repo can't supply.

### 1. Your résumé — `public/resume.pdf`

Two links point at `/resume.pdf` (hero button, footer). Drop the PDF in as
`public/resume.pdf` and they work. Until then both 404.

### 2. Contact form endpoint

The form currently falls back to opening the visitor's mail client. To make it
post properly, create a form at [Formspree](https://formspree.io), then:

```bash
cp .env.example .env
# paste your endpoint into VITE_CONTACT_ENDPOINT
```

### 3. The project numbers only you have

`src/data/projects.js` has a `metrics` array per project. Entries marked
`'TODO_'` are skipped by the renderer, so nothing broken shows — but these are
the figures recruiters actually read, and right now they're missing:

| Project | Needed |
|---|---|
| PPE Detection | Inference latency (ms) on your hardware, mAP@0.5 from your training run |
| ConstructSafe | FPS on your GPU |
| Attendance | Recognition accuracy % against your enrolled set |
| Indoor Tracking | Number of beacons deployed |
| ADRAF | Accuracy on FaceForensics++ and on Celeb-DF |

Replace `'TODO_'` with the value and it appears automatically.

> Your `sem_defect` repo has the strongest numbers you own — ROC-AUC 0.9993, a
> 2.7 MB INT8 TFLite model, 38,015 wafer maps. It isn't on the site. Worth
> adding as a seventh project.

---

## Content

All copy lives in `src/data/` — nothing is hardcoded in markup:

| File | Holds |
|---|---|
| `profile.js` | Name, role, contact links, rotating role words |
| `projects.js` | The six case studies, incl. `metrics`, `poster`, `repo` |
| `skills.js` | Grouped skills (drives both the marquee and the grid) |
| `experience.js` | Work + education timeline |

## Asset pipelines

```bash
npm run encode:frames   # hero sequence  (needs _source-frames/, see below)
npm run gen:posters     # six project poster SVGs
npm run gen:brand       # favicons, og-image.png, robots.txt
```

**Hero frames.** `_source-frames/frames_lossless_webp/` holds the 276 lossless 4K
frames and is gitignored (7.7 GB). `encode:frames` decimates non-uniformly —
every frame through the action, the static tail thinned 3× — and writes two
resolution tiers plus a low-res "ladder" into `public/hero/`. Only one tier is
downloaded per device (~11 MB desktop, ~4 MB mobile). Keep the source folder if
you ever want to re-encode; the site doesn't need it.

**Project posters.** Generated SVGs. To swap in real renders, see
[`docs/image-prompts.md`](docs/image-prompts.md) — it has a per-project
generation prompt and the exact spec so an image drops into the slot with a
one-line data edit.

## Architecture notes

- `src/core/smooth-scroll.js` — Lenis ⇄ ScrollTrigger wiring. One rAF loop,
  fixed ordering. Don't add `scroll-behavior: smooth`; it fights Lenis.
- `src/media/frame-sequence.js` — the hero canvas sequence. Uses `<img>` +
  `img.decode()` rather than ImageBitmap, deliberately; the reasoning (and the
  measurements that forced it) is in the file header.
- `body` uses `overflow-x: clip`, **not** `hidden` — `hidden` makes body a
  scroll container and silently breaks `position: sticky` everywhere.
- The hero pin carries `refreshPriority: 1` so every trigger below it measures
  against the pin-spacer.
- `vite.config.js` emits a real `/project/<id>/index.html` per project at build
  time, with its own title/description/canonical and a `<noscript>` copy of the
  case study.

## Deploy

Static. `npm run build` then serve `dist/`. Needs an SPA-style rewrite so
unknown paths fall back to `index.html` (the generated `/project/*` pages are
real files, so they're served directly).

Update the domain in `scripts/gen-brand.mjs` (robots.txt) and `vite.config.js`
(canonical + sitemap) before going live — both currently say
`sheikahmedyaseen.com`.
