#!/usr/bin/env node
const assert = require('node:assert/strict');
const { writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');

async function setup(context) {
  await context.addInitScript(() => {
    const metrics = { workerEvaluations: 0, moves: [] };
    const postMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function patchedPostMessage(
      message,
      ...rest
    ) {
      if (message?.kind === 'evaluate') metrics.workerEvaluations += 1;
      return postMessage.call(this, message, ...rest);
    };
    const begin = () => {
      const observer = new MutationObserver((records) => {
        if (
          !records.some((record) =>
            record.target.closest?.('.source-path-layer'),
          )
        )
          return;
        const move = [...metrics.moves].reverse().find((item) => !item.svgAt);
        if (!move) return;
        move.svgAt = performance.now();
        move.inputToSvgMS = move.svgAt - move.pointerAt;
        requestAnimationFrame(() => {
          move.frameAt = performance.now();
          move.inputToNextFrameMS = move.frameAt - move.pointerAt;
        });
      });
      observer.observe(document.documentElement, {
        subtree: true,
        attributes: true,
        attributeFilter: ['d'],
      });
    };
    if (document.documentElement) begin();
    else addEventListener('DOMContentLoaded', begin, { once: true });
    addEventListener(
      'pointermove',
      (event) => {
        if (event.buttons & 1)
          metrics.moves.push({
            pointerAt: performance.now(),
            workerEvaluations: metrics.workerEvaluations,
          });
      },
      true,
    );
    window.__sourceDragFastpathMetrics = {
      reset() {
        metrics.workerEvaluations = 0;
        metrics.moves = [];
      },
      read() {
        return structuredClone(metrics);
      },
    };
  });
}

const center = (box) => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

async function test(page, output) {
  const evidence = () => page.evaluate(() => window.originalStudioEvidence());
  const documentState = () =>
    page.evaluate(() => window.originalStudioDocument());
  const sourceSignature = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.source-path-layer path')]
        .map((path) => path.getAttribute('d'))
        .join('\n'),
    );
  const resetMetrics = () =>
    page.evaluate(() => window.__sourceDragFastpathMetrics.reset());
  const metrics = () =>
    page.evaluate(() => window.__sourceDragFastpathMetrics.read());
  const waitFor = async (predicate, arg, timeout = 5_000) =>
    page.waitForFunction(predicate, arg, { timeout });
  const drag = async (point, offset, steps = 4) => {
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + offset.x, point.y + offset.y, { steps });
  };
  const pointOnPath = (locator, fraction = 0.37) =>
    locator.evaluate((path, fractionAtLength) => {
      const point = path.getPointAtLength(
        path.getTotalLength() * fractionAtLength,
      );
      const matrix = path.getScreenCTM();
      if (!matrix) throw new Error('path has no screen transform');
      const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      return { x: screen.x, y: screen.y };
    }, fraction);
  const assertFastPreview = async (before, label) => {
    const during = await evidence();
    const observed = await metrics();
    assert.equal(during.revision, before.revision, `${label} must not commit`);
    assert.equal(
      during.dirty,
      before.dirty,
      `${label} must not dirty the file`,
    );
    assert.equal(
      during.sourceUnchanged,
      before.sourceUnchanged,
      `${label} must not mutate the source document`,
    );
    assert.equal(
      observed.workerEvaluations,
      0,
      `${label} must not request region evaluation for pointer frames`,
    );
    const painted = observed.moves.filter(
      (move) => move.inputToSvgMS !== undefined,
    );
    assert.ok(painted.length, `${label} must paint a source-path delta`);
    assert.ok(
      painted.every((move) => move.inputToSvgMS < 250),
      `${label} input-to-SVG must remain under 250 ms`,
    );
    return observed;
  };
  const cancelDrag = async (locator, offset, label) => {
    const before = await evidence();
    const beforeDocument = await documentState();
    const beforePath = await sourceSignature();
    const box = await locator.boundingBox();
    assert.ok(box, `${label} target must be visible`);
    await resetMetrics();
    await drag(center(box), offset);
    await waitFor(
      (path) =>
        [...document.querySelectorAll('.source-path-layer path')]
          .map((item) => item.getAttribute('d'))
          .join('\n') !== path,
      beforePath,
    );
    const observed = await assertFastPreview(before, label);
    await page.keyboard.press('Escape');
    await waitFor(
      (path) =>
        [...document.querySelectorAll('.source-path-layer path')]
          .map((item) => item.getAttribute('d'))
          .join('\n') === path,
      beforePath,
    );
    assert.deepEqual(
      await documentState(),
      beforeDocument,
      `${label} cancel restores source`,
    );
    assert.deepEqual(
      await evidence(),
      before,
      `${label} cancel restores editor state`,
    );
    return observed;
  };

  await page.locator('.studio.creation-studio').waitFor({ timeout: 60_000 });
  await page.locator('.source-path-layer').first().waitFor();
  await page.getByRole('button', { name: '节点 (A)', exact: true }).click();
  const editablePath = page
    .locator('.source-path-layer path[aria-label]')
    .first();
  const selectionPoint = await pointOnPath(editablePath);
  await page.mouse.click(selectionPoint.x, selectionPoint.y);
  await page.locator('[data-node-index]').first().waitFor();
  await page.waitForTimeout(500);

  const pointMetrics = await cancelDrag(
    page.locator('[data-node-index] rect').first(),
    { x: 18, y: 12 },
    'point drag',
  );
  await page.locator('[data-node-index="0"] rect').first().click();
  const handleMetrics = await cancelDrag(
    page.locator('[data-control-handle="0:1"] circle').first(),
    { x: 0, y: 24 },
    'handle drag',
  );
  await writeFile(
    resolve(output, 'source-drag-fastpath-pre-path.json'),
    JSON.stringify({ point: pointMetrics, handle: handleMetrics }, null, 2) +
      '\n',
  );

  const beforeCommit = await evidence();
  const beforeDocument = await documentState();
  const beforePath = await sourceSignature();
  const pathPoint = await pointOnPath(editablePath, 0.61);
  await resetMetrics();
  await drag(pathPoint, { x: 22, y: 14 }, 5);
  await waitFor(
    (signature) =>
      [...document.querySelectorAll('.source-path-layer path')]
        .map((item) => item.getAttribute('d'))
        .join('\n') !== signature,
    beforePath,
  );
  const pathMetrics = await assertFastPreview(beforeCommit, 'path drag');
  await page.mouse.up();
  await waitFor(
    (revision) => window.originalStudioEvidence().revision === revision + 1,
    beforeCommit.revision,
    20_000,
  );
  await page.waitForTimeout(600);
  const afterCommitMetrics = await metrics();
  assert.ok(
    afterCommitMetrics.workerEvaluations <= 1,
    'only the committed path drag may schedule a single region evaluation',
  );
  const afterCommit = await evidence();
  assert.equal(afterCommit.dirty, true, 'mouseup commits the source edit once');
  assert.equal(afterCommit.sourceUnchanged, false);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await waitFor(
    (revision) => window.originalStudioEvidence().revision === revision + 1,
    afterCommit.revision,
    20_000,
  );
  assert.deepEqual(
    await documentState(),
    beforeDocument,
    'one undo restores the commit',
  );

  const report = {
    point: pointMetrics,
    handle: handleMetrics,
    path: pathMetrics,
    afterCommit: afterCommitMetrics,
  };
  await Promise.all([
    writeFile(
      resolve(output, 'source-drag-fastpath.json'),
      JSON.stringify(report, null, 2) + '\n',
    ),
    page.screenshot({
      path: resolve(output, 'source-drag-fastpath.png'),
      fullPage: true,
    }),
  ]);
  return report;
}

module.exports = test;
module.exports.setup = setup;

if (require.main === module) {
  const harness = require('../harness/browser-runner.cjs');
  harness.studioCases.push({
    name: 'source-drag-fastpath',
    module: 'studio/test-source-drag-fastpath.cjs',
    adapter: 'studio-fixture',
    fixture: {
      kind: 'file',
      path: 'scripts/tests/fixtures/v4-original-studio.mjs',
    },
  });
  const options = harness.parseArguments([
    '--suite',
    'studio',
    '--case',
    'source-drag-fastpath',
    ...process.argv.slice(2),
  ]);
  harness
    .run(options)
    .then(({ outputDirectory }) => console.log(`Evidence: ${outputDirectory}`))
    .catch((error) => {
      console.error(
        error instanceof Error ? error.stack || error.message : error,
      );
      process.exitCode = 1;
    });
}
