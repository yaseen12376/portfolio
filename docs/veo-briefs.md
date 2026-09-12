# Veo 3 briefs — input for an LLM

`image-prompts.md` holds finished prompts. **This file holds the raw briefs** to
hand to ChatGPT so it can write a fuller Veo 3 prompt for you.

Use it in one ChatGPT conversation: paste **Block A** once, then paste **one
clip brief per message**. Take each prompt it returns straight to Veo.

**All eight clips are done as of September 2026.** The briefs below are kept
for regenerating any of them — Courier in particular, which came back with a
slow zoom despite the static-camera instruction.

---

## Block A — paste this first

```
You are writing prompts for Google Veo 3. I will send you one clip brief per
message. For each, reply with ONE prompt, as a single paragraph of plain
English, ready to paste into Veo. No preamble, no options, no explanation.

These constraints are non-negotiable and apply to every prompt you write:

CAMERA
- Static, locked-off camera. No pan, tilt, zoom, dolly, orbit or handheld
  motion of any kind. This is the single most important instruction: a moving
  camera cannot loop.
- No cuts. One continuous shot.

LOOP
- The clip must loop seamlessly. The last frame has to land back on the first.
- Write the motion so it returns to its starting state by the end: things that
  move should complete a cycle, pulse, or drift back, not end somewhere new.
- End every prompt with this exact sentence:
  "Seamless loop, static camera, no camera movement, no cuts."

TEXT — the most common failure
- Absolutely no text, letters, numbers, digits, labels, captions, UI, readouts,
  signage, logos, brand names, barcodes or watermarks anywhere in the frame.
- Detection boxes and overlays must be EMPTY OUTLINES with no labels attached.
  Say so explicitly; it is what stops Veo captioning them.
- NEVER write a hex colour code in the prompt. Veo renders strings like
  "#06d6a0" as literal on-screen text. This ruined two earlier clips. Use
  colour NAMES only.

COLOUR (names only, never hex)
- Background: near-black.
- Violet: the brand accent.
- Turquoise: means safe, tracked, detected and fine.
- Red: means unsafe, a violation.
- Amber: means an alert or an attention zone.

FRAMING
- 16:9. Keep the subject inside the middle 84% of the frame — these play in
  cards that crop toward square, so anything near an edge is lost.
- Keep meaningful detail OUT of the bottom-right corner, roughly 89-93% across
  and 80-86% down. Veo stamps a watermark there and my encoder patches it out;
  detail underneath it turns into a visible smear.
- The frame at about 2 seconds in gets used as the still poster, so the scene
  should already be fully established and moving by then — no slow fade-in.

DELIVERY
- About 10 seconds, 16:9, 720p or better. No audio, no dialogue, no music, no
  narration — the audio track is stripped and the clip plays muted.
- Tone across all four: calm, precise, cinematic, technical. Not flashy,
  no lens flares, no fast strobing, no sci-fi holograms.
```

---

## Block B — one clip per message

### 1. `retail-analytics` — Retail Analytics Platform

```
CLIP BRIEF 1 of 4 — "retail-analytics"

What it really is: footfall and shopper-behaviour analytics for a clothing
franchise, running on the CCTV cameras its stores already have. YOLO11
detection and tracking, zone and dwell-time analysis, a POS matcher and a live
dashboard. Six camera streams batched through one laptop GPU; 2.4x faster after
a TensorRT export.

The idea to convey: a shop knows what sold, but not how people moved through
it. This clip shows the movement being seen.

Scene: a static high-angle security-camera view looking down into a modern
clothing store in the evening. Warm dim lighting, rails of hanging shirts,
folded stacks on low tables, a checkout counter toward the right edge.

Motion (must return to its starting state):
- Four shoppers walk slowly between the rails.
- A thin turquoise rectangular box with bracket corners follows each shopper
  smoothly. Empty outlines, no labels.
- A faint dotted turquoise trail draws behind each person and fades.
- A soft translucent heat-map glow in violet and warm amber builds on the floor
  where someone pauses, then fades back down.
- A thin glowing line across the entrance at the bottom brightens briefly as a
  shopper steps over it.

Avoid: any readable signage or brand names on the clothing, price tags,
on-screen counters or dashboard panels.
```

### 2. `constructsafe` — ConstructSafe: AI Site Safety Platform

```
CLIP BRIEF 2 of 4 — "constructsafe"

What it really is: construction-site monitoring that flags missing PPE, falls,
fire and smoke in real time and names the worker involved. Four detectors in
one pipeline (YOLOv8, MoveNet, InsightFace), 1.31x faster on ONNX Runtime.

The idea to convey: a supervisor cannot watch every camera at once, and a
helmet detector alone cannot say who is at risk. Three states are readable in
one glance — safe, violation, emergency.

Scene: a static elevated CCTV view of a construction site at night under warm
work lights. Steel scaffolding silhouettes receding into darkness.

Motion (must return to its starting state) — exactly three workers, no more:
- LEFT: a worker in a hard hat and high-visibility vest works on scaffolding,
  inside a steady turquoise detection box with bracket corners. Safe.
- CENTRE: a bare-headed worker with no helmet walks slowly toward camera inside
  a crimson red box that pulses gently. A violation.
- RIGHT: a worker lies still on the ground beside a fallen ladder inside a warm
  amber box that pulses. An emergency.
- Faint grey smoke drifts from a barrel far in the background.
- All boxes are empty outlines with no labels or readouts attached.

Avoid: more than three people, any hazard signage, any text on the vests or
helmets, any alarm graphics.
```

### 3. `courier` — Courier Management System

```
CLIP BRIEF 3 of 4 — "courier"

What it really is: booking, billing and tracking software for a courier
franchise, built in ASP.NET Core 8. Printed receipts, barcodes, WhatsApp and
SMS updates, and a background sync with the courier network four times a day.

The idea to convey: parcels moving between towns on a network, tracked. This is
the only one of the four that is logistics software rather than computer
vision, so it should feel like a map and a network, not a camera feed.

Scene: a static top-down view of a dark stylised map of a region of southern
India, drawn in thin luminous turquoise lines on near-black — highways, rivers
and town outlines, with no place names anywhere. Five softly glowing hub nodes.

Motion (must return to its starting state):
- Small glowing violet parcel markers glide smoothly along the roads between
  the hubs, each leaving a dotted trail that fades behind it.
- When a marker reaches a hub, the hub emits a single soft amber ring that
  expands and fades out.
- The hubs pulse slowly and softly throughout.
- Markers should complete their journeys and new ones begin, so the density on
  screen is roughly constant from first frame to last.

Avoid: place names, road numbers, barcodes, shipping labels, any parcel with
writing on it, any dashboard or table.
```

### 4. `airdraw` — AirDraw: Gesture Drawing

```
CLIP BRIEF 4 of 4 — "airdraw"

What it really is: draw, erase and pinch-zoom in the air with one hand, tracked
by MediaPipe in real time and rendered to a browser canvas. 21 hand landmarks
every frame, smoothed, with a C++ GPU bridge over TCP to cut latency.

The idea to convey: a bare hand becomes an input device. The tracking is
precise and the ink follows the fingertip exactly.

Scene: a static locked-off camera on a person in a dark room, seen from the
chest up, lit by a soft violet rim light. Near-black background, shallow depth
of field.

Motion (must return to its starting state):
- They raise one hand and slowly trace a single smooth looping curve in the air
  with the index finger, ending where they began.
- A fine turquoise skeleton of about twenty-one small glowing points joined by
  thin lines tracks the hand exactly, staying locked to the fingers as they
  move.
- A luminous violet ink stroke appears in the air behind the fingertip and
  fades away from its tail as the hand comes back round, so the air is empty
  again by the end.

Avoid: any drawing that forms a letter, number or recognisable word; any
on-screen toolbar, cursor, button or colour picker; any visible monitor,
webcam or phone showing an interface.
```

---

## When the clips come back

1. Save them as `Project vids/retail-analytics.mp4`, `constructsafe.mp4`,
   `courier.mp4`, `airdraw.mp4`. Overwrite the old broken `constructsafe.mp4`.
2. `npm run encode:videos` — writes `public/project-video/<id>.{webm,mp4,jpg}`,
   drops the audio, crossfades the loop seam and patches the watermark.
3. In `src/data/projects.js`, add `video: '/project-video/<id>'` to each of the
   four. They have no `video` field until then, which is why their cards show a
   still.
4. Optionally set each `poster:` to the generated `.jpg`, replacing
   `constructsafe.svg`, `courier.svg` and `airdraw.svg`.

**If a clip comes back with text in it anyway,** add "The detection boxes are
empty outlines with no labels" and regenerate. That sentence usually fixes it.
