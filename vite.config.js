import { defineConfig } from 'vite';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { projects, liveMetrics } from './src/data/projects.js';

const SITE = 'https://sheikahmedyaseen.com';

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Emit a real HTML page per project at build time.
 *
 * The detail view is a client-side overlay, which is fine for in-session
 * navigation but means each case study has no URL of its own: not shareable,
 * not indexable, and no preview card when the link is pasted somewhere. This
 * writes /project/<id>/index.html for each one: correct <title>, description and
 * canonical, real content in the markup for crawlers, and a tiny inline script
 * that hands over to the SPA overlay so the experience is identical once the
 * bundle loads.
 */
function projectPages() {
  return {
    name: 'project-pages',
    apply: 'build',
    // writeBundle, not generateBundle: transformIndexHtml runs at the very end
    // of the build, so anything earlier sees an empty template.
    async writeBundle(options) {
      const outDir = options.dir ?? resolve('dist');
      const template = await readFile(resolve(outDir, 'index.html'), 'utf8');
      for (const p of projects) {
        const title = esc(`${p.title} | Sheik Ahmed Yaseen`);
        const desc = esc(p.short);
        const metrics = liveMetrics(p)
          .map((m) => `<div><dt>${esc(m.label)}</dt><dd>${esc(m.value)}</dd></div>`)
          .join('');
        const li = (items = []) => items.map((i) => `<li>${esc(i)}</li>`).join('');

        // Crawlable content. The overlay replaces it as soon as JS runs.
        const fallback = `
    <article class="pd-static">
      <p><a href="/">All work</a></p>
      <h1>${esc(p.title)}</h1>
      <p>${esc(p.short)}</p>
      <dl>${metrics}</dl>
      <h2>Overview</h2><p>${esc(p.overview)}</p>
      <h2>The problem</h2><p>${esc(p.problem)}</p>
      <h2>The approach</h2><p>${esc(p.solution)}</p>
      <h2>What I built</h2><ul>${li(p.implementation)}</ul>
      <h2>Stack</h2><p>${esc(p.techStack.join(', '))}</p>
      <h2>Results</h2><ul>${li(p.outcomes)}</ul>
      ${p.limitations?.length ? `<h2>Limitations</h2><ul>${li(p.limitations)}</ul>` : ''}
      ${p.repo ? `<p><a href="${esc(p.repo)}">View code on GitHub</a></p>` : ''}
    </article>`;

        const out = template
          .replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`)
          .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${desc}" />`)
          .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${title}" />`)
          .replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${desc}" />`)
          .replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${SITE}/project/${p.id}/" />`)
          .replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${SITE}/project/${p.id}/" />`)
          // Seed the overlay from the path, and give crawlers real prose.
          .replace(
            '<div id="project-detail" class="project-detail hidden" aria-hidden="true"></div>',
            `<div id="project-detail" class="project-detail hidden" aria-hidden="true"></div>
    <noscript>${fallback}</noscript>
    <script>window.__openProject = ${JSON.stringify(p.id)};</script>`
          );

        await mkdir(resolve(outDir, 'project', p.id), { recursive: true });
        await writeFile(resolve(outDir, 'project', p.id, 'index.html'), out);
      }

      const urls = ['', ...projects.map((p) => `project/${p.id}/`)]
        .map((u) => `  <url><loc>${SITE}/${u}</loc><changefreq>monthly</changefreq></url>`)
        .join('\n');
      // writeFile, not this.emitFile: emitFile is a generateBundle-phase API
      // and is a silent no-op this late.
      await writeFile(
        resolve(outDir, 'sitemap.xml'),
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
      );
    },
  };
}

export default defineConfig({
  plugins: [projectPages()],
  define: {
    // Résumé links are hidden until the PDF actually exists (see src/main.js).
    // Read when the dev server or build starts; restart after adding the file.
    __HAS_RESUME__: JSON.stringify(existsSync(resolve('public/resume.pdf'))),
  },
  server: {
    port: Number(process.env.PORT) || 3000,
    host: true,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    // The hero frames are already compressed WebP; inlining them as base64
    // would only make them bigger and unfetchable on demand.
    assetsInlineLimit: 4096,
  },
});
