import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { splineletPublicAssets } from './scripts/build/vite-public-assets.ts';

const projectRoot = resolve(import.meta.dirname);
const desktopRoot = resolve(projectRoot, 'desktop');
const publicRoot = resolve(projectRoot, 'public');
const outputRoot = resolve(projectRoot, 'dist-desktop');

export default defineConfig({
  root: desktopRoot,
  publicDir: false,
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [react(), splineletPublicAssets(publicRoot, outputRoot)],
  resolve: { alias: { '@': projectRoot } },
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    fs: { allow: [projectRoot] },
  },
  clearScreen: false,
  build: {
    outDir: outputRoot,
    emptyOutDir: true,
    rolldownOptions: { input: resolve(desktopRoot, 'index.html') },
  },
  worker: { format: 'es' },
});
