const assert = require('node:assert/strict');
const { writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');

const percentile = (values, p) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
};

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
    const observeSourcePaths = () => {
      new MutationObserver((records) => {
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
      }).observe(document.documentElement, {
        subtree: true,
        attributes: true,
        attributeFilter: ['d'],
      });
    };
    if (document.documentElement) observeSourcePaths();
    else
      addEventListener('DOMContentLoaded', observeSourcePaths, { once: true });
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
    window.v5SandroneDragMetrics = {
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
  const evidence = () => page.evaluate(() => window.v5SandroneEvidence());
  const metrics = () =>
    page.evaluate(() => window.v5SandroneDragMetrics.read());
  const waitForRevision = (revision) =>
    page.waitForFunction(
      (expected) => window.v5SandroneEvidence().revision > expected,
      revision,
      { timeout: 30_000 },
    );
  const pointOnPath = (locator, fraction = 0.42) =>
    locator.evaluate((path, fractionAtLength) => {
      const point = path.getPointAtLength(
        path.getTotalLength() * fractionAtLength,
      );
      const matrix = path.getScreenCTM();
      if (!matrix) throw Error('path has no screen transform');
      const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      return { x: screen.x, y: screen.y };
    }, fraction);

  await page.locator('.studio.creation-studio').waitFor({ timeout: 90_000 });
  await page.locator('.source-path-layer').first().waitFor({ timeout: 90_000 });
  const initial = await evidence();
  const baselineDocument = await page.evaluate(() =>
    window.v5SandroneDocument(),
  );
  const initialCreation = await page.evaluate(() =>
    window.v5SandroneCreation(),
  );
  assert.equal(initial.version, 5);
  assert.ok(
    initial.sourcePath,
    'sample must expose the harmless signature path',
  );

  await page.getByRole('button', { name: '节点 (A)', exact: true }).click();
  const path = page
    .locator(`[data-source-id="${initial.sourcePath.id}"] path[aria-label]`)
    .first();
  const hit = await pointOnPath(path);
  await page.mouse.click(hit.x, hit.y);
  const node = page.locator('[data-node-index="1"] rect').first();
  await node.waitFor();
  const box = await node.boundingBox();
  assert.ok(box, 'source node must be visible');

  await page.evaluate(() => window.v5SandroneDragMetrics.reset());
  const start = center(box);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let index = 1; index <= 30; index += 1) {
    const offsetX = 6 + (index % 7);
    const offsetY = index % 2 ? 4 : -4;
    await page.mouse.move(start.x + offsetX, start.y + offsetY);
  }
  const during = await evidence();
  const duringMetrics = await metrics();
  assert.equal(
    during.revision,
    initial.revision,
    'pointer frames stay display-only',
  );
  assert.equal(
    during.dirty,
    initial.dirty,
    'pointer frames do not dirty the file',
  );
  assert.equal(
    duringMetrics.workerEvaluations,
    0,
    'pointer frames do not schedule region evaluation',
  );
  await page.mouse.up();

  // Start the next source gesture immediately, while the committed evaluation
  // may still be pending. No runtime evaluation or creation inspection occurs.
  const nextStartedAt = await page.evaluate(() => performance.now());
  await page.mouse.move(start.x + 10, start.y + 4);
  await page.mouse.down();
  await page.mouse.move(start.x + 5, start.y - 4);
  await page.mouse.up();
  const nextFinishedAt = await page.evaluate(() => performance.now());
  await page.waitForTimeout(1_000);

  const observed = await metrics();
  const svg = observed.moves
    .map((move) => move.inputToSvgMS)
    .filter((value) => value !== undefined);
  const frames = observed.moves
    .map((move) => move.inputToNextFrameMS)
    .filter((value) => value !== undefined);
  assert.ok(svg.length >= 30, 'each continuous move must update source SVG');
  assert.ok(
    observed.moves.every((move) => move.workerEvaluations === 0),
    'no pointer frame may observe a region evaluation request',
  );
  assert.ok(
    observed.workerEvaluations <= 2,
    'only the two committed gestures may request region evaluation',
  );
  assert.ok(
    percentile(svg, 0.95) < 250,
    'input-to-SVG p95 must stay below 250 ms',
  );
  const signatureCommitCreation = await page.evaluate(() =>
    window.v5SandroneCreation(),
  );
  for (let index = 0; index < 2; index += 1) {
    const beforeUndo = await evidence();
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await waitForRevision(beforeUndo.revision);
  }
  const restoredAfterPerformance = await evidence();
  assert.deepEqual(
    await page.evaluate(() => window.v5SandroneDocument()),
    baselineDocument,
    'two undos restore the document before the performance sample',
  );
  const assertCreation = async (label) => {
    const creation = await page.evaluate(() => window.v5SandroneCreation());
    const failures = {
      nonOpenPathErrors: creation.nonOpenPathErrors,
      severityErrors: creation.severityErrors,
      blockedObjects: creation.blockedObjects,
      cellCountChanged: creation.cells !== initialCreation.cells,
    };
    if (
      failures.nonOpenPathErrors.length ||
      failures.severityErrors.length ||
      failures.blockedObjects.length ||
      failures.cellCountChanged
    ) {
      await writeFile(
        resolve(output, 'v5-sandrone-creation-failure.json'),
        JSON.stringify(
          {
            label,
            initialCreation,
            creation,
            failures,
            document: await page.evaluate(() => window.v5SandroneDocument()),
          },
          null,
          2,
        ) + '\n',
      );
    }
    assert.equal(
      creation.cells,
      initialCreation.cells,
      `${label} changes the sample cell count`,
    );
    assert.equal(
      creation.nonOpenPathErrors.length,
      0,
      `${label} must not have non-open-path errors: ${JSON.stringify(creation.nonOpenPathErrors.slice(0, 5))}`,
    );
    assert.equal(
      creation.severityErrors.length,
      0,
      `${label} must not have severity errors: ${JSON.stringify(creation.severityErrors.slice(0, 5))}`,
    );
    assert.equal(
      creation.blockedObjects.length,
      0,
      `${label} must not leave blocked creation objects: ${JSON.stringify(creation.blockedObjects)}`,
    );
    return creation;
  };
  assert.equal(
    initialCreation.cells,
    68,
    'sample publishes 68 authored results, including seven hair property groups',
  );
  assert.equal(
    initialCreation.severityErrors.length,
    0,
    'fresh sample has no severity errors',
  );
  assert.equal(
    initialCreation.blockedObjects.length,
    0,
    'fresh sample has no blocked objects',
  );
  const restoredCreation = await assertCreation('undo of performance samples');

  assert.deepEqual(
    {
      name: initial.hairPath?.name,
      anchors: initial.hairPath?.anchors,
    },
    { name: '头发大型', anchors: 41 },
    'the walkthrough must exercise the repaired large hair path',
  );
  const hairPath = page
    .locator(`[data-source-id="${initial.hairPath.id}"] path[aria-label]`)
    .first();
  const selectHair = async () => {
    // Overlapping sample strokes can give a canvas hit to a neighbouring path.
    // Select through the public UI API, then exercise this exact path's real
    // point, handle, and path pointer drags below.
    await page.evaluate(
      (pathId) =>
        window.traceStudio.call('select_paths', { pathIds: [pathId] }),
      initial.hairPath.id,
    );
    const selected = await page.evaluate(
      async () => (await window.traceStudio.call('state')).selectedPaths,
    );
    assert.deepEqual(selected, [initial.hairPath.id]);
    await page.getByRole('button', { name: '节点 (A)', exact: true }).click();
  };
  const commitAt = async (point, offset, label) => {
    assert.ok(
      Math.hypot(offset.x, offset.y) > 4,
      `${label} must pass the source-drag threshold`,
    );
    const before = await evidence();
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + offset.x, point.y + offset.y, { steps: 3 });
    await page.mouse.up();
    await waitForRevision(before.revision);
  };
  const commitDrag = async (target, offset, label) => {
    const targetBox = await target.boundingBox();
    assert.ok(targetBox, `${label} target must be visible`);
    return commitAt(center(targetBox), offset, label);
  };

  const zoomToNode = async (target, scale = 4) => {
    const coordinates = await target.evaluate((node) => {
      const box = node.getBBox();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    });
    const stageBox = await page.locator('.stage').first().boundingBox();
    assert.ok(stageBox, 'source stage must be visible before zooming');
    await page.evaluate(
      ({ coordinates: node, width, height, scale }) =>
        window.traceStudio.call('set_view', {
          x: width / 2 - node.x * scale,
          y: height / 2 - node.y * scale,
          scale,
        }),
      { coordinates, width: stageBox.width, height: stageBox.height, scale },
    );
    await target.waitFor();
  };

  await selectHair();
  const hairNode = page.locator('[data-node-index="20"] rect').first();
  await hairNode.waitFor();
  const originalFailureScale =
    6 / ((1.904298459042984 - 0.4444444444444482) * (1254 / 100));
  await zoomToNode(hairNode, originalFailureScale);
  await commitDrag(
    hairNode,
    { x: 6, y: -5 },
    'original failing hair point drag',
  );
  const movedDocument = await page.evaluate(() => window.v5SandroneDocument());
  const movedPoint =
    movedDocument.sketches['sketch:dd42fa88fb810d6c09de'].vertices[
      'vertex:2933ceee9cbbad9896a2'
    ].position.value;
  assert.ok(
    Math.abs(movedPoint[0] - 1.904298459042984) < 1e-7 &&
      Math.abs(movedPoint[1] - 15.10543390105434) < 1e-7,
    'the actual pointer drag must reproduce the original failing model-space edit',
  );
  const afterPointCreation = await assertCreation('large hair point drag');

  await selectHair();
  await zoomToNode(hairNode);
  await page.locator('[data-node-index="20"] rect').first().click();
  const handle = page.locator('[data-control-handle^="20:"] circle').first();
  await handle.waitFor();
  await commitDrag(handle, { x: 5, y: 0 }, 'large hair handle drag');
  const afterHandleCreation = await assertCreation('large hair handle drag');

  await selectHair();
  const pathPoint = await hairPath.evaluate((path) => {
    const point = path.getPointAtLength(path.getTotalLength() * 0.61);
    return { x: point.x, y: point.y };
  });
  const pathStage = await page.locator('.stage').first().boundingBox();
  await page.evaluate(
    ({ point, width, height }) =>
      window.traceStudio.call('set_view', {
        x: width / 2 - point.x * 4,
        y: height / 2 - point.y * 4,
        scale: 4,
      }),
    { point: pathPoint, width: pathStage.width, height: pathStage.height },
  );
  await commitAt(
    await pointOnPath(hairPath, 0.61),
    { x: 5, y: 0 },
    'large hair path drag',
  );
  const afterHair = await evidence();
  const afterHairCreation = await assertCreation('large hair path drag');

  for (let index = 0; index < 3; index += 1) {
    const beforeUndo = await evidence();
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await waitForRevision(beforeUndo.revision);
  }
  const afterUndo = await evidence();
  const beforeReopenCreation = await assertCreation('undo of hair edits');
  const reopened = await page.evaluate(() => window.v5SandroneSaveAndReopen());
  assert.equal(reopened.version, 5, 'isolated save/reopen preserves V5');
  const afterReopenCreation = await assertCreation('reopened hair sample');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);

  const report = {
    initial,
    during,
    moves: observed.moves.length,
    workerEvaluations: observed.workerEvaluations,
    inputToSvgP95MS: percentile(svg, 0.95),
    inputToNextFrameP95MS: frames.length ? percentile(frames, 0.95) : null,
    nextGestureDispatchMS: nextFinishedAt - nextStartedAt,
    hair: {
      restoredAfterPerformance,
      initialCreation,
      signatureCommitCreation,
      restoredCreation,
      afterPointCreation,
      afterHandleCreation,
      afterHair,
      afterHairCreation,
      afterUndo,
      beforeReopenCreation,
      reopened,
      afterReopenCreation,
    },
    note: 'inputToSvgMS measures DOM source-path updates. inputToNextFrameMS is a requestAnimationFrame approximation of the next drawing frame, not compositor paint.',
  };
  await Promise.all([
    writeFile(
      resolve(output, 'v5-sandrone-walkthrough.json'),
      JSON.stringify(report, null, 2) + '\n',
    ),
    page.screenshot({
      path: resolve(output, 'v5-sandrone-walkthrough.png'),
      fullPage: true,
    }),
  ]);
}

module.exports = test;
module.exports.setup = setup;

if (require.main === module) {
  const harness = require('../harness/browser-runner.cjs');
  harness.studioCases.push({
    name: 'v5-sandrone-walkthrough',
    module: 'studio/test-v5-repaired-walkthrough.cjs',
    adapter: 'studio-fixture',
    fixture: {
      kind: 'file',
      path: 'scripts/tests/fixtures/v5-sandrone-walkthrough.mjs',
    },
  });
  const options = harness.parseArguments([
    '--suite',
    'studio',
    '--case',
    'v5-sandrone-walkthrough',
    '--timeout',
    '120000',
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
