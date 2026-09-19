'use strict';
const assert = require('node:assert/strict');
module.exports = async (page) => {
  const canvas = page.getByLabel('建模画布');
  await canvas.click({ position: { x: 100, y: 100 } });
  await canvas.click({ position: { x: 220, y: 100 } });
  await canvas.click({ position: { x: 220, y: 220 } });
  await canvas.click({ position: { x: 100, y: 100 } });
  const region = page.locator('[data-candidate="0"]');
  await region.waitFor();
  const before = await region.getAttribute('d');
  await page.getByRole('button', { name: '移动', exact: true }).click();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 150, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 175, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(
    (value) =>
      document.querySelector('[data-candidate="0"]')?.getAttribute('d') !==
      value,
    before,
  );
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.waitForFunction(
    (value) =>
      document.querySelector('[data-candidate="0"]')?.getAttribute('d') ===
      value,
    before,
  );
  assert.equal(
    await page.getByLabel('部件', { exact: true }).getByRole('button').count(),
    1,
  );
  return {
    passed: true,
    checks: [
      'preview drag commits once',
      'undo restores world geometry',
      'Shape identity retained',
    ],
  };
};
