# Handoff: portfolio dioramas, revision 6

## 1. Where things stand

**Repo:** `yaseen12376/portfolio`, branch **`3D_miniatures`**. Everything is pushed and nothing is uncommitted.

| Commit | What |
|---|---|
| `f9ffd0e` | "2nd miniature half done": your ConstructSafe start (bake, kit, first controller) |
| `4007e67` | ConstructSafe diorama: nine chapters live, the shared scene kit, QA for every scene |
| `7b36168` | Bug fixes: stuck errands, stale slips, stray fire timers, and QA tooling fixes |
| (next) | `docs/dioramas-handoff.md`, this file |

**Order of the nine scenes:** 1 ConstructSafe (**done, awaiting your review**), then 2 FinMind (**next, not started**), 3 KPS Clean-O, 4 Courier, 5 Attendance, 6 Indoor Tracking, 7 ObserveX, 8 ADRAF, 9 AirDraw, and then the R4 cleanup.

**Standing rules (yours, from the r6 plan):**
- Stop for your review after each scene. The next scene starts only after you reply, and your notes are applied first.
- Commit and push only when you ask.
- Credentials: note paths only, never copy them.
- Every chapter shows a real feature with real numbers from the code.
- Keep a don't-claim list per scene.
- No em or en dashes in site copy.
- Attendance and ADRAF need your OK before downloading MediaPipe's `canonical_face_model.obj` (Apache-2.0). Real people's face photos from the repos are never used.
- For any project whose repo isn't on the machine, ask before designing it.

## 2. The per-scene pipeline (repeat for each scene)

1. **Survey the repo(s):**
   - real features and constants, with file references;
   - a don't-claim list;
   - credentials: paths only.
2. **Design:**
   - an island of about 3× Retail's area, split into districts;
   - chapters, each with an interaction and a real feature;
   - a 3-chapter card tour;
   - portals, the cast, and an opening scene with one group per district.
3. **Blender:**
   - kit additions, instanced and within budget;
   - `scripts/blender/scenes/<id>.py`;
   - checks: `check_reach` and `check_spacing` pass, no stray `_proto`;
   - stages: light, env, export, still, nav;
   - budgets: GLB ≤ 1.5 MB, ≤ 200k triangles, ≤ 120 draw calls, ≤ 3.5 MB desktop download.
4. **Controller (`src/three/scenes/<id>.js`), registered in `src/three/scenes/index.js`:**
   - routines using districts (spread) and the staff job board;
   - director flows and beats;
   - the living set;
   - chapters with `readouts`, `actions`, `act` and `qa()`;
   - `demo.shots` and `demo.record`.
5. **Site:**
   - `scene3d` (tour and chapters) and `poster` in `src/data/projects.js`;
   - `src/data/case-copy.js` corrected wherever the code disagrees.
6. **QA:**
   - `npm run qa:3d`: crowd, features, sim, parity, framing, site, gate, and perf (8 ms card, 14 ms case, on your discrete GPU);
   - plus a spread map, an operated shots board, and recordings.
7. **⏸ Stop** and send the review material.

## 3. What was built (commits 4007e67 and 7b36168)

**Shared kit (section 0 of the plan):**
- `src/three/scenes/kit/util.js`:
  - `rng`, `go`, `act`, `near`, `asideFrom`, `clockFeed`, `hhmm`, `floorPointOn`, `cross`, `spotsOf`, `placeNamer`.
- `kit/cctv.js`:
  - site cameras, frustums, occlusion, `countInView`;
  - `Evidence`, which gained `drawFrame(g, w, h, i, { caption, bar })`.
- `kit/alerts.js`:
  - `alertQueue({ list, max, cooldown, now })`, returning `{ raise(key, make), suppressed }`;
  - `make()` only runs when the alert isn't held back;
  - the default clock is the page's.
- `kit/staff.js`: `jobBoard` and `besideOf`.
- `kit/living.js`:
  - `carry`, `pigeons`, `spin`;
  - `particles({ scene, rand, n, color, size, blending, opacity })`, using one shared soft-dot texture.
- `sim/party.js`:
  - `partyKit({ people, crowd, grid, rand, outdoors, avoid })`, with `together`, `singleFile`, `inFootsteps`, `follower` and `FILE`;
  - it keeps its own `act`, because `sim/` never imports from `scenes/`.
- `sim/director.js` gained `crowdScore`, next to the existing `hire`, `onJob`, `busy`, `castFirst` and `breakUpPiles`.
- Retail and `_calibration` were moved onto the kit. **Retail's features and sim JSON are byte-identical to before** (features 43/43, sim 17/18 from the still start; the one failure was there before, see §6).

**Scene controller contract** (see `constructsafe.js` for a full example):
- `chapters[]`, each with `id`, `readouts()`, `actions()`, `act(id)`, `qa(run)`, `pip`, `enter`, `exit` and `shot`;
- `roles: { customer, staff[], resident }` (`resident: true` means the "districts a visit" metric counts over the whole run);
- `demo: { shots, record }`;
- `beatMeter`, `districts`, `director`, `pip()`, `draw2d`;
- `agents`, `grid`, `crowd`, `site`/`store`, `camState`.

**Patterns to reuse:**
- Scene-time timers: `later(secs, fn)` plus `runTimers()`, cleared on dispose. Never use `setTimeout`.
- Effects that draw random numbers get their own `rng(seed + 1)`, so the sim stays deterministic.
- Solo districts (`solo: true`, cap 1) with `reserve()`, for narrow places.
- An unstick watchdog that steps a walker aside and then resumes the walk, keeping its queued tasks.
- Hires that release as soon as the errand ends: `director.hire(a, job, 0)`.

**ConstructSafe** (`src/three/scenes/constructsafe.js`, `scene3d` in `projects.js`):
- **Chapters:** cameras, ppe, faces, falls, fire, alerts, playback, productivity, office.
- **Tour:** ppe, falls, fire.
- **Copy corrected** in `projects.js`, `case-copy.js` (now with limitations) and `experience.js`. There are no dashes, and nothing from the don't-claim list appears.
- **Don't claim:**
  - machine stopping, sirens, SMS or email;
  - restricted zones or geofences;
  - identity for unknowns;
  - video clips as evidence (stills only);
  - per-person cooldowns;
  - multi-person fall detection;
  - cones, machinery or vehicles being evaluated;
  - PTZ, PDF/Excel export, a login.
  - Never show the PPE+Fall/All bug; those modes run PPE only.
- **Runtime stand-ins for an old bake:**
  - `b.grid.unstamp('barrier_arm')`;
  - the new starter's wait point is computed (`enrolAt`), and the starter enters from the road;
  - invisible pick spheres stand in for camera nodes;
  - `OWN_SPOTS.pallet_count`.
- **Fire visuals (last change):** soft round particles, and the fire chapter's shot turned to yaw -0.45 so the gate hut no longer hides the bin.

**QA tooling (`scripts/qa/`):**
- `lib.mjs`:
  - `launch()`: D3D11 flags on Windows; SwiftShader only when `SOFTWARE_GL` (the default on Linux; `QA_SOFTWARE_GL=1` or `0` overrides it); otherwise the platform GPU (a Mac);
  - `QA_CHROMIUM` points at a browser binary;
  - `bench(..., { context })`.
- `site.mjs`, `framing.mjs`, `gate.mjs` and `record.mjs` loop over every diorama card. The phone paths add `?swgl` only under software GL.
- `features.mjs --json out.json` and `sim.mjs --json out.json --still` give deterministic A/B runs. `--still` is required for byte-identical sim JSON.
- **New scripts:**
  - `board.mjs`, a contact sheet (`--dir`, `--name`);
  - `spread-map.mjs`, a top-down map (`qa.simulate(..., { trace })` only reads positions);
  - `film.mjs`, a frame-exact film from the bench (`--stills` for fast stills only);
  - `npm run qa:board`, `npm run qa:spread`.
- `perf.mjs` warns when the renderer is SwiftShader.
- `src/three/engine.js`: `?swgl` relaxes `failIfMajorPerformanceCaveat` (QA only).
- `scripts/build-3d.mjs`: `BLENDER_TIMEOUT_MIN` (default 20; an invalid value falls back to 20).

**The per-seed chapter check** used throughout (it lived in the cloud scratchpad; recreate it as `scripts/qa/features-seeds.mjs` if useful):

```js
import { launch, bench, watchConsole } from './lib.mjs';
const { browser, context } = await launch();
const page = await context.newPage();
const errors = watchConsole(page);
for (const seed of (process.argv[2] ?? '1,2,3').split(',').map(Number)) {
  await bench(page, 'http://localhost:3000', process.argv[3] ?? 'constructsafe', { w: 640, h: 360, still: true, seed });
  const res = await page.evaluate(() => window.qa.chapterQA());
  const fails = Object.entries(res).flatMap(([ch, cs]) => cs.filter((c) => !c.ok).map((c) => `${ch}: ${c.name} · ${c.detail}`));
  const total = Object.values(res).flat().length;
  console.log(`seed ${seed}: ${total - fails.length}/${total}${fails.length ? '\n  ' + fails.join('\n  ') : ''}`);
}
console.log(errors.length ? 'console:\n  ' + errors.join('\n  ') : 'no console errors');
await browser.close();
```

## 4. Last QA results (cloud, SwiftShader)

| Suite | Result |
|---|---|
| crowd | 33/33 |
| features | 82/82 (Retail 43, ConstructSafe 39) |
| sim | 34/34 |
| parity | 2/2 (ConstructSafe tone ΔE 1.74, Retail 2.00) |
| framing | 45/45 |
| site | 43/43, no leaks |
| gate | 18/18 (entry bundle 86.2 of 90 KB) |

- ConstructSafe's chapter checks pass 39/39 on seeds 1 to 10.
- ConstructSafe's sim passes 17/17, both live and from a still start.
- **Not yet run on real hardware:**
  - perf (8 / 14 ms on the discrete GPU);
  - real-time recordings: `node scripts/qa/record.mjs --project constructsafe`.
- For reference, ConstructSafe draws 139 calls and 193k triangles on a card, 166 and 291k in a case study.

## 5. Local session: first steps

1. `git pull origin 3D_miniatures`, then `npm ci`, then `npm run assets:3d` (the Poly Haven textures, needed before any bake).
2. `npm run dev`, then look at the ConstructSafe card and case study.
3. `npm run qa:3d` (everything, including perf on your GPU).
4. Review ConstructSafe. Any notes are applied before FinMind.
5. **Optional ConstructSafe re-bake** (blocked in the cloud by Poly Haven):
   - the crane hook: `jib_hoist()` in `scripts/blender/kit/site.py`, a gin-wheel jib on top of the scaffold with `dyn` nodes `hoist_rope` and `hoist_hook`, plus a `hoist_load` spot and a hoist job;
   - the cameras tagged `prop`, so `cam_cam01..04` become their own nodes (the `props.wall_camera` role in `constructsafe.py`);
   - `barrier_arm` made `passable`;
   - the `enrol` spot moved out of the gate zone;
   - a `pipe_stack` in the yard (the kit has `pipe_stack()`; it isn't placed yet);
   - then `node scripts/build-3d.mjs constructsafe --force`;
   - after that, retire the runtime stand-ins in §3 and re-run features, sim and parity.
   - Blender is `BLENDER` (defaults to `C:/Program Files/Blender Foundation/Blender 5.2/blender.exe`).
   - The scene script, with its spots, cameras and zones: `scripts/blender/scenes/constructsafe.py`.
6. **Don't commit** the Blender kit's tracked `__pycache__/*.pyc` files if a bake touches them: `git checkout -- scripts/blender/**/__pycache__`.

## 6. Known observations (carried, not bugs from this work)

- **Retail, from the still start:** 17/18, with one party waiting in the doorway. It was there before this work; report it rather than change it.
- Retail's sim from a live start was occasionally flaky before. The last full run was green.
- `_calibration`'s make-way rate is 5.0 a minute. It was there before.
- ConstructSafe parity: the poster shows the new starter walking in, but live, they enter from the road after the start.
- The van drive-in was dropped (3.2 m van, 1.9 m gate). The van is unloaded where it's parked instead.
- `helpable` (Retail-only staff help) was deferred.
- The site's ScrollTrigger count falls during the open/close cycles. That's expected: the reveal triggers use `once: true`.
- A mask-only PPE alert gets no dashboard card (the product only makes cards for helmet, vest, fall and fire), and the 10 s per-camera cooldown can hold back a helmet alert.

## 7. FinMind (scene 2): next

**The r6 plan's design:**
- An island of about 12 × 8 m: a "verification works".
- A conveyor loop past stations:
  - an input kiosk with 7 tool booths;
  - a memory archive (SQLite);
  - a calculation engine (45 steps, 37 ms);
  - a knowledge library (4 books, 113 passages, Qdrant and FTS5 merged by RRF);
  - a context builder;
  - a local LLM scribe (5.3 s) inside an "on this machine" fence;
  - a safety line: 5 stamp gates and a 0 to 100 trust score;
  - an output counter in EN/HI/TE/TA.
- A "sabotage" lever: an invented ₹ figure is rejected, the answer gets one retry, and then the calculator's own explanation is used.
- A Monte Carlo fan of 1,000 paths.
- Overlay: flow particles and timers.

**Survey source (undecided; you dismissed my question):**
- In the plan: `HYDRABATH_HACK`, which is repo `ai-money-mentor`, never linked from the site because of the API keys in its history.
- On GitHub: `yaseen12376/HYDRA_HACK` (private) and `Cavin-xyz/ai-money-mentor` (public).
- Locally, use whichever folder you have.

**Already in the portfolio** (check against the code during the survey):
- `projects.js` (`id: 'finmind'`, `poster: null`, no `scene3d`) and `case-copy.js`:
  - a seven-stage Spring Boot pipeline (input, memory, calculation, retrieval, context, local LLM, safety), streamed to React by SSE;
  - versioned rules for the 2025-26 and 2026-27 tax years;
  - 113 passages from 4 official Income Tax Department and SEBI documents;
  - Qdrant plus SQLite FTS5 merged by reciprocal-rank fusion;
  - `qwen3.5:4b` on Ollama through Spring AI;
  - the 5 checks: citations, every ₹ figure traced to the engine, output structure, no named fund houses, agreement with the calculator;
  - on failure: one retry, told exactly which figures it may use, then the calculator's explanation;
  - 1,000 Monte Carlo scenarios;
  - EN/HI/TE/TA;
  - timings: calculation 37 ms, retrieval 222 ms, LLM 5.3 s, safety 6 ms;
  - 8/8 on retrieval and on answer accuracy in the seed evaluation;
  - a 0 to 100 trust score;
  - 7 money tools: FIRE planning, a money health score, a tax regime wizard, life events, a couples' planner, a portfolio X-ray, a scam shield;
  - limitations: resident individuals under 60 with salary income, no capital gains yet, a 4B model whose wording is weakest in Indian languages, educational guidance only.
- Nothing else exists for FinMind yet: no `scripts/blender/scenes/finmind.py`, no `public/3d/finmind/`, no controller.

**Bake:** with a laptop that has Blender 5.2 and the Poly Haven textures, bake normally. (In the cloud the options were a flat-colour design baked there, or allowing Poly Haven.)

## 8. After FinMind: scenes 3 to 9, and R4

The r6 plan's table:
- **KPS Clean-O:**
  - survey: `KPS`;
  - a Tamil Nadu street corner;
  - 11 pastel ranges and 165 products;
  - an EN/Tamil switch that flips 449 strings;
  - the nanostores cart;
  - a rembg photo corner;
  - the doorstep cleaned top to bottom, dry before wet;
  - a delivery scooter;
  - 415 static pages.
- **Courier:**
  - survey: `TPC/CourierManagementSystem`;
  - a counter: PIN lookup, price slab, scale;
  - a QuestPDF receipt with a ZXing barcode;
  - a WhatsApp/SMS ping;
  - a mirror of the legacy SQL Server;
  - 4 daily syncs;
  - login lockout after 5 attempts;
  - Excel reports.
- **Attendance:**
  - survey: `repos/EIT_FACE_PROJ` and `face-recognition-system`;
  - turnstiles with face boxes, a 512-d ArcFace strip, a cosine 0.4 threshold dial;
  - exits give the duration;
  - a cooldown for someone lingering;
  - a visitor stays unknown;
  - a daily Excel export.
- **Indoor Tracking:**
  - repo to be located;
  - BLE tags on workers and a forklift;
  - beacons with coverage rings;
  - ESP32 gateways sending MQTT;
  - draggable trilateration;
  - Kalman on and off;
  - a ±3 m ring.
- **ObserveX:**
  - repo to be located;
  - two houses: ordinary CCTV only sees the break-in on playback, while ObserveX's intent gauge alerts before entry;
  - the 12-section site on the TV.
- **ADRAF:**
  - repo to be located;
  - a video wall of real and generated clips;
  - MTCNN/dlib;
  - three benches: landmarks, temporal consistency, CNN artefacts;
  - a Flask API rack;
  - the FaceForensics++ and Celeb-DF archive.
- **AirDraw:**
  - repo to be located;
  - a 21-landmark hand skeleton;
  - draw, erase and pinch-zoom;
  - a smoothing slider;
  - Socket.IO packets;
  - the C++ GPU bridge (WSL, TCP relay);
  - PNG export.
- **R4 cleanup:**
  - remove the video code and `public/project-video/`;
  - keep `_calibration` out of production;
  - update the docs.

## 9. Needs your action

- **Rotate credentials:**
  - the FinMind Google API keys, which are in `ai-money-mentor`'s history;
  - the AWS keys in `repos/ppe-detection/.env`;
  - in the ConstructSafe product repo:
    - the AWS keys and DB password in `FINAL_EIT_PPE/construct_safe/backend/detection_system/.env`;
    - the RTSP logins in `app.py`, `DetectionContext.tsx` and `mockData.ts`, which ship to every browser;
    - the sudo password in `hls_livestreaming/.../server.py`.
- **Before Attendance and ADRAF:** give your OK (or not) for `canonical_face_model.obj`.
- **Review ConstructSafe.** The cloud review material (the walkthrough board, the tour and case films, the spread map, parity, the phone card) was sent in chat. To regenerate it locally:
  - `node scripts/qa/film.mjs --project constructsafe [--stills]`;
  - `node scripts/qa/board.mjs --project constructsafe --dir build/qa/film/constructsafe/case --name walkthrough --cols 4`;
  - `npm run qa:spread`.
