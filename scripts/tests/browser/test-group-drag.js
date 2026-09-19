async (page) => {
  const call = (action, args = {}) =>
    page.evaluate(({ action, args }) => window.traceStudio.call(action, args), {
      action,
      args,
    });
  const state = await call('state');
  const path = state.paths.find((p) => p.name === 'Group smooth test');
  await call('select_node', { pathId: path.id, nodeIndex: 1 });
  await page.locator('[data-control-handle="1:1"]').waitFor();
  const box = await page
    .locator('[data-control-handle="1:1"] circle')
    .last()
    .boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 30,
    box.y + box.height / 2 + 20,
    { steps: 8 },
  );
  await page.mouse.up();
  await page
    .locator('footer [role=status]')
    .filter({ hasText: '控制点已调整' })
    .waitFor();
  const p = (await call('get_project')).paths.find((p) => p.id === path.id),
    a = p.curves[1][0],
    l = p.curves[0][2],
    r = p.curves[1][1];
  if (Math.hypot(l.x + r.x - 2 * a.x, l.y + r.y - 2 * a.y) > 1e-7)
    throw Error('Dragging broke C1');
  await page
    .locator('.storage-status')
    .filter({ hasText: '已保存到此浏览器' })
    .waitFor();
  const before = await call('get_project');
  await page.reload();
  await page.getByRole('textbox', { name: '分组名称 头发' }).waitFor();
  const after = await call('get_project');
  if (
    JSON.stringify(before.groups) !== JSON.stringify(after.groups) ||
    JSON.stringify(before.paths) !== JSON.stringify(after.paths)
  )
    throw Error('Reload lost groups or modes');
  console.log(
    'PASS: real mouse drag preserves C1; browser autosave and reload preserve groups, geometry, and node modes.',
  );
}
