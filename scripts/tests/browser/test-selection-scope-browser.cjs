module.exports = async (page, fixture) => {
  const assert = require('node:assert/strict');
  const checks = [];
  fixture = JSON.parse(JSON.stringify(fixture));
  const call = require('./harness/legacy-call.cjs').legacyCaller(page);
  const settle = async () => {
    await page.waitForFunction(
      async () =>
        window.traceStudio && !(await window.traceStudio.call('state')).busy,
    );
    await page.locator('.creation-updating').waitFor({ state: 'hidden' });
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
  };
  const choose = async (kind, ids) =>
    assert.deepEqual((await call('state')).creation.selection, { kind, ids });
  await call('load_project', { project: fixture });
  await settle();
  const before = await call('get_project');
  const scene = await call('creation_inspect');
  const chest = scene.creation.objects.find((o) => o.name === '胸前');
  const cells = scene.cells.filter((c) => c.objectId === chest.id);
  const target = cells.find((c) => c.name === '右肩内');
  const path = fixture.paths.find((p) => p.name === '右肩内');
  assert.equal(cells.length, 8);
  assert(target && !target.painted);
  await page.getByRole('button', { name: '平面创作', exact: true }).click();
  const expand = page.getByRole('button', { name: '展开胸前', exact: true });
  if (await expand.count()) await expand.click();
  await page
    .getByRole('button', { name: '编辑线条 右肩内', exact: true })
    .click();
  await page.getByRole('button', { name: '当前选区属性', exact: true }).click();
  await choose('path', [path.id]);
  assert.equal(await page.getByLabel('凸起厚度', { exact: true }).count(), 0);
  assert.equal(
    await page.getByLabel('对象起始高度', { exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .getByRole('button', { name: '选择整个部件', exact: true })
      .isVisible(),
    false,
  );
  assert.match(
    await page.locator('.creation-selection-details').innerText(),
    /右肩内[\s\S]*线条/,
  );
  checks.push(
    'line selection and tab switches never expose whole-object property editing',
  );

  await page
    .getByRole('button', { name: '选择围成的区域', exact: true })
    .click();
  await settle();
  await choose('cell', [target.key]);
  assert.equal((await call('state')).tool, 'select');
  assert.match(
    await page.locator('.creation-candidate-note').innerText(),
    /虚线/,
  );
  assert.equal(
    await page
      .locator(`[data-creation-cell="${target.key}"]`)
      .getAttribute('stroke-dasharray'),
    null,
  );
  assert.match(
    await page.locator('.creation-edit-scope').innerText(),
    /单个区域/,
  );
  checks.push(
    'explicit enclosed-region selection exits node editing, identifies its name and explains candidate status',
  );
  await page.getByLabel('选择操作', { exact: true }).click();
  await page
    .getByRole('button', { name: '选择全部内部区域', exact: true })
    .click();
  await choose(
    'cell',
    cells.map((c) => c.key),
  );
  await page
    .getByRole('button', { name: '定位选中内容 (F)', exact: true })
    .click();
  const point = (x, y) =>
    page
      .locator('[data-creation-cell]')
      .first()
      .evaluate(
        (el, q) => {
          const p = new DOMPoint(...q).matrixTransform(el.getScreenCTM());
          return { x: p.x, y: p.y };
        },
        [x, y],
      );
  const tp = await point(
    fixture.width / 2 + (target.seed[0] * fixture.width) / fixture.widthMM,
    fixture.height / 2 - (target.seed[1] * fixture.width) / fixture.widthMM,
  );
  await page.mouse.click(tp.x, tp.y);
  await settle();
  await choose('cell', [target.key]);
  assert.equal(
    await page.getByLabel('对象起始高度', { exact: true }).count(),
    0,
  );
  checks.push(
    'one plain canvas click narrows eight regions to the new shoulder region, with local properties only',
  );

  const siblingSnapshot = (s) => s.cells.filter((c) => c.key !== target.key);
  const verify = async () => {
    const next = await call('creation_inspect');
    assert.deepEqual(siblingSnapshot(next), siblingSnapshot(scene));
    assert.equal(next.cells.length, scene.cells.length);
    assert.deepEqual((await call('get_project')).model, before.model);
    assert.deepEqual((await call('get_project')).paths, before.paths);
    await choose('cell', [target.key]);
    return next;
  };
  await page.getByRole('button', { name: '启用这个区域', exact: true }).click();
  await settle();
  const enabled = await verify();
  assert.equal(enabled.cells.find((c) => c.key === target.key).zMM, 2);
  assert.equal(
    enabled.cells.find((c) => c.key === target.key).heightMM,
    target.heightMM,
  );
  await page.keyboard.press('Control+z');
  await settle();
  assert.deepEqual(await call('get_project'), before);
  checks.push(
    'one-click activation keeps the default thickness and chest support plane, with one undo',
  );
  await page.getByLabel('凸起厚度', { exact: true }).fill('3.25');
  await page.getByLabel('凸起厚度', { exact: true }).press('Enter');
  await settle();
  let next = await verify();
  assert.equal(next.cells.find((c) => c.key === target.key).heightMM, 3.25);
  assert.equal(next.cells.find((c) => c.key === target.key).painted, true);
  await page.getByLabel('选区颜色 HEX').fill('#e46e7f');
  await page.getByRole('button', { name: '应用', exact: true }).click();
  await settle();
  next = await verify();
  assert.equal(next.cells.find((c) => c.key === target.key).color, '#e46e7f');
  await page.getByLabel('凸起厚度', { exact: true }).fill('2.65');
  await page.getByLabel('凸起厚度', { exact: true }).press('Enter');
  await settle();
  await verify();
  checks.push(
    'first activation and repeated local colour/height edits preserve every sibling, recipe, key and source curve',
  );
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Control+z');
    await settle();
  }
  assert.deepEqual(await call('get_project'), before);
  checks.push(
    'each property edit undoes once, restoring the candidate and complete original document',
  );

  await page.getByLabel('凸起厚度', { exact: true }).fill('7.75');
  const otherCell = cells[0];
  const otherPoint = await point(
    fixture.width / 2 + (otherCell.seed[0] * fixture.width) / fixture.widthMM,
    fixture.height / 2 - (otherCell.seed[1] * fixture.width) / fixture.widthMM,
  );
  await page.mouse.click(otherPoint.x, otherPoint.y);
  await settle();
  await choose('cell', [otherCell.key]);
  const afterFocus = await call('creation_inspect');
  assert.deepEqual(
    siblingSnapshot(afterFocus),
    siblingSnapshot(scene),
    'a numeric draft must never retarget the newly clicked region',
  );
  assert.equal(
    await page.getByLabel('凸起厚度', { exact: true }).inputValue(),
    String(otherCell.heightMM),
  );
  if (JSON.stringify(await call('get_project')) !== JSON.stringify(before)) {
    await page.keyboard.press('Control+z');
    await settle();
  }
  assert.deepEqual(await call('get_project'), before);
  await page.locator(`[data-tree-cell="${target.key}"]`).click();
  checks.push(
    'switching regions with an unfinished numeric draft cannot write that draft into the new selection',
  );

  await page
    .getByRole('button', { name: '编辑当前对象边界', exact: true })
    .click();
  await choose('path', [path.id]);
  assert.equal((await call('state')).tool, 'edit');
  await page.locator(`[data-tree-cell="feature:body-55"]`).click();
  await settle();
  assert.equal((await call('state')).tool, 'select');
  await choose('cell', ['feature:body-55']);
  await page
    .getByRole('button', { name: '编辑当前对象边界', exact: true })
    .click();
  await choose('path', [fixture.paths.find((p) => p.name === '右肩').id]);
  checks.push(
    'outliner region selection leaves node mode; edit-lines resolves the selected region’s own source',
  );

  await page
    .getByRole('button', { name: '编辑线条 右肩内', exact: true })
    .click();
  await page
    .getByRole('button', { name: '定位选中内容 (F)', exact: true })
    .click();
  await settle();
  const node = (i) => page.locator(`[data-node-index="${i}"]`);
  await node(0).click();
  await node(1).click({ modifiers: ['Shift'] });
  assert.deepEqual((await call('state')).selectedNodes, [0, 1]);
  await node(0).click();
  assert.deepEqual((await call('state')).selectedNodes, [0]);
  await node(1).click({ modifiers: ['Shift'] });
  const box = await node(0).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 12,
    box.y + box.height / 2 + 8,
    { steps: 6 },
  );
  await page.mouse.up();
  await settle();
  assert.deepEqual((await call('state')).selectedNodes, [0, 1]);
  const moved = await call('get_project');
  assert.notDeepEqual(
    moved.paths.find((p) => p.id === path.id),
    before.paths.find((p) => p.id === path.id),
  );
  assert.deepEqual(
    moved.paths.filter((p) => p.id !== path.id),
    before.paths.filter((p) => p.id !== path.id),
  );
  await page.keyboard.press('Control+z');
  await settle();
  assert.deepEqual(await call('get_project'), before);
  checks.push(
    'plain node clicks collapse a multi-selection while dragging preserves it and moves only the selected source',
  );

  await page.getByRole('button', { name: '选择 (V)', exact: true }).click();
  await page.locator(`[data-tree-object="${chest.id}"]`).click();
  // A whole-object movement projects all eight paths; clicking one visible source
  // must not mistake that dependency set for eight explicitly selected paths.
  const curve = path.curves[1];
  const p = await point(
    (curve[0].x + 3 * curve[1].x + 3 * curve[2].x + curve[3].x) / 8,
    (curve[0].y + 3 * curve[1].y + 3 * curve[2].y + curve[3].y) / 8,
  );
  await page.mouse.click(p.x, p.y);
  await settle();
  await choose('path', [path.id]);
  const other = fixture.paths.find((p) => p.name === '右肩');
  await page
    .locator(`[data-tree-path="${other.id}"]`)
    .click({ modifiers: ['Control'] });
  await choose('path', [path.id, other.id]);
  await page.mouse.click(p.x, p.y);
  await settle();
  await choose('path', [path.id]);
  assert.deepEqual(await call('get_project'), before);
  checks.push(
    'source clicks distinguish projected object dependencies from a real path multi-selection and support plain single select',
  );
  await page
    .locator(`[data-tree-path="${other.id}"]`)
    .click({ modifiers: ['Control'] });
  const dragPoint = await point(
    (curve[0].x + 3 * curve[1].x + 3 * curve[2].x + curve[3].x) / 8,
    (curve[0].y + 3 * curve[1].y + 3 * curve[2].y + curve[3].y) / 8,
  );
  await page.mouse.move(dragPoint.x, dragPoint.y);
  await page.mouse.down();
  await page.mouse.move(dragPoint.x + 18, dragPoint.y + 9, { steps: 6 });
  await page.mouse.up();
  await settle();
  await choose('path', [path.id]);
  assert.deepEqual(await call('get_project'), before);
  checks.push(
    'selection-tool dragging narrows the path selection but never moves source geometry',
  );
  await page.locator(`[data-tree-cell="${target.key}"]`).click();
  await page.getByRole('button', { name: '启用这个区域', exact: true }).click();
  await settle();
  const persistedProject = await call('get_project');
  const persistedScene = await verify();
  await page.waitForFunction(async () =>
    (await window.traceStudio.call('state')).storage.status.includes(
      '浏览器草稿已保存',
    ),
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () =>
      window.traceStudio &&
      !document.querySelector('footer')?.textContent.includes('正在恢复工程'),
  );
  await settle();
  assert.deepEqual(await call('get_project'), persistedProject);
  assert.deepEqual(
    (await call('creation_inspect')).cells,
    persistedScene.cells,
  );
  checks.push(
    'actual browser autosave and page reload restore the enabled shoulder and every sibling exactly',
  );
  const solid = await call('creation_export', { format: 'check' });
  assert.equal(solid.report.valid, true);
  assert.equal(solid.report.components, 1);
  assert.equal(solid.report.invalidEdges, 0);
  assert.equal(solid.report.zeroArea, 0);
  checks.push(
    'the real export worker builds one connected valid solid after local activation',
  );
  await call('load_project', { project: before });
  await settle();
  return { ok: true, checks };
};
