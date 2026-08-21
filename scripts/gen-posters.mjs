/**
 * Generate one SVG poster per project into public/posters/.
 *
 * Each poster is a distinct "machine vision output" motif rather than generic
 * abstract art — the idea is that the artwork shows what the system actually
 * sees. All are 1600x900 and locked to the site palette, so a real render
 * generated later (see docs/image-prompts.md) drops into the same slot.
 *
 * Deterministic: a seeded PRNG means re-running produces identical files.
 *
 * Run: npm run gen:posters
 */
import { mkdir, writeFile } from 'node:fs/promises';

const W = 1600;
const H = 900;
const OUT = 'public/posters';

const PALETTE = {
  bg: '#070709',
  bg2: '#0c0c14',
  grid: 'rgba(255,255,255,0.045)',
  line: 'rgba(255,255,255,0.14)',
  text: '#8a8f98',
  purple: '#8b5cf6',
  teal: '#06d6a0',
  amber: '#f59e0b',
  red: '#f0506e',
};

/** Mulberry32 — small, fast, deterministic. */
function rng(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const n = (v) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------- primitives

function defs(accent) {
  return `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${PALETTE.bg2}"/>
      <stop offset="60%" stop-color="${PALETTE.bg}"/>
      <stop offset="100%" stop-color="#040406"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="45%" r="55%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.20"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vig" cx="50%" cy="50%" r="72%">
      <stop offset="55%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.62"/>
    </radialGradient>
    <linearGradient id="sweep" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0"/>
      <stop offset="50%" stop-color="${accent}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </linearGradient>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="18"/>
    </filter>
    <filter id="grain">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="7"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.05"/></feComponentTransfer>
    </filter>
  </defs>`;
}

function ground(accent) {
  let grid = '';
  for (let x = 0; x <= W; x += 64) grid += `<line x1="${x}" y1="0" x2="${x}" y2="${H}"/>`;
  for (let y = 0; y <= H; y += 64) grid += `<line x1="0" y1="${y}" x2="${W}" y2="${y}"/>`;
  return `
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <g stroke="${PALETTE.grid}" stroke-width="1">${grid}</g>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>`;
}

/** HUD corner brackets + a thin frame, the visual signature across all six. */
function chrome(label, accent) {
  const m = 44;
  const a = 34;
  const c = (x, y, dx, dy) =>
    `<path d="M${x + dx * a} ${y} H${x} V${y + dy * a}" fill="none" stroke="${accent}" stroke-width="2" opacity="0.75"/>`;
  return `
  <rect x="${m}" y="${m}" width="${W - m * 2}" height="${H - m * 2}" fill="none"
        stroke="${PALETTE.line}" stroke-width="1"/>
  ${c(m, m, 1, 1)}${c(W - m, m, -1, 1)}${c(m, H - m, 1, -1)}${c(W - m, H - m, -1, -1)}
  <text x="${m + 18}" y="${H - m - 20}" font-family="ui-monospace,'JetBrains Mono',monospace"
        font-size="19" letter-spacing="3.5" fill="${accent}" opacity="0.85">${label}</text>
  <circle cx="${W - m - 22}" cy="${m + 24}" r="5" fill="${PALETTE.red}"/>
  <text x="${W - m - 38}" y="${m + 30}" text-anchor="end" font-family="ui-monospace,'JetBrains Mono',monospace"
        font-size="16" letter-spacing="2" fill="${PALETTE.text}">LIVE</text>`;
}

function finish() {
  return `
  <rect width="${W}" height="${H}" fill="url(#vig)"/>
  <rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.55"/>`;
}

/** Detection box with a label chip above it. */
function box(x, y, w, h, color, label, conf) {
  const t = 3;
  const corner = Math.min(26, w / 3, h / 3);
  const arm = (px, py, dx, dy) =>
    `<path d="M${px + dx * corner} ${py} H${px} V${py + dy * corner}" fill="none" stroke="${color}" stroke-width="${t}" stroke-linecap="square"/>`;
  return `
  <g>
    <rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${color}" opacity="0.06"/>
    <rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="none" stroke="${color}" stroke-width="1.2" opacity="0.55"/>
    ${arm(x, y, 1, 1)}${arm(x + w, y, -1, 1)}${arm(x, y + h, 1, -1)}${arm(x + w, y + h, -1, -1)}
    <rect x="${n(x)}" y="${n(y - 30)}" width="${n(label.length * 10.2 + 58)}" height="26" fill="${color}" opacity="0.92"/>
    <text x="${n(x + 9)}" y="${n(y - 11)}" font-family="ui-monospace,'JetBrains Mono',monospace"
          font-size="15" font-weight="600" fill="#07070a">${label} ${conf}</text>
  </g>`;
}

/** Simplified standing figure, used by the two safety posters. */
function figure(cx, baseY, scale, color, opacity = 0.9) {
  const s = scale;
  return `
  <g fill="${color}" opacity="${opacity}">
    <circle cx="${n(cx)}" cy="${n(baseY - 152 * s)}" r="${n(23 * s)}"/>
    <path d="M${n(cx - 30 * s)} ${n(baseY - 128 * s)}
             q${n(30 * s)} ${n(-14 * s)} ${n(60 * s)} 0
             l${n(9 * s)} ${n(76 * s)} l${n(-16 * s)} 0 l${n(-4 * s)} ${n(74 * s)}
             l${n(-15 * s)} 0 l${n(-4 * s)} ${n(-58 * s)} l${n(-4 * s)} ${n(58 * s)}
             l${n(-15 * s)} 0 l${n(-4 * s)} ${n(-74 * s)} l${n(-16 * s)} 0 Z"/>
  </g>`;
}

function helmet(cx, cy, scale, color) {
  const s = scale;
  return `
  <g>
    <path d="M${n(cx - 30 * s)} ${n(cy + 6 * s)} a${n(30 * s)} ${n(30 * s)} 0 0 1 ${n(60 * s)} 0 Z"
          fill="${color}" opacity="0.95"/>
    <rect x="${n(cx - 38 * s)}" y="${n(cy + 4 * s)}" width="${n(76 * s)}" height="${n(9 * s)}"
          rx="${n(4 * s)}" fill="${color}" opacity="0.95"/>
  </g>`;
}

const mono = (x, y, text, { size = 16, fill = PALETTE.text, anchor = 'start', ls = 2, weight = 400 } = {}) =>
  `<text x="${n(x)}" y="${n(y)}" text-anchor="${anchor}" font-family="ui-monospace,'JetBrains Mono',monospace"
     font-size="${size}" font-weight="${weight}" letter-spacing="${ls}" fill="${fill}">${text}</text>`;

// ------------------------------------------------------------------- posters

const POSTERS = {
  ppe(accent) {
    const r = rng(101);
    const people = [
      { x: 300, s: 1.15, ok: true, c: 0.96 },
      { x: 620, s: 1.0, ok: true, c: 0.94 },
      { x: 940, s: 1.08, ok: false, c: 0.88 },
      { x: 1250, s: 0.92, ok: true, c: 0.91 },
    ];
    const baseY = 700;
    let out = '';
    for (const p of people) {
      const color = p.ok ? PALETTE.teal : PALETTE.red;
      out += figure(p.x, baseY, p.s, '#232334', 1);
      out += helmet(p.x, baseY - 172 * p.s, p.s, p.ok ? PALETTE.teal : '#2a2a3a');
      const w = 150 * p.s;
      const h = 250 * p.s;
      out += box(p.x - w / 2, baseY - h - 40 * p.s, w, h, color, p.ok ? 'PPE OK' : 'NO HELMET', p.c.toFixed(2));
    }
    // scan lines
    let scan = '';
    for (let y = 120; y < H - 120; y += 5) scan += `<line x1="90" y1="${y}" x2="${W - 90}" y2="${y}"/>`;
    return `
      ${out}
      <g stroke="${accent}" stroke-width="1" opacity="0.05">${scan}</g>
      <g>
        ${mono(96, 148, 'PPE COMPLIANCE', { size: 22, fill: accent, ls: 5, weight: 600 })}
        ${mono(96, 178, 'YOLOv5 · 4 TRACKED · 1 VIOLATION', { size: 15 })}
      </g>
      <g>
        <rect x="${W - 340}" y="120" width="244" height="76" fill="#0e0e16" opacity="0.9" stroke="${PALETTE.line}"/>
        ${mono(W - 322, 152, 'SAFE', { size: 15 })}
        ${mono(W - 322, 178, '3', { size: 26, fill: PALETTE.teal, weight: 700 })}
        ${mono(W - 200, 152, 'UNSAFE', { size: 15 })}
        ${mono(W - 200, 178, '1', { size: 26, fill: PALETTE.red, weight: 700 })}
      </g>`;
  },

  constructsafe(accent) {
    const baseY = 720;
    const safeX = 430;
    const unsafeX = 1120;
    return `
      <rect x="${W / 2 - 1}" y="120" width="2" height="${H - 240}" fill="${PALETTE.line}"/>
      <rect x="90" y="120" width="${W / 2 - 92}" height="${H - 240}" fill="${PALETTE.teal}" opacity="0.03"/>
      <rect x="${W / 2 + 2}" y="120" width="${W / 2 - 92}" height="${H - 240}" fill="${PALETTE.red}" opacity="0.045"/>

      ${figure(safeX, baseY, 1.3, '#242436', 1)}
      ${helmet(safeX, baseY - 198, 1.3, PALETTE.teal)}
      ${box(safeX - 105, baseY - 365, 210, 330, PALETTE.teal, 'SAFE', '0.97')}
      ${box(safeX - 52, baseY - 232, 104, 60, '#4aa8ff', 'HELMET', '0.93')}

      ${figure(unsafeX, baseY, 1.3, '#242436', 1)}
      ${box(unsafeX - 105, baseY - 365, 210, 330, PALETTE.red, 'UNSAFE', '0.95')}

      <g>
        <rect x="${unsafeX - 105}" y="${baseY + 22}" width="230" height="74" fill="#140d10" opacity="0.95" stroke="${PALETTE.red}" stroke-width="1.4"/>
        ${mono(unsafeX - 88, baseY + 48, 'ID MATCH · ArcFace', { size: 13, fill: PALETTE.red })}
        ${mono(unsafeX - 88, baseY + 76, 'RRN 231CS0142', { size: 17, fill: '#e8e8ee', ls: 1.5 })}
      </g>

      ${mono(96, 148, 'HELMET COMPLIANCE', { size: 22, fill: accent, ls: 5, weight: 600 })}
      ${mono(96, 178, 'YOLOv8 ×2 · InsightFace · CUDA', { size: 15 })}
      ${mono(W - 96, 148, 'SNAPSHOT SAVED', { size: 15, anchor: 'end', fill: PALETTE.red })}
      ${mono(W - 96, 176, '2026-08-20 14:22:07', { size: 15, anchor: 'end' })}`;
  },

  attendance(accent) {
    const r = rng(303);
    const cx = 520;
    const cy = 450;
    // Face-mesh landmark constellation on an ellipse field.
    const pts = [];
    for (let i = 0; i < 132; i++) {
      const a = r() * Math.PI * 2;
      const rad = Math.sqrt(r());
      pts.push([cx + Math.cos(a) * rad * 195, cy + Math.sin(a) * rad * 250]);
    }
    let links = '';
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i][0] - pts[j][0];
        const dy = pts[i][1] - pts[j][1];
        if (dx * dx + dy * dy < 3600) {
          links += `<line x1="${n(pts[i][0])}" y1="${n(pts[i][1])}" x2="${n(pts[j][0])}" y2="${n(pts[j][1])}"/>`;
        }
      }
    }
    const dots = pts
      .map(([x, y], i) => `<circle cx="${n(x)}" cy="${n(y)}" r="${i % 9 === 0 ? 3.4 : 1.9}" fill="${accent}" opacity="${i % 9 === 0 ? 0.95 : 0.5}"/>`)
      .join('');

    // 128-d encoding strip
    let strip = '';
    for (let i = 0; i < 128; i++) {
      const h = 8 + r() * 74;
      strip += `<rect x="${n(950 + i * 4.6)}" y="${n(690 - h)}" width="3" height="${n(h)}" fill="${accent}" opacity="${n(0.28 + (h / 82) * 0.6)}"/>`;
    }

    return `
      <ellipse cx="${cx}" cy="${cy}" rx="215" ry="272" fill="${accent}" opacity="0.05" filter="url(#soft)"/>
      <g stroke="${accent}" stroke-width="0.8" opacity="0.3">${links}</g>
      ${dots}
      ${box(cx - 232, cy - 292, 464, 584, accent, 'FACE', '0.98')}
      <g>
        ${mono(950, 300, 'IDENTITY MATCH', { size: 22, fill: accent, ls: 5, weight: 600 })}
        <rect x="950" y="330" width="470" height="1" fill="${PALETTE.line}"/>
        ${mono(950, 380, 'NAME', { size: 14 })}
        ${mono(1130, 380, 'SHEIK AHMED YASEEN', { size: 16, fill: '#e8e8ee', ls: 1.2 })}
        ${mono(950, 420, 'RRN', { size: 14 })}
        ${mono(1130, 420, '231CS0142', { size: 16, fill: '#e8e8ee', ls: 1.2 })}
        ${mono(950, 460, 'EVENT', { size: 14 })}
        ${mono(1130, 460, 'ENTRY · CAM 01', { size: 16, fill: PALETTE.teal, ls: 1.2 })}
        ${mono(950, 500, 'TIME', { size: 14 })}
        ${mono(1130, 500, '09:14:02', { size: 16, fill: '#e8e8ee', ls: 1.2 })}
        ${mono(950, 640, '128-D EMBEDDING', { size: 13, ls: 3 })}
        ${strip}
      </g>
      ${mono(96, 148, 'FACE ATTENDANCE', { size: 22, fill: accent, ls: 5, weight: 600 })}
      ${mono(96, 178, 'InsightFace · RetinaFace + ArcFace', { size: 15 })}`;
  },

  'indoor-tracking'(accent) {
    const r = rng(505);
    // floor plan
    const rooms = [
      [140, 200, 420, 300],
      [560, 200, 300, 300],
      [860, 200, 600, 180],
      [860, 380, 280, 320],
      [140, 500, 300, 200],
      [440, 500, 420, 200],
      [1140, 380, 320, 320],
    ];
    const plan = rooms
      .map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${PALETTE.line}" stroke-width="1.6"/>`)
      .join('');

    const beacons = [
      [420, 330],
      [1020, 300],
      [700, 620],
    ];
    const tag = [700, 430];

    let rings = '';
    beacons.forEach(([bx, by], i) => {
      const dist = Math.hypot(bx - tag[0], by - tag[1]);
      for (let k = 1; k <= 3; k++) {
        rings += `<circle cx="${bx}" cy="${by}" r="${n((dist * k) / 3)}" fill="none" stroke="${accent}" stroke-width="1" opacity="${n(0.34 - k * 0.08)}"/>`;
      }
      rings += `<circle cx="${bx}" cy="${by}" r="${n(dist)}" fill="none" stroke="${accent}" stroke-width="1.6" opacity="0.5" stroke-dasharray="7 7"/>`;
      rings += `<line x1="${bx}" y1="${by}" x2="${tag[0]}" y2="${tag[1]}" stroke="${accent}" stroke-width="1" opacity="0.4" stroke-dasharray="4 6"/>`;
      rings += `<g><rect x="${bx - 34}" y="${by - 46}" width="68" height="24" fill="${accent}" opacity="0.9"/>
                ${mono(bx, by - 29, 'B' + (i + 1), { size: 14, anchor: 'middle', fill: '#07070a', weight: 700, ls: 1 })}</g>`;
      rings += `<circle cx="${bx}" cy="${by}" r="7" fill="${accent}"/>`;
    });

    // walked path
    let path = `M${tag[0] - 260} ${tag[1] + 180}`;
    let px = tag[0] - 260;
    let py = tag[1] + 180;
    for (let i = 0; i < 7; i++) {
      px += 30 + r() * 45;
      py += (r() - 0.5) * 90;
      path += ` L${n(px)} ${n(py)}`;
    }
    path += ` L${tag[0]} ${tag[1]}`;

    return `
      ${plan}
      ${rings}
      <path d="${path}" fill="none" stroke="${PALETTE.purple}" stroke-width="2.2" opacity="0.55" stroke-dasharray="3 8" stroke-linecap="round"/>
      <circle cx="${tag[0]}" cy="${tag[1]}" r="42" fill="${PALETTE.purple}" opacity="0.16" filter="url(#soft)"/>
      <circle cx="${tag[0]}" cy="${tag[1]}" r="13" fill="${PALETTE.purple}"/>
      <circle cx="${tag[0]}" cy="${tag[1]}" r="24" fill="none" stroke="${PALETTE.purple}" stroke-width="2" opacity="0.7"/>
      ${mono(tag[0] + 40, tag[1] - 14, 'TAG 04 · ±3.0 m', { size: 16, fill: '#e8e8ee', ls: 1.4 })}
      ${mono(96, 148, 'INDOOR POSITIONING', { size: 22, fill: accent, ls: 5, weight: 600 })}
      ${mono(96, 178, 'BLE RSSI · TRILATERATION · MQTT', { size: 15 })}
      <g>
        ${mono(W - 96, 148, 'RSSI', { size: 14, anchor: 'end' })}
        ${mono(W - 96, 176, 'B1 −62  B2 −71  B3 −68 dBm', { size: 15, anchor: 'end', fill: accent })}
      </g>`;
  },

  observex(accent) {
    const r = rng(707);
    const cells = [];
    const gx = 120;
    const gy = 190;
    const cw = 420;
    const ch = 240;
    const gap = 26;
    const names = ['CAM 01 · PORCH', 'CAM 02 · DRIVE', 'CAM 03 · GARDEN', 'CAM 04 · SIDE', 'CAM 05 · REAR', 'CAM 06 · GATE'];
    for (let i = 0; i < 6; i++) {
      const cx = gx + (i % 3) * (cw + gap);
      const cy = gy + Math.floor(i / 3) * (ch + gap);
      const threat = [0.12, 0.86, 0.2, 0.34, 0.15, 0.27][i];
      const hot = threat > 0.6;
      const col = hot ? PALETTE.red : accent;
      let inner = `<rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" fill="#0b0b13"/>
        <rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" fill="none" stroke="${hot ? PALETTE.red : PALETTE.line}" stroke-width="${hot ? 2 : 1}" opacity="${hot ? 0.9 : 1}"/>`;
      // pseudo-scene: horizon + shapes
      inner += `<line x1="${cx}" y1="${n(cy + ch * 0.62)}" x2="${cx + cw}" y2="${n(cy + ch * 0.62)}" stroke="${PALETTE.line}" stroke-width="1"/>`;
      for (let k = 0; k < 3; k++) {
        const bw = 30 + r() * 70;
        const bh = 24 + r() * 62;
        inner += `<rect x="${n(cx + 24 + r() * (cw - 140))}" y="${n(cy + ch * 0.62 - bh)}" width="${n(bw)}" height="${n(bh)}" fill="#161622"/>`;
      }
      if (hot) {
        inner += figure(cx + cw * 0.62, cy + ch * 0.74, 0.42, '#2c2130', 1);
        inner += box(cx + cw * 0.62 - 42, cy + ch * 0.28, 84, 118, PALETTE.red, 'INTENT', '0.86');
      }
      inner += `<rect x="${cx}" y="${n(cy + ch - 34)}" width="${cw}" height="34" fill="#07070a" opacity="0.86"/>`;
      inner += mono(cx + 14, cy + ch - 12, names[i], { size: 14, fill: hot ? PALETTE.red : PALETTE.text, ls: 2 });
      // threat bar
      inner += `<rect x="${n(cx + cw - 130)}" y="${n(cy + ch - 22)}" width="110" height="8" fill="#1a1a26"/>
                <rect x="${n(cx + cw - 130)}" y="${n(cy + ch - 22)}" width="${n(110 * threat)}" height="8" fill="${col}"/>`;
      cells.push(inner);
    }
    return `
      ${cells.join('')}
      <rect x="120" y="190" width="${cw * 3 + gap * 2}" height="4" fill="url(#sweep)" opacity="0.9"/>
      <rect x="120" y="${gy + ch + gap + 90}" width="${cw * 3 + gap * 2}" height="3" fill="url(#sweep)" opacity="0.5"/>
      ${mono(120, 152, 'BEHAVIORAL THREAT DETECTION', { size: 22, fill: accent, ls: 5, weight: 600 })}
      ${mono(W - 120, 152, '1 ELEVATED · 5 NOMINAL', { size: 16, anchor: 'end', fill: PALETTE.red, ls: 2 })}`;
  },

  adraf(accent) {
    const r = rng(909);
    const cx = W / 2;
    const cy = 470;
    // Left half: clean landmark mesh. Right half: artefact patches.
    const pts = [];
    for (let i = 0; i < 90; i++) {
      const a = r() * Math.PI * 2;
      const rad = Math.sqrt(r());
      pts.push([cx + Math.cos(a) * rad * 210, cy + Math.sin(a) * rad * 268]);
    }
    const left = pts
      .filter((p) => p[0] < cx)
      .map(([x, y]) => `<circle cx="${n(x)}" cy="${n(y)}" r="2.3" fill="${PALETTE.teal}" opacity="0.85"/>`)
      .join('');

    let heat = '';
    for (let i = 0; i < 26; i++) {
      const x = cx + r() * 200;
      const y = cy - 250 + r() * 500;
      const s = 16 + r() * 46;
      const hotness = r();
      heat += `<rect x="${n(x)}" y="${n(y)}" width="${n(s)}" height="${n(s)}" fill="${hotness > 0.55 ? PALETTE.red : PALETTE.amber}" opacity="${n(0.14 + hotness * 0.4)}"/>`;
    }

    let strip = '';
    for (let i = 0; i < 60; i++) {
      const h = 6 + r() * 56;
      strip += `<rect x="${n(200 + i * 8)}" y="${n(770 - h)}" width="5" height="${n(h)}" fill="${i > 34 ? PALETTE.red : PALETTE.teal}" opacity="0.65"/>`;
    }

    return `
      <ellipse cx="${cx}" cy="${cy}" rx="230" ry="288" fill="${accent}" opacity="0.05" filter="url(#soft)"/>
      <ellipse cx="${cx}" cy="${cy}" rx="230" ry="288" fill="none" stroke="${PALETTE.line}" stroke-width="1.4"/>
      ${left}
      <g clip-path="none">${heat}</g>
      <line x1="${cx}" y1="${cy - 300}" x2="${cx}" y2="${cy + 300}" stroke="${accent}" stroke-width="2" opacity="0.8" stroke-dasharray="10 8"/>
      ${box(cx - 250, cy - 308, 500, 616, accent, 'ANALYSING', '')}
      ${mono(cx - 130, cy + 348, 'AUTHENTIC', { size: 17, anchor: 'middle', fill: PALETTE.teal, ls: 3, weight: 600 })}
      ${mono(cx + 130, cy + 348, 'SYNTHETIC', { size: 17, anchor: 'middle', fill: PALETTE.red, ls: 3, weight: 600 })}
      ${mono(96, 148, 'DEEPFAKE AUTHENTICATION', { size: 22, fill: accent, ls: 5, weight: 600 })}
      ${mono(96, 178, 'CNN · LANDMARK · TEMPORAL CONSISTENCY', { size: 15 })}
      ${mono(200, 800, 'TEMPORAL CONSISTENCY / 60 FRAMES', { size: 13, ls: 3 })}
      ${strip}
      <g>
        <rect x="${W - 356}" y="120" width="260" height="80" fill="#0e0e16" opacity="0.92" stroke="${PALETTE.red}" stroke-width="1.4"/>
        ${mono(W - 338, 152, 'VERDICT', { size: 14 })}
        ${mono(W - 338, 182, 'MANIPULATED · 0.94', { size: 18, fill: PALETTE.red, ls: 1.4, weight: 600 })}
      </g>`;
  },
};

const LABELS = {
  ppe: 'PPE-DETECT / 01',
  constructsafe: 'CONSTRUCTSAFE / 02',
  attendance: 'FACE-ATTEND / 03',
  'indoor-tracking': 'INDOOR-TRACK / 04',
  observex: 'OBSERVEX / 05',
  adraf: 'ADRAF / 06',
};

const ACCENTS = {
  ppe: PALETTE.teal,
  constructsafe: PALETTE.amber,
  attendance: PALETTE.purple,
  'indoor-tracking': PALETTE.teal,
  observex: PALETTE.purple,
  adraf: PALETTE.purple,
};

async function main() {
  await mkdir(OUT, { recursive: true });
  for (const [id, draw] of Object.entries(POSTERS)) {
    const accent = ACCENTS[id];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">
${defs(accent)}
${ground(accent)}
${draw(accent)}
${chrome(LABELS[id], accent)}
${finish()}
</svg>`;
    await writeFile(`${OUT}/${id}.svg`, svg);
    console.log(`  ${id}.svg  ${(Buffer.byteLength(svg) / 1024).toFixed(1)} KB`);
  }
  console.log(`\n  ${Object.keys(POSTERS).length} posters written to ${OUT}/\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
