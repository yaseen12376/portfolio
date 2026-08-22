/**
 * Skills, grouped so the section can show structure rather than one flat list.
 * The marquee flattens these; the grid uses the grouping.
 */
export const skillGroups = [
  {
    label: 'Languages',
    items: ['Python', 'JavaScript', 'C++', 'SQL'],
  },
  {
    label: 'AI & Vision',
    items: ['Machine Learning', 'Computer Vision', 'OpenCV', 'YOLO', 'Deep Learning', 'NLP'],
  },
  {
    label: 'Systems & Data',
    items: ['IoT', 'Embedded', 'MQTT', 'Node.js', 'Data Analysis'],
  },
  {
    label: 'Tooling',
    items: ['Git & GitHub', 'Linux', 'Docker', 'Figma'],
  },
];

export const skills = skillGroups.flatMap((g) => g.items);
