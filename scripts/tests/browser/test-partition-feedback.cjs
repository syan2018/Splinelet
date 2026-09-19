// Isolated browser only. Includes malformed geometry on purpose.
module.exports = async (page) => {
  const assert = require('node:assert/strict');
  const checks = [];
  const call = (action, args = {}) =>
    page.evaluate(({ action, args }) => window.traceStudio.call(action, args), {
      action,
      args,
    });
  const settle = async () => {
    await page.waitForFunction(
      async () => !(await window.traceStudio.call('state')).busy,
    );
    await page.locator('.creation-updating').waitFor({ state: 'hidden' });
    await page
      .getByText('正在检查分区，完成后应用…', { exact: true })
      .waitFor({ state: 'hidden' });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  };
  const path = (id, points, closed) => {
    const anchors = points.map(([x, y]) => ({ x, y }));
    return {
      id,
      name: id,
      start: anchors[0],
      anchors,
      closed,
      visible: true,
      quality: 1,
      color: '#b8ef62',
      fitting: 'single',
      curves: anchors.slice(1).map((p, i) => [anchors[i], anchors[i], p, p]),
    };
  };
  const fixture = {
    ...(await call('get_project')),
    version: 3,
    imageName: 'partition-feedback-fixture',
    width: 1000,
    height: 1000,
    widthMM: 100,
    depthMM: 2,
    groups: [],
    paths: [
      path(
        '边界',
        [
          [100, 100],
          [900, 100],
          [900, 900],
          [100, 900],
          [100, 100],
        ],
        true,
      ),
      path(
        '分割',
        [
          [500, 100],
          [500, 900],
        ],
        false,
      ),
      path(
        '自交测试线',
        [
          [200, 200],
          [400, 400],
          [200, 400],
          [400, 200],
          [200, 200],
        ],
        true,
      ),
    ],
    model: {
      version: 1,
      toleranceMM: 0.015,
      regions: [],
      features: [],
      parts: [{ id: 'main', name: '测试零件' }],
    },
    creation: {
      version: 1,
      swatches: [{ id: 'brown', name: '棕色', color: '#a59883' }],
      objects: [
        {
          id: 'part',
          name: '测试部件',
          pathIds: ['边界', '分割', '自交测试线'],
          roles: { 边界: 'boundary', 分割: 'divider', 自交测试线: 'guide' },
          featureIds: [],
          regionIds: [],
          featureSwatches: {},
          swatchId: 'brown',
          heightMM: 2,
          zMM: 0,
          visible: true,
          printable: true,
          paints: [],
        },
      ],
    },
  };
  await call('load_project', { project: fixture });
  await settle();
  const scene = await call('creation_inspect');
  await call('creation_command', {
    action: 'paint',
    args: { objectIds: ['part'], swatchId: 'brown' },
    revision: scene.revision,
  });
  await settle();
  const before = await call('get_project');
  await page.getByRole('button', { name: '平面创作', exact: true }).click();
  await page.getByRole('button', { name: '展开测试部件', exact: true }).click();
  await page.locator('[data-tree-path="自交测试线"]').click();
  await page.getByRole('button', { name: '挖洞', exact: true }).click();
  await settle();
  assert.deepEqual(
    await call('get_project'),
    before,
    'failed role never reaches project/history',
  );
  assert.equal((await call('creation_inspect')).errors.length, 0);
  assert.match(
    await page.locator('.creation-issue').innerText(),
    /这次用途切换未应用/,
  );
  assert.equal(
    await page.locator('.creation-issue details').evaluate((e) => e.open),
    false,
  );
  assert.equal(
    await page.getByRole('button', { name: '查看构造', exact: true }).count(),
    0,
  );
  checks.push(
    'role preflight rejects invalid hole, preserves the entire project, and keeps technical details collapsed',
  );
  await page.getByRole('button', { name: '定位分区线', exact: true }).click();
  assert.equal((await call('state')).tool, 'edit');
  assert.equal((await call('state')).workspace, 'trace');
  checks.push('problem line is located directly in the unified editor');

  const invalid = structuredClone(before);
  invalid.creation.objects[0].roles['自交测试线'] = 'hole';
  await call('load_project', { project: invalid });
  await settle();
  await page.getByRole('button', { name: '选择 (V)', exact: true }).click();
  await page.locator('[data-tree-object="part"]').click();
  const failed = await call('creation_inspect');
  assert(failed.errors.length > 0);
  assert.equal(
    failed.cells.filter((c) => c.fallback).length,
    2,
    'saved colour footprints remain visible on a failed initial load',
  );
  assert(await page.getByLabel('所选区域的项目色').isDisabled());
  await assert.rejects(
    () =>
      call('creation_command', {
        action: 'paint',
        args: { objectIds: ['part'], color: '#ff0000' },
        revision: failed.revision,
      }),
    /分区/,
  );
  await assert.rejects(
    () => call('creation_export', { format: 'check' }),
    /分区|处理|自交/,
  );
  checks.push(
    'failed saved project displays its two previous coloured cells and blocks destructive painting/export',
  );
  await page.getByRole('button', { name: '暂不参与分区', exact: true }).click();
  await settle();
  const restored = await call('creation_inspect');
  assert.equal(restored.errors.length, 0);
  assert.equal(restored.cells.length, 2);
  assert(restored.cells.every((c) => !c.fallback));
  assert.deepEqual((await call('get_project')).paths, before.paths);
  assert.equal((await call('state')).workspace, 'trace');
  checks.push(
    'guide-role recovery restores valid regions without deleting the line or entering advanced construction',
  );
  await page.keyboard.press('Control+z');
  await settle();
  assert.deepEqual(await call('get_project'), invalid);
  checks.push('one undo restores the pre-recovery project');
  return { ok: true, checks };
};
