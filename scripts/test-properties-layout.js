async (page) => {
  const check = (v, m) => {
    if (!v) throw Error(m);
  };
  const call = async (action, args = {}) => {
    const v = await page.evaluate(
      ({ action, args }) => window.traceStudio.call(action, args),
      { action, args },
    );
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
    return v;
  };
  await page.getByRole('tab', { name: '路径', exact: true }).click();
  const base = await call('get_project');
  await call('load_project', { project: { ...base, paths: [], groups: [] } });
  const a = await call('create_path', {
    name: 'Drag A',
    mode: 'manual',
    points: [
      { x: 100, y: 180 },
      { x: 220, y: 180 },
      { x: 300, y: 240 },
    ],
  });
  const b = await call('create_path', {
    name: 'Drag B',
    mode: 'manual',
    points: [
      { x: 100, y: 350 },
      { x: 250, y: 380 },
    ],
  });
  const group = await call('manage_group', {
    action: 'create',
    name: '分组测试',
  });
  await page
    .locator('[data-path-id="' + a.id + '"] .path-select')
    .dragTo(page.locator('[data-group-id="' + group.id + '"] > summary'));
  await page
    .locator('[data-group-id="' + group.id + '"] [data-path-id="' + a.id + '"]')
    .waitFor();
  check(
    (await call('get_project')).paths.find((p) => p.id === a.id).groupId ===
      group.id,
    'drop into group',
  );
  await page
    .locator('[data-path-id="' + b.id + '"] .path-select')
    .dragTo(page.locator('[data-path-id="' + a.id + '"]'));
  await page
    .locator('[data-group-id="' + group.id + '"] [data-path-id="' + b.id + '"]')
    .waitFor();
  let doc = await call('get_project');
  check(
    doc.paths[0].id === b.id && doc.paths[1].id === a.id,
    'drop before reorders and adopts group',
  );
  await page
    .locator('[data-group-id="' + group.id + '"] .group-title')
    .dblclick();
  await page.getByRole('textbox', { name: '重命名分组' }).fill('发型');
  await page.getByRole('textbox', { name: '重命名分组' }).press('Enter');
  await page.getByRole('button', { name: '解散分组 发型' }).waitFor();
  check(
    (await call('get_project')).groups[0].name === '发型',
    'double click rename',
  );
  await page.keyboard.press('Control+z');
  check(
    (await call('get_project')).groups[0].name === '分组测试',
    'rename is one undo step',
  );
  await page
    .locator('[data-group-id="' + group.id + '"] .group-title')
    .dblclick();
  await page.getByRole('textbox', { name: '重命名分组' }).fill('取消的名称');
  await page.getByRole('textbox', { name: '重命名分组' }).press('Escape');
  check(
    (await call('get_project')).groups[0].name === '分组测试',
    'Escape cancels rename',
  );
  const header = await page
      .locator('[data-group-id="' + group.id + '"] > summary')
      .boundingBox(),
    controls = await page
      .locator('[data-group-id="' + group.id + '"] .group-controls')
      .boundingBox();
  check(controls.x > header.x + header.width / 2, 'group controls on right');
  const splitter = page.getByRole('separator', { name: '调整右侧栏宽度' }),
    box = await splitter.boundingBox(),
    before = Number(await splitter.getAttribute('aria-valuenow'));
  await page.mouse.move(box.x + box.width / 2, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x - 80, box.y + 150, { steps: 8 });
  await page.mouse.up();
  const width = Number(await splitter.getAttribute('aria-valuenow'));
  check(width > before + 60, 'sidebar grows when divider dragged left');
  await call('select_node', { pathId: a.id, nodeIndex: 1 });
  await page
    .getByRole('tabpanel', { name: '节点属性' })
    .waitFor({ state: 'visible' });
  check(
    (await page
      .getByRole('tab', { name: '节点', exact: true })
      .getAttribute('aria-selected')) === 'true',
    'node click selects node tab',
  );
  const image = await page.locator('svg image').boundingBox();
  await page.mouse.click(image.x + 15, image.y + 15);
  await page.locator('.empty-properties').waitFor();
  check((await call('state')).active === null, 'blank click deselects path');
  await call('select_node', { pathId: a.id, nodeIndex: 1 });
  await page.keyboard.press('Escape');
  check((await call('state')).active === null, 'Escape deselects path');
  await page.getByRole('tab', { name: '工程', exact: true }).click();
  await page
    .getByRole('tabpanel', { name: '工程设置' })
    .waitFor({ state: 'visible' });
  check(
    !(await page.getByRole('tabpanel', { name: '描线参数' }).isVisible()),
    'tabs isolate content',
  );
  await page.getByRole('tab', { name: '路径', exact: true }).click();
  await page.screenshot({
    path: 'C:/Users/Syan/Documents/Codex/2026-09-09/neng/work/properties-layout.png',
  });
  console.log(
    'PASS: native path drag/group/reorder, header controls, double-click rename/undo/cancel, splitter dragging, contextual tabs, blank/Escape deselection.',
  );
}
