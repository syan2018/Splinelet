'use strict';
const assert = require('node:assert/strict');
module.exports = async (page) => {
  const canvas = page.getByLabel('建模画布');
  for (const [x, y] of [
    [100, 100],
    [350, 100],
    [350, 350],
    [100, 350],
    [100, 100],
  ])
    await canvas.click({ position: { x, y } });
  await page.locator('[data-candidate="0"]').waitFor();
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await canvas.click({ position: { x: 170, y: 170 } });
  await page
    .getByRole('button', { name: /^颜色 / })
    .first()
    .click();
  await page.locator('[data-candidate="0"]').waitFor();
  await page.getByRole('button', { name: '挖孔', exact: true }).click();
  for (const [x, y] of [
    [150, 150],
    [200, 150],
    [200, 200],
    [150, 200],
    [150, 150],
  ])
    await canvas.click({ position: { x, y } });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-candidate="0"]')
        ?.getAttribute('d')
        ?.split(' Z').length === 3,
  );
  const afterHole = await page
    .locator('[data-candidate="0"]')
    .getAttribute('d');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-candidate="0"]')
        ?.getAttribute('d')
        ?.split(' Z').length === 2,
  );
  await canvas.click({ position: { x: 170, y: 170 } });
  await page.getByRole('button', { name: '分区', exact: true }).click();
  await canvas.click({ position: { x: 80, y: 250 } });
  await canvas.click({ position: { x: 380, y: 250 } });
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => document.querySelectorAll('[data-candidate]').length === 2,
  );
  assert.equal(await page.locator('[data-node-id]').count(), 1);
  const snapshot = await page.evaluate(() =>
    window.traceStudioV4.call('document.get'),
  );
  assert.equal(
    Object.values(snapshot.document.reliefDefinitions.overrides).filter(
      (item) => item.value.enabled,
    ).length,
    2,
  );
  assert(afterHole.includes(' Z'));
  return {
    passed: true,
    checks: [
      'closed hole adds one subpath',
      'hole undo restores original',
      'partition into two painted regions',
      'one Shape remains',
    ],
  };
};
