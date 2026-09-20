module.exports = async (page, outputDirectory) => {
  const assert = require('node:assert/strict');
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const { drawCupEmblem } = await import('../../examples/draw-cup-emblem.mjs');
  const { decodeDocument } =
    await import('../../../src/lib/document/codec.mjs');
  const { readGeometry } = await import('../../../src/lib/region-engine.mjs');
  const call = (action, args = {}) =>
    page.evaluate(({ action, args }) => window.traceStudio.call(action, args), {
      action,
      args,
    });
  await page
    .locator('input[accept=".spl,.bezier.json,.json"]')
    .setInputFiles(
      path.resolve(__dirname, '../../../public/sandrone-example.spl'),
    );
  await page.waitForFunction(
    async () =>
      (await window.traceStudio.call('state')).ready &&
      Object.values(
        (await window.traceStudio.call('document.get')).document.nodes,
      ).some((node) => node.name === '杯子'),
  );
  assert.equal((await call('capabilities.get')).apiVersion, '5.0');
  const original = await call('document.get');
  const initial = await call('creation_inspect');
  const cupId = initial.creation.objects.find((o) => o.name === '杯子').id;
  const cupGeometry = (scene) =>
    scene.cells
      .filter((cell) => cell.objectId === cupId)
      .map((cell) => cell.geometry);
  const result = await drawCupEmblem(call);
  console.log('API 5 motif created');
  let state = await call('document.get');
  const run = async (action) => {
    state = await call('authoring.run', {
      expectedRevision: state.revision,
      action,
    });
  };
  const undo = async () => {
    state = await call('undo', { expectedRevision: state.revision });
  };
  let scene = await call('creation_inspect');
  const cell = (view) =>
    view.cells.find((cell) => cell.objectId === result.objectId);
  assert.deepEqual(scene.errors, []);
  assert.equal(cell(scene).geometry.coordinates.length, 6);
  assert.deepEqual(cupGeometry(scene), cupGeometry(initial));
  const finalArea = readGeometry(cell(scene).geometry).getArea();
  assert(finalArea > 0);
  for (const [id, sketch] of Object.entries(original.document.sketches))
    assert.deepEqual(state.document.sketches[id], sketch);
  assert.equal(
    Object.keys(state.document.sketches).length,
    Object.keys(original.document.sketches).length + 3,
  );
  const mother = result.pathRefs[0];
  const sketch = state.document.sketches[mother.sketchId];
  const uses = sketch.paths[mother.id].edges;
  const lastVertex = sketch.edges[uses.at(-1).edgeId].endVertexId;
  const beforeBreak = state.document;
  const position = sketch.vertices[lastVertex].position.value;
  await assert.rejects(
    call('authoring.run', {
      expectedRevision: state.revision - 1,
      action: {
        kind: 'move-nodes',
        nodeIds: [result.objectId],
        deltaMM: [1, 0],
      },
    }),
    /revision|修订|过期/i,
  );
  await assert.rejects(
    call('spline_apply', { splines: [] }),
    /expectedRevision/,
  );
  assert.deepEqual((await call('document.get')).document, beforeBreak);
  await run({
    kind: 'set-vertex',
    sketchId: sketch.id,
    vertexId: lastVertex,
    value: [position[0] + 1, position[1]],
  });
  scene = await call('creation_inspect');
  assert.equal(cell(scene), undefined);
  assert(scene.errors.some((error) => error.objectId === result.objectId));
  assert.deepEqual(cupGeometry(scene), cupGeometry(initial));
  assert(
    scene.cells
      .filter((cell) => cell.objectId === cupId)
      .every((cell) => cell.enabled && !cell.flatOnly),
  );
  await assert.rejects(
    call('export.run', {
      epoch: state.epoch,
      revision: state.revision,
      format: '3mf',
      stage: 'bodies',
    }),
    /ready|blocked|阻断/,
  );
  await undo();
  assert.deepEqual(state.document, beforeBreak);
  scene = await call('creation_inspect');
  assert(
    Math.abs(readGeometry(cell(scene).geometry).getArea() - finalArea) < 1e-7,
  );
  await call('creation_view', { view: 'flat' });
  await call('creation_focus', { objectId: result.objectId });
  const overlay = page.locator(
    `[data-curve-preview-object="${result.objectId}"]`,
  );
  await page
    .getByRole('combobox', { name: '样条预览阶段' })
    .selectOption('final');
  assert.equal(
    await overlay
      .locator('[data-derived-curves]')
      .getAttribute('data-derived-curves'),
    '56',
  );
  await page
    .getByRole('button', { name: '当前部件构造与修改器', exact: true })
    .click();
  const card = page.locator(`[data-modifier-id="${result.modifierId}"]`);
  await card.locator('.modifier-summary').click();
  const count = card.getByRole('spinbutton', { name: '阵列数量', exact: true });
  await count.fill('3');
  await count.press('Enter');
  scene = await call('creation_inspect');
  assert.equal(cell(scene), undefined);
  state = await call('document.get');
  assert.equal(
    state.document.programs[state.document.nodes[result.objectId].programId]
      .operators[result.modifierId].params.count,
    3,
  );
  await count.fill('4');
  await count.press('Enter');
  scene = await call('creation_inspect');
  assert(
    Math.abs(readGeometry(cell(scene).geometry).getArea() - finalArea) < 1e-7,
  );
  state = await call('document.get');
  const evaluated = await call('evaluation.request', {
    epoch: state.epoch,
    revision: state.revision,
    domains: ['curves', 'regions'],
  });
  const apiRegion = evaluated.result.snapshot.regions.find(
    (stage) => stage.ownerNodeId === result.objectId,
  ).value.regions[0];
  assert.deepEqual(apiRegion.ref, cell(scene).outputRef);
  const saved = await call('export', { format: 'json' });
  const bytes = Buffer.from(saved.base64, 'base64');
  assert.deepEqual(decodeDocument(bytes).document, state.document);
  await page.locator('input[accept=".spl,.bezier.json,.json"]').setInputFiles({
    name: 'agent-v4-emblem.spl',
    mimeType: 'application/octet-stream',
    buffer: bytes,
  });
  await page.waitForFunction(
    async (epoch) =>
      (await window.traceStudio.call('document.get')).epoch !== epoch,
    state.epoch,
  );
  const reopened = await call('document.get');
  assert.deepEqual(reopened.document, state.document);
  scene = await call('creation_inspect');
  assert.deepEqual(scene.errors, []);
  assert.deepEqual(cupGeometry(scene), cupGeometry(initial));
  assert(
    Math.abs(readGeometry(cell(scene).geometry).getArea() - finalArea) < 1e-7,
  );
  const exported = await page.evaluate(async () => {
    const state = await window.traceStudio.call('document.get');
    const exported = await window.traceStudio.call('export.run', {
      epoch: state.epoch,
      revision: state.revision,
      format: '3mf',
      stage: 'bodies',
    });
    return {
      ...exported,
      artifact: {
        ...exported.artifact,
        data: Array.from(new Uint8Array(exported.artifact.data)),
      },
    };
  });
  assert(exported.artifact.data.length > 100);
  console.log('API 5 save/reopen and 3MF passed');
  if (outputDirectory) {
    await fs.mkdir(outputDirectory, { recursive: true });
    await fs.writeFile(
      path.join(outputDirectory, 'sandrone-gold-emblem.spl'),
      bytes,
    );
    await fs.writeFile(
      path.join(outputDirectory, 'sandrone-gold-emblem.3mf'),
      Buffer.from(exported.artifact.data),
    );
    await call('creation_view', { view: '3d' });
    await page
      .getByRole('checkbox', { name: '派生样条', exact: true })
      .uncheck();
    await page.getByRole('button', { name: '正视', exact: true }).click();
    await page.screenshot({
      path: path.join(outputDirectory, 'acceptance-front.png'),
    });
    await page.getByRole('button', { name: '立体', exact: true }).click();
    await page.screenshot({
      path: path.join(outputDirectory, 'acceptance-3d.png'),
    });
    await fs.writeFile(
      path.join(outputDirectory, 'acceptance.json'),
      JSON.stringify({ ...result, finalArea, apiVersion: '5.0' }, null, 2),
    );
  }
  return {
    ...result,
    finalArea,
    checks: [
      'API 5 public source/mirror/array/Join/Fill',
      'stale revision rejected',
      'original cup preserved',
      'failure isolation and strict export',
      'single undo',
      'GUI/API identity',
      'modifier UI',
      'V4 save/reopen',
      '3MF export',
    ],
  };
};
