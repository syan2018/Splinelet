import { createReadStream, cpSync, existsSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const projectRoot = resolve(import.meta.dirname);
const desktopRoot = resolve(projectRoot, 'desktop');
const publicRoot = resolve(projectRoot, 'public');
const outputRoot = resolve(projectRoot, 'dist-desktop');

const contentTypes: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// public/*.mjs is both source code imported by the app and a set of stable
// browser/Node entrypoints. Keep it out of Vite's special publicDir handling,
// then mirror the directory for absolute runtime URLs and the trace worker.
function splineletPublicAssets(): Plugin {
  return {
    name: 'splinelet-public-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = decodeURIComponent(
          new URL(request.url || '/', 'http://desktop.local').pathname,
        );
        const file = resolve(publicRoot, '.' + pathname);
        if (
          !file.startsWith(publicRoot) ||
          !existsSync(file) ||
          !statSync(file).isFile()
        ) {
          next();
          return;
        }
        response.setHeader(
          'Content-Type',
          contentTypes[extname(file)] || 'application/octet-stream',
        );
        createReadStream(file).pipe(response);
      });
    },
    closeBundle() {
      cpSync(publicRoot, outputRoot, { recursive: true });
    },
  };
}

export default defineConfig({
  root: desktopRoot,
  publicDir: false,
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [react(), splineletPublicAssets()],
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
