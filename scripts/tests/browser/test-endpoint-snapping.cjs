module.exports = async (page, outputDirectory) => {
  const assert = require('node:assert/strict');
  const path = require('node:path');
  const fs = require('node:fs/promises');
  const { drawCupEmblem } = await import('../../examples/draw-cup-emblem.mjs');
  const call = require('./harness/legacy-call.cjs').legacyCaller(page);
  await page
    .locator('input[accept=".spl,.bezier.json,.json"]')
    .setInputFiles(
      path.resolve(__dirname, '../../../public/sandrone-example.spl'),
    );
  await call('creation_inspect');
  const result = await drawCupEmblem(call);
  await call('creation_view', { view: 'flat' });
  await call('select_paths', { pathIds: [result.pathIds[0]] });
  await page.keyboard.press('a');
  await page
    .getByRole('group', { name: '平面显示' })
    .getByRole('button', { name: '分色', exact: true })
    .click();
  const bounds = await page.locator('.drawing-canvas').boundingBox();
  await call('set_view', {
    x: bounds.width / 2 - 620 * 3,
    y: bounds.height / 2 - 947 * 3,
    scale: 3,
  });
  const original = (await call('get_project')).paths;
  const endpoint = async () => {
    const b = await page.locator('[data-node-index="2"]').boundingBox();
    assert(b);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const begin = async (delta) => {
    const at = await endpoint();
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + delta.x, at.y + delta.y, { steps: 4 });
  };
  const ready = () => call('creation_inspect');
  const assertClosed = async () => assert.deepEqual((await ready()).errors, []);
  const undo = async () => {
    await call('undo');
    await ready();
  };
  const angle = (74.5 * Math.PI) / 180;
  const along = { x: Math.cos(angle), y: -Math.sin(angle) };
  const normal = { x: -along.y, y: along.x };
  await begin({
    x: 30 * normal.x + 9 * along.x,
    y: 30 * normal.y + 9 * along.y,
  });
  assert.equal((await call('state')).nodeSnapping.target.locked, true);
  assert.equal(await page.locator('[data-endpoint-snap="line"]').count(), 1);
  if (outputDirectory) {
    await fs.mkdir(outputDirectory, { recursive: true });
    await page.screenshot({
      path: path.join(outputDirectory, 'seam-constrained-drag.png'),
    });
  }
  await page.mouse.up();
  await assertClosed();
  assert.equal(await page.locator('[data-endpoint-snap]').count(), 0);
  assert((await page.locator('[data-endpoint-guide]').count()) > 0);
  assert.notDeepEqual((await call('get_project')).paths, original);
  await undo();
  assert.deepEqual((await call('get_project')).paths, original);

  // Alt deliberately releases the seam. Releasing Alt without further motion
  // must not silently move the endpoint back on pointer-up.
  await page.keyboard.down('Alt');
  await begin({ x: normal.x * 20, y: normal.y * 20 });
  assert.equal((await call('state')).nodeSnapping.target, null);
  await page.keyboard.up('Alt');
  await page.mouse.up();
  assert((await ready()).errors.some((e) => e.objectId === result.objectId));
  const broken = (await call('get_project')).paths;
  await begin({
    x: -normal.x * 17 + along.x * 5,
    y: -normal.y * 17 + along.y * 5,
  });
  const repaired = (await call('state')).nodeSnapping.target;
  assert(repaired && !repaired.locked && repaired.kind === 'line');
  if (outputDirectory)
    await page.screenshot({
      path: path.join(outputDirectory, 'seam-magnetic-repair.png'),
    });
  await page.mouse.up();
  await assertClosed();
  await undo();
  assert.deepEqual((await call('get_project')).paths, broken);
  await undo();
  assert.deepEqual((await call('get_project')).paths, original);

  await begin({
    x: 20 * normal.x + 7 * along.x,
    y: 20 * normal.y + 7 * along.y,
  });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.equal(await page.locator('[data-endpoint-snap]').count(), 0);
  assert.deepEqual((await call('get_project')).paths, original);
  await assertClosed();
  await page.getByRole('checkbox', { name: '端点吸附', exact: true }).uncheck();
  await begin({ x: 20 * normal.x, y: 20 * normal.y });
  assert.equal((await call('state')).nodeSnapping.target, null);
  await page.mouse.up();
  assert((await ready()).errors.some((e) => e.objectId === result.objectId));
  await undo();
  await page.getByRole('checkbox', { name: '端点吸附', exact: true }).check();
  await assertClosed();
  return {
    checks: [
      'existing seam slides exactly with live guide',
      'Alt release',
      'near-seam magnetic repair restores fill',
      'one undo per drag',
      'Escape rollback and cleared feedback',
      'snap toggle',
    ],
  };
};
