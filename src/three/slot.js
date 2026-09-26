/**
 * A Slot is one diorama in one place on the page: a project card's media box
 * or a case study's hero. It owns a 2D <canvas> inside that box (the engine
 * copies frames into it), a label layer over it, the camera rig, the scene
 * controller and its chapters, and the pointer handling.
 *
 * State is mirrored to data attributes on the media element for CSS and QA:
 *   data-3d          idle | loading | live | paused | lost | error
 *   data-3d-toy      the scene's last reported state (e.g. "line:moved")
 *   data-3d-chapter  the chapter showing
 *   data-3d-frames   frames drawn (QA: proves the canvas is being fed)
 */
import { Raycaster, Vector2 } from 'three';

import { esc } from '../core/util.js';
import { CameraRig } from './camera-rig.js';
import { Chapters } from './chapters.js';
import { getEngine } from './engine.js';
import { Labels } from './overlays/labels.js';
import { loadPeople } from './people.js';
import { loadStage } from './stage.js';
import { SCENES } from './scenes/index.js';

const DRAG_PX = 6;

// Safe areas: a card keeps its top edge for the chapter caption chip; a case
// study keeps every control outside the canvas, so only a breathing margin.
const INSETS = {
  card: { t: 0.14, r: 0.03, b: 0.04, l: 0.03 },
  case: { t: 0.04, r: 0.04, b: 0.04, l: 0.04 },
};

export class Slot {
  /**
   * @param {HTMLElement} media  the .media box
   * @param {{ id: string, base: string, context: 'card'|'case', tier: string, resume?: object,
   *           meta?: { chapters?: object[], tour?: string[] }, onOpen?: (chapter?: string) => void,
   *           onLive?: (slot: Slot) => void }} opts
   */
  constructor(media, opts) {
    this.media = media;
    this.opts = opts;
    this.engine = getEngine();
    this.active = false;
    this.inView = false;
    this.live = false;
    this.frames = 0;
    this.px = { w: 0, h: 0 };
    this.css = { w: 0, h: 0 };
    this.time = 0;
    this.abort = new AbortController();
    this.state('loading');

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'media-3d';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    media.appendChild(this.canvas);

    const sig = { signal: this.abort.signal };
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(media);
    this.io = new IntersectionObserver(([e]) => {
      this.inView = e.isIntersecting;
      this.engine.wake();
    }, { rootMargin: '120px' });
    this.io.observe(media);
    this.bindPointer(sig);
  }

  get priority() {
    return (this.opts.context === 'case' ? 10 : 0) + (this.pointer?.down ? 5 : 0) + (this.active ? 1 : 0);
  }

  get wantsFrames() {
    return this.live && this.active && this.inView;
  }

  state(s) {
    this.media.dataset['3d'] = s;
  }

  async load() {
    const { id, base, context, tier } = this.opts;
    const small = tier !== 'high' || context === 'card-small';
    const [stage, people, mod] = await Promise.all([
      // Live shadows where the view is big enough to show them; a card keeps the
      // baked light and each figure's contact shadow, at half the cost.
      loadStage(this.engine.renderer, base, { small, signal: this.abort.signal, shadows: context === 'case' ? 2048 : 0 }),
      loadPeople(),
      (SCENES[id] ?? SCENES._default)(),
    ]);
    if (this.abort.signal.aborted) {
      stage.dispose();
      return;
    }
    this.stage = stage;
    this.scene = stage.scene;
    // A test fixture describes itself; a project's words come from its data.
    const meta = this.opts.meta ?? mod.meta ?? {};
    const hasChapters = !!meta.chapters?.length;
    this.rig = new CameraRig(stage.data.view, {
      ...(context === 'case' ? { maxYaw: 0.9, maxPitch: 0.25 } : {}),
      insets: this.opts.insets ?? (context === 'case' || !hasChapters ? INSETS.case : INSETS.card),
    });
    this.camera = this.rig.camera;
    this.postParams = { ...stage.data.post, ...(context === 'case' ? stage.data.post?.case : null) };
    this.labels = new Labels(this.media);
    this.controller = await mod.create({
      stage,
      people,
      rig: this.rig,
      context,
      slot: this,
      labels: this.labels,
      emit: (k, v) => this.toy(k, v),
      // QA runs the same scene from other random starts (the bench's ?seed=).
      seed: this.opts.seed,
    });
    if (this.opts.resume) this.controller.resume?.(this.opts.resume);
    if (hasChapters && this.controller.chapters) {
      this.chapters = new Chapters({ rig: this.rig, list: this.controller.chapters, meta: meta.chapters, tour: meta.tour, context, onEnter: (id) => this.controller.onChapter?.(id) });
      this.chapters.on((type, data) => {
        if (type !== 'chapter') return;
        this.media.dataset['3dChapter'] = data.id;
        this.showCaption(data);
      });
      this.chapters.go(this.opts.resume?.chapter ?? meta.tour?.[0] ?? this.chapters.list[0]?.id);
    }
    this.resize();
    // Compile shaders before the first visible frame: no stutter on arrival.
    await this.engine.renderer.compileAsync(this.scene, this.camera).catch(() => {});
    if (this.abort.signal.aborted) return;
    this.live = true;
    this.state(this.active ? 'live' : 'paused');
    this.engine.add(this);
    // Draw one frame now so the canvas has content before it fades in.
    this.engine.ensureCanvas(this.px.w, this.px.h);
    this.update(0);
    this.engine.draw(this);
    requestAnimationFrame(() => this.media.classList.add('is-3d-live'));
    this.opts.onLive?.(this);
  }

  /** A card's chapter caption: what the tour is showing right now. */
  showCaption(info) {
    if (this.opts.context === 'case' || !info?.title) return;
    if (!this.caption) {
      this.caption = document.createElement('div');
      this.caption.className = 'media-3d-caption';
      this.caption.setAttribute('aria-hidden', 'true');
      this.media.appendChild(this.caption);
    }
    const n = String(this.chapters.index + 1).padStart(2, '0');
    this.caption.innerHTML = `<span class="n">${n}</span><span class="t">${esc(info.title)}</span>`;
    this.caption.classList.remove('is-in');
    void this.caption.offsetWidth; // restart the entrance
    this.caption.classList.add('is-in');
    this.fitInsets();
  }

  /**
   * A card's top safe area: at least the caption chip's band. The chip is a
   * fixed size, so on a small card it takes a larger share of the height.
   */
  fitInsets() {
    if (this.opts.insets || this.opts.context === 'case' || !this.caption || !this.rig || !this.css) return;
    const band = (this.caption.offsetTop + this.caption.offsetHeight + 6) / this.css.h;
    const t = Math.max(INSETS.card.t, band);
    if (Math.abs(t - this.rig.insets.t) > 0.005) this.rig.setInsets({ ...INSETS.card, t });
  }

  /** Camera home, the current chapter restarted, fixtures where Blender put them. */
  reset() {
    this.controller?.reset?.();
    const ch = this.chapters?.current;
    if (ch) {
      ch.exit?.();
      ch.enter?.();
      this.rig.setShot(ch.shot ?? null);
    } else this.rig?.reset();
    this.toy('reset');
  }

  toggleFullscreen() {
    if (document.fullscreenElement === this.media) document.exitFullscreen?.();
    else this.media.requestFullscreen?.().catch(() => {});
  }

  toy(key, value) {
    this.media.dataset['3dToy'] = value == null ? key : `${key}:${value}`;
  }

  setActive(on) {
    this.active = on;
    if (this.live) this.state(on ? 'live' : 'paused');
    this.engine.wake();
  }

  dpr() {
    const cap = this.opts.context === 'case' ? 1.75 : 1.5;
    const q = this.engine.quality;
    const drop = q >= 3 ? 0.5 : q >= 1 ? 0.25 : 0;
    return Math.max(1, Math.min(devicePixelRatio || 1, cap) - drop);
  }

  resize() {
    // Layout size, not the bounding rect: a pinned stack card is scaled by a
    // transform while the next one slides over it, and that must not resize
    // (and re-render) the diorama every scroll frame.
    const cw = this.media.clientWidth;
    const ch = this.media.clientHeight;
    if (!cw || !ch) return;
    this.css = { w: cw, h: ch };
    // Before the size check: the observer's first call comes before the rig
    // exists, so the rig must still get the aspect when load() calls this.
    this.rig?.frame(cw / ch);
    this.fitInsets();
    const d = this.dpr();
    const w = Math.round(cw * d);
    const h = Math.round(ch * d);
    if (w === this.px.w && h === this.px.h) return;
    this.px = { w, h };
    this.canvas.width = w;
    this.canvas.height = h;
    if (this.live) {
      this.engine.ensureCanvas(w, h);
      this.engine.draw(this);
    }
  }

  onQuality() {
    this.px = { w: 0, h: 0 };
    this.resize();
  }

  update(dt) {
    this.time += dt;
    this.labels?.begin();
    this.controller?.update(dt, this.time);
    this.chapters?.update(dt);
    this.rig.update(dt);
    this.labels?.end(this.camera, this.css.w, this.css.h);
    this.drawPip(dt);
    this.media.dataset['3dFrames'] = String(this.frames);
  }

  /** The explorer's picture-in-picture canvas (null to stop). */
  setPip(canvas) {
    this.pip = canvas ? { canvas, ctx: canvas.getContext('2d', { alpha: false }), clock: Infinity } : null;
  }

  /**
   * A store camera's own picture, at that camera's frame rate: the scene
   * through the camera the controller names, with the CCTV look, then the
   * controller's 2D overlay (boxes and IDs, the way the product draws them).
   * Or, when the controller hands over an image (a screen's own canvas), that
   * image, fitted: legible where the screen in the scene is a few pixels.
   */
  drawPip(dt) {
    const view = this.pip && this.controller?.pip?.();
    if (!view) return;
    const p = this.pip;
    p.clock += dt;
    if (p.clock < 1 / (view.fps ?? 15)) return;
    p.clock = 0;
    const d = Math.min(devicePixelRatio || 1, 1.5);
    const w = Math.round(p.canvas.clientWidth * d);
    const h = Math.round(p.canvas.clientHeight * d);
    if (!w || !h) return;
    if (p.canvas.width !== w || p.canvas.height !== h) {
      p.canvas.width = w;
      p.canvas.height = h;
    }
    if (view.image) {
      const g = p.ctx;
      const s = Math.min(w / view.image.width, h / view.image.height);
      const iw = view.image.width * s;
      const ih = view.image.height * s;
      g.fillStyle = '#0b0b0e';
      g.fillRect(0, 0, w, h);
      g.drawImage(view.image, (w - iw) / 2, (h - ih) / 2, iw, ih);
      return;
    }
    view.camera.aspect = w / h;
    view.camera.updateProjectionMatrix();
    this.engine.drawView(this.scene, view.camera, p.ctx, w, h, { blur: false, cctv: 1, vignette: 0.55, sat: 1 });
    view.draw2d?.(p.ctx, w, h);
  }

  // ---------------------------------------------------------------- pointer

  bindPointer(sig) {
    const c = this.canvas;
    const ray = new Raycaster();
    ray.layers.enableAll(); // overlay handles (zone corners, line ends) are pickable too
    const ndc = new Vector2();
    this.pointer = { down: false, x: 0, y: 0, dragging: false, hit: null };
    const toNdc = (e) => {
      const r = c.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      return r;
    };
    const pick = (e) => {
      if (!this.live) return null;
      toNdc(e);
      ray.setFromCamera(ndc, this.camera);
      const hits = ray.intersectObjects(this.controller?.pickables?.() ?? [], true);
      for (const h of hits) {
        let o = h.object;
        while (o && !o.userData?.pick) o = o.parent;
        if (o) return { object: o, point: h.point, instanceId: h.instanceId, kind: o.userData.pick };
      }
      return null;
    };
    this.pick = pick;

    c.addEventListener('pointermove', (e) => {
      if (!this.live) return;
      const r = toNdc(e);
      const p = this.pointer;
      if (!p.down) {
        if (e.pointerType === 'mouse') {
          this.rig.setHover(ndc.x, ndc.y);
          const h = pick(e);
          c.style.cursor = h ? (h.kind === 'drag' ? 'grab' : 'pointer') : 'grab';
          this.controller?.onHover?.(h);
        }
        this.engine.wake();
        return;
      }
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (!p.dragging && Math.hypot(dx, dy) > DRAG_PX) {
        p.dragging = true;
        if (p.hit?.kind === 'drag') this.controller?.onDrag?.('start', p.hit, e, ray);
        else this.rig.beginDrag();
        c.style.cursor = 'grabbing';
      }
      if (p.dragging) {
        if (p.hit?.kind === 'drag') {
          toNdc(e);
          ray.setFromCamera(ndc, this.camera);
          this.controller?.onDrag?.('move', p.hit, e, ray);
        } else {
          this.rig.dragBy(dx / r.width, dy / r.height);
        }
      }
      this.engine.wake();
    }, sig);

    c.addEventListener('pointerdown', (e) => {
      if (!this.live || e.button > 0) return;
      const p = this.pointer;
      p.down = true;
      p.x = e.clientX;
      p.y = e.clientY;
      p.dragging = false;
      p.hit = pick(e);
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic pointers can't be captured */
      }
    }, sig);

    const up = (e) => {
      const p = this.pointer;
      if (!p.down) return;
      p.down = false;
      // The browser's own click follows this pointerup. The diorama has
      // already decided what the gesture meant (a drag, a toy, or opening the
      // case study), so that click must not also reach the card around it.
      const swallow = (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      c.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => c.removeEventListener('click', swallow, { capture: true }), 0);
      if (p.dragging) {
        if (p.hit?.kind === 'drag') this.controller?.onDrag?.('end', p.hit, e, ray);
        else this.rig.endDrag();
      } else if (p.hit) {
        this.controller?.onClick?.(p.hit, e);
      } else if (this.opts.context !== 'case') {
        this.opts.onOpen?.(this.chapters?.current?.id);
      }
      p.dragging = false;
      c.style.cursor = 'grab';
      this.engine.wake();
    };
    c.addEventListener('pointerup', up, sig);
    c.addEventListener('pointercancel', up, sig);
    // The card's tour holds still while someone is looking closely.
    c.addEventListener('pointerenter', () => this.chapters?.pauseTour(true), sig);
    c.addEventListener('pointerleave', () => {
      this.rig?.setHover(0, 0);
      this.controller?.onHover?.(null);
      this.chapters?.pauseTour(false);
    }, sig);
  }

  // ---------------------------------------------------------------- lifecycle

  onContextLost() {
    this.live = false;
    this.media.classList.remove('is-3d-live');
    this.state('lost');
  }

  async onContextRestored() {
    const snap = this.controller?.snapshot?.();
    this.teardownScene();
    this.opts.resume = snap;
    this.state('loading');
    try {
      await this.load();
    } catch (e) {
      console.warn('[3d] restore failed', e);
      this.state('error');
    }
  }

  snapshot() {
    if (!this.controller) return null;
    return { ...this.controller.snapshot?.(), chapter: this.chapters?.current?.id };
  }

  teardownScene() {
    this.pip = null;
    this.chapters?.dispose();
    this.controller?.dispose?.();
    this.labels?.dispose();
    this.stage?.dispose();
    this.chapters = null;
    this.controller = null;
    this.labels = null;
    this.stage = null;
  }

  destroy() {
    this.abort.abort();
    this.ro.disconnect();
    this.io.disconnect();
    this.engine.remove(this);
    this.teardownScene();
    this.media.classList.remove('is-3d-live');
    this.canvas.remove();
    this.caption?.remove();
    if (document.fullscreenElement === this.media) document.exitFullscreen?.();
    delete this.media.dataset['3d'];
    delete this.media.dataset['3dFrames'];
    delete this.media.dataset['3dToy'];
    delete this.media.dataset['3dChapter'];
    this.live = false;
  }
}
