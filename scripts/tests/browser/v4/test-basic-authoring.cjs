'use strict';
const assert = require('node:assert/strict');
module.exports = async (page, outputDirectory) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const canvas = page.getByLabel('建模画布');
  await canvas.click({ position: { x: 100, y: 100 } });
  await canvas.click({ position: { x: 250, y: 100 } });
  await canvas.click({ position: { x: 250, y: 250 } });
  await canvas.click({ position: { x: 100, y: 250 } });
  await canvas.click({ position: { x: 100, y: 100 } });
  await page.locator('[data-candidate="0"]').waitFor();
  assert.equal(
    await page.getByLabel('部件', { exact: true }).getByRole('button').count(),
    1,
  );
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await canvas.click({ position: { x: 170, y: 170 } });
  const color = page.getByRole('button', { name: /^颜色 / }).first();
  await color.click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-candidate="0"]')?.getAttribute('fill') !==
      'rgba(80,160,255,.18)',
  );
  await page.getByLabel('厚度（毫米）').fill('2');
  await page.getByRole('button', { name: '高级详情', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 STL', exact: true }).click();
  const artifact = await download;
  assert.match(artifact.suggestedFilename(), /\.stl$/);
  assert.equal(await artifact.failure(), null);
  await page.getByRole('button', { name: '预览成品', exact: true }).click();
  await page.getByLabel('成品预览').locator('canvas').waitFor();
  const previewBox = await page.getByLabel('成品预览').boundingBox();
  assert(
    previewBox.height > 100 &&
      previewBox.y + previewBox.height <= page.viewportSize().height,
    'preview must fit in the visible workspace',
  );
  await require('node:fs/promises').mkdir(outputDirectory, { recursive: true });
  await page.screenshot({
    path: require('node:path').join(outputDirectory, 'body-preview.png'),
  });
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.locator('[data-candidate="0"]').waitFor();
  assert.equal(await page.locator('[data-candidate]').count(), 1);
  assert.deepEqual(errors, []);
  return {
    passed: true,
    checks: [
      'draw closed contour',
      'one Shape',
      'paint candidate',
      'thickness',
      'real Worker STL download',
      'undo retains region',
    ],
  };
};
