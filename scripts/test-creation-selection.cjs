// Run on an isolated Playwright page. The fixture is imported through the UI.
module.exports = async (page) => {
  const assert = require('node:assert/strict');
  const checks = [];
  const check = (value, name) => {
    assert(value, name);
    checks.push(name);
  };
  const call = (action, args = {}) =>
    page.evaluate(({ action, args }) => window.traceStudio.call(action, args), {
      action,
      args,
    });
  const settle = async () => {
    await page.waitForFunction(
      async () =>
        window.traceStudio && !(await window.traceStudio.call('state')).busy,
    );
    await page.locator('.creation-updating').waitFor({ state: 'hidden' });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  };
  const selection = async () => (await call('state')).creation.selection;
  const selected = async (kind, ids, name) =>
    check(
      JSON.stringify(await selection()) === JSON.stringify({ kind, ids }),
      name,
    );

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const prior = await call('get_project');
  const swatches = [
    { id: 'cream', name: '奶油白', color: '#f3ead7' },
    { id: 'brown', name: '灰棕', color: '#a59883' },
  ];
  const object = (id, name, groupId, boundary, divider) => ({
    id,
    name,
    groupId,
    pathIds: [boundary, divider],
    roles: { [boundary]: 'boundary', [divider]: 'divider' },
    featureIds: [],
    regionIds: [],
    featureSwatches: {},
    swatchId: 'cream',
    heightMM: 1,
    zMM: 0,
    visible: true,
    printable: true,
    paints: [],
  });
  const path = (id, groupId, points, closed) => {
    const anchors = points.map(([x, y]) => ({ x, y }));
    return {
      id,
      name: id,
      groupId,
      start: anchors[0],
      anchors,
      curves: anchors
        .slice(1)
        .map((point, i) => [anchors[i], anchors[i], point, point]),
      color: '#a59883',
      visible: true,
      quality: 1,
      closed,
      fitting: 'single',
    };
  };
  const fixture = {
    ...prior,
    version: 3,
    imageName: 'selection-fixture',
    width: 1200,
    height: 900,
    widthMM: 120,
    depthMM: 1,
    model: {
      version: 1,
      toleranceMM: 0.015,
      regions: [],
      features: [],
      parts: [{ id: 'main', name: '零件 1' }],
    },
    groups: [
      { id: 'alpha', name: '选择甲' },
      { id: 'beta', name: '选择乙' },
      { id: 'gamma', name: '选择丙' },
    ],
    paths: [
      path(
        '甲轮廓',
        'alpha',
        [
          [100, 150],
          [380, 150],
          [380, 450],
          [100, 450],
          [100, 150],
        ],
        true,
      ),
      path(
        '甲分线',
        'alpha',
        [
          [240, 150],
          [240, 450],
        ],
        false,
      ),
      path(
        '乙轮廓',
        'beta',
        [
          [460, 150],
          [740, 150],
          [740, 450],
          [460, 450],
          [460, 150],
        ],
        true,
      ),
      path(
        '乙分线',
        'beta',
        [
          [600, 150],
          [600, 450],
        ],
        false,
      ),
      path(
        '丙轮廓',
        'gamma',
        [
          [820, 150],
          [1100, 150],
          [1100, 450],
          [820, 450],
          [820, 150],
        ],
        true,
      ),
      path(
        '丙分线',
        'gamma',
        [
          [960, 150],
          [960, 450],
        ],
        false,
      ),
    ],
    creation: {
      version: 1,
      swatches,
      objects: [
        object('object-alpha', '选择甲', 'alpha', '甲轮廓', '甲分线'),
        object('object-beta', '选择乙', 'beta', '乙轮廓', '乙分线'),
        object('object-gamma', '选择丙', 'gamma', '丙轮廓', '丙分线'),
      ],
    },
  };
  await page.locator('input[accept=".json"]').setInputFiles({
    name: 'selection-fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await page.waitForFunction(
    async () =>
      (await window.traceStudio.call('get_project')).imageName ===
      'selection-fixture',
  );
  await page.getByRole('button', { name: '平面创作', exact: true }).click();
  await page.getByRole('button', { name: '选择 (V)', exact: true }).click();
  await page.getByRole('button', { name: '底图', exact: true }).click();
  await page.getByRole('button', { name: '适合画布', exact: true }).click();
  await settle();
  const original = await call('get_project');

  const alphaCells = await page
    .locator('[data-creation-cell][data-object-id="object-alpha"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-creation-cell')));
  const betaCells = await page
    .locator('[data-creation-cell][data-object-id="object-beta"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-creation-cell')));
  check(
    alphaCells.length === 2 && betaCells.length === 2,
    'fixture exposes two selectable faces per object',
  );

  await page.locator(`[data-creation-cell="${alphaCells[0]}"]`).click();
  await settle();
  await selected(
    'cell',
    [alphaCells[0]],
    'reference-view face click chooses a cell without changing tools',
  );
  check(
    (await page
      .getByRole('button', { name: '选择 (V)', exact: true })
      .getAttribute('aria-pressed')) === 'true',
    'cell selection keeps the select tool active',
  );
  const alphaObject = page.locator('[data-tree-object="object-alpha"]');
  check(
    (await alphaObject.getAttribute('aria-expanded')) === 'true',
    'cell selection expands its owner',
  );
  check(
    await alphaObject
      .locator('xpath=following-sibling::*[1]//details')
      .evaluate((e) => e.open),
    'cell selection expands internal regions',
  );
  const alphaButton = page.locator(`[data-tree-cell="${alphaCells[0]}"]`);
  check(
    await alphaButton.isVisible(),
    'selected cell is revealed in the outliner',
  );
  check(
    await alphaObject.evaluate(
      (row) =>
        row.classList.contains('contains-selection') &&
        !row.classList.contains('selected'),
    ),
    'cell owner is contextual rather than object-selected',
  );

  await page
    .locator(`[data-creation-cell="${alphaCells[1]}"]`)
    .click({ modifiers: ['Control'] });
  await settle();
  await selected(
    'cell',
    alphaCells,
    'Ctrl-click on faces toggles a multi-cell selection',
  );
  await page
    .locator(`[data-tree-cell="${alphaCells[1]}"]`)
    .click({ modifiers: ['Control'] });
  await settle();
  await selected(
    'cell',
    [alphaCells[0]],
    'Ctrl-clicking an outliner face toggles the same selection',
  );

  const sourceView = (await call('state')).view;
  const sourceStage = await page.locator('.stage').boundingBox();
  await page.mouse.click(
    sourceStage.x + sourceView.x + 600 * sourceView.s,
    sourceStage.y + sourceView.y + 300 * sourceView.s,
  );
  await settle();
  await selected('path', ['乙分线'], 'source-line click chooses a path');
  check(
    await page
      .locator('[data-tree-path="乙分线"]')
      .evaluate((e) => e.classList.contains('selected')),
    'source selection highlights its outliner path',
  );

  await page.getByRole('button', { name: '折叠选择乙', exact: true }).click();
  const betaObject = page.locator('[data-tree-object="object-beta"]');
  check(
    (await betaObject.getAttribute('aria-expanded')) === 'false',
    'fixture can collapse the object before name selection',
  );
  await betaObject.click();
  await settle();
  await selected(
    'object',
    ['object-beta'],
    'outliner object name chooses the object',
  );
  check(
    (await betaObject.getAttribute('aria-expanded')) === 'false',
    'object-name selection does not expand a collapsed object',
  );

  await page.locator('[data-tree-object="object-alpha"]').click();
  await page
    .locator('[data-tree-object="object-beta"]')
    .click({ modifiers: ['Control'] });
  await settle();
  await selected(
    'object',
    ['object-alpha', 'object-beta'],
    'Ctrl-click toggles a second object',
  );
  await page
    .locator('[data-tree-object="object-gamma"]')
    .click({ modifiers: ['Shift'] });
  await settle();
  await selected(
    'object',
    ['object-beta', 'object-gamma'],
    'Shift range uses the most recent object as its anchor',
  );
  await page
    .locator('[data-tree-object="object-alpha"]')
    .click({ modifiers: ['Control', 'Shift'] });
  await settle();
  await selected(
    'object',
    ['object-beta', 'object-gamma', 'object-alpha'],
    'Ctrl+Shift unions an object range with the existing selection',
  );

  for (const id of ['object-alpha', 'object-beta', 'object-gamma']) {
    const row = page.locator(`[data-tree-object="${id}"]`);
    if ((await row.getAttribute('aria-expanded')) === 'false')
      await row.getByRole('button', { name: /^展开/ }).click();
  }
  await page.locator('[data-tree-path="甲轮廓"]').click();
  await page
    .locator('[data-tree-path="丙分线"]')
    .click({ modifiers: ['Shift'] });
  await settle();
  await selected(
    'path',
    ['甲轮廓', '甲分线', '乙轮廓', '乙分线', '丙轮廓', '丙分线'],
    'tree paths support Shift range selection',
  );

  const stage = await page.locator('.stage').boundingBox();
  const clearView = (await call('state')).view;
  await page.mouse.click(
    stage.x + clearView.x + 50 * clearView.s,
    stage.y + clearView.y + 600 * clearView.s,
  );
  await settle();
  check(
    (await selection()).ids.length === 0,
    'blank canvas click clears selection',
  );
  await page.locator(`[data-creation-cell="${betaCells[0]}"]`).click();
  await page.keyboard.press('Escape');
  await settle();
  await selected(
    'object',
    [],
    'Escape clears selection while select is active',
  );
  assert.deepEqual(
    await call('get_project'),
    original,
    'selection interactions never change the project',
  );
  checks.push(
    'selection state, expansion, range and clear contracts remain project-safe',
  );
  return { ok: true, checks };
};
