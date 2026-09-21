const assert = require('node:assert/strict');
const { resolve } = require('node:path');

module.exports = async (page, outputDirectory) => {
  const call = (action, args = {}) =>
    page.evaluate(({ action, args }) => window.traceStudio.call(action, args), {
      action,
      args,
    });
  const run = async (action) => {
    const state = await call('document.get');
    return call('authoring.run', {
      expectedRevision: state.revision,
      action,
    });
  };
  const selectedIds = async () =>
    (await call('selection.get')).selection.refs.map((ref) => ref.id);
  const row = (id) => page.locator(`[data-tree-object="${id}"]`);
  const expand = async (id) => {
    const item = row(id);
    if ((await item.getAttribute('aria-expanded')) === 'false')
      await item.getByRole('button').first().click();
  };
  const select = async (id, add = false) => {
    await row(id).click(add ? { modifiers: ['Control'] } : {});
    await page.waitForFunction(
      async (selectedId) =>
        (await window.traceStudio.call('selection.get')).selection.refs.some(
          (ref) => ref.id === selectedId,
        ),
      id,
    );
  };
  const selectedGroup = async () => {
    const refs = (await call('selection.get')).selection.refs;
    assert.equal(refs.length, 1, 'grouping should leave one selected group');
    return refs[0].id;
  };

  await page.locator('.creation-sidebar').waitFor();
  const a = (await run({ kind: 'create-shape', name: '组选区 A' })).lastChange
    .selectionIntent.activeRef.id;
  const b = (await run({ kind: 'create-shape', name: '组选区 B' })).lastChange
    .selectionIntent.activeRef.id;
  await row(a).waitFor();
  await row(b).waitFor();

  await select(a);
  await page.getByRole('button', { name: '编为场景组', exact: true }).click();
  const inner = await selectedGroup();
  await row(inner).waitFor();
  await page.getByRole('button', { name: '编为场景组', exact: true }).click();
  const outer = await selectedGroup();
  await row(outer).waitFor();
  await expand(outer);
  await expand(inner);

  await select(outer);
  await select(b, true);
  const mixed = page
    .getByRole('heading', { name: '场景组选区', exact: true })
    .locator('..');
  await mixed.waitFor();
  assert.match(
    await mixed.textContent(),
    /已选 1 个场景组、1 个部件。/,
    'mixed group and Shape selection must retain both counts',
  );
  await page
    .getByRole('button', { name: '解散选中的 1 个根场景组', exact: true })
    .click();
  await page.waitForFunction(
    async (id) =>
      !(await window.traceStudio.call('document.get')).document.nodes[id],
    outer,
  );
  assert.deepEqual(
    await selectedIds(),
    [b],
    'ungroup must remove the deleted Group from a mixed selection and preserve the Shape',
  );

  await select(inner);
  await page.getByRole('button', { name: '编为场景组', exact: true }).click();
  const ancestor = await selectedGroup();
  await row(ancestor).waitFor();
  await expand(ancestor);
  await select(ancestor);
  await select(inner, true);
  assert.match(
    await mixed.textContent(),
    /已选 2 个场景组。[\s\S]*解组按 1 个根场景组执行。/,
    'ancestor and descendant groups must expose the raw count and root action count',
  );
  await page
    .getByRole('button', { name: '解散选中的 1 个根场景组', exact: true })
    .click();
  await page.waitForFunction(
    async (id) =>
      !(await window.traceStudio.call('document.get')).document.nodes[id],
    ancestor,
  );
  assert.deepEqual(
    await selectedIds(),
    [inner],
    'ungrouping a selected ancestor must retain its separately selected inner group',
  );

  await select(b);
  await page.getByRole('button', { name: '编为场景组', exact: true }).click();
  const other = await selectedGroup();
  await row(other).waitFor();
  await select(inner);
  await select(other, true);
  assert.match(await mixed.textContent(), /已选 2 个场景组。/);
  await page
    .getByRole('button', { name: '解散选中的 2 个根场景组', exact: true })
    .click();
  await page.waitForFunction(
    async (ids) => {
      const document = (await window.traceStudio.call('document.get')).document;
      return ids.every((id) => !document.nodes[id]);
    },
    [inner, other],
  );
  assert.deepEqual(await selectedIds(), []);
  await page.screenshot({
    path: resolve(outputDirectory, 'scene-group-selection.png'),
    fullPage: true,
  });
  return {
    checked: [
      'mixed group and Shape selection count and ungroup projection',
      'ancestor and descendant root-group deduplication',
      'multiple independent groups batch ungroup',
    ],
  };
};
