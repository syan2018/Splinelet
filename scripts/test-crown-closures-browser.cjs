module.exports = async (page, fixture) => {
  const assert = require('node:assert/strict');
  const call = (action, args = {}) =>
    page.evaluate(({ action, args }) => window.traceStudio.call(action, args), {
      action,
      args,
    });
  const project = () => call('get_project');
  const scene = () => call('creation_inspect');
  const checks = [];
  const check = (condition, name) => {
    assert(condition, name);
    checks.push(name);
  };
  const wait = async (routed, enabled = true) => {
    await page.waitForFunction(
      async ({ routed, enabled }) => {
        try {
          const p = await window.traceStudio.call('get_project');
          if (
            !!p.model?.regions.find((r) => r.id === 'band-60')
              ?.boundaryRegionId !== routed
          )
            return false;
          const s = await window.traceStudio.call('creation_inspect');
          return (
            !s.calculating &&
            s.closures.some(
              (c) =>
                c.featureId === 'body-band-60' &&
                !c.disabled === enabled &&
                !!c.boundaryRegionId === routed,
            ) &&
            s.cells.some((c) => c.featureId === 'body-band-60') === enabled
          );
        } catch {
          return false;
        }
      },
      { routed, enabled },
    );
    await page.locator('.creation-updating').waitFor({ state: 'hidden' });
  };
  await page.locator('input[accept=".json"]').setInputFiles(fixture);
  await wait(false);
  const before = await project(),
    initial = await scene();
  const crown = initial.creation.objects.find((o) => o.name === '头饰');
  await page
    .locator('.creation-object-row .creation-name')
    .getByText('头饰', { exact: true })
    .click();
  await page.getByRole('tab', { name: '线条', exact: true }).click();
  const details = page
    .locator('details')
    .filter({ has: page.getByText('构面封口 · 5 个带状面', { exact: true }) });
  if ((await details.getAttribute('open')) === null)
    await details.locator('summary').click();
  const control = page.getByRole('combobox', {
    name: '封口方式 头饰嵌线 61',
    exact: true,
  });
  const row = page.locator('.creation-closure').filter({ has: control });
  check(
    await control
      .locator('option[value="source-0"]')
      .evaluate((e) => e.disabled),
    'distant outer frame is visibly unavailable',
  );
  await row.getByRole('button', { name: '查看封口', exact: true }).click();
  check(
    (await call('state')).view.s > 2,
    'locate caps zooms to the selected band',
  );
  await control.selectOption('source-8');
  await wait(true);
  let s = await scene();
  check(
    s.errors.length === 0 &&
      s.cells.filter((c) => c.objectId === crown.id).length === 14,
    'contour mode keeps 14 valid independent crown surfaces',
  );
  assert.deepEqual((await project()).paths, before.paths);
  assert.deepEqual((await project()).model.features, before.model.features);
  for (const cell of initial.cells.filter(
    (c) => c.featureId !== 'body-band-60',
  ))
    assert.deepEqual(
      s.cells.find((c) => c.key === cell.key),
      cell,
    );
  check(
    s.closures
      .filter((c) => c.featureId === 'body-band-60')
      .every((c) => c.coordinates.length >= 4),
    'both cap routes update without changing nodes, styles or sibling regions',
  );
  await row.getByRole('button', { name: '查看封口', exact: true }).click();
  check(
    await page
      .locator('[data-construction-connection="body-band-60"]')
      .evaluateAll(
        (es) =>
          es.length === 2 &&
          es.every((e) => getComputedStyle(e).fill === 'none'),
      ),
    'curved cap diagnostics are unfilled lines, with no black wedge over the artwork',
  );
  await control.focus();
  await page.keyboard.press('Control+z');
  await wait(false);
  assert.deepEqual((await scene()).cells, initial.cells);
  check(
    true,
    'Ctrl+Z while the selector is focused restores the entire previous geometry',
  );
  await control.selectOption('source-8');
  await wait(true);
  await row
    .getByRole('button', { name: '取消封口 头饰嵌线 61', exact: true })
    .click();
  await wait(true, false);
  check(
    (await scene()).cells.filter((c) => c.objectId === crown.id).length === 13,
    'disable removes only the selected band',
  );
  await page
    .getByRole('button', { name: '恢复构面 头饰嵌线 61', exact: true })
    .click();
  await wait(true);
  await page
    .getByRole('button', { name: '编辑线条 头饰环5下', exact: true })
    .click();
  await page
    .locator('.creation-role')
    .getByRole('button', { name: '分区', exact: true })
    .click();
  await page
    .getByText(
      '已是带状面的边界 · 区域、颜色和高度保留；封口请在“构面封口”中调整',
      { exact: true },
    )
    .first()
    .waitFor();
  await wait(true);
  s = await scene();
  check(
    s.errors.length === 0 &&
      s.cells.every((c) => !c.conflict) &&
      s.cells.filter((c) => c.objectId === crown.id).length === 14,
    'actual divider toggle retains band identity without colour or height conflicts',
  );
  const saved = await project();
  // Wait for the app's IndexedDB save status before exercising a real reload.
  await page
    .locator('footer')
    .getByText('已保存到此浏览器 · 可绑定工程文件', { exact: true })
    .waitFor();
  await page.reload();
  await page.waitForFunction(() => window.traceStudio);
  await wait(true);
  assert.deepEqual((await project()).model, saved.model);
  assert.deepEqual((await project()).creation, saved.creation);
  check(
    (await scene()).errors.length === 0,
    'browser reload retains the chosen closure recipe and source role',
  );
  return { passed: checks.length, checks };
};
