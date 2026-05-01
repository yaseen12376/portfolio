export const projects = [
  {
    id: 'adraf',
    num: '01',
    title: 'ADRAF – Deepfake Authentication System',
    short: 'Advanced deepfake detection and real-time authentication system using deep learning for secure digital identity verification.',
    tags: ['Python','TensorFlow','OpenCV','Flask','Deep Learning'],
    overview: 'ADRAF (Advanced Deepfake Recognition and Authentication Framework) is an AI-powered system designed to detect and authenticate deepfake content in real-time, ensuring the integrity of digital communications and media.',
    problem: 'The proliferation of deepfake technology poses severe threats to digital trust, from identity fraud to misinformation. Traditional authentication methods cannot distinguish between genuine and AI-generated content, creating urgent demand for reliable detection systems.',
    solution: 'Built a multi-stage detection pipeline combining facial landmark analysis, temporal consistency checking, and deep neural network classification. The system analyzes micro-expressions, lighting inconsistencies, and artifact patterns that are imperceptible to the human eye.',
    implementation: [
      'Designed a CNN-based binary classifier trained on diverse deepfake datasets including FaceForensics++ and Celeb-DF',
      'Implemented real-time face detection and tracking using MTCNN and dlib',
      'Built temporal analysis module to detect inter-frame inconsistencies',
      'Created a Flask-based REST API for integration with existing systems',
      'Developed a web-based dashboard for real-time monitoring and alerting'
    ],
    techStack: ['Python','TensorFlow','Keras','OpenCV','Flask','NumPy','dlib','MTCNN'],
    outcomes: [
      'Achieved high accuracy in deepfake detection across multiple datasets',
      'Real-time processing capability for live video streams',
      'Modular architecture enabling easy integration with third-party platforms',
      'Comprehensive reporting and audit trail for authentication events'
    ]
  },
  {
    id: 'attendance',
    num: '02',
    title: 'Automated Attendance System',
    short: 'Face recognition-based automated attendance tracking system with real-time identification and database management.',
    tags: ['Python','OpenCV','dlib','SQLite','Face Recognition'],
    overview: 'An intelligent attendance management system that uses facial recognition technology to automatically identify and record attendance, eliminating manual processes and reducing errors.',
    problem: 'Manual attendance tracking is time-consuming, error-prone, and susceptible to proxy attendance. Organizations need a reliable, automated solution that can accurately identify individuals and maintain tamper-proof records.',
    solution: 'Developed an end-to-end facial recognition system that captures, identifies, and logs attendance in real-time. The system uses advanced face encoding techniques to achieve high accuracy even in varying lighting and angle conditions.',
    implementation: [
      'Built face detection pipeline using HOG-based detector and CNN-based fallback',
      'Implemented 128-dimensional face encoding for robust identity representation',
      'Designed SQLite database schema for attendance records with timestamp tracking',
      'Created admin interface for managing enrolled users and viewing reports',
      'Implemented anti-spoofing measures to prevent photo-based proxy attendance'
    ],
    techStack: ['Python','OpenCV','dlib','face_recognition','SQLite','NumPy','Tkinter'],
    outcomes: [
      'Reduced attendance processing time significantly versus manual methods',
      'High identification accuracy across diverse lighting conditions',
      'Eliminated proxy attendance through liveness detection',
      'Automated report generation for attendance analytics'
    ]
  },
  {
    id: 'ppe',
    num: '03',
    title: 'PPE Detection System',
    short: 'Real-time personal protective equipment detection for workplace safety compliance using computer vision and YOLOv5.',
    tags: ['Python','YOLOv5','OpenCV','MQTT','IoT'],
    overview: 'A computer vision-based safety monitoring system that detects and verifies the proper use of personal protective equipment (PPE) in industrial environments, enabling automated compliance enforcement.',
    problem: 'Workplace safety violations are a leading cause of industrial accidents. Manual PPE compliance monitoring is inconsistent, labor-intensive, and cannot provide continuous coverage across large facilities.',
    solution: 'Deployed a real-time object detection system using YOLOv5 to identify workers and verify PPE compliance (helmets, vests, gloves, goggles). The system provides instant alerts for violations and maintains compliance analytics.',
    implementation: [
      'Fine-tuned YOLOv5 model on custom PPE dataset with multiple equipment classes',
      'Implemented multi-camera stream processing for facility-wide coverage',
      'Built MQTT-based alert system for real-time violation notifications',
      'Designed compliance dashboard with historical analytics and reporting',
      'Optimized inference pipeline for edge deployment on resource-constrained hardware'
    ],
    techStack: ['Python','YOLOv5','PyTorch','OpenCV','MQTT','Node.js','Docker'],
    outcomes: [
      'Continuous 24/7 automated safety monitoring across multiple zones',
      'Real-time violation alerts reducing response time dramatically',
      'Comprehensive compliance analytics for safety audits',
      'Edge-optimized deployment enabling low-latency processing'
    ]
  },
  {
    id: 'indoor-tracking',
    num: '04',
    title: 'Indoor Tracking System',
    short: 'BLE beacon and MQTT-based indoor positioning system for real-time asset and personnel tracking in commercial environments.',
    tags: ['IoT','BLE','MQTT','Node.js','Python','Embedded'],
    overview: 'A sophisticated indoor positioning and tracking system using Bluetooth Low Energy (BLE) beacons and MQTT messaging protocol to provide real-time location awareness in environments where GPS is unavailable.',
    problem: 'Indoor environments like warehouses, hospitals, and commercial spaces lack reliable positioning systems. GPS signals cannot penetrate buildings, creating a need for alternative location tracking solutions for asset management and personnel safety.',
    solution: 'Designed a mesh of BLE beacons with trilateration algorithms to determine position. MQTT protocol enables lightweight, real-time data transmission from edge devices to a central processing server that computes and visualizes locations.',
    implementation: [
      'Deployed BLE beacon infrastructure with optimized placement for coverage',
      'Implemented RSSI-based trilateration with Kalman filtering for noise reduction',
      'Built MQTT broker and subscriber architecture for real-time data ingestion',
      'Developed Node.js backend for position computation and data management',
      'Created web-based floor plan visualization with real-time position updates'
    ],
    techStack: ['BLE Beacons','MQTT','Node.js','Python','MongoDB','WebSocket','ESP32'],
    outcomes: [
      'Accurate indoor positioning with sub-meter precision in controlled areas',
      'Real-time tracking visualization on interactive floor plans',
      'Scalable architecture supporting hundreds of tracked entities',
      'Low-power BLE infrastructure with extended battery life'
    ]
  }
];
