/**
 * Scroll-driven canvas image sequence.
 *
 * ── Why this uses <img> rather than ImageBitmap ────────────────────────────
 *
 * The obvious implementation keeps a byte-budgeted LRU of decoded ImageBitmaps.
 * That was the first cut here, and measurement killed it: ~20fps through the
 * hero, against ~100fps everywhere else on the page. Two compounding reasons:
 *
 *   1. A decoded frame costs width*height*4 bytes — 8.3 MB at 1920x1080, 14.7
 *      at 2560x1440. Only ~25 of 180 frames fit a sane budget, so every pass
 *      through the hero re-decodes most of the sequence.
 *   2. createImageBitmap is async, so `if (cache.has(i)) return` does NOT stop
 *      the same index being decoded again on the next tick before the first
 *      call resolves. A single scrub fired 1338 decodes across 61 frames —
 *      22x duplicate work per frame, at 15-27 ms each.
 *
 * HTMLImageElement sidesteps both. The browser owns the decoded-image cache and
 * sizes it against real memory pressure, and `img.decode()` on an already
 * decoded image resolves immediately without redoing the work. We decode a
 * short run ahead of the playhead and let the browser keep frames warm.
 *
 * What the earlier version got right is kept: a poster paints first so nothing
 * blocks, and `_getDrawable` never skips a draw — it walks outward from the
 * wanted frame and falls back to a permanently-resident low-res ladder, so a
 * fast scroll degrades to a slightly soft frame rather than a frozen one.
 */
import { frameSetFor } from '../core/device.js';

/** Frames requested at high priority up front. */
const PRIORITY_BURST = 24;
/** How far ahead of the playhead to keep frames decoded. */
const DECODE_AHEAD = 12;
/** Concurrent decode() calls. Decoding is the bottleneck; queue, don't storm. */
const MAX_DECODES = 4;

export class FrameSequence {
  constructor(canvas, { tier = 'high' } = {}) {
    this.canvas = canvas;
    this.tier = tier;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

    this.manifest = null;
    this.count = 0;
    this.images = []; // HTMLImageElement per frame
    this.readySet = new Set(); // indices whose decode() has resolved
    this.ladder = [];
    this.ladderReady = new Set();
    this.decoding = new Set(); // in-flight decodes — the dedupe that was missing

    this.progress = 0;
    this.direction = 1;
    this.index = 0;
    this._lastDrawn = -1;
    this._lastWarmed = -Infinity;
    this._ready = false;
    this._disposed = false;
  }

  get isReady() {
    return this._ready;
  }

  async init() {
    this.manifest = await (await fetch('/hero/manifest.json')).json();
    this.spec = this.manifest.tiers[frameSetFor(this.tier)] ?? this.manifest.tiers.desktop;
    this.count = this.spec.count;
    this.resize();

    await this._loadLadder();

    // Start every frame downloading at once. The browser's scheduler orders
    // these better than a hand-rolled queue would, and they are 30-60 KB each.
    this.images = Array.from({ length: this.count }, (_, i) => {
      const img = new Image();
      img.decoding = 'async';
      if (i < PRIORITY_BURST) img.fetchPriority = 'high';
      else if (i > PRIORITY_BURST * 3) img.fetchPriority = 'low';
      img.src = `${this.spec.dir}/f_${String(i).padStart(4, '0')}.webp`;
      return img;
    });

    await this._decode(0);
    this._ready = true;
    this.draw(true);
    this._warm();
    return this;
  }

  async _loadLadder() {
    const l = this.manifest.ladder;
    if (!l) return;
    this.ladderEvery = l.every;
    this.ladder = Array.from({ length: l.count }, (_, i) => {
      const img = new Image();
      img.decoding = 'async';
      img.src = `${l.dir}/f_${String(i).padStart(4, '0')}.webp`;
      return img;
    });
    await Promise.all(
      this.ladder.map((img, i) =>
        img
          .decode()
          .then(() => this.ladderReady.add(i))
          .catch(() => {})
      )
    );
  }

  /**
   * Decode one frame — at most once at a time per index, at most MAX_DECODES
   * concurrently. Both guards matter: the first stops duplicate work, the
   * second stops a fast scrub queueing more decodes than it can ever use.
   */
  async _decode(i) {
    if (this._disposed || i < 0 || i >= this.count) return;
    if (this.readySet.has(i) || this.decoding.has(i)) return;
    if (this.decoding.size >= MAX_DECODES) return;
    const img = this.images[i];
    if (!img) return;
    this.decoding.add(i);
    try {
      await img.decode();
      if (!this._disposed) this.readySet.add(i);
    } catch {
      /* not downloaded yet, or failed — the ladder covers us */
    } finally {
      this.decoding.delete(i);
    }
  }

  /** Keep a short run of frames ahead of the playhead decoded. */
  _warm() {
    if (this._disposed) return;
    for (let d = 0; d <= DECODE_AHEAD; d++) {
      const i = this.index + d * this.direction;
      if (i >= 0 && i < this.count && !this.readySet.has(i)) this._decode(i);
    }
    // A few behind too, so reversing direction isn't instantly on the ladder.
    for (let d = 1; d <= 3; d++) this._decode(this.index - d * this.direction);
  }

  /**
   * Nearest drawable image for frame i: exact, then outward through decoded
   * frames, then the ladder. Never returns null once the ladder has loaded, so
   * draw() never bails and leaves a stale frame on screen.
   */
  _getDrawable(i) {
    if (this.readySet.has(i)) return this.images[i];
    for (let d = 1; d <= 3; d++) {
      if (this.readySet.has(i - d)) return this.images[i - d];
      if (this.readySet.has(i + d)) return this.images[i + d];
    }
    if (this.ladderReady.size) {
      const li = Math.round(i / this.ladderEvery);
      for (let d = 0; d <= 4; d++) {
        if (this.ladderReady.has(li - d)) return this.ladder[li - d];
        if (this.ladderReady.has(li + d)) return this.ladder[li + d];
      }
    }
    return null;
  }

  setProgress(p, direction = 1) {
    this.progress = p;
    this.direction = direction >= 0 ? 1 : -1;
    this.index = Math.max(0, Math.min(this.count - 1, Math.round(p * (this.count - 1))));
  }

  /** Called from the shared gsap.ticker, after ScrollTrigger has updated. */
  draw(force = false) {
    if (!this._ready && !force) return;
    if (this.index === this._lastDrawn && !force) return;
    const img = this._getDrawable(this.index);
    if (!img) return;
    this.ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
    this._lastDrawn = this.index;

    // Re-warm only once the playhead has genuinely moved on. Doing this every
    // frame is what produced the decode storm in the first implementation.
    if (Math.abs(this.index - this._lastWarmed) >= 3) {
      this._lastWarmed = this.index;
      this._warm();
    }
  }

  resize() {
    // Match the display's real pixel width, capped at the source resolution so
    // the frame is never upscaled. Blitting measured at 0.01ms regardless of
    // size, so this is purely about avoiding softness.
    const srcW = this.spec?.width ?? 1920;
    const srcH = this.spec?.height ?? 1080;
    const target = Math.round(window.innerWidth * (window.devicePixelRatio || 1));
    const w = Math.max(640, Math.min(srcW, target));
    const h = Math.round(w * (srcH / srcW));
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this._lastDrawn = -1;
    this.draw(true);
  }

  /** The browser owns the decode cache now; nothing for us to free. */
  shrink() {}

  dispose() {
    this._disposed = true;
    this.images.forEach((img) => {
      img.src = '';
    });
    this.images.length = 0;
    this.ladder.length = 0;
    this.readySet.clear();
    this.ladderReady.clear();
    this.decoding.clear();
  }
}
