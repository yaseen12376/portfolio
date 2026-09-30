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
 * - `tier` places the project: 'flagship' (one), 'featured' (the pinned stack)
 *   or 'more' (the bento at the end of the work section).
 * - `metrics` render as display figures. The first two appear on cards; the
 *   detail view shows all of them. A value of 'TODO_' is skipped everywhere.
 * - `video` is the basename of a loop in public/project-video/ (<id>.webm with
 *   an .mp4 fallback). `poster` is the still; null renders a neutral frame.
 * - `repo` is only set for repositories that return 200 to a logged-out
 *   visitor. `private: true` shows a "Private repository" note instead.
 * - `num` is derived from array order below; do not set it by hand.
 * - No em or en dashes in any string here. The renderers escape everything.
 */
export const projects = [
  {
    id: 'retail-analytics',
    tier: 'flagship',
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
    // The pipeline's own visualiser output on a synthetic scene (no real
    // shoppers). Swap for the Veo loop once it exists: see docs/image-prompts.md.
    poster: '/3d/retail-analytics/poster.webp',
    video: '/project-video/retail-analytics',
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
    tier: 'featured',
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
    video: '/project-video/constructsafe',
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
    tier: 'featured',
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

  {
    id: 'courier',
    tier: 'featured',
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
    poster: '/posters/courier.webp',
    video: '/project-video/courier',
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
    tier: 'featured',
    title: 'Automated Attendance System',
    short:
      'Face recognition attendance running on live CCTV, with separate entry and exit cameras and automatic Excel reports.',
    blurb: 'Attendance taken from live CCTV, with no queue at the door.',
    tags: ['InsightFace', 'ArcFace', 'FastAPI', 'RTSP'],
    detail: {
      problem: 'Manual attendance is slow, and a proxy sign-in defeats it entirely.',
      built: 'ArcFace embeddings over two RTSP streams, behind a JWT-secured FastAPI app.',
      result: 'Entry and exit both recorded, exported to Excel every day.',
    },
    year: '2025',
    role: 'Co-developer',
    team: 'Built with one teammate at Ethical Intelligence Technologies',
    poster: '/posters/attendance.webp',
    video: '/project-video/attendance',
    repo: 'https://github.com/yaseen12376/EIT_FACE_PROJ',
    metrics: [
      { value: '2', label: 'CCTV streams, one for entry and one for exit' },
      { value: '0.4', label: 'cosine-similarity threshold on ArcFace embeddings' },
      { value: 'JWT', label: 'authenticated FastAPI app for enrolment and monitoring' },
      { value: 'TODO_', label: 'Recognition accuracy % on your enrolled set' },
    ],
    techStack: ['Python', 'InsightFace', 'ArcFace', 'OpenCV', 'FastAPI', 'JWT', 'NumPy', 'Pandas', 'openpyxl'],
  },

  {
    id: 'indoor-tracking',
    tier: 'featured',
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
    poster: '/posters/indoor-tracking.webp',
    video: '/project-video/indoor-tracking',
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
    tier: 'more',
    title: 'KPS Clean-O: Bilingual Storefront',
    short:
      'An English and Tamil storefront for a cleaning-products brand: 165 products on 415 static pages, and a 3D doorstep you clean with the products.',
    blurb: 'An English and Tamil storefront, with a 3D doorstep to clean.',
    tags: ['Astro 5', 'Tailwind CSS 4', 'three.js', 'Blender'],
    detail: {
      problem: 'A local brand’s catalogue needed to read as well in Tamil as in English.',
      built: 'A static Astro site rebuilt from the live catalogue, with cut-out product photos and a real-time 3D scene.',
      result: '415 pages, 68 KB of JavaScript across the whole site, and 125 automated checks.',
    },
    year: '2026',
    role: 'Solo project',
    status: 'Redesign concept',
    private: true,
    // The project's own Cycles render of its doorstep, until its diorama lands.
    poster: '/posters/kps-cleano.webp',
    metrics: [
      { value: '165', label: 'products across 11 ranges, rebuilt from the live catalogue' },
      { value: '415', label: 'static pages, every one with an English and a Tamil twin' },
      { value: '449', label: 'interface strings in both languages' },
      { value: '68 KB', label: 'of gzipped JavaScript across the whole site' },
    ],
    techStack: [
      'Astro 5', 'TypeScript', 'Tailwind CSS 4', 'nanostores', 'GSAP', 'Lenis', 'three.js',
      'Blender', 'Cycles', 'rembg', 'OpenCV', 'Playwright',
    ],
  },

  {
    id: 'observex',
    tier: 'more',
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
    poster: '/posters/observex.webp',
    video: '/project-video/observex',
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
    tier: 'more',
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
    poster: '/posters/adraf.webp',
    video: '/project-video/adraf',
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
    tier: 'more',
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
    poster: '/posters/airdraw.webp',
    video: '/project-video/airdraw',
    metrics: [
      { value: '21', label: 'hand landmarks tracked every frame' },
      { value: '3', label: 'gestures: draw, erase and pinch to zoom' },
      { value: '30 FPS', label: 'target camera feed' },
    ],
    techStack: ['Python', 'MediaPipe', 'OpenCV', 'C++', 'Bazel', 'ONNX', 'Flask-SocketIO', 'JavaScript', 'Canvas API'],
  },
];

projects.forEach((p, i) => {
  p.num = String(i + 1).padStart(2, '0');
});

/** Old ids that still arrive through shared links. */
const ALIASES = { ppe: 'constructsafe' };

export const getProject = (id) => projects.find((p) => p.id === (ALIASES[id] ?? id));

/** Metrics that have a real value, in display order. */
export const liveMetrics = (p) => (p.metrics ?? []).filter((m) => m.value !== 'TODO_');
