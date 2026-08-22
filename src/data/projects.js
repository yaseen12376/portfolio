/**
 * Project content.
 *
 * `metrics` renders as a figures strip on the detail page. Any entry whose
 * value is 'TODO_' is skipped by the renderer — those are the numbers only you
 * can supply (latency on your hardware, mAP from your training run, accuracy on
 * your enrolled set). Filling them in is the single highest-value content
 * change left on this site; recruiters read figures, not adjectives.
 *
 * `video` (optional) is the basename of a panel loop in public/project-video/;
 * the panel plays <id>.webm with an <id>.mp4 fallback, muted, only while that
 * project is the active row, and never on mobile or under reduced motion.
 * Projects without it simply show `poster`.
 *
 * `poster` resolves to the generated SVG by default. To swap in a real render,
 * drop a 1920x1080 WebP at public/posters/<id>.webp and change the one line —
 * see docs/image-prompts.md for the generation spec.
 *
 * `repo` is only set for repositories that are public; private ones are omitted
 * so the UI doesn't render a link that 404s for visitors.
 */
export const projects = [
  {
    id: 'ppe',
    num: '01',
    title: 'PPE Detection System',
    short:
      'Real-time personal protective equipment detection for workplace safety compliance, built during my internship at Ethical Intelligence Technologies.',
    tags: ['Python', 'YOLOv5', 'OpenCV', 'MQTT', 'IoT'],
    year: '2025',
    accent: 'teal',
    poster: '/posters/ppe.svg',
    overview:
      'A computer vision safety monitoring system that detects workers and verifies correct use of personal protective equipment across industrial sites, turning intermittent manual spot-checks into continuous automated coverage.',
    problem:
      'Workplace safety violations are a leading cause of industrial accidents, but PPE compliance is normally checked by a supervisor walking the floor. That is inconsistent, labour-intensive, and leaves most of a facility unobserved most of the time.',
    solution:
      'A real-time object detection pipeline that identifies people and the protective equipment they are — or are not — wearing, matches equipment to individuals, raises an alert the moment a violation occurs, and keeps a compliance record that can be audited afterwards.',
    implementation: [
      'Fine-tuned a YOLOv5 detector on a custom PPE dataset spanning helmets, vests, gloves and goggles',
      'Built multi-camera stream ingestion so a single deployment covers an entire facility',
      'Wired MQTT publish/subscribe messaging for low-latency violation alerts to downstream systems',
      'Applied image pre-processing and object tracking to hold identity stable across frames',
      'Optimised the inference pipeline for edge hardware, trading model size against detection latency',
    ],
    metrics: [
      { value: '4', label: 'PPE classes detected' },
      { value: 'Multi-cam', label: 'Facility coverage' },
      { value: 'TODO_', label: 'Inference latency (ms) — measure on your hardware' },
      { value: 'TODO_', label: 'mAP@0.5 from your training run' },
    ],
    techStack: ['Python', 'YOLOv5', 'PyTorch', 'OpenCV', 'MQTT', 'NumPy', 'Docker'],
    outcomes: [
      'Continuous automated monitoring in place of periodic manual inspection',
      'Violation alerts delivered in real time rather than discovered after the fact',
      'Compliance history retained for safety audits and reporting',
      'Runs on constrained edge hardware, keeping video on-site instead of in the cloud',
    ],
  },

  {
    id: 'constructsafe',
    num: '02',
    title: 'ConstructSafe — Site Safety Monitoring',
    short:
      'Dual-model YOLOv8 helmet compliance system that not only flags unsafe workers but identifies them by name using face recognition.',
    tags: ['Python', 'YOLOv8', 'InsightFace', 'Flask', 'CUDA'],
    year: '2026',
    accent: 'amber',
    poster: '/posters/constructsafe.svg',
    overview:
      'A construction-site safety system that classifies every person in frame as safe or unsafe based on hard-hat use, then uses face recognition to attach a name to each violation and archive the evidence automatically.',
    problem:
      'A helmet-only detector tells you a hard hat exists somewhere in the frame; it does not tell you who is not wearing one. Single-model approaches also detect people unreliably, because weights trained purely on helmets were never optimised for the person class.',
    solution:
      'Run two detectors in parallel and combine their strengths. Pretrained YOLOv8s on COCO handles person detection, which it does extremely well out of the box, while custom hard-hat weights handle helmets. Spatial proximity matching then associates each detected helmet with a person, and anyone left unmatched is classified as a violation.',
    implementation: [
      'Ran YOLOv8s (COCO) for person detection alongside custom YOLOv8m hard-hat weights, each in its own confidence regime',
      'Implemented proximity-based helmet-to-person association to derive a per-person SAFE/UNSAFE state',
      'Rendered a colour-coded live overlay — green for compliant, red for violation, blue for detected helmets — with running counts',
      'Integrated InsightFace (RetinaFace detection + ArcFace embeddings) to identify violators by name, RRN and branch',
      'Added automatic timestamped screenshot capture on violation, with a per-person cooldown to suppress duplicate alerts',
      'Built CUDA acceleration with graceful CPU fallback, plus a Flask web interface for webcam and video-file sources',
    ],
    metrics: [
      { value: '2', label: 'Detection models in parallel' },
      { value: 'ArcFace', label: 'Violator identification' },
      { value: 'CUDA', label: 'Accelerated, CPU fallback' },
      { value: 'TODO_', label: 'FPS on your GPU' },
    ],
    techStack: ['Python', 'YOLOv8', 'Ultralytics', 'InsightFace', 'ONNX Runtime', 'OpenCV', 'Flask'],
    outcomes: [
      'Reliable person detection where a helmet-only model alone would miss workers entirely',
      'Violations attributed to a named individual instead of an anonymous bounding box',
      'Evidence captured automatically, without a supervisor present to record it',
      'Cooldown logic keeps the alert stream actionable rather than flooding it with repeats',
    ],
  },

  {
    id: 'attendance',
    num: '03',
    title: 'Automated Attendance System',
    short:
      'Face recognition attendance web app running against live CCTV feeds, with dual-camera entry/exit tracking and automatic reporting.',
    tags: ['Python', 'InsightFace', 'Flask', 'CCTV', 'OpenCV'],
    year: '2025',
    accent: 'purple',
    poster: '/posters/attendance.webp',
    video: '/project-video/attendance',
    repo: 'https://github.com/yaseen12376/EIT_FACE_PROJ',
    overview:
      'An attendance platform that reads existing CCTV infrastructure rather than requiring new hardware, recognising faces as people walk past and recording arrivals and departures without anyone stopping to check in.',
    problem:
      'Manual attendance is slow, error-prone and trivially defeated by proxy sign-ins. Badge and biometric readers solve accuracy but create queues at the door and need dedicated hardware at every entrance.',
    solution:
      'Point the system at the cameras already installed. Faces are detected and embedded as they pass, matched against an enrolled database, and logged with a timestamp — no interaction required. A second camera distinguishes entry from exit, so the record reflects presence rather than just first sighting.',
    implementation: [
      'Built a face recognition pipeline on InsightFace, embedding each face and matching against an enrolled student database',
      'Added dual-camera / dual-CCTV support with IP webcam and RTSP stream ingestion',
      'Derived entry versus exit classification from which camera produced the sighting',
      'Implemented a recognition cooldown so a person lingering in frame is recorded once, not continuously',
      'Generated daily CSV and Excel attendance exports keyed by date',
      'Built a Flask web interface with a fullscreen live monitoring view',
    ],
    metrics: [
      { value: '2', label: 'CCTV streams (entry + exit)' },
      { value: 'InsightFace', label: 'Recognition backbone' },
      { value: 'Daily', label: 'CSV + Excel export' },
      { value: 'TODO_', label: 'Recognition accuracy % on your enrolled set' },
    ],
    techStack: ['Python', 'InsightFace', 'OpenCV', 'Flask', 'NumPy', 'Pandas', 'openpyxl'],
    outcomes: [
      'Attendance captured passively from existing cameras — no queue, no new hardware',
      'Proxy attendance eliminated, since presence is verified by face rather than by credential',
      'Entry and exit both recorded, giving actual duration instead of a single check-in',
      'Reports generated automatically each day in formats staff already use',
    ],
  },

  {
    id: 'indoor-tracking',
    num: '04',
    title: 'Indoor Tracking System',
    short:
      'BLE and MQTT indoor positioning for real-time asset and personnel tracking where GPS cannot reach, accurate to roughly 3 metres.',
    tags: ['IoT', 'BLE', 'MQTT', 'ESP32', 'Python'],
    year: '2025',
    accent: 'teal',
    poster: '/posters/indoor-tracking.webp',
    video: '/project-video/indoor-tracking',
    overview:
      'An indoor positioning system built on Bluetooth Low Energy beacons and MQTT messaging, giving live location awareness inside buildings where satellite positioning is unavailable.',
    problem:
      'GPS does not work indoors. Warehouses, hospitals and offices — exactly the places where knowing where equipment and people are matters most — have no reliable positioning layer at all.',
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
    num: '05',
    title: 'ObserveX — Behavioral Threat Detection',
    short:
      'Product site for an AI home security concept built around predicting intent, not replaying footage after a break-in.',
    tags: ['React 19', 'TypeScript', 'Framer Motion', 'Three.js', 'Tailwind 4'],
    year: '2026',
    accent: 'purple',
    poster: '/posters/observex.webp',
    video: '/project-video/observex',
    repo: 'https://github.com/yaseen12376/observex',
    overview:
      'An investor-facing product site for ObserveX, an AI home security system built on behavioural threat detection — reading intent from how a person moves and lingers rather than simply recording that they were there.',
    problem:
      'Conventional CCTV is reactive. It produces evidence for after a break-in has already happened, which is useful to an insurer and almost useless to the homeowner. The pitch needed a site that made the proactive-versus-reactive distinction land immediately, for an audience deciding whether to fund it.',
    solution:
      'A cinematic single-page experience that leads with the problem, contrasts traditional CCTV against behavioural analysis directly, then walks through how detection works, what the product looks like in use, and why it is defensible — closing on a demo booking form.',
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
    num: '06',
    title: 'ADRAF — Deepfake Authentication',
    short:
      'Multi-stage deepfake detection combining facial landmark analysis, temporal consistency checking and CNN classification.',
    tags: ['Python', 'TensorFlow', 'OpenCV', 'Flask', 'Deep Learning'],
    year: '2025',
    accent: 'purple',
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
];

export const getProject = (id) => projects.find((p) => p.id === id);
