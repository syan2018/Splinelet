async (page) => {
  const check = (v, m) => {
    if (!v) throw Error(m);
  };
  const call = async (action, args = {}) => {
    const r = await page.evaluate(
      ({ action, args }) => window.traceStudio.call(action, args),
      { action, args },
    );
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve)),
    );
    return r;
  };
  await page.getByRole('tab', { name: '路径', exact: true }).click();
  await page.getByRole('button', { name: '新建分组', exact: true }).waitFor();
  const base = await call('get_project');
  await call('load_project', { project: { ...base, paths: [], groups: [] } });
  const a = await call('create_path', {
    name: 'Group smooth test',
    points: [
      { x: 40, y: 200 },
      { x: 150, y: 240 },
      { x: 280, y: 200 },
    ],
    mode: 'manual',
  });
  const b = await call('create_path', {
    name: 'Other group test',
    points: [
      { x: 60, y: 310 },
      { x: 260, y: 340 },
    ],
    mode: 'manual',
  });
  await call('select_node', { pathId: a.id, nodeIndex: 1 });
  await page
    .getByRole('combobox', { name: '节点连接模式' })
    .selectOption('symmetric');
  let p = (await call('get_project')).paths.find((p) => p.id === a.id);
  check(p.nodeModes[1] === 'symmetric', 'mode selection persists');
  await call('set_point', {
    pathId: a.id,
    curve: 1,
    point: 1,
    position: { x: 190, y: 210 },
  });
  p = (await call('get_project')).paths.find((p) => p.id === a.id);
  check(
    p.curves[0][2].x === 110 && p.curves[0][2].y === 270,
    'opposite handle mirrors',
  );
  await page.getByRole('tab', { name: '路径', exact: true }).click();
  await page.getByRole('button', { name: '新建分组', exact: true }).click();
  await page.getByRole('button', { name: '解散分组 分组 1' }).waitFor();
  const group = (await call('state')).groups[0];
  // Creating a group now assigns the current path selection in one transaction.
  check(
    (await call('get_project')).paths.find((p) => p.id === a.id).groupId ===
      group.id,
    'assign through UI',
  );
  await call('manage_group', {
    action: 'assign',
    id: group.id,
    pathIds: [b.id],
  });
  await page.locator('.group-title').filter({hasText:'分组 1'}).dblclick();
  await page.getByRole('textbox', { name: '重命名分组' }).fill('头发');
  await page.getByRole('textbox', { name: '重命名分组' }).press('Enter');
  await page.getByRole('button', { name: '显示隐藏分组 头发' }).click();
  check(
    (await call('get_project')).paths.every((p) => !p.visible),
    'group visibility toggles all',
  );
  await page.getByRole('button', { name: '显示隐藏分组 头发' }).click();
  await page.getByRole('button', { name: '解散分组 头发' }).click();
  let doc = await call('get_project');
  check(
    doc.paths.length === 2 &&
      doc.groups.length === 0 &&
      doc.paths.every((p) => !p.groupId),
    'dissolve keeps paths',
  );
  await page.keyboard.press('Control+z');
  await page.getByRole('button', { name: '解散分组 头发' }).waitFor();
  check((await call('get_project')).groups.length === 1, 'group undo');
  await call('select_node', { pathId: a.id, nodeIndex: 1 });
  await page.getByRole('tab', { name: '路径', exact: true }).click();
  check(
    !(await page
      .getByRole('button', { name: '重新拟合当前路径…', exact: true })
      .isVisible()),
    'refit hidden in advanced section',
  );
  const before = JSON.stringify((await call('get_project')).paths);
  const request = await call('refit_path', { id: a.id });
  check(request.pendingConfirmation === true, 'API requests UI confirmation');
  await page.getByRole('dialog').waitFor();
  check(
    JSON.stringify((await call('get_project')).paths) === before,
    'opening confirmation does not mutate',
  );
  await page.getByRole('button', { name: '取消，保留现有曲线' }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  check(
    JSON.stringify((await call('get_project')).paths) === before,
    'cancel keeps manual edits',
  );
  await page.getByText('高级操作', { exact: true }).click();
  await page
    .getByRole('button', { name: '重新拟合当前路径…', exact: true })
    .click();
  await page.getByRole('button', { name: '确认替换并重拟合' }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page
    .locator('footer [role=status]')
    .filter({ hasText: '已按原落点重拟合' })
    .waitFor();
  doc = await call('get_project');
  check(
    !doc.paths.find((p) => p.id === a.id).nodeModes,
    'confirmed refit resets modes',
  );
  check(
    JSON.stringify(doc.paths.find((p) => p.id === b.id)) ===
      JSON.stringify(JSON.parse(before).find((p) => p.id === b.id)),
    'other path untouched',
  );
  await page.keyboard.press('Control+z');
  check(
    JSON.stringify((await call('get_project')).paths) === before,
    'refit undo restores geometry and modes',
  );
  console.log(
    'PASS: continuity UI/API, group create/assign/rename/visibility/dissolve/undo, advanced hidden by default, API confirmation, cancel, confirmed refit and full undo.',
  );
}
