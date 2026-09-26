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

async function test(page, output) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  try {
    await page.locator('.studio.creation-studio').waitFor({ timeout: 90_000 });
    await page
      .locator('.source-path-layer')
      .first()
      .waitFor({ timeout: 90_000 });
    await page
      .locator('[data-creation-cell]')
      .first()
      .waitFor({ timeout: 90_000 });
    await page.locator('.creation-updating').waitFor({ state: 'hidden' });

    await page.getByRole('button', { name: '平面创作', exact: true }).click();
    const drawingCanvas = page.getByLabel('贝塞尔绘图画布');
    await drawingCanvas.waitFor();
    await page.getByRole('button', { name: '适合画布', exact: true }).click();
    await nextFrames(page);
    assert.ok((await page.locator('[data-creation-cell]').count()) >= 68);
    await mkdir(output, { recursive: true });
    await page.screenshot({
      path: resolve(output, 'sandrone-final-2d-fit.png'),
      fullPage: true,
    });

    // The real UI action owns the 3D render. The fixture's creation read below
    // only records diagnostics after the canvas has mounted and rendered.
    await page.getByRole('button', { name: '立体预览', exact: true }).click();
    await page.locator('.creation-is-3d').waitFor();
    const canvas = page.getByLabel('作品立体画布');
    await canvas.waitFor({ timeout: 60_000 });
    await page.waitForFunction(
      () => {
        const element = document.querySelector('[aria-label="作品立体画布"]');
        return (
          element instanceof HTMLCanvasElement &&
          element.width > 0 &&
          element.height > 0
        );
      },
      undefined,
      { timeout: 60_000 },
    );
    await nextFrames(page);
    const box = await canvas.boundingBox();
    assert.ok(
      box && box.width > 400 && box.height > 300,
      '3D canvas must be visible',
    );
    const creation = await page.evaluate(() => window.v5SandroneCreation());
    assert.equal(
      creation.cells,
      68,
      'final sample must publish all authored regions',
    );
    assert.deepEqual(creation.nonOpenPathErrors, []);
    assert.deepEqual(creation.severityErrors, []);
    assert.deepEqual(creation.blockedObjects, []);
    assert.deepEqual(errors, []);

    await Promise.all([
      page.screenshot({
        path: resolve(output, 'sandrone-final-3d.png'),
        fullPage: true,
      }),
      canvas.screenshot({
        path: resolve(output, 'sandrone-final-3d-canvas.png'),
      }),
      writeFile(
        resolve(output, 'sandrone-final-preview.json'),
        JSON.stringify(
          {
            status: 'pass',
            cells: creation.cells,
            canvas: { width: box.width, height: box.height },
            diagnostics: {
              nonOpenPathErrors: creation.nonOpenPathErrors,
              severityErrors: creation.severityErrors,
              blockedObjects: creation.blockedObjects,
            },
          },
          null,
          2,
        ) + '\n',
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

if (require.main === module) {
  const harness = require('../harness/browser-runner.cjs');
  harness.studioCases.push({
    name: 'sandrone-final-preview',
    module: 'studio/test-sandrone-final-preview.cjs',
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
    'sandrone-final-preview',
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
