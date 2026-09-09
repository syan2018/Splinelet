async (page) => {
  const call = async (action, args = {}) => {
    const result = await page.evaluate(
      ({ action, args }) => window.traceStudio.call(action, args),
      { action, args },
    );
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve)),
    );
    return result;
  };
  const check = (ok, message) => {
    if (!ok) throw Error(message);
  };
  await page.waitForFunction(
    () => window.traceStudio && window.traceStudio.call,
  );
  await page.waitForFunction(
    async () => (await window.traceStudio.call('state')).ready,
  );
  const image = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 400;
    const x = c.getContext('2d');
    x.fillStyle = 'white';
    x.fillRect(0, 0, 400, 400);
    x.strokeStyle = 'black';
    x.lineWidth = 6;
    x.beginPath();
    x.moveTo(40, 100);
    x.bezierCurveTo(80, 20, 220, 20, 260, 100);
    x.stroke();
    return c.toDataURL();
  });
  await page.keyboard.up('Shift');
  await page.keyboard.up('Alt');
  const base = await call('get_project');
  await call('load_project', {
    project: {
      ...base,
      image,
      imageName: 'Shortcut test',
      width: 400,
      height: 400,
      paths: [],
    },
  });
  await page.waitForFunction(
    async () => (await window.traceStudio.call('state')).ready,
  );
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.waitForFunction(
    async () => (await window.traceStudio.call('state')).ready,
  );
  const box = await page.locator('svg image').boundingBox();
  const at = (x, y) => ({
    x: box.x + (x / 400) * box.width,
    y: box.y + (y / 400) * box.height,
  });
  const click = async (x, y) => {
    const before = (await call('state')).paths.reduce(
      (n, p) => n + p.anchors.length,
      0,
    );
    const p = at(x, y);
    await page.mouse.click(p.x, p.y);
    await page
      .getByRole('button', {
        name: '路径 1 开放 · ' + before + ' 段',
        exact: true,
      })
      .waitFor();
  };
  await page.getByRole('button', { name: '描线 (P)', exact: true }).click();
  await page.keyboard.down('Shift');
  await click(44, 94);
  let doc = await call('get_project');
  let trace = doc.paths.at(-1);
  const traceId = trace.id;
  check(
    Math.hypot(trace.start.x - 44, trace.start.y - 94) < 0.7,
    'Shift first anchor must be exact',
  );
  await click(256, 94);
  doc = await call('get_project');
  trace = doc.paths.at(-1);
  check(
    trace.curves.length === 1,
    'single cubic invariant ' +
      JSON.stringify(
        doc.paths.map((p) => ({
          id: p.id,
          n: p.curves.length,
          anchors: p.anchors,
        })),
      ),
  );
  check(
    Math.hypot(trace.curves[0][3].x - 256, trace.curves[0][3].y - 94) < 0.7,
    'Shift endpoint must be exact',
  );
  check(
    Math.abs(trace.curves[0][1].y - trace.start.y) > 5,
    'Shift must retain image fitting',
  );
  const p = at(330, 160);
  await page.mouse.move(p.x, p.y);
  await page.keyboard.up('Shift');
  await page.keyboard.down('Alt');
  check((await call('state')).modifiers.altKey, 'Alt is active');
  check(
    (await page.locator('.canvas-hint').textContent()).includes('Alt'),
    'Alt hint visible',
  );
  await click(330, 160);
  doc = await call('get_project');
  trace = doc.paths.find((p) => p.id === traceId);
  const c = trace.curves.at(-1);
  check(trace.curves.length === 2, 'Alt adds exactly one segment');
  check(Math.hypot(c[3].x - 330, c[3].y - 160) < 0.7, 'Alt endpoint unsnapped');
  check(
    Math.abs(
      (c[1].x - c[0].x) * (c[3].y - c[0].y) -
        (c[1].y - c[0].y) * (c[3].x - c[0].x),
    ) < 1e-6,
    'Alt straight handles',
  );
  await page.keyboard.up('Alt');
  const released = await call('state');
  check(
    !released.modifiers.altKey &&
      released.settings.snap &&
      released.settings.mode === 'ink',
    'release restores settings',
  );
  await call('select_node', { pathId: traceId, nodeIndex: 0 });
  const before = JSON.stringify(
    (await call('get_project')).paths.find((p) => p.id === traceId).curves[0],
  );
  await page.keyboard.press('l');
  check(
    JSON.stringify(
      (await call('get_project')).paths.find((p) => p.id === traceId).curves[0],
    ) !== before,
    'L replaces failed span',
  );
  await page.keyboard.press('Control+z');
  check(
    JSON.stringify(
      (await call('get_project')).paths.find((p) => p.id === traceId).curves[0],
    ) === before,
    'L undo restores handles',
  );
  const a = await call('create_path', {
    name: 'Merge A',
    points: [
      { x: 50, y: 240 },
      { x: 110, y: 260 },
    ],
    mode: 'manual',
  });
  const b = await call('create_path', {
    name: 'Merge B',
    points: [
      { x: 270, y: 220 },
      { x: 220, y: 270 },
    ],
    mode: 'manual',
  });
  await call('select_node', { pathId: a.id, nodeIndex: 0 });
  await page.keyboard.press('m');
  await page.locator('[data-merge-endpoint]').first().waitFor();
  check(
    (await page.locator('[data-merge-endpoint]').count()) === 4,
    'show both endpoints of other open paths',
  );
  await page
    .getByRole('button', { name: '合并到 Merge B 终点', exact: true })
    .click();
  doc = await call('get_project');
  const merged = doc.paths.find((p) => p.id === a.id);
  check(
    !doc.paths.some((p) => p.id === b.id) && merged.curves.length === 3,
    'UI merge produces one path and bridge',
  );
  check(
    merged.start.x === 110 && merged.curves.at(-1)[3].x === 270,
    'both selected directions reversed correctly',
  );
  await page.keyboard.press('Control+z');
  doc = await call('get_project');
  check(
    doc.paths.some((p) => p.id === a.id) &&
      doc.paths.some((p) => p.id === b.id),
    'merge undo restores both paths',
  );
  await call('select_node', { pathId: a.id, nodeIndex: 0 });
  await page.keyboard.press('m');
  await page.keyboard.press('Escape');
  await page
    .locator('[data-merge-endpoint]')
    .first()
    .waitFor({ state: 'detached' });
  check(
    (await page.locator('[data-merge-endpoint]').count()) === 0,
    'Escape cancels merge',
  );
  console.log(
    JSON.stringify({
      shiftExactAnchors: true,
      shiftStillFits: true,
      altStraight: true,
      releaseRestoresSettings: true,
      LReplacementAndUndo: true,
      mergeMouseEndpointAndUndo: true,
      escapeCancels: true,
    }),
  );
}
