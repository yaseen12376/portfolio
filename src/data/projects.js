/**
 * Project content.
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
    poster: '/posters/retail-analytics.webp',
    metrics: [
      { value: '2.4×', label: 'faster inference after TensorRT export, counts unchanged' },
      { value: '6', label: 'camera streams batched through one model' },
      { value: '143 FPS', label: 'aggregate throughput on a laptop RTX 3050 Ti' },
      { value: '+8.1%', label: 'track churn from ReID, so it was measured and rejected' },
    ],
    overview:
      'A computer vision platform that turns ordinary store CCTV into footfall, zone, dwell-time and heatmap analytics, links till transactions to the shoppers who made them, and presents it all in a live dashboard. Built one module at a time, with each module validated before the next was started.',
    problem:
      'A store knows what it sold but not how people moved: how many walked in, where they lingered, which zones they ignored, how long the till queue got. Door counters answer one of those questions, need extra hardware at every entrance, and say nothing about behaviour.',
    solution:
      'Reuse the cameras that are already installed. A detector and multi-object tracker follow each shopper, virtual lines and zones turn tracks into entries, exits, dwell and heatmaps, and a probabilistic matcher links POS transactions to shoppers by timestamp. Every tuning decision is measured against a regression set before it ships.',
    implementation: [
      'Built the pipeline on Ultralytics YOLO11 detection and pose with BoT-SORT and ByteTrack tracking, reading from video files, RTSP streams or webcams',
      'Implemented line counting, polygon zones, dwell time and heatmaps, with staff excluded from customer counts',
      'Wrote a POS webhook, vendor adapters and CSV import, plus a correlator that matches till transactions to shoppers with a confidence score',
      'Served events and live stats through FastAPI and WebSockets to a multi-page React dashboard whose zone, line and threshold settings apply while cameras run',
      'Batched detection across cameras (2.38× throughput at six streams) and exported the model to TensorRT (2.4× faster, 0 of 7 test clips changed count)',
      'Added staff enrolment with a consent ledger, security and anomaly detection feeding a human review queue, and customer demographics with coverage figures',
      'Guarded it with pytest, golden-clip count regression, pinned dependencies and GitHub Actions CI',
    ],
    techStack: [
      'Python', 'YOLO11', 'BoT-SORT', 'ByteTrack', 'InsightFace', 'TensorRT', 'OpenCV',
      'FastAPI', 'WebSockets', 'React', 'Recharts', 'PostgreSQL', 'TimescaleDB', 'SQLite',
      'Docker', 'GitHub Actions', 'pytest',
    ],
    outcomes: [
      'Footfall, zone and dwell analytics from cameras the store already owns',
      'Six camera streams on one laptop GPU after batching, above the 15 FPS per-stream target',
      'Model and tracker changes gated by measured regressions, not by intuition',
      'Privacy designed in: a consent ledger for staff and a person reviewing every security flag',
    ],
    limitations: [
      'The 95% counting-accuracy target is not certified yet. It needs store footage counted by hand, which is the next milestone.',
      'Till matching gets less certain as the counter gets busy: 87% confidence with one customer present, 46% with two, 24% with four.',
      'Security alerts are advisory. A person reviews every flag before anything is acted on.',
    ],
  },

  {
    id: 'constructsafe',
    tier: 'featured',
    title: 'ConstructSafe: AI Site Safety Platform',
    short:
      'Construction-site monitoring that flags missing PPE, falls, fire and smoke in real time, and names the worker involved.',
    blurb: 'PPE, falls, fire and faces, watched on every site camera.',
    tags: ['YOLOv8', 'MoveNet', 'ONNX Runtime', 'InsightFace'],
    detail: {
      problem: 'Supervisors cannot watch every camera, and a helmet detector cannot say who is at risk.',
      built: 'Four detectors in one pipeline, naming each violator and filing the evidence.',
      result: '1.31× faster on ONNX Runtime, and the most commits on the team.',
    },
    year: '2026',
    role: 'Detection engine lead',
    team: 'Team of 7 at Ethical Intelligence Technologies',
    private: true,
    // Interim art until the corrected Veo clip lands (docs/image-prompts.md).
    poster: '/posters/constructsafe.svg',
    metrics: [
      { value: '1.31×', label: 'faster inference with ONNX Runtime (97 to 74 ms a frame)' },
      { value: '10', label: 'PPE classes, with a safe or unsafe state per worker' },
      { value: '4', label: 'detectors in one pipeline: PPE, falls, fire and smoke, faces' },
      { value: '40', label: 'commits to the detection engine, the most on the team' },
    ],
    overview:
      'A safety platform for construction sites, built by a team of seven at Ethical Intelligence Technologies. I led the detection engine: the part that watches every camera, decides who is unsafe and why, and produces the evidence. The wider product adds a React dashboard, camera management, alert history and recorded-video playback.',
    problem:
      'Site safety is checked by supervisors walking the site, so most of it goes unobserved most of the time. A helmet-only detector is not enough either. It cannot say who is at risk, and it misses the incidents that matter most, like a worker falling or a fire starting.',
    solution:
      'Run several specialised models on each stream at once and merge them into one alert pipeline. A PPE detector classifies every worker as safe or unsafe, a pose model scores falls, a fire and smoke model watches the background, and face recognition attaches a name to each violation. Alerts are rate-limited, stored with evidence and pushed to the dashboard live.',
    implementation: [
      'Ran YOLOv8 PPE detection across 10 classes (hard hat, mask, vest and their violations) to label each worker safe or unsafe',
      'Rewrote fall detection on MoveNet pose estimation: 17 keypoints feeding a six-factor score, replacing a bounding-box heuristic',
      'Integrated a team-trained YOLO fire and smoke model into the same per-frame pipeline',
      'Added InsightFace recognition so every violation is attributed to a named worker',
      'Built alert cooldowns, annotated evidence screenshots, JSON event logs and asynchronous AWS S3 upload',
      'Exported models to ONNX Runtime with CUDA and a CPU fallback: 1.31× faster than PyTorch on the same hardware',
      'Added continuous H.264 recording, then HLS history retrieval, clip stitching and camera IDs on alerts in the product backend',
    ],
    techStack: [
      'Python', 'YOLOv8', 'MoveNet', 'InsightFace', 'ONNX Runtime', 'CUDA', 'OpenCV',
      'Flask-SocketIO', 'React', 'TypeScript', 'PostgreSQL', 'AWS S3', 'HLS',
    ],
    outcomes: [
      'One pipeline covering helmets, vests, falls, fire and smoke instead of four separate tools',
      'Violations tied to a named worker, with an annotated screenshot as evidence',
      'An alert stream kept actionable by per-person cooldowns',
      'Recorded footage retrievable from the dashboard for any past alert',
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
    poster: '/posters/courier.svg',
    metrics: [
      { value: '16', label: 'MVC controllers over 18 services' },
      { value: '4×', label: 'daily background sync with the courier network' },
      { value: '5', label: 'failed logins before lockout, plus rate limiting' },
      { value: '21k', label: 'lines of C# and Razor' },
    ],
    overview:
      'Operations software for a franchise of a national courier company. Counter staff book consignments, print receipts with barcodes, collect cash on delivery and track shipments, while the owner gets income, expense and branch reports. Built for a paying client, and I wrote most of it.',
    problem:
      'Bookings lived in a legacy SQL Server database with no modern front end. The franchise needed fast booking at the counter, automatic updates for customers, and income, expense and branch reporting in one place, without breaking anything that already read from the old database.',
    solution:
      'A secure ASP.NET Core web app on its own database that copies every booking into the legacy system, so existing processes keep working. Receipts, barcodes and Excel reports are generated on the server, customers get WhatsApp and SMS notifications, and a background service syncs with the courier network four times a day.',
    implementation: [
      'Built 16 MVC controllers over 18 services: bookings and bulk bookings, customers, branches, pricing slabs and PIN-code lookup',
      'Ran EF Core on its own database while mirroring every booking into the franchise’s legacy SQL Server',
      'Generated PDF receipts with QuestPDF, barcodes with ZXing and Excel exports with ClosedXML',
      'Integrated the WhatsApp Cloud API and MSG91 SMS for customer notifications, and Tesseract.js OCR for data entry',
      'Added operations tooling: consignment-note stock, cash on delivery, manifests, exceptions and sync health',
      'Secured it with ASP.NET Identity: login required by default, lockout after 5 failed attempts, login rate limiting and an audit log',
      'Handled GST and Indian number and date formats, with a mobile-friendly layout for counter staff',
    ],
    techStack: [
      'C#', 'ASP.NET Core 8', 'Razor', 'EF Core', 'SQLite', 'SQL Server', 'ASP.NET Identity',
      'QuestPDF', 'ZXing', 'ClosedXML', 'WhatsApp Cloud API', 'MSG91', 'Tesseract.js',
    ],
    outcomes: [
      'Booking, billing, tracking and reporting in one system',
      'The legacy database kept in sync, so nothing downstream had to change',
      'Customers notified automatically over WhatsApp and SMS',
      'Revenue and branch reports exported to Excel on demand',
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
    overview:
      'An attendance platform that reads existing CCTV infrastructure rather than requiring new hardware, recognising faces as people walk past and recording arrivals and departures without anyone stopping to check in.',
    problem:
      'Manual attendance is slow, error-prone and trivially defeated by proxy sign-ins. Badge and biometric readers solve accuracy but create queues at the door and need dedicated hardware at every entrance.',
    solution:
      'Point the system at the cameras already installed. Faces are detected and embedded as they pass, matched against an enrolled database, and logged with a timestamp, with no interaction required. A second camera distinguishes entry from exit, so the record reflects presence rather than just first sighting.',
    implementation: [
      'Built the recognition pipeline on InsightFace: RetinaFace and SCRFD detection, with ArcFace embeddings matched by cosine similarity at a 0.4 threshold',
      'Ingested two RTSP CCTV streams, one for check-in and one for check-out',
      'Derived entry versus exit from which camera produced the sighting, with a cooldown so a person lingering in frame is recorded once',
      'Generated daily Excel and CSV attendance and time-tracking exports',
      'Served a FastAPI web app with JWT authentication (python-jose and bcrypt) for enrolment and live monitoring',
    ],
    techStack: ['Python', 'InsightFace', 'ArcFace', 'OpenCV', 'FastAPI', 'JWT', 'NumPy', 'Pandas', 'openpyxl'],
    outcomes: [
      'Attendance captured passively from existing cameras, with no queue and no new hardware',
      'Proxy attendance eliminated, since presence is verified by face rather than by credential',
      'Entry and exit both recorded, giving actual duration instead of a single check-in',
      'Reports generated automatically each day in formats staff already use',
    ],
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
    overview:
      'An indoor positioning system built on Bluetooth Low Energy beacons and MQTT messaging, giving live location awareness inside buildings where satellite positioning is unavailable.',
    problem:
      'GPS does not work indoors. Warehouses, hospitals and offices, exactly the places where knowing where equipment and people are matters most, have no reliable positioning layer at all.',
    solution:
      'A mesh of BLE beacons whose received signal strength is used to estimate distance, with trilateration resolving those distances into a position. MQTT carries readings from edge devices to a central server that computes location and renders it live on a floor plan.',
    implementation: [
      'Deployed a BLE beacon mesh with placement tuned for overlapping coverage across the target floor',
      'Implemented RSSI-based trilateration with Kalman filtering to suppress the noise inherent in radio signal strength',
      'Built MQTT broker and subscriber architecture for lightweight real-time ingestion from constrained devices',
      'Wrote the position-computation and data-management backend, plus movement analysis over the resulting tracks',
      'Created a web floor-plan visualisation that updates positions live',
    ],
    metrics: [
      { value: '±3 m', label: 'Positioning accuracy' },
      { value: 'BLE', label: 'RSSI trilateration' },
      { value: 'Kalman', label: 'Noise filtering' },
      { value: 'TODO_', label: 'Number of beacons deployed' },
    ],
    techStack: ['BLE Beacons', 'ESP32', 'MQTT', 'Python', 'Node.js', 'WebSocket', 'Kalman Filter'],
    outcomes: [
      'Real-time tracking accuracy of approximately 3 metres in enclosed environments',
      'Live position rendering on interactive floor plans',
      'Architecture scales to many tracked entities without redesign',
      'Low-power beacon hardware gives long battery life between service visits',
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
    overview:
      'An investor-facing product site for ObserveX, an AI home security system built on behavioural threat detection: reading intent from how a person moves and lingers rather than simply recording that they were there.',
    problem:
      'Conventional CCTV is reactive. It produces evidence for after a break-in has already happened, which is useful to an insurer and almost useless to the homeowner. The pitch needed a site that made the proactive-versus-reactive distinction land immediately, for an audience deciding whether to fund it.',
    solution:
      'A cinematic single-page experience that leads with the problem, contrasts traditional CCTV against behavioural analysis directly, then walks through how detection works, what the product looks like in use, and why it is defensible, closing on a demo booking form.',
    implementation: [
      'Built on React 19 and TypeScript with Tailwind CSS 4, using the OKLCH colour format for perceptually even gradients',
      'Choreographed scroll-triggered reveals, hover states and continuous ambient motion with Framer Motion',
      'Designed a glassmorphic interface language over deep navy, with cyan, purple and emerald accents',
      'Composed twelve sections including an animated how-it-works flow, dashboard preview and statistics counters',
      'Integrated Three.js and React Three Fiber for 3D capability, with shadcn/ui for accessible primitives',
      'Implemented a validated lead-capture demo booking flow with confirmation state',
    ],
    metrics: [
      { value: '12', label: 'Composed sections' },
      { value: 'React 19', label: 'TypeScript + Tailwind 4' },
      { value: 'R3F', label: 'Three.js integration' },
    ],
    techStack: ['React 19', 'TypeScript', 'Tailwind CSS 4', 'Framer Motion', 'Three.js', 'shadcn/ui', 'Vite'],
    outcomes: [
      'A pitch surface that reads as a funded startup rather than a student project',
      'The proactive-versus-reactive argument made visually, in the first screen',
      'Mobile-first responsive behaviour across all twelve sections',
      'Reusable component system built on accessible primitives',
    ],
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
    overview:
      'A detection framework that authenticates video and image content in real time, identifying synthetic media by the artefacts generation leaves behind rather than by anything visible to a viewer.',
    problem:
      'Deepfake generation has outpaced human ability to detect it. Identity fraud and misinformation both now scale trivially, and conventional authentication has no way to distinguish a genuine face from a generated one.',
    solution:
      'Stack several independent signals rather than relying on one classifier. Facial landmark analysis catches geometric inconsistency, temporal analysis catches the frame-to-frame instability generators struggle to maintain, and a CNN classifier catches compression and lighting artefacts specific to synthesis.',
    implementation: [
      'Trained a CNN binary classifier across diverse deepfake datasets including FaceForensics++ and Celeb-DF',
      'Implemented real-time face detection and tracking with MTCNN and dlib',
      'Built a temporal analysis module targeting inter-frame inconsistencies characteristic of generated video',
      'Exposed the pipeline through a Flask REST API for integration with existing systems',
      'Developed a monitoring dashboard for live authentication results and alerting',
    ],
    metrics: [
      { value: '2', label: 'Benchmark datasets' },
      { value: '3', label: 'Independent detection signals' },
      { value: 'TODO_', label: 'Accuracy on FaceForensics++' },
      { value: 'TODO_', label: 'Accuracy on Celeb-DF' },
    ],
    techStack: ['Python', 'TensorFlow', 'Keras', 'OpenCV', 'Flask', 'NumPy', 'dlib', 'MTCNN'],
    outcomes: [
      'Strong detection accuracy across multiple independent benchmark datasets',
      'Real-time throughput sufficient for live video streams',
      'Modular design allowing integration into third-party platforms',
      'Full audit trail retained for every authentication event',
    ],
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
    poster: '/posters/airdraw.svg',
    metrics: [
      { value: '21', label: 'hand landmarks tracked every frame' },
      { value: '3', label: 'gestures: draw, erase and pinch to zoom' },
      { value: '30 FPS', label: 'target camera feed' },
    ],
    overview:
      'A gesture-controlled drawing app. A webcam tracks one hand, the app recognises what the hand is doing, and strokes appear on a canvas in the browser with no mouse or touch involved.',
    problem:
      'Hand-tracking demos are easy to start and hard to make feel right. Raw landmarks jitter, gestures misfire between frames, and doing everything in Python adds latency that makes drawing feel laggy.',
    solution:
      'Recognise gestures from finger states and pinch distance across 21 landmarks, smooth the cursor, and stream results to the browser over Socket.IO. To cut latency further, a C++ bridge runs MediaPipe on the GPU and receives frames over TCP.',
    implementation: [
      'Tracked 21 hand landmarks with the MediaPipe Tasks Hand Landmarker, falling back to MediaPipe Solutions where available',
      'Classified draw, erase and pinch-zoom gestures from finger states and pinch distance, with cursor smoothing',
      'Streamed gesture events to a browser canvas over Flask-SocketIO, with adjustable brush and eraser sizes and PNG export',
      'Built a C++ MediaPipe bridge with Bazel that runs on the GPU inside WSL and receives frames over a TCP relay',
      'Testing ONNX palm and hand models as a lighter alternative pipeline',
    ],
    techStack: ['Python', 'MediaPipe', 'OpenCV', 'C++', 'Bazel', 'ONNX', 'Flask-SocketIO', 'JavaScript', 'Canvas API'],
    outcomes: [
      'Draw, erase and zoom working end to end from an ordinary webcam',
      'A GPU path in C++ being brought up to take the heaviest step out of Python',
    ],
    limitations: ['Work in progress. The C++ GPU bridge is not yet the default path.'],
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
