module.exports = async (page, fixture) => {
  const assert = require('node:assert/strict'),
    checks = [];
  const call = (action, args = {}) =>
    page.evaluate(({ action, args }) => window.traceStudio.call(action, args), {
      action,
      args,
    });
  const settle = async () => {
    await page.waitForFunction(
      async () =>
        window.traceStudio && !(await window.traceStudio.call('state')).busy,
    );
    await page.locator('.creation-updating').waitFor({ state: 'hidden' });
  };
  await call('load_project', { project: fixture });
  await settle();
  await page.getByRole('button', { name: '选择 (V)', exact: true }).click();
  await page.getByRole('button', { name: '添加项目色', exact: true }).click();
  await settle();
  const withUnused = await call('get_project'),
    unused = withUnused.creation.swatches.at(-1);
  await page
    .getByRole('button', { name: '画笔色：' + unused.name, exact: true })
    .dblclick();
  await page.getByRole('button', { name: '删除项目色', exact: true }).click();
  await settle();
  assert(
    !(await call('get_project')).creation.swatches.some(
      (s) => s.id === unused.id,
    ),
  );
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.keyboard.press('Control+z');
  await settle();
  assert.deepEqual(await call('get_project'), withUnused);
  checks.push(
    'unused colour deletes directly through the UI and restores in one undo',
  );
  const scene = await call('creation_inspect');
  const used = withUnused.creation.swatches.find(
    (s) => s.id === 'legacy-e8d8bc',
  );
  await page
    .getByRole('button', { name: '画笔色：' + used.name, exact: true })
    .dblclick();
  await page.getByRole('button', { name: '删除项目色', exact: true }).click();
  assert(await page.getByRole('dialog').isVisible());
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.deepEqual(await call('get_project'), withUnused);
  checks.push(
    'deleting an in-use colour opens a replacement dialog; Escape cancels without changing selection or data',
  );
  await page.getByRole('button', { name: '删除项目色', exact: true }).click();
  await page.getByLabel('删除颜色时替换为').selectOption('red');
  await page.getByRole('button', { name: '替换并删除', exact: true }).click();
  await settle();
  const changed = await call('get_project'),
    changedScene = await call('creation_inspect');
  assert(!changed.creation.swatches.some((s) => s.id === used.id));
  for (const c of scene.cells) {
    const next = changedScene.cells.find((n) => n.key === c.key);
    assert.deepEqual(next.geometry, c.geometry);
    assert.equal(next.heightMM, c.heightMM);
    assert.equal(next.swatchId, c.swatchId === used.id ? 'red' : c.swatchId);
  }
  assert.deepEqual(changed.paths, withUnused.paths);
  await page.keyboard.press('Control+z');
  await settle();
  assert.deepEqual(await call('get_project'), withUnused);
  await page.keyboard.press('Control+Shift+z');
  await settle();
  assert.deepEqual(await call('get_project'), changed);
  await page.waitForFunction(async () =>
    (await window.traceStudio.call('state')).storage.status.includes(
      '已保存到此浏览器',
    ),
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () =>
      window.traceStudio &&
      !document.querySelector('footer')?.textContent.includes('正在恢复工程'),
  );
  await settle();
  assert.deepEqual(await call('get_project'), changed);
  assert.deepEqual((await call('creation_inspect')).cells, changedScene.cells);
  checks.push(
    'replacement deletes only that palette entry, remaps its references, preserves curves and heights, and survives real autosave/reload',
  );
  return { ok: true, checks };
};
