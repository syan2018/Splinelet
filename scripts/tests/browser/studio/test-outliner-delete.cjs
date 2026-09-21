const assert = require('node:assert/strict');

module.exports = async (page) => {
  const call = (action, args = {}) =>
    page.evaluate(({ action, args }) => window.traceStudio.call(action, args), {
      action,
      args,
    });
  const state = () => call('document.get');
  const run = async (action) =>
    call('authoring.run', {
      expectedRevision: (await state()).revision,
      action,
    });
  const row = (id) => page.locator(`[data-tree-object="${id}"]`);
  const select = async (id, add = false) => {
    await row(id).click(add ? { modifiers: ['Control'] } : {});
  };
  const undo = async () => {
    await page.keyboard.press('Control+z');
  };
  await page.locator('.creation-tree').waitFor();
  const a = (await run({ kind: 'create-shape', name: '删除测试 A' })).lastChange
    .selectionIntent.activeRef.id;
  const b = (await run({ kind: 'create-shape', name: '删除测试 B' })).lastChange
    .selectionIntent.activeRef.id;
  await select(a);
  await select(b, true);
  const before = (await state()).document;
  await page.keyboard.press('Delete');
  await row(a).waitFor({ state: 'detached' });
  await row(b).waitFor({ state: 'detached' });
  await undo();
  await row(a).waitFor();
  assert.deepEqual(
    (await state()).document,
    before,
    'one undo restores both objects',
  );
  await page.keyboard.press('Control+Shift+z');
  await row(a).waitFor({ state: 'detached' });
  await undo();
  await row(a).waitFor();

  await select(a);
  await page.getByRole('button', { name: '编为场景组', exact: true }).click();
  const group = (await call('selection.get')).selection.refs[0].id;
  await select(group);
  await page.keyboard.press('Backspace');
  await row(group).waitFor({ state: 'detached' });
  assert.equal(
    (await state()).document.nodes[a],
    undefined,
    'group deletion includes descendants',
  );
  assert.ok((await state()).document.nodes[b], 'unselected sibling survives');
  await undo();
  await row(group).waitFor();

  await run({ kind: 'set-node', nodeId: b, value: { locked: true } });
  await select(group);
  await select(b, true);
  const locked = (await state()).document;
  await page.keyboard.press('Delete');
  await page.getByText('场景节点已锁定', { exact: true }).first().waitFor();
  assert.deepEqual(
    (await state()).document,
    locked,
    'locked member rejects the whole deletion',
  );

  await run({ kind: 'set-node', nodeId: b, value: { locked: false } });
  await run({
    kind: 'draw-path',
    ownerNodeId: b,
    points: [
      [0, 0],
      [10, 0],
    ],
    closed: false,
  });
  await select(b);
  if ((await row(b).getAttribute('aria-expanded')) === 'false')
    await row(b).getByRole('button').first().click();
  const path = row(b).locator('..').locator('[data-tree-path]').first();
  await path.click();
  const withPath = (await state()).document;
  await page.keyboard.press('Delete');
  await path.waitFor({ state: 'detached' });
  assert.ok(
    (await state()).document.nodes[b],
    'path deletion preserves its owner',
  );
  await undo();
  await path.waitFor();
  assert.deepEqual(
    (await state()).document,
    withPath,
    'undo restores exact source geometry',
  );
};
