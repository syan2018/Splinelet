#!/usr/bin/env node
// Full original UI with an injected V4 host. The browser runner provides the
// fresh context and ephemeral Vite origin.
const assert = require('node:assert/strict');
const { writeFile, readFile } = require('node:fs/promises');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../../../..');

async function setup(context) {
  await context.addInitScript(() => {
    // Compatibility calls still carry an observed canonical revision.
    window.reviewCall = async (action, args = {}) => {
      const observed = await window.traceStudio.call('document.get');
      return window.traceStudio.call(action, {
        expectedRevision: observed.revision,
        ...args,
      });
    };
  });
}

async function test(page, output) {
  // Await API promises before deciding whether a condition has become true.
  // Playwright waitForFunction otherwise treats the Promise itself as truthy.
  const waitForCondition = async (predicate, arg, options = {}) => {
    const deadline = Date.now() + (options.timeout || 120000);
    while (Date.now() < deadline) {
      if (await page.evaluate(predicate, arg)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw Error('Original Studio condition timed out: ' + String(predicate));
  };
  const errors = [];
  const consoleErrors = [];
  const workerUrls = [];
  try {
    page.on('worker', (worker) => workerUrls.push(worker.url()));
    page.setDefaultTimeout(120000);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
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
    await page
      .getByRole('button', { name: '项目色卡 · 全局', exact: true })
      .click();
    await page
      .getByLabel('项目色色值', { exact: true })
      .waitFor({ timeout: 10000 });
    assert.deepEqual(
      errors,
      [],
      'opening the palette must not crash the original Studio',
    );
    if (process.argv.includes('--palette-only')) {
      const beforePalette = await page.evaluate(() =>
        window.originalStudioDocument(),
      );
      await page.locator('.creation-project-color .creation-name').dblclick();
      await page
        .getByRole('textbox', { name: '重命名项目色', exact: true })
        .fill('色卡回归');
      await page
        .getByRole('textbox', { name: '重命名项目色', exact: true })
        .press('Enter');
      await waitForCondition(() =>
        Object.values(
          window.originalStudioDocument().appearances.swatches,
        ).some((item) => item.name === '色卡回归'),
      );
      await page.getByRole('button', { name: '撤销', exact: true }).click();
      assert.deepEqual(
        await page.evaluate(() => window.originalStudioDocument()),
        beforePalette,
      );
    }
    await page.getByRole('button', { name: '删除项目色', exact: true }).click();
    await page
      .getByRole('dialog')
      .filter({ hasText: '替换并删除' })
      .waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page
      .getByRole('button', { name: '当前工具设置', exact: true })
      .first()
      .click();
    if (process.argv.includes('--palette-only')) {
      assert.deepEqual(errors, []);
      console.log(
        'PASS original palette opens, renames, undoes, and confirms referenced-colour deletion without legacy fields',
      );
      return;
    }
    const advancedModelView = await page.evaluate(() =>
      window.originalStudioModelView(),
    );
    assert.equal(advancedModelView.regions.length, 69);
    assert.equal(advancedModelView.source.paths.length, 76);
    assert.equal(advancedModelView.creation.errors.length, 0);
    assert.ok(
      advancedModelView.regions.every(
        (region) =>
          region.authoredRelief.value.enabled &&
          region.areaMM2 > 0 &&
          region.outputRef.kind === 'output',
      ),
    );
    console.log('Checking canonical Sandrone body through worker');
    const solidReport = await page.evaluate(() =>
      Promise.race([
        window.reviewCall('creation_export', { format: 'check' }),
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
      window.reviewCall('creation_export', { format: '3mf-generic' }),
    );
    assert.equal(generic3mf.report.valid, true);
    const { unzipSync, strFromU8 } =
      await import('three/addons/libs/fflate.module.js');
    const archive = unzipSync(Buffer.from(generic3mf.base64, 'base64'));
    assert.match(strFromU8(archive['3D/3dmodel.model']), /<triangle /);
    const { decodeDocument } =
      await import('../../../../src/lib/document/codec.mjs');
    const projectCopy = await page.evaluate(() =>
      window.reviewCall('export', { format: 'json' }),
    );
    assert.equal(projectCopy.filename, 'Splinelet工程.spl');
    const decodedCopy = decodeDocument(
      Buffer.from(projectCopy.base64, 'base64'),
    );
    assert.deepEqual(
      decodedCopy.document,
      await page.evaluate(() => window.originalStudioDocument()),
    );
    assert.ok(
      Object.keys(decodedCopy.assets).length,
      'copy includes reference bytes',
    );
    await page
      .getByRole('button', { name: '导出', exact: true })
      .first()
      .click();
    await page
      .getByRole('button', { name: '源曲线 SVG · 精确贝塞尔', exact: true })
      .click();
    const beforeExportPreference = await evidence();
    await page
      .getByRole('spinbutton', { name: '挤出厚度', exact: true })
      .fill('7.5');
    await waitForCondition(
      async () => (await window.reviewCall('state')).depthMM === 7.5,
    );
    const blenderCopy = await page.evaluate(() =>
      window.reviewCall('export', { format: 'blender' }),
    );
    const blenderData = JSON.parse(
      JSON.parse(
        blenderCopy.content.match(/DATA = json.loads\((.*)\)\nscale/)[1],
      ),
    );
    assert.equal(blenderData.depthMM, 7.5);
    assert.deepEqual(await evidence(), beforeExportPreference);
    const downloadPending = page.waitForEvent('download');
    await page
      .getByRole('button', { name: '导出 .spl 工程副本', exact: true })
      .click();
    const copyDownload = await downloadPending;
    const copyPath = resolve(output, 'exported-project-copy.spl');
    await copyDownload.saveAs(copyPath);
    assert.deepEqual(decodeDocument(await readFile(copyPath)), decodedCopy);
    await page.keyboard.press('Escape');
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
    const beforeSplit = await evidence();
    const splitBaseline = await page.evaluate(() =>
      window.originalStudioDocument(),
    );
    await page.mouse.dblclick(point.x, point.y);
    await waitForCondition(
      (revision) => window.originalStudioEvidence().revision > revision,
      beforeSplit.revision,
    );
    const afterSplit = await evidence();
    assert.equal(afterSplit.revision, beforeSplit.revision + 1);
    assert.equal(
      afterSplit.pathGeometry.reduce((sum, path) => sum + path.segments, 0),
      beforeSplit.pathGeometry.reduce((sum, path) => sum + path.segments, 0) +
        1,
    );
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioDocument()),
      splitBaseline,
    );
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
    await waitForCondition(
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
    await page.evaluate(() => window.reviewCall('creation_inspect'));
    const beforeMove = await evidence();
    assert.equal(
      (await page.evaluate(() => window.reviewCall('state'))).creation.selection
        .kind,
      'object',
      'move mode must have converted the source selection before dragging',
    );
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 22, point.y + 14, { steps: 5 });
    await page.mouse.up();
    await waitForCondition(
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
    await waitForCondition(() => !window.originalStudioEvidence().dirty);
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
    await waitForCondition(
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
    await waitForCondition(
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
    await waitForCondition(
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
    await waitForCondition(
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
    await waitForCondition(() => !window.originalStudioEvidence().dirty);
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
      await waitForCondition(
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
    await waitForCondition(
      () => window.originalStudioEvidence().pathGeometry[0]?.closed === true,
    );
    const closed = await evidence();
    assert.equal(closed.pathGeometry[0].segments, 3);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.equal((await evidence()).pathGeometry[0].closed, false);
    assert.equal((await evidence()).pathGeometry[0].segments, 2);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    assert.equal((await evidence()).pathGeometry[0].closed, true);
    await page.evaluate(() => window.reviewCall('creation_inspect'));
    const createdCell = page.locator('[data-creation-cell]').first();
    await createdCell.waitFor();
    await page.getByRole('button', { name: '选择 (V)', exact: true }).click();
    // Click inside the rendered region. Image-relative coordinates are not
    // stable after the canvas changes its fitted transform for a new image.
    const createdCellBox = await createdCell.boundingBox();
    assert(createdCellBox, 'the rendered region must have a screen box');
    await createdCell.click({
      position: {
        x: createdCellBox.width * 0.75,
        y: createdCellBox.height * 0.25,
      },
    });
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
      await waitForCondition(
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
    await waitForCondition(
      () => window.originalStudioEvidence().pendingRegionDrawings === 0,
    );
    await waitForCondition(
      () => document.querySelectorAll('[data-creation-cell]').length === 2,
    );
    const divided = await evidence();
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.equal((await evidence()).pendingRegionDrawings, 1);
    // The public completion API must publish the same pending branch as Enter.
    const apiFinished = await page.evaluate(async (pathId) => {
      await window.reviewCall('resume_path', { pathId, end: 'end' });
      return window.reviewCall('finish_path', {});
    }, divided.pathGeometry.at(-1).id);
    assert.deepEqual(apiFinished, { finished: true });
    await waitForCondition(
      () => window.originalStudioEvidence().pendingRegionDrawings === 0,
    );
    assert.equal((await evidence()).revision, divided.revision + 2);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.equal((await evidence()).pendingRegionDrawings, 1);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    assert.equal((await evidence()).pendingRegionDrawings, 0);
    await page.locator('[data-tree-object]').first().click();
    await page.getByRole('button', { name: '画挖洞轮廓', exact: true }).click();
    await drawPoint(0.53, 0.34);
    const unfinishedHole = await evidence();
    const finishIssue = await page.evaluate(async () => {
      try {
        await window.reviewCall('finish_path', {});
        return null;
      } catch (error) {
        return error.message;
      }
    });
    assert.match(finishIssue, /线条已保留/);
    assert.equal((await evidence()).revision, unfinishedHole.revision);
    assert.equal((await evidence()).pendingRegionDrawings, 1);
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    await waitForCondition(() => !window.originalStudioEvidence().dirty);
    const pendingSaved = await evidence();
    assert.equal(pendingSaved.pendingRegionDrawings, 1);
    await openFile('current');
    await waitForCondition(
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
    await waitForCondition(
      () => window.originalStudioEvidence().pendingRegionDrawings === 0,
    );
    const cutHole = await evidence();
    assert.equal(cutHole.pathGeometry.at(-1).closed, true);
    await waitForCondition(
      () =>
        document.querySelectorAll('[data-creation-cell]').length === 2 &&
        !document
          .querySelector('[data-tree-object]')
          ?.textContent.includes('需检查'),
    );
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    await waitForCondition(() => !window.originalStudioEvidence().dirty);
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
    await waitForCondition(
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
    await waitForCondition(() => !window.originalStudioEvidence().dirty);
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioSavedEvidence()),
      { kind: 'v4', matchesCurrent: true },
    );
    // Open paths made through the original tools share one owner and merge
    // through endpoint selection, not a fixture-side command.
    await page
      .locator('input[type="file"][accept="image/png,image/jpeg,image/webp"]')
      .setInputFiles(resolve(root, 'public/reference.png'));
    await waitForCondition(() => window.originalStudioEvidence().paths === 0);
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
    await waitForCondition(() => window.originalStudioEvidence().paths === 1);
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
    await waitForCondition(() => window.originalStudioEvidence().paths === 0);
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
    await waitForCondition(
      (revision) => window.originalStudioEvidence().revision > revision,
      beforeHandle.revision,
    );
    const beforeRefit = await page.evaluate(() =>
      window.originalStudioDocument(),
    );
    for (const point of [1, 2]) {
      const beforeApiHandle = await evidence();
      const movedApiHandle = await page.evaluate(async (pointIndex) => {
        const { splines } = await window.reviewCall('spline_inspect', {});
        const spline = splines[0];
        const original =
          pointIndex === 1
            ? spline.nodes[0].handleRight
            : spline.nodes[1].handleLeft;
        const position = { x: original.x + 6, y: original.y + 4 };
        await window.reviewCall('set_point', {
          pathId: spline.id,
          curve: 0,
          point: pointIndex,
          position,
        });
        const inspected = await window.reviewCall('spline_inspect', {
          pathIds: [spline.id],
        });
        return {
          position,
          actual:
            pointIndex === 1
              ? inspected.splines[0].nodes[0].handleRight
              : inspected.splines[0].nodes[1].handleLeft,
        };
      }, point);
      assert.ok(
        Math.abs(movedApiHandle.position.x - movedApiHandle.actual.x) < 1e-8,
      );
      assert.ok(
        Math.abs(movedApiHandle.position.y - movedApiHandle.actual.y) < 1e-8,
      );
      assert.equal((await evidence()).revision, beforeApiHandle.revision + 1);
      await page.getByRole('button', { name: '撤销', exact: true }).click();
      assert.deepEqual(
        await page.evaluate(() => window.originalStudioDocument()),
        beforeRefit,
      );
    }
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
    await waitForCondition(
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
          window.reviewCall('create_path', {
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
    await waitForCondition(() => window.originalStudioEvidence().paths === 2);
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
    await waitForCondition(() => !window.originalStudioEvidence().dirty);
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioSavedEvidence()),
      { kind: 'v4', matchesCurrent: true },
    );
    const beforeGroups = await page.evaluate(() =>
      window.originalStudioDocument(),
    );
    const groupPaths = (await evidence()).pathGeometry.map((path) => path.id);
    await page.evaluate(
      (pathIds) => window.reviewCall('select_paths', { pathIds }),
      groupPaths,
    );
    await page.keyboard.press('Control+g');
    const groupedProject = await page.evaluate(() =>
      window.reviewCall('get_project'),
    );
    assert.equal(groupedProject.groups.length, 1);
    const sourceGroup = groupedProject.groups[0].id;
    assert.ok(
      groupedProject.paths.every((path) => path.groupId === sourceGroup),
    );
    const groupedDocument = await page.evaluate(() =>
      window.originalStudioDocument(),
    );
    assert.deepEqual(groupedDocument.sketches, beforeGroups.sketches);
    assert.deepEqual(groupedDocument.programs, beforeGroups.programs);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioDocument()),
      beforeGroups,
    );
    await page.getByRole('button', { name: '重做', exact: true }).click();
    const secondGroup = await page.evaluate(() =>
      window.reviewCall('manage_group', {
        action: 'create',
        name: 'API 分组',
      }),
    );
    await page.evaluate(
      ({ id, pathId }) =>
        window.reviewCall('manage_group', {
          action: 'assign',
          id,
          pathIds: [pathId],
        }),
      { id: secondGroup.id, pathId: groupPaths[0] },
    );
    await page.evaluate(
      (id) =>
        window.reviewCall('manage_group', {
          action: 'rename',
          id,
          name: '重命名分组',
        }),
      secondGroup.id,
    );
    await page.evaluate(
      (id) =>
        window.reviewCall('manage_group', {
          action: 'visibility',
          id,
          visible: false,
        }),
      secondGroup.id,
    );
    assert.equal(
      (await page.evaluate(() => window.reviewCall('get_project'))).paths.find(
        (path) => path.id === groupPaths[0],
      ).visible,
      false,
    );
    await page.evaluate(
      (id) =>
        window.reviewCall('manage_group', {
          action: 'visibility',
          id,
          visible: true,
        }),
      secondGroup.id,
    );
    await page.evaluate(
      ({ pathId, targetId }) =>
        window.reviewCall('move_paths', {
          pathIds: [pathId],
          targetId,
          after: true,
        }),
      { pathId: groupPaths[0], targetId: groupPaths[1] },
    );
    const reordered = await page.evaluate(() =>
      window.reviewCall('get_project'),
    );
    assert.deepEqual(
      reordered.paths.map((path) => path.id),
      [groupPaths[1], groupPaths[0]],
    );
    assert.ok(reordered.paths.every((path) => path.groupId === sourceGroup));
    await page.evaluate(
      (id) => window.reviewCall('manage_group', { action: 'delete', id }),
      secondGroup.id,
    );
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    await waitForCondition(() => !window.originalStudioEvidence().dirty);
    const beforeSplines = await page.evaluate(() =>
      window.originalStudioDocument(),
    );
    const splineRevision = (await evidence()).revision;
    const exactBatch = await page.evaluate(() =>
      window.reviewCall('spline_apply', {
        units: 'model',
        splines: [
          {
            name: '精确辅助线',
            nodes: [
              { co: { x: -10, y: 0 }, handleRight: { x: -7, y: 9 } },
              { co: { x: 10, y: 0 }, handleLeft: { x: 7, y: -4 } },
            ],
          },
          {
            name: '精确闭合线',
            closed: true,
            nodes: [
              { co: { x: -8, y: -8 } },
              { co: { x: 8, y: -8 } },
              { co: { x: 0, y: 8 } },
            ],
          },
        ],
      }),
    );
    assert.equal(exactBatch.pathIds.length, 2);
    const exactRoles = await page.evaluate(() =>
      window.reviewCall('get_project'),
    );
    const boundaryOwner = exactRoles.creation.objects.find((object) =>
      object.pathIds.includes(exactBatch.pathIds[1]),
    );
    assert.equal(boundaryOwner.roles[exactBatch.pathIds[1]], 'boundary');
    assert.equal((await evidence()).revision, splineRevision + 1);
    const exactState = await page.evaluate(() =>
      window.originalStudioDocument(),
    );
    await page.evaluate(() => window.reviewCall('undo'));
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioDocument()),
      beforeSplines,
    );
    await page.keyboard.press('Control+Shift+Z');
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioDocument()),
      exactState,
    );
    const applied = await page.evaluate(
      (id) =>
        window.reviewCall('spline_apply', {
          units: 'model',
          splines: [{ id, matrix: [0, 1, -1, 0, 2, 3] }],
        }),
      exactBatch.pathIds[0],
    );
    assert.deepEqual(applied.pathIds, [exactBatch.pathIds[0]]);
    const exactRead = await page.evaluate(
      (id) =>
        window.reviewCall('spline_inspect', {
          pathIds: [id],
          units: 'model',
        }),
      exactBatch.pathIds[0],
    );
    assert.ok(Math.abs(exactRead.splines[0].nodes[0].handleRight.x + 7) < 1e-8);
    assert.ok(Math.abs(exactRead.splines[0].nodes[0].handleRight.y + 4) < 1e-8);
    await page.evaluate(() => window.reviewCall('undo'));
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioDocument()),
      exactState,
    );
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    await waitForCondition(() => !window.originalStudioEvidence().dirty);
    const beforeSupport = await page.evaluate(() =>
      window.originalStudioDocument(),
    );
    await page.evaluate(
      async ({ objectId, pathId }) => {
        await window.reviewCall('creation_focus', { objectId });
        return window.reviewCall('select_paths', { pathIds: [pathId] });
      },
      { objectId: boundaryOwner.id, pathId: exactBatch.pathIds[1] },
    );
    await page
      .getByRole('button', { name: '当前选区属性', exact: true })
      .click();
    const roleControls = page.locator('.creation-role');
    const beforeRolesRevision = (await evidence()).revision;
    await roleControls
      .getByRole('button', { name: '参考', exact: true })
      .click();
    await waitForCondition(
      (revision) => window.originalStudioEvidence().revision === revision,
      beforeRolesRevision + 1,
    );
    await waitForCondition(
      () =>
        [...document.querySelectorAll('.creation-role button')]
          .find((button) => button.textContent === '参考')
          ?.getAttribute('aria-pressed') === 'true',
    );
    assert.equal(
      (await evidence()).revision,
      beforeRolesRevision + 1,
      'guide button must commit exactly once',
    );
    const afterGuide = await page.evaluate(() =>
      window.originalStudioDocument(),
    );
    assert.equal(
      await roleControls
        .getByRole('button', { name: '参考', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    await roleControls
      .getByRole('button', { name: '轮廓', exact: true })
      .click();
    await waitForCondition(
      (revision) => window.originalStudioEvidence().revision === revision,
      beforeRolesRevision + 2,
    );
    assert.equal(
      (await evidence()).revision,
      beforeRolesRevision + 2,
      'boundary button must commit exactly once',
    );
    await page.evaluate(() => window.reviewCall('undo'));
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioDocument()),
      afterGuide,
      'one undo restores guide membership',
    );
    await page.evaluate(() => window.reviewCall('undo'));
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioDocument()),
      beforeSupport,
    );
    const supportSource = await page.evaluate((id) => {
      const document = window.originalStudioDocument();
      const path = Object.values(document.sketches).find((sketch) =>
        Object.keys(sketch.paths).some((pathId) => id.endsWith(pathId)),
      );
      return path.ownerNodeId;
    }, exactBatch.pathIds[1]);
    await page.evaluate(
      (objectId) => window.reviewCall('creation_focus', { objectId }),
      supportSource,
    );
    await page
      .getByRole('button', { name: '当前选区属性', exact: true })
      .click();
    await page.getByText('生成承托部件 · 可选', { exact: true }).click();
    await page.getByRole('button', { name: '预览底板', exact: true }).click();
    await page
      .getByRole('button', { name: '添加承托部件', exact: true })
      .waitFor();
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioDocument()),
      beforeSupport,
    );
    await page.getByRole('button', { name: '取消底板', exact: true }).click();
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioDocument()),
      beforeSupport,
    );
    await page.getByRole('button', { name: '预览底板', exact: true }).click();
    await page
      .getByRole('button', { name: '添加承托部件', exact: true })
      .click();
    const afterSupport = await page.evaluate(() =>
      window.originalStudioDocument(),
    );
    assert.equal(
      Object.keys(afterSupport.nodes).length,
      Object.keys(beforeSupport.nodes).length + 1,
    );
    assert.deepEqual(afterSupport.sketches, beforeSupport.sketches);
    await page.evaluate(() => window.reviewCall('undo'));
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioDocument()),
      beforeSupport,
    );
    await page.getByRole('button', { name: '重做', exact: true }).click();
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioDocument()),
      afterSupport,
    );
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    await waitForCondition(() => !window.originalStudioEvidence().dirty);
    const beforeApiLoad = await evidence();
    const beforeApiDocument = await page.evaluate(() =>
      window.originalStudioDocument(),
    );
    const savedApiCopy = await page.evaluate(() =>
      window.reviewCall('export', { format: 'json' }),
    );
    const loadError = await page.evaluate(async () => {
      try {
        await window.reviewCall('load_project', { base64: 'AAAA' });
        return null;
      } catch (error) {
        return error.message;
      }
    });
    assert.equal(typeof loadError, 'string');
    assert.deepEqual(await evidence(), beforeApiLoad);
    const loadedApiCopy = await page.evaluate(
      (base64) =>
        window.reviewCall('load_project', {
          base64,
          filename: 'api-copy.spl',
        }),
      savedApiCopy.base64,
    );
    assert.equal(loadedApiCopy.paths, beforeApiLoad.paths);
    assert.notEqual((await evidence()).epoch, beforeApiLoad.epoch);
    assert.equal((await evidence()).canUndo, false);
    assert.equal((await evidence()).targetKind, null);
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioDocument()),
      beforeApiDocument,
    );
    await page.getByText('底图就绪', { exact: true }).waitFor();
    await batch(false);
    assert.equal((await evidence()).paths, beforeApiLoad.paths + 1);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioDocument()),
      beforeApiDocument,
    );
    const concurrentLoads = await page.evaluate(async (base64) => {
      const { decodeProject } = await import('/src/lib/project-format.mjs');
      const bytes = new Uint8Array(
        await (await fetch('/sandrone-example.spl')).arrayBuffer(),
      );
      return Promise.allSettled([
        window.reviewCall('load_project', { base64 }),
        window.reviewCall('load_project', {
          project: decodeProject(bytes),
        }),
      ]);
    }, savedApiCopy.base64);
    assert.equal(concurrentLoads[0].status, 'fulfilled');
    assert.equal(concurrentLoads[0].value.paths, beforeApiLoad.paths);
    assert.equal(concurrentLoads[1].status, 'rejected');
    const reloadedAfterConflict = await page.evaluate(async () => {
      const { decodeProject } = await import('/src/lib/project-format.mjs');
      const bytes = new Uint8Array(
        await (await fetch('/sandrone-example.spl')).arrayBuffer(),
      );
      return window.reviewCall('load_project', {
        project: decodeProject(bytes),
      });
    });
    assert.equal(reloadedAfterConflict.paths, 76);
    assert.equal((await evidence()).targetKind, null);
    assert.equal((await evidence()).dirty, true);
    assert.equal((await evidence()).canUndo, false);
    await page.getByText('底图就绪', { exact: true }).waitFor();
    await batch(false);
    assert.equal((await evidence()).paths, 77);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.equal((await evidence()).paths, 76);
    const beforeAdvanced = await page.evaluate(() =>
      window.originalStudioDocument(),
    );
    await page.evaluate(() =>
      window.reviewCall('set_workspace', { mode: 'faces' }),
    );
    const advancedDialog = page.getByRole('dialog', {
      name: '高级构造编辑器',
      exact: true,
    });
    await advancedDialog.waitFor();
    await waitForCondition(
      () => document.querySelectorAll('[data-region-row]').length === 69,
    );
    const inspectedModel = await page.evaluate(() =>
      window.reviewCall('inspect_model'),
    );
    assert.equal(inspectedModel.regions.length, 69);
    assert.equal(inspectedModel.model.features.length, 69);
    assert.ok(
      inspectedModel.model.regions.every((region) => region.kind === 'output'),
    );
    await advancedDialog
      .getByRole('button', { name: '体块与零件', exact: true })
      .click();
    await waitForCondition(
      () => document.querySelectorAll('[data-feature-row]').length === 69,
    );
    let advancedState;
    for (let attempt = 0; attempt < 120; attempt++) {
      advancedState = await page.evaluate(() => window.reviewCall('state'));
      if (!advancedState.model.calculating && advancedState.model.report?.valid)
        break;
      await page.waitForTimeout(250);
    }
    assert.equal(
      advancedState.model.report?.valid,
      true,
      advancedState.model.error ||
        'advanced viewport must receive the canonical solid',
    );
    await advancedDialog.screenshot({
      path: resolve(output, 'advanced-model-panel.png'),
    });
    await advancedDialog.locator('[data-feature-row]').first().click();
    let advancedThickness = advancedDialog.getByRole('spinbutton', {
      name: '体块厚度打印层数',
      exact: true,
    });
    if (!(await advancedThickness.count()))
      advancedThickness = advancedDialog.getByRole('spinbutton', {
        name: '体块厚度',
        exact: true,
      });
    const oldThickness = Number(await advancedThickness.inputValue());
    const beforeAdvancedRevision = (await evidence()).revision;
    await advancedThickness.fill(String(oldThickness + 1));
    await advancedThickness.press('Enter');
    await waitForCondition(
      (revision) => window.originalStudioEvidence().revision === revision,
      beforeAdvancedRevision + 1,
    );
    const afterAdvanced = await page.evaluate(() =>
      window.originalStudioDocument(),
    );
    assert.notDeepEqual(
      afterAdvanced.reliefDefinitions,
      beforeAdvanced.reliefDefinitions,
    );
    assert.deepEqual(afterAdvanced.programs, beforeAdvanced.programs);
    assert.deepEqual(afterAdvanced.sketches, beforeAdvanced.sketches);
    await advancedDialog
      .getByRole('button', { name: '撤销模型操作', exact: true })
      .click();
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioDocument()),
      beforeAdvanced,
    );
    const advancedProperties = await page.evaluate(() =>
      window.reviewCall('inspect_model'),
    );
    const renamedFeatureId = advancedProperties.model.features[0].id;
    await page.evaluate(
      (id) =>
        window.reviewCall('set_relief', {
          id,
          changes: { name: '原面板独立体块名称', color: '#abcdef' },
        }),
      renamedFeatureId,
    );
    const renamedProperties = await page.evaluate(() =>
      window.reviewCall('inspect_model'),
    );
    const renamedFeature = renamedProperties.model.features.find(
      (item) => item.id === renamedFeatureId,
    );
    assert.equal(renamedFeature.name, '原面板独立体块名称');
    assert.equal(renamedFeature.color, '#abcdef');
    assert.deepEqual(
      (await page.evaluate(() => window.originalStudioDocument())).sketches,
      beforeAdvanced.sketches,
    );
    await advancedDialog
      .getByRole('button', { name: '撤销模型操作', exact: true })
      .click();
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioDocument()),
      beforeAdvanced,
    );
    await page.evaluate(() => window.reviewCall('inspect_model'));
    await page.evaluate(() =>
      window.reviewCall('set_model_options', {
        toleranceMM: 0.02,
        manufacturingMM: 0.02,
      }),
    );
    const cleanedProperties = await page.evaluate(() =>
      window.reviewCall('inspect_model'),
    );
    assert.equal(cleanedProperties.model.toleranceMM, 0.02);
    assert.equal(cleanedProperties.model.manufacturingMM, 0.02);
    await advancedDialog
      .getByRole('button', { name: '撤销模型操作', exact: true })
      .click();
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioDocument()),
      beforeAdvanced,
    );
    await page.evaluate(() => window.reviewCall('inspect_model'));
    const beforeDisableRevision = (await evidence()).revision;
    await advancedDialog
      .locator('[data-feature-row]')
      .first()
      .getByRole('checkbox')
      .click();
    await waitForCondition(
      (revision) => window.originalStudioEvidence().revision === revision,
      beforeDisableRevision + 1,
    );
    await waitForCondition(
      () =>
        !document.querySelector('[data-feature-row] input[type="checkbox"]')
          .checked,
    );
    await advancedDialog
      .getByRole('button', { name: '撤销模型操作', exact: true })
      .click();
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioDocument()),
      beforeAdvanced,
    );
    await advancedDialog
      .getByRole('button', { name: '完成，返回创作', exact: true })
      .click();
    assert.ok(
      !workerUrls.some((url) => /\/model-worker\.ts(?:\?|$)/.test(url)),
      'canonical Model panel must not launch a legacy model worker',
    );
    const beforeWidth = await page.evaluate(() =>
      window.originalStudioDocument(),
    );
    const widthRevision = (await evidence()).revision;
    await page
      .getByRole('button', { name: '工程设置 · 全局', exact: true })
      .click();
    const widthInput = page.getByRole('spinbutton', {
      name: '底图对应宽度',
      exact: true,
    });
    const nextWidth = beforeWidth.sourceFrame.widthMM * 1.01;
    await widthInput.fill(String(nextWidth));
    await widthInput.press('Enter');
    await waitForCondition(
      (revision) => window.originalStudioEvidence().revision === revision,
      widthRevision + 1,
    );
    const afterWidth = await page.evaluate(() =>
      window.originalStudioDocument(),
    );
    assert.ok(Math.abs(afterWidth.sourceFrame.widthMM - nextWidth) < 1e-9);
    assert.deepEqual(afterWidth.programs, beforeWidth.programs);
    const widthCopy = await page.evaluate(() =>
      window.reviewCall('export', { format: 'json' }),
    );
    assert.deepEqual(
      decodeDocument(Buffer.from(widthCopy.base64, 'base64')).document,
      afterWidth,
    );
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioDocument()),
      beforeWidth,
    );
    assert.equal(
      Number(await widthInput.inputValue()),
      beforeWidth.sourceFrame.widthMM,
    );
    await page.getByRole('button', { name: '重做', exact: true }).click();
    assert.deepEqual(
      await page.evaluate(() => window.originalStudioDocument()),
      afterWidth,
    );
    await page.evaluate(
      (base64) => window.reviewCall('load_project', { base64 }),
      widthCopy.base64,
    );
    assert.equal(
      (await page.evaluate(() => window.originalStudioDocument())).sourceFrame
        .widthMM,
      afterWidth.sourceFrame.widthMM,
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
  }
}

module.exports = test;
module.exports.setup = setup;

if (require.main === module) {
  const harness = require('../harness/browser-runner.cjs');
  const forwarded = process.argv
    .slice(2)
    .filter((argument) => argument !== '--palette-only');
  const options = harness.parseArguments([
    '--suite',
    'studio',
    '--case',
    'original-studio',
    ...forwarded,
  ]);
  harness
    .run(options)
    .then(({ outputDirectory }) => {
      console.log(`PASS: original-studio browser case`);
      console.log(`Evidence: ${outputDirectory}`);
    })
    .catch((error) => {
      console.error(
        error instanceof Error ? error.stack || error.message : error,
      );
      process.exitCode = 1;
    });
}
