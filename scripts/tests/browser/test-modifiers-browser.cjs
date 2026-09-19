module.exports = async (page, fixture) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  const assert = require('node:assert/strict');
  const { readFileSync } = require('node:fs');
  const { decodeProject } = await import('../../../src/lib/project-format.mjs');
  const expected = decodeProject(readFileSync(fixture)).creation.objects.find(
    (object) => object.name === '头饰',
  );
  const call = (action, args = {}) =>
    page.evaluate(({ action, args }) => window.traceStudio.call(action, args), {
      action,
      args,
    });
  const checks = [];
  const check = (value, label) => {
    assert(value, label);
    checks.push(label);
  };
  const wait = async () => {
    await page.waitForFunction(async () => {
      try {
        const s = await window.traceStudio.call('creation_inspect');
        return !!s.modifierStatus;
      } catch {
        return false;
      }
    });
    await page.locator('.creation-updating').waitFor({ state: 'hidden' });
    await page
      .locator('.creation-modifiers')
      .filter({ has: page.locator('.modifier-heading') })
      .waitFor();
    await page.waitForFunction(
      () => !document.querySelector('.creation-modifiers')?.disabled,
    );
  };
  await page
    .locator('input[accept=".spl,.bezier.json,.json"]')
    .setInputFiles([]);
  await page
    .locator('input[accept=".spl,.bezier.json,.json"]')
    .setInputFiles(fixture);
  await page.waitForFunction(async (expectedModifiers) => {
    try {
      const s = await window.traceStudio.call('creation_inspect');
      return (
        JSON.stringify(
          s.creation.objects.find((o) => o.name === '头饰')?.modifiers,
        ) === expectedModifiers
      );
    } catch {
      return false;
    }
  }, JSON.stringify(expected.modifiers));
  await page
    .locator('.creation-object-row .creation-name')
    .getByText('头饰', { exact: true })
    .click();
  await page
    .getByRole('button', { name: '当前部件构造与修改器', exact: true })
    .click();
  await wait();
  const s = await call('creation_inspect');
  const o = s.creation.objects.find((o) => o.name === '头饰'),
    h = o.modifiers.find(
      (m) => m.rolePathId === 'be92b11d-9617-4008-b6c1-be9f1d842c45',
    );
  const card = page.locator(`[data-modifier-id="${h.id}"]`);
  const scope = card.getByRole('combobox', { name: '作用范围 ' + h.name });
  const face = async (id) =>
    (await call('creation_inspect')).cells.find((c) => c.featureId === id);
  // Establish the state this undo test needs; the saved sample may already
  // select a narrower scope. Never race the startup project during file load.
  await scope.selectOption('all');
  await wait();
  check(
    (await face('body-8')).holes === 1,
    'all-surface baseline cuts the crown',
  );
  await scope.selectOption('feature:body-band-64');
  await wait();
  check(
    (await face('body-8')).holes === 0 &&
      (await face('body-band-64')).holes === 1,
    'single-surface scope retains white crown under gold',
  );
  await scope.focus();
  await page.keyboard.press('Control+z');
  await wait();
  check(
    (await face('body-8')).holes === 1,
    'undo works while scope select has keyboard focus',
  );
  await scope.selectOption('feature:body-band-64');
  await wait();
  await card.getByRole('checkbox', { name: '启用 ' + h.name }).uncheck();
  await wait();
  check(
    (await face('body-band-64')).holes === 0,
    'disable removes the actual cut including imported duplicate subtraction',
  );
  await card.getByRole('checkbox', { name: '启用 ' + h.name }).check();
  await wait();
  await scope.selectOption('multiple');
  await card
    .locator('.modifier-multi')
    .getByRole('checkbox', { name: '头饰大形', exact: true })
    .check();
  await card.getByRole('button', { name: '应用范围', exact: true }).click();
  await wait();
  check(
    (await face('body-8')).holes === 1,
    'multi-surface target applies to explicit checked faces',
  );
  await scope.selectOption('feature:body-band-64');
  await wait();
  await card.locator('.modifier-name').dblclick();
  await card.getByRole('textbox', { name: '修改器名称' }).fill('菱形凹槽');
  await page.keyboard.press('Enter');
  await wait();
  check(
    (await card.locator('.modifier-name').innerText()) === '菱形凹槽',
    'double-click rename commits without expanding parameters',
  );
  await card.getByRole('button', { name: '参数 菱形凹槽' }).click();
  await card
    .getByRole('combobox', { name: '运算 菱形凹槽' })
    .selectOption('intersection');
  await wait();
  const intersection = await call('creation_inspect');
  check(
    intersection.creation.objects
      .find((item) => item.id === o.id)
      .modifiers.find((item) => item.id === h.id).operation ===
      'intersection' &&
      intersection.modifierStatus.some(
        (item) =>
          item.modifierId === h.id &&
          item.error?.includes('输出轮廓关系已变化'),
      ) &&
      !intersection.cells.some((cell) => cell.objectId === o.id),
    'intersection commits but changed topology blocks old output identities',
  );
  check(
    await card.locator('.modifier-error').isVisible(),
    'topology change has a visible diagnostic',
  );
  await card
    .getByRole('combobox', { name: '运算 菱形凹槽' })
    .selectOption('difference');
  await wait();
  check(
    (await face('body-band-64')).holes === 1,
    'restoring the operation repairs the existing output contract',
  );
  await card.getByRole('button', { name: '参数 菱形凹槽' }).click();
  await page.getByRole('button', { name: '添加修改器', exact: true }).click();
  await page
    .getByRole('combobox', { name: '新修改器类型' })
    .selectOption('offset');
  await page.getByRole('spinbutton', { name: '轮廓偏移距离' }).fill('0.2');
  await page.keyboard.press('Enter');
  await page
    .locator('.modifier-actions')
    .getByRole('button', { name: '添加', exact: true })
    .click();
  await wait();
  const offsetId = (await call('creation_inspect')).creation.objects
    .find((x) => x.id === o.id)
    .modifiers.at(-1).id;
  const offset = page.locator(`[data-modifier-id="${offsetId}"]`);
  await offset.getByRole('button', { name: '参数 轮廓偏移' }).click();
  await offset.getByRole('spinbutton', { name: '轮廓偏移距离' }).fill('5');
  await page.keyboard.press('Escape');
  await wait();
  check(
    (await call('get_project')).creation.objects
      .find((x) => x.id === o.id)
      .modifiers.at(-1).distanceMM === 0.2,
    'Escape cancels numeric edit without an accidental blur commit',
  );
  // Drop onto the card header, not the native scope <select> at its center.
  // Collapse the editor so both handles fit inside the scrolling property panel.
  await offset.getByRole('button', { name: '参数 轮廓偏移' }).click();
  await offset.locator('.modifier-grip').dragTo(card.locator('.modifier-name'));
  await wait();
  check(
    (await call('get_project')).creation.objects.find((x) => x.id === o.id)
      .modifiers[0].id === offsetId,
    'drag handle changes real evaluation order',
  );
  await offset.locator('summary').click();
  await offset.getByRole('button', { name: '下移', exact: true }).click();
  await wait();
  check(
    (await call('get_project')).creation.objects.find((x) => x.id === o.id)
      .modifiers[1].id === offsetId,
    'menu ordering shares the same command',
  );
  if ((await offset.locator('details').getAttribute('open')) === null)
    await offset.locator('summary').click();
  await offset.getByRole('button', { name: '删除修改器', exact: true }).click();
  await wait();
  check(
    (await call('get_project')).creation.objects.find((x) => x.id === o.id)
      .modifiers.length === 1,
    'delete modifier removes only its step',
  );
  await page.locator('.modifier-sources > summary').click();
  const source = page.locator('.modifier-source').filter({
    has: page.locator('summary').getByText('头饰嵌线 65', { exact: true }),
  });
  await source.locator(':scope > summary').click();
  check(
    (await source.locator('.modifier-card').count()) === 2,
    'imported face construction is exposed as a nested editable stack with no hidden duplicate hole',
  );
  await source.locator(':scope > summary').click();
  await page.locator('.modifier-sources > summary').click();
  await page
    .locator('footer')
    .getByText('浏览器草稿已保存 · 未保存工程文件', { exact: true })
    .waitFor();
  const before = await call('get_project');
  await page.reload();
  await page
    .locator('.creation-object-row .creation-name')
    .getByText('头饰', { exact: true })
    .click();
  await page
    .getByRole('button', { name: '当前部件构造与修改器', exact: true })
    .click();
  await wait();
  check(
    (await face('body-8')).holes === 0 &&
      (await page
        .getByRole('combobox', { name: '作用范围 菱形凹槽' })
        .inputValue()) === 'feature:body-band-64',
    'autosave/reload preserves the modifier scope and shallow recess',
  );
  const after = await call('get_project');
  check(
    JSON.stringify(before.paths) === JSON.stringify(after.paths) &&
      JSON.stringify(before.model) === JSON.stringify(after.model),
    'modifier GUI keeps original curves and model recipes unchanged',
  );
  return { passed: checks.length, checks };
};
