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
  const { default: tailwindcss } = await import('@tailwindcss/postcss');
  const server = await createServer({
    configFile: false,
    root,
    publicDir: resolve(root, 'public'),
    css: { postcss: { plugins: [tailwindcss()] } },
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
    console.log('Checking canonical Sandrone body through worker');
    const solidReport = await page.evaluate(() =>
      Promise.race([
        window.traceStudio.call('creation_export', { format: 'check' }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(Error('Body request timed out after 120 seconds')),
            120000,
          ),
        ),
      ]),
    );
    console.log('Body check completed');
    assert.equal(solidReport.report.valid, true);
    assert.ok(solidReport.report.volumeMM3 > 0);
    const generic3mf = await page.evaluate(() =>
      window.traceStudio.call('creation_export', { format: '3mf-generic' }),
    );
    assert.equal(generic3mf.report.valid, true);
    const { unzipSync, strFromU8 } =
      await import('three/addons/libs/fflate.module.js');
    const archive = unzipSync(Buffer.from(generic3mf.base64, 'base64'));
    assert.match(strFromU8(archive['3D/3dmodel.model']), /<triangle /);
    assert.equal(
      (await evidence()).dirty,
      false,
      'body generation and export are read-only',
    );
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
    await page.getByRole('button', { name: '描线 (P)', exact: true }).click();
    const imageBox = await page.locator('.drawing-canvas image').boundingBox();
    assert.ok(imageBox);
    await page.keyboard.down('Alt');
    for (const [x, y] of [
      [0.3, 0.3],
      [0.6, 0.3],
      [0.6, 0.6],
    ]) {
      const previous = await evidence();
      await page.mouse.click(
        imageBox.x + imageBox.width * x,
        imageBox.y + imageBox.height * y,
      );
      await page.waitForFunction(
        (revision) => window.originalStudioEvidence().revision > revision,
        previous.revision,
      );
    }
    const drawing = await evidence();
    assert.equal(drawing.paths, 1);
    assert.equal(drawing.objects, 1);
    assert.equal(drawing.pathGeometry[0].segments, 2);
    assert.equal(drawing.pathGeometry[0].closed, false);
    await page.keyboard.up('Alt');
    await page.getByRole('tab', { name: '手动', exact: true }).click();
    await page.keyboard.press('c');
    await page.waitForFunction(
      () => window.originalStudioEvidence().pathGeometry[0]?.closed === true,
    );
    const closed = await evidence();
    assert.equal(closed.pathGeometry[0].segments, 3);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.equal((await evidence()).pathGeometry[0].closed, false);
    assert.equal((await evidence()).pathGeometry[0].segments, 2);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    assert.equal((await evidence()).pathGeometry[0].closed, true);
    await page.locator('[data-creation-cell]').first().waitFor();
    await page.getByRole('button', { name: '选择 (V)', exact: true }).click();
    await page.mouse.click(
      imageBox.x + imageBox.width * 0.5,
      imageBox.y + imageBox.height * 0.4,
    );
    assert.match(
      await page.locator('.creation-canvas-bar').innerText(),
      /单个区域/,
    );
    const drawPoint = async (x, y) => {
      const previous = await evidence();
      const currentImageBox = await page
        .locator('.drawing-canvas image')
        .boundingBox();
      await page.mouse.click(
        currentImageBox.x + currentImageBox.width * x,
        currentImageBox.y + currentImageBox.height * y,
      );
      await page.waitForFunction(
        (revision) => window.originalStudioEvidence().revision > revision,
        previous.revision,
      );
    };
    await page.locator('[data-tree-object]').first().click();
    await page.getByRole('button', { name: '画分区线', exact: true }).click();
    await drawPoint(0.45, 0.29);
    assert.equal((await evidence()).pendingRegionDrawings, 1);
    assert.equal(await page.locator('[data-creation-cell]').count(), 1);
    await drawPoint(0.45, 0.46);
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => window.originalStudioEvidence().pendingRegionDrawings === 0,
    );
    await page.waitForFunction(
      () => document.querySelectorAll('[data-creation-cell]').length === 2,
    );
    const divided = await evidence();
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.equal((await evidence()).pendingRegionDrawings, 1);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    assert.equal((await evidence()).pendingRegionDrawings, 0);
    await page.locator('[data-tree-object]').first().click();
    await page.getByRole('button', { name: '画挖洞轮廓', exact: true }).click();
    await drawPoint(0.53, 0.34);
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    await page.waitForFunction(() => !window.originalStudioEvidence().dirty);
    const pendingSaved = await evidence();
    assert.equal(pendingSaved.pendingRegionDrawings, 1);
    await openFile('current');
    await page.waitForFunction(
      (epoch) => window.originalStudioEvidence().epoch !== epoch,
      pendingSaved.epoch,
    );
    assert.equal((await evidence()).pendingRegionDrawings, 1);
    await page.getByText('底图就绪', { exact: true }).waitFor();
    await page.locator('[data-tree-object]').first().click();
    // The original tree and endpoint action resume the saved raw path.
    const sourceRows = page.locator('[data-tree-path]');
    if (!(await sourceRows.count()))
      await page.getByRole('button', { name: '展开部件', exact: true }).click();
    await sourceRows.last().click();
    await page.getByRole('button', { name: '从尾续画', exact: true }).click();
    await page.getByRole('tab', { name: '手动', exact: true }).click();
    await drawPoint(0.57, 0.34);
    await drawPoint(0.57, 0.38);
    await drawPoint(0.53, 0.38);
    assert.equal((await evidence()).pendingRegionDrawings, 1);
    await page.keyboard.press('c');
    await page.waitForFunction(
      () => window.originalStudioEvidence().pendingRegionDrawings === 0,
    );
    const cutHole = await evidence();
    assert.equal(cutHole.pathGeometry.at(-1).closed, true);
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[data-creation-cell]').length === 2 &&
        !document
          .querySelector('[data-tree-object]')
          ?.textContent.includes('需检查'),
    );
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    await page.waitForFunction(() => !window.originalStudioEvidence().dirty);
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioSavedEvidence()),
      { kind: 'v4', matchesCurrent: true },
    );
    await page.locator('[data-tree-object]').first().click();
    await page.getByRole('button', { name: '画轮廓', exact: true }).click();
    await drawPoint(0.3, 0.5);
    assert.equal((await evidence()).pendingRegionDrawings, 1);
    await drawPoint(0.38, 0.5);
    await drawPoint(0.38, 0.58);
    await drawPoint(0.3, 0.58);
    await page.keyboard.press('c');
    await page.waitForFunction(
      () =>
        window.originalStudioEvidence().pendingRegionDrawings === 0 &&
        document.querySelectorAll('[data-creation-cell]').length === 3,
    );
    const appendedBoundary = await evidence();
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.equal((await evidence()).pendingRegionDrawings, 1);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    assert.equal((await evidence()).pendingRegionDrawings, 0);
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    await page.waitForFunction(() => !window.originalStudioEvidence().dirty);
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioSavedEvidence()),
      { kind: 'v4', matchesCurrent: true },
    );
    // Open paths made through the original tools share one owner and merge
    // through endpoint selection, not a fixture-side command.
    await page
      .locator('input[type="file"][accept="image/png,image/jpeg,image/webp"]')
      .setInputFiles(resolve(root, 'public/reference.png'));
    await page.waitForFunction(
      () => window.originalStudioEvidence().paths === 0,
    );
    await page.getByText('底图就绪', { exact: true }).waitFor();
    await page.getByRole('button', { name: '描线 (P)', exact: true }).click();
    await page.getByRole('tab', { name: '手动', exact: true }).click();
    await drawPoint(0.25, 0.25);
    await drawPoint(0.35, 0.25);
    await page.keyboard.press('Enter');
    await page.locator('[data-tree-object]').first().click();
    await page.getByRole('button', { name: '画轮廓', exact: true }).click();
    await drawPoint(0.45, 0.25);
    await drawPoint(0.55, 0.25);
    await page.keyboard.press('Enter');
    assert.equal((await evidence()).paths, 2);
    assert.equal((await evidence()).objects, 1);
    await page.getByRole('button', { name: '节点 (A)', exact: true }).click();
    await page.locator('[data-tree-path]').first().click();
    const firstTail = page.locator('[data-node-index="1"] rect').first();
    await firstTail.click();
    await page.keyboard.press('m');
    const mergeTarget = page.locator('[data-merge-endpoint]');
    await mergeTarget.first().click();
    await page.waitForFunction(
      () => window.originalStudioEvidence().paths === 1,
    );
    const mergedPaths = await evidence();
    assert.equal(mergedPaths.pathGeometry[0].segments, 3);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.equal((await evidence()).paths, 2);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    assert.equal((await evidence()).paths, 1);
    await page.getByRole('button', { name: '选择 (V)', exact: true }).click();
    await page.locator('[data-tree-path]').first().click();
    await page.getByText('路径操作', { exact: true }).click();
    await page.getByRole('button', { name: /删除当前路径/ }).click();
    await page.waitForFunction(
      () => window.originalStudioEvidence().paths === 0,
    );
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.equal((await evidence()).paths, 1);
    await page.locator('[data-tree-path]').first().click();
    await page.getByRole('button', { name: '节点 (A)', exact: true }).click();
    await page.locator('[data-node-index="0"] rect').first().click();
    const handleBox = await page
      .locator('[data-control-handle="0:1"] circle')
      .first()
      .boundingBox();
    assert.ok(handleBox);
    const beforeHandle = await evidence();
    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2 + 25,
      { steps: 4 },
    );
    await page.mouse.up();
    await page.waitForFunction(
      (revision) => window.originalStudioEvidence().revision > revision,
      beforeHandle.revision,
    );
    const beforeRefit = await page.evaluate(() =>
      window.originalStudioDocument(),
    );
    const requestRefit = async () => {
      await page.getByRole('button', { name: '选择 (V)', exact: true }).click();
      await page.locator('[data-tree-path]').first().click();
      const details = page.locator('.spline-more-actions');
      if (
        !(await details.getAttribute('open')) &&
        !(await details.evaluate((el) => el.open))
      )
        await page.getByText('路径操作', { exact: true }).click();
      await page
        .getByRole('button', { name: '重新拟合当前路径…', exact: true })
        .click();
    };
    await requestRefit();
    await page
      .getByRole('button', { name: '取消，保留现有曲线', exact: true })
      .click();
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioDocument()),
      beforeRefit,
    );
    await requestRefit();
    const refitRevision = (await evidence()).revision;
    await page
      .getByRole('button', { name: '确认替换并重拟合', exact: true })
      .click();
    await page.waitForFunction(
      (revision) => window.originalStudioEvidence().revision > revision,
      refitRevision,
    );
    const afterRefit = await page.evaluate(() =>
      window.originalStudioDocument(),
    );
    assert.notDeepEqual(afterRefit.sketches, beforeRefit.sketches);
    for (const [id, sketch] of Object.entries(beforeRefit.sketches)) {
      assert.deepEqual(afterRefit.sketches[id].vertices, sketch.vertices);
      assert.deepEqual(
        Object.keys(afterRefit.sketches[id].edges),
        Object.keys(sketch.edges),
      );
    }
    assert.deepEqual(afterRefit.programs, beforeRefit.programs);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioDocument()),
      beforeRefit,
    );
    await page.getByRole('button', { name: '重做', exact: true }).click();
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioDocument()),
      afterRefit,
    );
    // Public batch-authoring API prepares the same candidate accepted by the
    // original UI. No fixture-side editor mutation is used.
    const batch = async (preview) =>
      page.evaluate(
        (preview) =>
          window.traceStudio.call('create_path', {
            name: 'candidate path',
            mode: 'manual',
            snap: false,
            closed: true,
            preview,
            points: [
              { x: 220, y: 650 },
              { x: 320, y: 650 },
              { x: 270, y: 730 },
            ],
          }),
        preview,
      );
    const beforeCandidate = await page.evaluate(() =>
      window.originalStudioDocument(),
    );
    await batch(true);
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioDocument()),
      beforeCandidate,
    );
    await page.getByRole('button', { name: '丢弃', exact: true }).click();
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioDocument()),
      beforeCandidate,
    );
    const candidate = await batch(true);
    await page.getByRole('button', { name: '接受', exact: true }).click();
    await page.waitForFunction(
      () => window.originalStudioEvidence().paths === 2,
    );
    const acceptedCandidate = await page.evaluate(() =>
      window.originalStudioDocument(),
    );
    assert.equal(
      (await evidence()).pathGeometry.at(-1).segments,
      candidate.segments,
    );
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioDocument()),
      beforeCandidate,
    );
    await page.getByRole('button', { name: '重做', exact: true }).click();
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioDocument()),
      acceptedCandidate,
    );
    await batch(true);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    // Undo clears the candidate, so it cannot later write into a different revision.
    assert.equal(
      await page.getByRole('button', { name: '接受', exact: true }).count(),
      0,
    );
    const direct = await batch(false);
    assert.equal((await evidence()).pathGeometry.at(-1).id, direct.id);
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    await page.waitForFunction(() => !window.originalStudioEvidence().dirty);
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioSavedEvidence()),
      { kind: 'v4', matchesCurrent: true },
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
          solidReport: solidReport.report,
          generic3mfBytes: Buffer.from(generic3mf.base64, 'base64').length,
          scope:
            'Full original StudioApp with injected V4 host; actual Sandrone, original layout, node/object edits, undo, OPFS save/reopen, invalid file rejection, legacy import and example menu. Not default-entry acceptance.',
          sourceEdit: edited,
          objectMove: moved,
          reopened,
          legacyOpened,
          newImage,
          drawing,
          closed,
          divided,
          cutHole,
          appendedBoundary,
          mergedPaths,
          pendingSaved,
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
