async (page) => {
  const check = (v, m) => {
    if (!v) throw Error(m);
  };
  const call = async (action, args = {}) => {
    const result = await page.evaluate(
      ({ action, args }) => window.traceStudio.call(action, args),
      { action, args },
    );
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
    return result;
  };
  await page.waitForFunction(() => window.traceStudio);
  const waitModel = async () => {
    for (let i = 0; i < 300; i++) {
      const s = await call('state');
      if (s.model.report?.valid && !s.model.calculating) return s;
    }
    throw Error('model did not finish');
  };
  const base = await call('get_project');
  const path = (id, name, pts, closed = true) => ({
    id,
    name,
    closed,
    visible: true,
    color: '#b8ef62',
    quality: 1,
    start: pts[0],
    anchors: pts,
    curves: pts.slice(0, -1).map((a, i) => [a, a, pts[i + 1], pts[i + 1]]),
  });
  const pts = (a) => a.map(([x, y]) => ({ x, y }));
  const fixture = {
    ...base,
    version: 1,
    model: undefined,
    width: 1200,
    height: 1200,
    widthMM: 120,
    groups: [],
    paths: [
      path(
        'outer',
        '外轮廓',
        pts([
          [100, 100],
          [700, 100],
          [700, 700],
          [100, 700],
          [100, 100],
        ]),
      ),
      path(
        'inner',
        '内轮廓',
        pts([
          [300, 300],
          [500, 300],
          [500, 500],
          [300, 500],
          [300, 300],
        ]),
      ),
      path(
        'cutter',
        '分界线',
        pts([
          [90, 400],
          [699.5, 400],
        ]),
        false,
      ),
    ],
  };
  await call('load_project', { project: fixture });
  await page.getByRole('button', { name: '构面', exact: true }).click();
  await page.getByRole('tab', { name: '构面', exact: true }).click();
  await page.getByLabel('构面操作', { exact: true }).selectOption('path');
  await page
    .locator('.model-source-picker label')
    .filter({ hasText: '外轮廓' })
    .locator('input')
    .check();
  await page.getByRole('button', { name: '预览区域', exact: true }).click();
  await page
    .getByRole('button', { name: '建立所选面 · 1', exact: true })
    .click();
  let doc = await call('get_project');
  check(
    doc.version === 2 && doc.model.regions.length === 1,
    'model version persisted',
  );
  const outer = doc.model.regions[0].id;
  await page.getByRole('tab', { name: '构面', exact: true }).click();
  await page
    .locator('.model-source-picker label')
    .filter({ hasText: '内轮廓' })
    .locator('input')
    .check();
  await page.getByRole('button', { name: '预览区域', exact: true }).click();
  await page
    .getByRole('button', { name: '建立所选面 · 1', exact: true })
    .click();
  doc = await call('get_project');
  const inner = doc.model.regions[1].id;
  await page.getByRole('tab', { name: '构面', exact: true }).click();
  await page.getByLabel('构面操作', { exact: true }).selectOption('difference');
  await page
    .getByRole('combobox', { name: '目标面 A', exact: true })
    .selectOption(outer);
  await page
    .getByRole('combobox', { name: '工具面 B', exact: true })
    .selectOption(inner);
  await page.getByRole('button', { name: '预览区域', exact: true }).click();
  await page
    .getByRole('button', { name: '建立所选面 · 1', exact: true })
    .waitFor();
  let state = await call('state');
  check(state.model.preview.candidates[0].holes === 1, 'hole preview');
  await page
    .getByRole('checkbox', { name: '预览修复自交（仅派生区域）', exact: true })
    .check();
  check(
    !(await call('state')).model.preview,
    'changing options invalidates preview',
  );
  await page.getByRole('button', { name: '预览区域', exact: true }).click();
  await page
    .getByRole('button', { name: '建立所选面 · 1', exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: '建立所选面 · 1', exact: true })
    .click();
  doc = await call('get_project');
  await page.keyboard.press('Control+z');
  check(
    (await call('get_project')).model.regions.length === 2,
    'boolean one undo',
  );
  await page.keyboard.press('Control+Shift+z');
  check((await call('get_project')).model.regions.length === 3, 'boolean redo');
  await call('preview_region', {
    kind: 'split',
    baseId: outer,
    pathIds: ['cutter'],
    joinMM: 0.15,
  });
  state = await call('state');
  check(state.model.preview.candidates.length === 2, 'split returns 2');
  const candidate = page.locator('[data-candidate-index="0"]');
  await candidate.click({ position: { x: 80, y: 80 } });
  await page
    .getByRole('button', { name: '建立所选面 · 1', exact: true })
    .click();
  doc = await call('get_project');
  check(doc.model.regions.length === 4, 'click candidate commits face');
  await call('select_regions', { regionIds: [outer] });
  await page
    .getByRole('button', { name: '添加为凸起体块', exact: true })
    .click();
  state = await waitModel();
  check(state.model.report.components === 1, 'closed solid browser');
  check(Math.abs(state.model.report.volumeMM3 - 7200) < 0.01, 'volume correct');
  doc = await call('get_project');
  const baseFeature = doc.model.features[0].id;
  const child = (
    await call('create_relief', {
      regionIds: [inner],
      attachId: baseFeature,
      heightMM: 1,
    })
  ).featureIds[0];
  let v = await call('validate_part');
  check(Math.abs(v.report.volumeMM3 - 7600) < 0.01, 'attached feature volume');
  await call('set_relief', { id: baseFeature, changes: { heightMM: 3 } });
  v = await call('validate_part');
  check(
    Math.abs(v.report.volumeMM3 - 11200) < 0.01,
    'attachment follows base height',
  );
  await page.getByRole('tab', { name: '制造 / 导出', exact: true }).click();
  await waitModel();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '打印 STL', exact: true }).click();
  const download = await downloadPromise;
  check(download.suggestedFilename().endsWith('.stl'), 'actual STL download');
  const svg = await call('export_model', { format: 'svg' });
  check(svg.content.includes('fill-rule="evenodd"'), 'area SVG holes');
  const blend = await call('export_model', { format: 'blender' });
  check(
    blend.content.includes('mesh.from_pydata') &&
      blend.content.includes("splines.new('BEZIER')"),
    'Blender preserves both',
  );
  await page.evaluate(() => new Promise((r) => setTimeout(r, 1000)));
  await page.reload();
  await page.waitForFunction(() => window.traceStudio);
  for (let i = 0; i < 300; i++) {
    if ((await call('get_project')).model?.features?.length === 2) break;
  }
  doc = await call('get_project');
  check(
    doc.model.features.find((f) => f.id === child).attachId === baseFeature,
    'attachment survives reload',
  );
  check(
    JSON.stringify(doc.paths) === JSON.stringify(fixture.paths),
    'source cubics untouched throughout',
  );
  await call('set_workspace', { mode: 'faces' });
  await call('select_regions', { regionIds: [outer] });
  await page.getByRole('button', { name: '删除所选面', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  check(
    (await call('get_project')).model.regions.length === 4,
    'dependent deletion cancel',
  );
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '删除所选面', exact: true }).click();
  await page.getByRole('button', { name: '删除这些对象', exact: true }).click();
  check(
    (await call('get_project')).model.regions.length === 1,
    'cascade removes downstream faces',
  );
  check(
    (await call('get_project')).model.features.length === 0,
    'cascade removes attached features',
  );
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.keyboard.press('Control+z');
  check(
    (await call('get_project')).model.features.length === 2,
    'cascade undo restores all',
  );
  const separator = page.getByRole('separator', { name: '调整建模侧栏宽度' }),
    sb = await separator.boundingBox(),
    width = await page
      .locator('.model-sidebar')
      .evaluate((e) => e.getBoundingClientRect().width);
  await page.mouse.move(sb.x + 2, sb.y + 100);
  await page.mouse.down();
  await page.mouse.move(sb.x - 38, sb.y + 100, { steps: 4 });
  await page.mouse.up();
  check(
    (await page
      .locator('.model-sidebar')
      .evaluate((e) => e.getBoundingClientRect().width)) >
      width + 30,
    'model sidebar drag',
  );
  await separator.dblclick();
  const surface = page.locator('.model-canvas'),
    box = await surface.boundingBox(),
    transform = await surface.locator('svg>g').getAttribute('transform');
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(box.x + 150, box.y + 130, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up({ button: 'middle' });
  check(
    (await surface.locator('svg>g').getAttribute('transform')) === transform,
    'model pan cancels precisely',
  );
  await page.setViewportSize({ width: 725, height: 868 });
  await page.setViewportSize({ width: 1352, height: 1216 });
  await call('set_workspace', { mode: 'relief' });
  await waitModel();
  return {
    ok: true,
    regions: doc.model.regions.length,
    features: doc.model.features.length,
  };
};
