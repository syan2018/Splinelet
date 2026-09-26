module.exports = async (page, fixture, outputDirectory) => {
  const assert = require('node:assert/strict');
  const { mkdir } = require('node:fs/promises');
  const { resolve } = require('node:path');
  const screenshot = async (name) => {
    if (!outputDirectory) return;
    await mkdir(outputDirectory, { recursive: true });
    await page.screenshot({ path: resolve(outputDirectory, name + '.png') });
  };
  const checks = [];
  fixture = structuredClone(fixture);
  fixture.model.parts.push({ id: 'property-test-empty', name: '空零件' });
  const call = require('./harness/legacy-call.cjs').legacyCaller(page);
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
  await page.locator('.canvas-display-options summary').click();
  await page.getByRole('button', { name: '管理参考图', exact: true }).click();
  const references = page.getByRole('complementary', {
    name: '参考图',
    exact: true,
  });
  await references.waitFor();
  assert(await references.evaluate((el) => el === document.activeElement));
  await references.getByRole('button', { name: '关闭参考图面板' }).click();
  await references.waitFor({ state: 'hidden' });
  assert(
    await page
      .locator('.canvas-display-options summary')
      .evaluate((el) => el === document.activeElement),
  );
  await header.getByRole('button', { name: '导出', exact: true }).click();
  assert.equal(
    await page
      .getByRole('button', { name: '检查与导出 · 全局', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  assert.deepEqual(
    await call('get_project'),
    original,
    'opening references and export does not edit the document',
  );
  const tools = page.getByRole('navigation', { name: '绘图工具' });
  assert.equal(await tools.getByRole('button').count(), 8);
  await mainMenu.click();
  const menu = page.getByRole('menu', { name: 'Splinelet 主菜单' });
  await menu.getByRole('menuitem').first().waitFor({ state: 'visible' });
  assert.equal(await menu.getByRole('menuitem').count(), 8);
  assert(
    await menu
      .getByRole('menuitem', { name: '导入 SVG／笔迹…', exact: true })
      .isVisible(),
  );
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
      .getByRole('button', { name: '当前选区形状', exact: true })
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

  const properties = page.locator('.creation-properties');
  const domainControls = [
    [
      '当前选区形状',
      properties.getByRole('button', { name: '画轮廓', exact: true }),
    ],
    ['当前选区颜色', properties.getByLabel('选区颜色 HEX', { exact: true })],
    ['当前选区浮雕厚度', properties.getByLabel('凸起厚度', { exact: true })],
    [
      '当前选区叠放位置',
      properties.getByLabel('对象起始高度', { exact: true }),
    ],
    [
      '当前部件输出选项',
      properties.getByRole('checkbox', { name: '参与成品导出', exact: true }),
    ],
  ];
  const originalSelection = (await call('state')).creation.selection;
  for (const [name, control] of domainControls) {
    await rail.getByRole('button', { name, exact: true }).click();
    assert(await control.isVisible(), name);
    for (const [otherName, otherControl] of domainControls)
      if (otherName !== name)
        assert.equal(await otherControl.count(), 0, otherName);
    assert.deepEqual(
      (await call('state')).creation.selection,
      originalSelection,
    );
  }
  assert.deepEqual(await call('get_project'), original);
  checks.push(
    'object domains render independent contributions without changing selection or document',
  );

  await call('creation_focus', { objectId: object.id });
  const second = scene.creation.objects.find((o) => o.id !== object.id);
  await rail.getByRole('button', { name: '当前选区颜色', exact: true }).click();
  await call('creation_focus', { objectId: second.id });
  assert.equal(
    await rail
      .getByRole('button', { name: '当前选区颜色', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  await call('creation_focus', { objectId: object.id });
  await page
    .locator(`[data-tree-object="${second.id}"]`)
    .click({ modifiers: ['Control'] });
  await rail
    .getByRole('button', { name: '当前选区叠放位置', exact: true })
    .click();
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
  assert.equal(
    await rail
      .getByRole('button', { name: '当前部件输出选项', exact: true })
      .count(),
    0,
  );
  checks.push(
    'multi-object properties never expose controls that only edit the last member',
  );

  await call('select_path', { id: object.pathIds[0] });
  assert.equal(
    await rail
      .getByRole('button', { name: '当前源线属性', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  await rail.getByRole('button', { name: '当前源线属性', exact: true }).click();
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
      .getByRole('button', { name: '当前选区形状', exact: true })
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
    .selectOption({ label: '空零件' });
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

  await call('creation_focus', { objectId: object.id });
  const originalDocument = (await call('document.get')).document;
  const otherRegions = (view) =>
    view.cells
      .filter((cell) => cell.objectId !== object.id)
      .map(({ key, color, heightMM }) => ({ key, color, heightMM }));
  await rail.getByRole('button', { name: '当前选区颜色', exact: true }).click();
  await properties.getByLabel('选区颜色 HEX', { exact: true }).fill('#123abc');
  await properties.getByRole('button', { name: '应用', exact: true }).click();
  await settle();
  const painted = await call('creation_inspect');
  assert(
    painted.cells
      .filter((cell) => cell.objectId === object.id)
      .every((cell) => cell.color === '#123abc'),
  );
  assert.deepEqual(otherRegions(painted), otherRegions(scene));
  await screenshot('appearance');
  await call('undo');
  await settle();
  assert.deepEqual((await call('document.get')).document, originalDocument);
  await rail
    .getByRole('button', { name: '当前选区浮雕厚度', exact: true })
    .click();
  const thickness = properties.getByLabel('凸起厚度', { exact: true });
  await thickness.fill('2.7');
  await thickness.press('Enter');
  await settle();
  const raised = await call('creation_inspect');
  assert(
    raised.cells
      .filter((cell) => cell.objectId === object.id)
      .every((cell) => cell.heightMM === 2.7),
  );
  assert.deepEqual(otherRegions(raised), otherRegions(scene));
  await call('undo');
  await settle();
  assert.deepEqual((await call('document.get')).document, originalDocument);
  await thickness.fill('9.9');
  await call('creation_focus', { objectId: second.id });
  assert.notEqual(
    await thickness.inputValue(),
    '9.9',
    'uncommitted thickness belongs to the old selection',
  );
  assert.deepEqual((await call('document.get')).document, originalDocument);
  checks.push(
    'color and relief contributions edit only their selected owner and undo once; drafts do not cross selections',
  );

  await rail
    .getByRole('button', { name: '打印方案 · 全局', exact: true })
    .click();
  page.once('dialog', (dialog) => dialog.accept());
  await properties
    .getByRole('button', { name: '启用打印分层…', exact: true })
    .click();
  await settle();
  await properties
    .getByRole('button', { name: '新增堆叠层', exact: true })
    .click();
  await settle();
  const layers = (await call('creation_inspect')).creation.printStack.layers;
  assert.equal(layers.length, 2);
  await rail
    .getByRole('button', { name: '当前选区叠放位置', exact: true })
    .click();
  const placement = properties.getByRole('combobox', {
    name: '所属堆叠层',
    exact: true,
  });
  assert.equal(
    await placement.locator('option[value=""]').count(),
    0,
    'a uniform layer has no mixed-state option',
  );
  await placement.selectOption(layers[1].id);
  await settle();
  const upperScene = await call('creation_inspect');
  const region = upperScene.cells.find((cell) => cell.objectId === second.id);
  assert(region?.outputRef);
  await call('authoring.run', {
    action: {
      kind: 'set-relief',
      target: region.outputRef,
      value: {
        placement: { kind: 'layer', layerId: layers[0].id, offsetMM: 0 },
      },
    },
  });
  await settle();
  assert.equal(
    await placement.locator('option[value=""]').textContent(),
    '部件内区域的叠放位置不同',
  );
  await screenshot('single-shape-mixed-placement');
  await properties.getByRole('button', { name: '管理层', exact: true }).click();
  for (const layer of layers) {
    const card = properties.locator(`[data-print-layer="${layer.id}"]`);
    assert.match(
      await card.locator('.creation-print-members').textContent(),
      new RegExp(second.name + '（部分区域）'),
    );
    assert(
      await card
        .getByRole('button', { name: layer.name + ' 删除', exact: true })
        .isDisabled(),
    );
  }
  await call('undo');
  await settle();
  await rail
    .getByRole('button', { name: '当前选区叠放位置', exact: true })
    .click();
  assert.equal(await placement.inputValue(), layers[1].id);
  await page
    .locator(`[data-tree-object="${object.id}"]`)
    .click({ modifiers: ['Control'] });
  assert.equal((await call('state')).creation.selection.ids.length, 2);
  const mixed = placement.locator('option[value=""]');
  assert.equal(await mixed.textContent(), '所选部件的叠放位置不同');
  assert(
    await mixed.evaluate((option) => option.disabled),
    'mixed describes the current value, not an assignment choice',
  );
  assert(
    await properties
      .getByText('选择一个层会统一选中部件的全部区域', { exact: true })
      .isVisible(),
  );
  await screenshot('mixed-placement');
  await placement.selectOption(layers[0].id);
  await settle();
  const unified = await call('creation_inspect');
  assert(unified.cells.every((cell) => cell.printLayerId === layers[0].id));
  assert.equal(await placement.locator('option[value=""]').count(), 0);
  await call('undo');
  await settle();
  assert.equal(await mixed.textContent(), '所选部件的叠放位置不同');
  for (let i = 0; i < 3; i++) {
    await call('undo');
    await settle();
  }
  assert.deepEqual((await call('document.get')).document, originalDocument);
  checks.push(
    'mixed placement is a disabled status; choosing a layer unifies all selected regions and undo restores it',
  );

  return checks;
};
