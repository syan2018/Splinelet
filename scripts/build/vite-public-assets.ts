import { createReadStream, cpSync, existsSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import type { Plugin } from 'vite';

const contentTypes: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// geometry.mjs is shared by app imports, Node tests and the stable trace-worker URL.
// Serve and copy these runtime assets without Vite's publicDir import restriction.
export function splineletPublicAssets(
  publicRoot: string,
  outputRoot: string,
): Plugin {
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
