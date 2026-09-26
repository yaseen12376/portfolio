/**
 * The only diorama code in the initial bundle. It imports nothing from three.js.
 *
 * It decides, per visitor, how the dioramas behave:
 *   auto  desktop-class device: a diorama goes live as its card scrolls in
 *   tap   phones, coarse pointers, modest networks, low memory: the Blender
 *         still stays until a tap on "Play in 3D" loads the live scene
 *   off   reduced motion, Save-Data, 2G, no WebGL2: stills only, which already
 *         carry the miniature blur and glow, so nothing looks missing
 *
 * and loads the engine lazily: only after the page has finished loading (the
 * hero's frames go first) and only when a diorama comes within 300 px.
 *
 * QA switches: ?3d=force (ignore the gate: headless GPUs trip the performance
 * caveat), ?3d=cal (as force, and every card shows the calibration scene),
 * ?3d=off.
 */
import { isCoarsePointer, prefersReducedMotion } from '../core/device.js';
import { esc, icons } from '../core/util.js';

const q = new URLSearchParams(location.search).get('3d');

let cached = null;

function hasWebGL2() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

export function mode3d(tier) {
  if (cached) return cached;
  if (q === 'off') return (cached = 'off');
  if (q === 'force' || q === 'cal') return (cached = 'auto');
  const conn = navigator.connection || {};
  const starved = conn.saveData === true || ['slow-2g', '2g'].includes(conn.effectiveType);
  if (tier === 'low' || prefersReducedMotion() || starved || !hasWebGL2()) return (cached = 'off');
  const phoneLike = matchMedia('(max-width: 899.98px)').matches || isCoarsePointer();
  const lowMemory = (navigator.deviceMemory ?? 8) < 3;
  return (cached = phoneLike || lowMemory || tier !== 'high' ? 'tap' : 'auto');
}

const pageLoaded = new Promise((resolve) => {
  if (document.readyState === 'complete') resolve();
  else addEventListener('load', () => resolve(), { once: true });
}).then(() => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 1500 }) : setTimeout(r, 300))));

// Every attached diorama by its media box, so a case study can pick up the
// state its card was left in.
const handles = new WeakMap();

/** The toy state of the diorama in `media`, if it has one. */
export const snapshot3d = (media) => (media ? handles.get(media)?.snapshot() ?? null : null);

let slotModule = null;
const loadSlot = () => (slotModule ??= import('./slot.js'));

/** Which diorama a project shows (the calibration scene under ?3d=cal). */
export const sceneFor = (project) => (q === 'cal' ? '_calibration' : project?.scene3d?.id ?? null);

/** The words for a project's diorama (chapters, tour), from its data. */
export const sceneMeta = (project) => (q === 'cal' ? null : project?.scene3d ?? null);

/**
 * Attach a diorama to a project's media box. Returns a handle, or null when
 * this visitor gets stills only.
 * @param {HTMLElement} media
 * @param {object} project
 * @param {{ context: 'card'|'case', tier: string, onOpen?: () => void, resume?: object }} opts
 */
export function attach3d(media, project, opts) {
  const id = sceneFor(project);
  if (!id || !media) return null;
  const mode = mode3d(opts.tier);
  if (mode === 'off') return null;

  const h = { active: false, slot: null, destroyed: false, io: null, btn: null };

  const start = async () => {
    if (h.slot || h.destroyed) return;
    await pageLoaded;
    const { Slot } = await loadSlot();
    if (h.destroyed) return;
    h.slot = new Slot(media, { id, base: `/3d/${id}/`, meta: sceneMeta(project), ...opts });
    h.slot.setActive(h.active);
    try {
      await h.slot.load();
    } catch (e) {
      if (e?.name === 'AbortError') return;
      console.warn('[3d]', id, e);
      media.dataset['3d'] = 'error';
    }
  };

  if (mode === 'auto') {
    h.io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        h.io.disconnect();
        start();
      },
      { rootMargin: '300px' }
    );
    h.io.observe(media);
  } else {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'media-3d-play';
    btn.setAttribute('aria-label', `Play the ${esc(project.title)} diorama in 3D`);
    btn.innerHTML = `<span class="media-3d-play-icon" aria-hidden="true">${icons.cube}</span><span>Play in 3D</span>`;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.disabled = true;
      btn.classList.add('is-loading');
      h.active = true;
      start().then(() => btn.remove());
    });
    media.appendChild(btn);
    h.btn = btn;
  }

  const handle = {
    setActive(on) {
      h.active = on;
      h.slot?.setActive(on);
    },
    snapshot: () => h.slot?.snapshot(),
    get slot() {
      return h.slot;
    },
    destroy() {
      h.destroyed = true;
      h.io?.disconnect();
      h.btn?.remove();
      h.slot?.destroy();
      h.slot = null;
      if (handles.get(media) === handle) handles.delete(media);
    },
  };
  handles.set(media, handle);
  return handle;
}
