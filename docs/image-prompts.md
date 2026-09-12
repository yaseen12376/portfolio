# Project media prompts (Gemini stills, Veo loops)

**All eight have footage.** Every project carries a poster lifted from its own
loop, so the still matches the first frame the video plays. The interim SVG
posters are retired.

retail-analytics, constructsafe, courier and airdraw were shot in September
2026. Three notes from encoding them:
- ConstructSafe came back with a garbled turquoise caption above the left
  worker's box, on screen from t=0.5s to t=4.5s. It is patched out in
  `scripts/encode-videos.mjs` (see EXTRA_PATCH) rather than regenerated.
- Courier slowly zooms in about 7% across its ten seconds despite "no zoom" in
  the prompt. The loop crossfade absorbs it into a gentle drift; regenerate it
  if you ever want the framing truly locked.
- AirDraw arrived with a third-party tool's branding ("InstaVA60") burned into
  the bottom-right corner, outside Veo's own watermark box. Also patched in
  EXTRA_PATCH. If you re-export anything through that tool, check the corner.

**Check every new clip for burned-in text before wiring it in.** Two of the
four had some, in different places, and neither was Veo's watermark.

## Spec

| | Stills (Gemini, Nano Banana Pro) | Loops (Veo 3.1) |
|---|---|---|
| Aspect | 16:9 widescreen | 16:9 |
| Size | as large as offered, 1920×1080 minimum | 720p is fine, the encoder crops nothing |
| Length | | whatever Veo gives; the encoder crossfades the seam |
| Camera | | **static, locked-off**. A moving camera cannot loop. |
| Text | **none**. The site sets its own titles. | **none** |
| Framing | subject in the middle 84% of the frame | same |
| Audio | | none (it is stripped anyway) |

**Palette:**
- Near-black `#09090b` background.
- Violet `#8b5cf6`.
- Turquoise `#06d6a0` means safe or tracked.
- Red `#f0506e` means unsafe.
- Amber `#f59e0b` means an alert or an attention zone.

**The one rule learned the hard way.** Never put hex codes in a Veo prompt. Veo
drew `#06d6a0` onto the detection boxes as literal text; that is why the old
ppe and constructsafe clips were dropped. Stills are fine with hex codes, and
video prompts use colour names only.

Every Veo prompt below contains "Seamless loop, static camera, no camera
movement, no cuts". That is the most important instruction in each one.

---

## Stills: Gemini

### `retail-analytics`
> A modern clothing store interior at evening seen from a high ceiling-mounted security camera, looking down at about 45 degrees. Rails of neatly hung shirts, folded stacks on low tables, a checkout counter at the right edge, warm dim lighting, near-black #09090b shadows. Five shoppers mid-stride between the rails, slightly desaturated. Each shopper is enclosed in a thin crisp turquoise #06d6a0 rectangular detection box with small bracket corners, and a faint dotted turquoise trail traces the path each has walked. A soft translucent heat-map glow in violet #8b5cf6 and amber #f59e0b pools on the floor where people lingered longest. One thin glowing line crosses the entrance at the bottom of the frame. Cinematic, calm, high contrast, 16:9 widescreen, subject within the middle 84% of the frame. No text, no numbers, no logos, no brand names on clothing or signs, no watermarks.

### `constructsafe`
> A construction site at night from a static elevated CCTV angle under warm work lights. Three workers: on the left, a worker in a hard hat and high-visibility vest on scaffolding, enclosed in a turquoise #06d6a0 bracket-cornered detection box; in the centre, a bare-headed worker enclosed in an alert red #f0506e box with a sparse constellation of facial-landmark dots over the face; on the right, a worker lying on the ground beside a fallen ladder, enclosed in an amber #f59e0b box. A thin wisp of grey smoke rises from a barrel far in the background. Steel scaffolding silhouettes recede into near-black #09090b darkness. Cinematic, tense, 16:9 widescreen, subject within the middle 84%. No text, no numbers, no logos, no watermarks.

### `courier`
> Top-down view of a dark stylised map of a region of southern India drawn in thin luminous turquoise #06d6a0 lines on near-black #09090b: highways, rivers and town outlines, with no labels. Five softly glowing hub nodes connected by routes. Small glowing violet #8b5cf6 parcel markers travel along the routes, each leaving a fading dotted trail. In the lower-right foreground, slightly out of focus, a real cardboard parcel with a completely blank white shipping label. Precise, calm, cinematic depth, 16:9 widescreen, subject within the middle 84%. No text, no letters, no numbers, no barcodes, no logos, no watermarks.

### `airdraw`
> A person in a dark room seen from the chest up, lit by a soft violet #8b5cf6 rim light, one hand raised with the index finger extended mid-gesture. A fine turquoise #06d6a0 hand skeleton of twenty-one small glowing points joined by thin lines tracks the hand precisely. A luminous violet ink stroke hangs in the air behind the fingertip, tracing a smooth looping curve. Near-black #09090b background, shallow depth of field, cinematic, 16:9 widescreen, subject within the middle 84%. No text, no numbers, no interface elements, no logos, no watermarks.

---

## Loops: Veo 3.1 (colour names only)

> To have an LLM write a longer prompt instead of using these verbatim, hand it
> the briefs in [`veo-briefs.md`](./veo-briefs.md) — same constraints, stated as
> a spec rather than a finished prompt.

### `retail-analytics`
> Static locked-off high-angle security camera view looking down into a modern clothing store at evening, warm dim lighting, rails of hanging shirts and a checkout counter at the right edge. Four shoppers walk slowly between the rails. Each shopper is enclosed in a thin bright turquoise rectangular detection box with bracket corners that follows them smoothly, and a faint dotted turquoise trail draws behind each one. A soft translucent glow in violet and warm amber builds on the floor where people pause, then gently fades. A thin glowing line across the entrance at the bottom edge brightens for a moment when a shopper steps over it. Near-black shadows, calm, cinematic. Seamless loop, static camera, no camera movement, no cuts. Absolutely no text, no letters, no numbers, no labels, no logos, no brand names anywhere in the frame.

### `constructsafe`
> Static locked-off elevated CCTV view of a construction site at night under warm work lights. On the left, a worker in a hard hat and high-visibility vest works on scaffolding, enclosed in a steady bright turquoise detection box with bracket corners. In the centre, a bare-headed worker with no helmet walks slowly toward camera, enclosed in a crimson red detection box that pulses gently. On the right, a worker lies still on the ground beside a fallen ladder, enclosed in a warm amber detection box that pulses. Faint grey smoke drifts from a barrel far in the background. Only three workers in total. Steel scaffolding silhouettes recede into darkness. Seamless loop, static camera, no camera movement, no cuts. Absolutely no text, no letters, no numbers, no labels anywhere in the frame.

### `courier`
> Static top-down view of a dark stylised map of a region of southern India drawn in thin luminous turquoise lines on near-black: highways, rivers and town outlines with no labels. Five hub points pulse softly. Small glowing violet parcel markers glide smoothly along the roads between the hubs, each leaving a dotted trail that fades behind it. When a marker reaches a hub, the hub emits a single soft amber ring that expands and fades. Technical, calm, precise. Seamless loop, static camera, no camera movement, no zoom, no cuts. Absolutely no text, no letters, no numbers, no labels, no place names anywhere in the frame.

### `airdraw`
> Static locked-off camera on a person in a dark room, seen from the chest up, lit by a soft violet rim light. They raise one hand and slowly trace a smooth looping curve in the air with their index finger. A fine turquoise skeleton of small glowing points joined by thin lines tracks the hand exactly. A luminous violet ink stroke appears in the air behind the fingertip and fades from its tail as the hand returns to where it started. Near-black background, shallow depth of field, cinematic. Seamless loop, static camera, no camera movement, no cuts. Absolutely no text, no letters, no numbers, no interface, no labels anywhere in the frame.

**If a clip comes back with text in it anyway,** add "The detection boxes are empty outlines with no labels" and regenerate. That sentence usually fixes it.

---

## Wiring them in

1. **Loops**
   - Save them as `Project vids/retail-analytics.mp4`, `constructsafe.mp4`, `courier.mp4` and `airdraw.mp4`. Overwrite the old broken `constructsafe.mp4`.
   - Run `npm run encode:videos`. This writes `public/project-video/<id>.webm`, `.mp4` and `.jpg`.
   - In `src/data/projects.js`, add `video: '/project-video/<id>'` to each of those four projects.
2. **Stills**
   - Convert each one to `public/posters/<id>.webp` at 1920×1080. The sharp one-liner in the git history for `retail-analytics.webp` does exactly this.
   - Set each project's `poster:` to that path. For ConstructSafe this replaces `/posters/constructsafe.svg`.
   - If a loop exists, you can use its `.jpg` poster frame instead.
3. **Retail Analytics' proof card:** `src/sections/about.js` uses the same poster for the "2.4×" cell. Point it at the new still too.

---

## Already generated (for regeneration only)

These four are live. Keep the prompts in case a clip ever needs redoing.
- **attendance**: a face three-quarters to camera, a violet landmark mesh building across it point by point, a flickering column of violet bars beside it, and a black background.
- **indoor-tracking**: a top-down turquoise floor plan, three beacons emitting expanding rings, and a violet marker gliding along a dotted trail.
- **observex**: a 3×3 night security grid tinted violet, one panel glowing red with a figure in a red box, and a scan line sweeping the grid.
- **adraf**: a face split vertically, photographic turquoise on the left and fracturing violet and red artefacts with heat-map patches on the right, joined by a bright seam.
