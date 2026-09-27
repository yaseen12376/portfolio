/**
 * Detections the way the product draws them: flat boxes on the frame itself,
 * hugging each person's silhouette, each with a tag (class, confidence, track
 * ID). They are drawn onto a slot's 2D canvas right after the 3D frame lands,
 * so the lines are crisp at the device's pixels and never lag a frame behind,
 * and they read as a camera's output rather than as objects in the room.
 *
 * Someone this view can't see (behind racking, in a fitting booth) keeps a
 * dashed box: the tracker is still holding their ID.
 */
import { Vector3 } from 'three';

const v = new Vector3();
const MONO = '"Geist Mono Variable", ui-monospace, monospace';

/**
 * The screen box (NDC) of an upright figure standing at (x, z), facing `yaw`,
 * `height` tall, its feet at `base` (a scaffold's lift): the projected
 * corners of its oriented bounds.
 */
export function projectBox(camera, x, z, yaw, height, halfW = 0.24, halfD = 0.17, base = 0) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let front = false;
  let depth = 0;
  for (const [dx, dz] of [[-halfW, -halfD], [halfW, -halfD], [halfW, halfD], [-halfW, halfD]]) {
    for (const y of [base, base + height]) {
      v.set(x + dx * c + dz * s, y, z - dx * s + dz * c).project(camera);
      if (v.z < 1) front = true;
      depth += v.z;
      x0 = Math.min(x0, v.x);
      x1 = Math.max(x1, v.x);
      y0 = Math.min(y0, v.y);
      y1 = Math.max(y1, v.y);
    }
  }
  return { x0, y0, x1, y1, front, depth: depth / 8 };
}

/** A steady, slightly lively confidence per person: what a detector reports. */
export function confidence(id, time) {
  const base = 0.88 + ((id * 7919) % 97) / 97 * 0.09;
  return Math.min(0.99, base + Math.sin(time * 1.7 + id) * 0.012);
}

/**
 * Draw detections.
 * @param {CanvasRenderingContext2D} g
 * @param {number} w  canvas width, device pixels
 * @param {number} h  canvas height, device pixels
 * @param {import('three').Camera} camera
 * @param {{ x: number, z: number, yaw: number, height: number, color: string,
 *   tag: string, dashed?: boolean, alpha?: number, base?: number, halfW?: number,
 *   halfD?: number, thin?: boolean }[]} items
 *   base: feet height; halfW/halfD: the bounds' half size (a person lying
 *   down, a hard hat); thin: a lighter line and no tag (a part of someone)
 * @param {{ px?: number }} [o]  px: device pixels per CSS pixel (line and type size)
 */
export function drawDetections(g, w, h, camera, items, { px = 1 } = {}) {
  const boxes = [];
  for (const it of items) {
    const b = projectBox(camera, it.x, it.z, it.yaw, it.height, it.halfW, it.halfD, it.base ?? 0);
    if (!b.front || b.x1 < -1 || b.x0 > 1 || b.y1 < -1 || b.y0 > 1) continue;
    boxes.push({ it, b });
  }
  // Far first, so a nearer person's box and tag sit on top.
  boxes.sort((p, q) => q.b.depth - p.b.depth);
  const lw = Math.max(1, 1.5 * px);
  const fs = Math.round(10.5 * px);
  const th = Math.round(16 * px);
  const pad = Math.round(5 * px);
  const r = 2 * px;
  g.save();
  g.font = `500 ${fs}px ${MONO}`;
  g.textBaseline = 'middle';
  const tags = [];
  for (const { it, b } of boxes) {
    const x = ((b.x0 + 1) / 2) * w;
    const y = ((1 - b.y1) / 2) * h;
    const bw = ((b.x1 - b.x0) / 2) * w;
    const bh = ((b.y1 - b.y0) / 2) * h;
    g.globalAlpha = (it.alpha ?? 1) * (it.dashed ? 0.8 : 1);
    g.setLineDash(it.dashed ? [5 * px, 4 * px] : []);
    g.lineWidth = it.thin ? Math.max(1, lw * 0.7) : lw;
    g.strokeStyle = it.color;
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, bw, bh, r);
    else g.rect(x, y, bw, bh);
    g.stroke();
    if (!it.dashed) {
      g.globalAlpha = (it.alpha ?? 1) * 0.07;
      g.fillStyle = it.color;
      g.fill();
    }
    if (it.thin || !it.tag) continue;
    // The tag, above the box (inside it at the top edge); skipped where it
    // would cover a nearer person's tag.
    const tw = Math.ceil(g.measureText(it.tag).width) + pad * 2;
    const ty = y - th >= 0 ? y - th : y;
    const rect = [x - lw / 2, ty, x - lw / 2 + tw, ty + th];
    if (tags.some((q) => rect[0] < q[2] && rect[2] > q[0] && rect[1] < q[3] && rect[3] > q[1])) continue;
    tags.push(rect);
    g.setLineDash([]);
    g.globalAlpha = (it.alpha ?? 1) * (it.dashed ? 0.7 : 0.95);
    g.fillStyle = it.color;
    g.beginPath();
    if (g.roundRect) g.roundRect(rect[0], rect[1], tw, th, [r, r, 0, 0]);
    else g.rect(rect[0], rect[1], tw, th);
    g.fill();
    g.globalAlpha = it.alpha ?? 1;
    g.fillStyle = '#07070a';
    g.fillText(it.tag, rect[0] + pad, rect[1] + th / 2 + px * 0.5);
  }
  g.restore();
}
