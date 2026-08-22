# Project poster prompts — for Gemini

Generate these six in **Gemini (Nano Banana Pro / Gemini 3 Pro Image)**, save them
anywhere, and hand me the files. I'll handle resizing, palette-fitting, WebP
conversion and wiring them into the site.

## Why Gemini and not the free API

I tested the free route. Pollinations' free endpoint serves **only `sana`** — a
small model, capped at **1024×576** whatever resolution you request. Asking for
`flux` silently falls back to it. Upscaled 1.9× to fill the panel it looks soft,
and it can't draw crisp detection boxes at all. Gemini via the app or Antigravity
is free to you, far stronger, and outputs at proper resolution.

---

## Spec — applies to all six

| | |
|---|---|
| **Aspect ratio** | 16:9 (say "16:9 widescreen" in the prompt) |
| **Resolution** | as high as Gemini offers — 2K if available, 1920×1080 minimum |
| **Format** | whatever it gives you (PNG/JPEG both fine — I convert) |
| **Filenames** | `ppe`, `constructsafe`, `attendance`, `indoor-tracking`, `observex`, `adraf` |
| **Where to put them** | anywhere — a folder path is fine, or attach them in chat |

Two things the site imposes, already baked into the prompts below:

- **No text anywhere in the image.** The site overlays its own title, number and tags, and baked-in text collides with them.
- **Keep the subject in the middle 84%.** The panel crops slightly at narrow widths and a caption gradient covers the bottom.

**Palette to keep them a set:** near-black `#070709` ground, violet `#8b5cf6`,
teal `#06d6a0`, alert red `#f0506e`, amber `#f59e0b` for ConstructSafe only.

---

## The six prompts

Each is self-contained — paste as-is.

### 1. `ppe` — PPE Detection

> A wide industrial floor at dusk, seen as if through a computer-vision monitoring system. Three or four construction workers in hard hats and high-visibility vests, mid-task, rendered dark and slightly desaturated. Crisp thin **teal `#06d6a0`** rectangular detection boxes track each worker, each box drawn with small bracket corners rather than a solid outline. One worker's box is **alert red `#f0506e`** instead of teal. Faint horizontal scan lines drift across the frame. Volumetric haze, cold overhead industrial lighting, near-black `#070709` shadows. Cinematic, high contrast, 16:9 widescreen. No text, no numbers, no logos, no watermarks.

### 2. `constructsafe` — Site Safety Monitoring

> A construction site at night, the frame split down the middle by a subtle vertical seam of **amber `#f59e0b`** light. On the left, a worker wearing a hard hat enclosed in a clean **teal `#06d6a0`** bracket-cornered detection box. On the right, a bare-headed worker enclosed in an **alert red `#f0506e`** box. Sparse facial-landmark points overlay the bare-headed worker's face as a fine constellation of dots. Steel scaffolding silhouettes recede into darkness behind them. Near-black `#070709` ground, cinematic, tense, high contrast, 16:9 widescreen. No text, no numbers, no logos.

### 3. `attendance` — Face Recognition Attendance

> A human face turned three-quarters toward camera, dissolving into a dense **violet `#8b5cf6`** wireframe mesh of facial landmark points and connecting lines — as if being measured rather than photographed. The mesh is brightest across the brow, nose and jawline, fading at the edges. To one side, a vertical column of thin glowing violet bars suggests a numerical embedding vector. Deep black `#070709` background, soft violet rim light on the face, everything else falling into shadow. Cinematic, 16:9 widescreen. No text, no numbers, no logos.

### 4. `indoor-tracking` — Indoor Positioning

> A dark architectural floor plan viewed from directly overhead, drawn as thin luminous **teal `#06d6a0`** lines on near-black `#070709` — rooms, corridors, doorways, precise and map-like. Three small bright beacon nodes pulse at separate points, each emitting concentric expanding rings that overlap one another. Where the three ring sets intersect, a single **violet `#8b5cf6`** marker glows with a soft halo, and a faint dotted violet trail traces the winding path it travelled to reach that point. Technical, precise, cinematic depth, 16:9 widescreen. No text, no numbers, no logos.

### 5. `observex` — Behavioral Threat Detection

> A grid of six security camera feeds at night, arranged evenly in two rows of three, each showing a different part of a suburban property — porch, driveway, garden, side gate, rear, front path. Five feeds are calm and tinted cool **violet `#8b5cf6`**. One feed glows **alert red `#f0506e`**, showing a figure lingering near a doorway enclosed in a red bracket-cornered detection box. A thin horizontal scanning line sweeps across the whole grid. Grainy low-light surveillance aesthetic, heavy vignette, near-black `#070709` gutters between feeds, cinematic tension, 16:9 widescreen. No text, no numbers, no timestamps, no logos.

### 6. `adraf` — Deepfake Authentication

> A single human face split precisely down the vertical centre. The left half is photographic, softly lit, natural, tinted **teal `#06d6a0`**. The right half fractures into digital artefacts — blocky compression squares, chromatic fringing, subtle warping — tinted **violet `#8b5cf6`** and **alert red `#f0506e`**, with small translucent heat-map patches highlighting the manipulated regions. A thin bright vertical line marks the seam between the two halves. Deep black `#070709` background. Unsettling, forensic, cinematic, 16:9 widescreen. No text, no numbers, no logos.

---

## Then give them to me

I'll do the rest:

1. Resize/crop to exactly 1920×1080, convert to WebP ~86 quality (each lands ~60–120 KB)
2. Nudge brightness/saturation so all six sit together in the site palette
3. Optionally composite the precise SVG detection overlay on top if Gemini's boxes come out soft — `scripts/gen-posters-ai.mjs` already does this, and `overlaySvg(id)` in `gen-posters.mjs` supplies the linework
4. Flip each project's `poster:` line in `src/data/projects.js` from `.svg` to `.webp`

**If a couple come out weak, keep those as SVG.** The two formats are both 16:9
and share the palette, so a mixed set still looks deliberate — the data model
takes them per-project.

## If you'd rather skip generation entirely

Real screenshots of the systems running — bounding boxes over an actual webcam
feed, the attendance dashboard, the floor-plan visualisation — would be *more*
credible than any generated art, and cost nothing. Same spec: 16:9, keep the
interesting part out of the bottom 18%, crop tight.

---

# Video prompts (Veo 3.1)

Optional upgrade: the sticky project panel plays a short loop instead of a still.
Considerably more convincing than a static image for detection work — but only
worth doing if the loops stay small and seamless.

## Hard constraints

| | |
|---|---|
| **Length** | 3–5 seconds. Longer buys nothing at panel size and costs payload. |
| **Camera** | **Static, locked-off.** A moving camera cannot loop seamlessly. |
| **Motion** | Only the overlay/subject moves. No cuts, no transitions, no zoom. |
| **Audio** | None. It is muted in the browser anyway; an audio track is dead weight. |
| **Aspect** | 16:9 |
| **Budget** | ≤1.5 MB each after encoding (I handle the encode — VP9 WebM + MP4 fallback) |
| **Text** | None in frame. |

Say **"static locked-off camera, seamless loop, no camera movement, no cuts"** in
every prompt. It is the single highest-impact instruction.

Keep the matching still as the poster frame — it is the fallback if the video
fails, and the first frame on mobile.

## The six

### `ppe`
> Static locked-off security-camera view of a dark industrial workshop floor. Four construction workers in hi-vis vests and hard hats work at their stations, moving only slightly — welding sparks flicker, one worker shifts weight. Thin teal `#06d6a0` bracket-cornered detection boxes track each worker, subtly adjusting position to follow them. One box pulses from teal to alert red `#f0506e` and back. Faint horizontal scan line drifts slowly down the frame. Cold overhead light, volumetric haze, near-black shadows. Seamless loop, no camera movement, no cuts, no text.

### `constructsafe`
> Static locked-off camera on a dark construction site at night. Left: a worker in a hard hat works on scaffolding, enclosed in a steady teal `#06d6a0` bracket box. Right: a bare-headed worker walks slowly forward, enclosed in an alert red `#f0506e` bracket box that pulses. A vertical amber `#f59e0b` light seam between them glows and dims gently. Welding sparks in the far background. Seamless loop, no camera movement, no cuts, no text.

### `attendance`
> Static locked-off camera. A human face three-quarters to camera, almost still, blinking once. A violet `#8b5cf6` wireframe facial-landmark mesh builds across the face point by point, holds, then softly resets. Beside it a vertical column of thin violet bars flickers like a live readout. Deep black background, violet rim light. Seamless loop, no camera movement, no cuts, no text.

### `indoor-tracking`
> Static top-down view of a dark architectural floor plan drawn in thin luminous teal `#06d6a0` lines on near-black. Three beacon nodes emit concentric rings that expand outward continuously and fade. A violet `#8b5cf6` position marker glides slowly along a dotted violet trail through the corridors, and the trail redraws behind it. Technical, precise, map-like. Seamless loop, no camera movement, no cuts, no text.

### `observex`
> Static locked-off view of a six-panel security camera grid at night, two rows of three, each a different part of a suburban property. Five panels tinted cool violet `#8b5cf6`, showing near-still night scenes with faint grain shimmer. One panel glows alert red `#f0506e` as a figure moves slowly across a doorway inside a red bracket box. A thin horizontal scan line sweeps down across the whole grid and repeats. Heavy vignette, low-light surveillance look. Seamless loop, no camera movement, no cuts, no text.

### `adraf`
> Static locked-off camera on a human face split precisely down the vertical centre. The left half stays photographic, softly lit, tinted teal `#06d6a0`, almost motionless. The right half continuously fractures into shifting digital artefacts — blocky compression squares, chromatic fringing, warping — tinted violet `#8b5cf6` and red `#f0506e`, with translucent heat-map patches pulsing over the manipulated regions. A thin bright vertical seam shimmers between the halves. Seamless loop, no camera movement, no cuts, no text.

## Handing them over

Drop the files in `_incoming/` named by project id (any format Veo gives you).
I'll encode to VP9 WebM with an MP4 fallback, generate the poster frame, and
wire the panel so only the active project plays and mobile keeps stills.

---

# Re-do needed: `ppe` and `constructsafe`

Four of the six Veo clips are in use. These two are not:

| clip | problem |
|---|---|
| `ppe` | Veo rendered the hex codes as **literal on-screen text** — every detection box is labelled `#06d6a0` / `#f0506e` |
| `constructsafe` | same text problem, **and** the wrong composition — it generated a second factory-floor shot rather than the split safe/unsafe frame |

## The cause

My prompts said "no text" but also contained hex values like `#06d6a0` sitting
right next to a labelled box. Veo treated them as label content. **Never put hex
codes in a video prompt** — name the colours instead. (This did not happen on
the stills, where the same hexes were fine.)

## Corrected prompts — colour names only

### `ppe`
> Static locked-off security-camera view of a dark industrial workshop floor. Four construction workers in high-visibility yellow vests and hard hats work at their stations, moving only slightly — welding sparks flicker, one worker shifts weight. Thin bright turquoise rectangular detection boxes with bracket corners track each worker, adjusting subtly to follow them. One box glows crimson red instead of turquoise. A faint horizontal scan line drifts slowly down the frame. Cold overhead light, volumetric haze, near-black shadows. Seamless loop, static camera, no camera movement, no cuts. **Absolutely no text, no letters, no numbers, no labels, no captions anywhere in the frame.**

### `constructsafe`
> Static locked-off camera on a dark construction site at night. The frame is divided by a vertical column of warm amber light down the centre. On the LEFT, one worker wearing a hard hat and high-visibility vest works on scaffolding, enclosed in a bright turquoise rectangular detection box with bracket corners. On the RIGHT, a single bare-headed worker with no helmet walks slowly toward camera, enclosed in a crimson red detection box that pulses. Only two workers total, one per side. Steel scaffolding silhouettes recede into darkness behind. Seamless loop, static camera, no camera movement, no cuts. **Absolutely no text, no letters, no numbers, no labels anywhere in the frame.**

## When you have them

Drop the new files into `Project vids/` with the same names (`ppe.mp4`,
`constructsafe.mp4`) and run:

```bash
npm run encode:videos
```

Then tell me and I'll flip those two projects over to `.webp` posters + video,
the same as the other four. Until then they keep their SVG posters and simply
show no loop, which is why the section still looks consistent.
