// Run only in an isolated browser context: this replaces its current project.
module.exports = async (page, options = {}) => {
  const checks = [];
  const check = (value, name) => {
    if (!value) throw Error(name);
    checks.push(name);
  };
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
    await page.locator('.creation-updating').waitFor({ state: 'hidden' });
  };
  const outputDir =
    options.outputDir ||
    require('node:path').resolve(__dirname, '../outputs/creation-qa');
  require('node:fs').mkdirSync(outputDir, { recursive: true });
  const prior = await call('get_project');
  const path = (id, points, closed) => {
    const coords = points.map(([x, y]) => ({ x, y }));
    return {
      id,
      name: id,
      groupId: 'qa-object',
      start: coords[0],
      anchors: coords,
      curves: coords
        .slice(1)
        .map((point, i) => [coords[i], coords[i], point, point]),
      color: '#aadd77',
      visible: true,
      quality: 1,
      closed,
      fitting: 'single',
    };
  };
  await call('load_project', {
    project: {
      version: 1,
      image: prior.image,
      imageName: 'creation-qa',
      width: 1200,
      height: 1200,
      widthMM: 100,
      depthMM: 1,
      groups: [{ id: 'qa-object', name: '测试部件' }],
      paths: [
        path(
          '测试轮廓',
          [
            [250, 250],
            [850, 250],
            [850, 850],
            [250, 850],
            [250, 250],
          ],
          true,
        ),
        path(
          '测试分区线',
          [
            [250, 550],
            [850, 550],
          ],
          false,
        ),
      ],
    },
  });
  await settle();
  let setup = await call('creation_inspect');
  await call('creation_command', {
    action: 'roles',
    args: {
      objectId: setup.creation.objects[0].id,
      pathIds: ['测试分区线'],
      role: 'divider',
    },
  });
  await settle();
  setup = await call('creation_inspect');
  await call('creation_command', {
    action: 'paint',
    revision: setup.revision,
    args: { objectIds: [setup.creation.objects[0].id], swatchId: 'brown' },
  });
  await settle();
  await page.getByRole('button', { name: '平面创作', exact: true }).click();
  const initial = await call('get_project');
  check(
    initial.creation?.objects[0].paints.length === 2,
    'starts with two painted regions',
  );
  const pos = async (x, y) => {
    const s = await call('state'),
      b = await page.locator('.stage').boundingBox();
    return {
      x: b.x + s.view.x + x * s.view.s,
      y: b.y + s.view.y + y * s.view.s,
    };
  };
  await page.getByRole('button', { name: '上色', exact: true }).click();
  await page.getByRole('button', { name: '画笔色：金色', exact: true }).click();
  const a = await pos(500, 400),
    b = await pos(500, 700);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
  await settle();
  check(
    (await call('get_project')).creation.objects[0].paints.every(
      (p) => p.swatchId === 'gold',
    ),
    'swept fill colours both cells',
  );
  await page.keyboard.press('Control+z');
  await settle();
  check(
    JSON.stringify((await call('get_project')).creation.objects[0].paints) ===
      JSON.stringify(initial.creation.objects[0].paints),
    'one undo restores entire paint stroke',
  );
  await page.mouse.click(a.x, a.y);
  await settle();
  await page.getByRole('button', { name: '高低', exact: true }).click();
  const handle = page.getByRole('slider', { name: '拖动区域高度' }),
    box = await handle.boundingBox();
  const before = await call('get_project');
  await page.mouse.move(box.x + 15, box.y + 25);
  await page.mouse.down();
  await page.mouse.move(box.x + 15, box.y - 20, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  check(
    JSON.stringify(await call('get_project')) === JSON.stringify(before),
    'Escape cancels height draft without touching history',
  );
  await page.mouse.move(box.x + 15, box.y + 25);
  await page.mouse.down();
  await page.mouse.move(box.x + 15, box.y - 25, { steps: 5 });
  await page.mouse.up();
  await settle();
  check(
    JSON.stringify((await call('get_project')).creation.objects[0].paints) !==
      JSON.stringify(before.creation.objects[0].paints),
    'height drag commits',
  );
  await page.keyboard.press('Control+z');
  await settle();
  check(
    JSON.stringify(await call('get_project')) === JSON.stringify(before),
    'height drag is one undo',
  );
  await page.getByRole('button', { name: '立体预览', exact: true }).click();
  await page.locator('.creation-webgl canvas').waitFor();
  check(
    (await call('state')).creation.selectedCells.length === 1,
    '3D keeps local selection',
  );
  await page.getByRole('button', { name: '正视', exact: true }).click();
  await page.getByRole('button', { name: '侧视', exact: true }).click();
  await page.getByRole('button', { name: '立体', exact: true }).click();
  await page.getByRole('tab', { name: '制作', exact: true }).click();
  await page.getByRole('button', { name: '预览底板', exact: true }).click();
  await page.getByRole('button', { name: '取消底板', exact: true }).waitFor();
  check(
    (await call('get_project')).creation.objects.length === 1,
    'base preview has not saved anything',
  );
  await page.getByRole('button', { name: '取消底板', exact: true }).click();
  check(
    (await call('get_project')).creation.objects.length === 1,
    'cancel base leaves project intact',
  );
  await page.getByRole('button', { name: '预览底板', exact: true }).click();
  await page
    .getByRole('button', { name: '添加底板并叠放', exact: true })
    .click();
  await settle();
  let doc = await call('get_project');
  check(doc.creation.objects.length === 2, 'base and object stored together');
  check(
    doc.creation.objects.find((o) => o.name === '测试部件').attachId ===
      doc.creation.objects.find((o) => o.name === '底板').id,
    'object attached to base',
  );
  await page
    .getByRole('button', { name: '检查可打印实体', exact: true })
    .click();
  await page.locator('.creation-report').waitFor();
  check(
    (await page.locator('.creation-report').innerText()).includes(
      '实体检查通过',
    ),
    'real manifold passes through UI',
  );
  for (const [label, name] of [
    ['打印 STL', 'creation-qa.stl'],
    ['分色 SVG', 'creation-qa.svg'],
    ['Blender · 实体与源线', 'creation-qa.py'],
  ]) {
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: label, exact: true }).click();
    const download = await event;
    await download.saveAs(require('node:path').join(outputDir, name));
    check(!(await download.failure()), label + ' downloads');
  }
  const saved = await call('get_project');
  await page.waitForFunction(() =>
    document.querySelector('.storage-status')?.textContent.includes('已保存'),
  );
  await page.reload();
  await page.waitForFunction(() => window.traceStudio);
  await settle();
  check(
    JSON.stringify((await call('get_project')).creation) ===
      JSON.stringify(saved.creation),
    'objects, paint and attachments survive reload',
  );
  check(
    JSON.stringify((await call('get_project')).paths) ===
      JSON.stringify(initial.paths),
    'all fill / height / manufacturing steps leave Bezier nodes unchanged',
  );
  return { ok: true, checks };
};
