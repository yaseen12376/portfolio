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
    'Added camera health checks (covered, knocked, blurred), static-object suppression and IGNORE zones for mannequins, a store plan that maps coverage and blind spots, walkout and unattended-till measures, and a 07:00 report of what needs attention',
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
      'Batching moves 2 of 82 line crossings on the test clips, so it stays off on entrance cameras until it has been checked against the store’s own footage.',
      'Security alerts are advisory. A person reviews every flag before anything is acted on.',
    ],
  },

  'constructsafe': {
    overview:
      'A safety platform for construction sites, built by a team of seven at Ethical Intelligence Technologies. I led the detection engine: the part that watches every camera, decides who is unsafe and why, and produces the evidence. The wider product adds a React dashboard, camera management, alert history and recorded-video playback.',
    problem:
      'Site safety is checked by supervisors walking the site, so most of it goes unobserved most of the time. A helmet-only detector is not enough either. It cannot say who is at risk, and it misses the incidents that matter most, like a worker falling or a fire starting.',
    solution:
      'Give each camera a detection mode and run every mode through one alert pipeline. A PPE detector classifies each worker as safe or unsafe, a pose model scores falls, a fire and smoke model watches the whole frame, and face recognition matches faces to enrolled workers in the live view. Alerts are rate-limited per camera, stored with a screenshot as evidence and pushed to the dashboard live.',
    implementation: [
      'Ran YOLOv8 PPE detection across 10 classes (hard hat, mask, vest and their violations) on each person found, to label every worker safe or unsafe',
      'Rewrote fall detection on MoveNet pose estimation: 17 keypoints and four rules scored out of 6, a fall at 4, replacing a bounding-box heuristic',
      'Integrated a team-trained YOLO fire and smoke model into the same per-frame pipeline',
      'Added InsightFace recognition, matching faces in the live view to enrolled workers, with anyone else labelled Unknown',
      'Built alert cooldowns (10 s per camera and alert type), annotated evidence screenshots, JSON event logs and asynchronous AWS S3 upload',
      'Exported models to ONNX Runtime, with CUDA and a CPU fallback: 1.31× faster than PyTorch in an export benchmark (YOLOv8s on CPU, 97 to 74 ms a frame)',
      'Added continuous H.264 recording, then HLS playback with 12 hours of rewind, clip stitching and camera IDs on alerts in the product backend',
    ],
    outcomes: [
      'One pipeline covering helmets, masks, vests, falls, fire and smoke instead of four separate tools',
      'Faces in the live view matched to enrolled workers, and an annotated screenshot kept for every alert',
      'An alert stream kept actionable by a 10 s cooldown per camera and alert type',
      'Recorded footage retrievable from the dashboard for the last 12 hours',
    ],
    limitations: [
      'A mask the camera cannot see, on someone facing away, counts as missing, so a turned head reads as a violation.',
      'Falls and fires are each raised on a single frame, with nothing to confirm them over time.',
      'Fall detection scores one pose a frame, the most prominent person’s, so it follows one person at a time.',
      'Only enrolled workers are named; everyone else stays Unknown.',
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
      'Retrieved from 113 passages across the 4 official Income Tax Department and SEBI documents ingested so far, fusing Qdrant vector search with SQLite FTS5 keyword search by reciprocal-rank fusion',
      'Ran qwen3.5:4b locally through Ollama and Spring AI, so a person’s finances never leave the machine',
      'Checked every answer five ways: citations, every ₹ figure traced to the engine, output structure, no named fund houses, and agreement with the calculator. A planner’s failing answer gets one retry told exactly which figures it may use, then falls back to the calculator’s own explanation; the Tax Wizard’s streamed chat shows a failed check as a warning instead',
      'Projected FIRE plans over 1,000 Monte Carlo market scenarios, and explained answers in Hindi, Telugu and Tamil as well as English',
      'Measured every stage on a FIRE plan: 37 ms for calculation, 222 ms for retrieval, 5.3 s for the LLM and 6 ms for the safety checks',
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
      'Retrieval covers four official documents so far.',
      'Educational guidance, not investment, tax or legal advice.',
    ],
  },

  'claims-workbench': {
    overview:
      'A claims workbench for commercial property claims that runs on one laptop, built to an insurance technology client’s product specification. Local vision models read the claim file and cite every value back to a page and a line, deterministic rules check it, and people make every decision. A colleague ran the client engagement and I built the software. What is shown here is the demo build, on synthetic claims.',
    problem:
      'A commercial property claim arrives as a folder of PDFs, scans, damage photos, estimates and invoices. Someone has to read all of it, reconcile the adjuster with the first notice of loss, catch the line billed twice, work out the settlement and get it approved. The file is also not something that can be sent to a model in the cloud.',
    solution:
      'Keep the models on the machine and never let them decide. Vision models running in Ollama classify each document and extract its fields, and every value must point at the line it came from or it is shown as missing, not guessed. Rules then check coverage, the estimate, invoices and prior payments. The settlement is calculated in exact decimals under a versioned rule set and signed off through an approval chain with authority limits. AI output is never overwritten: corrections sit next to it, and every change writes an audit event.',
    implementation: [
      'Built intake: checksums and duplicate checks, OCR, photo metadata and perceptual hashes, and splitting a long file into its documents (27 of 27 parts found on the test file)',
      'Ran classification and extraction on local Qwen vision models through Ollama on a 4 GB laptop GPU, with each extracted value checked against the text of the line it cites',
      'Verified table rows by arithmetic, quantity times unit price against the total, and drew damage boxes onto photos, merging repeats of the same spot',
      'Wrote rule families for adjuster findings, coverage, the estimate, financials and settlement, each raising flags that a reviewer confirms or dismisses',
      'Calculated settlements in Decimal end to end, storing the rule-set version, an input snapshot and the ordered steps, so a result goes stale when an input changes',
      'Built a three-level approval chain with authority limits and segregation of duties, then payment, closure, a PDF report and a claim pack with checksums',
      'Built the React 19 workbench: eight workflow stages, a document viewer that lights up the cited line, and an audit trail behind every decision',
      'Covered it with 109 automated tests and an extraction evaluation run against the synthetic set',
    ],
    outcomes: [
      'Field accuracy 0.987 and table-cell accuracy 0.9955 on the synthetic evaluation set, with every document classified correctly',
      'Extraction at 16.1 s a page, down from 69.1 s, on a laptop RTX 3050 Ti',
      'A demo claim taken from intake to a signed-off settlement, a report and a claim pack without the file leaving the machine',
      'Every figure on screen traceable to a page and line, a rule, or a named reviewer',
    ],
    limitations: [
      'Measured on synthetic documents only. Accuracy on real claim files has not been established.',
      'Photo analysis describes visible damage. It never states cause, coverage or safety, and its authenticity checks are prompts for a reviewer, not findings.',
      'The settlement rule set is a demo methodology, not one a carrier has approved.',
      'A demo build: it has not been used on live claims.',
    ],
  },

  'athletevision': {
    overview:
      'AthleteVision runs the SAI fitness test battery on one phone with no internet, following the KHOJ Talent Hunt Technical Handbook. It is a Next.js app inside a Capacitor shell: the camera measures eight of the ten tests, a coach types or times the other two, and every attempt is saved with its video. Built by a team of three for a hackathon. I wrote the test analyzers, the capture stack and the native Android pose engine.',
    problem:
      'The battery is ten tests: height, weight, sit and reach, two jumps, a medicine ball throw, a 30 m run, a shuttle run, sit-ups and an 800 m run. Each has its own setup, its own fouls and its own way of being measured. The phone doing the measuring has no network to lean on, and it will not sit perfectly still on its stand.',
    solution:
      'Give each test its own analyzer on top of MediaPipe pose landmarks, and make the setup forgiving. Tape marks are tapped once and then follow the picture as the phone moves. The pose model runs natively on Android with the WebView as a fallback, and each phone times its own GPU and CPU paths and keeps the faster one. Every result carries its method, its quality and a saved clip.',
    implementation: [
      'Wrote the analyzers for the eight filmed tests: head top against wall marks, the furthest two-second reach, jump reach with flight time as a cross-check, heel landing distance with foul checks, and a ball tracked with a gravity prediction',
      'Timed the 30 m run from first movement to the chest crossing the line, and the 4 × 10 m shuttle with its three hand touches and four splits',
      'Counted sit-ups live over 45 seconds at the moment the elbows touch the knees, each one judged against the handbook’s three fouls',
      'Kept calibration marks in place with the motion sensors while the phone turns, then found each mark again in the picture once it settles; an attempt stops if the phone moves',
      'Moved the camera and both pose models to native Android (CameraX and MediaPipe’s Android library), with the WebView path as a fallback and a per-phone choice between GPU and CPU',
      'Built the report card: best result per test, a percentile and band against athletes tested on the same phone, a BMI category from the WHO 2007 reference, and the saved clip with an annotated still',
      'Kept everything on the phone in IndexedDB behind consent and an audit log, with a content security policy that blocks outside connections',
      'Checked the analyzers and the mark-following code against synthetic sequences with one command',
    ],
    outcomes: [
      'All ten tests of the battery in one offline app, in English, Hindi and Tamil',
      'Pose 2.7 to 3.7 times faster on native Android than in the WebView on a budget Galaxy A17 5G: 47 to 64 ms a frame against 140 to 174 ms',
      'On synthetic sequences: height within 0.6 cm, broad jump within 2 cm, medicine ball within 0.12 m',
      'Every attempt kept as video evidence, with the deciding frame marked',
    ],
    limitations: [
      'The accuracy figures come from synthetic landmark sequences, not from athletes. Validation on real video is still to be done.',
      'Android is the tested target. The iOS shell is written but has not been compiled.',
      'Percentiles are local to the phone: one appears once ten athletes of the same sex and age have been tested on it.',
      'No login, backend or cloud sync in this build.',
    ],
  },

  'neernaadi': {
    overview:
      'NeerNaadi is an open report network for floods and water problems in Chennai; its web app was renamed Aroli during the event. A resident reports on WhatsApp, Telegram or the web, and the report becomes a public ticket on a city map with a tamper-evident history. Ten open reports within 500 m raise a red zone, and ward engineers get an advice card that says what to check and fix first, citing past floods and the city’s drain survey. Built by a team for the 36-hour BUILDX Hackathon. I built the data pipeline, the advisor’s evidence and guards, the local AI, and the 3D.',
    problem:
      'In a Chennai monsoon, reports of waterlogged streets, blocked drains and closed subways arrive through separate helplines and posts. Nobody sees one street collecting reports at once, and the engineer sent out starts with no history: which drains run under that road, whether it flooded in the last cyclone, and what was done about it then.',
    solution:
      'Make every report a public ticket, and give the people who fix things evidence instead of guesses. The pipeline joins the GCC stormwater drain survey, the city’s official lists of vulnerable points and dated news from ten floods into one data contract. The advisor writes each card from that evidence first, as a template with a citation on every line. A language model may only rewrite it: a rewritten line that brings in a new number or loses a drain record falls back to the template, and citations to sources it was not given are dropped.',
    implementation: [
      'Built a ground-truth table of 272 dated, place-named flood reports from the news, Cyclone Vardah in 2016 to Cyclone Murasu in 2026: one row per place, day and source, each with its link, a severity and a confidence',
      'Cleaned the GCC drain survey from 10,276 records into 19,947 segments of at most 150 m and a network graph, with plain facts per segment: no mapped outfall, dead ends, adverse slope, flat gradient, recorded obstacles and condition',
      'Placed news reports through a gazetteer of OSM names (Tamil included), drain street names, wards and subways; a weak or ambiguous match is held for review and never put on the map',
      'Found repeat-flooding hotspots with DBSCAN at 150 m, computed strictly as of a cutoff date so a backtest never sees a later flood, and gridded the city into H3 cells with ground height, population and tree cover',
      'Wrote the advisor’s evidence pack and template card: past cases nearby, standard fixes, the drains within reach with their defects by record number, and open tickets within 500 m, in English and Tamil',
      'Guarded every model rewrite: citations limited to the supplied ids, every number checked against the sources (Tamil digits too), drain numbers and required steps kept, and phone numbers removed before any text reaches a model',
      'Ran the AI locally on a 4 GB laptop GPU through Ollama: Qwen 3.5 4B for quick drafts, a tuned Gemma 4 12B for red-zone cards and Tamil when idle, and bge-m3 embeddings on the CPU, with Gemini as a hosted backup and a job queue in Convex',
      'Modelled the 3D by script in Blender: a cutaway of a 14 m Chennai street showing the box drain, water main and sewer in seven fault states, and a city diorama with a cyclone coming in, as a seamless loop',
    ],
    outcomes: [
      'A public ticket map of Chennai with red zones, where each ticket and zone gets an advice card in English and Tamil that cites its sources',
      'The template card needs no model at all: the advisor’s end-to-end tests pass 4 of 4 without one',
      'On the benchmark red-zone card both local models passed every guard, citing only the given sources and inventing no number: Qwen 3.5 4B at 16.2 tokens a second, Gemma 4 12B at 6.4',
      'Behind the advice: 272 news reports, 19,947 drain segments, 6,907 official vulnerable points and 28 subways',
    ],
    limitations: [
      'The tickets in the demo are seeded, not real complaints, so nothing here measures use in a real monsoon.',
      'The local AI worker is written but has not yet been run end to end. Without it, cards come from the template or the Gemini backup.',
      'The news comes mostly from English-language outlets, one of which supplied 181 of the 272 reports, so places named only in the Tamil press are missing.',
      'The Tamil wording has not yet been reviewed by a native speaker.',
    ],
  },

  'mission-builder-3d': {
    overview:
      'A browser game for the NASA Space Apps Challenge 2026, for the challenge "Space Mission Design Game". The player is the mission manager of a Mars lander: choose the rocket, the science tools, the power source and the antenna, pass six launch checks, fly to Mars and keep the lander alive for 20 sols. Built by a team of four, two adults and two school students, with me as technical lead. As the project’s own AI-use statement says, most of the code and the Blender scripts were written with an AI coding assistant, working from the team’s requirements document and reviewed by the adults. It is a student project and is not endorsed by NASA.',
    problem:
      'The game is for players of about 9 to 15, and it has to be honest about three things: dust cuts solar power, a radio signal to Mars takes minutes, and a mission leaves something behind in space. It also had to stay readable for the two students on the team, who must be able to explain the code.',
    solution:
      'Keep the rules in a pure engine with no 3D and no page code, so every rule has a test and the 3D world only shows what the engine decided. Take the numbers from real sources and label each one on screen as NASA, calculated, game credit or assumed. Where the game bends reality, such as playing an 11 minute delay as 11 seconds, it says so.',
    implementation: [
      'Led the build from the team’s requirements document: directed the AI coding sessions over three days and reviewed what they produced with the other adult on the team',
      'Kept the rules in a pure engine: totals, six launch checks and a sol that always runs the same six steps (dust, cleaning, generation, consumption, battery, science and comms), under 281 unit tests with a fixed seed',
      'Used the real Earth to Mars distance on 15 November 2026 from NASA/JPL Horizons, 196,860,092 km, for a signal delay of 10 min 57 s that every command has to wait out',
      'Shipped a three.js world in nine stages, from the briefing and the design hall to launch, the Mars surface and the report, with three picture-quality tiers',
      'Had every 3D model built by the project’s own Blender scripts, with part names shared between the lander model and the game',
      'Added four missions, mission training, eight hands-on tasks (six acted out by the 3D lander), 15 badges and a comparison with Viking 1, Phoenix and InSight',
      'Kept it offline: no network calls while it runs, every asset bundled, every outside source credited',
    ],
    outcomes: [
      'A complete game, from briefing to mission report, that runs in a browser with no network',
      'Every number on screen labelled with where it came from, and a Sources screen generated from the same data',
      '281 passing tests on the engine, so a rule change that breaks the game is caught first',
      'A demo mode that plays a whole mission by itself in under two minutes',
    ],
    limitations: [
      'Dust is sped up and the signal delay is squeezed, and the green score is a game idea, not a NASA measure. The game says all three on screen.',
      'Some on-screen texts are still first drafts waiting for the students’ own words, and are marked as such in the code.',
      'A student project. It is not endorsed by NASA.',
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
      'Point the system at the cameras already installed. Faces are detected and embedded as they pass, matched against an enrolled database, and logged with a timestamp, with no interaction required. A sighting is a check-in and the next one is a check-out, with a cooldown between them, so the record reflects time present rather than just a first sighting.',
    implementation: [
      'Built the recognition pipeline on InsightFace: RetinaFace and SCRFD detection, with ArcFace embeddings matched by cosine similarity at a 0.4 threshold',
      'Read a live RTSP CCTV stream and recognised faces as people walked past',
      'Logged each person as a check-in, then a check-out on their next sighting, with a 60 s cooldown so someone lingering in frame is recorded once',
      'Exported an Excel workbook with a working-hours summary and a detailed in and out log',
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
