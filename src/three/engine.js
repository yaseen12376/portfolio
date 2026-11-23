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
 * Each frame's step is the time between the browser's own frames (the
 * timestamps it hands requestAnimationFrame), not between when the ticker
 * happened to run: even steps, so motion is even.
 */
import { NeutralToneMapping, PCFShadowMap, SRGBColorSpace, WebGLRenderer } from 'three';

import { gsap } from '../core/motion.js';
import { Post } from './post.js';

const MAX_PER_FRAME = 3;
const bucket = (n) => Math.ceil(n / 64) * 64;
/** A frame that costs more than this leaves no room for 60 a second (the page's own compositing needs the rest). */
const SLOW_MS = 14.5;
/** Frames the quality loop ignores after it starts or a scene joins (uploads, first draws), or after a step. */
const WARMUP = 40;
const WINDOW = 45;
/** Windows in a row with at most a frame late before quality steps back up one: about half a minute at 60 a second. */
const RECOVER = 40;

/**
 * GPU time per frame, where the browser measures it
 * (EXT_disjoint_timer_query_webgl2). Not what decides that frames are slow (a
 * GPU with work to spare clocks down, and its time grows to fill the frame,
 * on time), but how far over they are when they are, and for QA. Results
 * come a frame or two late; null where there is no timer.
 */
function gpuTimer(gl) {
  const ext = gl?.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return null;
  let pending = [];
  let open = null;
  return {
    begin() {
      if (open || pending.length > 3) return;
      open = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, open);
    },
    end() {
      if (!open) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(open);
      open = null;
    },
    /** The GPU time (ms) of each frame that has finished since the last call, into `out`. */
    poll(out) {
      // (A disjoint event, a GPU reset or a clock change, spoils whatever was in flight.)
      const spoilt = gl.getParameter(ext.GPU_DISJOINT_EXT);
      while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const q = pending.shift();
        if (!spoilt) out.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(q);
      }
      if (spoilt) {
        for (const q of pending) gl.deleteQuery(q);
        pending = [];
      }
    },
    /** After a lost context: the queries went with it. */
    reset() {
      pending = [];
      open = null;
    },
  };
}

class Engine {
  constructor() {
    this.slots = new Set();
    this.ticking = false;
    this.lost = false;
    this.held = false;
    this.lastTs = 0;
    this.stats = { frames: 0, lastMs: 0, avgMs: 0, gpuMs: 0, slow: 0, late: 0, bad: 0, n: 0, warm: WARMUP, gaps: [], recent: [], hist: [], clean: 0, probe: 0, probeLate: 0, upped: false, recover: true };
    this.gpuDone = [];
    this.quality = 0; // 0 best; each step trades detail for frame time
    this.renderer = new WebGLRenderer({
      antialias: false, // the scene target is multisampled; the composite needs none
      alpha: false,
      powerPreference: 'high-performance',
      // QA without a GPU: ?3d=force skips the gate too, ?swgl only lets a
      // software renderer through (so a phone QA run still has to tap).
      failIfMajorPerformanceCaveat: !/[?&](3d=(force|cal)|swgl)\b/.test(location.search),
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
    this.timer = gpuTimer(r.getContext());
    this.tick = this.tick.bind(this);

    const c = r.domElement;
    c.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
      this.timer?.reset();
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
    this.stats.warm = WARMUP;
    this.stats.clean = 0; // a new scene's cost is its own: the quiet so far was another's
    this.wake();
  }

  remove(slot) {
    this.slots.delete(slot);
    if (!this.slots.size) this.stop();
  }

  /** Start the loop if any slot wants frames. */
  wake() {
    if (this.lost || this.held || document.hidden || this.ticking) return;
    if (![...this.slots].some((s) => s.wantsFrames)) return;
    this.ticking = true;
    this.lastTs = 0;
    this.stats.warm = Math.max(this.stats.warm, WARMUP / 2);
    gsap.ticker.add(this.tick);
  }

  stop() {
    if (!this.ticking) return;
    this.ticking = false;
    gsap.ticker.remove(this.tick);
  }

  /**
   * QA: frames come only from frame() and step() calls, none from the page's
   * loop (a recording steps them one at a time, at 60 a second of its own time).
   */
  hold(on) {
    this.held = !!on;
    if (this.held) this.stop();
    else this.wake();
  }

  tick(time, deltaMs, frame, ts) {
    // The browser's frame time where the ticker passes it on (gsap hands its
    // listeners the requestAnimationFrame timestamp), else the ticker's own.
    let ms = deltaMs;
    if (typeof ts === 'number' && ts > 100) {
      const d = ts - this.lastTs;
      if (this.lastTs && d > 0 && d < 250) ms = d;
      this.lastTs = ts;
    }
    const dt = Math.min(0.05, Math.max(0, ms / 1000));
    this.frame(dt);
  }

  /** Render every slot that wants a frame (at most MAX_PER_FRAME), by priority. */
  frame(dt) {
    const want = [...this.slots].filter((s) => s.wantsFrames);
    if (!want.length) return this.stop();
    want.sort((a, b) => b.priority - a.priority);
    const t0 = performance.now();
    this.renderer.info.reset();
    this.timer?.begin();
    for (const s of want.slice(0, MAX_PER_FRAME)) {
      s.update(dt);
      this.draw(s);
    }
    this.timer?.end();
    this.measure(performance.now() - t0, dt * 1000);
  }

  draw(slot) {
    const { w, h } = slot.px;
    if (!w || !h) return;
    this.ensureCanvas(w, h);
    // A scene can draw something over itself that looks through it (a jar's glass).
    const overlay = slot.controller?.overlay ?? null;
    this.post.render(slot.scene, slot.camera, w, h, { ...slot.postParams, ...this.qualityPost(), overlay });
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
   * Frames that keep coming late step quality down (KPS adapt()): 1 = lower
   * pixel density, 2 = no blur (a jar: a coarser look through its glass),
   * 3 = density floor (a jar: its shadow map half as fine too). Late is a
   * frame that came more than a display frame and a half after the last
   * (the display's interval: the shortest gap of
   * late, taken as no shorter than 60 Hz's, so it never asks for more than 60
   * a second): the GPU fell behind, or the CPU did. A quarter of a window's
   * frames late is a stutter anyone sees; two such windows in a row step (one
   * alone may be the page busy with something else), and so does one with
   * most of its frames late, or over the budget on the CPU. Far over (the
   * GPU's own time half as much again as the budget, or most frames late), it
   * steps twice at once. A steady judder steps too: more than one frame in
   * twelve late over the last three seconds (a turn that skips every tenth
   * frame is plain to see, though no single window looks bad).
   *
   * Back up a step after about half a minute with at most a frame late in
   * any window: what was slow may have been passing (another tab or app on
   * the same GPU, a page loading beside it), and a visit should not keep its
   * worst moment. A step up is judged on its first two windows: more than one
   * frame in twenty late (perf.mjs's bar) and it is undone at once (under two
   * seconds of it). That, or a step down after any step up, means this
   * machine is at its edge: no more steps up in the visit, so it never
   * see-saws.
   */
  measure(cpuMs, gapMs) {
    const s = this.stats;
    s.frames++;
    s.lastMs = cpuMs;
    s.avgMs = s.avgMs ? s.avgMs * 0.95 + cpuMs * 0.05 : cpuMs;
    if (this.timer) {
      const done = this.gpuDone;
      done.length = 0;
      this.timer.poll(done);
      for (const g of done) {
        s.gpuMs = s.gpuMs ? s.gpuMs * 0.9 + g * 0.1 : g;
        s.recent.push(g);
        if (s.recent.length > 120) s.recent.shift();
      }
    }
    const gaps = s.gaps;
    gaps.push(gapMs);
    if (gaps.length > 90) gaps.shift();
    const display = Math.max(Math.min(...gaps), 1000 / 60);
    this.sample(cpuMs, gaps.length > 20 && gapMs > display * 1.45);
  }

  sample(cpuMs, late) {
    const s = this.stats;
    if (s.warm > 0) {
      s.warm--;
      return;
    }
    s.n++;
    if (cpuMs > SLOW_MS) s.slow++;
    if (late) s.late++;
    if (s.n < WINDOW) return;
    const stutter = s.late > WINDOW * 0.25;
    s.bad = stutter ? s.bad + 1 : 0;
    const most = s.late > WINDOW * 0.6 || s.slow > WINDOW * 0.6;
    // The last four windows (three seconds): a judder steady enough to see.
    s.hist.push(s.late);
    if (s.hist.length > 4) s.hist.shift();
    const uneven = s.hist.length === 4 && s.hist.reduce((a, b) => a + b, 0) > WINDOW * 4 / 12;
    // A step up on trial: its first two windows.
    const trial = s.probe > 0;
    if (trial) {
      s.probe--;
      s.probeLate += s.late;
    }
    if (trial && (s.probeLate > WINDOW * 2 * 0.05 || s.slow > WINDOW * 0.25)) {
      // The step up brought frames late: back to where it was, for good.
      s.recover = false;
      s.probe = 0;
      this.setQuality(this.quality + 1);
    } else if ((most || s.bad >= 2 || uneven) && this.quality < 3) {
      const r = s.recent.slice(-WINDOW).sort((a, b) => a - b);
      const far = s.late > WINDOW * 0.6 || (r.length > 10 && r[r.length >> 1] > SLOW_MS * 1.6);
      if (s.upped) s.recover = false;
      s.probe = 0;
      this.setQuality(Math.min(3, this.quality + (far ? 2 : 1)));
    } else if (s.late <= 1 && s.slow === 0) {
      if (++s.clean >= RECOVER && s.recover && this.quality > 0) {
        this.setQuality(this.quality - 1);
        s.upped = true;
        s.probe = 2;
        s.probeLate = 0;
      }
    } else s.clean = 0;
    s.n = 0;
    s.slow = 0;
    s.late = 0;
  }

  /** Every slot redrawn at quality q, and the loop's counts started over (the step's first frames re-upload). */
  setQuality(q) {
    const s = this.stats;
    this.quality = q;
    for (const sl of this.slots) sl.onQuality(q);
    s.warm = WARMUP / 2;
    s.bad = 0;
    s.clean = 0;
    s.hist.length = 0;
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
    // The last two seconds or so of GPU times: the middle and the slow end.
    const r = [...this.stats.recent].sort((a, b) => a - b);
    const at = (f) => (r.length ? +r[Math.min(r.length - 1, Math.floor(r.length * f))].toFixed(2) : 0);
    return {
      slots: this.slots.size,
      live: [...this.slots].filter((s) => s.live).length,
      ticking: this.ticking,
      quality: this.quality,
      avgMs: +this.stats.avgMs.toFixed(2),
      gpuMs: +this.stats.gpuMs.toFixed(2),
      gpu: { p50: at(0.5), p90: at(0.9), n: r.length },
      timer: !!this.timer,
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
