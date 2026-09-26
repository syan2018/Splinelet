const assert = require('node:assert/strict');
const { resolve } = require('node:path');

// A 1×1 transparent PNG. Files are supplied through the actual multiple-file
// control, so no fixture image is written to the checkout.
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL2xQAAAABJRU5ErkJggg==',
  'base64',
);

module.exports = async (page, outputDirectory) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  const documentState = () =>
    page.evaluate(() => window.originalStudioDocument());
  const evidence = () => page.evaluate(() => window.originalStudioEvidence());
  const reference = async (id) => (await documentState()).references[id];
  const waitFor = (predicate, argument) =>
    page.waitForFunction(predicate, argument);
  const matrixChanged = (left, right) =>
    left.some((value, index) => Math.abs(value - right[index]) > 1e-7);
  const assertUnchangedCurves = async () => {
    const state = await evidence();
    assert.equal(
      state.sourceUnchanged,
      true,
      'reference edits must not change source curves',
    );
    assert.equal(
      state.programsUnchanged,
      true,
      'reference edits must not change programs',
    );
    assert.equal(
      state.nodePosesUnchanged,
      true,
      'reference edits must not move objects',
    );
  };
  const openSaved = async () => {
    await page.evaluate(() => window.originalStudioChooseFile('current'));
    await page.getByRole('button', { name: 'Splinelet 主菜单' }).click();
    await page
      .getByRole('menuitem', { name: '打开工程…', exact: true })
      .click();
  };
  const drag = async (locator, delta) => {
    const box = await locator.boundingBox();
    assert.ok(box, 'reference handle must be visible');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + delta.x, y + delta.y, { steps: 6 });
    await page.mouse.up();
  };
  const beginDrag = async (locator, delta) => {
    const box = await locator.boundingBox();
    assert.ok(box, 'reference handle must be visible');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + delta.x, y + delta.y, { steps: 4 });
  };

  await page.locator('.creation-sidebar').waitFor();
  const before = await documentState();
  const baseId = Object.keys(before.references)[0];
  assert.ok(baseId, 'original fixture supplies its base reference');
  const baseBefore = structuredClone(before.references[baseId]);
  const objectIdsBefore = Object.keys(before.nodes).sort();

  // Batch raster drops append references and never replace the open project.
  const imageDrop = await page.evaluateHandle(
    (bytes) => {
      const transfer = new DataTransfer();
      for (const name of ['dropped-a.png', 'dropped-b.png'])
        transfer.items.add(
          new File([new Uint8Array(bytes)], name, { type: 'image/png' }),
        );
      return transfer;
    },
    [...tinyPng],
  );
  await page.locator('main').dispatchEvent('drop', { dataTransfer: imageDrop });
  await imageDrop.dispose();
  await waitFor(
    (count) =>
      Object.keys(window.originalStudioDocument().references).length === count,
    Object.keys(before.references).length + 2,
  );
  assert.deepEqual((await documentState()).nodes, before.nodes);
  await assertUnchangedCurves();
  await page.keyboard.press('Control+z');
  await waitFor(
    (expected) => JSON.stringify(window.originalStudioDocument()) === expected,
    JSON.stringify(before),
  );
  // Adding a batch opens the panel; restore the initial state for picker coverage.
  await page.getByRole('button', { name: '参考图面板' }).click();

  const panelButton = page.getByRole('button', { name: '参考图面板' });
  await panelButton.click();
  await page.getByRole('complementary', { name: '参考图' }).waitFor();
  assert.equal(await panelButton.getAttribute('aria-pressed'), 'true');
  await page
    .locator('input[type="file"][aria-label="添加参考图"]')
    .setInputFiles([
      { name: 'reference-a.png', mimeType: 'image/png', buffer: tinyPng },
      { name: 'reference-b.png', mimeType: 'image/png', buffer: tinyPng },
    ]);
  await waitFor(
    (expected) =>
      Object.keys(window.originalStudioDocument().references).length ===
      expected,
    Object.keys(before.references).length + 2,
  );
  const afterAdd = await documentState();
  const overlays = Object.values(afterAdd.references).filter(
    (item) => item.id !== baseId,
  );
  assert.equal(overlays.length, 2, 'multiple picker files create two overlays');
  assert.deepEqual(
    (({ order: _order, ...base }) => base)(afterAdd.references[baseId]),
    (({ order: _order, ...base }) => base)(baseBefore),
    'adding overlays preserves the base reference',
  );
  assert.deepEqual(
    Object.keys(afterAdd.nodes).sort(),
    objectIdsBefore,
    'adding overlays preserves objects',
  );
  await assertUnchangedCurves();

  const overlay = overlays.find((item) => item.name === 'reference-a.png');
  const other = overlays.find((item) => item.name === 'reference-b.png');
  assert.ok(
    overlay && other,
    'both selected picker files retain distinct names',
  );
  await page.getByRole('button', { name: `调整 ${overlay.name}` }).click();
  const handles = page.locator(`[data-reference-handles="${overlay.id}"]`);
  await handles.waitFor();
  assert.equal(
    await handles.locator('polygon').count(),
    1,
    'move polygon is exposed',
  );
  assert.equal(
    await handles.locator('rect[aria-label="缩放参考图"]').count(),
    4,
    'scale handles are exposed',
  );
  await handles.getByLabel('旋转参考图').waitFor();

  const moveBefore = (await reference(overlay.id)).pixelToWorld;
  const moveRevision = (await evidence()).revision;
  await drag(handles.locator('polygon'), { x: 32, y: 18 });
  const moveAfter = (await reference(overlay.id)).pixelToWorld;
  assert.ok(
    matrixChanged(moveAfter, moveBefore),
    'polygon drag moves the overlay',
  );
  assert.equal(
    (await evidence()).revision,
    moveRevision + 1,
    'one move gesture makes one history entry',
  );
  await page.keyboard.press('Control+z');
  await waitFor(
    (expected) =>
      JSON.stringify(
        window.originalStudioDocument().references[expected.id].pixelToWorld,
      ) === JSON.stringify(expected.matrix),
    { id: overlay.id, matrix: moveBefore },
  );
  await page.keyboard.press('Control+Shift+z');
  await waitFor(
    (expected) =>
      JSON.stringify(
        window.originalStudioDocument().references[expected.id].pixelToWorld,
      ) === JSON.stringify(expected.matrix),
    { id: overlay.id, matrix: moveAfter },
  );

  const scaleBefore = (await reference(overlay.id)).pixelToWorld;
  const scaleRevision = (await evidence()).revision;
  await drag(handles.getByLabel('缩放参考图').first(), { x: 26, y: 20 });
  const scaleAfter = (await reference(overlay.id)).pixelToWorld;
  assert.ok(
    matrixChanged(scaleAfter, scaleBefore),
    'corner drag scales the overlay',
  );
  assert.equal(
    (await evidence()).revision,
    scaleRevision + 1,
    'one scale gesture makes one history entry',
  );

  const rotateBefore = (await reference(overlay.id)).pixelToWorld;
  const rotateRevision = (await evidence()).revision;
  await drag(handles.getByLabel('旋转参考图'), { x: 22, y: 27 });
  const rotateAfter = (await reference(overlay.id)).pixelToWorld;
  assert.ok(
    matrixChanged(rotateAfter, rotateBefore),
    'rotation handle rotates the overlay',
  );
  assert.equal(
    (await evidence()).revision,
    rotateRevision + 1,
    'one rotation gesture makes one history entry',
  );

  const escapeMatrix = (await reference(overlay.id)).pixelToWorld;
  const escapeRevision = (await evidence()).revision;
  await beginDrag(handles.locator('polygon'), { x: 25, y: 14 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.deepEqual(
    (await reference(overlay.id)).pixelToWorld,
    escapeMatrix,
    'Escape cancels a reference drag without changing its matrix',
  );
  assert.equal(
    (await evidence()).revision,
    escapeRevision,
    'Escape cancellation does not create a history entry',
  );

  await page.getByRole('button', { name: `调整 ${overlay.name}` }).click();
  await handles.waitFor();
  const blurMatrix = (await reference(overlay.id)).pixelToWorld;
  const blurRevision = (await evidence()).revision;
  await beginDrag(handles.getByLabel('缩放参考图').first(), {
    x: 21,
    y: 16,
  });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.up();
  assert.deepEqual(
    (await reference(overlay.id)).pixelToWorld,
    blurMatrix,
    'window blur cancels a reference drag without changing its matrix',
  );
  assert.equal(
    (await evidence()).revision,
    blurRevision,
    'blur cancellation does not create a history entry',
  );

  const deleteState = await documentState();
  const deleteRevision = (await evidence()).revision;
  await page.keyboard.press('Delete');
  assert.deepEqual(
    await documentState(),
    deleteState,
    'Delete while adjusting a reference must not delete curves or objects',
  );
  assert.equal(
    (await evidence()).revision,
    deleteRevision,
    'Delete while adjusting a reference does not change history',
  );
  await assertUnchangedCurves();

  const opacity = page.getByLabel('不透明度');
  await opacity.focus();
  await opacity.press('Home');
  await opacity.blur();
  await waitFor(
    (id) => window.originalStudioDocument().references[id].opacity === 0,
    overlay.id,
  );
  await page.getByRole('button', { name: '上移', exact: true }).click();
  await waitFor(
    (id) => window.originalStudioDocument().references[id].order > 0,
    overlay.id,
  );
  await page.getByRole('button', { name: `锁定 ${overlay.name}` }).click();
  await waitFor(
    (id) => window.originalStudioDocument().references[id].locked === true,
    overlay.id,
  );
  await handles.waitFor({ state: 'detached' });
  assert.deepEqual(
    (({ order: _order, ...base }) => base)(
      (await documentState()).references[baseId],
    ),
    (({ order: _order, ...base }) => base)(baseBefore),
    'adjusting an overlay keeps the base unchanged',
  );
  await assertUnchangedCurves();

  await page.getByRole('button', { name: '完成', exact: true }).click();
  await handles.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '节点 (A)', exact: true }).click();
  assert.equal(
    await page
      .getByRole('button', { name: '节点 (A)', exact: true })
      .getAttribute('aria-pressed'),
    'true',
    'normal tool selection resumes after completing reference adjustment',
  );
  assert.equal(
    await page.locator('[data-reference-handles]').count(),
    0,
    'completed reference adjustment leaves no transform handles',
  );
  await page.getByRole('button', { name: '选择 (V)', exact: true }).click();
  assert.equal(
    await page.locator('[data-reference-handles]').count(),
    0,
    'switching tools does not restore completed reference handles',
  );

  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await waitFor(() => !window.originalStudioEvidence().dirty);
  assert.deepEqual(
    await page.evaluate(() => window.originalStudioSavedEvidence()),
    { kind: 'v4', matchesCurrent: true },
  );
  const beforeOpen = await evidence();
  await openSaved();
  await waitFor(
    (epoch) => window.originalStudioEvidence().epoch !== epoch,
    beforeOpen.epoch,
  );
  const reopened = await documentState();
  assert.equal(
    Object.keys(reopened.references).length,
    3,
    'saved project reopens all reference images',
  );
  assert.equal(
    reopened.references[overlay.id].locked,
    true,
    'reopened overlay keeps lock state',
  );
  assert.equal(
    reopened.references[overlay.id].opacity,
    0,
    'reopened overlay keeps opacity',
  );
  assert.deepEqual(
    reopened.references[overlay.id].pixelToWorld,
    rotateAfter,
    'reopened overlay keeps transforms',
  );
  assert.ok(
    reopened.references[other.id],
    'second overlay survives save and reopen',
  );
  await assertUnchangedCurves();
  assert.deepEqual(
    errors,
    [],
    `browser emitted console errors: ${errors.join('\n')}`,
  );
  await page.screenshot({
    path: resolve(outputDirectory, 'reference-images.png'),
    fullPage: true,
  });
  return {
    checked: [
      'multiple reference files preserve base image and existing objects',
      'move, scale, rotate each commit once and undo/redo the move',
      'Escape and blur cancel reference gestures without document or history changes',
      'reference adjustment blocks Delete and hands control back to drawing tools',
      'opacity, ordering, locking, save, and reopen preserve overlays without curve edits',
    ],
  };
};
