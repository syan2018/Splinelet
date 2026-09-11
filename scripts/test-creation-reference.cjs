// Run on the Sandrone copy in an isolated Playwright page. New test strokes are undone.
module.exports = async (page) => {
  const assert = require('node:assert/strict'),
    checks = [];
  const call = (action) =>
    page.evaluate((action) => window.traceStudio.call(action), action);
  const check = (ok, name) => {
    assert(ok, name);
    checks.push(name);
  };
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '平面创作', exact: true }).click();
  await page.getByRole('button', { name: '选择 (V)', exact: true }).click();
  await page.waitForFunction(
    async () => (await window.traceStudio.call('state')).ready,
  );
  await page.locator('.creation-updating').waitFor({ state: 'hidden' });
  const original = await call('get_project');
  const source = original.paths.find((p) => p.name === '路径 69');
  check(
    source?.anchors.length === 3 &&
      source.curves.length === 2 &&
      !source.closed,
    'Path 69 is a real open two-span source',
  );
  await page.getByRole('button', { name: '底图', exact: true }).click();
  const alphas = () =>
    page
      .locator('[data-creation-cell]')
      .evaluateAll((es) => es.map((e) => +getComputedStyle(e).fillOpacity));
  check(
    (await alphas()).every((a) => a === 0),
    'reference view hides all region fills',
  );
  await page.getByRole('button', { name: '叠色', exact: true }).click();
  check(
    (await alphas()).some((a) => a > 0 && a < 1),
    'overlay keeps fills translucent',
  );
  await page.getByRole('button', { name: '分色', exact: true }).click();
  check(
    (await alphas()).some((a) => a === 1),
    'colour view restores opaque fills',
  );
  check(
    await page
      .locator('.drawing-canvas image')
      .evaluate((e) => getComputedStyle(e).visibility === 'hidden'),
    'colour view shows the work without the reference image',
  );
  await page
    .locator('.creation-object-row')
    .filter({ hasText: '路径 69' })
    .click();
  check(
    await page
      .locator('.source-path-layer.selected')
      .evaluateAll((es) =>
        es.some((e) => getComputedStyle(e).display !== 'none'),
      ),
    'selected Path 69 remains visible with other lines hidden',
  );
  check(
    await page
      .locator('.source-path-layer:not(.selected)')
      .evaluateAll((es) =>
        es.every((e) => getComputedStyle(e).display === 'none'),
      ),
    'unselected source lines can be hidden',
  );
  await page.getByRole('button', { name: '画笔色：酒红', exact: true }).click();
  assert.deepEqual(
    await call('get_project'),
    original,
    'display switches, selection and choosing a brush never repaint',
  );
  await page.getByRole('button', { name: '节点 (A)', exact: true }).click();
  check(
    (await page
      .getByRole('button', { name: '底图', exact: true })
      .getAttribute('aria-pressed')) === 'true',
    'node editing restores reference view',
  );
  check(
    (await alphas()).every((a) => a === 0),
    'node editing keeps underlying image visible',
  );
  check(
    await page
      .locator('.drawing-canvas image')
      .evaluate((e) => getComputedStyle(e).visibility === 'visible'),
    'reference image returns for source editing',
  );
  await page.getByRole('button', { name: '上色', exact: true }).click();
  check(
    (await page
      .getByRole('button', { name: '叠色', exact: true })
      .getAttribute('aria-pressed')) === 'true',
    'paint tool opens a translucent preview',
  );
  await page.getByRole('button', { name: '立体预览', exact: true }).click();
  await page.getByRole('button', { name: '描线 (P)', exact: true }).click();
  check(
    (await page.locator('.creation-webgl').count()) === 0 &&
      (await alphas()).every((a) => a === 0),
    'tracing from 3D returns to an unobscured image',
  );
  await page.getByRole('button', { name: '适合画布', exact: true }).click();
  const view = (await call('state')).view,
    box = await page.locator('.stage').boundingBox();
  await page.keyboard.down('Alt');
  for (const [x, y] of [
    [500, 800],
    [610, 850],
  ]) {
    await page.mouse.click(
      box.x + view.x + x * view.s,
      box.y + view.y + y * view.s,
    );
    await page.waitForFunction(
      async () => !(await window.traceStudio.call('state')).busy,
    );
  }
  await page.keyboard.up('Alt');
  await page.keyboard.press('Enter');
  const drawn = await call('get_project'),
    added = drawn.paths.at(-1);
  check(
    drawn.paths.length === original.paths.length + 1 &&
      added.anchors.length === 2 &&
      added.curves.length === 1,
    'two clicks over the filled cup create exactly one new cubic',
  );
  assert.deepEqual(
    drawn.paths.slice(0, -1),
    original.paths,
    'existing sources stay untouched',
  );
  assert.deepEqual(
    drawn.creation.objects.flatMap((o) => o.paints),
    original.creation.objects.flatMap((o) => o.paints),
    'tracing does not paint any existing region',
  );
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  assert.deepEqual(
    await call('get_project'),
    original,
    'undo restores the original project',
  );
  checks.push('source geometry, colours and undo preserved');
  return { ok: true, checks };
};
