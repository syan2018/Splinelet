const assert = require('node:assert/strict');
const { resolve } = require('node:path');

module.exports = async (page, output) => {
  const call = (action, args = {}) =>
    page.evaluate(({ action, args }) => window.traceStudio.call(action, args), {
      action,
      args,
    });
  let state = await call('document.get');
  const run = async (action) => {
    state = await call('authoring.run', {
      expectedRevision: state.revision,
      action,
    });
  };
  await run({ kind: 'create-shape', name: '界面构造' });
  const id = state.lastChange.selectionIntent.activeRef.id;
  for (const radius of [10, 5])
    await run({
      kind: 'draw-path',
      ownerNodeId: id,
      name: `弧 ${radius}`,
      closed: false,
      points: [
        [radius, 0],
        [radius / Math.sqrt(2), radius / Math.sqrt(2)],
      ],
    });
  await call('creation_inspect');
  await call('creation_focus', { objectId: id });
  await page
    .getByRole('button', { name: '当前部件构造与修改器', exact: true })
    .click();
  const add = async (type, configure = async () => {}) => {
    await page.getByRole('button', { name: '添加修改器', exact: true }).click();
    await page.getByLabel('新修改器类型').selectOption(type);
    await configure();
    await page
      .locator('.modifier-add-form')
      .getByRole('button', { name: '添加', exact: true })
      .click();
    await call('creation_inspect');
  };
  await add('curve_mirror', async () => {
    await page
      .getByRole('spinbutton', { name: '镜像轴角度', exact: true })
      .fill('45');
  });
  await add('curve_array');
  let scene = await call('creation_inspect');
  const endpoints = scene.creation.objects.find((object) => object.id === id)
    .modifierAdd.endpoints;
  const find = (label, end, mirror, array) =>
    endpoints.find(
      (option) =>
        option.label.startsWith(label) &&
        option.endpoint.edgeEnd.end === end &&
        option.endpoint.instances.at(-1).index === mirror &&
        option.endpoint.selector.index === array,
    ).endpoint;
  await add('join', async () => {
    const pairs = ['弧 10', '弧 5'].flatMap((label) => [
      [find(label, 'end', 0, 0), find(label, 'end', 1, 0), 'each'],
      [find(label, 'start', 1, 0), find(label, 'start', 0, 1), 'next'],
    ]);
    for (const [index, [a, b, repeat]] of pairs.entries()) {
      await page
        .getByRole('button', { name: '添加端点对应', exact: true })
        .click();
      await page
        .getByLabel(`连接 ${index + 1} a`, { exact: true })
        .selectOption(JSON.stringify(a));
      await page
        .getByLabel(`连接 ${index + 1} b`, { exact: true })
        .selectOption(JSON.stringify(b));
      await page
        .getByLabel(`连接 ${index + 1} a 重复`, { exact: true })
        .selectOption('each');
      await page
        .getByLabel(`连接 ${index + 1} b 重复`, { exact: true })
        .selectOption(repeat);
      const preview = page.locator('svg[aria-label="连接端点预览"]');
      await preview.waitFor({ state: 'visible' });
      assert.match(
        await preview.locator('..').textContent(),
        new RegExp(`连接 ${index + 1} · A 金色 → B 青色`),
      );
      assert.equal(
        await preview.locator('[data-join-highlight="a"]').count(),
        4,
      );
      assert.equal(
        await preview.locator('[data-join-highlight="b"]').count(),
        4,
      );
    }
    const preview = page.locator('svg[aria-label="连接端点预览"]');
    await preview.scrollIntoViewIfNeeded();
    await preview.screenshot({
      path: resolve(output, 'join-endpoint-preview.png'),
    });
  });
  await add('fill');
  scene = await call('creation_inspect');
  assert.deepEqual(scene.errors, []);
  assert.equal(
    scene.cells.find((cell) => cell.objectId === id).geometry.coordinates
      .length,
    2,
  );
  const current = await call('document.get');
  assert.deepEqual(
    Object.values(
      current.document.programs[current.document.nodes[id].programId].operators,
    ).map((operator) => operator.type),
    ['source', 'curve-mirror', 'curve-array', 'join', 'fill'],
  );
  await page.screenshot({ path: resolve(output, 'join-fill-controls.png') });

  await page.getByRole('button', { name: '编为场景组', exact: true }).click();
  await call('creation_inspect');
  let selected = await call('selection.get');
  const inner = selected.selection.refs[0].id;
  assert.notEqual(inner, id);
  await page.getByRole('button', { name: '编为场景组', exact: true }).click();
  await call('creation_inspect');
  selected = await call('selection.get');
  const outer = selected.selection.refs[0].id;
  assert.notEqual(outer, inner);
  assert.equal(
    (await call('document.get')).document.nodes[inner].parentId,
    outer,
  );
  const outerRow = page.locator(`[data-tree-object="${outer}"]`);
  await outerRow
    .getByRole('button', { name: '展开对象组', exact: true })
    .click();
  const innerRow = page.locator(`[data-tree-object="${inner}"]`);
  await innerRow
    .getByRole('button', { name: '展开对象组', exact: true })
    .click();
  await outerRow
    .getByRole('button', { name: '隐藏对象组', exact: true })
    .click();
  await call('creation_inspect');
  assert.equal(
    (await call('creation_inspect')).creation.objects.find(
      (object) => object.id === id,
    ).visible,
    false,
  );
  await outerRow
    .getByRole('button', { name: '显示对象组', exact: true })
    .click();
  await call('creation_inspect');
  await outerRow
    .getByRole('button', { name: '锁定对象组', exact: true })
    .click();
  await call('creation_inspect');
  assert.equal(
    (await call('creation_inspect')).creation.objects.find(
      (object) => object.id === id,
    ).locked,
    true,
  );
  await outerRow
    .getByRole('button', { name: '解锁对象组', exact: true })
    .click();
  await call('creation_inspect');
  await call('creation_focus', { objectId: outer });
  await page.getByRole('button', { name: '移动对象 (H)', exact: true }).click();
  await call('creation_inspect');
  const before = (await call('document.get')).document;
  const sourceId = (await call('creation_inspect')).creation.objects.find(
    (object) => object.id === id,
  ).pathIds[0];
  await page
    .getByRole('button', { name: '定位选中内容 (F)', exact: true })
    .click();
  const source = page.locator(`[data-source-id="${sourceId}"]`).first();
  const point = await source.evaluate((element) => {
    const curve = element.matches('path')
      ? element
      : element.querySelector('path');
    const p = curve.getPointAtLength(curve.getTotalLength() / 2);
    const v = new DOMPoint(p.x, p.y).matrixTransform(curve.getScreenCTM());
    return { x: v.x, y: v.y };
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 16, point.y + 12, { steps: 4 });
  await page.mouse.up();
  await call('creation_inspect');
  const moved = await call('document.get');
  assert.deepEqual(moved.document.sketches, before.sketches);
  assert.notDeepEqual(
    moved.document.nodes[outer].pose,
    before.nodes[outer].pose,
  );
  assert.deepEqual(moved.document.nodes[id].pose, before.nodes[id].pose);
  await call('undo', { expectedRevision: moved.revision });
  await call('creation_inspect');
  assert.deepEqual((await call('document.get')).document, before);
  const beforeReparentMove = await call('document.get');
  await call('authoring.run', {
    expectedRevision: beforeReparentMove.revision,
    action: { kind: 'move-nodes', nodeIds: [inner], deltaMM: [3, -2] },
  });
  await call('creation_inspect');
  const reparentBaseline = (await call('document.get')).document;
  const world = () =>
    page.evaluate(async (nodeId) => {
      const { worldMatrix } = await import('/src/lib/scene/transforms.mjs');
      return worldMatrix(
        (await window.traceStudio.call('document.get')).document,
        nodeId,
      );
    }, id);
  const worldBeforeReparent = await world();
  await page.locator(`[data-tree-object="${id}"]`).dragTo(outerRow);
  await call('creation_inspect');
  const reparented = await call('document.get');
  assert.equal(reparented.document.nodes[id].parentId, outer);
  assert.deepEqual(reparented.document.sketches, reparentBaseline.sketches);
  assert.deepEqual(await world(), worldBeforeReparent);
  await call('undo', { expectedRevision: reparented.revision });
  assert.deepEqual((await call('document.get')).document, reparentBaseline);
  await call('undo', {
    expectedRevision: (await call('document.get')).revision,
  });
  await call('creation_inspect');
  assert.deepEqual((await call('document.get')).document, before);
  await call('creation_focus', { objectId: outer });
  await page.screenshot({ path: resolve(output, 'scene-groups.png') });
  await page.getByRole('button', { name: '解散场景组', exact: true }).click();
  await call('creation_inspect');
  assert.equal((await call('document.get')).document.nodes[outer], undefined);
  console.log(
    'PASS original UI Join/Fill creation, nested scene groups, inherited state, group drag, keepWorld reparent and undo',
  );
};
