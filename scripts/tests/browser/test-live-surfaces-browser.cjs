module.exports = async (page, fixture) => {
  const assert = require('node:assert/strict'),
    checks = [];
  const call = (action, args = {}) =>
    page.evaluate(({ action, args }) => window.traceStudio.call(action, args), {
      action,
      args,
    });
  const settle = async () => {
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll('.creation-role button')].some(
          (b) => b.disabled,
        ),
    );
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
  await call('load_project', { project: fixture });
  await settle();
  await page.getByRole('button', { name: '平面创作', exact: true }).click();
  await page.getByRole('button', { name: '选择 (V)', exact: true }).click();
  const before = await call('get_project'),
    initial = await call('creation_inspect');
  const object = initial.creation.objects.find((o) => o.name === '黑色外框');
  const hole = before.paths.find((p) => p.name === '外框镂空');
  const black = () =>
    call('creation_inspect').then((s) =>
      s.cells.find((c) => c.featureId === 'body-black'),
    );
  const original = await black();
  assert.equal(initial.errors.length, 0);
  assert.equal(original.holes, 1);
  const expand = page.getByRole('button', {
    name: '展开黑色外框',
    exact: true,
  });
  if (await expand.count()) await expand.click();
  const children = page
    .locator(`[data-tree-object="${object.id}"]`)
    .locator('xpath=following-sibling::*[1]');
  const details = children.locator('details');
  if (!(await details.evaluate((e) => e.open)))
    await details.locator('summary').click();
  const named = page.locator('[data-tree-cell="feature:body-black"]');
  assert.equal((await named.innerText()).trim(), original.name);
  await named.click();
  assert.deepEqual((await call('state')).creation.selection, {
    kind: 'cell',
    ids: [original.key],
  });
  assert.match(
    await page.locator('.creation-selection-details').innerText(),
    /黑色衬底/,
  );
  checks.push(
    'outliner shows the real region name and selects that exact region',
  );
  const edit = () =>
    page
      .getByRole('button', { name: '编辑线条 外框镂空', exact: true })
      .click();
  await edit();
  await page.getByRole('button', { name: '参考', exact: true }).click();
  await settle();
  assert.equal((await black()).holes, 0);
  assert((await black()).areaMM2 > original.areaMM2 + 68);
  await page.getByRole('button', { name: '挖洞', exact: true }).click();
  await settle();
  assert.deepEqual(await black(), original);
  checks.push(
    'switching hole to guide and back updates the imported face through real controls',
  );
  await page.keyboard.press('Control+z');
  await settle();
  assert.equal((await black()).holes, 0);
  await page.keyboard.press('Control+Shift+z');
  await settle();
  assert.deepEqual(await black(), original);
  checks.push(
    'undo and redo recompute the face instead of keeping its former polygon',
  );
  await edit();
  const node = page.locator('[data-node-index="0"] circle').first();
  const xy = await node.evaluate((el) => {
    const p = new DOMPoint(
      +el.getAttribute('cx'),
      +el.getAttribute('cy'),
    ).matrixTransform(el.getScreenCTM());
    return { x: p.x, y: p.y };
  });
  await page.mouse.move(xy.x, xy.y);
  await page.mouse.down();
  await page.mouse.move(xy.x - 10, xy.y + 7, { steps: 8 });
  await page.mouse.up();
  await settle();
  const moved = await black(),
    movedProject = await call('get_project'),
    movedScene = await call('creation_inspect');
  assert.equal(movedScene.errors.length, 0);
  assert.notEqual(moved.areaMM2, original.areaMM2);
  assert.equal(moved.heightMM, original.heightMM);
  assert.equal(moved.color, original.color);
  assert.equal(moved.key, original.key);
  assert.deepEqual(
    movedProject.paths.filter((p) => p.id !== hole.id),
    before.paths.filter((p) => p.id !== hole.id),
  );
  assert.deepEqual(
    movedScene.cells.filter((c) => c.objectId !== object.id),
    initial.cells.filter((c) => c.objectId !== object.id),
  );
  checks.push(
    'dragging a hole node recomputes its face and preserves every other region, colour and height',
  );
  await page.waitForFunction(async () =>
    (await window.traceStudio.call('state')).storage.status.includes(
      '已保存到此浏览器',
    ),
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.traceStudio);
  await settle();
  assert.deepEqual(await black(), moved);
  assert.deepEqual((await call('get_project')).paths, movedProject.paths);
  checks.push(
    'real autosave and reload regenerate the edited hole from current source curves',
  );
  await call('load_project', { project: before });
  await settle();
  const expandAgain = page.getByRole('button', {
    name: '展开黑色外框',
    exact: true,
  });
  if (await expandAgain.count()) await expandAgain.click();
  await page.getByRole('button', { name: '选择 (V)', exact: true }).click();
  await page.locator(`[data-tree-path="${hole.id}"]`).click();
  await page.keyboard.press('Delete');
  await settle();
  assert.equal((await black()).holes, 0);
  assert.equal((await call('creation_inspect')).errors.length, 0);
  await page.keyboard.press('Control+z');
  await settle();
  assert.deepEqual(await black(), original);
  checks.push(
    'deleting and undoing a hole removes and restores the actual cut without orphan styles',
  );
  const invalid = JSON.parse(JSON.stringify(before));
  invalid.paths.find((p) => p.id === hole.id).closed = false;
  await call('load_project', { project: invalid });
  await settle();
  const failed = await call('creation_inspect');
  assert(failed.errors.some((e) => e.objectId === object.id));
  assert(!failed.cells.some((c) => c.objectId === object.id));
  const expandBad = page.getByRole('button', {
    name: '展开黑色外框',
    exact: true,
  });
  if (await expandBad.count()) await expandBad.click();
  await edit();
  assert.match(
    await page.locator('.creation-issue').innerText(),
    /无效区域已停止显示/,
  );
  assert.equal(
    await page.locator('[data-creation-cell="feature:body-black"]').count(),
    0,
  );
  await page.getByRole('button', { name: '参考', exact: true }).click();
  await settle();
  assert.equal((await black()).holes, 0);
  await page.keyboard.press('Control+z');
  await settle();
  assert(
    !(await call('creation_inspect')).cells.some(
      (c) => c.objectId === object.id,
    ),
  );
  checks.push(
    'failed construction displays an explicit error, no stale selectable face; correcting its role and undo both work',
  );
  await call('load_project', { project: before });
  await settle();
  await page.getByRole('button', { name: '立体预览', exact: true }).click();
  await settle();
  assert.equal((await call('state')).creation.view, '3d');
  assert.equal((await call('creation_inspect')).errors.length, 0);
  checks.push(
    'the full current project also opens in the 3D preview without construction errors',
  );
  return { ok: true, checks };
};
