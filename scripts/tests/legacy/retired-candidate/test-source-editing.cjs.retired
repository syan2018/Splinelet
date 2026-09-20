'use strict';

const assert = require('node:assert/strict');

const editorState = (page) =>
  page.evaluate(() => window.traceStudioV4.call('document.get'));

const selectionState = (page) =>
  page.evaluate(() => window.traceStudioV4.call('selection.get'));

const pointFor = (state, sketchId, vertexId) =>
  state.document.sketches[sketchId].vertices[vertexId].position.value;

module.exports = async (page) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.traceStudioV4?.call));

  const canvas = page.getByLabel('建模画布');
  const box = await canvas.boundingBox();
  assert(box, 'canvas must have a visible bounding box');
  const at = (x, y) => ({ x: box.x + x, y: box.y + y });
  const drawAnchor = async (x, y, dx, dy) => {
    await page.mouse.move(at(x, y).x, at(x, y).y);
    await page.mouse.down();
    await page.mouse.move(at(x + dx, y + dy).x, at(x + dx, y + dy).y, {
      steps: 4,
    });
    await page.mouse.up();
  };

  await drawAnchor(140, 120, 35, 0);
  await drawAnchor(360, 120, 0, 35);
  await drawAnchor(360, 320, -35, 0);
  await drawAnchor(140, 320, 0, -35);
  await page.mouse.click(at(140, 120).x, at(140, 120).y);
  await page.locator('[data-candidate="0"]').waitFor();

  const drawn = await editorState(page);
  const sketches = Object.values(drawn.document.sketches);
  assert.equal(sketches.length, 1, 'pen drawing must create one raw Sketch');
  const sketch = sketches[0];
  const edges = Object.values(sketch.edges);
  assert.equal(edges.length, 4, 'closed pen drawing must preserve four cubics');
  assert(
    edges.every(
      (edge) =>
        Math.hypot(...edge.startHandle.vector) > 0 &&
        Math.hypot(...edge.endHandle.vector) > 0,
    ),
    'pointer drags must persist non-zero exact cubic controls',
  );
  assert.match(
    await page.locator('[data-curve="0"]').getAttribute('d'),
    / C /,
    'evaluated curve must remain cubic',
  );

  await page
    .getByLabel('部件', { exact: true })
    .getByRole('button', { name: '部件', exact: true })
    .click();
  await page.getByRole('button', { name: '编辑线条', exact: true }).click();
  const vertex = page.locator('[data-edit-kind="vertex"]').first();
  await vertex.waitFor();
  const vertexBox = await vertex.boundingBox();
  assert(vertexBox, 'anchor mode must expose source vertices');
  const vertexId = await vertex.getAttribute('data-vertex-id');
  const sketchId = await vertex.getAttribute('data-sketch-id');
  assert(vertexId && sketchId, 'source vertex must carry stable IDs');
  const original = pointFor(await editorState(page), sketchId, vertexId);

  const vertexCenter = {
    x: vertexBox.x + vertexBox.width / 2,
    y: vertexBox.y + vertexBox.height / 2,
  };
  await page.mouse.move(vertexCenter.x, vertexCenter.y);
  await page.mouse.down();
  await page.mouse.move(vertexCenter.x + 42, vertexCenter.y + 18, {
    steps: 4,
  });
  await page.waitForFunction(async () => {
    const state = await window.traceStudioV4.call('document.get');
    return state.previewId !== null;
  });
  const duringCancel = await editorState(page);
  assert.notDeepEqual(
    duringCancel.preview.document.sketches[sketchId].vertices[vertexId].position
      .value,
    original,
    'drag must update the preview document before commit',
  );
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForFunction(async () => {
    const state = await window.traceStudioV4.call('document.get');
    return state.previewId === null;
  });
  assert.deepEqual(
    pointFor(await editorState(page), sketchId, vertexId),
    original,
    'Escape must cancel the whole anchor gesture',
  );

  const restoredVertexBox = await vertex.boundingBox();
  const restoredCenter = {
    x: restoredVertexBox.x + restoredVertexBox.width / 2,
    y: restoredVertexBox.y + restoredVertexBox.height / 2,
  };
  const beforeCommit = await editorState(page);
  await page.mouse.move(restoredCenter.x, restoredCenter.y);
  await page.mouse.down();
  await page.mouse.move(restoredCenter.x + 46, restoredCenter.y + 22, {
    steps: 5,
  });
  await page.mouse.up();
  await page.waitForFunction(async (revision) => {
    const state = await window.traceStudioV4.call('document.get');
    return state.previewId === null && state.revision === revision + 1;
  }, beforeCommit.revision);
  const committed = await editorState(page);
  const moved = pointFor(committed, sketchId, vertexId);
  assert.notDeepEqual(
    moved,
    original,
    'pointer-up must commit the local vertex',
  );

  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.waitForFunction(
    async ({
      sketchId: expectedSketch,
      vertexId: expectedVertex,
      original,
    }) => {
      const state = await window.traceStudioV4.call('document.get');
      const value =
        state.document.sketches[expectedSketch].vertices[expectedVertex]
          .position.value;
      return value[0] === original[0] && value[1] === original[1];
    },
    { sketchId, vertexId, original },
  );
  assert.deepEqual(
    pointFor(await editorState(page), sketchId, vertexId),
    original,
    'one undo must restore the entire drag',
  );
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await page.waitForFunction(
    async ({ sketchId: expectedSketch, vertexId: expectedVertex, moved }) => {
      const state = await window.traceStudioV4.call('document.get');
      const value =
        state.document.sketches[expectedSketch].vertices[expectedVertex]
          .position.value;
      return value[0] === moved[0] && value[1] === moved[1];
    },
    { sketchId, vertexId, moved },
  );

  await page.locator('[data-curve]').first().waitFor();
  await page.waitForFunction(
    () => !document.querySelector('footer')?.textContent?.includes('正在更新'),
  );
  await canvas.press('f');
  const svg = canvas.locator('svg');
  const fittedViewBox = await svg.getAttribute('viewBox');
  await page.mouse.move(
    at(box.width / 2, box.height / 2).x,
    at(box.width / 2, box.height / 2).y,
  );
  await page.mouse.wheel(0, -420);
  await page.waitForFunction(
    (value) =>
      document
        .querySelector('[aria-label="建模画布"] svg')
        ?.getAttribute('viewBox') !== value,
    fittedViewBox,
  );
  assert.notEqual(await svg.getAttribute('viewBox'), fittedViewBox);
  await canvas.press('f');
  assert.equal(
    await svg.getAttribute('viewBox'),
    fittedViewBox,
    'F must restore evaluated world bounds after wheel zoom',
  );

  assert((await selectionState(page)).selection.activeRef);
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await canvas.click({ position: { x: 6, y: 6 } });
  await page.waitForFunction(async () => {
    const state = await window.traceStudioV4.call('selection.get');
    return state.selection.activeRef === null;
  });
  assert.deepEqual((await selectionState(page)).selection.entityRefs, []);

  const beforeSave = await editorState(page);
  const sourceOperators = Object.values(beforeSave.document.programs).flatMap(
    (program) =>
      Object.values(program.operators).filter((item) => item.type === 'source'),
  );
  assert(
    sourceOperators.some((source) =>
      source.inputs.paths.some(
        (input) => input.sketchId === sketchId && input.pathIds?.length,
      ),
    ),
    'the Program must still reference the editable source Sketch',
  );
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const artifact = await download;
  assert.equal(await artifact.failure(), null);
  const afterSave = await editorState(page);
  assert.deepEqual(
    afterSave.document.sketches,
    beforeSave.document.sketches,
    'saving must preserve source vertices and cubic handles',
  );
  assert.deepEqual(afterSave.document.programs, beforeSave.document.programs);
  assert.deepEqual(errors, []);

  return {
    passed: true,
    checks: [
      'real pen drags persist exact cubic controls',
      'source vertex preview cancel and one-step undo',
      'wheel zoom and evaluated-bounds fit',
      'blank-canvas selection clearing',
      'save preserves raw Sketch and Source operator definitions',
    ],
  };
};
