#!/usr/bin/env node
// Full original UI with an injected V4 host, fresh browser context and ephemeral port.
const assert = require('node:assert/strict');
const { mkdir, writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const { chromium } = require('playwright');

const root = resolve(__dirname, '../../../..');
const output = resolve(root, 'output/playwright/v4-original-studio');

async function main() {
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: false,
    root,
    publicDir: resolve(root, 'public'),
    optimizeDeps: {
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
      hmr: false,
      watch: {
        ignored: ['**/src-tauri/target/**', '**/dist/**', '**/output/**'],
      },
    },
    plugins: [
      {
        name: 'isolated-original-studio',
        configureServer(devServer) {
          devServer.middlewares.use(async (req, res, next) => {
            if (req.url !== '/') return next();
            const html = await devServer.transformIndexHtml(
              '/',
              '<!doctype html><html><head><meta charset="utf-8"><title>原 Studio V4 验收</title><link rel="stylesheet" href="/app/globals.css"><link rel="stylesheet" href="/app/creation.css"></head><body><div id="root"></div><script type="module" src="/scripts/tests/fixtures/v4-original-studio.mjs"></script></body></html>',
            );
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(html);
          });
        },
      },
    ],
  });
  let browser;
  let page;
  const errors = [];
  const consoleErrors = [];
  await mkdir(output, { recursive: true });
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    page = await context.newPage();
    page.setDefaultTimeout(120000);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
    await page.locator('.studio.creation-studio').waitFor({ timeout: 60000 });
    await page.locator('.source-path-layer').first().waitFor();
    const evidence = () => page.evaluate(() => window.originalStudioEvidence());
    assert.equal((await evidence()).paths, 76);
    assert.match(
      await page.locator('.project-name').innerText(),
      /sandrone-original-studio/,
    );
    assert.equal(
      await page
        .locator('.workspace')
        .evaluate((el) => getComputedStyle(el).display),
      'flex',
    );
    await page.getByRole('button', { name: '适合画布', exact: true }).click();
    await page.getByText('底图就绪', { exact: true }).waitFor();
    await page.getByRole('button', { name: '节点 (A)', exact: true }).click();
    // Real SVG geometry and DOM events; never dispatch editor commands from tests.
    const hit = page.locator('.source-path-layer path[aria-label]').first();
    const point = await hit.evaluate((el) => {
      const p = el
        .getPointAtLength(el.getTotalLength() * 0.4)
        .matrixTransform(el.getScreenCTM());
      return { x: p.x, y: p.y };
    });
    await page.mouse.click(point.x, point.y);
    await page.locator('[data-node-index]').first().waitFor();
    const node = page.locator('[data-node-index]').first();
    const box = await node.locator('rect').boundingBox();
    assert.ok(box);
    const before = await evidence();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 18,
      box.y + box.height / 2 + 12,
      { steps: 5 },
    );
    await page.mouse.up();
    await page.waitForFunction(
      (revision) => window.originalStudioEvidence().revision > revision,
      before.revision,
    );
    const edited = await evidence();
    assert.equal(edited.revision, before.revision + 1);
    assert.equal(edited.sourceUnchanged, false);
    assert.equal(edited.nodePosesUnchanged, true);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.equal((await evidence()).baselineRestored, true);
    await page
      .getByRole('button', { name: '移动对象 (H)', exact: true })
      .click();
    const beforeMove = await evidence();
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 22, point.y + 14, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction(
      (revision) => window.originalStudioEvidence().revision > revision,
      beforeMove.revision,
    );
    const moved = await evidence();
    assert.equal(moved.revision, beforeMove.revision + 1);
    assert.equal(moved.sourceUnchanged, true);
    assert.equal(moved.programsUnchanged, true);
    assert.equal(moved.nodePosesUnchanged, false);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.equal((await evidence()).baselineRestored, true);
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    await page.waitForFunction(() => !window.originalStudioEvidence().dirty);
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioSavedEvidence()),
      { kind: 'v4', matchesCurrent: true },
    );
    const openFile = async (name) => {
      await page.evaluate(
        (name) => window.originalStudioChooseFile(name),
        name,
      );
      await page.getByRole('button', { name: 'Splinelet 主菜单' }).click();
      await page
        .getByRole('menuitem', { name: '打开工程…', exact: true })
        .click();
    };
    await page.getByRole('button', { name: '重做', exact: true }).click();
    const savedState = await evidence();
    assert.equal(savedState.canUndo, true);
    assert.equal(savedState.baselineRestored, false);
    await openFile('saved');
    await page.waitForFunction(
      (epoch) => window.originalStudioEvidence().epoch !== epoch,
      savedState.epoch,
    );
    const reopened = await evidence();
    assert.equal(reopened.baselineRestored, true);
    assert.equal(reopened.canUndo, false);
    assert.equal(reopened.dirty, false);
    assert.equal(reopened.targetKind, 'web');
    await openFile('invalid');
    await page
      .locator('footer')
      .getByText(/打开工程失败/)
      .waitFor();
    assert.deepEqual(await evidence(), reopened);
    await openFile('legacy');
    await page.waitForFunction(
      (epoch) => window.originalStudioEvidence().epoch !== epoch,
      reopened.epoch,
    );
    const legacyOpened = await evidence();
    assert.equal(legacyOpened.paths, 76);
    assert.equal(legacyOpened.objects, 11);
    assert.equal(legacyOpened.canUndo, false);
    assert.equal(legacyOpened.dirty, true);
    assert.equal(legacyOpened.targetKind, null);
    await page.getByRole('button', { name: 'Splinelet 主菜单' }).click();
    await page
      .getByRole('menuitem', { name: '载入示例工程', exact: true })
      .click();
    await page.waitForFunction(
      (epoch) => window.originalStudioEvidence().epoch !== epoch,
      legacyOpened.epoch,
    );
    assert.equal((await evidence()).baselineRestored, true);
    assert.equal((await evidence()).targetKind, null);
    assert.match(
      await page.locator('.project-name').innerText(),
      /sandrone-example/,
    );
    const beforeImage = await evidence();
    await page
      .locator('input[type="file"][accept="image/png,image/jpeg,image/webp"]')
      .setInputFiles(resolve(root, 'public/reference.png'));
    await page.waitForFunction(
      (epoch) => window.originalStudioEvidence().epoch !== epoch,
      beforeImage.epoch,
    );
    const newImage = await evidence();
    assert.equal(newImage.paths, 0);
    assert.equal(newImage.objects, 0);
    assert.equal(newImage.dirty, true);
    assert.equal(newImage.targetKind, null);
    assert.equal(newImage.canUndo, false);
    await page.getByText('底图就绪', { exact: true }).waitFor();
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    await page.waitForFunction(() => !window.originalStudioEvidence().dirty);
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioSavedEvidence()),
      { kind: 'v4', matchesCurrent: true },
    );
    assert.match(
      await page.locator('.project-name').innerText(),
      /new-image-project/,
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
    await page.screenshot({
      path: resolve(output, 'original-studio.png'),
      fullPage: true,
    });
    await writeFile(
      resolve(output, 'result.json'),
      JSON.stringify(
        {
          passed: true,
          scope:
            'Full original StudioApp with injected V4 host; actual Sandrone, original layout, node/object edits, undo, OPFS save/reopen, invalid file rejection, legacy import and example menu. Not default-entry acceptance.',
          sourceEdit: edited,
          objectMove: moved,
          reopened,
          legacyOpened,
          newImage,
          evidence: await evidence(),
          errors,
          consoleErrors,
        },
        null,
        2,
      ),
    );
    console.log(
      'PASS full original Studio with V4 host: Sandrone, styles, edits, undo, save, V4/legacy/example open and invalid-file preservation',
    );
  } catch (error) {
    if (page) {
      await page
        .screenshot({ path: resolve(output, 'failure.png'), fullPage: true })
        .catch(() => {});
      await writeFile(
        resolve(output, 'failure.json'),
        JSON.stringify(
          {
            error: error.message,
            errors,
            consoleErrors,
            body: await page
              .locator('body')
              .innerText()
              .catch(() => ''),
          },
          null,
          2,
        ),
      );
    }
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
