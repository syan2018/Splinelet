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
  const visualPositions = () =>
    page.locator('.source-path-layer, .creation-cell').evaluateAll((els) =>
      els.map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          id:
            el.getAttribute('data-source-id') ||
            el.getAttribute('data-creation-cell'),
          owner:
            el.getAttribute('data-source-id') ||
            el.getAttribute('data-object-id'),
          x: rect.x,
          y: rect.y,
        };
      }),
    );
  const verifyPreview = async (original, owners, dx = 28, dy = 22) => {
    assert.deepEqual(
      await paths(),
      before,
      'preview must not publish edited source geometry',
    );
    assert.equal(
      (await call('state')).gesturing,
      true,
      'preview must expose the active gesture',
    );
    const current = await visualPositions();
    for (const item of original) {
      const actual = current.find((value) => value.id === item.id);
      assert(actual, `preview retains ${item.id}`);
      const moving = owners.includes(item.owner);
      assert(
        Math.abs(actual.x - item.x - (moving ? dx : 0)) < 0.5,
        `${item.id} preview x`,
      );
      assert(
        Math.abs(actual.y - item.y - (moving ? dy : 0)) < 0.5,
        `${item.id} preview y`,
      );
    }
  };
  const objects = (await call('get_project')).creation.objects;
  const pair = objects.find((object) => object.name === 'Pair').id;
  const other = objects.find((object) => object.name === 'Other').id;
  const pairPaths = before
    .filter((path) => path.name.startsWith('pair-'))
    .map((path) => path.id);
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
            assert(
              Math.abs(after[index].curves[ci][pi].x - point.x - dx) < 1e-8,
            );
            assert(
              Math.abs(after[index].curves[ci][pi].y - point.y - dy) < 1e-8,
            );
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
    await choose([other]);
    await page.keyboard.press('h');
    await drag(await at(x, y));
    assert.equal((await call('state')).gesturing, false);
    assert.deepEqual((await call('state')).creation.selection, {
      kind: 'object',
      ids: [pair],
    });
    await page.mouse.up();
    await idle();
    assert.deepEqual(
      await paths(),
      before,
      'first press on an unselected object only selects',
    );
    checks.push(
      `first ${kind} drag on an unselected group selects without moving`,
    );
  }

  for (const modifier of ['Shift', 'Control', 'Meta']) {
    await choose([pair]);
    await page.keyboard.press('h');
    await page.keyboard.down(modifier);
    await drag(await at(440, 210));
    await page.mouse.up();
    await page.keyboard.up(modifier);
    await idle();
    assert.deepEqual(await paths(), before);
    assert.deepEqual((await call('state')).creation.selection, {
      kind: 'object',
      ids: [pair, other],
    });
    checks.push(`${modifier} drag only changes selection`);
  }

  for (const [kind, x, y] of [
    ['face', 170, 210],
    ['source', 300, 130],
  ]) {
    await choose([pair]);
    await page.keyboard.press('h');
    assert.equal((await call('state')).tool, 'move');
    const visualBefore = await visualPositions();
    const projectBefore = await call('get_project');
    await drag(await at(x, y));
    await verifyPreview(visualBefore, [pair, ...pairPaths]);
    assert.deepEqual(
      await call('get_project'),
      projectBefore,
      'pointermove leaves the entire project unchanged',
    );
    await page.mouse.up();
    await idle();
    await verifyTranslation(pairPaths);
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
  const multiVisualBefore = await visualPositions();
  await drag(await at(170, 210));
  await verifyPreview(multiVisualBefore, [
    pair,
    other,
    ...before.map((p) => p.id),
  ]);
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
    const visualBefore = await visualPositions();
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
    await verifyPreview(visualBefore, [pair, ...pairPaths]);
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
    assert.deepEqual(
      await visualPositions(),
      visualBefore,
      `${event} clears the display preview`,
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
  // A larger reproducible scene catches accidental per-move document publication.
  const groups = Array.from({ length: 20 }, (_, i) => ({
    id: 'load-' + i,
    name: 'Load ' + i,
  }));
  await call('load_project', {
    project: {
      version: 1,
      width: 600,
      height: 450,
      image,
      imageName: 'Move load fixture',
      widthMM: 100,
      depthMM: 2,
      groups,
      paths: groups.flatMap((group, i) =>
        Array.from({ length: 4 }, (_, j) =>
          rectangle(
            group.id + '-' + j,
            group.id,
            20 + i * 28,
            40 + j * 85,
            18,
            55,
          ),
        ),
      ),
    },
  });
  await settle();
  await call('set_view', { fit: true });
  const loadProject = await call('get_project');
  await choose([
    loadProject.creation.objects.find((o) => o.name === 'Load 0').id,
  ]);
  await page.keyboard.press('h');
  const loadStart = await at(29, 65);
  await page.mouse.move(loadStart.x, loadStart.y);
  await page.mouse.down();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => {
    let start = 0;
    const durations = [];
    let geometryWrites = 0;
    const capture = () => {
      start = performance.now();
    };
    const bubble = () => {
      durations.push(performance.now() - start);
    };
    const observer = new MutationObserver((changes) => {
      geometryWrites += changes.length;
    });
    observer.observe(document.querySelector('.drawing-canvas'), {
      subtree: true,
      attributes: true,
      attributeFilter: ['d'],
    });
    window.addEventListener('pointermove', capture, true);
    window.addEventListener('pointermove', bubble);
    window.__finishMoveMeasure = () => {
      observer.disconnect();
      window.removeEventListener('pointermove', capture, true);
      window.removeEventListener('pointermove', bubble);
      durations.sort((a, b) => a - b);
      return {
        pointerMoves: durations.length,
        p95HandlerMs: durations[Math.floor(durations.length * 0.95)],
        geometryWrites,
      };
    };
  });
  for (let i = 1; i <= 60; i++)
    await page.mouse.move(loadStart.x + i / 2, loadStart.y + i / 3);
  const performance = await page.evaluate(() => {
    const value = window.__finishMoveMeasure();
    delete window.__finishMoveMeasure;
    return value;
  });
  assert.equal(
    performance.geometryWrites,
    0,
    'object preview never rebuilds SVG geometry',
  );
  assert.deepEqual(
    await call('get_project'),
    loadProject,
    'larger scene stays unchanged throughout the preview',
  );
  await page.mouse.up();
  await idle();
  assert.notDeepEqual((await call('get_project')).paths, loadProject.paths);
  await page.keyboard.press('Control+z');
  await idle();
  assert.deepEqual((await call('get_project')).paths, loadProject.paths);
  checks.push(
    '80-source scene previews 60 pointer moves without geometry writes and commits in one undo',
  );
  return { ok: true, checks, performance };
};
