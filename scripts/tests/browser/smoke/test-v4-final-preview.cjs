#!/usr/bin/env node
const assert = require('node:assert/strict');
const { mkdir, writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const { chromium } = require('playwright');

const root = resolve(__dirname, '../../../..');
const output = resolve(root, 'outputs/v4-qa/final-preview');

async function main() {
  const { createServer } = await import('vite');
  const { default: tailwindcss } = await import('@tailwindcss/postcss');
  const server = await createServer({
    configFile: false,
    root,
    cacheDir: resolve(output, 'browser-cache'),
    publicDir: resolve(root, 'public'),
    css: { postcss: { plugins: [tailwindcss()] } },
    optimizeDeps: {
      entries: [resolve(root, 'scripts/tests/fixtures/v4-final-preview.mjs')],
      include: [
        '@tauri-apps/api/core',
        '@tauri-apps/api/event',
        '@tauri-apps/api/window',
      ],
    },
    resolve: { alias: { '@': resolve(root, 'src') } },
    server: {
      host: '127.0.0.1',
      port: 0,
      watch: {
        ignored: ['**/src-tauri/target/**', '**/dist/**', '**/outputs/**'],
      },
    },
    plugins: [
      {
        name: 'isolated-final-preview',
        configureServer(devServer) {
          devServer.middlewares.use(async (req, res, next) => {
            if (req.url !== '/') return next();
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(
              await devServer.transformIndexHtml(
                '/',
                '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/app/globals.css"><link rel="stylesheet" href="/app/creation.css"></head><body><div id="root"></div><script type="module" src="/scripts/tests/fixtures/v4-final-preview.mjs"></script></body></html>',
              ),
            );
          });
        },
      },
    ],
  });
  let browser;
  let page;
  const errors = [];
  await mkdir(output, { recursive: true });
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
    const cell = page.locator('[data-creation-cell]');
    await cell.first().waitFor();
    assert.equal(
      await cell.count(),
      1,
      'the eight open sectors form one holed face',
    );
    const baseline = await page.evaluate(() => window.previewDocument());
    const geometry = await cell.getAttribute('d');
    assert.ok(
      geometry.match(/M/g).length >= 2,
      'the evaluated face retains its hole',
    );
    assert.equal(await page.locator('[data-derived-curves="16"]').count(), 1);
    const visible = async () => {
      assert.ok(
        Number(await cell.getAttribute('fill-opacity')) > 0,
        'final modifier face must be visible without selecting or changing display',
      );
      assert.equal(await cell.getAttribute('d'), geometry);
    };
    await page.screenshot({ path: resolve(output, 'default.png') });
    await visible();
    await page.getByRole('button', { name: '节点 (A)', exact: true }).click();
    await visible();
    await page.getByRole('button', { name: '底图', exact: true }).click();
    assert.equal(Number(await cell.getAttribute('fill-opacity')), 0);
    await page.getByRole('button', { name: '上色', exact: true }).click();
    // Let any tool-triggered effects finish before verifying the explicit choice.
    await page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done)),
        ),
    );
    assert.equal(
      Number(await cell.getAttribute('fill-opacity')),
      0,
      'switching tools must preserve the explicit display choice',
    );
    await page.getByRole('button', { name: '分色', exact: true }).click();
    assert.equal(Number(await cell.getAttribute('fill-opacity')), 1);
    await page.getByRole('button', { name: '节点 (A)', exact: true }).click();
    await page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done)),
        ),
    );
    assert.equal(Number(await cell.getAttribute('fill-opacity')), 1);
    await page.getByRole('button', { name: '叠色', exact: true }).click();
    assert.deepEqual(
      await page.evaluate(() => window.previewDocument()),
      baseline,
      'display choices must not change the authored document',
    );
    await page.screenshot({ path: resolve(output, 'editing.png') });
    await page.getByRole('button', { name: '立体预览', exact: true }).click();
    await page.getByLabel('作品立体画布').waitFor();
    await page.screenshot({ path: resolve(output, '3d.png') });
    await page.reload();
    await cell.first().waitFor();
    await visible();
    assert.deepEqual(errors, []);
    await require('./review-repair-interactions.cjs')(page, output);
    assert.deepEqual(errors, []);
    await writeFile(
      resolve(output, 'result.json'),
      JSON.stringify(
        {
          status: 'pass',
          sourceEdges: 2,
          evaluatedEdges: 16,
          faces: 1,
          holes: 1,
          checks: [
            'default faces',
            'node editing',
            'explicit modes',
            'tool independence',
            'document unchanged',
            'reload',
          ],
        },
        null,
        2,
      ),
    );
    console.log(
      'PASS final modifier face is visible by default and display choices survive tool changes',
    );
  } catch (error) {
    console.error('Browser errors:', errors);
    if (page) await page.screenshot({ path: resolve(output, 'failure.png') });
    throw error;
  } finally {
    await browser?.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
