import { defineConfig } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { projects } from './src/data/projects.js';

/**
 * Emit a real HTML page per project at build time.
 *
 * The detail view is a client-side overlay, which is fine for in-session
 * navigation but means each case study has no URL of its own — not shareable,
 * not indexable, and no per-project preview card when the link is pasted
 * somewhere. This writes /project/<id>/index.html for each one: correct <title>,
 * description and og:image, real content in the markup for crawlers, and a tiny
 * inline script that hands over to the SPA overlay so the experience is
 * identical once the bundle loads.
 */
function projectPages() {
  return {
    name: 'project-pages',
    apply: 'build',
    // writeBundle, not generateBundle: transformIndexHtml runs at the very end
    // of the build, so anything earlier sees an empty template and emits blank
    // pages. By writeBundle the real index.html is on disk.
    async writeBundle(options) {
      const outDir = options.dir ?? resolve('dist');
      const template = await readFile(resolve(outDir, 'index.html'), 'utf8');
      for (const p of projects) {
        const title = `${p.title} — Sheik Ahmed Yaseen`;
        const desc = p.short.replace(/"/g, '&quot;');
        const metrics = (p.metrics ?? [])
          .filter((m) => m.value !== 'TODO_')
          .map((m) => `<div><dt>${m.label}</dt><dd>${m.value}</dd></div>`)
          .join('');

        // Crawlable content. The overlay replaces it as soon as JS runs.
        const fallback = `
    <article class="pd-static">
      <p><a href="/">← All projects</a></p>
      <h1>${p.title}</h1>
      <p>${p.short}</p>
      <dl>${metrics}</dl>
      <h2>Overview</h2><p>${p.overview}</p>
      <h2>The problem</h2><p>${p.problem}</p>
      <h2>The approach</h2><p>${p.solution}</p>
      <h2>Implementation</h2><ul>${p.implementation.map((i) => `<li>${i}</li>`).join('')}</ul>
      <h2>Stack</h2><p>${p.techStack.join(' · ')}</p>
      <h2>Outcomes</h2><ul>${p.outcomes.map((i) => `<li>${i}</li>`).join('')}</ul>
      ${p.repo ? `<p><a href="${p.repo}">View on GitHub</a></p>` : ''}
    </article>`;

        let out = template
          .replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`)
          .replace(
            /<meta name="description"[^>]*>/,
            `<meta name="description" content="${desc}" />`
          )
          .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${title}" />`)
          .replace(
            /<meta property="og:description"[^>]*>/,
            `<meta property="og:description" content="${desc}" />`
          )
          .replace(
            /<link rel="canonical"[^>]*>/,
            `<link rel="canonical" href="https://sheikahmedyaseen.com/project/${p.id}/" />`
          )
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
        .map(
          (u) =>
            `  <url><loc>https://sheikahmedyaseen.com/${u}</loc><changefreq>monthly</changefreq></url>`
        )
        .join('\n');
      // writeFile, not this.emitFile — emitFile is a generateBundle-phase API
      // and is a silent no-op this late, which is why the sitemap went missing
      // while the pages beside it wrote fine.
      await writeFile(
        resolve(outDir, 'sitemap.xml'),
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
      );
    },
  };
}

export default defineConfig({
  plugins: [projectPages()],
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
