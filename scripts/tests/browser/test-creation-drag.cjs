// Run after test-creation-selection.cjs. It deliberately keeps that fixture
// loaded and undoes every geometry edit it makes.
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
  const point = async (x, y) => {
    const view = (await call('state')).view;
    const stage = await page.locator('.stage').boundingBox();
    return {
      x: stage.x + view.x + x * view.s,
      y: stage.y + view.y + y * view.s,
    };
  };
  const offset = (after, before, id) => {
    const a = after.paths.find((path) => path.id === id);
    const b = before.paths.find((path) => path.id === id);
    return { x: a.start.x - b.start.x, y: a.start.y - b.start.y };
  };
  const unchangedPaths = (after, before) =>
    JSON.stringify(after.paths) === JSON.stringify(before.paths);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '选择 (V)', exact: true }).click();
  await page.locator('[data-tree-path="乙分线"]').click();
  await page
    .getByRole('button', { name: '定位选中内容 (F)', exact: true })
    .click();
  await settle();
  let sourcePoint = await point(600, 300);
  await page.mouse.move(sourcePoint.x, sourcePoint.y);
  await page.mouse.wheel(0, -550);
  await settle();
  const view = (await call('state')).view;
  check(view.s > 3, 'F then wheel produces a high-zoom source-drag case');

  const sourceBefore = await call('get_project');
  sourcePoint = await point(600, 300);
  const sourcePixels = { x: 114, y: 38 };
  await page.mouse.move(sourcePoint.x, sourcePoint.y);
  await page.mouse.down();
  await page.mouse.move(
    sourcePoint.x + sourcePixels.x,
    sourcePoint.y + sourcePixels.y,
    { steps: 8 },
  );
  await page.mouse.up();
  await settle();
  const sourceAfter = await call('get_project');
  const sourceDelta = offset(sourceAfter, sourceBefore, '乙分线');
  check(
    Math.abs(sourceDelta.x - sourcePixels.x / view.s) < 0.02 &&
      Math.abs(sourceDelta.y - sourcePixels.y / view.s) < 0.02,
    'high-zoom source drag converts screen pixels to document units exactly once',
  );
  await page.keyboard.press('Control+z');
  await settle();
  assert.deepEqual(
    await call('get_project'),
    sourceBefore,
    'one undo restores the source-line drag',
  );

  const faceBefore = await call('get_project');
  const facePoint = await point(650, 300);
  await page.mouse.move(facePoint.x, facePoint.y);
  await page.mouse.down();
  await page.mouse.move(facePoint.x + 60, facePoint.y - 25, { steps: 8 });
  await page.mouse.up();
  await settle();
  const faceAfter = await call('get_project');
  const boundaryDelta = offset(faceAfter, faceBefore, '乙轮廓');
  const dividerDelta = offset(faceAfter, faceBefore, '乙分线');
  check(
    Math.abs(boundaryDelta.x - dividerDelta.x) < 0.02 &&
      Math.abs(boundaryDelta.y - dividerDelta.y) < 0.02 &&
      Math.hypot(boundaryDelta.x, boundaryDelta.y) > 0.01,
    'dragging the right beta face moves its owner boundary and divider together',
  );
  const scene = await call('creation_inspect');
  check(
    scene.cells.filter((cell) => cell.objectId === 'object-beta').length === 2,
    'face drag preserves the beta object cell topology',
  );
  check(
    (await call('state')).creation.selection.kind === 'cell',
    'face drag retains the semantic cell selection kind',
  );
  await page.keyboard.press('Control+z');
  await settle();
  assert.deepEqual(
    await call('get_project'),
    faceBefore,
    'one undo restores the face drag',
  );

  const cancelBefore = await call('get_project');
  sourcePoint = await point(600, 300);
  await page.mouse.move(sourcePoint.x, sourcePoint.y);
  await page.mouse.down();
  await page.mouse.move(sourcePoint.x + 90, sourcePoint.y + 30, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await settle();
  assert.deepEqual(
    await call('get_project'),
    cancelBefore,
    'Escape cancels an in-progress source drag',
  );

  const pan = async (button, space, label) => {
    // The preceding release moved this document point into the sidebar.
    // Reframe through the UI so each gesture starts on the actual face.
    await page
      .getByRole('button', { name: '定位选中内容 (F)', exact: true })
      .click();
    const center = await point(600, 300);
    await page.mouse.move(center.x, center.y);
    await page.mouse.wheel(0, -550);
    await settle();
    const beforeProject = await call('get_project');
    const beforeView = (await call('state')).view;
    const start = await point(650, 300);
    const sidebar = await page.locator('.creation-sidebar').boundingBox();
    const outside = {
      x: sidebar.x + 20,
      y: Math.max(sidebar.y + 20, start.y - 35),
    };
    if (space) await page.keyboard.down('Space');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ button });
    await page.mouse.move(start.x + 55, start.y - 30, { steps: 5 });
    await page.mouse.move(outside.x, outside.y, { steps: 5 });
    await page.mouse.up({ button });
    if (space) await page.keyboard.up('Space');
    await settle();
    const afterView = (await call('state')).view;
    check(
      Math.hypot(afterView.x - beforeView.x, afterView.y - beforeView.y) > 1,
      label + ' over a portal face pans even when released outside the stage',
    );
    check(
      unchangedPaths(await call('get_project'), beforeProject),
      label + ' leaves source paths unchanged',
    );
  };
  await pan('left', true, 'Space drag');
  await pan('middle', false, 'middle-button drag');
  return { ok: true, checks };
};
