module.exports = async (page) => {
  const assert = require('node:assert/strict');
  const checks = [];
  const nearPoint = (a, b) =>
    assert(Math.hypot(a.x - b.x, a.y - b.y) < 0.001, JSON.stringify({ a, b }));
  const call = require('./harness/legacy-call.cjs').legacyCaller(page);
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
  const point = (x, y) => ({ x, y });
  const base = {
    id: 'continue-test',
    name: '端点续画测试',
    color: '#a59883',
    visible: true,
    closed: false,
    quality: 0.9,
    fitError: 0.4,
    start: point(200, 200),
    curves: [
      [point(200, 200), point(220, 175), point(240, 175), point(260, 200)],
      [point(260, 200), point(280, 225), point(300, 160), point(330, 180)],
    ],
    nodeModes: ['corner', 'smooth', 'corner'],
  };
  base.anchors = [base.start, ...base.curves.map((c) => c[3])];
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 450;
    const c = canvas.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, 600, 450);
    c.strokeStyle = '#111';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(110, 300);
    c.bezierCurveTo(95, 220, 150, 160, 200, 200);
    c.bezierCurveTo(220, 175, 240, 175, 260, 200);
    c.bezierCurveTo(280, 225, 300, 160, 330, 180);
    c.bezierCurveTo(380, 160, 410, 250, 440, 270);
    c.stroke();
    return canvas.toDataURL();
  });
  const fixture = {
    version: 1,
    width: 600,
    height: 450,
    image,
    imageName: '两端续画测试',
    widthMM: 100,
    depthMM: 2,
    paths: [
      base,
      {
        ...base,
        id: 'other',
        name: '另一条样条',
        start: point(400, 330),
        curves: [
          [point(400, 330), point(420, 300), point(450, 300), point(470, 330)],
        ],
        anchors: [point(400, 330), point(470, 330)],
        nodeModes: ['corner', 'corner'],
      },
    ],
  };
  await call('load_project', { project: fixture });
  await settle();
  await page.getByRole('button', { name: '平面创作', exact: true }).click();
  await call('select_path', { id: base.id });
  await settle();
  await page.getByRole('button', { name: '当前选区属性', exact: true }).click();
  const before = await call('get_project');
  const current = async () =>
    (await call('get_project')).paths.find((p) => p.id === base.id);
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
  const click = async (x, y, keys = ['Alt']) => {
    const p = await at(x, y);
    for (const key of keys) await page.keyboard.down(key);
    await page.mouse.click(p.x, p.y);
    for (const key of keys.slice().reverse()) await page.keyboard.up(key);
    await settle();
  };
  const undo = async () => {
    await page.keyboard.press('Control+z');
    await settle();
  };
  await page.getByRole('button', { name: '从头续画', exact: true }).click();
  assert.deepEqual(await call('get_project'), before);
  assert.deepEqual((await call('state')).drawing, {
    pathId: base.id,
    end: 'start',
  });
  const hover = await at(110, 300);
  await page.keyboard.down('Alt');
  await page.mouse.move(hover.x, hover.y);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.drawing-canvas path')].some(
      (p) => p.getAttribute('stroke') === '#ffffff',
    ),
  );
  const preview = await page
    .locator('.drawing-canvas path[stroke="#ffffff"]')
    .getAttribute('d');
  assert.match(preview, /^M\s*200[ ,]+200/);
  await page.keyboard.up('Alt');
  await click(110, 300);
  let extended = await current();
  assert.equal(extended.curves.length, 3);
  assert.deepEqual(extended.curves.slice(1), base.curves);
  nearPoint(extended.start, point(110, 300));
  assert.deepEqual(extended.nodeModes, ['corner', ...base.nodeModes]);
  checks.push(
    'head resume and preview use the head; Alt click prepends exactly one cubic and preserves existing handles and modes',
  );
  await page.keyboard.press('l');
  await settle();
  assert.deepEqual((await current()).curves.slice(1), base.curves);
  await undo();
  await undo();
  assert.deepEqual(await call('get_project'), before);
  await page.keyboard.press('Control+Shift+z');
  await settle();
  assert.deepEqual(await current(), extended);
  await undo();
  await page.keyboard.press('Escape');
  assert.equal((await call('state')).drawing, null);
  checks.push(
    'L addresses the head extension; undo/redo and cancelling continuation preserve the exact original document',
  );
  await page.getByRole('button', { name: '从尾续画', exact: true }).click();
  await click(440, 270);
  extended = await current();
  assert.deepEqual(extended.curves.slice(0, -1), base.curves);
  assert.equal(extended.anchors.length, 4);
  await page.getByRole('button', { name: '从头续画', exact: true }).click();
  assert.deepEqual(await current(), extended);
  await click(110, 300);
  assert.equal((await current()).curves.length, 4);
  assert.deepEqual((await current()).curves.slice(1, -1), base.curves);
  checks.push(
    'tail continuation and switching to the head retain both previous extensions without reversing the original path',
  );
  await page.keyboard.down('Alt');
  await page.locator('[data-trace-endpoint="end"]').click();
  await page.keyboard.up('Alt');
  await settle();
  const closed = await current();
  assert.equal(closed.closed, true);
  assert.equal(closed.curves.length, 5);
  assert.equal(closed.anchors.length, 5);
  assert.deepEqual(closed.curves.at(-1)[0], closed.curves.at(-2)[3]);
  assert.deepEqual(closed.curves.at(-1)[3], closed.start);
  assert.equal((await call('state')).drawing, null);
  await assert.rejects(
    call('resume_path', { pathId: base.id, end: 'start' }),
    /开放样条/,
  );
  await undo();
  await page.getByRole('button', { name: '从头续画', exact: true }).click();
  await page.keyboard.press('Control+Shift+z');
  await settle();
  assert.equal((await current()).closed, true);
  assert.equal((await call('state')).drawing, null);
  await undo();
  await page.getByRole('button', { name: '从头续画', exact: true }).click();
  await page.keyboard.press('Escape');
  await undo();
  await undo();
  assert.deepEqual(await call('get_project'), before);
  checks.push(
    'clicking the opposite tail closes head continuation with one cubic; closed paths reject resume and undo reopens safely',
  );
  await page.getByRole('button', { name: '节点 (A)', exact: true }).click();
  await page.locator('[data-node-index="0"]').click();
  assert(
    await page
      .getByRole('button', { name: '从此端点续画', exact: false })
      .isVisible(),
  );
  await page.keyboard.press('e');
  assert.equal((await call('state')).drawing.end, 'start');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '节点 (A)', exact: true }).click();
  await page.locator('[data-node-index="2"]').dblclick();
  assert.equal((await call('state')).drawing.end, 'end');
  await page.keyboard.press('Escape');
  checks.push(
    'selected endpoint E and endpoint double-click resume the correct end without adding geometry',
  );
  await page.getByRole('button', { name: '节点 (A)', exact: true }).click();
  await page.locator('[data-node-index="1"]').click();
  assert.equal(
    await page
      .getByRole('button', { name: '从此端点续画', exact: false })
      .count(),
    0,
  );
  await page.getByRole('button', { name: /前一段改为直连/ }).click();
  await settle();
  assert.deepEqual((await current()).curves[1], base.curves[1]);
  await undo();
  await page.locator('[data-node-index="1"]').click();
  await page
    .getByLabel('节点连接模式', { exact: true })
    .selectOption('symmetric');
  await settle();
  assert.equal((await current()).nodeModes[1], 'symmetric');
  await undo();
  await page.locator('[data-node-index="1"]').click();
  await page.getByText('选择与删除', { exact: true }).click();
  await page.getByRole('button', { name: /取消节点选择/ }).click();
  assert.deepEqual((await call('state')).selectedNodes, []);
  checks.push(
    'internal nodes hide endpoint actions; explicit adjacent-span edits, continuity and deselection target only their selection',
  );
  await call('resume_path', { pathId: base.id, end: 'start' });
  await click(110, 300, ['Shift']);
  extended = await current();
  assert.equal(extended.curves.length, 3);
  nearPoint(extended.start, point(110, 300));
  assert.deepEqual(extended.curves.slice(1), base.curves);
  const c = extended.curves[0];
  assert(
    Math.abs(
      (c[1].x - c[0].x) * (c[3].y - c[0].y) -
        (c[1].y - c[0].y) * (c[3].x - c[0].x),
    ) > 1,
  );
  await undo();
  await page.keyboard.press('Escape');
  checks.push(
    'real image fitting from the head follows a curved guide while Shift keeps the exact click and original cubics',
  );
  await call('resume_path', { pathId: base.id, end: 'start' });
  await call('add_anchor', { position: point(110, 300), mode: 'manual' });
  await call('finish_path');
  await settle();
  assert.equal((await call('state')).drawing, null);
  assert.deepEqual((await current()).curves.slice(1), base.curves);
  await undo();
  assert.deepEqual(await call('get_project'), before);
  checks.push(
    'agent continuation API shares the same direction, geometry and one-step undo as the UI',
  );
  return { ok: true, checks };
};
