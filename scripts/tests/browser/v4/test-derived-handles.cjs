'use strict';

const assert = require('node:assert/strict');

const editorState = (page) =>
  page.evaluate(() => window.traceStudioV4.call('document.get'));

const author = async (page, action) => {
  const before = await editorState(page);
  return page.evaluate(
    ({ expectedRevision, request }) =>
      window.traceStudioV4.call('authoring.run', {
        expectedRevision,
        action: request,
      }),
    { expectedRevision: before.revision, request: action },
  );
};

const handleVector = (state, sketchId, edgeId, end) => {
  const edge = state.document.sketches[sketchId].edges[edgeId];
  return edge[end === 'start' ? 'startHandle' : 'endHandle'].vector;
};

const curvePaths = (page) =>
  page
    .locator('[data-curve]')
    .evaluateAll((items) => items.map((item) => item.getAttribute('d')));

const handleForInstance = async (page, index, end) => {
  const handles = page.locator(
    `[data-derived-handle][data-editable="true"][data-end="${end}"]`,
  );
  for (let offset = 0; offset < (await handles.count()); offset++) {
    const handle = handles.nth(offset);
    const instances = JSON.parse(
      (await handle.getAttribute('data-derived-instances')) || '[]',
    );
    if (instances.at(-1)?.index === index) return handle;
  }
  throw Error(`找不到重复实例 ${index} 的 ${end} 控制柄`);
};

module.exports = async (page) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.traceStudioV4?.call));

  await author(page, {
    kind: 'draw-path',
    name: '派生控制柄样例',
    closed: false,
    points: [
      [24, 0],
      [48, 0],
      [58, 25],
    ],
    cubics: [
      [
        [24, 0],
        [31, 16],
        [41, 16],
        [48, 0],
      ],
      [
        [48, 0],
        [53, 5],
        [58, 18],
        [58, 25],
      ],
    ],
  });
  const sourceState = await editorState(page);
  const owner = Object.values(sourceState.document.nodes).find(
    (node) => node.name === '派生控制柄样例',
  );
  assert(owner, 'draw-path must create the source Shape');
  await author(page, {
    kind: 'repeat-curves',
    ownerNodeId: owner.id,
    center: [0, 0],
    angleRad: (Math.PI * 2) / 3,
    count: 3,
    name: '三向重复',
  });

  await page.waitForFunction(
    () => document.querySelectorAll('[data-curve]').length === 3,
  );
  await page.locator(`[data-node-id="${owner.id}"]`).click();
  await page.getByRole('button', { name: '编辑线条', exact: true }).click();
  const canvas = page.getByLabel('建模画布');
  await canvas.press('d');
  await page
    .locator('[data-derived-handle][data-editable="true"]')
    .first()
    .waitFor();
  assert.equal(
    await page.locator('[data-derived-handle]').count(),
    12,
    'two source edges repeated three times must expose both handles per instance',
  );

  let derived = await handleForInstance(page, 1, 'start');
  const sketchId = await derived.getAttribute('data-sketch-id');
  const edgeId = await derived.getAttribute('data-edge-id');
  const end = await derived.getAttribute('data-end');
  assert(
    sketchId && edgeId && end,
    'derived handle must retain its source IDs',
  );
  const originalState = await editorState(page);
  const original = handleVector(originalState, sketchId, edgeId, end);
  const originalCurves = await curvePaths(page);

  let box = await derived.boundingBox();
  assert(box, 'derived handle must be visible');
  let center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 38, center.y + 24, { steps: 5 });
  await page.waitForFunction(async () => {
    const state = await window.traceStudioV4.call('document.get');
    return state.previewId !== null;
  });
  const cancelPreview = await editorState(page);
  assert.notDeepEqual(
    handleVector(cancelPreview.preview, sketchId, edgeId, end),
    original,
    'a real derived-handle drag must update the source handle in preview',
  );
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForFunction(async () => {
    const state = await window.traceStudioV4.call('document.get');
    return state.previewId === null;
  });
  assert.deepEqual(
    handleVector(await editorState(page), sketchId, edgeId, end),
    original,
    'Escape must cancel the source edit behind a derived handle',
  );

  derived = await handleForInstance(page, 1, 'start');
  box = await derived.boundingBox();
  assert(box, 'derived handle must remain visible after cancel');
  center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const beforeCommit = await editorState(page);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 44, center.y + 28, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(async (revision) => {
    const state = await window.traceStudioV4.call('document.get');
    return state.previewId === null && state.revision === revision + 1;
  }, beforeCommit.revision);
  const committed = await editorState(page);
  const moved = handleVector(committed, sketchId, edgeId, end);
  assert.notDeepEqual(
    moved,
    original,
    'pointer-up must commit through set-handle to the source Sketch',
  );
  const movedCurves = await curvePaths(page);
  assert.equal(movedCurves.length, 3);
  movedCurves.forEach((path, index) =>
    assert.notEqual(
      path,
      originalCurves[index],
      `repeat instance ${index} must update from the shared source`,
    ),
  );
  assert.equal(
    Object.keys(committed.document.sketches).length,
    Object.keys(originalState.document.sketches).length,
    'editing a derived handle must not materialize copied geometry',
  );

  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.waitForFunction(
    async ({
      sketchId: expectedSketch,
      edgeId: expectedEdge,
      end,
      original,
    }) => {
      const state = await window.traceStudioV4.call('document.get');
      const edge = state.document.sketches[expectedSketch].edges[expectedEdge];
      const value = edge[end === 'start' ? 'startHandle' : 'endHandle'].vector;
      return value[0] === original[0] && value[1] === original[1];
    },
    { sketchId, edgeId, end, original },
  );
  assert.deepEqual(
    await curvePaths(page),
    originalCurves,
    'one undo must restore every repeated instance',
  );

  const restored = await editorState(page);
  const [continuitySource, continuityTarget] = Object.values(
    restored.document.sketches[sketchId].edges,
  );
  await author(page, {
    kind: 'set-continuity',
    target: {
      kind: 'edge-end',
      sketchId,
      edgeId: continuityTarget.id,
      end: 'start',
    },
    source: {
      kind: 'edge-end',
      sketchId,
      edgeId: continuitySource.id,
      end: 'end',
    },
    mode: 'symmetric',
  });
  await page.waitForFunction(
    ({ sketchId: expectedSketch, edgeId: expectedEdge }) => {
      const item = document.querySelector(
        `[data-derived-handle][data-sketch-id="${expectedSketch}"][data-edge-id="${expectedEdge}"][data-end="start"][data-editable="false"]`,
      );
      return Boolean(item);
    },
    { sketchId, edgeId: continuityTarget.id },
  );
  const related = page
    .locator(
      `[data-derived-handle][data-sketch-id="${sketchId}"][data-edge-id="${continuityTarget.id}"][data-end="start"][data-editable="false"]`,
    )
    .first();
  const beforeReadonly = await editorState(page);
  const relatedBox = await related.boundingBox();
  assert(relatedBox, 'relation-driven derived handle must remain visible');
  await page.mouse.move(
    relatedBox.x + relatedBox.width / 2,
    relatedBox.y + relatedBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    relatedBox.x + relatedBox.width / 2 + 36,
    relatedBox.y + relatedBox.height / 2 + 20,
    { steps: 4 },
  );
  await page.mouse.up();
  assert.equal(
    (await editorState(page)).revision,
    beforeReadonly.revision,
    'a relation-driven source handle must not be bypassed by derived dragging',
  );
  await page.getByText(/源控制柄由关系 .* 驱动/).waitFor();

  assert.deepEqual(errors, []);
  return {
    passed: true,
    checks: [
      'repeat instance handle maps through its inverse transform',
      'Escape cancels the shared source preview',
      'one commit updates every repeated instance without copied geometry',
      'one undo restores the source and every instance',
      'relation-driven derived handles stay read-only with a reason',
    ],
  };
};
