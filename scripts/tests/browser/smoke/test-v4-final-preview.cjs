#!/usr/bin/env node
const assert = require('node:assert/strict');
const { writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');

async function test(page, output) {
  const errors = [];
  try {
    page.on('pageerror', (error) => errors.push(error.message));
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
  }
}

module.exports = test;

if (require.main === module) {
  const harness = require('../harness/browser-runner.cjs');
  const options = harness.parseArguments([
    '--suite',
    'studio',
    '--case',
    'final-preview',
    ...process.argv.slice(2),
  ]);
  harness
    .run(options)
    .then(({ outputDirectory }) => {
      console.log(`PASS: final-preview browser case`);
      console.log(`Evidence: ${outputDirectory}`);
    })
    .catch((error) => {
      console.error(
        error instanceof Error ? error.stack || error.message : error,
      );
      process.exitCode = 1;
    });
}
