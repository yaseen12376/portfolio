/**
 * Text in the scene (track IDs, dwell timers, confidences) as real DOM, laid
 * over the diorama's canvas and positioned by projecting a 3D anchor each
 * frame. Crisp at any pixel ratio, selectable by nothing (pointer-events off),
 * and cheap: only transforms change per frame, text only when it changes.
 *
 * The layer lives inside the media box, so it moves, fades and clips with the
 * card exactly as the canvas does.
 */
import { Vector3 } from 'three';

const v = new Vector3();

export class Labels {
  /** @param {HTMLElement} media */
  constructor(media) {
    this.root = document.createElement('div');
    this.root.className = 'd3-labels';
    this.root.setAttribute('aria-hidden', 'true');
    media.appendChild(this.root);
    this.items = new Map();
    this.seen = new Set();
  }

  /** Call once per frame before set(): labels not set this frame are hidden. */
  begin() {
    this.seen.clear();
  }

  /**
   * @param {string} key
   * @param {{ text: string, at: Vector3 | number[], tone?: string, sub?: string }} o
   *   tone: 'violet' | 'turq' | 'red' | 'amber' | 'grey'
   */
  set(key, o) {
    let it = this.items.get(key);
    if (!it) {
      const el = document.createElement('div');
      el.className = 'd3-label';
      el.innerHTML = '<span class="d3-label-t"></span><span class="d3-label-s"></span>';
      this.root.appendChild(el);
      it = { el, t: el.firstChild, s: el.lastChild, text: null, sub: null, tone: null, at: new Vector3() };
      this.items.set(key, it);
    }
    if (it.text !== o.text) it.t.textContent = it.text = o.text;
    const sub = o.sub ?? '';
    if (it.sub !== sub) {
      it.s.textContent = it.sub = sub;
      it.s.hidden = !sub;
    }
    const tone = o.tone ?? 'violet';
    if (it.tone !== tone) {
      it.el.dataset.tone = it.tone = tone;
    }
    if (Array.isArray(o.at)) it.at.set(o.at[0], o.at[1], o.at[2]);
    else it.at.copy(o.at);
    it.priority = !!o.priority;
    this.seen.add(key);
    return it.el;
  }

  /**
   * Position everything set this frame; hide the rest. cssW/cssH: the media
   * box. Labels never pile up: nearer ones (and those marked `priority`) are
   * placed first, and one that would overlap a placed label waits its turn.
   */
  end(camera, cssW, cssH) {
    const show = [];
    for (const [key, it] of this.items) {
      if (!this.seen.has(key)) {
        if (!it.el.hidden) it.el.hidden = true;
        continue;
      }
      v.copy(it.at).project(camera);
      const off = v.z > 1 || v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2;
      if (off) {
        if (!it.el.hidden) it.el.hidden = true;
        continue;
      }
      it.x = Math.round(((v.x + 1) / 2) * cssW);
      it.y = Math.round(((1 - v.y) / 2) * cssH);
      it.depth = v.z - (it.priority ? 1 : 0);
      show.push(it);
    }
    show.sort((a, b) => a.depth - b.depth);
    const placed = [];
    for (const it of show) {
      // Size once per text change; the box sits above its anchor.
      if (it.w == null || it.sized !== it.text + it.sub) {
        it.el.hidden = false;
        it.w = it.el.offsetWidth || 60;
        it.h = it.el.offsetHeight || 18;
        it.sized = it.text + it.sub;
      }
      const box = [it.x - it.w / 2 - 3, it.y - it.h - 9, it.x + it.w / 2 + 3, it.y - 3];
      const hit = placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
      if (it.el.hidden !== hit) it.el.hidden = hit;
      if (hit) continue;
      placed.push(box);
      it.el.style.transform = `translate3d(${it.x}px, ${it.y}px, 0)`;
    }
  }

  remove(key) {
    this.items.get(key)?.el.remove();
    this.items.delete(key);
  }

  clear() {
    for (const it of this.items.values()) it.el.remove();
    this.items.clear();
  }

  dispose() {
    this.clear();
    this.root.remove();
  }
}
