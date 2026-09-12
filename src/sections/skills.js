/**
 * Toolkit: grouped tools, each showing how many projects on the page use it.
 * Hovering or focusing a tool names those projects, with links, in the line
 * under its group, so the list is evidence rather than a claim.
 */
import { revealOnScroll } from '../core/motion.js';
import { skillGroups } from '../data/skills.js';
import { projects } from '../data/projects.js';
import { esc } from '../core/util.js';

const usedIn = (item) => projects.filter((p) => p.techStack.some((t) => item.match.includes(t)));
const shortTitle = (p) => p.title.split(':')[0];

const joinAnd = (parts) =>
  parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

export function renderSkills() {
  const host = document.querySelector('#skills-grid');
  if (!host) return;
  host.innerHTML = skillGroups
    .map((g, gi) => {
      const tools = g.items
        .map((item) => {
          const ids = usedIn(item).map((p) => p.id);
          const n = ids.length;
          return `<button type="button" class="tool" data-name="${esc(item.name)}" data-projects="${ids.join(' ')}"
                    aria-label="${esc(item.name)}, used in ${n} project${n === 1 ? '' : 's'}">
                    <span>${esc(item.name)}</span><span class="count" aria-hidden="true">${n}</span>
                  </button>`;
        })
        .join('');
      return `
        <div class="tool-group">
          <h3>${esc(g.label)}</h3>
          <div class="tool-list">${tools}</div>
          <p class="tool-where" id="tool-where-${gi}" aria-live="polite"></p>
        </div>`;
    })
    .join('');
}

let bound = false;

export function initSkills() {
  // Per-chip rather than per-group: the chips land in sequence, which reads as
  // a list being filled in rather than three blocks appearing.
  revealOnScroll('#skills .tool-group h3, #skills .tool');
  const host = document.querySelector('#skills-grid');
  if (!host || bound) return;
  bound = true;

  const show = (tool) => {
    const group = tool.closest('.tool-group');
    group.querySelectorAll('.tool.is-on').forEach((t) => t.classList.remove('is-on'));
    tool.classList.add('is-on');
    const ids = tool.dataset.projects.split(' ').filter(Boolean);
    const links = ids
      .map((id) => projects.find((p) => p.id === id))
      .filter(Boolean)
      .map((p) => `<a href="#/project/${esc(p.id)}">${esc(shortTitle(p))}</a>`);
    group.querySelector('.tool-where').innerHTML = links.length
      ? `${esc(tool.dataset.name)} is used in ${joinAnd(links)}.`
      : '';
  };

  host.addEventListener('pointerover', (e) => {
    const tool = e.target.closest('.tool');
    if (tool && e.pointerType === 'mouse') show(tool);
  });
  host.addEventListener('focusin', (e) => {
    const tool = e.target.closest('.tool');
    if (tool) show(tool);
  });
  host.addEventListener('click', (e) => {
    const tool = e.target.closest('.tool');
    if (tool) show(tool);
  });
}
