const assert = require('node:assert/strict');
const { mkdir, writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');

const nextFrames = (page) =>
  page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done)),
      ),
  );

async function setup(context) {
  await context.addInitScript(() => {
    const metrics = { workerEvaluations: 0, longTasks: [] };
    const postMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function patchedPostMessage(
      message,
      ...rest
    ) {
      if (message?.kind === 'evaluate') metrics.workerEvaluations += 1;
      return postMessage.call(this, message, ...rest);
    };
    let longTaskSupported = false;
    try {
      new PerformanceObserver((entries) => {
        for (const entry of entries.getEntries()) {
          metrics.longTasks.push({
            startTimeMS: entry.startTime,
            durationMS: entry.duration,
          });
        }
      }).observe({ type: 'longtask', buffered: true });
      longTaskSupported = true;
    } catch {
      // Chromium may not expose the Long Tasks API in every test mode.
    }
    window.reliefHeightEditMetrics = {
      reset() {
        metrics.workerEvaluations = 0;
        metrics.longTasks = [];
      },
      read() {
        return {
          workerEvaluations: metrics.workerEvaluations,
          longTaskSupported,
          longTasks: structuredClone(metrics.longTasks),
        };
      },
    };
  });
}

const changedOverrides = (before, after) => {
  const beforeOverrides = before.reliefDefinitions?.overrides ?? {};
  const afterOverrides = after.reliefDefinitions?.overrides ?? {};
  return Object.entries(afterOverrides)
    .filter(
      ([id, value]) =>
        JSON.stringify(value) !== JSON.stringify(beforeOverrides[id]),
    )
    .map(([id, value]) => ({ id, target: value.target, value }));
};

const topSelfTime = (profile) => {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const selfTime = new Map();
  (profile.samples ?? []).forEach((nodeId, index) => {
    selfTime.set(
      nodeId,
      (selfTime.get(nodeId) ?? 0) + (profile.timeDeltas?.[index] ?? 0),
    );
  });
  return [...selfTime.entries()]
    .map(([nodeId, microseconds]) => {
      const frame = nodes.get(nodeId)?.callFrame ?? {};
      return {
        functionName: frame.functionName || '(anonymous)',
        url: frame.url || '(native)',
        line: frame.lineNumber === undefined ? null : frame.lineNumber + 1,
        column:
          frame.columnNumber === undefined ? null : frame.columnNumber + 1,
        selfMS: microseconds / 1_000,
      };
    })
    .sort((left, right) => right.selfMS - left.selfMS)
    .slice(0, 20);
};

async function test(page, output) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const evidence = () => page.evaluate(() => window.v5SandroneEvidence());
  const documentSnapshot = () =>
    page.evaluate(() => window.v5SandroneDocument());
  const metrics = () =>
    page.evaluate(() => window.reliefHeightEditMetrics.read());
  const resetMetrics = () =>
    page.evaluate(() => window.reliefHeightEditMetrics.reset());
  const inspect = () =>
    page.evaluate(() => window.traceStudio.call('creation_inspect'));
  const waitForCurrentScene = () =>
    page.evaluate(async () => {
      await window.traceStudio.call('creation_inspect');
      return true;
    });
  const waitForRevision = (revision) =>
    page.waitForFunction(
      (expected) => window.v5SandroneEvidence().revision > expected,
      revision,
      { timeout: 60_000 },
    );
  const waitForReady = async (revision) => {
    await waitForRevision(revision);
    await waitForCurrentScene();
    await nextFrames(page);
  };
  const heightInput = () =>
    page
      .getByLabel('厚度打印层数', { exact: true })
      .or(page.getByLabel('凸起厚度', { exact: true }));

  try {
    await page.locator('.studio.creation-studio').waitFor({ timeout: 90_000 });
    await page
      .locator('[data-creation-cell]')
      .first()
      .waitFor({ timeout: 90_000 });
    await waitForCurrentScene();

    const initialEvidence = await evidence();
    const initialDocument = await documentSnapshot();
    const initialSketches = structuredClone(initialDocument.sketches);
    assert.equal(initialEvidence.version, 5, 'fixture must open the V5 sample');

    const hair = page
      .locator('[data-tree-object]')
      .filter({ hasText: '头发' })
      .first();
    await hair.click();
    await page
      .getByRole('button', { name: '当前选区浮雕厚度', exact: true })
      .click();
    const input = heightInput();
    await input.waitFor();
    const slider = page.getByLabel('调整凸起厚度', { exact: true });
    await slider.waitFor();

    // A numeric commit targets the authored selected results. It must leave the
    // source sketch alone and be completely reversible in one command.
    const originalHeight = Number(await input.inputValue());
    const numericTarget = originalHeight + 1;
    const profiler = await page.context().newCDPSession(page);
    await profiler.send('Profiler.enable');
    await resetMetrics();
    const beforeNumeric = await evidence();
    await profiler.send('Profiler.start');
    const numericStartedAt = await page.evaluate(() => performance.now());
    await input.fill(String(numericTarget));
    await input.press('Enter');
    await waitForReady(beforeNumeric.revision);
    const numericElapsedMS =
      (await page.evaluate(() => performance.now())) - numericStartedAt;
    const { profile: numericProfile } = await profiler.send('Profiler.stop');
    await mkdir(output, { recursive: true });
    await writeFile(
      resolve(output, 'relief-height-numeric.cpuprofile'),
      JSON.stringify(numericProfile) + '\n',
    );
    const afterNumeric = await documentSnapshot();
    const numericMetrics = await metrics();
    const numericChanges = changedOverrides(initialDocument, afterNumeric);
    assert.ok(
      numericChanges.length > 0,
      'numeric edit must change relief data',
    );
    assert.deepEqual(
      afterNumeric.sketches,
      initialSketches,
      'height editing must not change source geometry',
    );
    assert.ok(
      numericChanges.every((change) => change.target?.kind === 'output'),
      'selected V5 relief changes retain exact output references',
    );
    const changedThicknesses = numericChanges.map((change) => ({
      id: change.id,
      target: change.target,
      thickness: change.value.value.thickness ?? null,
    }));
    const everyChangedThicknessMatches = changedThicknesses.every(
      ({ thickness }) =>
        thickness?.kind === 'layers'
          ? thickness.count === numericTarget
          : thickness?.value === numericTarget,
    );
    if (!everyChangedThicknessMatches) {
      await mkdir(output, { recursive: true });
      await writeFile(
        resolve(output, 'numeric-thickness-mismatch.json'),
        JSON.stringify({ numericTarget, changedThicknesses }, null, 2) + '\n',
      );
    }
    assert.ok(
      everyChangedThicknessMatches,
      'numeric edit stores the selected authored thickness under its exact reference',
    );
    assert.ok(
      numericMetrics.workerEvaluations <= 2,
      'one numeric commit has a bounded worker request count',
    );

    const beforeUndo = await evidence();
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await waitForReady(beforeUndo.revision);
    assert.deepEqual(
      await documentSnapshot(),
      initialDocument,
      'one undo restores the authored document exactly',
    );

    // A range gesture is display-only before pointer release, then creates one
    // committed authoring revision. Worker requests are measured separately
    // from the main-thread authoring-path getter coverage in its unit test.
    const sliderState = await slider.evaluate((element) => ({
      min: Number(element.min),
      max: Number(element.max),
      value: Number(element.value),
    }));
    const sliderTarget =
      sliderState.value <= (sliderState.min + sliderState.max) / 2
        ? sliderState.max
        : sliderState.min;
    assert.notEqual(
      sliderTarget,
      sliderState.value,
      'slider needs room to move',
    );
    const sliderBox = await slider.boundingBox();
    assert.ok(sliderBox, 'height slider must be visible');
    const atX = (value) =>
      sliderBox.x +
      ((value - sliderState.min) / (sliderState.max - sliderState.min)) *
        sliderBox.width;
    await resetMetrics();
    const beforeDrag = await evidence();
    await page.mouse.move(
      atX(sliderState.value),
      sliderBox.y + sliderBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      atX(sliderTarget),
      sliderBox.y + sliderBox.height / 2,
      {
        steps: 12,
      },
    );
    const duringDrag = await evidence();
    const duringMetrics = await metrics();
    assert.equal(
      duringDrag.revision,
      beforeDrag.revision,
      'range pointer frames must not commit the document',
    );
    assert.equal(
      duringMetrics.workerEvaluations,
      0,
      'range pointer frames must not ask the worker to evaluate',
    );
    const dragStartedAt = await page.evaluate(() => performance.now());
    await profiler.send('Profiler.start');
    await page.mouse.up();
    await waitForReady(beforeDrag.revision);
    const dragElapsedMS =
      (await page.evaluate(() => performance.now())) - dragStartedAt;
    const { profile: rangeProfile } = await profiler.send('Profiler.stop');
    await writeFile(
      resolve(output, 'relief-height-range.cpuprofile'),
      JSON.stringify(rangeProfile) + '\n',
    );
    const dragMetrics = await metrics();
    assert.ok(
      dragMetrics.workerEvaluations <= 2,
      'range release must create one bounded committed evaluation',
    );
    const committedRangeValue = Number(await input.inputValue());
    assert.notEqual(
      committedRangeValue,
      sliderState.value,
      'the committed range gesture must change the authored height',
    );

    // Persist and reopen through the fixture host, then make a second change.
    // This verifies the authoring definition rather than an unsaved UI draft.
    const reopened = await page.evaluate(() =>
      window.v5SandroneSaveAndReopen(),
    );
    assert.equal(reopened.version, 5, 'save/reopen preserves the V5 project');
    await waitForCurrentScene();
    const reopenedHeight = Number(await input.inputValue());
    const secondTarget =
      reopenedHeight > 1 ? reopenedHeight - 1 : reopenedHeight + 1;
    const beforeSecond = await evidence();
    await input.fill(String(secondTarget));
    await input.press('Enter');
    await waitForReady(beforeSecond.revision);
    assert.equal(
      Number(await input.inputValue()),
      secondTarget,
      'a second edit after ready is accepted',
    );

    // Render through the real 3D button before editing again. The canonical
    // creation_inspect read below is diagnostics only, after that UI action.
    await page.getByRole('button', { name: '立体预览', exact: true }).click();
    await page.locator('.creation-is-3d').waitFor({ timeout: 60_000 });
    const canvas = page.getByLabel('作品立体画布');
    await canvas.waitFor({ timeout: 60_000 });
    await nextFrames(page);
    const beforeThreeDChange = await evidence();
    const threeDTarget = secondTarget + 1;
    await input.fill(String(threeDTarget));
    await input.press('Enter');
    await waitForReady(beforeThreeDChange.revision);
    assert.equal(
      Number(await input.inputValue()),
      threeDTarget,
      'numeric height editing remains usable after actual 3D preview',
    );
    const creation = await inspect();
    assert.deepEqual(creation.errors, []);
    assert.deepEqual(errors, []);
    await profiler.detach();

    await mkdir(output, { recursive: true });
    await Promise.all([
      page.screenshot({
        path: resolve(output, 'relief-height-edit-3d.png'),
        fullPage: true,
      }),
      writeFile(
        resolve(output, 'relief-height-edit.json'),
        JSON.stringify(
          {
            status: 'pass',
            selectedObject: '头发',
            numeric: {
              target: numericTarget,
              changedOverrideCount: numericChanges.length,
              submittedToReadyMS: numericElapsedMS,
              metrics: numericMetrics,
              topSelfTime: topSelfTime(numericProfile),
            },
            range: {
              from: sliderState.value,
              pointerTarget: sliderTarget,
              committedValue: committedRangeValue,
              submittedToReadyMS: dragElapsedMS,
              during: { revision: duringDrag.revision, metrics: duringMetrics },
              metrics: dragMetrics,
              topSelfTime: topSelfTime(rangeProfile),
            },
            reopened,
            secondTarget,
            threeDTarget,
            diagnostics: {
              errors: creation.errors,
            },
            note: 'Submitted-to-ready is measured from Enter or pointer release through the visible ready state. Long Tasks are browser PerformanceObserver entries when supported; no time threshold is asserted.',
          },
          null,
          2,
        ) + '\n',
      ),
      writeFile(
        resolve(output, 'relief-height-numeric.cpuprofile'),
        JSON.stringify(numericProfile) + '\n',
      ),
      writeFile(
        resolve(output, 'relief-height-range.cpuprofile'),
        JSON.stringify(rangeProfile) + '\n',
      ),
    ]);
  } catch (error) {
    await mkdir(output, { recursive: true });
    await page
      .screenshot({ path: resolve(output, 'failure.png'), fullPage: true })
      .catch(() => {});
    await writeFile(
      resolve(output, 'failure.json'),
      JSON.stringify({ error: error.message, errors }, null, 2) + '\n',
    );
    throw error;
  }
}

module.exports = test;
module.exports.setup = setup;

if (require.main === module) {
  const harness = require('../harness/browser-runner.cjs');
  harness.studioCases.push({
    name: 'relief-height-edit',
    module: 'studio/test-relief-height-edit.cjs',
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
    'relief-height-edit',
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
