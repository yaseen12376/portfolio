/**
 * The back-office monitor's picture: the platform's Overview page (headline
 * numbers, footfall, zone dwell, the live event feed), drawn into a canvas
 * from the diorama's own simulation and shown on the monitor's screen as a
 * texture. Redrawn a couple of times a second, like a dashboard fed over a
 * WebSocket.
 */
import { CanvasTexture, Color, MeshBasicMaterial, SRGBColorSpace } from 'three';

const FONT = '"Geist Variable", system-ui, sans-serif';
const MONO = '"Geist Mono Variable", ui-monospace, monospace';

export class Dashboard {
  constructor({ width = 768, height = 448 } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.g = this.canvas.getContext('2d');
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
    // A little over white, so the screen glows through the bloom.
    this.material = new MeshBasicMaterial({ map: this.texture, color: new Color(1.35, 1.35, 1.35), toneMapped: false });
    this.clock = Infinity;
  }

  /** stats: { entries, exits, occupancy, sales, parties, visitors, series: number[], zones: [{name, secs}], feed: string[], fps, streams } */
  update(dt, stats) {
    this.clock += dt;
    if (this.clock < 0.5) return;
    this.clock = 0;
    const { g, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    g.fillStyle = '#0c0d11';
    g.fillRect(0, 0, W, H);
    // Sidebar.
    g.fillStyle = '#121319';
    g.fillRect(0, 0, 118, H);
    g.fillStyle = '#8b5cf6';
    g.fillRect(18, 22, 22, 22);
    g.fillStyle = '#e4e4e7';
    g.font = `600 15px ${FONT}`;
    g.fillText('Retail', 48, 39);
    ['Overview', 'Live', 'Analytics', 'Security'].forEach((t, i) => {
      g.fillStyle = i === 0 ? 'rgba(139,92,246,0.22)' : 'transparent';
      g.fillRect(10, 70 + i * 34, 98, 26);
      g.fillStyle = i === 0 ? '#e4e4e7' : '#8b8b94';
      g.font = `500 13px ${FONT}`;
      g.fillText(t, 20, 88 + i * 34);
    });
    // Headline tiles.
    const conv = stats.entries ? Math.round((stats.sales / stats.entries) * 100) : 0;
    const tiles = [
      ['Footfall', stats.entries, '#06d6a0'],
      ['In store', stats.occupancy, '#e4e4e7'],
      ['Conversion', `${conv}%`, '#8b5cf6'],
      ['Parties', stats.parties, '#f59e0b'],
    ];
    const tw = (W - 118 - 20 * 5) / 4;
    tiles.forEach(([label, value, color], i) => {
      const x = 118 + 20 + i * (tw + 20);
      g.fillStyle = '#15161d';
      roundRect(g, x, 20, tw, 84, 10);
      g.fillStyle = '#8b8b94';
      g.font = `500 13px ${FONT}`;
      g.fillText(label, x + 14, 44);
      g.fillStyle = color;
      g.font = `600 34px ${MONO}`;
      g.fillText(String(value), x + 14, 88);
    });
    // Footfall chart.
    const cx = 138;
    const cy = 124;
    const cw = W - 138 - 20 - 250;
    const ch = 170;
    g.fillStyle = '#15161d';
    roundRect(g, cx, cy, cw, ch, 10);
    g.fillStyle = '#8b8b94';
    g.font = `500 13px ${FONT}`;
    g.fillText('Entries, last minutes', cx + 14, cy + 24);
    const s = stats.series.length ? stats.series : [0];
    const max = Math.max(3, ...s);
    const bw = (cw - 28) / Math.max(12, s.length);
    s.forEach((v, i) => {
      const h = ((ch - 54) * v) / max;
      g.fillStyle = i === s.length - 1 ? '#06d6a0' : 'rgba(139,92,246,0.75)';
      g.fillRect(cx + 14 + i * bw, cy + ch - 14 - h, bw - 4, h);
    });
    // Zone dwell.
    const zx = cx + cw + 20;
    g.fillStyle = '#15161d';
    roundRect(g, zx, cy, 230, ch, 10);
    g.fillStyle = '#8b8b94';
    g.fillText('Zone dwell, avg', zx + 14, cy + 24);
    const zmax = Math.max(10, ...stats.zones.map((z) => z.secs));
    stats.zones.slice(0, 5).forEach((z, i) => {
      const y = cy + 44 + i * 24;
      g.fillStyle = '#c4c4cc';
      g.font = `500 12px ${FONT}`;
      g.fillText(z.name, zx + 14, y + 10);
      g.fillStyle = 'rgba(245,158,11,0.85)';
      g.fillRect(zx + 88, y, (120 * z.secs) / zmax, 12);
      g.fillStyle = '#8b8b94';
      g.font = `500 11px ${MONO}`;
      g.fillText(`${z.secs.toFixed(0)}s`, zx + 92 + (120 * z.secs) / zmax, y + 10);
    });
    // Live feed.
    const fy = cy + ch + 16;
    g.fillStyle = '#15161d';
    roundRect(g, cx, fy, W - cx - 20, H - fy - 18, 10);
    g.fillStyle = '#8b8b94';
    g.font = `500 13px ${FONT}`;
    g.fillText(`Live events  ·  ${stats.streams} cameras  ·  ${stats.fps} FPS`, cx + 14, fy + 24);
    g.font = `500 13px ${MONO}`;
    stats.feed.slice(-3).forEach((line, i) => {
      g.fillStyle = i === Math.min(2, stats.feed.length - 1) ? '#e4e4e7' : '#8b8b94';
      g.fillText(line, cx + 14, fy + 50 + i * 22);
    });
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
    this.material.dispose();
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}
