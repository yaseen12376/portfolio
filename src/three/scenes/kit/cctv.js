/**
 * A site's own cameras, as every CCTV diorama shows them: where they are and
 * what they see (from Blender's `cameras`), who a wall or fixture hides from
 * the view (dashed boxes), their health (covered, knocked, blurred), their
 * frustums in the scene, their picture in the picture-in-picture, and the
 * evidence they keep for an alert (a clip before and after it, or one still).
 */
import { Box3, PerspectiveCamera, Ray, Vector3 } from 'three';

import { drawDetections } from '../../overlays/detect2d.js';
import { GLOW } from '../../overlays/lines.js';
import { hexGlow } from './util.js';

/** The boxes' colours, as the product dashboards draw them. */
export const INK = { turq: '#2ee6b4', grey: '#b4b4bd', amber: '#fbbf24', red: '#fb6f8a', violet: '#a78bfa', green: '#4ade80', cyan: '#22d3ee' };
/** A GLOW line colour as the matching box ink. */
export const inkOf = (c) => (c === GLOW.turq ? INK.turq : c === GLOW.amber ? INK.amber : c === GLOW.red ? INK.red : c === GLOW.violet ? INK.violet : INK.grey);

/**
 * The site's cameras, by role or id: { cam, pos, look }. The picture comes
 * from the lens, not the mount: a dome's lens sits inside its shell, a wall
 * camera's at the end of its 33 cm body.
 */
export function siteCameras(data, { wall = [], far = 30 } = {}) {
  const walls = new Set(wall);
  return Object.fromEntries(
    Object.entries(data.cameras ?? {}).map(([role, c]) => {
      const cam = new PerspectiveCamera(c.fov ?? 70, 16 / 9, 0.05, far);
      const isWall = (c.mount ?? (walls.has(role) ? 'wall' : 'dome')) === 'wall';
      const f = new Vector3(...c.look).sub(new Vector3(...c.pos)).normalize();
      cam.position.set(...c.pos).addScaledVector(f, isWall ? 0.36 : 0.12);
      cam.lookAt(new Vector3(...c.look));
      cam.updateMatrixWorld();
      return [role, { cam, pos: new Vector3(...c.pos), look: new Vector3(...c.look), fov: c.fov ?? 70 }];
    })
  );
}

/**
 * Who is hidden from a camera: tested against the set's tall pieces (the
 * boxes Blender exports), not every triangle, and only pieces wide enough to
 * hide someone (walls, racking, booths), not posts. `extra(a)` can hide
 * someone for a scene's own reasons (a drawn curtain).
 */
export function occlusion(data, { extra = null, minWidth = 0.5 } = {}) {
  const boxes = (data.occluders ?? [])
    .filter(([lo, hi]) => Math.max(hi[0] - lo[0], hi[2] - lo[2]) >= minWidth)
    .map(([lo, hi]) => new Box3(new Vector3(...lo), new Vector3(...hi)));
  const ray = new Ray();
  const hit = new Vector3();
  const p = new Vector3();
  function occluded(a, camera) {
    if (extra?.(a)) return true;
    if (!boxes.length) return false;
    const s = a.fig.root.scale.x;
    let hidden = true;
    for (const y of [0.9 * s, 1.4 * s]) {
      p.set(a.pos.x, y, a.pos.y);
      ray.origin.copy(camera.position);
      ray.direction.subVectors(p, camera.position);
      const d = ray.direction.length();
      ray.direction.normalize();
      if (!boxes.some((box) => box.containsPoint(p) === false && ray.intersectBox(box, hit) && hit.distanceTo(camera.position) < d - 0.05)) hidden = false;
    }
    return hidden;
  }
  // (The boxes too: coverage maps shade what they hide.)
  occluded.boxes = boxes;
  return occluded;
}

/**
 * Each camera's fault, as a camera-health monitor sees it: covered (the
 * picture goes flat), knocked (turned off its aim), blurred. Raised after
 * `raise` seconds of it, cleared after `clear` seconds without it (both in
 * the scene's own clock, which `tick` is given).
 */
export class CameraHealth {
  /**
   * @param {{ cams: object, stage: object, raise: number, clear: number, event?: (text: string) => void,
   *           onRaise?: (role: string, kind: string) => void, mesh?: (role: string) => object }} o
   */
  constructor({ cams, stage, raise, clear, event = () => {}, onRaise = () => {}, mesh = (r) => stage.byName.get(`cam_${r}`) }) {
    this.cams = cams;
    this.raise = raise;
    this.clear = clear;
    this.event = event;
    this.onRaise = onRaise;
    this.mesh = mesh;
    this.state = Object.fromEntries(Object.keys(cams).map((r) => [r, { fault: null, t: 0, raised: false, clear: 0 }]));
    this.camRest = Object.fromEntries(Object.entries(cams).map(([r, c]) => [r, c.cam.quaternion.clone()]));
    this.meshRest = Object.fromEntries(Object.keys(cams).map((r) => [r, mesh(r)?.quaternion.clone()]));
  }

  static FAULT = { occluded: 'covered', moved: 'knocked', defocused: 'blurred' };

  get(role) {
    return this.state[role];
  }

  set(role, kind) {
    const h = this.state[role];
    if (!h) return;
    h.fault = kind;
    h.t = 0;
    h.clear = 0;
    const cam = this.cams[role].cam;
    cam.quaternion.copy(this.camRest[role]);
    const m = this.mesh(role);
    if (m && this.meshRest[role]) m.quaternion.copy(this.meshRest[role]);
    if (kind === 'moved') {
      // Knocked: turned off its aim, as a bump with a ladder would.
      cam.rotateY(0.5);
      cam.rotateX(-0.15);
      m?.rotateY(0.5);
    }
    cam.updateMatrixWorld();
    const name = role.replace('_', ' ');
    this.event(kind ? `camera ${name} ${CameraHealth.FAULT[kind]}` : `camera ${name} put right`);
  }

  tick(dt) {
    for (const [role, h] of Object.entries(this.state)) {
      const name = role.replace('_', ' ');
      if (h.fault) {
        h.t += dt;
        if (!h.raised && h.t >= this.raise) {
          h.raised = true;
          this.onRaise(role, h.fault);
          this.event(`camera_health · ${name} · ${h.fault} · its counts marked suspect`);
        }
      } else if (h.raised) {
        h.clear += dt;
        if (h.clear >= this.clear) {
          h.raised = false;
          this.event(`camera_health · ${name} · clear`);
        }
      }
    }
  }

  text(role) {
    const h = this.state[role];
    if (!h) return 'ok';
    if (h.fault && h.raised) return `${h.fault} · raised`;
    if (h.fault) return `${h.fault}? ${Math.floor(h.t)} of ${this.raise} s`;
    if (h.raised) return `clearing · ${Math.floor(h.clear)} of ${this.clear} s`;
    return 'ok';
  }

  /** Cameras still giving a picture (not covered or blurred). */
  working() {
    return Object.entries(this.cams).filter(([r]) => !['occluded', 'defocused'].includes(this.state[r].fault)).map(([, c]) => c.cam);
  }
}

/** Each camera's frustum in the scene, and its name above it. */
export function drawFrustums(lines, labels, cams, { selected = null, color = () => '#a1a1aa', name = (r) => r.replace('_', ' ') } = {}) {
  const up0 = new Vector3(0, 1, 0);
  for (const [role, c] of Object.entries(cams)) {
    const col = hexGlow(color(role), role === selected ? 1.6 : 0.9);
    const f = c.look.clone().sub(c.pos).normalize();
    const right = new Vector3().crossVectors(f, up0).normalize();
    const up = new Vector3().crossVectors(right, f).normalize();
    const L = role === selected ? 1.3 : 0.7;
    const spread = Math.tan((c.fov * Math.PI) / 360);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) =>
      c.pos.clone().addScaledVector(f, L).addScaledVector(right, sx * spread * L).addScaledVector(up, (sy * spread * L * 9) / 16)
    );
    for (const q of corners) lines.seg(c.pos.x, c.pos.y, c.pos.z, q.x, q.y, q.z, col);
    lines.poly(corners.map((q) => [q.x, q.y, q.z]), col, true);
    labels.set(`cam_${role}`, { text: name(role), tone: role === selected ? 'plain' : 'grey', at: [c.pos.x, c.pos.y + 0.18, c.pos.z] });
  }
}

/** How many of `people` a camera has in its picture. */
export function countInView(cam, people) {
  if (!cam) return 0;
  const v = new Vector3();
  return people.filter((a) => a.visible && (v.set(a.pos.x, 0.8, a.pos.y).project(cam), v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1)).length;
}

/**
 * A camera's own picture in the picture-in-picture (the engine has already
 * drawn the view into `g`): what a fault does to it (covered, it goes flat;
 * blurred, soft), the detections, any lines the role draws on its picture,
 * the header (name and time) and the health band.
 * @param {{ cam, health?: object, healthText?: string, items: object[], header: string,
 *           floorLines?: { pts: number[][], color: string }[] }} o
 */
export function drawCctv(g, w, h, { cam, health = null, healthText = '', items, header, floorLines = [] }) {
  if (health?.fault === 'occluded') {
    g.fillStyle = '#121214';
    g.fillRect(0, 0, w, h);
  } else if (health?.fault === 'defocused') {
    g.filter = `blur(${Math.max(3, w / 90)}px)`;
    g.drawImage(g.canvas, 0, 0);
    g.filter = 'none';
  }
  const blind = health?.fault === 'occluded' || health?.fault === 'defocused';
  if (!blind) drawDetections(g, w, h, cam, items, { px: w / 520 });
  g.lineWidth = Math.max(1.5, w / 400);
  const v = new Vector3();
  for (const { pts, color } of floorLines) {
    g.strokeStyle = color;
    g.beginPath();
    pts.forEach(([x, z], i) => {
      v.set(x, 0.01, z).project(cam);
      const px = ((v.x + 1) / 2) * w;
      const py = ((1 - v.y) / 2) * h;
      if (i) g.lineTo(px, py);
      else g.moveTo(px, py);
    });
    g.stroke();
  }
  g.fillStyle = 'rgba(5,5,6,0.6)';
  g.fillRect(0, 0, w, Math.round(w / 26));
  g.font = `500 ${Math.round(w / 48)}px "Geist Mono Variable", monospace`;
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#e4e4e7';
  g.fillText(header, 8, Math.round(w / 38));
  if (health?.fault || health?.raised) {
    const band = Math.round(w / 22);
    const raised = health.raised && health.fault;
    g.fillStyle = raised ? 'rgba(251,191,36,0.92)' : 'rgba(5,5,6,0.7)';
    g.fillRect(0, h - band, w, band);
    g.fillStyle = raised ? '#1a1406' : '#e4e4e7';
    g.fillText(raised ? `camera_health: ${health.fault} · counts from this camera marked suspect` : `camera_health: ${healthText}`, 8, h - band * 0.3);
  }
}

/**
 * The evidence a camera keeps for an alert: a clip of `before` s before and
 * `after` s after at `fps` (retail's security clips), or, with before and
 * after both 0, the one still taken at the alert (a screenshot with the
 * boxes drawn). `record(dt, now)` each frame; `start(cam, who)` when someone
 * starts to be watched; `flag(now)` when the alert is raised.
 */
export class Evidence {
  constructor({ before = 5, after = 8, fps = 6, width = 256, height = 144, draw = null } = {}) {
    Object.assign(this, { before, after, fps, width, height, draw });
    this.cam = null;
    this.frames = [];
    this.recording = false;
    this.flagAt = 0;
    this.play = null;
    this.who = null;
    this.clock = 0;
  }

  start(cam, who = null) {
    this.cam = cam;
    this.who = who;
    this.frames = [];
    this.flagAt = 0;
    this.recording = true;
  }

  flag(now) {
    this.flagAt = now;
  }

  get still() {
    return this.before === 0 && this.after === 0;
  }

  /** One frame of the camera's view, with the scene's boxes drawn by `draw(g, w, h, cam)`. */
  shoot(slot, scene, reuse = null) {
    const c = reuse ?? document.createElement('canvas');
    c.width = this.width;
    c.height = this.height;
    const g = c.getContext('2d');
    this.cam.aspect = this.width / this.height;
    this.cam.updateProjectionMatrix();
    slot.engine.drawView(scene, this.cam, g, c.width, c.height, { blur: false, cctv: 1, vignette: 0.55, sat: 1 });
    this.draw?.(g, c.width, c.height, this.cam, this.who);
    return c;
  }

  record(dt, now, slot, scene) {
    if (!this.recording || !this.cam || !slot.engine) return;
    if (this.still) {
      // A screenshot: taken once, at the alert.
      if (this.flagAt) {
        this.frames = [{ c: this.shoot(slot, scene), t: now }];
        this.recording = false;
      }
      return;
    }
    this.clock += dt;
    if (this.clock < 1 / this.fps) return;
    this.clock = 0;
    const max = (this.before + this.after) * this.fps;
    this.frames.push({ c: this.shoot(slot, scene, this.frames.length >= max ? this.frames.shift().c : null), t: now });
    // Only the `before` seconds until the alert; then `after` seconds more.
    if (!this.flagAt) while (this.frames.length > this.before * this.fps) this.frames.shift();
    if (this.flagAt && now > this.flagAt + this.after) this.recording = false;
  }

  /** The evidence in the picture-in-picture: the clip frame by frame with its time bar, or the still. */
  drawPip(g, w, h, caption) {
    const n = this.frames.length;
    if (!n) {
      g.fillStyle = '#0b0b0e';
      g.fillRect(0, 0, w, h);
      return;
    }
    this.play = (this.play ?? 0) + 1;
    const i = this.play % n;
    const f = this.frames[i];
    const rel = f.t - this.flagAt;
    this.drawFrame(g, w, h, i, {
      caption: caption ?? (this.still ? 'EVIDENCE · the still taken at the alert' : `EVIDENCE CLIP · ${this.before} s before, ${this.after} s after · ${this.fps} fps · ${rel < 0 ? '' : '+'}${rel.toFixed(1)} s`),
      bar: n > 1 ? '#fb6f8a' : null,
    });
  }

  /**
   * Frame `i` of what was recorded, filling the picture, with a caption band
   * and a bar along the bottom showing how far through the recording it is
   * (`bar`: its colour, or null for none).
   */
  drawFrame(g, w, h, i, { caption = '', bar = '#fb6f8a' } = {}) {
    const n = this.frames.length;
    g.fillStyle = '#0b0b0e';
    g.fillRect(0, 0, w, h);
    if (!n) return;
    g.drawImage(this.frames[i].c, 0, 0, w, h);
    const band = Math.round(w / 22);
    g.fillStyle = 'rgba(5,5,6,0.72)';
    g.fillRect(0, h - band, w, band);
    if (bar) {
      g.fillStyle = bar;
      g.fillRect(0, h - 3, (w * (i + 1)) / n, 3);
    }
    g.fillStyle = '#e4e4e7';
    g.font = `500 ${Math.round(w / 48)}px "Geist Mono Variable", monospace`;
    g.fillText(caption, 8, h - band * 0.3);
  }
}
