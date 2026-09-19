module.exports = async (page) => {
  const assert = require('node:assert/strict');
  const checks = [];
  const call = async (action, args = {}) => {
    await page.waitForFunction(() => window.traceStudio);
    return page.evaluate(
      ({ action, args }) => window.traceStudio.call(action, args),
      { action, args },
    );
  };
  const settle = async () => {
    await page.waitForFunction(
      async () =>
        window.traceStudio &&
        (await window.traceStudio.call('state')).ready &&
        !(await window.traceStudio.call('state')).busy,
    );
    await page.locator('.creation-updating').waitFor({ state: 'hidden' });
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
  };
  const anchors = [
    { x: 180, y: 140 },
    { x: 420, y: 140 },
    { x: 420, y: 310 },
    { x: 180, y: 310 },
    { x: 180, y: 140 },
  ];
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 450;
    return canvas.toDataURL();
  });
  await call('load_project', {
    project: {
      version: 1,
      width: 600,
      height: 450,
      image,
      imageName: 'Pointer lifecycle fixture',
      widthMM: 100,
      depthMM: 2,
      paths: [
        {
          id: 'pointer-rectangle',
          name: 'Pointer rectangle',
          color: '#a59883',
          visible: true,
          closed: true,
          quality: 0.9,
          fitError: 0.4,
          start: anchors[0],
          anchors,
          nodeModes: anchors.slice(1).map(() => 'corner'),
          curves: anchors
            .slice(1)
            .map((end, i) => [anchors[i], anchors[i], end, end]),
        },
      ],
    },
  });
  await settle();
  await page.getByRole('button', { name: '平面创作', exact: true }).click();
  await page.keyboard.press('v');
  await call('set_view', { fit: true });
  await settle();
  const at = (x, y) =>
    page
      .locator('.drawing-canvas > g')
      .first()
      .evaluate(
        (el, p) => {
          const q = new DOMPoint(p.x, p.y).matrixTransform(el.getScreenCTM());
          return { x: q.x, y: q.y };
        },
        { x, y },
      );
  const paths = async () => (await call('get_project')).paths;
  const before = await paths();
  const idle = async () => {
    await settle();
    assert.equal(
      (await call('state')).gesturing,
      false,
      'pointer gesture must end',
    );
  };
  const edge = await at(300, 140);
  const node = await at(180, 140);
  const beginDrag = async () => {
    await page.mouse.move(node.x, node.y);
    await page.mouse.down();
    await page.mouse.move(node.x + 28, node.y + 22, { steps: 4 });
    assert.equal((await call('state')).gesturing, true);
    assert.notDeepEqual(await paths(), before, 'drag should move geometry');
  };
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  await page.mouse.move(edge.x + 1, edge.y + 1);
  await page.mouse.up();
  await idle();
  await page.mouse.move(edge.x + 55, edge.y + 45);
  assert.deepEqual(
    await paths(),
    before,
    'click jitter and later hover must not move paths',
  );
  assert.deepEqual((await call('state')).creation.selection, {
    kind: 'path',
    ids: ['pointer-rectangle'],
  });
  checks.push(
    'path click with one-pixel jitter ends cleanly and later hover cannot move geometry',
  );

  const center = await at(300, 225);
  for (const [kind, point] of [
    ['path', edge],
    ['cell', center],
  ]) {
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 45, point.y + 35, { steps: 5 });
    assert.equal((await call('state')).gesturing, false);
    assert.deepEqual(await paths(), before, `V cannot drag a ${kind}`);
    await page.mouse.up();
    await idle();
    assert.equal((await call('state')).creation.selection.kind, kind);
    await page.keyboard.press('l');
    await page.keyboard.press('Delete');
    await idle();
    assert.deepEqual(await paths(), before, `V L/Delete cannot edit ${kind}`);
    checks.push(`V ${kind} drag and L/Delete leave geometry unchanged`);
  }

  await page.keyboard.press('a');
  await settle();
  await page.mouse.click(node.x, node.y);
  const second = await at(420, 140);
  await page.keyboard.down('Shift');
  await page.mouse.click(second.x, second.y);
  await page.keyboard.up('Shift');
  assert.deepEqual(
    [...(await call('state')).selectedNodes].sort((a, b) => a - b),
    [0, 1],
    'Shift selects two nodes in the active path',
  );
  await beginDrag();
  await page.mouse.up();
  await idle();
  const multiMoved = (await paths())[0];
  const dx = multiMoved.curves[0][0].x - before[0].curves[0][0].x;
  const dy = multiMoved.curves[0][0].y - before[0].curves[0][0].y;
  assert(dx !== 0 && dy !== 0);
  for (const index of [0, 1]) {
    assert.equal(
      multiMoved.curves[index][0].x,
      before[0].curves[index][0].x + dx,
    );
    assert.equal(
      multiMoved.curves[index][0].y,
      before[0].curves[index][0].y + dy,
    );
  }
  for (const index of [2, 3])
    assert.deepEqual(multiMoved.curves[index][0], before[0].curves[index][0]);
  await page.keyboard.press('Control+z');
  await idle();
  assert.deepEqual(
    await paths(),
    before,
    'one undo restores a multi-node drag',
  );
  checks.push('A Shift multi-select moves only selected nodes in one undo');

  await page.keyboard.press('Control+a');
  assert.deepEqual(
    [...(await call('state')).selectedNodes].sort((a, b) => a - b),
    [0, 1, 2, 3],
    'A Ctrl+A selects every node of the current path',
  );
  await beginDrag();
  await page.mouse.up();
  await idle();
  const allMoved = (await paths())[0];
  const allDx = allMoved.curves[0][0].x - before[0].curves[0][0].x;
  const allDy = allMoved.curves[0][0].y - before[0].curves[0][0].y;
  for (let index = 0; index < 4; index++)
    for (let point = 0; point < 4; point++) {
      assert.equal(
        allMoved.curves[index][point].x,
        before[0].curves[index][point].x + allDx,
      );
      assert.equal(
        allMoved.curves[index][point].y,
        before[0].curves[index][point].y + allDy,
      );
    }
  await page.keyboard.press('Control+z');
  await idle();
  assert.deepEqual(await paths(), before, 'one undo restores all-node drag');
  checks.push('A Ctrl+A moves every node and control handle in one undo');
  await page.mouse.click(node.x, node.y);

  await beginDrag();
  await page.mouse.up();
  await idle();
  const moved = await paths();
  await page.mouse.move(edge.x + 80, edge.y + 80);
  assert.deepEqual(
    await paths(),
    moved,
    'released drag cannot continue on hover',
  );
  await page.keyboard.press('Control+z');
  await idle();
  assert.deepEqual(
    await paths(),
    before,
    'one undo restores the complete drag',
  );
  checks.push(
    'real drag commits once, releases capture, and one undo restores its geometry',
  );

  await beginDrag();
  const stage = await page.locator('.stage').boundingBox();
  assert(
    stage && stage.x > 1,
    'fixture requires visible space outside the stage',
  );
  await page.mouse.move(stage.x - 1, edge.y, { steps: 5 });
  await page.mouse.up();
  await idle();
  const outside = await paths();
  await page.mouse.move(edge.x, edge.y);
  assert.deepEqual(
    await paths(),
    outside,
    'outside release cannot leave a moving object',
  );
  await page.keyboard.press('Control+z');
  await idle();
  assert.deepEqual(await paths(), before);
  checks.push(
    'release outside the canvas completes the drag and remains a single undo',
  );

  for (const event of ['pointercancel', 'lostpointercapture', 'blur']) {
    await page.evaluate(() => {
      window.__pointerLifecycleId = null;
      document.querySelector('.stage').addEventListener(
        'pointerdown',
        (e) => {
          window.__pointerLifecycleId = e.pointerId;
        },
        { once: true, capture: true },
      );
    });
    await beginDrag();
    await page.evaluate((name) => {
      if (name === 'blur') window.dispatchEvent(new Event('blur'));
      else {
        const stage = document.querySelector('.stage');
        const pointerId = window.__pointerLifecycleId;
        if (name === 'lostpointercapture')
          stage.releasePointerCapture(pointerId);
        else
          stage.dispatchEvent(
            new PointerEvent(name, { bubbles: true, pointerId }),
          );
      }
    }, event);
    await page.mouse.up();
    await idle();
    assert.deepEqual(
      await paths(),
      before,
      `${event} restores the pre-drag geometry`,
    );
    await page.mouse.move(edge.x + 70, edge.y + 60);
    assert.deepEqual(await paths(), before, `${event} cannot resume on hover`);
    checks.push(
      `${event} cancels the gesture and restores its original geometry`,
    );
  }

  await page.keyboard.press('v');
  await page.mouse.click(center.x, center.y);
  await idle();
  const selection = (await call('state')).creation.selection;
  assert.equal(selection.kind, 'cell');
  assert.equal(selection.ids.length, 1);
  await page.mouse.move(center.x + 45, center.y + 35);
  assert.deepEqual((await call('state')).creation.selection, selection);
  assert.deepEqual(await paths(), before);
  checks.push(
    'face click retains its semantic cell selection and cannot leave a drag behind',
  );
  await page.evaluate(() => delete window.__pointerLifecycleId);
  return { ok: true, checks };
};
