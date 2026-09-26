/**
 * One WebGL renderer for every diorama on the page.
 *
 * Browsers cap WebGL contexts (around 8-16) and cannot share geometry or
 * shaders between them, so ten scenes must not mean ten contexts. And the
 * project cards are pinned, scaled, dimmed by a scrim and faded while the next
 * card slides over them, so a single canvas laid over the page would paint on
 * top of the card that should cover it.
 *
 * So: one detached renderer draws each visible diorama in turn, and each
 * result is copied (drawImage) into that card's own 2D canvas, which lives
 * inside the card and obeys its transforms, opacity, clipping and stacking.
 * Every copy happens in the same task as its render, so preserveDrawingBuffer
 * is not needed.
 *
 * The loop is the site's gsap.ticker (after Lenis, ScrollTrigger and the hero),
 * and runs only while at least one diorama is live, active and on screen.
 */
import { NeutralToneMapping, PCFShadowMap, SRGBColorSpace, WebGLRenderer } from 'three';

import { gsap } from '../core/motion.js';
import { Post } from './post.js';

const MAX_PER_FRAME = 3;
const bucket = (n) => Math.ceil(n / 64) * 64;

class Engine {
  constructor() {
    this.slots = new Set();
    this.ticking = false;
    this.lost = false;
    this.stats = { frames: 0, lastMs: 0, avgMs: 0, slow: 0, window: 0 };
    this.quality = 0; // 0 best; each step trades detail for frame time
    this.renderer = new WebGLRenderer({
      antialias: false, // the scene target is multisampled; the composite needs none
      alpha: false,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: !/[?&]3d=(force|cal)\b/.test(location.search),
    });
    const r = this.renderer;
    r.setPixelRatio(1); // sizes are device pixels already
    r.toneMapping = NeutralToneMapping;
    r.outputColorSpace = SRGBColorSpace;
    r.info.autoReset = false;
    // Figures and moving pieces cast real shadows onto the baked floor (the
    // static set's shadows are in its lightmap already).
    r.shadowMap.enabled = true;
    r.shadowMap.type = PCFShadowMap;
    this.canvasSize = { w: 0, h: 0 };
    this.post = new Post(r, { msaa: 4 });
    this.tick = this.tick.bind(this);

    const c = r.domElement;
    c.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
      for (const s of this.slots) s.onContextLost();
      this.stop();
    });
    c.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.post.disposeTargets();
      this.post.size.set(0, 0);
      this.canvasSize = { w: 0, h: 0 };
      for (const s of this.slots) s.onContextRestored();
      this.wake();
    });
    this.onVisibility = () => (document.hidden ? this.stop() : this.wake());
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  ensureCanvas(w, h) {
    if (w <= this.canvasSize.w && h <= this.canvasSize.h) return;
    const W = bucket(Math.max(w, this.canvasSize.w));
    const H = bucket(Math.max(h, this.canvasSize.h));
    this.renderer.setSize(W, H, false);
    this.canvasSize = { w: W, h: H };
  }

  add(slot) {
    this.slots.add(slot);
    this.wake();
  }

  remove(slot) {
    this.slots.delete(slot);
    if (!this.slots.size) this.stop();
  }

  /** Start the loop if any slot wants frames. */
  wake() {
    if (this.lost || document.hidden || this.ticking) return;
    if (![...this.slots].some((s) => s.wantsFrames)) return;
    this.ticking = true;
    gsap.ticker.add(this.tick);
  }

  stop() {
    if (!this.ticking) return;
    this.ticking = false;
    gsap.ticker.remove(this.tick);
  }

  tick(time, deltaMs) {
    const dt = Math.min(0.05, Math.max(0, deltaMs / 1000));
    this.frame(dt);
  }

  /** Render every slot that wants a frame (at most MAX_PER_FRAME), by priority. */
  frame(dt) {
    const want = [...this.slots].filter((s) => s.wantsFrames);
    if (!want.length) return this.stop();
    want.sort((a, b) => b.priority - a.priority);
    const t0 = performance.now();
    this.renderer.info.reset();
    for (const s of want.slice(0, MAX_PER_FRAME)) {
      s.update(dt);
      this.draw(s);
    }
    this.measure(performance.now() - t0);
  }

  draw(slot) {
    const { w, h } = slot.px;
    if (!w || !h) return;
    this.ensureCanvas(w, h);
    this.post.render(slot.scene, slot.camera, w, h, { ...slot.postParams, ...this.qualityPost() });
    // WebGL's origin is bottom-left: the w x h we drew sits at the bottom of
    // the renderer's canvas, rows H-h..H from the top.
    slot.ctx.drawImage(this.renderer.domElement, 0, this.canvasSize.h - h, w, h, 0, 0, w, h);
    // Flat overlays on the finished frame (detection boxes), crisp at these pixels.
    slot.controller?.draw2d?.(slot.ctx, w, h, slot.camera);
    slot.frames++;
  }

  /**
   * A second view of a scene (a CCTV picture for a chapter) into any 2D
   * canvas, through the same post chain with its own look.
   */
  drawView(scene, camera, ctx, w, h, params = {}) {
    if (this.lost || !w || !h) return;
    this.ensureCanvas(w, h);
    this.post.render(scene, camera, w, h, params);
    ctx.drawImage(this.renderer.domElement, 0, this.canvasSize.h - h, w, h, 0, 0, w, h);
  }

  qualityPost() {
    return this.quality >= 2 ? { blur: false } : {};
  }

  /**
   * Frames that keep running slow step quality down, never back up in a visit
   * (KPS adapt()): 1 = lower pixel density, 2 = no blur, 3 = density floor.
   */
  measure(ms) {
    const s = this.stats;
    s.frames++;
    s.lastMs = ms;
    s.avgMs = s.avgMs ? s.avgMs * 0.95 + ms * 0.05 : ms;
    s.window++;
    if (ms > 22) s.slow++;
    if (s.window < 45) return;
    if (s.slow > 30 && this.quality < 3) {
      this.quality++;
      for (const sl of this.slots) sl.onQuality(this.quality);
    }
    s.window = 0;
    s.slow = 0;
  }

  /** QA: run n frames synchronously (works even when rAF is paused). */
  step(n = 1, dt = 1 / 60) {
    for (let i = 0; i < n; i++) {
      const want = [...this.slots].filter((s) => s.live && s.active);
      for (const s of want) {
        s.update(dt);
        this.draw(s);
      }
    }
  }

  info() {
    const i = this.renderer.info;
    return {
      slots: this.slots.size,
      live: [...this.slots].filter((s) => s.live).length,
      ticking: this.ticking,
      quality: this.quality,
      avgMs: +this.stats.avgMs.toFixed(2),
      calls: i.render.calls,
      triangles: i.render.triangles,
      geometries: i.memory.geometries,
      textures: i.memory.textures,
      programs: i.programs?.length ?? 0,
      canvas: { ...this.canvasSize },
    };
  }

  loseContext() {
    this.renderer.getContext().getExtension('WEBGL_lose_context')?.loseContext();
  }

  restoreContext() {
    this.renderer.getContext().getExtension('WEBGL_lose_context')?.restoreContext();
  }
}

let engine = null;

export function getEngine() {
  if (!engine) {
    engine = new Engine();
    if (import.meta.env.DEV || /[?&]qa\b/.test(location.search)) {
      window.__three = engine;
    }
  }
  return engine;
}
