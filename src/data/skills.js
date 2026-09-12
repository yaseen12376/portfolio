/**
 * Toolkit, grouped. Each skill lists the `techStack` names it matches in
 * src/data/projects.js, so the Toolkit section can show which projects actually
 * use it. A skill with no match still renders, just without a project count.
 */
export const skillGroups = [
  {
    label: 'Vision & ML',
    items: [
      { name: 'YOLO', match: ['YOLO11', 'YOLOv8'] },
      { name: 'InsightFace / ArcFace', match: ['InsightFace', 'ArcFace'] },
      { name: 'Multi-object tracking', match: ['BoT-SORT', 'ByteTrack'] },
      { name: 'MediaPipe', match: ['MediaPipe'] },
      { name: 'MoveNet', match: ['MoveNet'] },
      { name: 'OpenCV', match: ['OpenCV'] },
      { name: 'ONNX Runtime', match: ['ONNX Runtime', 'ONNX'] },
      { name: 'TensorRT', match: ['TensorRT'] },
      { name: 'TensorFlow / Keras', match: ['TensorFlow', 'Keras'] },
    ],
  },
  {
    label: 'Backend & Data',
    items: [
      { name: 'Python', match: ['Python'] },
      { name: 'FastAPI', match: ['FastAPI'] },
      { name: 'Flask / Socket.IO', match: ['Flask', 'Flask-SocketIO'] },
      { name: 'C# / ASP.NET Core', match: ['C#', 'ASP.NET Core 8'] },
      { name: 'EF Core', match: ['EF Core'] },
      { name: 'PostgreSQL / TimescaleDB', match: ['PostgreSQL', 'TimescaleDB'] },
      { name: 'SQLite / SQL Server', match: ['SQLite', 'SQL Server'] },
      { name: 'WebSockets', match: ['WebSockets', 'WebSocket'] },
      { name: 'MQTT / BLE / ESP32', match: ['MQTT', 'BLE Beacons', 'ESP32'] },
    ],
  },
  {
    label: 'Frontend & Delivery',
    items: [
      { name: 'JavaScript / TypeScript', match: ['JavaScript', 'TypeScript'] },
      { name: 'React', match: ['React', 'React 19'] },
      { name: 'Three.js', match: ['Three.js'] },
      { name: 'C++', match: ['C++'] },
      { name: 'Docker', match: ['Docker'] },
      { name: 'GitHub Actions', match: ['GitHub Actions'] },
      { name: 'pytest', match: ['pytest'] },
      { name: 'AWS S3', match: ['AWS S3'] },
      { name: 'HLS video', match: ['HLS'] },
    ],
  },
];
