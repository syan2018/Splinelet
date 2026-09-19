module.exports = async (page, outputDirectory) => {
  const assert = require('node:assert/strict');
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const { drawCupEmblem } = await import('../../examples/draw-cup-emblem.mjs');
  const { encodeProject, decodeProject } =
    await import('../../../src/lib/project-format.mjs');
  const fixture = path.resolve(
    __dirname,
    '../../../public/sandrone-example.spl',
  );
  const call = (action, args = {}) =>
    page.evaluate(({ action, args }) => window.traceStudio.call(action, args), {
      action,
      args,
    });
  await page
    .locator('input[accept=".spl,.bezier.json,.json"]')
    .setInputFiles(fixture);
  const initial = await call('creation_inspect');
  const original = await call('get_project');
  const cupId = initial.creation.objects.find((o) => o.name === '杯子').id;
  const cupGeometry = (s) =>
    s.cells.filter((c) => c.objectId === cupId).map((c) => c.geometry);
  const result = await drawCupEmblem(call);
  let scene = await call('creation_inspect');
  const cells = (s) => s.cells.filter((c) => c.objectId === result.objectId);
  assert.deepEqual(scene.errors, []);
  assert.equal(cells(scene).length, 1);
  assert.equal(cells(scene)[0].geometry.type, 'Polygon');
  assert.equal(cells(scene)[0].geometry.coordinates.length, 6);
  assert.deepEqual(cupGeometry(scene), cupGeometry(initial));
  const finalArea = cells(scene).reduce((n, c) => n + c.areaMM2, 0);
  assert(finalArea > 0);
  const savedPaths = (await call('get_project')).paths;
  assert.deepEqual(savedPaths.slice(0, original.paths.length), original.paths);
  assert.equal(savedPaths.length, original.paths.length + 3);
  assert.equal(
    savedPaths.find((p) => p.id === result.pathIds[0]).nodeModes[1],
    'smooth',
  );
  assert.equal(
    savedPaths.find((p) => p.id === result.pathIds[2]).nodeModes[2],
    'smooth',
  );

  const mother = (
    await call('spline_inspect', { pathIds: [result.pathIds[0]] })
  ).splines[0];
  await call('creation_view', { view: 'flat' });
  await call('creation_focus', { objectId: result.objectId });
  const overlay = page.locator(
    `[data-curve-preview-object="${result.objectId}"]`,
  );
  const stage = page.getByRole('combobox', { name: '样条预览阶段' });
  assert.deepEqual(
    scene.curvePreviews
      .filter((s) => s.objectId === result.objectId)
      .map((s) => s.curves.length),
    [7, 14, 56, 56],
  );
  await stage.selectOption('source');
  assert.equal(
    await overlay
      .locator('[data-derived-curves]')
      .getAttribute('data-derived-curves'),
    '7',
  );
  await stage.selectOption('final');
  assert.equal(
    await overlay
      .locator('[data-derived-curves]')
      .getAttribute('data-derived-curves'),
    '56',
  );
  const disconnected = structuredClone(mother.nodes);
  for (const key of ['co', 'handleLeft', 'handleRight'])
    disconnected.at(-1)[key].x += 1;
  await call('spline_apply', {
    splines: [{ id: mother.id, nodes: disconnected }],
  });
  scene = await call('creation_inspect');
  assert.equal(cells(scene).length, 0);
  assert(scene.curvePreviews.at(-1).junctions.length > 0);
  assert((await overlay.locator('[data-curve-junction]').count()) > 0);
  if (outputDirectory) {
    await page.screenshot({
      path: path.join(outputDirectory, 'preview-broken-joins.png'),
    });
    await call('creation_view', { view: '3d' });
    await page.screenshot({
      path: path.join(outputDirectory, 'preview-broken-joins-3d.png'),
    });
  }
  await call('undo');
  scene = await call('creation_inspect');
  assert.equal(scene.curvePreviews.at(-1).junctions.length, 0);
  // Actual pointer drag: transformed helpers must change BEFORE pointer-up,
  // while the surface worker may still be debounced.
  await call('creation_view', { view: 'flat' });
  await call('select_paths', { pathIds: [mother.id] });
  await page.keyboard.press('a');
  const node = page.locator('[data-node-index="2"]');
  const bounds = await node.boundingBox();
  assert(bounds);
  const beforeDrag = await overlay
    .locator('[data-derived-curves]')
    .getAttribute('d');
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 + 12,
    bounds.y + bounds.height / 2 + 3,
    { steps: 3 },
  );
  await page.waitForFunction(
    ({ id, before }) =>
      document
        .querySelector(`[data-curve-preview-object="${id}"] path`)
        .getAttribute('d') !== before,
    { id: result.objectId, before: beforeDrag },
  );
  await page.mouse.up();
  await call('undo');
  scene = await call('creation_inspect');
  assert.equal(scene.curvePreviews.at(-1).junctions.length, 0);
  const editedNodes = structuredClone(mother.nodes);
  for (const key of ['co', 'handleLeft', 'handleRight'])
    editedNodes[1][key].x += 0.5;
  await call('spline_apply', {
    splines: [{ id: mother.id, nodes: editedNodes }],
  });
  scene = await call('creation_inspect');
  assert.deepEqual(scene.errors, []);
  assert(Math.abs(cells(scene)[0].areaMM2 - finalArea) > 0.01);
  assert.equal((await call('get_project')).paths.length, savedPaths.length);
  await call('undo');
  scene = await call('creation_inspect');
  assert(Math.abs(cells(scene)[0].areaMM2 - finalArea) < 1e-7);

  await assert.rejects(
    call('spline_apply', {
      splines: [
        { nodes: mother.nodes, closed: true },
        { id: 'missing', nodes: mother.nodes },
      ],
    }),
  );
  assert.deepEqual((await call('get_project')).paths, savedPaths);

  await call('creation_command', {
    action: 'modifier_update',
    args: {
      objectId: result.objectId,
      modifierId: result.modifierId,
      changes: { count: 3 },
    },
  });
  scene = await call('creation_inspect');
  assert(scene.errors.some((e) => e.objectId === result.objectId));
  assert.equal(cells(scene).length, 0);
  await call('undo');
  await call('creation_inspect');

  // Exercise the actual modifier controls as well as the public API.
  await call('creation_focus', { objectId: result.objectId });
  await page
    .getByRole('button', { name: '当前部件构造与修改器', exact: true })
    .click();
  const card = page.locator(`[data-modifier-id="${result.modifierId}"]`);
  await card.locator('.modifier-summary').click();
  const count = card.getByRole('spinbutton', { name: '阵列数量', exact: true });
  await count.fill('3');
  await count.press('Enter');
  scene = await call('creation_inspect');
  assert.equal(
    scene.creation.objects
      .find((o) => o.id === result.objectId)
      .modifiers.find((m) => m.id === result.modifierId).count,
    3,
  );
  await count.fill('4');
  await count.press('Enter');
  scene = await call('creation_inspect');
  assert(Math.abs(cells(scene)[0].areaMM2 - finalArea) < 1e-7);

  const project = await call('get_project');
  const bytes = encodeProject(project);
  assert.deepEqual(decodeProject(bytes).paths, project.paths);
  await call('load_project', { project: decodeProject(bytes) });
  scene = await call('creation_inspect');
  assert.deepEqual(scene.errors, []);
  assert(Math.abs(cells(scene)[0].areaMM2 - finalArea) < 1e-7);
  assert.deepEqual(cupGeometry(scene), cupGeometry(initial));
  const checked = await call('creation_export', { format: 'check' });
  const report = checked.report || checked;
  assert.equal(report.invalidEdges, 0);
  assert.equal(report.zeroArea, 0);
  assert.equal(report.components, 1);
  const archive = await call('creation_export', { format: '3mf' });
  assert(archive.base64?.length > 100);

  if (outputDirectory) {
    await fs.mkdir(outputDirectory, { recursive: true });
    await fs.writeFile(
      path.join(outputDirectory, 'sandrone-gold-emblem.spl'),
      bytes,
    );
    await fs.writeFile(
      path.join(outputDirectory, 'sandrone-gold-emblem.3mf'),
      Buffer.from(archive.base64, 'base64'),
    );
    const svg = await call('creation_export', { format: 'svg' });
    await fs.writeFile(
      path.join(outputDirectory, 'sandrone-gold-emblem.svg'),
      svg.content,
    );
    await fs.writeFile(
      path.join(outputDirectory, 'acceptance.json'),
      JSON.stringify(
        {
          ...result,
          report,
          originalPaths: original.paths.length,
          finalPaths: project.paths.length,
          sourceNodes: 10,
          areaMM2: finalArea,
        },
        null,
        2,
      ),
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
  }
  return {
    ...result,
    report,
    checks: [
      'public API authoring',
      'live curve stages and visible broken joins in flat/3D previews',
      'connected outline with shared central opening',
      'original cup preserved',
      'live mother edit',
      'one-step undo',
      'atomic failure',
      'live array count',
      'modifier UI',
      '.spl reload',
      'single manifold solid',
      '3MF export',
    ],
  };
};
