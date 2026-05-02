import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    open: true,
    allowedHosts: true
  },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0
  }
});
