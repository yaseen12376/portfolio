/**
 * The case study's feature explorer: the project's features as numbered
 * chapters under its diorama. It is plain, accessible DOM built from the
 * project's data, so it reads as a feature list with or without WebGL; once
 * the diorama is live it drives it: a chapter moves the camera, switches the
 * overlays, shows the live readouts and offers that feature's controls.
 *
 * Nothing here sits on top of the diorama: every control lives in this strip.
 */
import resetView from '@phosphor-icons/core/assets/light/arrow-counter-clockwise-light.svg?raw';
import expand from '@phosphor-icons/core/assets/light/arrows-out-light.svg?raw';
import collapse from '@phosphor-icons/core/assets/light/arrows-in-light.svg?raw';

import { esc, icons as shared, prep } from '../core/util.js';

// This module's own icons ride in its chunk, not the page's entry bundle.
const icons = { ...shared, resetView: prep(resetView), expand: prep(expand), collapse: prep(collapse) };

const pad = (i) => String(i + 1).padStart(2, '0');

/** @param {{ id: string, title: string, caption: string, hint?: string }[]} chapters */
export function explorerMarkup(chapters) {
  if (!chapters?.length) return '';
  const first = chapters[0];
  return `
    <section class="pd-explorer" aria-label="Features in the diorama">
      <div class="pd-explorer-bar">
        <div class="pd-chapters" role="tablist" aria-label="Features">
          ${chapters
            .map(
              (c, i) => `<button type="button" role="tab" class="pd-chapter" id="pd-ch-${esc(c.id)}" data-chapter="${esc(c.id)}"
                aria-selected="${i === 0}" aria-controls="pd-ch-panel" tabindex="${i === 0 ? 0 : -1}">
                <span class="n">${pad(i)}</span><span class="t">${esc(c.title)}</span></button>`
            )
            .join('')}
        </div>
        <div class="pd-explorer-tools">
          <button type="button" class="pd-tool" data-tool="prev" aria-label="Previous feature">${icons.arrowLeft}</button>
          <button type="button" class="pd-tool" data-tool="next" aria-label="Next feature">${icons.arrowRight}</button>
          <button type="button" class="pd-tool" data-tool="reset" aria-label="Reset the diorama" disabled>${icons.resetView}</button>
          ${document.fullscreenEnabled ? `<button type="button" class="pd-tool" data-tool="full" aria-label="Full screen" disabled>${icons.expand}</button>` : ''}
        </div>
      </div>
      <div class="pd-chapter-panel" id="pd-ch-panel" role="tabpanel" aria-labelledby="pd-ch-${esc(first.id)}">
        <div class="pd-chapter-copy">
          <p class="pd-chapter-title"><span class="n">${pad(0)}</span><span class="t">${esc(first.title)}</span></p>
          <p class="pd-chapter-caption">${esc(first.caption)}</p>
          <p class="pd-chapter-hint"${first.hint ? '' : ' hidden'}>${esc(first.hint ?? '')}</p>
        </div>
        <dl class="pd-readouts" aria-live="off"></dl>
        <figure class="pd-pip" hidden>
          <canvas aria-hidden="true"></canvas>
          <figcaption></figcaption>
        </figure>
        <div class="pd-chapter-actions" role="group" aria-label="Controls for this feature"></div>
      </div>
    </section>`;
}

/**
 * Wire an explorer. Works on its own (switching the words); attach(slot)
 * hands it the live diorama.
 * @param {HTMLElement} root  the .pd-explorer section
 * @param {{ id, title, caption, hint? }[]} chapters
 */
export function bindExplorer(root, chapters) {
  if (!root) return null;
  const abort = new AbortController();
  const sig = { signal: abort.signal };
  const tabs = [...root.querySelectorAll('.pd-chapter')];
  const panel = root.querySelector('.pd-chapter-panel');
  const title = root.querySelector('.pd-chapter-title');
  const caption = root.querySelector('.pd-chapter-caption');
  const hint = root.querySelector('.pd-chapter-hint');
  const reads = root.querySelector('.pd-readouts');
  const acts = root.querySelector('.pd-chapter-actions');
  const pipBox = root.querySelector('.pd-pip');
  const pipCanvas = pipBox.querySelector('canvas');
  const pipCaption = pipBox.querySelector('figcaption');
  const tool = (t) => root.querySelector(`[data-tool="${t}"]`);
  let slot = null;
  let off = null;
  let current = chapters[0]?.id;
  let picked = false; // chose a chapter before the diorama was live
  const readCells = new Map();

  const show = (id, { focus = false } = {}) => {
    const i = chapters.findIndex((c) => c.id === id);
    if (i < 0) return;
    current = id;
    const c = chapters[i];
    tabs.forEach((t, k) => {
      const on = k === i;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    if (focus) tabs[i].focus();
    tabs[i].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    panel.setAttribute('aria-labelledby', tabs[i].id);
    title.innerHTML = `<span class="n">${pad(i)}</span><span class="t">${esc(c.title)}</span>`;
    caption.textContent = c.caption;
    hint.textContent = c.hint ?? '';
    hint.hidden = !c.hint || !slot;
    reads.replaceChildren();
    readCells.clear();
    if (!slot) acts.replaceChildren();
  };

  const go = (id, focus) => {
    if (slot?.chapters) slot.chapters.go(id);
    else picked = true;
    show(id, { focus });
  };

  const step = (d, focus = false) => {
    const i = chapters.findIndex((c) => c.id === current);
    go(chapters[(i + d + chapters.length) % chapters.length].id, focus);
  };

  root.addEventListener('click', (e) => {
    const tab = e.target.closest('.pd-chapter');
    if (tab) return go(tab.dataset.chapter, false);
    const t = e.target.closest('[data-tool]');
    if (t) {
      const k = t.dataset.tool;
      if (k === 'prev') step(-1);
      else if (k === 'next') step(1);
      else if (k === 'reset') slot?.reset();
      else if (k === 'full') slot?.toggleFullscreen();
      return;
    }
    const a = e.target.closest('[data-act]');
    if (a && slot?.chapters) slot.chapters.act(a.dataset.act);
  }, sig);

  // A tablist moves with the arrow keys (roving tab index).
  root.querySelector('.pd-chapters').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      step(e.key === 'ArrowRight' ? 1 : -1, true);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      go(chapters[e.key === 'Home' ? 0 : chapters.length - 1].id, true);
    }
  }, sig);

  document.addEventListener('fullscreenchange', () => {
    const b = tool('full');
    if (!b || !slot) return;
    const full = document.fullscreenElement === slot.media;
    b.innerHTML = full ? icons.collapse : icons.expand;
    b.setAttribute('aria-label', full ? 'Exit full screen' : 'Full screen');
  }, sig);

  const renderReadouts = (list) => {
    const seen = new Set();
    for (const r of list) {
      seen.add(r.label);
      let cell = readCells.get(r.label);
      if (!cell) {
        const div = document.createElement('div');
        div.innerHTML = '<dt></dt><dd></dd>';
        div.firstChild.textContent = r.label;
        reads.appendChild(div);
        cell = { div, dd: div.lastChild, value: null, tone: null };
        readCells.set(r.label, cell);
      }
      const v = String(r.value);
      if (cell.value !== v) cell.dd.textContent = cell.value = v;
      if (cell.tone !== (r.tone ?? '')) cell.dd.dataset.tone = cell.tone = r.tone ?? '';
    }
    for (const [label, cell] of readCells) {
      if (!seen.has(label)) {
        cell.div.remove();
        readCells.delete(label);
      }
    }
  };

  const renderActions = (list) => {
    acts.innerHTML = list
      .map(
        (a) => `<button type="button" class="pd-act${a.pressed != null ? ' is-toggle' : ''}" data-act="${esc(a.id)}"${
          a.pressed != null ? ` aria-pressed="${!!a.pressed}"` : ''
        }${a.disabled ? ' disabled' : ''}>${esc(a.label)}</button>`
      )
      .join('');
  };

  return {
    /** The diorama went live: let it drive and be driven. */
    attach(s) {
      slot = s;
      root.classList.add('is-live');
      tool('reset')?.removeAttribute('disabled');
      tool('full')?.removeAttribute('disabled');
      off?.();
      off = s.chapters?.on((type, data) => {
        if (type === 'chapter') show(data.id);
        else if (type === 'readouts') renderReadouts(data);
        else if (type === 'actions') renderActions(data);
        else if (type === 'pip') {
          pipBox.hidden = !data;
          s.setPip(data ? pipCanvas : null);
        } else if (type === 'pipcaption') pipCaption.textContent = data ?? '';
      });
      // The card's chapter carries over, unless one was chosen here already.
      if (picked && s.chapters && s.chapters.current?.id !== current) s.chapters.go(current);
      else if (s.chapters?.current) show(s.chapters.current.id);
      renderActions(s.chapters?.current?.actions?.() ?? []);
      pipBox.hidden = !s.chapters?.current?.pip;
      s.setPip(s.chapters?.current?.pip ? pipCanvas : null);
    },
    destroy() {
      off?.();
      abort.abort();
      slot?.setPip(null);
      slot = null;
    },
  };
}
