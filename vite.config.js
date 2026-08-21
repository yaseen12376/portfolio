import { defineConfig } from 'vite';

export default defineConfig({
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
