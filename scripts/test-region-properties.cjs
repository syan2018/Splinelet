// Uses the actual Sandrone project copy. Never binds or writes its source file.
module.exports = async (page, fixture) => {
  const assert = require('node:assert/strict');
  const checks = [];
  const call = (action, args = {}) =>
    page.evaluate(({ action, args }) => window.traceStudio.call(action, args), {
      action,
      args,
    });
  const settle = async () => {
    await page.waitForFunction(
      async () => !(await window.traceStudio.call('state')).busy,
    );
    await page.locator('.creation-updating').waitFor({ state: 'hidden' });
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
  };
  await page.locator('input[accept=".json"]').setInputFiles({
    name: 'region-properties-qa.bezier.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ ...fixture, imageName: 'region-properties-qa' }),
    ),
  });
  await page.waitForFunction(
    async () =>
      (await window.traceStudio.call('get_project')).imageName ===
      'region-properties-qa',
  );
  await settle();
  await page.getByRole('button', { name: '平面创作', exact: true }).click();
  await page.getByRole('button', { name: '选择 (V)', exact: true }).click();
  await page.getByRole('button', { name: '底图', exact: true }).click();
  await page.getByRole('button', { name: '适合画布', exact: true }).click();
  const original = await call('get_project');
  const scene = await call('creation_inspect');
  const cup = scene.creation.objects.find((o) => o.name === '杯子');
  const cells = scene.cells.filter((c) => c.objectId === cup.id);
  assert.equal(cells.length, 7);
  const point = (cell) =>
    page
      .locator('[data-creation-cell]')
      .first()
      .evaluate(
        (el, q) => {
          const p = new DOMPoint(q[0], q[1]).matrixTransform(el.getScreenCTM());
          return { x: p.x, y: p.y };
        },
        [
          original.width / 2 +
            (cell.seed[0] * original.width) / original.widthMM,
          original.height / 2 -
            (cell.seed[1] * original.width) / original.widthMM,
        ],
      );
  const click = async (cell) => {
    const p = await point(cell);
    await page.mouse.click(p.x, p.y);
    await settle();
  };
  const selected = async (ids) =>
    assert.deepEqual((await call('state')).creation.selection, {
      kind: 'cell',
      ids,
    });
  await click(cells[3]);
  await page.getByLabel('选择操作', { exact: true }).click();
  await page
    .getByRole('button', { name: '选择全部内部区域', exact: true })
    .click();
  await selected(cells.map((c) => c.key));
  await click(cells[0]);
  await selected([cells[0].key]);
  assert.equal(
    await page.getByLabel('选区颜色 HEX').inputValue(),
    cells[0].color,
  );
  checks.push(
    'all-regions selects all seven; plain click narrows to the tiny left rim without changing tools',
  );
  assert(
    (await page
      .locator(`[data-tree-cell="${cells[0].key}"]`)
      .getAttribute('aria-pressed')) === 'true',
  );
  await click(cells[5]);
  await selected([cells[5].key]);
  checks.push(
    'tiny right rim and outliner selection stay synchronized at fit zoom',
  );
  await page.getByLabel('选区颜色 HEX').fill('#e46e7f');
  await page.getByRole('button', { name: '应用', exact: true }).click();
  await settle();
  let after = await call('creation_inspect');
  assert.deepEqual(
    after.cells
      .filter((c, i) => c.color !== scene.cells[i].color)
      .map((c) => c.key),
    [cells[5].key],
  );
  await selected([cells[5].key]);
  const changed = await call('get_project');
  assert.deepEqual(changed.paths, original.paths);
  assert.deepEqual(
    changed.creation.swatches.slice(0, -1),
    original.creation.swatches,
  );
  checks.push(
    'custom colour affects only the selected region, preserving shared swatches, source curves and selection',
  );
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await settle();
  assert.deepEqual(await call('get_project'), original);
  checks.push('one undo restores both paint and the added swatch');
  await click(cells[0]);
  await page.getByLabel('所选区域的项目色').selectOption('brown');
  await settle();
  after = await call('creation_inspect');
  assert.equal(
    after.cells.find((c) => c.key === cells[0].key).swatchId,
    'brown',
  );
  assert.equal(
    after.cells.filter((c, i) => c.color !== scene.cells[i].color).length,
    1,
  );
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await settle();
  assert.deepEqual(await call('get_project'), original);
  checks.push('details project-colour choice is local and undoable');
  await click(cells[3]);
  await page.getByLabel('选择操作', { exact: true }).click();
  await page
    .getByRole('button', { name: '选择全部内部区域', exact: true })
    .click();
  const start = await point(cells[3]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 24, start.y + 10, { steps: 8 });
  await page.mouse.up();
  await settle();
  assert.equal((await call('state')).creation.selectedCells.length, 7);
  assert.notDeepEqual((await call('get_project')).paths, original.paths);
  await page.keyboard.press('Control+z');
  await settle();
  assert.deepEqual(await call('get_project'), original);
  checks.push(
    'dragging a selected region preserves multi-selection and moves its source object with one undo',
  );
  await click(cells[3]);
  await page.getByLabel('选区颜色 HEX').fill('#abcdef');
  await page.getByLabel('选区颜色 HEX').press('Escape');
  assert.equal(
    await page.getByLabel('选区颜色 HEX').inputValue(),
    cells[3].color,
  );
  await page.getByLabel('选区颜色 HEX').fill('invalid');
  assert(
    await page.getByRole('button', { name: '应用', exact: true }).isDisabled(),
  );
  await click(cells[0]);
  assert.equal(
    await page.getByLabel('选区颜色 HEX').inputValue(),
    cells[0].color,
  );
  assert.deepEqual(await call('get_project'), original);
  checks.push(
    'Escape cancels a colour draft; invalid values cannot apply; changing selection discards an unapplied draft',
  );
  return { ok: true, checks };
};
