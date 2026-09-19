// Runs in an isolated browser with the committed minimal hair-partition fixture.
module.exports = async (page, fixture) => {
  const assert = require('node:assert/strict');
  fixture = JSON.parse(JSON.stringify(fixture));
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
    await page
      .getByText('正在检查分区，完成后应用…', { exact: true })
      .waitFor({ state: 'hidden' });
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
  };
  const divider = fixture.paths.find((p) => p.name === '头发分割线');
  assert(divider, 'requires the committed hair-partition fixture');
  const hair = fixture.creation.objects.find((o) => o.name === '头发');
  const beforeDivider = structuredClone(fixture);
  beforeDivider.creation.objects.find((o) => o.id === hair.id).roles[
    divider.id
  ] = 'guide';
  await call('load_project', { project: beforeDivider });
  await settle();
  await page.getByRole('button', { name: '平面创作', exact: true }).click();
  await page.getByRole('button', { name: '选择 (V)', exact: true }).click();
  const expand = page.getByRole('button', { name: '展开头发', exact: true });
  if (await expand.count()) await expand.click();
  await page.locator(`[data-tree-path="${divider.id}"]`).click();
  const beforeScene = await call('creation_inspect');
  assert.equal(
    beforeScene.cells.filter((c) => c.objectId === hair.id).length,
    15,
  );
  await page.getByRole('button', { name: '分区', exact: true }).click();
  await settle();
  const afterRole = await call('get_project');
  const scene = await call('creation_inspect');
  const hairCells = scene.cells.filter((c) => c.objectId === hair.id);
  assert.equal(hairCells.length, 16);
  assert.equal(scene.errors.length, 0);
  assert(hairCells.every((c) => !c.conflict && !c.fallback && c.painted));
  assert.deepEqual(afterRole.paths, fixture.paths);
  assert.match(
    await page.locator('.creation-role-result').innerText(),
    /15 → 16/,
  );
  checks.push(
    'one role click creates an extra hair region, preserves all source curves, and shows the result in place',
  );

  await page.getByRole('button', { name: '适合画布', exact: true }).click();
  await page.getByRole('button', { name: '分色', exact: true }).click();
  const point = (cell) =>
    page
      .locator('[data-creation-cell]')
      .first()
      .evaluate(
        (el, q) => {
          const p = new DOMPoint(...q).matrixTransform(el.getScreenCTM());
          return { x: p.x, y: p.y };
        },
        [
          fixture.width / 2 + (cell.seed[0] * fixture.width) / fixture.widthMM,
          fixture.height / 2 - (cell.seed[1] * fixture.width) / fixture.widthMM,
        ],
      );
  const pick = async (cell) => {
    const p = await point(cell);
    await page.mouse.click(p.x, p.y);
    await settle();
    assert.deepEqual((await call('state')).creation.selection, {
      kind: 'cell',
      ids: [cell.key],
    });
    assert.equal(
      await page
        .locator(`[data-tree-cell="${cell.key}"]`)
        .getAttribute('aria-pressed'),
      'true',
    );
  };
  const left = hairCells.find((c) => Math.abs(c.areaMM2 - 25.2912562) < 0.001);
  const right = hairCells.find(
    (c) => Math.abs(c.areaMM2 - 128.8767562) < 0.001,
  );
  assert(left && right, 'the two children of the previous 154.168 mm² region');
  await pick(left);
  await pick(right);
  checks.push(
    'real pointer clicks select either side of the new divider and synchronize the outliner',
  );
  const shapes = (s) => s.cells.map((c) => [c.key, c.geometry, c.areaMM2]);
  const baseShapes = shapes(scene);
  await page.getByLabel('选区颜色 HEX').fill('#cc4488');
  await page.getByRole('button', { name: '应用', exact: true }).click();
  await settle();
  const painted = await call('creation_inspect');
  assert.deepEqual(
    shapes(painted),
    baseShapes,
    'painting must not reconnect the divider network',
  );
  assert(painted.cells.every((c) => !c.conflict));
  assert.deepEqual(
    painted.cells
      .filter((c, i) => c.color !== scene.cells[i].color)
      .map((c) => c.key),
    [right.key],
  );
  checks.push(
    'local colour changes only its target, without changing region geometry or creating conflicts',
  );
  await page.getByLabel('凸起厚度', { exact: true }).fill('3.15');
  await page.getByLabel('凸起厚度', { exact: true }).press('Enter');
  await settle();
  const raised = await call('creation_inspect');
  assert.deepEqual(shapes(raised), baseShapes);
  assert.deepEqual(
    raised.cells
      .filter((c, i) => c.heightMM !== painted.cells[i].heightMM)
      .map((c) => c.key),
    [right.key],
  );
  assert.equal(raised.cells.find((c) => c.key === right.key).heightMM, 3.15);
  assert.deepEqual((await call('get_project')).paths, fixture.paths);
  checks.push(
    'local height is independent and preserves the original anchors and handles',
  );
  await page.getByLabel('凸起厚度', { exact: true }).blur();
  await page.keyboard.press('Control+z');
  await settle();
  assert.deepEqual((await call('creation_inspect')).cells, painted.cells);
  await page.keyboard.press('Control+z');
  await settle();
  assert.deepEqual(await call('get_project'), afterRole);
  checks.push('colour and height each undo in one step');

  await pick(left);
  await page.getByLabel('选区颜色 HEX').fill('#cc4488');
  await page.getByRole('button', { name: '应用', exact: true }).click();
  await settle();
  const saved = await call('get_project');
  const savedScene = await call('creation_inspect');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () =>
      window.traceStudio &&
      !document.querySelector('footer')?.textContent.includes('正在恢复工程'),
  );
  await call('load_project', { project: JSON.parse(JSON.stringify(saved)) });
  await settle();
  const reopened = await call('creation_inspect');
  assert.deepEqual(shapes(reopened), baseShapes);
  assert.deepEqual(reopened.cells, savedScene.cells);
  assert.equal(reopened.errors.length, 0);
  checks.push(
    'JSON save/reload retains the exact regions, colours, heights and connection policy',
  );
  const cup = reopened.creation.objects.find((o) => o.name === '杯子');
  assert.equal(reopened.cells.filter((c) => c.objectId === cup.id).length, 7);
  const crown = reopened.creation.objects.find((o) => o.name === '头饰');
  assert.equal(
    reopened.cells.filter((c) => c.objectId === crown.id).length,
    14,
  );
  checks.push(
    'seven cup regions and the restored fourteen crown regions survive the repair',
  );
  await page.getByRole('button', { name: '平面创作', exact: true }).click();
  const reopenHair = page.getByRole('button', {
    name: '展开头发',
    exact: true,
  });
  if (await reopenHair.count()) await reopenHair.click();
  await page
    .getByRole('button', { name: '编辑线条 头发分割线', exact: true })
    .click();
  await page
    .getByRole('button', { name: '定位选中内容 (F)', exact: true })
    .click();
  await settle();
  await page.locator('[data-node-index="0"]').click();
  const handle = await page
    .locator('[data-control-handle="0:1"] circle')
    .last()
    .boundingBox();
  const beforeDrag = await call('get_project');
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 + 8,
    handle.y + handle.height / 2 + 7,
    { steps: 6 },
  );
  await page.mouse.up();
  await settle();
  const dragged = await call('get_project');
  const draggedScene = await call('creation_inspect');
  assert.equal(draggedScene.errors.length, 0);
  assert.equal(
    draggedScene.cells.filter((c) => c.objectId === hair.id).length,
    16,
  );
  assert.notDeepEqual(shapes(draggedScene), shapes(reopened));
  assert.notDeepEqual(
    dragged.paths.find((p) => p.id === divider.id).curves,
    divider.curves,
  );
  assert.deepEqual(
    dragged.paths.filter((p) => p.id !== divider.id),
    beforeDrag.paths.filter((p) => p.id !== divider.id),
  );
  assert.equal(dragged.paths.find((p) => p.id === divider.id).curves.length, 1);
  assert.deepEqual(
    dragged.paths.find((p) => p.id === divider.id).anchors,
    divider.anchors,
  );
  await page.keyboard.press('Control+z');
  await settle();
  assert.deepEqual(await call('get_project'), beforeDrag);
  checks.push(
    'a real handle drag updates the regions at high zoom, adds no anchors, and fully undoes',
  );
  return { ok: true, checks };
};
