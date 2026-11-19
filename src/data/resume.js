/**
 * What the résumé says that the site doesn't already. Everything else on it
 * (name, contact links, experience, skills, every project's title, dates, role
 * and stack) is read from profile.js, experience.js, skills.js and projects.js,
 * so the résumé and the site can never disagree.
 *
 * - `bullets`: one or two lines per project, each with a number the project's
 *   own repository measured. A project without bullets prints its `short` line.
 * - A value of 'TODO_' is a blank the owner has yet to fill. The résumé hides
 *   it (and a certificate with any blank field), as the site does.
 * - No em or en dashes anywhere here: the résumé QA fails on them.
 *
 * After editing anything the résumé prints, run `npm run gen:resume`: the build
 * refuses to ship a PDF that no longer matches this data.
 */
export const resume = {
  summary:
    'AI and computer vision engineer: a final-year B.Tech student in AI and Data Science in Chennai and an intern at Ethical Intelligence Technologies since June 2025. Builds vision systems for real cameras (detection, tracking, face recognition) together with the APIs, dashboards and video infrastructure around them. Measures before optimising, and writes down what did not work.',

  bullets: {
    'retail-analytics': [
      'Turned a clothing franchise’s existing store CCTV into footfall, zone, dwell and heatmap analytics, with YOLO11 detection, BoT-SORT and ByteTrack tracking and a live React dashboard.',
      'Exported the detector to TensorRT for 2.4× faster inference with counts unchanged, batching 6 camera streams through one model at 143 FPS on a laptop RTX 3050 Ti.',
    ],
    constructsafe: [
      'Led the detection engine of a construction-safety platform in a team of 7: YOLOv8 PPE checks across 10 classes, MoveNet fall detection, fire and smoke, and face matching in one pipeline.',
      'An ONNX Runtime export ran 1.31× faster in its benchmark (97 to 74 ms a frame); 40 commits to the engine, the most on the team.',
    ],
    finmind: [
      'Built the backend and AI pipeline of a money mentor on Spring Boot 4 and Spring AI with a local LLM: 7 money tools on one advice pipeline, with retrieval over Qdrant and SQLite FTS5.',
      'Every answer passes 5 safety checks before it is shown; 8 of 8 on the seed retrieval and answer evaluation set.',
    ],
    'claims-workbench': [
      'Built, to a client’s specification, a workbench that reads a commercial property claim file with local vision models, checks it with rules and takes it to a signed-off settlement on one laptop.',
      'On synthetic documents: 0.987 field accuracy with every value cited to its line, extraction cut from 69.1 s to 16.1 s a page on a 4 GB GPU, 3 approval levels and 109 tests.',
    ],
    athletevision: [
      'Wrote the test analyzers, the capture stack and the native Android pose engine of an offline app that runs a ten-test fitness battery on one phone.',
      'Native pose ran 2.7× to 3.7× faster than the WebView on a Galaxy A17 5G; the camera measures 8 of the 10 tests, with no network calls.',
    ],
    neernaadi: [
      'Built the data pipeline and AI advisor of a flood report network for Chennai: 272 news flood reports from 10 events and 19,947 surveyed drain segments, cited on every advice card.',
      'Guarded model rewrites so a number not in the sources falls back to the template; both local models (Qwen 3.5 4B, Gemma 4 12B) passed every guard on a 4 GB laptop GPU.',
    ],
    'mission-builder-3d': [
      'Technical lead of a Mars lander game for the NASA Space Apps Challenge 2026: design a lander, pass six launch checks and keep it alive for 20 sols.',
      'Directed the AI-assisted build and reviewed it with the other adult on the team: a pure rules engine under 281 unit tests, and the real signal delay to Mars (10 min 57 s on 15 Nov 2026, from NASA/JPL Horizons).',
    ],
    courier: [
      'Main developer on booking, billing and tracking software for a courier franchise: ASP.NET Core 8 and EF Core, 16 MVC controllers over 18 services.',
      'Barcode receipts and Excel reports on the server, WhatsApp and SMS notifications, and a sync with the courier network four times a day.',
    ],
    attendance: [
      'Co-built face recognition attendance on live CCTV with InsightFace and ArcFace (0.4 cosine threshold) and a 60 s cooldown, so each person is logged once.',
      'Check-in and check-out logging to Excel reports, behind a JWT-secured FastAPI app for enrolment and monitoring.',
    ],
    'indoor-tracking': [
      'Indoor positioning from BLE beacon signal strength: trilateration with Kalman filtering to about ±3 m, carried over MQTT to a live floor plan.',
    ],
    'kps-cleano': [
      'Rebuilt a cleaning-products brand’s storefront as a static Astro site in English and Tamil: 165 products, 415 pages, 449 interface strings in both languages, 68 KB of gzipped JavaScript.',
    ],
    observex: [
      'Product site for a behavioural threat detection platform: 12 composed sections in React 19, TypeScript and Tailwind CSS 4, with a Three.js scene.',
    ],
    adraf: [
      'Deepfake authentication that stacks 3 independent detection signals, trained across FaceForensics++ and Celeb-DF, with MTCNN and dlib face tracking.',
    ],
    airdraw: [
      'Drawing in the air with a webcam: 21 hand landmarks tracked every frame with MediaPipe, and draw, erase and pinch-to-zoom gestures streamed to the browser.',
    ],
  },

  education: {
    // Printed after the school, with its scale.
    cgpa: '7.7 / 10',
    coursework: 'Machine learning, data preprocessing and analysis, computer vision, databases.',
  },

  certifications: [
    { name: 'TODO_', issuer: 'TODO_', year: 'TODO_' },
    { name: 'TODO_', issuer: 'TODO_', year: 'TODO_' },
  ],
};
