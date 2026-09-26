/**
 * The case studies' long-form copy, keyed by project id: what a case study
 * reads and nothing on the home page needs. It is its own chunk, fetched when
 * the browser is idle after load (or on the first open), so the entry bundle
 * carries only what the cards show. Same rules as projects.js: facts from the
 * repositories, no em or en dashes.
 */
export const caseCopy = {
  'retail-analytics': {
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

  'constructsafe': {
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
    outcomes: [
      'One pipeline covering helmets, vests, falls, fire and smoke instead of four separate tools',
      'Violations tied to a named worker, with an annotated screenshot as evidence',
      'An alert stream kept actionable by per-person cooldowns',
      'Recorded footage retrievable from the dashboard for any past alert',
    ],
  },

  'finmind': {
    overview:
      'A personal-finance mentor for Indian savers: FIRE planning, a money health score, a tax regime wizard, life events, a couples’ planner, a portfolio X-ray and a scam shield. Every rupee figure comes from a deterministic Java engine, the explanation comes from a local LLM grounded in official documents, and a safety layer checks both before anything is shown.',
    problem:
      'Ask a general chatbot about tax and it produces confident numbers it cannot justify. For money advice that is the worst possible failure: a wrong figure that reads as authoritative. Sending a person’s finances to a cloud model is a second problem.',
    solution:
      'Split the work. A calculation engine driven by versioned rules produces every number, with its steps. Hybrid retrieval finds the official passages that support them. A small local model only writes the explanation, and a safety layer rejects any answer whose figures, citations, structure or product mentions do not check out.',
    implementation: [
      'Rebuilt the backend as a seven-stage Spring Boot pipeline (input, memory, calculation, retrieval, context, local LLM, safety), streamed to the React UI stage by stage over server-sent events',
      'Wrote the calculation engine in Java from versioned rules files for the 2025-26 and 2026-27 tax years, each value carrying its source and the date it was verified',
      'Retrieved from 113 passages across 4 official Income Tax Department and SEBI documents, fusing Qdrant vector search with SQLite FTS5 keyword search by reciprocal-rank fusion',
      'Ran qwen3.5:4b locally through Ollama and Spring AI, so a person’s finances never leave the machine',
      'Checked every answer five ways: citations, every ₹ figure traced to the engine, output structure, no named fund houses, and agreement with the calculator. A failing answer gets one retry told exactly which figures it may use, then falls back to the calculator’s own explanation',
      'Projected FIRE plans over 1,000 Monte Carlo market scenarios, and explained answers in Hindi, Telugu and Tamil as well as English',
      'Measured every stage: 37 ms for calculation, 222 ms for retrieval, 5.3 s for the LLM and 6 ms for the safety checks',
    ],
    outcomes: [
      'Every rupee figure traceable to a calculation step, never to the model',
      'Advice grounded in Income Tax Department and SEBI documents, with citations checked',
      'A 0 to 100 trust score on every answer, built from the five checks',
      'A person’s finances stay on their own machine',
    ],
    limitations: [
      'The tax engine covers resident individuals under 60 with salary income. Capital gains are not modelled yet.',
      'Explanations come from a 4B-parameter model. The safety layer guards the numbers, not the wording, which is weakest in Indian languages.',
      'Educational guidance, not investment, tax or legal advice.',
    ],
  },

  'courier': {
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
    outcomes: [
      'Booking, billing, tracking and reporting in one system',
      'The legacy database kept in sync, so nothing downstream had to change',
      'Customers notified automatically over WhatsApp and SMS',
      'Revenue and branch reports exported to Excel on demand',
    ],
  },

  'attendance': {
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
    outcomes: [
      'Attendance captured passively from existing cameras, with no queue and no new hardware',
      'Proxy attendance eliminated, since presence is verified by face rather than by credential',
      'Entry and exit both recorded, giving actual duration instead of a single check-in',
      'Reports generated automatically each day in formats staff already use',
    ],
  },

  'indoor-tracking': {
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
    outcomes: [
      'Real-time tracking accuracy of approximately 3 metres in enclosed environments',
      'Live position rendering on interactive floor plans',
      'Architecture scales to many tracked entities without redesign',
      'Low-power beacon hardware gives long battery life between service visits',
    ],
  },

  'kps-cleano': {
    overview:
      'A redesign of kpscleano.com, the storefront of a cleaning-products brand in Tamil Nadu. The full catalogue is scraped and rebuilt as a static bilingual site, product photos are cut out automatically, and the home page has a doorstep modelled in Blender that visitors clean, step by step, with the brand’s own products.',
    problem:
      'The shop’s catalogue lived in an OpenCart site with small, logo-stamped photos, and a shop in Tamil Nadu serves customers in Tamil as well as English. It needed to be fast on ordinary phones, easy to browse in either language, and to make household products interesting to look at.',
    solution:
      'Generate everything from the live catalogue into a static Astro site with a Tamil twin for every page. Cut every product out of its photo, give each range its own colour, and turn the home page into a small 3D doorstep where each cleaning step uses a real product.',
    implementation: [
      'Scraped the live catalogue and generated 165 products in 11 ranges into typed data, rebuilt with one command',
      'Built every page twice, English and Tamil, with hreflang alternates, 449 typed interface strings and a Tamil product lexicon',
      'Cut out product photos with rembg, falling back to OpenCV GrabCut, and erased the baked-in logo: 164 of 165 products have a cutout',
      'Modelled and lit a Tamil Nadu doorstep in Blender and Cycles, baked its light, and ran it live in three.js, loaded only when a visitor scrolls near it',
      'Kept the cart and wishlist in nanostores, with GSAP and Lenis for motion, and app-style navigation on phones',
      'Tested it with 125 Playwright checks covering flows, both languages, motion and the 3D scene',
    ],
    outcomes: [
      'Every page available in English and Tamil, one tap apart',
      'Pages of 14 to 36 KB gzipped, first paint around 0.2 s on desktop',
      'The 3D doorstep costs nothing until a visitor scrolls to it',
      'A catalogue that regenerates from the live shop instead of being edited by hand',
    ],
    limitations: ['A concept, not the live shop. The Tamil copy still needs a native speaker’s review.'],
  },

  'observex': {
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
    outcomes: [
      'A pitch surface that reads as a funded startup rather than a student project',
      'The proactive-versus-reactive argument made visually, in the first screen',
      'Mobile-first responsive behaviour across all twelve sections',
      'Reusable component system built on accessible primitives',
    ],
  },

  'adraf': {
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
    outcomes: [
      'Strong detection accuracy across multiple independent benchmark datasets',
      'Real-time throughput sufficient for live video streams',
      'Modular design allowing integration into third-party platforms',
      'Full audit trail retained for every authentication event',
    ],
  },

  'airdraw': {
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
    outcomes: [
      'Draw, erase and zoom working end to end from an ordinary webcam',
      'A GPU path in C++ being brought up to take the heaviest step out of Python',
    ],
    limitations: ['Work in progress. The C++ GPU bridge is not yet the default path.'],
  },
};
