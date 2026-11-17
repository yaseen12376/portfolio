/**
 * Experience and education timeline, rendered by src/sections/experience.js.
 * Points reflect contributions visible in the repositories' git history.
 */
export const experience = [
  {
    org: 'Ethical Intelligence Technologies',
    role: 'AI & Computer Vision Intern',
    period: 'Jun 2025 - Present',
    badge: 'Internship',
    kind: 'work',
    points: [
      {
        title: 'ConstructSafe detection engine',
        body: 'Top contributor to the team’s construction-safety platform: YOLOv8 PPE detection, MoveNet fall detection, face matching to workers in the live view, an ONNX Runtime export (1.31× faster in its benchmark) and S3-backed alert evidence.',
        project: 'constructsafe',
      },
      {
        title: 'Automated attendance',
        body: 'Co-built face recognition attendance on live CCTV with InsightFace and ArcFace, check-in and check-out logging with Excel reports, and a JWT-secured FastAPI app.',
        project: 'attendance',
      },
      {
        title: 'CCTV video infrastructure',
        body: 'Worked on the camera backbone behind the products: RTSP to HLS streaming with a scrub-back DVR window, asynchronous S3 segment upload, and scheduled timelapse capture and export.',
      },
      {
        title: 'Indoor tracking',
        body: 'Built a BLE RSSI and MQTT based indoor positioning system, with Python handling real-time position computation and movement analysis.',
        project: 'indoor-tracking',
      },
    ],
  },
  {
    org: 'Freelance',
    role: 'Full-stack Developer',
    // The claims workbench's commits run to November 2026.
    period: 'Jul 2026 - Nov 2026',
    badge: 'Client work',
    kind: 'work',
    points: [
      {
        title: 'Courier Management System',
        body: 'Main developer on booking, billing and tracking software for a courier franchise in Tamil Nadu: ASP.NET Core 8, EF Core, WhatsApp and SMS notifications, PDF receipts and a legacy SQL Server sync.',
        project: 'courier',
      },
      {
        title: 'Property claim review workbench',
        body: 'Built a claims workbench to an insurance technology client’s specification with a colleague who ran the engagement: local vision models that cite every value, rule checks, an exact-decimal settlement and a three-level approval chain, on FastAPI and React.',
        project: 'claims-workbench',
      },
    ],
  },
  {
    org: 'Hackathons',
    role: 'Team builds',
    period: 'Nov 2026',
    badge: 'Hackathon',
    kind: 'work',
    points: [
      {
        title: 'Mission Builder 3D',
        body: 'Technical lead on a Mars lander mission game for the NASA Space Apps Challenge 2026, in a team of two adults and two school students: a tested rules engine, a three.js world and script-built Blender models.',
        project: 'mission-builder-3d',
      },
      {
        title: 'AthleteVision',
        body: 'Wrote the test analyzers, the capture stack and the native Android pose engine for an offline app that runs a ten-test fitness battery on one phone, in a team of three.',
        project: 'athletevision',
      },
    ],
  },
  {
    org: 'B S Abdur Rahman Crescent Institute of Science & Technology',
    role: 'B.Tech, Artificial Intelligence & Data Science',
    period: '2023 - 2027',
    badge: 'Education',
    kind: 'education',
    points: [
      {
        title: 'Core focus',
        body: 'Artificial intelligence, data science and software development, building a strong foundation in Python, JavaScript and Node.js alongside database management and data analysis.',
      },
      {
        title: 'Applied practice',
        body: 'Machine learning, data preprocessing, exploratory data analysis and computer vision through coursework and hands-on implementation with OpenCV, NumPy and Pandas.',
      },
    ],
  },
];
