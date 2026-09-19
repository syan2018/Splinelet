// Run on a dedicated Playwright page. It restores the project it was given.
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
  const saved = await call('get_project');
  const path = (id, groupId, points, closed = true) => {
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
  const rectangle = (x0, y0, x1, y1) => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ];
  const object = (id, name, groupId, pathIds, roles, heightMM = 1) => ({
    id,
    name,
    groupId,
    pathIds,
    roles,
    featureIds: [],
    regionIds: [],
    featureSwatches: {},
    swatchId: id,
    heightMM,
    zMM: 0,
    visible: true,
    printable: true,
    paints: [],
    fillAll: true,
  });
  const fixture = {
    ...saved,
    version: 3,
    imageName: 'creation-3d-pick-fixture',
    width: 1200,
    height: 900,
    widthMM: 120,
    depthMM: 1,
    model: {
      version: 1,
      toleranceMM: 0.015,
      regions: [],
      features: [],
      parts: [{ id: 'main', name: '测试零件' }],
    },
    groups: [
      { id: 'base', name: '底层' },
      { id: 'overlay', name: '同高上层' },
      { id: 'raised', name: '更高下绘制层' },
    ],
    paths: [
      path('base-outline', 'base', rectangle(200, 150, 1000, 750)),
      path('overlay-outline', 'overlay', rectangle(400, 300, 850, 650)),
      path('overlay-hole', 'overlay', rectangle(550, 425, 675, 550)),
      path('raised-outline', 'raised', rectangle(440, 340, 540, 440)),
    ],
    creation: {
      version: 1,
      swatches: [
        { id: 'base', name: '底层', color: '#f3ead7' },
        { id: 'overlay', name: '上层', color: '#56aa8d' },
        { id: 'raised', name: '高层', color: '#dba955' },
      ],
      // Raised is deliberately created before overlay. Its height, not draw
      // order, must win where it overlaps the later coplanar overlay.
      objects: [
        object('base', '底层', 'base', ['base-outline'], {
          'base-outline': 'boundary',
        }),
        object(
          'raised',
          '更高下绘制层',
          'raised',
          ['raised-outline'],
          { 'raised-outline': 'boundary' },
          4,
        ),
        object(
          'overlay',
          '同高上层',
          'overlay',
          ['overlay-outline', 'overlay-hole'],
          { 'overlay-outline': 'boundary', 'overlay-hole': 'hole' },
        ),
      ],
    },
  };
  const polygonRings = (geometry) =>
    geometry.type === 'Polygon'
      ? geometry.coordinates
      : geometry.coordinates[0];
  const points = (geometry) => polygonRings(geometry).flat();
  const bounds = (cells) => {
    const values = cells.flatMap((cell) => points(cell.geometry));
    return {
      minX: Math.min(...values.map((point) => point[0])),
      maxX: Math.max(...values.map((point) => point[0])),
      minY: Math.min(...values.map((point) => point[1])),
      maxY: Math.max(...values.map((point) => point[1])),
      minZ: Math.min(...cells.map((cell) => cell.bottomMM ?? cell.zMM ?? 0)),
      maxZ: Math.max(
        ...cells.map(
          (cell) => (cell.bottomMM ?? cell.zMM ?? 0) + cell.heightMM,
        ),
      ),
    };
  };
  const centerOfRing = (ring) => {
    const unique = ring.slice(0, -1);
    return unique.reduce(
      (result, point) => [
        result[0] + point[0] / unique.length,
        result[1] + point[1] / unique.length,
      ],
      [0, 0],
    );
  };
  const pointInBox = (geometry, xFraction, yFraction) => {
    const values = points(geometry),
      xs = values.map((point) => point[0]),
      ys = values.map((point) => point[1]);
    return [
      Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * xFraction,
      Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * yFraction,
    ];
  };
  // This mirrors CreationView.frameView('top') and its 35° perspective camera.
  const topScreenPoint = (point, z, extent, canvas) => {
    const center = [
      (extent.minX + extent.maxX) / 2,
      (extent.minY + extent.maxY) / 2,
      (extent.minZ + extent.maxZ) / 2,
    ];
    const span = Math.max(
      extent.maxX - extent.minX,
      extent.maxY - extent.minY,
      extent.maxZ - extent.minZ,
      10,
    );
    const d = (span * 1.9) / Math.min(1, canvas.width / canvas.height);
    const position = [center[0], center[1] - 0.001, center[2] + d];
    const normalize = (vector) => {
      const length = Math.hypot(...vector);
      return vector.map((value) => value / length);
    };
    const forward = normalize(
      center.map((value, index) => value - position[index]),
    );
    const right = normalize([forward[1], -forward[0], 0]);
    const up = [
      right[1] * forward[2] - right[2] * forward[1],
      right[2] * forward[0] - right[0] * forward[2],
      right[0] * forward[1] - right[1] * forward[0],
    ];
    const relative = [
      point[0] - position[0],
      point[1] - position[1],
      z - position[2],
    ];
    const dot = (a, b) =>
      a.reduce((sum, value, index) => sum + value * b[index], 0);
    const depth = dot(relative, forward),
      tangent = Math.tan((35 * Math.PI) / 360),
      aspect = canvas.width / canvas.height;
    return {
      x:
        canvas.x +
        canvas.width *
          (0.5 + dot(relative, right) / (2 * depth * tangent * aspect)),
      y:
        canvas.y +
        canvas.height * (0.5 - dot(relative, up) / (2 * depth * tangent)),
    };
  };

  try {
    await call('load_project', { project: fixture });
    await settle();
    await page.getByRole('button', { name: '选择 (V)', exact: true }).click();
    await page.getByRole('button', { name: '立体预览', exact: true }).click();
    const canvas = page.locator('.creation-webgl canvas');
    await canvas.waitFor();
    await page.getByRole('button', { name: '正视', exact: true }).click();
    await settle();
    const scene = await call('creation_inspect');
    const cells = scene.cells.filter((cell) =>
      ['base', 'overlay', 'raised'].includes(cell.objectId),
    );
    const base = cells.find((cell) => cell.objectId === 'base');
    const overlay = cells.find((cell) => cell.objectId === 'overlay');
    const raised = cells.find((cell) => cell.objectId === 'raised');
    check(
      base && overlay && raised,
      'fixture produces the three painted 3D faces',
    );
    const canvasBox = await canvas.boundingBox();
    const extent = bounds(cells);
    const at = (point, cell) =>
      topScreenPoint(
        point,
        (cell.bottomMM ?? cell.zMM ?? 0) + cell.heightMM,
        extent,
        canvasBox,
      );
    const selected = async () => (await call('state')).creation.selectedCells;
    const click = async (point, modifiers) => {
      for (const modifier of modifiers || [])
        await page.keyboard.down(modifier);
      await page.mouse.click(point.x, point.y);
      for (const modifier of modifiers || []) await page.keyboard.up(modifier);
      await settle();
    };
    const overlayOnly = at(pointInBox(overlay.geometry, 0.9, 0.15), overlay);
    const raisedPoint = at(pointInBox(raised.geometry, 0.5, 0.5), raised);
    const overlayHole = centerOfRing(polygonRings(overlay.geometry)[1]);
    const baseThroughHole = at(overlayHole, base);

    await click(overlayOnly);
    assert.deepEqual(await selected(), [overlay.key]);
    checks.push(
      'later coplanar overlay is selected where it is visibly on top',
    );
    await click(baseThroughHole, ['Control']);
    assert.deepEqual(
      new Set(await selected()),
      new Set([overlay.key, base.key]),
    );
    checks.push('Ctrl click through the visible hole adds the lower base face');
    await click(raisedPoint);
    assert.deepEqual(await selected(), [raised.key]);
    checks.push('physically higher face beats a later rendered lower face');

    await page.getByRole('button', { name: '侧视', exact: true }).click();
    await settle();
    assert.deepEqual(await selected(), [raised.key]);
    checks.push('side framing preserves the active selection');
    await page.getByRole('button', { name: '正视', exact: true }).click();
    await settle();
    const stableSelection = await selected();
    await page.mouse.move(raisedPoint.x, raisedPoint.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(raisedPoint.x + 30, raisedPoint.y + 20, { steps: 4 });
    await page.mouse.up({ button: 'right' });
    await settle();
    assert.deepEqual(await selected(), stableSelection);
    checks.push('right-button pan does not select a face');

    await page.getByRole('button', { name: '正视', exact: true }).click();
    await page.keyboard.down('Space');
    await page.mouse.click(overlayOnly.x, overlayOnly.y);
    await page.keyboard.up('Space');
    await settle();
    assert.deepEqual(await selected(), stableSelection);
    checks.push('Space-pan click does not select a face');

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: overlayOnly.x, y: overlayOnly.y, id: 41 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: overlayOnly.x, y: overlayOnly.y, id: 41 },
        { x: overlayOnly.x + 20, y: overlayOnly.y, id: 42 },
      ],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await cdp.detach();
    await settle();
    assert.deepEqual(await selected(), stableSelection);
    checks.push('a second pointer cancels the pending face click');

    await page.mouse.move(overlayOnly.x, overlayOnly.y);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x - 20, overlayOnly.y, { steps: 4 });
    await page.mouse.move(overlayOnly.x, overlayOnly.y, { steps: 3 });
    await page.mouse.up();
    await settle();
    assert.deepEqual(await selected(), stableSelection);
    checks.push(
      'a drag leaving and returning to its start point cannot become a click',
    );
    return { ok: true, checks };
  } finally {
    await call('load_project', { project: saved });
  }
};
