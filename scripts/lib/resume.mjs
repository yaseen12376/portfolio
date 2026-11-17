/**
 * What the résumé PDF was printed from, as one hash: the content model
 * (src/resume/content.js, the public copy, without a phone number) and the
 * files that lay it out. scripts/gen-resume.mjs stores it in
 * public/resume.meta.json; the build (vite.config.js) and the résumé QA
 * compare it, so a PDF that no longer matches the site's data cannot ship.
 *
 * Line endings are normalised first: the working tree on Windows has CRLF
 * where the build server's checkout has LF, and the hash must agree on both.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const RESUME_LAYOUT_FILES = ['resume/index.html', 'src/resume/main.js', 'src/resume/resume.css'];

export function resumeHash(root, model) {
  const h = createHash('sha256').update(JSON.stringify(model));
  for (const f of RESUME_LAYOUT_FILES) h.update(`\n${f}\n`).update(readFileSync(join(root, f), 'utf8').replace(/\r\n/g, '\n'));
  return h.digest('hex').slice(0, 16);
}
