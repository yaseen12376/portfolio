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
        body: 'Top contributor to the team’s construction-safety platform: YOLOv8 PPE detection, MoveNet fall detection, face identification of violators, ONNX Runtime export (1.31× faster) and S3-backed alert evidence.',
        project: 'constructsafe',
      },
      {
        title: 'Automated attendance',
        body: 'Co-built face recognition attendance on live CCTV with InsightFace and ArcFace, separate entry and exit cameras, and a JWT-secured FastAPI app.',
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
    period: 'Jul 2026 - Sep 2026',
    badge: 'Client work',
    kind: 'work',
    points: [
      {
        title: 'Courier Management System',
        body: 'Main developer on booking, billing and tracking software for a courier franchise in Tamil Nadu: ASP.NET Core 8, EF Core, WhatsApp and SMS notifications, PDF receipts and a legacy SQL Server sync.',
        project: 'courier',
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
