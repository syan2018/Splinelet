#!/usr/bin/env node
const assert = require('node:assert/strict');

async function test(page) {
  const evidence = () => page.evaluate(() => window.v5StudioEvidence());
  const documentState = () => page.evaluate(() => window.v5StudioDocument());
  const pointOnPath = (locator) =>
    locator.evaluate((path) => {
      const point = path.getPointAtLength(path.getTotalLength() * 0.45);
      const matrix = path.getScreenCTM();
      if (!matrix) throw new Error('path has no screen transform');
      const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      return { x: screen.x, y: screen.y };
    });
  const waitFor = (predicate, arg, timeout = 20_000) =>
    page.waitForFunction(predicate, arg, { timeout });

  await page.locator('.studio.creation-studio').waitFor({ timeout: 60_000 });
  await page.locator('.source-path-layer').first().waitFor();
  const initial = await evidence();
  assert.deepEqual(
    {
      version: initial.version,
      units: initial.units,
      projectVersion: initial.projectVersion,
    },
    { version: 5, units: 'mm', projectVersion: 5 },
    'the Studio fixture must retain native V5 authority and millimetres',
  );
  assert.equal(initial.dirty, false);

  await page.getByRole('button', { name: '节点 (A)', exact: true }).click();
  const path = page.locator('.source-path-layer path[aria-label]').first();
  const point = await pointOnPath(path);
  await page.mouse.click(point.x, point.y);
  const node = page.locator('[data-node-index] rect').first();
  await node.waitFor();
  const before = await evidence();
  const beforeDocument = await documentState();
  const box = await node.boundingBox();
  assert.ok(box, 'V5 source node must be visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 18,
    box.y + box.height / 2 + 10,
    {
      steps: 4,
    },
  );
  const during = await evidence();
  assert.equal(
    during.revision,
    before.revision,
    'pointer movement remains display-only',
  );
  assert.equal(
    during.dirty,
    before.dirty,
    'pointer movement does not dirty V5',
  );
  await page.mouse.up();
  await waitFor(
    (revision) => window.v5StudioEvidence().revision === revision + 1,
    before.revision,
  );
  const committed = await evidence();
  assert.equal(committed.version, 5);
  assert.equal(committed.projectVersion, 5);
  assert.equal(committed.dirty, true);
  assert.equal(committed.sourceUnchanged, false);
  assert.notDeepEqual(
    await documentState(),
    beforeDocument,
    'mouseup commits one V5 edit',
  );
}

module.exports = test;

if (require.main === module) {
  const harness = require('../harness/browser-runner.cjs');
  harness.studioCases.push({
    name: 'native-v5-studio',
    module: 'studio/test-v5-native-studio.cjs',
    adapter: 'studio-fixture',
    fixture: {
      kind: 'file',
      path: 'scripts/tests/fixtures/v5-native-studio.mjs',
    },
  });
  const options = harness.parseArguments([
    '--suite',
    'studio',
    '--case',
    'native-v5-studio',
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
