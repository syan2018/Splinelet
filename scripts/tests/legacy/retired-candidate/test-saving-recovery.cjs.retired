'use strict';
const assert = require('node:assert/strict');
module.exports = async (page) => {
  const canvas = page.getByLabel('建模画布');
  for (const [x, y] of [
    [100, 100],
    [230, 100],
    [230, 230],
    [100, 100],
  ])
    await canvas.click({ position: { x, y } });
  await page.locator('[data-candidate="0"]').waitFor();
  const original = await page.evaluate(() =>
    window.traceStudioV4.call('document.get'),
  );
  const saved = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const download = await saved,
    path = await download.path();
  assert(path);
  await page
    .getByLabel('恢复草稿状态')
    .filter({ hasText: '草稿已保存' })
    .waitFor();
  await page.reload();
  await page.getByLabel('建模画布').waitFor();
  await page.getByRole('button', { name: '恢复草稿', exact: true }).click();
  await page.locator('[data-candidate="0"]').waitFor();
  const restored = await page.evaluate(() =>
    window.traceStudioV4.call('document.get'),
  );
  assert.deepEqual(restored.document, original.document);
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await page.getByLabel('打开工程').setInputFiles(path);
  await page.locator('[data-candidate="0"]').waitFor();
  const reopened = await page.evaluate(() =>
    window.traceStudioV4.call('document.get'),
  );
  assert.deepEqual(reopened.document, original.document);
  return {
    passed: true,
    checks: [
      'V4 archive download',
      'isolated recovery after reload',
      'open saved bytes preserves stable document',
    ],
  };
};
