/**
 * Blocks that fold away on a phone and stay open everywhere else.
 *
 * Each is a <details data-fold open> whose <summary> the stylesheet hides
 * above the phone breakpoint, so a computer sees the content exactly as it
 * was. On a phone the details start closed and the summary is the way in.
 *
 * Opening one shows its reveals at once (they were measured while hidden, so
 * their triggers are meaningless), and the page re-measures every trigger
 * below it, because the page just changed length.
 */
import { ScrollTrigger } from './motion.js';

export const PHONE = '(max-width: 599.98px)';

let pending = 0;
const refresh = () => {
  clearTimeout(pending);
  pending = setTimeout(() => ScrollTrigger.refresh(), 80);
};

export function foldOnPhone(root = document) {
  const folds = [...root.querySelectorAll('details[data-fold]')];
  if (!folds.length) return;
  const phone = matchMedia(PHONE);
  const apply = () => folds.forEach((d) => (d.open = !phone.matches));
  apply();
  phone.addEventListener('change', apply);
  for (const d of folds) {
    d.addEventListener('toggle', () => {
      if (d.open) d.querySelectorAll('.reveal:not(.is-in)').forEach((el) => el.classList.add('is-in'));
      refresh();
    });
  }
}
