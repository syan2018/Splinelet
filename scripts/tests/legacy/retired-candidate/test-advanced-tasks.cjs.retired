'use strict';

const assert = require('node:assert/strict');

const editorState = (page) =>
  page.evaluate(() => window.traceStudioV4.call('document.get'));

const selectionState = (page) =>
  page.evaluate(() => window.traceStudioV4.call('selection.get'));

const author = async (page, action) => {
  const before = await editorState(page);
  return page.evaluate(
    ({ expectedRevision, action: request }) =>
      window.traceStudioV4.call('authoring.run', {
        expectedRevision,
        action: request,
      }),
    { expectedRevision: before.revision, action },
  );
};

const nodeWithName = (state, name) =>
  Object.values(state.document.nodes).find((node) => node.name === name);

const referenceOperators = (state) =>
  Object.values(state.document.programs).flatMap((program) =>
    Object.values(program.operators)
      .filter((operator) =>
        ['curve-reference', 'region-reference'].includes(operator.type),
      )
      .map((operator) => ({ program, operator })),
  );

const detailsFor = (page, name) => {
  const summary = page.locator('summary').filter({ hasText: name });
  return { summary, details: summary.locator('..') };
};

const buildFixtures = async (page) => {
  await author(page, {
    kind: 'draw-path',
    name: '基础甲',
    closed: true,
    points: [
      [-80, -20],
      [-55, -20],
      [-55, 5],
      [-80, 5],
    ],
  });
  await author(page, {
    kind: 'draw-path',
    name: '基础乙',
    closed: true,
    points: [
      [-45, -20],
      [-20, -20],
      [-20, 5],
      [-45, 5],
    ],
  });
};

const exerciseGrouping = async (page) => {
  const tree = page.getByLabel('部件', { exact: true });
  const first = tree.getByRole('button', { name: '基础甲', exact: true });
  const second = tree.getByRole('button', { name: '基础乙', exact: true });
  await first.click();
  await second.click({ modifiers: ['Shift'] });
  assert.equal(await first.getAttribute('aria-pressed'), 'true');
  assert.equal(await second.getAttribute('aria-pressed'), 'true');

  await tree.getByRole('button', { name: '编组', exact: true }).click();
  await page.waitForFunction(async () => {
    const state = await window.traceStudioV4.call('document.get');
    return Object.values(state.document.nodes).some(
      (node) => node.kind === 'group',
    );
  });
  const grouped = await editorState(page);
  const group = Object.values(grouped.document.nodes).find(
    (node) => node.kind === 'group',
  );
  assert(group, 'Shift-selected Shapes must create one Group');
  const children = Object.values(grouped.document.nodes).filter(
    (node) => node.parentId === group.id,
  );
  assert.deepEqual(
    children.map((node) => node.name).sort((a, b) => a.localeCompare(b)),
    ['基础甲', '基础乙'],
  );

  const groupButton = tree.locator(`[data-node-id="${group.id}"]`);
  await groupButton.click();
  await page.getByRole('button', { name: '移动', exact: true }).click();
  const beforeMove = await editorState(page);
  const canvas = page.getByLabel('建模画布');
  const box = await canvas.boundingBox();
  assert(box, 'canvas must be visible for Group movement');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 56,
    box.y + box.height / 2 - 28,
    {
      steps: 5,
    },
  );
  await page.mouse.up();
  await page.waitForFunction(async (revision) => {
    const state = await window.traceStudioV4.call('document.get');
    return state.previewId === null && state.revision === revision + 1;
  }, beforeMove.revision);
  const moved = await editorState(page);
  assert.notDeepEqual(
    moved.document.nodes[group.id].pose.translationMM,
    beforeMove.document.nodes[group.id].pose.translationMM,
    'canvas drag must move the selected Group',
  );

  await tree.getByRole('button', { name: '解组', exact: true }).click();
  await page.waitForFunction(async (groupId) => {
    const state = await window.traceStudioV4.call('document.get');
    return !state.document.nodes[groupId];
  }, group.id);
  const ungrouped = await editorState(page);
  for (const child of children) {
    assert.equal(ungrouped.document.nodes[child.id].parentId, null);
    assert.notDeepEqual(
      ungrouped.document.nodes[child.id].pose.translationMM,
      grouped.document.nodes[child.id].pose.translationMM,
      'ungrouping must retain the moved world placement on each Shape',
    );
  }
};

const exerciseRepeatPattern = async (page) => {
  await author(page, {
    kind: 'draw-path',
    name: '开放线纹样',
    closed: false,
    points: [
      [20, 0],
      [0, 20],
    ],
  });
  const drawn = await editorState(page);
  const shape = nodeWithName(drawn, '开放线纹样');
  assert(shape && shape.kind === 'shape');

  const tree = page.getByLabel('部件', { exact: true });
  await tree.getByRole('button', { name: '开放线纹样', exact: true }).click();
  const repeat = detailsFor(page, '重复纹样');
  await repeat.summary.click();
  await repeat.details.getByLabel('中心 X', { exact: true }).fill('0');
  await repeat.details.getByLabel('中心 Y', { exact: true }).fill('0');
  await repeat.details.getByLabel('数量', { exact: true }).fill('4');
  await repeat.details.getByLabel('步进角', { exact: true }).fill('90');
  const endpoints = repeat.details.getByLabel('路径端点', { exact: true });
  assert.equal(await endpoints.count(), 2);
  await endpoints.nth(0).selectOption({ label: '开放线纹样 · 尾端' });
  await endpoints.nth(1).selectOption({ label: '开放线纹样 · 首端' });
  const beforeRepeat = await editorState(page);
  await repeat.details
    .getByRole('button', { name: '创建重复纹样', exact: true })
    .click();
  await page.waitForFunction(
    async ({ ownerNodeId, revision }) => {
      const state = await window.traceStudioV4.call('document.get');
      const node = state.document.nodes[ownerNodeId];
      if (!node || state.revision !== revision + 1) return false;
      const operators = Object.values(
        state.document.programs[node.programId].operators,
      );
      return ['curve-array', 'join', 'fill'].every((type) =>
        operators.some((operator) => operator.type === type),
      );
    },
    { ownerNodeId: shape.id, revision: beforeRepeat.revision },
  );
  await page.waitForFunction(
    () => document.querySelectorAll('[data-candidate]').length === 3,
  );
  const repeated = await editorState(page);
  const program = repeated.document.programs[shape.programId];
  const array = Object.values(program.operators).find(
    (operator) => operator.type === 'curve-array',
  );
  assert.equal(array.params.count, 4);
  assert.equal(array.params.angleRad, Math.PI / 2);
  const repeatedRegion = page.locator('[data-candidate]').last();
  assert.match(
    await repeatedRegion.getAttribute('d'),
    /Z/,
    'the four open copies must join into a real closed region',
  );

  await page.getByRole('button', { name: '选择', exact: true }).click();
  await repeatedRegion.click();
  await page.waitForFunction(async (ownerNodeId) => {
    const state = await window.traceStudioV4.call('selection.get');
    return state.selection.activeRef?.ownerNodeId === ownerNodeId;
  }, shape.id);
  await page.getByRole('button', { name: '颜色 红色', exact: true }).click();
  await page.waitForFunction(async (ownerNodeId) => {
    const state = await window.traceStudioV4.call('document.get');
    return Object.values(state.document.appearances.overrides).some(
      (assignment) => assignment.target.ownerNodeId === ownerNodeId,
    );
  }, shape.id);
  assert.notEqual(
    await repeatedRegion.getAttribute('fill'),
    'rgba(80,160,255,.18)',
    'the repeated region must be paintable through the ordinary color UI',
  );
  return shape.id;
};

const exerciseReferenceSpaces = async (page, sourceNodeId) => {
  await author(page, {
    kind: 'move-nodes',
    nodeIds: [sourceNodeId],
    deltaMM: [60, 0],
  });
  const canvas = page.getByLabel('建模画布');
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await canvas.click({ position: { x: 6, y: 6 } });
  await page.waitForFunction(async () => {
    const state = await window.traceStudioV4.call('selection.get');
    return state.selection.activeRef === null;
  });

  const reference = detailsFor(page, '引用与切割其他部件');
  await reference.summary.click();
  const task = reference.details.getByLabel('任务', { exact: true });
  const source = reference.details.getByLabel('来源部件', { exact: true });
  await task.selectOption({
    label: '按当前摆放位置引用为新部件',
  });
  await source.selectOption({ label: '开放线纹样' });
  await reference.details
    .getByRole('button', { name: '创建引用部件', exact: true })
    .click();
  await page.waitForFunction(async () => {
    const state = await window.traceStudioV4.call('document.get');
    return Object.values(state.document.programs).some((program) =>
      Object.values(program.operators).some(
        (operator) =>
          ['curve-reference', 'region-reference'].includes(operator.type) &&
          operator.inputs.input[0].space === 'world-result',
      ),
    );
  });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-candidate]').length === 4,
  );
  const placedPath = await page
    .locator('[data-candidate]')
    .last()
    .getAttribute('d');

  await task.selectOption({ label: '引用为可独立摆放的新部件' });
  await source.selectOption({ label: '开放线纹样' });
  await reference.details
    .getByRole('button', { name: '创建引用部件', exact: true })
    .click();
  await page.waitForFunction(async () => {
    const state = await window.traceStudioV4.call('document.get');
    const references = Object.values(state.document.programs).flatMap(
      (program) =>
        Object.values(program.operators).filter((operator) =>
          ['curve-reference', 'region-reference'].includes(operator.type),
        ),
    );
    return references.length === 2;
  });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-candidate]').length === 5,
  );
  const localPath = await page
    .locator('[data-candidate]')
    .last()
    .getAttribute('d');
  assert.notEqual(
    localPath,
    placedPath,
    'world-position and shape-only references must evaluate at different placements',
  );

  const state = await editorState(page);
  const references = referenceOperators(state);
  assert.equal(references.length, 2);
  assert.deepEqual(
    references
      .map(({ operator }) => operator.inputs.input[0].space)
      .sort((a, b) => a.localeCompare(b)),
    ['local-result', 'world-result'],
  );
  for (const { program, operator } of references) {
    assert.equal(operator.inputs.input[0].ownerNodeId, sourceNodeId);
    assert(
      !Object.values(state.document.sketches).some(
        (sketch) => sketch.ownerNodeId === program.ownerNodeId,
      ),
      'a reference Shape must not require a copied source Sketch',
    );
  }
};

module.exports = async (page) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.traceStudioV4?.call));

  await buildFixtures(page);
  await exerciseGrouping(page);
  const patternShapeId = await exerciseRepeatPattern(page);
  await exerciseReferenceSpaces(page, patternShapeId);

  assert.deepEqual(errors, []);
  assert((await selectionState(page)).selection.activeRef);
  return {
    passed: true,
    checks: [
      'Shift selection groups, moves and ungroups multiple Shapes through the UI',
      'repeat task joins four open-line copies into a paintable region',
      'reference task creates source-less local-result and world-result Shapes',
    ],
  };
};
