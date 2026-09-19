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
  const rectangle = (id, groupId, x, y, w, h) => {
    const anchors = [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
      { x, y },
    ];
    return {
      id,
      name: id,
      groupId,
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
    };
  };
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
      imageName: 'Object move fixture',
      widthMM: 100,
      depthMM: 2,
      groups: [
        { id: 'pair', name: 'Pair' },
        { id: 'other', name: 'Other' },
      ],
      paths: [
        rectangle('pair-left', 'pair', 120, 130, 100, 160),
        rectangle('pair-right', 'pair', 250, 130, 100, 160),
        rectangle('other-path', 'other', 400, 130, 90, 160),
      ],
    },
  });
  await settle();
  await page.getByRole('button', { name: '平面创作', exact: true }).click();
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
  const pair = 'object-group-pair';
  const other = 'object-group-other';
  const choose = async (ids) => {
    for (let i = 0; i < ids.length; i++) {
      await page.locator(`[data-tree-object="${ids[i]}"]`).click({
        position: { x: 60, y: 12 },
        modifiers: i ? ['Shift'] : [],
      });
    }
    assert.deepEqual((await call('state')).creation.selection, {
      kind: 'object',
      ids,
    });
  };
  const drag = async (point, dx = 28, dy = 22) => {
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + dx, point.y + dy, { steps: 4 });
  };
  const idle = async () => {
    await settle();
    assert.equal((await call('state')).gesturing, false);
  };
  const undo = async () => {
    await page.keyboard.press('Control+z');
    await idle();
    assert.deepEqual(
      await paths(),
      before,
      'one undo restores all moved geometry',
    );
  };
  const verifyTranslation = async (ids) => {
    const after = await paths();
    const first = before.findIndex((p) => ids.includes(p.id));
    const dx = after[first].curves[0][0].x - before[first].curves[0][0].x;
    const dy = after[first].curves[0][0].y - before[first].curves[0][0].y;
    assert(dx !== 0 && dy !== 0, 'drag must translate selected objects');
    before.forEach((path, index) => {
      if (!ids.includes(path.id)) assert.deepEqual(after[index], path);
      else
        path.curves.forEach((curve, ci) =>
          curve.forEach((point, pi) => {
            assert.equal(after[index].curves[ci][pi].x, point.x + dx);
            assert.equal(after[index].curves[ci][pi].y, point.y + dy);
          }),
        );
    });
  };
  await page.keyboard.press('v');
  for (const [x, y] of [
    [170, 210],
    [170, 130],
  ]) {
    await choose([pair]);
    await drag(await at(x, y));
    await page.mouse.up();
    await idle();
    assert.deepEqual(
      await paths(),
      before,
      'V leaves grouped geometry unchanged',
    );
  }
  checks.push('V cannot move a group from either its face or source line');

  for (const [kind, x, y] of [
    ['face', 170, 210],
    ['source', 300, 130],
  ]) {
    await choose([pair]);
    await page.keyboard.press('h');
    assert.equal((await call('state')).tool, 'move');
    await drag(await at(x, y));
    await page.mouse.up();
    await idle();
    await verifyTranslation(['pair-left', 'pair-right']);
    assert.deepEqual((await call('state')).creation.selection, {
      kind: 'object',
      ids: [pair],
    });
    await undo();
    checks.push(
      `H moves every source in the group from its ${kind}, in one undo`,
    );
  }
  await choose([pair, other]);
  await page.keyboard.press('h');
  await drag(await at(170, 210));
  await page.mouse.up();
  await idle();
  await verifyTranslation(before.map((p) => p.id));
  assert.deepEqual((await call('state')).creation.selection, {
    kind: 'object',
    ids: [pair, other],
  });
  await undo();
  checks.push('H preserves and moves the complete multi-object selection');

  await choose([pair]);
  await page.keyboard.press('h');
  const center = await at(170, 210);
  await drag(center, 2, 1);
  await page.mouse.up();
  await idle();
  assert.deepEqual(await paths(), before);
  checks.push('sub-threshold pointer jitter leaves objects unchanged');

  for (const event of [
    'Escape',
    'pointercancel',
    'lostpointercapture',
    'blur',
  ]) {
    await choose([pair]);
    await page.keyboard.press('h');
    await page.evaluate(() => {
      document.querySelector('.stage').addEventListener(
        'pointerdown',
        (e) => {
          window.__objectMovePointerId = e.pointerId;
        },
        { once: true, capture: true },
      );
    });
    await drag(await at(170, 210));
    assert.notDeepEqual(await paths(), before);
    if (event === 'Escape') await page.keyboard.press('Escape');
    else
      await page.evaluate((name) => {
        const stage = document.querySelector('.stage');
        const pointerId = window.__objectMovePointerId;
        if (name === 'blur') window.dispatchEvent(new Event('blur'));
        else if (name === 'lostpointercapture')
          stage.releasePointerCapture(pointerId);
        else
          stage.dispatchEvent(
            new PointerEvent(name, { bubbles: true, pointerId }),
          );
      }, event);
    await page.mouse.up();
    await idle();
    await page.mouse.move(center.x + 60, center.y + 50);
    assert.deepEqual(
      await paths(),
      before,
      `${event} must cancel the entire move`,
    );
    checks.push(`${event} restores every source and cannot resume on hover`);
  }

  await choose([pair]);
  await page.keyboard.press('h');
  await drag(await at(170, 210));
  const stage = await page.locator('.stage').boundingBox();
  assert(stage && stage.x > 1);
  await page.mouse.move(stage.x - 1, center.y, { steps: 4 });
  await page.mouse.up();
  await idle();
  const released = await paths();
  await page.mouse.move(center.x, center.y);
  assert.deepEqual(await paths(), released);
  await undo();
  checks.push('release outside the canvas ends the move and remains one undo');

  for (const [label, x, y, tool] of [
    ['face', 170, 210, 'h'],
    ['source', 170, 130, 'v'],
    ['blank', 80, 350, 'h'],
    ['node', 120, 130, 'a'],
  ]) {
    await call('set_view', { fit: true });
    await choose([pair]);
    await page.keyboard.press(tool);
    if (tool === 'a') {
      const edge = await at(170, 130);
      await page.mouse.click(edge.x, edge.y);
      const node = await at(x, y);
      await page.mouse.click(node.x, node.y);
    }
    const original = await call('state');
    const project = await call('get_project');
    const point = await at(x, y);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(point.x + 26, point.y + 19, { steps: 4 });
    await page.mouse.up({ button: 'right' });
    await idle();
    const state = await call('state');
    assert.notDeepEqual(
      state.view,
      original.view,
      `${label} right-drag must pan`,
    );
    assert.deepEqual(
      await call('get_project'),
      project,
      `${label} pan cannot edit project`,
    );
    assert.deepEqual(state.creation.selection, original.creation.selection);
    assert.deepEqual(state.selectedNodes, original.selectedNodes);
    assert.equal(state.active, original.active);
    assert.equal(state.tool, original.tool);
    checks.push(
      `right-drag on ${label} pans without changing geometry or selection`,
    );
  }
  await page.evaluate(() => delete window.__objectMovePointerId);
  return { ok: true, checks };
};
