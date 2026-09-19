module.exports = async (page, fixture) => {
  const assert = require('node:assert/strict');
  const checks = [];
  fixture = structuredClone(fixture);
  fixture.model.parts.push({ id: 'property-test-empty', name: '空零件' });
  const call = (action, args = {}) =>
    page.evaluate(({ action, args }) => window.traceStudio.call(action, args), {
      action,
      args,
    });
  const settle = async () => {
    await page.waitForFunction(
      async () =>
        window.traceStudio &&
        (await window.traceStudio.call('state')).ready &&
        !(await window.traceStudio.call('state')).busy,
    );
    await page.locator('.creation-updating').waitFor({ state: 'hidden' });
  };
  await call('load_project', { project: fixture });
  await settle();
  const original = await call('get_project');
  const header = page.getByRole('banner');
  const mainMenu = header.getByRole('button', { name: 'Splinelet 主菜单' });
  assert.equal(await header.getByRole('button').count(), 3);
  const tools = page.getByRole('navigation', { name: '绘图工具' });
  assert.equal(await tools.getByRole('button').count(), 8);
  await mainMenu.click();
  const menu = page.getByRole('menu', { name: 'Splinelet 主菜单' });
  await menu.getByRole('menuitem').first().waitFor({ state: 'visible' });
  assert.equal(await menu.getByRole('menuitem').count(), 7);
  await page.keyboard.press('ArrowDown');
  assert.equal(await menu.locator('[data-highlighted]').count(), 1);
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden' });
  assert(await mainMenu.evaluate((el) => el === document.activeElement));
  await mainMenu.click();
  await menu.getByRole('menuitem', { name: '操作帮助', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'visible' });
  await menu.waitFor({ state: 'hidden' });
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await tools.getByRole('button', { name: '描线 (P)', exact: true }).click();
  assert(await page.getByRole('button', { name: '标记候选拐点' }).isVisible());
  await tools.getByRole('button', { name: '选择 (V)', exact: true }).click();
  checks.push(
    'compact header menu supports keyboard dismissal and contextual tools remain reachable',
  );
  const scene = await call('creation_inspect');
  const object = scene.creation.objects.find((o) => o.pathIds.length);
  const rail = page.getByRole('navigation', { name: '属性分类' });
  assert.equal(await rail.getByRole('group').count(), 2);
  assert.equal(
    await rail
      .getByRole('button', { name: '当前选区属性', exact: true })
      .count(),
    0,
  );
  await call('creation_focus', { objectId: object.id });
  assert.equal(await rail.getByRole('group').count(), 3);
  const buttons = await rail.getByRole('button').all();
  const bounds = await Promise.all(
    buttons.map((button) => button.boundingBox()),
  );
  assert(bounds.every((r) => Math.abs(r.x - bounds[0].x) < 1));
  assert(bounds.every((r, i) => i === 0 || r.y > bounds[i - 1].y));
  checks.push(
    'property categories form a vertical rail with three labeled scope groups',
  );

  for (const name of [
    '工程设置 · 全局',
    '项目色卡 · 全局',
    '打印方案 · 全局',
    '检查与导出 · 全局',
  ]) {
    await rail.getByRole('button', { name, exact: true }).click();
    await call('creation_focus', { objectId: object.id });
    assert.equal(
      await rail
        .getByRole('button', { name, exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    assert.match(
      await page.locator('.property-context').innerText(),
      /整个工程/,
    );
  }
  assert.deepEqual(await call('get_project'), original);
  checks.push(
    'global categories remain stable across selection changes and do not edit the project',
  );

  await call('creation_focus', { objectId: object.id });
  const second = scene.creation.objects.find((o) => o.id !== object.id);
  await page
    .locator(`[data-tree-object="${second.id}"]`)
    .click({ modifiers: ['Control'] });
  await rail.getByRole('button', { name: '当前选区属性', exact: true }).click();
  assert.equal((await call('state')).creation.selection.ids.length, 2);
  assert.equal(
    await page.getByLabel('对象起始高度', { exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .getByRole('checkbox', { name: '参与成品导出', exact: true })
      .count(),
    0,
  );
  assert.match(
    await page.locator('.creation-properties').innerText(),
    /请单选部件后设置/,
  );
  checks.push(
    'multi-object properties never expose controls that only edit the last member',
  );

  await call('select_path', { id: object.pathIds[0] });
  await rail.getByRole('button', { name: '当前选区属性', exact: true }).click();
  assert.equal(
    await page
      .locator('.creation-properties')
      .getByRole('tablist', { name: '属性页签' })
      .count(),
    0,
  );
  assert.equal(
    await page.locator('.creation-properties').getByLabel('工程设置').count(),
    0,
  );
  assert.equal(
    await page
      .locator('.creation-properties')
      .getByLabel('打印层高', { exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .locator('.creation-properties')
      .getByRole('button', { name: /修改项目色/ })
      .count(),
    0,
  );
  checks.push(
    'source properties contain no nested project tabs, global colors or print settings',
  );

  await page.getByRole('button', { name: '节点 (A)', exact: true }).click();
  assert.equal(
    await rail
      .getByRole('button', { name: '当前工具设置', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  assert.match(await page.locator('.property-context').innerText(), /节点/);
  await page.getByRole('button', { name: '选择 (V)', exact: true }).click();

  assert.equal(
    await rail
      .getByRole('button', { name: '当前部件构造与修改器', exact: true })
      .count(),
    0,
  );
  await page.getByRole('button', { name: '取消对象选择', exact: true }).click();
  assert.equal(await rail.getByRole('group').count(), 2);
  assert.equal(
    await rail
      .getByRole('button', { name: '当前选区属性', exact: true })
      .count(),
    0,
  );
  checks.push(
    'object categories disappear after deselection; paths never expose whole-part modifiers',
  );
  await rail
    .getByRole('button', { name: '工程设置 · 全局', exact: true })
    .click();
  await page.getByText('工程高级构造', { exact: true }).click();
  await page
    .getByRole('button', { name: '打开高级构造编辑器', exact: true })
    .click();
  const editor = page.getByRole('dialog', {
    name: '高级构造编辑器',
    exact: true,
  });
  await editor.waitFor({ state: 'visible' });
  await editor.getByRole('button', { name: '体块与零件', exact: true }).click();
  assert.equal((await call('state')).workspace, 'relief');
  await editor.getByRole('button', { name: '高级制造', exact: true }).click();
  await editor
    .getByRole('button', { name: '检查与导出当前零件…', exact: true })
    .click();
  await editor.waitFor({ state: 'hidden' });
  assert.equal((await call('state')).workspace, 'trace');
  await call('set_workspace', { mode: 'faces' });
  await editor.waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await editor.waitFor({ state: 'hidden' });
  assert.equal((await call('state')).workspace, 'trace');
  checks.push(
    'advanced construction is a named modal editor; legacy API and return-to-creation remain usable',
  );

  await page.getByRole('button', { name: '导出', exact: true }).click();
  assert(
    await page
      .getByRole('combobox', { name: '实体输出零件', exact: true })
      .isVisible(),
  );
  await page
    .getByRole('button', { name: '检查可打印实体', exact: true })
    .click();
  await page.locator('.creation-report').waitFor({ state: 'visible' });
  await page
    .getByRole('combobox', { name: '实体输出零件', exact: true })
    .selectOption('property-test-empty');
  assert.equal(await page.locator('.creation-report').count(), 0);
  checks.push(
    'changing output parts cannot display another part’s solid validation report',
  );
  await page
    .getByRole('button', { name: '源曲线 SVG · 精确贝塞尔', exact: true })
    .click();
  const sourceExport = page.getByRole('dialog', {
    name: '源曲线导出',
    exact: true,
  });
  await sourceExport.waitFor({ state: 'visible' });
  assert(
    await sourceExport
      .getByRole('button', { name: '导出 SVG', exact: true })
      .isVisible(),
  );
  await page.keyboard.press('Escape');
  await sourceExport.waitFor({ state: 'hidden' });
  assert.equal(
    await page.getByRole('button', { name: '源线工作台', exact: true }).count(),
    0,
  );
  assert.deepEqual(await call('get_project'), original);
  checks.push(
    'source export is reachable without a GUI mode switch; navigation preserves project data',
  );

  return checks;
};
