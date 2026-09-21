// Always run in a fresh context. An optional input file is read as an unbound copy.
module.exports = async (page, outputDirectory, inputFile) => {
  const assert = require('node:assert/strict');
  const { resolve } = require('node:path');
  const { mkdir, writeFile } = require('node:fs/promises');
  const call = (action, args = {}) =>
    page.evaluate(({ action, args }) => window.traceStudio.call(action, args), {
      action,
      args,
    });
  await page.waitForFunction(() => window.traceStudio);
  await page
    .locator('input[accept=".spl,.bezier.json,.json"]')
    .setInputFiles(
      inputFile || resolve(__dirname, '../../../public/sandrone-example.spl'),
    );
  await page.waitForFunction(async () =>
    (await window.traceStudio.call('get_project')).creation?.objects.some(
      (o) => o.name === '杯子',
    ),
  );
  if (!inputFile) {
    const { drawCupEmblem } =
      await import('../../examples/draw-cup-emblem.mjs');
    await drawCupEmblem(call);
  }
  await call('creation_view', { view: 'flat' });
  await call('select_paths', { pathIds: [] });
  await page.locator('.creation-updating').waitFor({ state: 'hidden' });
  assert.equal((await call('state')).creation.selection.ids.length, 0);
  const original = await call('document.get');
  const project = await call('get_project');
  const target = project.creation.objects.find(
    (o) => o.name === '金色四瓣标记',
  );
  assert(target);
  const overlay = page.locator(`[data-curve-preview-object="${target.id}"]`);
  const expectedCurves =
    project.paths
      .filter((path) => target.pathIds.includes(path.id))
      .reduce((n, path) => n + path.curves.length, 0) * 8;
  await page.waitForFunction(
    ({ id, expected }) => {
      const el = document.querySelector(
        `[data-curve-preview-object="${id}"] [data-derived-curves]`,
      );
      return Number(el?.getAttribute('data-derived-curves')) === expected;
    },
    { id: target.id, expected: expectedCurves },
  );
  const program =
    original.document.programs[original.document.nodes[target.id].programId];
  assert.match(
    await overlay.getAttribute('data-curve-preview-stage'),
    program.outputs.curves ? /^final$/ : /^fill-input:/,
  );
  if (outputDirectory) {
    await mkdir(outputDirectory, { recursive: true });
    await page.screenshot({ path: resolve(outputDirectory, 'initial.png') });
  }
  await page
    .locator(`[data-tree-object="${target.id}"]`)
    .click({ position: { x: 60, y: 12 } });
  await page.keyboard.press('h');
  const source = page
    .locator(`[data-source-id="${target.pathIds[0]}"] path`)
    .last();
  const point = await source.evaluate((el) => {
    const p = el.getPointAtLength(el.getTotalLength() / 2);
    const q = new DOMPoint(p.x, p.y).matrixTransform(el.getScreenCTM());
    return { x: q.x, y: q.y };
  });
  await page.mouse.move(point.x, point.y);
  let time = Date.now();
  await page.mouse.down();
  const downMs = Date.now() - time;
  assert.equal((await call('state')).gesturing, true);
  assert.deepEqual(
    await call('document.get'),
    original,
    'press does not publish a document preview',
  );
  time = Date.now();
  await page.mouse.move(point.x + 35, point.y + 20, { steps: 30 });
  const movesMs = Date.now() - time;
  assert.deepEqual(
    await call('document.get'),
    original,
    'move does not publish or clone editable state',
  );
  assert.match(await overlay.getAttribute('transform'), /translate/);
  time = Date.now();
  await page.mouse.up();
  const upMs = Date.now() - time;
  await call('creation_inspect');
  await page.locator('.creation-updating').waitFor({ state: 'hidden' });
  const settledMs = Date.now() - time;
  const moved = await call('document.get');
  assert.equal(moved.revision, original.revision + 1);
  assert.deepEqual(moved.document.sketches, original.document.sketches);
  assert.notDeepEqual(
    moved.document.nodes[target.id].pose,
    original.document.nodes[target.id].pose,
  );
  for (const [id, node] of Object.entries(original.document.nodes))
    if (id !== target.id) assert.deepEqual(moved.document.nodes[id], node);
  assert.equal(
    await overlay.getAttribute('transform'),
    null,
    'settled geometry has no double translation',
  );
  await call('undo', { expectedRevision: moved.revision });
  assert.deepEqual((await call('document.get')).document, original.document);
  const result = {
    ok: true,
    downMs,
    movesMs,
    upMs,
    settledMs,
    defaultCurves: expectedCurves,
  };
  if (outputDirectory)
    await writeFile(
      resolve(outputDirectory, 'timings.json'),
      JSON.stringify(result, null, 2),
    );
  return result;
};
