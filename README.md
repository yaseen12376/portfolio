# Sheik Ahmed Yaseen: portfolio

Scroll-animated personal site, hung as an exhibition. Vanilla JS + Vite, GSAP
(ScrollTrigger / SplitText) and Lenis for smooth scroll, and three.js for the
live dioramas, loaded lazily. There is no framework. Headlines are Big
Shoulders Display, everything else Geist and Geist Mono, all self-hosted via
`@fontsource-variable`; icons are Phosphor (light), imported as raw SVG.

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # -> dist/
npm run preview    # serve the build
npm run qa:3d      # every QA suite, against the running dev server
```

---

## Still needed from you

1. **Blanks only you can fill.** A value of `'TODO_'` is hidden everywhere until it is filled in:

   | Where | Needed |
   |---|---|
   | `src/data/projects.js`, Attendance | Recognition accuracy % on your enrolled set |
   | `src/data/projects.js`, Indoor Tracking | Number of beacons deployed |
   | `src/data/projects.js`, ADRAF | Accuracy on FaceForensics++ and on Celeb-DF |
   | `src/data/resume.js` | The two certificates (name, issuer, year) |

   Not in any repo, so not on the site either: the AthleteVision event and its result, any NASA Space Apps result, and the months of the older projects (`period` in `projects.js`; without it the résumé prints the year). The freelance row in `experience.js` runs July to November 2026, from the claims workbench's commits: correct it if that is wrong.
2. **Reprint the résumé after changing its data or layout:** `npm run gen:resume`, then commit `public/resume.pdf` and `public/resume.meta.json`. The build refuses a PDF that no longer matches (see Résumé below).
3. **Contact form endpoint.** Without one, the form opens the visitor's mail client with the message filled in. To make it post:
   ```bash
   cp .env.example .env   # then paste your Formspree URL into VITE_CONTACT_ENDPOINT
   ```

## Content

All copy lives in `src/data/`, apart from the hero, About bio and contact text in `index.html`.

| File | Holds |
|---|---|
| `projects.js` | The thirteen projects, in exhibition order. `tier` hangs each one: `stage` (a diorama on a stage of its own) or `large` / `small` (a piece on the collection shelf). Also `kind`, `period`, `metrics`, `role`, `team`, `techStack`, `scene3d` or `piece`, `poster` and `repo`; the notes at the top of the file explain each |
| `case-copy.js` | Each case study's long-form copy (overview, problem, approach, what I built, results, limitations), keyed by project id. A lazy chunk, fetched when the browser is idle |
| `experience.js` | Work, client and education rows |
| `skills.js` | Toolkit groups. Each tool's `match` list maps to project `techStack` names, which is how the "used in" counts are computed |
| `profile.js` | Name, contact links, location, education |
| `resume.js` | What only the résumé needs: its summary, one or two bullets per project, education details, certifications |
| `pieces.json` | Written by `npm run build:pieces`, never by hand: each built piece's version and whether it has a loop |

Rules the renderers rely on:
- **Everything is escaped** (`esc()` in `src/core/util.js`), so write plain text.
- **No em or en dashes** in visible copy. Use commas, colons or full stops. `npm run qa:claims` checks.
- **Facts come from the repositories** (code, git history, their own docs). A number is quoted only where a repo measured it.
- **`repo`** is only set for repositories that are public. `private: true` shows "Private repository" instead.
- **`num`** is derived from array order.

## Design system

Everything is in `style.css`, with tokens at the top.
- **Colour:** dark only, because the hero frames and the work are dark. There is one UI accent, violet `#a78bfa`. Turquoise, red and amber appear only inside project media, where they mean safe, unsafe and alert.
- **Shape:** inputs are 14px and everything interactive is a full pill. Content is not boxed: the work hangs frameless on the page colour, and text sits under hairline rules like wall text.
- **Motion:** content enters with a fade-up and unblur (`revealOnScroll` in `src/core/motion.js`). Everything collapses under `prefers-reduced-motion`.

## The work, as an exhibition

- **Stages, 01 to 03.** Retail Analytics, ConstructSafe and FinMind are live three.js dioramas (`src/three/`), each on a full-height stage beside its words. The stepper under the words follows the diorama's tour (`src/three/chapters.js`): a step fills as its chapter plays, clicking one takes the scene there, and Pause holds it. Phones get the Blender still and a tap to play; reduced motion and Save-Data get the still.
- **The collection, 04 to 13.** The other ten are pieces under glass: a small model of the project under a bell jar on a walnut base, rendered in Blender. Hovering a tile turns it (the loop is fetched on the first hover, never on touch, under reduced motion or with Save-Data, which show the poster). Its case study plays the larger loop, with a Pause button.
- **A live jar.** Mission Builder 3D's case study goes further: its jar runs in three.js, exported from the same Blender scene (`npm run build:pieces -- <id> --stages live`), and takes over from the loop at the loop's own pose. Drag turns it. A tap on the glass lifts it clean out of the frame, and the camera comes in on what was under it: a resting pointer names the part under it, a tap on a part opens its chapter with the camera in on it, and "Put the glass back" sets it down. The explorer's buttons and the arrow and Enter keys do the same. Phones get a "Turn it in 3D" button first. Its solar arrays wear scanned cells and a scanned dust (ambientCG, CC0) that each brush sweeps off by the game's own rule, the same in the live jar (`src/three/piece-dust.js`) as in the render. The other nine follow the same way.
- **Catalogue.** A plain list of all thirteen after the shelf, for reading at a glance.

## Asset pipelines

```bash
npm run encode:frames   # hero sequence  (needs _source-frames/, see below)
npm run build:3d        # the three dioramas, baked in Blender into public/3d/<id>/
npm run build:pieces    # the ten pieces under glass, rendered in Blender into public/pieces/<id>/
npm run gen:resume      # public/resume.pdf, printed from the site's data
npm run gen:brand       # favicons, og-image.png, robots.txt
```

- **Hero frames.** `_source-frames/frames_lossless_webp/` holds the 276 lossless 4K frames and is gitignored (7.7 GB). `encode:frames` writes two resolution tiers plus a low-res "ladder" into `public/hero/`. Only one tier is downloaded per device (about 11 MB on desktop, about 4 MB on mobile).
- **Pieces.** `scripts/blender/pieces/<id>.py` builds each model on a shared kit (`_kit.py`: the jar, brass rim, walnut base, paper tag and the museum light). `build-pieces.mjs` renders a poster still and a 144-frame turn (6 s at 24 fps) in Cycles, takes the lighter of each pixel and the page colour `#09090b` so the background is exactly the page (no alpha video, no blend modes), and encodes VP9 and H.264 loops at 720 and 1080 px plus WebP posters, failing any file over budget (tile loop 600 KB, header loop 1.4 MB, posters 90 and 160 KB). Work whose inputs have not changed is skipped, and an interrupted loop resumes where it stopped: `npm run build:pieces -- courier --stages still,loop,encode`. Needs Blender 5.2 on a CUDA GPU (about 25 minutes a piece on an RTX 3050 Ti); run one Blender job at a time. The models borrowed from other repos are listed in `scripts/blender/pieces/sources.json` and copied into `build/` first; where they are on your machine goes in the git-ignored `sources.local.json` beside it (or the env variables it names).
- **Résumé.** `/resume/` is the résumé as a page (`resume/index.html`, `src/resume/`): two A4 sheets laid out from the site's own data. `gen:resume` prints it in Chromium to `public/resume.pdf`, which is committed because Vercel's build has no browser, and records a hash of its inputs in `public/resume.meta.json`; the build fails when they no longer match. The phone number is on the PDF and nowhere else: `gen:resume` reads it from the git-ignored `resume.local.json` (copy `resume.local.example.json`) and hands it to the page only while printing, so no page, script or committed source carries it (`npm run qa:resume` checks, and `vercel.json` keeps the PDF out of search results). `--no-phone` prints without it. The input hash leaves the number out, because a hash of a phone number is easily reversed, so after changing it run `gen:resume` yourself. `/resume/?edit=1` adds checkboxes for leaving projects out of a tailored print.

## QA

`npm run qa:3d` (with `npm run dev` running) runs every suite in `scripts/qa/` and prints one line each: the crowd engine, the scenes' features and simulation, diorama parity and framing, the page end to end (stages and steppers, the shelf's hover-play, case studies, the live jar, leaks), who gets 3D and the entry bundle (90 KB gzip at most), frame cost and pacing, the pieces as shipped (budgets, backdrops, loop seams), the forbidden-strings check and the résumé PDF. `--skip perf,parity` leaves suites out. Each suite also runs on its own, for example `npm run qa:pieces`.

To see a live jar move, `node scripts/qa/record.mjs --project mission-builder-3d` films its case study on a computer and on a phone into `build/qa/rec/<id>/` (MP4s and stills). The films are stepped frame by frame (`scripts/qa/smooth.mjs`): 60 frames to each second of the page's own time, every device pixel, the pointer drawn in, however long a frame takes to capture. A screen recording of the same page drops frames and judders where the page does not. It needs ffmpeg with libx264.

## Architecture notes

- `src/core/smooth-scroll.js`: Lenis and ScrollTrigger share one rAF loop in a fixed order. Don't add `scroll-behavior: smooth`; it fights Lenis.
- `src/media/frame-sequence.js`: the hero canvas sequence. It uses `<img>` + `img.decode()` rather than ImageBitmap, deliberately; the reasoning is in the file header.
- `src/sections/hero.js`: a single ScrollTrigger owns the pin, the scrub and the frame index, with `refreshPriority: 1` so every trigger below measures against its spacer.
- `src/sections/projects.js`: nothing below the hero is pinned. A diorama loads as its stage comes near and runs only while it is on screen.
- `src/sections/project-detail.js`: the case study is an overlay. Its media grows out of the tile that opened it, a plain GSAP tween measured in the viewport.
- `src/three/gate.js` is the only diorama code in the entry bundle and imports nothing from three.js; it decides per visitor whether dioramas run live, on a tap, or not at all.
- `src/three/engine.js`: one WebGL renderer draws every live view. Each frame steps by the browser's own frame time, and where frames keep coming late (a quarter of them, twice running, or more than one in twelve over three seconds) it steps quality down by itself: pixel density first, then a cheaper look through a jar's glass. After half a minute without late frames it tries a step back up (the slowness may have been another tab or app on the same GPU); a step up that brings late frames is undone within two seconds, and then it stays put for the visit. The GPU timer, where there is one, only says how far over (a GPU with work to spare clocks down, and its time fills the frame).
- `body` uses `overflow-x: clip`, **not** `hidden`. `hidden` makes body a scroll container and silently breaks sticky positioning and every pin.
- `vite.config.js` emits a real `/project/<id>/index.html` per project at build time, with its own title, description, canonical and a `<noscript>` copy of the case study, plus `sitemap.xml` (which lists `/resume/` too). `vercel.json` redirects the retired `/project/ppe` to ConstructSafe.

## Deploy

Static. `npm run build`, then serve `dist/`. Update the domain in `scripts/gen-brand.mjs` (robots.txt), `vite.config.js` (`SITE`) and `src/resume/content.js` (`SITE`) before going live; all currently say `sheikahmedyaseen.com`.
