/**
 * Project content: everything the home page shows. Each case study's long-form
 * copy (overview, problem, solution, implementation, outcomes, limitations)
 * lives in case-copy.js under the same id, a chunk of its own.
 *
 * Facts here come from the repositories themselves (code, git history and their
 * own docs), not from memory. Numbers are quoted only where the repo measured
 * them. Retail Analytics' figures are from Buttons/docs/ACCURACY.md; the
 * ConstructSafe ONNX figure is from ppe-detection/benchmark_results.txt.
 *
 * Field notes:
 * - `tier` places the project in the exhibition: 'stage' (a diorama on its own
 *   full-height stage), 'large' or 'small' (a tile on the collection shelf).
 * - `kind` is what the project is, in two or three words: the catalogue and
 *   the résumé print it.
 * - `period` is optional: the months the work ran, from git history, as
 *   { from: 'YYYY-MM', to: 'YYYY-MM' }. The résumé prints it; without it the
 *   résumé falls back to `year`.
 * - `piece` names the project's model under glass (scripts/blender/pieces/,
 *   built into public/pieces/<id>/ by `npm run build:pieces`).
 * - `metrics` render as display figures. The first two appear on cards; the
 *   detail view shows all of them. A value of 'TODO_' is skipped everywhere.
 * - `poster` is a diorama's Cycles still (public/3d/<id>/). A project without
 *   a diorama has a `piece` instead; with neither it gets a typographic frame.
 * - `repo` is only set for repositories that return 200 to a logged-out
 *   visitor. `private: true` shows a "Private repository" note instead.
 * - `num` is derived from array order below; do not set it by hand.
 * - `hidden: true` takes a project off the site and the résumé (no card, no
 *   case study page, no experience link) while keeping its entry here. Delete
 *   the flag to bring it back, then run `npm run gen:resume`.
 * - No em or en dashes in any string here. The renderers escape everything.
 */
const allProjects = [
  {
    id: 'retail-analytics',
    tier: 'stage',
    kind: 'Computer vision',
    title: 'Retail Analytics Platform',
    short:
      'Footfall and shopper-behaviour analytics for a clothing franchise, built on the CCTV cameras its stores already have.',
    blurb: 'Footfall and behaviour analytics on a clothing store’s own CCTV.',
    tags: ['YOLO11', 'TensorRT', 'FastAPI', 'React'],
    detail: {
      problem: 'A store knows what sold, not how people moved through it.',
      built: 'YOLO11 detection and tracking, zones and dwell time, a POS matcher, a live dashboard.',
      result: '2.4× faster after TensorRT, six cameras batched through one laptop GPU.',
    },
    year: '2026',
    role: 'Solo project',
    team: 'Designed, built and benchmarked alone',
    status: 'In active development',
    private: true,
    // The diorama's own Cycles still (the live scene fades in over it).
    poster: '/3d/retail-analytics/poster.webp',
    metrics: [
      { value: '2.4×', label: 'faster inference after TensorRT export, counts unchanged' },
      { value: '6', label: 'camera streams batched through one model' },
      { value: '143 FPS', label: 'aggregate throughput on a laptop RTX 3050 Ti' },
      { value: '+8.1%', label: 'track churn from ReID, so it was measured and rejected' },
    ],
    techStack: [
      'Python', 'YOLO11', 'BoT-SORT', 'ByteTrack', 'InsightFace', 'TensorRT', 'OpenCV',
      'FastAPI', 'WebSockets', 'React', 'Recharts', 'PostgreSQL', 'TimescaleDB', 'SQLite',
      'Docker', 'GitHub Actions', 'pytest',
    ],
    // The diorama: one chapter per real feature (Buttons/README.md and docs/),
    // numbers only from the metrics and limitations on this page.
    scene3d: {
      id: 'retail-analytics',
      tour: ['track', 'line', 'heat'],
      chapters: [
        {
          id: 'cameras',
          title: 'Six camera roles',
          caption: 'Every camera has a role the platform acts on: entrance, checkout, floor, stockroom, staff only and perimeter. Each also watches its own picture: covered, knocked or blurred for 30 s, and its counts are marked suspect.',
          hint: 'Pick a camera, then cover, knock or blur it.',
        },
        {
          id: 'coverage',
          title: 'Coverage and blind spots',
          caption: 'The store plan lays every camera over the floor, half a metre at a time, with fixtures hiding what stands behind them. A planned camera shows how much blind floor it would win back.',
          hint: 'Plan a camera, then drag it.',
        },
        {
          id: 'track',
          title: 'Detect and track',
          caption: 'YOLO11 finds every person and BoT-SORT keeps their ID, even while a fitting-room curtain hides them. A mannequin looks like a person until 240 s of stillness end its track, or an IGNORE zone rules it out.',
          hint: 'Click a shopper to follow them, or draw an IGNORE zone.',
        },
        {
          id: 'line',
          title: 'Line counting',
          caption: 'A line across the doorway counts every entry and exit. A dead band and confirmation frames stop someone hovering on it from counting again and again, and moving it keeps today’s counts.',
          hint: 'Have someone linger in the doorway, or drag the line.',
        },
        {
          id: 'zones',
          title: 'Zones and dwell',
          caption: 'Zones time how long each person stays. Loitering is flagged while the person is still there, not afterwards.',
          hint: 'Drag a corner to reshape a zone.',
        },
        {
          id: 'heat',
          title: 'Heatmap and journeys',
          caption: 'Where people stood, summed over the day, its five busiest places numbered, and the routes that ended without reaching the till.',
          hint: 'Drag a rail: shoppers re-route and the heat re-forms.',
        },
        {
          id: 'parties',
          title: 'Shopping parties',
          caption: 'People who come in within 8 s of each other and stay within 1.5 m for 4 s count as one party, so conversion is measured per visitor and per party.',
        },
        {
          id: 'pos',
          title: 'Till and POS',
          caption: 'Each sale is matched to the shopper at the till by timestamp, not identity, and a busier counter means a less certain match. Time at the till, unattended moments and walkouts come from the same camera.',
          hint: 'Choose how many are at the counter, or send the cashier away.',
        },
        {
          id: 'staff',
          title: 'Staff and consent',
          caption: 'Staff are left out of customer counts, by consent kept as an append-only ledger. Activity is where they are and whether they move; "on phone" only when a phone is seen in the hand, and never for appraisal.',
          hint: 'Withdraw a staff member’s consent.',
        },
        {
          id: 'security',
          title: 'Security review',
          caption: 'Intrusion, loitering and concealment alerts go to a person to review, each with a clip from 5 s before to 8 s after. Nothing triggers an automatic action.',
          hint: 'Have someone linger in the fitting area, then play the clip.',
        },
        {
          id: 'dashboard',
          title: 'Live dashboard',
          caption: 'Events stream over WebSockets to a React dashboard, and a report with what needs attention arrives at 07:00. Batching runs six cameras through one laptop GPU, but not the entrance camera, where it moved 2 of 82 crossings.',
          hint: 'Switch TensorRT on and off, or print the report.',
        },
      ],
    },
  },

  {
    id: 'constructsafe',
    tier: 'stage',
    kind: 'Computer vision',
    title: 'ConstructSafe: AI Site Safety Platform',
    short:
      'Construction-site monitoring that flags missing PPE, falls, fire and smoke as they happen, and matches faces to workers in the live view.',
    blurb: 'PPE, falls, fire and faces, each site camera in its own mode.',
    tags: ['YOLOv8', 'MoveNet', 'ONNX Runtime', 'InsightFace'],
    detail: {
      problem: 'Supervisors cannot watch every camera, and a helmet detector cannot say who is at risk.',
      built: 'Four detectors in one pipeline, matching faces to workers in the live view and filing the evidence.',
      result: '1.31× faster in an ONNX export benchmark, and the most commits on the team.',
    },
    year: '2026',
    role: 'Detection engine lead',
    team: 'Team of 7 at Ethical Intelligence Technologies',
    private: true,
    // The diorama's own Cycles still (the live scene fades in over it).
    poster: '/3d/constructsafe/poster.webp',
    metrics: [
      { value: '1.31×', label: 'faster in an ONNX export benchmark (YOLOv8s, 97 to 74 ms a frame)' },
      { value: '10', label: 'PPE classes, with a safe or unsafe state per worker' },
      { value: '4', label: 'detectors in one pipeline: PPE, falls, fire and smoke, faces' },
      { value: '40', label: 'commits to the detection engine, the most on the team' },
    ],
    techStack: [
      'Python', 'YOLOv8', 'MoveNet', 'InsightFace', 'ONNX Runtime', 'CUDA', 'OpenCV',
      'Flask-SocketIO', 'React', 'TypeScript', 'PostgreSQL', 'AWS S3', 'HLS',
    ],
    // The diorama: one chapter per real feature of the product
    // (construct_safe/backend/detection_system: app.py and config.py), every
    // number the code's own.
    scene3d: {
      id: 'constructsafe',
      tour: ['ppe', 'falls', 'fire'],
      chapters: [
        {
          id: 'cameras',
          title: 'Four cameras, one mode each',
          caption: 'CAM-01 and CAM-02 watch outdoors, CAM-03 the ground floor inside, and CAM-04 the welding bay, labelled High-Risk Zone. Each takes a frame every 2 s in its own mode (Face, PPE, Fall, Fire, PPE+Fall or All), and they start 2 s apart.',
          hint: 'Pick a camera, then switch its mode.',
        },
        {
          id: 'ppe',
          title: 'PPE check',
          caption: 'Each person found (YOLOv8n, confidence 0.30) is cropped with 15% padding and checked for a hard hat, mask and safety vest (confidence 0.50). Any NO- class, or a required item not seen, makes them unsafe, so a mask turned away from the camera counts as missing. Items are smoothed over 3 frames.',
          hint: 'Take a hard hat or mask off, or turn someone away.',
        },
        {
          id: 'faces',
          title: 'Who is it',
          caption: 'InsightFace (ArcFace), after CLAHE, matches faces to enrolled workers in the live view: a similarity above 0.35 names them, and anyone else is Unknown. A new worker is enrolled from a photo, and the faces reload without a restart.',
          hint: 'Enrol the new starter at the hut.',
        },
        {
          id: 'falls',
          title: 'Falls',
          caption: 'MoveNet Thunder finds 17 keypoints on one person a frame. Four rules score it out of 6: torso over 60° from vertical (+2), shoulders level with hips (+2), a short body in the frame (+1), lying low in it (+1). 4 or more is a fall, raised on a single frame.',
          hint: 'Have someone slip on the ground floor.',
        },
        {
          id: 'fire',
          title: 'Fire and smoke',
          caption: 'A YOLOv8n fine-tuned on fire and smoke (mAP50 0.861) looks at the whole frame. One frame at 0.6 or more raises FIRE/SMOKE DETECTED, critical.',
          hint: 'Let the sparks catch the bin, then put it out.',
        },
        {
          id: 'alerts',
          title: 'Alerts and evidence',
          caption: 'Each alert type has a 10 s cooldown per camera, not per person. Every alert saves one JPEG with its boxes drawn, uploaded to S3 behind a link that lasts 7 days, and the dashboard shows a card for each person in it.',
          hint: 'Raise two violations back to back, then open the screenshot.',
        },
        {
          id: 'playback',
          title: 'Recording and playback',
          caption: 'Each camera’s H.264 goes straight into HLS in 2 s segments, with 12 hours to rewind. A timelapse takes a snapshot every 10 minutes and plays at 24 fps.',
          hint: 'Go back to the fall, step 10 s either way, then GO LIVE.',
        },
        {
          id: 'productivity',
          title: 'Productivity and attendance',
          caption: 'A worker is idle after 120 s moving no more than 5% of their box’s diagonal. The gate camera logs attendance only inside the worker’s shift, and each worker card reads Active, Idle or PPE Violation.',
          hint: 'Have someone stand idle, or clock someone in at the gate.',
        },
        {
          id: 'office',
          title: 'Site office',
          caption: 'Each model can be unloaded to save memory: PPE 250 MB, Fall 180 MB, Fire 200 MB, Face 150 MB, as estimated. In an ONNX export benchmark, YOLOv8s ran in 74 ms a frame against 97 ms (1.31×).',
          hint: 'Unload a model, or send a test alert.',
        },
      ],
    },
  },

  {
    id: 'finmind',
    tier: 'stage',
    kind: 'Local LLM assistant',
    title: 'FinMind: AI Money Mentor',
    short:
      'A personal-finance mentor for Indian savers where every rupee figure comes from a calculation engine, and a local LLM only explains it.',
    blurb: 'Money advice where the LLM explains the numbers and never makes them up.',
    tags: ['Spring AI', 'Ollama', 'Qdrant', 'React 19'],
    detail: {
      problem: 'A chatbot that invents a tax figure is worse than no advice at all.',
      built: 'A rules-driven Java engine, hybrid retrieval over official documents, a local LLM and a safety layer.',
      result: '8 of 8 on retrieval and on answer accuracy in the seed evaluation, every figure traced to the engine.',
    },
    year: '2026',
    role: 'Backend and AI pipeline',
    team: 'Hackathon team project',
    // The public repository's history holds API keys, so it is not linked.
    poster: '/3d/finmind/poster.webp',
    scene3d: {
      id: 'finmind',
      tour: ['tools', 'safety', 'montecarlo'],
      chapters: [
        {
          id: 'tools',
          title: 'Seven tools, one pipeline',
          caption: 'FIRE planning, a money health score, a tax wizard, life events, a couples’ planner, a portfolio X-ray and a scam shield all run the same stages: input, memory, calculation, retrieval, context, a local LLM and safety checks. Each stage streams to the app as it finishes. On a measured FIRE plan: 37 ms to calculate, 222 ms to retrieve, 5.3 s for the LLM, 6 ms to check.',
          hint: 'Pick a tool to ask it a question.',
        },
        {
          id: 'memory',
          title: 'It remembers you',
          caption: 'A saved profile loads the person’s age, income, goals and recent questions from SQLite for the model to read, and each answer is filed back afterwards. A guest has no memory.',
          hint: 'Sign in, or stay a guest.',
        },
        {
          id: 'engine',
          title: 'A calculator makes the numbers',
          caption: 'Every rupee figure comes from a Java engine and versioned rules for the 2025-26 and 2026-27 tax years, each step with its formula: 45 steps in 37 ms for this plan. New regime ₹1,19,340, old ₹3,01,080. The 2026-27 rules carry the Income-tax Act 2025’s section numbers.',
          hint: 'Switch the tax year.',
        },
        {
          id: 'library',
          title: 'Official sources',
          caption: '113 passages from four Income Tax Department and SEBI documents, one book each. A vector search (bge-m3, similarity 0.52 or more) and a keyword search (SQLite FTS5) find 8 each, and reciprocal-rank fusion keeps 4. Keyword hits alone count only when a section or form is named.',
          hint: 'Ask the library a question.',
        },
        {
          id: 'context',
          title: 'What the model reads',
          caption: 'Four blocks: the rules, what it remembers about you, the calculator’s lines (the slab-by-slab detail left out) and the sources, citable as S1 to S4. The window is 8,192 tokens, so the sources are never cut off.',
          hint: 'Open each folder.',
        },
        {
          id: 'scribe',
          title: 'A model on this machine',
          caption: 'qwen3.5:4b runs in Ollama through Spring AI, at temperature 0.2 with thinking off: 51 tokens a second with every layer on the GPU, 16 with Ollama’s default split. Unplug the internet and answers still come. Nothing about you is sent.',
          hint: 'Unplug the internet, or change the GPU split.',
        },
        {
          id: 'safety',
          title: 'Five checks before it’s shown',
          caption: 'Sources, every ₹ figure traced to the calculator, output structure, no named fund houses, and agreement with the calculator, weighted 25, 40, 15, 10 and 10 into a trust score. A failing answer goes back once, told exactly what was wrong. If it fails again, the calculator’s own explanation is shown.',
          hint: 'Slip a made-up figure into the next answer.',
        },
        {
          id: 'languages',
          title: 'English, Hindi, Telugu, Tamil',
          caption: 'The model writes in the chosen language but keeps every digit, ₹ figure and section number as the calculator gave it, and the checks run on the translated text. Its wording is weakest in Indian languages; the numbers are guarded.',
          hint: 'Pick a language.',
        },
        {
          id: 'montecarlo',
          title: '1,000 futures',
          caption: 'The plan runs through 1,000 seeded market scenarios (equity σ 18%, debt σ 4%, a glide path from 80% to 30% equity). For this plan, 37% reach the FIRE number at the ₹74,500 a month the calculator asks for.',
          hint: 'Retire earlier or later, or raise inflation.',
        },
      ],
    },
    metrics: [
      { value: '5', label: 'safety checks on every answer before it is shown' },
      { value: '8/8', label: 'retrieval and answer accuracy on the seed evaluation set' },
      { value: '7', label: 'money tools on one advice pipeline' },
      { value: '37 ms', label: 'for 45 calculation steps, while the LLM takes 5.3 s to explain them' },
    ],
    techStack: [
      'Java 21', 'Spring Boot 4', 'Spring AI', 'Ollama', 'Qwen 3.5', 'Qdrant', 'SQLite FTS5',
      'React 19', 'Vite', 'Tailwind CSS', 'Framer Motion', 'Recharts', 'Server-sent events', 'JUnit',
    ],
  },

  // Facts from the repo's README and HANDOFF.md (its evaluation tables). The
  // client is not named anywhere on this site, and every figure is from the
  // demo build's synthetic documents. Never quote: production use, accuracy
  // on real claims, fraud findings, savings, or an approved methodology.
  {
    id: 'claims-workbench',
    // Off the site for now; delete this line to show it again.
    hidden: true,
    tier: 'large',
    kind: 'Document AI',
    title: 'Property Claim Review & Settlement Workbench',
    short:
      'A claims workbench that reads a commercial property claim file with local vision models, checks it with rules, and takes it to a signed-off settlement, all on one laptop.',
    blurb: 'A property claim file read, checked and settled on one laptop.',
    tags: ['FastAPI', 'React 19', 'Ollama', 'SQLite'],
    detail: {
      problem: 'A claim file is PDFs, scans, photos and invoices that someone has to read line by line.',
      built: 'Local vision models that cite every value, rule checks, and an exact-decimal settlement behind a three-level approval chain.',
      result: 'Field accuracy 0.987 on its synthetic evaluation set, at 16.1 s a page instead of 69.1.',
    },
    year: '2026',
    period: { from: '2026-11', to: '2026-11' },
    role: 'Engineer, full build',
    team: 'Two people: a colleague ran the client engagement, I built the software',
    status: 'Demo build on synthetic claims',
    private: true,
    piece: { id: 'claims-workbench' },
    metrics: [
      { value: '0.987', label: 'field accuracy on the synthetic evaluation set, each value checked against the line it cites' },
      { value: '16.1 s', label: 'a page for extraction on a 4 GB laptop GPU, down from 69.1 s' },
      { value: '3', label: 'approval levels, each with its own authority limit' },
      { value: '109', label: 'automated tests' },
    ],
    techStack: [
      'Python', 'FastAPI', 'SQLAlchemy', 'SQLite', 'PyMuPDF', 'RapidOCR', 'ONNX Runtime', 'Ollama', 'Qwen 3.5',
      'ReportLab', 'React 19', 'TypeScript', 'TanStack Query', 'Tailwind CSS 4', 'Vite', 'pytest',
    ],
  },

  // Facts from the repo's README, TEST_BATTERY_STATUS.md and docs/native-pose.md.
  // The accuracy figures are from synthetic sequences and are always labelled
  // so. The event's name and result are not in the repo, so neither is here.
  {
    id: 'athletevision',
    tier: 'large',
    kind: 'On-device pose',
    title: 'AthleteVision: Fitness Tests on One Phone',
    short:
      'The SAI fitness test battery on one phone with no internet: the camera measures eight of the ten tests with on-device pose tracking.',
    blurb: 'A ten-test fitness battery, measured offline by one phone.',
    tags: ['MediaPipe', 'Capacitor 8', 'Next.js 15', 'CameraX'],
    detail: {
      problem: 'Ten fitness tests to measure and record, with one phone and no internet.',
      built: 'An analyzer per test on MediaPipe pose, tape marks that follow the phone, and a native Android pose path.',
      result: 'Pose runs 2.7 to 3.7 times faster natively than in the WebView on a budget phone.',
    },
    year: '2026',
    period: { from: '2026-11', to: '2026-11' },
    role: 'Vision and measurement engineer',
    team: 'Team of three. My part: the test analyzers, the capture stack and native Android pose',
    status: 'Hackathon build, tested on Android',
    private: true,
    piece: {
      id: 'athletevision',
      chapters: [
        {
          id: 'jar',
          title: 'The sit-up test',
          caption:
            'The handbook’s ninth test as the app runs it: one phone on a stand films side-on at mat height and counts. Round the mat, the kit of the other tests: a floor tape, two cones and the medicine ball.',
          hint: 'Drag to turn it. Tap the glass to lift it off, then tap a part.',
        },
        {
          id: 'phone',
          title: 'Pose on the phone',
          caption:
            'MediaPipe pose runs on the phone with no network: a Lite model live and a Full model for still frames, both inside the app. Native Android pose through CameraX ran 2.7 to 3.7 times faster than the WebView on a Galaxy A17 5G, and the GPU is kept only if it is at least 15% faster.',
        },
        {
          id: 'count',
          title: 'Counting sit-ups',
          caption:
            'A sit-up counts when the elbows touch the knees, for 45 s. Three fouls refuse one: fingers not clasped behind the neck, pushing off with an elbow, or elbows not back on the mat before the next. A foul drops only that sit-up. The count was exact in all 16 synthetic scenarios.',
        },
        {
          id: 'marks',
          title: 'Marks that hold',
          caption:
            'Tape marks are tapped once, then followed through the phone’s motion sensors and found again in the picture. A turn of more than 0.4° held for 250 ms stops the attempt: a 1° tilt at 3 m would move a reading by about 5 cm.',
        },
        {
          id: 'throw',
          title: 'Medicine ball',
          caption:
            'The ball is followed from the release to its first touch of the ground, read on the floor’s own scale, and the landing frame is shown for the coach to confirm. On synthetic throws it lands within 0.12 m at 30 and 60 fps. The size it looks for follows the athlete’s ball, 2 kg or 1 kg.',
        },
      ],
    },
    metrics: [
      { value: '8 of 10', label: 'tests measured by the camera; the coach types or times the other two' },
      { value: '2.7×', label: 'to 3.7× faster pose on native Android than in the WebView, on a Galaxy A17 5G' },
      { value: '±0.6 cm', label: 'height on synthetic sequences, not yet on athletes' },
      { value: '0', label: 'network calls: both pose models ship inside the app' },
    ],
    techStack: ['TypeScript', 'Next.js 15', 'React 19', 'Capacitor 8', 'MediaPipe', 'Java', 'CameraX', 'Android', 'IndexedDB'],
  },

  // Facts from the repo's PRD.md, docs/HANDOFF.md, docs/research/ground-truth.md,
  // docs/handoff/local-ai.md, the pipeline's DATA_REPORT.md and app/lib/ai/; the
  // event's name from pitch/DECK_CONTENT.md (its result is in no file).
  // Credit by part, from the commit history: the data pipeline, the advisor's
  // evidence, template and guards, local AI and the Blender work are the
  // owner's; the app screens, the officials' desk, WhatsApp, Telegram, tickets
  // and red zones are teammates'. The web app was renamed Aroli late in the
  // event; the docs and the pitch say NeerNaadi. Never quote: an event result,
  // real complaint counts (the app's tickets are seeded demo data), how precise
  // the team's geocoded cases are, or the local AI worker as run end to end.
  {
    id: 'neernaadi',
    tier: 'large',
    kind: 'Civic AI',
    title: 'NeerNaadi: Water & Flood Report Network',
    short:
      'An open map of Chennai where every flood or water complaint is a public ticket, ten in one place raise a red zone, and an AI advisor cites past floods and the drain survey to say what to fix first.',
    blurb: 'Flood complaints as public tickets, and an advisor that cites its sources.',
    tags: ['GeoPandas', 'Convex', 'Ollama', 'Blender'],
    detail: {
      problem: 'Flood complaints go to separate helplines, so nobody sees one street going under all at once.',
      built: 'A data pipeline over the city’s drain survey and news from ten floods, and an advisor that cites only what it was given.',
      result: 'On the benchmark red-zone card, both local models passed every guard and invented no number.',
    },
    year: '2026',
    period: { from: '2026-11', to: '2026-11' },
    role: 'Data, AI advisor and 3D',
    team: 'Hackathon team. My part: the data pipeline, the AI advisor and the 3D',
    status: 'Hackathon build, seeded with demo tickets',
    private: true,
    piece: {
      id: 'neernaadi',
      chapters: [
        {
          id: 'jar',
          title: 'A street in the monsoon',
          caption:
            'A Chennai street in miniature, cut open to show what the advisor reads: the box drains under both footpaths, one silted with rubbish caught in it, the water main and the sewer. Ten unattended reports stand round the water in the road.',
          hint: 'Drag to turn it. Tap the glass to lift it off, then tap a part.',
        },
        {
          id: 'zone',
          title: 'Red zones',
          caption:
            'Ten or more open reports within 500 m and 6 hours raise an area red zone. It turns orange once the government has responded to most of them and grey when most are resolved, then clears. Three area zones, or 50 open reports, raise a ward.',
        },
        {
          id: 'ticket',
          title: 'A ticket’s life',
          caption:
            'Every report is a public ticket: red while unattended, orange while the government processes it, grey once resolved. Then WhatsApp asks the resident “Is it fixed?”. YES closes it; NO reopens it as red, marked “Resident: not fixed”.',
        },
        {
          id: 'drains',
          title: 'The drain survey',
          // With the glass off the camera comes in on the cut, where the
          // silted drain shows its bottles and leaves.
          view: { zoom: 0.4, pitch: 0.15 },
          caption:
            'The advice reads the city’s drain survey: 19,947 segments, each lined or unlined, covered or open, with its condition, whether water was seen flowing, its obstacles, size and age. Every defect it cites carries its GCC record number.',
        },
        {
          id: 'floods',
          title: 'Past floods',
          caption:
            'The advisor draws on 272 dated, place-named flood reports from the news, across 10 events from 2016 to 2026, each with its link. It may add no figure of its own: a rewrite with a number not in its sources falls back to the template.',
        },
      ],
    },
    metrics: [
      { value: '272', label: 'dated, place-named flood reports from the news across 10 events, 2016 to 2026, each with its link' },
      { value: '19,947', label: 'surveyed drain segments behind the advice, each defect cited by its GCC record number' },
      { value: '10', label: 'open reports within 500 m in one 6 hour window raise an area red zone' },
      { value: '0', label: 'figures a model may add: a rewrite with a number not in its sources falls back to the template' },
    ],
    techStack: [
      'Python', 'GeoPandas', 'H3', 'scikit-learn', 'TypeScript', 'Next.js 16', 'React 19', 'Convex', 'MapLibre GL',
      'Ollama', 'Qwen 3.5', 'Gemma 4', 'Gemini', 'Twilio', 'Blender', 'Cycles', 'Playwright',
    ],
  },

  // Facts from the repo's README, CLAUDE.md, AI_USAGE.md and docs/handoff/.
  // Credits are by role only: no student is named, here or anywhere on the
  // site. Never quote a result, a submission, a team name or NASA's backing.
  {
    id: 'mission-builder-3d',
    tier: 'large',
    kind: 'Browser game',
    title: 'Mission Builder 3D: Mars Lander Game',
    short:
      'A browser game for the NASA Space Apps Challenge 2026: design a Mars lander, pass six launch checks and keep it alive for 20 sols of dust, storms and slow radio signals.',
    blurb: 'Design a Mars lander, then keep it alive for 20 sols.',
    tags: ['three.js', 'Vite', 'Vitest', 'Blender'],
    detail: {
      problem: 'Dust, power and a radio that answers minutes late, for players of about 9 to 15.',
      built: 'A pure rules engine under 281 tests, a three.js world, and a lander modelled by script in Blender.',
      result: 'The real distance to Mars gives a 10 min 57 s signal delay, played as 11 seconds.',
    },
    year: '2026',
    period: { from: '2026-11', to: '2026-11' },
    role: 'Technical lead',
    team: 'Team of four: two adults and two school students',
    status: 'Student project, not endorsed by NASA',
    private: true,
    piece: {
      id: 'mission-builder-3d',
      // The live jar's chapters (its case study): the whole jar, then one for
      // each spot its export marks (scripts/blender/pieces/<id>.py spots()).
      chapters: [
        {
          id: 'jar',
          title: 'The lander',
          caption:
            'The game’s own lander model, on a patch of Mars with the Earth hanging overhead. Beads of light climb from its dish toward home.',
          hint: 'Drag to turn it. Tap the glass to lift it off, then tap a part.',
        },
        {
          id: 'checks',
          title: 'Launch checks',
          caption:
            'Before launch a design must pass six checks: rocket, instruments, mass, budget, power and antenna. A check that fails says what to change.',
        },
        {
          id: 'dust',
          title: 'Dust',
          // With the glass off the camera comes in over the array (a quarter of
          // the home distance, looking down more), to watch its brush sweep.
          view: { zoom: 0.24, pitch: 0.5 },
          caption:
            'In the game dust settles on the solar arrays at 3% a sol (sped up, and labelled ASSUMED) and a storm adds 25%. The cleaner starts above 30%, sweeps down to 5% and costs 150 Wh. Three sols in a row on an empty battery and the mission is lost.',
        },
        {
          id: 'signal',
          title: 'Radio delay',
          caption:
            'On 15 Nov 2026 Mars is 196,860,092 km away (NASA/JPL Horizons), so a signal takes 10 min 57 s to arrive. The game plays it as 11 seconds: one for each bead on the model.',
        },
        {
          id: 'tag',
          title: 'Rules engine',
          caption:
            'The rules are a pure engine under 281 unit tests, with no 3D or page code in it. Every number in the game carries one of four labels: NASA, CALC, GAME or ASSUMED.',
        },
      ],
    },
    metrics: [
      { value: '281', label: 'unit tests on a rules engine with no 3D or page code in it' },
      { value: '10:57', label: 'minutes of real signal delay to Mars on 15 Nov 2026, played as 11 seconds' },
      { value: '20', label: 'sols to survive: dust, cleaning, power, battery and science' },
      { value: '4', label: 'labels, one on every number: NASA, calculated, game or assumed' },
    ],
    techStack: ['JavaScript', 'three.js', 'Vite', 'Vitest', 'Blender', 'Python'],
  },

  {
    id: 'courier',
    tier: 'large',
    kind: 'Client software',
    title: 'Courier Management System',
    short:
      'Booking, billing and tracking software built for a courier franchise, with WhatsApp and SMS updates and printed PDF receipts.',
    blurb: 'Booking, billing and tracking for a courier franchise.',
    tags: ['ASP.NET Core 8', 'EF Core', 'SQL Server', 'WhatsApp API'],
    detail: {
      problem: 'Bookings sat in a legacy database with no modern front end.',
      built: 'An ASP.NET Core 8 app: receipts, barcodes, WhatsApp and SMS, legacy sync.',
      result: '16 controllers over 18 services, syncing with the courier network four times a day.',
    },
    year: '2026',
    role: 'Main developer',
    team: 'Client project for a courier franchise in Tamil Nadu',
    private: true,
    piece: {
      id: 'courier',
      chapters: [
        {
          id: 'jar',
          title: 'The counter',
          caption:
            'What the software does at a courier counter: the parcel is weighed and booked, and its receipt prints with the consignment’s barcode. A new receipt feeds out over the last one.',
          hint: 'Drag to turn it. Tap the glass to lift it off, then tap a part.',
        },
        {
          id: 'weigh',
          title: 'Weight to price',
          caption:
            'The destination’s pincode gives its region and the weight finds its slab; past the last slab, every extra unit adds the rate. A concession of up to 10% can come off by default, and the GST inside the total is split into CGST and SGST.',
        },
        {
          id: 'receipt',
          title: 'The receipt',
          caption:
            'An A5 receipt laid out with QuestPDF: the consignment row with its number as a Code 128 barcode, the date, the parcel’s type and weight, both customers, the charges and the total.',
        },
        {
          id: 'track',
          title: 'Tracking',
          caption:
            'Every consignment’s status is fetched from the courier network four times a day, at 10:00, 13:00, 16:00 and 20:00, and the master data every hour. Customers hear of each step by WhatsApp and SMS.',
        },
      ],
    },
    metrics: [
      { value: '16', label: 'MVC controllers over 18 services' },
      { value: '4×', label: 'daily background sync with the courier network' },
      { value: '5', label: 'failed logins before lockout, plus rate limiting' },
      { value: '21k', label: 'lines of C# and Razor' },
    ],
    techStack: [
      'C#', 'ASP.NET Core 8', 'Razor', 'EF Core', 'SQLite', 'SQL Server', 'ASP.NET Identity',
      'QuestPDF', 'ZXing', 'ClosedXML', 'WhatsApp Cloud API', 'MSG91', 'Tesseract.js',
    ],
  },

  {
    id: 'attendance',
    tier: 'large',
    kind: 'Face recognition',
    title: 'Automated Attendance System',
    short:
      'Face recognition attendance running on live CCTV: each sighting is matched to an enrolled face, logged as a check-in or a check-out, and exported to Excel.',
    blurb: 'Attendance taken from live CCTV, with no queue at the door.',
    tags: ['InsightFace', 'ArcFace', 'FastAPI', 'RTSP'],
    detail: {
      problem: 'Manual attendance is slow, and a proxy sign-in defeats it entirely.',
      built: 'ArcFace embeddings over a live RTSP stream, behind a JWT-secured FastAPI app.',
      result: 'Check-ins and check-outs logged per person, with working hours exported to Excel.',
    },
    year: '2025',
    role: 'Co-developer',
    team: 'Built with one teammate at Ethical Intelligence Technologies',
    // The repository is public, but it is not linked from here until it has
    // been cleaned up (docs/dioramas-handoff.md, "Needs the owner").
    private: true,
    piece: {
      id: 'attendance',
      chapters: [
        {
          id: 'jar',
          title: 'At the door',
          caption:
            'A camera over a doorway, as the system watches one: each person who passes is matched to an enrolled face and logged. The figure is a blank wooden peg: no face is modelled, and none is used.',
          hint: 'Drag to turn it. Tap the glass to lift it off, then tap a part.',
        },
        {
          id: 'camera',
          title: 'Find, then match',
          caption:
            'RetinaFace finds each face in the frame at 640 × 640, keeping those it is at least 0.7 sure of. ArcFace turns each into an embedding, and a cosine similarity above 0.4 with an enrolled one names the person.',
        },
        {
          id: 'cooldown',
          title: 'Sixty seconds',
          // With the glass off the camera looks down on the ring round the
          // figure's feet, far enough back to keep the figure in.
          view: { zoom: 0.8, pitch: 0.4 },
          caption:
            'A sighting is a check-in and the next one a check-out. For 60 s after a sighting the same person is not logged again, so standing in frame counts once: the ring round the figure fills a mark a second.',
        },
        {
          id: 'log',
          title: 'The log',
          caption:
            'The day exports to Excel as two sheets: Working_Hours_Summary, with each person’s hours, and Detailed_InOut_Log, with every check-in and check-out. Enrolment and monitoring sit behind a JWT-secured FastAPI app.',
        },
      ],
    },
    metrics: [
      { value: '60 s', label: 'cooldown, so someone standing in frame is logged once' },
      { value: '0.4', label: 'cosine-similarity threshold on ArcFace embeddings' },
      { value: 'JWT', label: 'authenticated FastAPI app for enrolment and monitoring' },
      { value: 'TODO_', label: 'Recognition accuracy % on your enrolled set' },
    ],
    techStack: ['Python', 'InsightFace', 'ArcFace', 'OpenCV', 'FastAPI', 'JWT', 'NumPy', 'Pandas', 'openpyxl'],
  },

  {
    id: 'indoor-tracking',
    tier: 'large',
    kind: 'Indoor positioning',
    title: 'Indoor Tracking System',
    short:
      'BLE and MQTT indoor positioning for real-time asset and personnel tracking where GPS cannot reach, accurate to roughly 3 metres.',
    blurb: 'Indoor positioning to roughly 3 metres, where GPS cannot reach.',
    tags: ['BLE', 'MQTT', 'ESP32', 'Python'],
    detail: {
      problem: 'GPS fails indoors, which is exactly where the tracking is wanted.',
      built: 'A BLE beacon mesh, RSSI trilateration with Kalman filtering, MQTT ingestion.',
      result: 'Live positions drawn on a floor plan, accurate to about 3 metres.',
    },
    year: '2025',
    role: 'Internship project',
    team: 'Ethical Intelligence Technologies',
    piece: {
      id: 'indoor-tracking',
      chapters: [
        {
          id: 'jar',
          title: 'A crate on the plan',
          caption:
            'A floor plan with three anchors and a crate carrying a BLE tag, doing one lap of the rooms. Each anchor’s range circle is as wide as the crate is far, so the three meet where the crate is.',
          hint: 'Drag to turn it. Tap the glass to lift it off, then tap a part.',
        },
        {
          id: 'ranges',
          title: 'Trilateration',
          caption:
            'The tag and the three anchors talk over Bluetooth Low Energy, and the signal’s strength (RSSI) says roughly how far apart they are. Three distances meet in one place: RSSI trilateration, indoors where GPS cannot reach.',
        },
        {
          id: 'track',
          title: 'Kalman smoothing',
          caption:
            'Signal strength is noisy, so raw fixes scatter round the route. A Kalman filter smooths them into a track that holds to about 3 metres: the disc round the crate, as wide as the scale bar.',
        },
        {
          id: 'gateway',
          title: 'Live on the plan',
          // With the glass off the camera comes in on the board atop the mast
          // (the readings climb to it), looking down on the arcs a little.
          view: { zoom: 0.45, pitch: 0.3 },
          caption:
            'Readings come in over MQTT, and positions reach the floor plan live over WebSocket, for assets and people indoors.',
        },
      ],
    },
    metrics: [
      { value: '±3 m', label: 'Positioning accuracy' },
      { value: 'BLE', label: 'RSSI trilateration' },
      { value: 'Kalman', label: 'Noise filtering' },
      { value: 'TODO_', label: 'Number of beacons deployed' },
    ],
    techStack: ['BLE Beacons', 'ESP32', 'MQTT', 'Python', 'Node.js', 'WebSocket', 'Kalman Filter'],
  },

  {
    id: 'kps-cleano',
    tier: 'small',
    kind: 'Storefront',
    title: 'KPS Clean-O: Bilingual Storefront',
    short:
      'An English and Tamil storefront for a cleaning-products brand: 165 products on 415 static pages, and a 3D doorstep you clean with the products.',
    blurb: 'An English and Tamil storefront, with a 3D doorstep to clean.',
    tags: ['Astro 7', 'Tailwind CSS 4', 'three.js', 'Blender'],
    detail: {
      problem: 'A local brand’s catalogue needed to read as well in Tamil as in English.',
      built: 'A static Astro site rebuilt from the live catalogue, with cut-out product photos and a real-time 3D scene.',
      result: '415 pages, 68 KB of JavaScript across the whole site, and 125 automated checks.',
    },
    year: '2026',
    role: 'Solo project',
    status: 'Redesign concept',
    private: true,
    piece: {
      id: 'kps-cleano',
      chapters: [
        {
          id: 'jar',
          title: 'A doorstep and its kit',
          caption:
            'The storefront’s own product models in a crate on a red-oxide doorstep, with a sikku kolam drawn on the step. Soap bubbles rise from the scrubber’s suds.',
          hint: 'Drag to turn it. Tap the glass to lift it off, then tap a part.',
        },
        {
          id: 'kit',
          title: 'The doorstep kit',
          caption:
            'On the storefront’s 3D doorstep the visitor cleans in the order professionals use, top to bottom and dry before wet, one product to a job. All nine make a doorstep kit: ₹1,035, over the free-delivery line.',
        },
        {
          id: 'clean',
          title: 'Clean by hand',
          caption:
            'The mess clears only where a tool goes: leaves and dust are particles pushed off the edge, and cobwebs, dust, grime and water are masks wiped away where it passes. Mop before sweeping and it says “Sweep first: wet dust turns to mud”.',
        },
        {
          id: 'kolam',
          title: 'The kolam',
          caption:
            'The last job is the reward: hold, and the kolam draws itself on the damp floor. The order-placed page plays the same kolam as a clip rendered in Cycles.',
        },
        {
          id: 'site',
          title: 'The storefront',
          caption:
            '165 products across 11 ranges on 415 static pages, every one with an English and a Tamil twin, and 68 KB of gzipped JavaScript across the whole site.',
        },
      ],
    },
    metrics: [
      { value: '165', label: 'products across 11 ranges, rebuilt from the live catalogue' },
      { value: '415', label: 'static pages, every one with an English and a Tamil twin' },
      { value: '449', label: 'interface strings in both languages' },
      { value: '68 KB', label: 'of gzipped JavaScript across the whole site' },
    ],
    techStack: [
      'Astro 7', 'TypeScript', 'Tailwind CSS 4', 'nanostores', 'GSAP', 'Lenis', 'three.js',
      'Blender', 'Cycles', 'rembg', 'OpenCV', 'Playwright',
    ],
  },

  {
    id: 'observex',
    tier: 'small',
    kind: 'Product site',
    title: 'ObserveX: Behavioral Threat Detection',
    short:
      'Product site for an AI home security concept built around predicting intent, not replaying footage after a break-in.',
    blurb: 'Investor site for an AI home security concept.',
    tags: ['React 19', 'TypeScript', 'Framer Motion', 'Three.js'],
    detail: {
      problem: 'Ordinary CCTV produces evidence after a break-in, which helps nobody at home.',
      built: 'Twelve scroll-choreographed sections in React 19, TypeScript and Framer Motion.',
      result: 'A pitch surface that reads as a funded startup, not a student project.',
    },
    year: '2026',
    piece: {
      id: 'observex',
      chapters: [
        {
          id: 'jar',
          title: 'The mark and its rings',
          caption:
            'ObserveX is a product site for a home-security concept, so there is no machine to show: the jar holds its identity. The OX block is the logo from the site’s navbar, and three rings in its palette swing round it, each carrying a lens.',
          hint: 'Drag to turn it. Tap the glass to lift it off, then tap a part.',
        },
        {
          id: 'mark',
          title: 'The logo',
          caption:
            'As the navbar draws it: a rounded square in a gradient from cyan to violet, with OX in the page’s navy, #050810.',
        },
        {
          id: 'palette',
          title: 'The palette',
          caption:
            'The rings are the palette in the site’s stylesheet: navy #050810, cyan #00e5ff and purple #8b5cf6. The type is Bebas Neue for display, Rajdhani for headings, DM Sans for text and Space Mono for figures.',
          // The dot rides over the rings' tops: aimed at their middle instead
          // (the block's, 0.25 below), from far enough back to hold all three.
          view: { zoom: 0.74, pitch: 0.12, drop: 0.25 },
        },
        {
          id: 'site',
          title: 'Twelve sections',
          caption:
            'Twelve sections in React 19, TypeScript and Framer Motion, from a two-second loading screen with a turning scan to the demo booking and the footer.',
          // In on the tag, from a little lower: the rings behind it then rise
          // out of the frame instead of catching under the button at its top.
          view: { zoom: 0.31, pitch: -0.14 },
        },
      ],
    },
    repo: 'https://github.com/yaseen12376/observex',
    metrics: [
      { value: '12', label: 'Composed sections' },
      { value: 'React 19', label: 'TypeScript + Tailwind 4' },
      { value: 'R3F', label: 'Three.js integration' },
    ],
    techStack: ['React 19', 'TypeScript', 'Tailwind CSS 4', 'Framer Motion', 'Three.js', 'shadcn/ui', 'Vite'],
  },

  {
    id: 'adraf',
    tier: 'small',
    kind: 'Deepfake detection',
    title: 'ADRAF: Deepfake Authentication',
    short:
      'Multi-stage deepfake detection combining facial landmark analysis, temporal consistency checking and CNN classification.',
    blurb: 'Deepfake detection from artefacts a viewer cannot see.',
    tags: ['TensorFlow', 'OpenCV', 'Flask', 'Deep Learning'],
    detail: {
      problem: 'Deepfake generation has outpaced anyone’s ability to spot it by eye.',
      built: 'Landmark geometry, temporal consistency and a CNN classifier, stacked together.',
      result: 'Trained across FaceForensics++ and Celeb-DF, served through a Flask API.',
    },
    year: '2025',
    piece: {
      id: 'adraf',
      chapters: [
        {
          id: 'jar',
          title: 'A head under the scanner',
          caption:
            'A milliner’s head form with no face, split down the middle: one half glazed porcelain, the other the same shape taken apart into voxels, a few lit where the checks found something. A scan ring travels up and down it.',
          hint: 'Drag to turn it. Tap the glass to lift it off, then tap a part.',
        },
        {
          id: 'landmarks',
          title: 'Landmark geometry',
          caption:
            'The first of three independent signals: facial landmark analysis catches geometric inconsistency in a face. Faces are found and tracked in real time with MTCNN and dlib.',
        },
        {
          id: 'temporal',
          title: 'Frame to frame',
          caption:
            'The second: a temporal module looks for the frame-to-frame instability that generated video struggles to hide.',
        },
        {
          id: 'cnn',
          title: 'A CNN',
          caption:
            'The third: a CNN classifier catches the compression and lighting artefacts specific to synthesis. It was trained across two benchmarks, FaceForensics++ and Celeb-DF, and the pipeline is served through a Flask REST API.',
        },
      ],
    },
    metrics: [
      { value: '2', label: 'Benchmark datasets' },
      { value: '3', label: 'Independent detection signals' },
      { value: 'TODO_', label: 'Accuracy on FaceForensics++' },
      { value: 'TODO_', label: 'Accuracy on Celeb-DF' },
    ],
    techStack: ['Python', 'TensorFlow', 'Keras', 'OpenCV', 'Flask', 'NumPy', 'dlib', 'MTCNN'],
  },

  {
    id: 'airdraw',
    tier: 'small',
    kind: 'Hand tracking',
    title: 'AirDraw: Gesture Drawing',
    short:
      'Draw, erase and zoom in the air with one hand, tracked by MediaPipe in real time and rendered to a browser canvas.',
    blurb: 'Draw in the air with one hand, tracked by webcam.',
    tags: ['MediaPipe', 'C++', 'Flask-SocketIO', 'Canvas'],
    detail: {
      problem: 'Hand tracking jitters, and keeping Python in the loop adds latency you feel.',
      built: '21 MediaPipe landmarks, smoothed gestures, and a C++ GPU bridge over TCP.',
      result: 'Draw, erase and pinch-zoom working end to end. Still in progress.',
    },
    year: '2026',
    role: 'Solo project',
    status: 'In progress',
    private: true,
    piece: {
      id: 'airdraw',
      chapters: [
        {
          id: 'jar',
          title: 'Drawing in the air',
          caption:
            'A wooden artist’s hand in the drawing pose, index finger up. Its 21 landmarks are the dots on its joints, joined as MediaPipe joins them, and the star it has drawn hangs in the air in the app’s brush colour.',
          hint: 'Drag to turn it. Tap the glass to lift it off, then tap a part.',
        },
        {
          id: 'hand',
          title: 'Three gestures',
          caption:
            'MediaPipe finds the hand’s 21 landmarks in every frame of a 30 FPS feed. Index finger up draws, an open palm erases, and a pinch zooms: fingertips closer than 18% of the hand’s diagonal, and never less than 25 px.',
        },
        {
          id: 'stroke',
          title: 'Smooth strokes',
          caption:
            'Each point is eased toward the last: 60% where the pen was, 40% where the finger is now (POSITION_SMOOTHING 0.6). The brush runs from 1 to 50 px and the eraser from 10 to 100 px.',
          // The dot sits on the star's top point: aimed at the star's middle
          // (its radius, 0.15, below), the fingertip that drew it beside it.
          view: { zoom: 0.55, pitch: 0.05, drop: 0.14 },
        },
        {
          id: 'bridge',
          title: 'The C++ bridge',
          caption:
            'Two C++ bridges built with Bazel, one for frames and one for landmarks, talk to the app over TCP, and Flask-SocketIO carries the result to the page. Gesture processing takes about 33 ms.',
          // The bridge is the rod the hand stands on: aimed up it (0.2 above
          // the dot on the base), from far enough back that the whole hand
          // stands below the button at the top.
          view: { zoom: 0.62, pitch: 0.05, drop: -0.2 },
        },
      ],
    },
    metrics: [
      { value: '21', label: 'hand landmarks tracked every frame' },
      { value: '3', label: 'gestures: draw, erase and pinch to zoom' },
      { value: '30 FPS', label: 'target camera feed' },
    ],
    techStack: ['Python', 'MediaPipe', 'OpenCV', 'C++', 'Bazel', 'ONNX', 'Flask-SocketIO', 'JavaScript', 'Canvas API'],
  },
];

export const projects = allProjects.filter((p) => !p.hidden);

projects.forEach((p, i) => {
  p.num = String(i + 1).padStart(2, '0');
});

/** Old ids that still arrive through shared links. */
const ALIASES = { ppe: 'constructsafe' };

export const getProject = (id) => projects.find((p) => p.id === (ALIASES[id] ?? id));

/** Metrics that have a real value, in display order. */
export const liveMetrics = (p) => (p.metrics ?? []).filter((m) => m.value !== 'TODO_');
