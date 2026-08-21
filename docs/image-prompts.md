# Project poster images — generation prompt pack

The site currently ships **generated SVG posters** (`public/posters/*.svg`, produced by
`npm run gen:posters`). They work, but if you want richer artwork, generate real images
with any image model and drop them in — no code changes needed.

---

## 1. The spec (follow this or images will crop badly)

| | |
|---|---|
| **Aspect ratio** | 16:9, exactly |
| **Resolution** | 1920×1080 (minimum 1600×900) |
| **Format to save** | WebP, quality ~82 → `public/posters/<id>.webp` |
| **Background** | Near-black `#070709`, optionally graded toward `#0c0c14` |
| **Accent colours** | ONLY these — purple `#8b5cf6`, purple-light `#a78bfa`, teal `#06d6a0`, amber `#f59e0b`, alert red `#f0506e` |
| **Text in image** | **None.** The site overlays its own title, number and year. Any baked-in text will collide with it. |
| **Safe area** | Keep the subject inside the middle 84% — the bottom ~18% is covered by a caption gradient, and the panel crops slightly at narrow widths |
| **Mood** | Cinematic, dark, high-contrast, technical. Think a machine-vision system's own output, not stock photography. |

**Universal style suffix** — append to every prompt below:

> Dark near-black background #070709, cinematic lighting, restrained neon accents in violet #8b5cf6 and teal #06d6a0 only, subtle film grain, thin precise technical linework, high contrast, shallow depth of field, 16:9 widescreen composition, subject centred with generous negative space, no text, no watermarks, no logos, no user interface chrome around the edges.

---

## 2. Per-project prompts

### `ppe` — PPE Detection System
> A wide industrial floor at dusk seen through a computer-vision system's eye. Three or four construction workers in hard hats and high-visibility vests, mid-task, rendered slightly desaturated and dark. Crisp thin teal detection rectangles track each worker, with small bracket corners at each rectangle's edges. One worker's box is alert red instead of teal. Faint horizontal scan lines drift across the whole frame. Volumetric haze, cold industrial lighting from above.

*Accent: teal. Save as `public/posters/ppe.webp`.*

---

### `constructsafe` — ConstructSafe, Site Safety Monitoring
> A construction site frame split by a vertical seam of light. On the left half a worker wearing a hard hat is enclosed in a clean green-teal detection bracket; on the right half a bare-headed worker is enclosed in an alert-red bracket. Between them, a faint amber vertical divider glows. Fine facial-recognition landmark points overlay the unsafe worker's face as a sparse constellation. Steel scaffolding silhouettes recede into darkness behind. Cinematic, tense, high contrast.

*Accent: amber. Save as `public/posters/constructsafe.webp`.*

---

### `attendance` — Automated Attendance System
> A human face turned three-quarters, dissolving into a dense violet wireframe mesh of facial landmark points and connecting lines, as if being measured rather than photographed. The mesh is brightest across the brow, nose and jawline. To one side, a vertical column of thin glowing bars suggests a numerical embedding vector. Deep black background, soft violet rim light on the face, everything else falling into shadow.

*Accent: purple. Save as `public/posters/attendance.webp`.*

---

### `indoor-tracking` — Indoor Tracking System
> A dark architectural floor plan seen from directly overhead, drawn as thin luminous teal lines on near-black — rooms, corridors, doorways. Three small bright beacon nodes pulse at different points, each emitting concentric expanding rings that overlap. Where the three ring sets intersect, a single violet marker glows with a soft halo, and a faint dotted violet trail traces the path it travelled to get there. Technical, precise, map-like, cinematic depth.

*Accent: teal. Save as `public/posters/indoor-tracking.webp`.*

---

### `observex` — ObserveX, Behavioral Threat Detection
> A grid of six security camera feeds at night, arranged evenly, each a dark grainy view of a different part of a suburban property — porch, driveway, garden, gate. Five feeds are calm and tinted cool violet. One feed glows alert red, showing a figure near a doorway enclosed in a red detection bracket. A thin horizontal scanning line sweeps across the whole grid. Low-light surveillance aesthetic, heavy vignette, cinematic tension.

*Accent: purple. Save as `public/posters/observex.webp`.*

---

### `adraf` — ADRAF, Deepfake Authentication
> A single human face split precisely down the centre. The left half is photographic, softly lit, natural, tinted teal. The right half fractures into digital artefacts — blocky compression squares, chromatic fringing, subtle warping — tinted violet and alert red, with small heat-map patches highlighting the manipulated regions. A thin bright vertical line marks the seam. Beneath, a faint row of vertical bars suggests a frame-by-frame consistency signal. Unsettling, forensic, cinematic.

*Accent: purple. Save as `public/posters/adraf.webp`.*

---

## 3. Dropping them in

1. Save each file as `public/posters/<id>.webp` using the ids above.
2. In [`src/data/projects.js`](../src/data/projects.js), change that project's one `poster:` line:

```js
poster: '/posters/ppe.svg',   // before
poster: '/posters/ppe.webp',  // after
```

That's the whole change — the sticky panel, the project rows, the mobile inline
media and the detail-view hero all read the same field. You can mix and match:
swap two projects and leave four as SVG, and the page stays consistent because
both formats are 16:9 and use the same palette.

To convert something you generated as PNG/JPG:

```bash
npx sharp-cli --input downloaded.png --output public/posters/ppe.webp resize 1920 1080 --fit cover
```

Or add it to `scripts/encode-frames.mjs`-style tooling if you end up doing it often.

## 4. If you'd rather use real screenshots

Screenshots of the actual systems running (bounding boxes over a real webcam
feed, the attendance dashboard, the floor-plan visualisation) would be *more*
credible than any generated art, and they're free. Same spec applies: 16:9, save
as WebP, keep the interesting part out of the bottom 18%. Crop generously —
a screenshot of a whole desktop reads as clutter at panel size.
