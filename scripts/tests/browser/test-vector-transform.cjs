// Fresh context only; never binds or writes the input project.
module.exports = async (page, outputDirectory) => {
  const assert = require('node:assert/strict');
  const { readFileSync } = require('node:fs');
  const { resolve } = require('node:path');
  const call = (action, args = {}) =>
    page.evaluate(({ action, args }) => window.traceStudio.call(action, args), {
      action,
      args,
    });
  const settled = async () => {
    await call('creation_inspect');
    await page
      .locator('.creation-updating')
      .waitFor({ state: 'hidden', timeout: 90000 });
  };
  await page.waitForFunction(() => window.traceStudio);
  await page
    .locator('input[accept=".spl,.bezier.json,.json"]')
    .setInputFiles(resolve(__dirname, '../../../public/sandrone-example.spl'));
  await page.waitForFunction(async () =>
    (await window.traceStudio.call('get_project')).creation?.objects.some(
      (o) => o.name === '杯子',
    ),
  );
  await settled();
  const original = await call('document.get');
  // Dropped SVGs still open vector import when raster drops add reference layers.
  const svgDrop = await page.evaluateHandle(
    (svg) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([svg], 'sandrone-signature.svg', { type: 'image/svg+xml' }),
      );
      return transfer;
    },
    readFileSync(
      resolve(__dirname, '../fixtures/sandrone-signature.svg'),
      'utf8',
    ),
  );
  await page.locator('main').dispatchEvent('drop', { dataTransfer: svgDrop });
  await svgDrop.dispose();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.deepEqual(await call('document.get'), original);
  await page
    .locator('input[accept=".svg,image/svg+xml"]')
    .setInputFiles(resolve(__dirname, '../fixtures/sandrone-signature.svg'));
  await page.getByLabel('导入宽度', { exact: true }).fill('23');
  await page.getByLabel('导入中心 X', { exact: true }).fill('8');
  await page.getByLabel('导入中心 Y', { exact: true }).fill('-29.5');
  await page
    .getByLabel('导入贴附表面', { exact: true })
    .selectOption({ label: '杯子' });
  await page.getByLabel('导入中心 X', { exact: true }).fill('500');
  await page.getByRole('button', { name: '导入为对象组', exact: true }).click();
  await page.getByRole('dialog').getByRole('alert').waitFor();
  assert.deepEqual(await call('document.get'), original);
  await page.getByLabel('导入中心 X', { exact: true }).fill('8');
  await page.getByRole('button', { name: '导入为对象组', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await settled();
  const current = await call('document.get');
  assert.equal(current.revision, original.revision + 1);
  const group = Object.values(current.document.nodes).find(
    (n) => n.name === 'sandrone-signature' && n.kind === 'group',
  );
  assert(group);
  for (const [id, node] of Object.entries(original.document.nodes))
    assert.deepEqual(current.document.nodes[id], node);
  await call('undo');
  await settled();
  assert.deepEqual((await call('document.get')).document, original.document);
  await page.keyboard.press('Control+Shift+z');
  await settled();
  const row = page.locator(`[data-tree-object="${group.id}"]`);
  await row.locator('.creation-name').dblclick();
  const input = row.locator('input');
  await input.pressSequentially('Sandrone', { delay: 20 });
  assert.equal(await input.inputValue(), 'Sandrone');
  await input.press('ArrowLeft');
  await input.pressSequentially('X');
  assert.equal(await input.inputValue(), 'SandronXe');
  await input.press('Escape');
  assert.equal(
    (await call('document.get')).document.nodes[group.id].name,
    group.name,
  );
  await row.locator('.creation-name').dblclick();
  await row.locator('input').pressSequentially('Signature');
  await row.locator('input').press('Enter');
  await settled();
  assert.equal(
    (await call('document.get')).document.nodes[group.id].name,
    'Signature',
  );
  await call('undo');
  await settled();
  await row.click({ position: { x: 60, y: 12 } });
  await page.keyboard.press('v');
  await page.keyboard.press('h');
  assert.equal(
    await page
      .getByRole('button', { name: '选择 (V)', exact: true })
      .getAttribute('aria-pressed'),
    'true',
    'H no longer switches tools',
  );
  const transformPanel = page.getByRole('region', { name: '对象变换' });
  for (const [key, label] of [
    ['g', '移动'],
    ['r', '旋转'],
    ['s', '缩放'],
  ]) {
    const before = await call('document.get');
    await page.keyboard.press(key);
    assert.equal(
      await page
        .getByRole('button', { name: '变换', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    assert.equal(
      await transformPanel
        .getByRole('button', { name: label, exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    assert.equal(
      await page
        .getByRole('button', { name: `变换：${label}`, exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    assert.deepEqual(
      await call('document.get'),
      before,
      'switching transform mode does not edit the document',
    );
  }
  await page
    .locator('[data-tree-object]')
    .filter({ has: page.locator('.creation-name', { hasText: /^杯子$/ }) })
    .first()
    .click({ position: { x: 60, y: 12 } });
  assert.equal(
    await transformPanel.isVisible(),
    true,
    'selecting an object keeps the transform controls open',
  );
  assert.match(
    await transformPanel.locator('.object-transform-target').innerText(),
    /杯子/,
  );
  await row.click({ position: { x: 60, y: 12 } });
  await page.getByRole('button', { name: '变换：移动', exact: true }).click();
  assert.equal(
    await transformPanel
      .getByRole('button', { name: '移动', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  await page.getByLabel('X 位移 (mm)', { exact: true }).focus();
  await page.keyboard.press('r');
  assert.equal(
    await transformPanel
      .getByRole('button', { name: '移动', exact: true })
      .getAttribute('aria-pressed'),
    'true',
    'numeric fields do not trigger transform hotkeys',
  );
  await page.getByLabel('X 位移 (mm)', { exact: true }).fill('0');
  await page.getByLabel('X 位移 (mm)', { exact: true }).blur();
  await page
    .locator('main')
    .dispatchEvent('keydown', { key: 'r', isComposing: true, bubbles: true });
  await page.keyboard.press('Alt+s');
  assert.equal(
    await transformPanel
      .getByRole('button', { name: '移动', exact: true })
      .getAttribute('aria-pressed'),
    'true',
    'IME and modified keys do not switch transform modes',
  );
  for (const [button, label, value] of [
    ['移动', 'X 位移 (mm)', '3'],
    ['旋转', '旋转角度', '25'],
    ['缩放', '等比缩放', '120'],
  ]) {
    await page.getByRole('button', { name: button, exact: true }).click();
    await page.getByLabel(label, { exact: true }).fill(value);
    const before = await call('document.get');
    await page
      .getByRole('button', { name: '应用到选中对象', exact: true })
      .click();
    await settled();
    const after = await call('document.get');
    assert.equal(after.revision, before.revision + 1);
    assert.notDeepEqual(after.document, before.document);
    await call('undo');
    await settled();
    assert.deepEqual((await call('document.get')).document, before.document);
  }
  // Exercise the reusable controls with real pointer events, including live
  // SVG geometry, the proxy box, document isolation, cancellation and history.
  const project = await call('get_project');
  const doc = (await call('document.get')).document;
  const owner = Object.values(doc.nodes).find(
    (node) => node.parentId === group.id && node.kind === 'shape',
  );
  const pathId = project.creation.objects.find((o) => o.id === owner.id)
    .pathIds[0];
  const visual = () =>
    page.evaluate((id) => {
      const path = document.querySelector(`[data-source-id="${id}"] path`);
      const target = document.querySelector(
        '[data-transform-target="objects"]',
      );
      const matrix = (el) => {
        const m = el.getScreenCTM();
        return [m.a, m.b, m.c, m.d, m.e, m.f];
      };
      const p = path.getPointAtLength(path.getTotalLength() * 0.25);
      const q = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM());
      const corners = [
        [0, 0],
        [target.width.baseVal.value, target.height.baseVal.value],
      ].map(([x, y]) => {
        const p = new DOMPoint(x, y).matrixTransform(target.getScreenCTM());
        return [p.x, p.y];
      });
      return {
        source: matrix(path),
        target: matrix(target),
        point: [q.x, q.y],
        corners,
      };
    }, pathId);
  const close = (a, b, label, tolerance = 0.6) =>
    a.forEach((n, i) =>
      assert(Math.abs(n - b[i]) < tolerance, `${label}: ${a} != ${b}`),
    );
  const assertSynchronized = async (before, after, label) => {
    const deltas = await page.evaluate(
      ({ before, after }) => {
        const delta = (key) => {
          const m = new DOMMatrix(after[key]).multiply(
            new DOMMatrix(before[key]).inverse(),
          );
          return [m.a, m.b, m.c, m.d, m.e, m.f];
        };
        return [delta('source'), delta('target')];
      },
      { before, after },
    );
    close(deltas[0], deltas[1], `${label} shape and gizmo move together`, 0.02);
    assert(
      Math.hypot(
        after.point[0] - before.point[0],
        after.point[1] - before.point[1],
      ) > 1,
      `${label} changes visible geometry: ${JSON.stringify({ before, after })}`,
    );
  };
  for (const [mode, selector, dx, dy] of [
    ['移动', '.moveable-area', 25, -18],
    ['旋转', '.moveable-rotation-control', 30, 16],
    ['缩放', '.moveable-direction[data-direction="se"]', 20, 15],
  ]) {
    await row.click({ position: { x: 60, y: 12 } });
    await page.keyboard.press('g');
    await page.getByRole('button', { name: mode, exact: true }).click();
    const control = page.locator(`.transform-gizmo ${selector}`);
    await control.waitFor({ state: 'visible' });
    const bounds = await control.boundingBox();
    const p = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    };
    const before = await call('document.get');
    const originalVisual = await visual();
    const drag = async () => {
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.move(p.x + dx, p.y + dy, { steps: 8 });
      assert.equal(
        (await call('state')).gesturing,
        true,
        `${mode} activates a gesture`,
      );
      const preview = await visual();
      await assertSynchronized(originalVisual, preview, mode);
      if (mode === '缩放')
        close(
          preview.corners[0],
          originalVisual.corners[0],
          'opposite scale corner stays fixed',
        );
      assert.deepEqual(
        await call('document.get'),
        before,
        'preview does not publish geometry',
      );
      await assert.rejects(
        call('authoring.run', {
          expectedRevision: before.revision,
          action: { kind: 'group-nodes', nodeIds: [group.id] },
        }),
        /请先完成或取消当前拖动/,
      );
      await assert.rejects(
        call('export', { format: 'json' }),
        /请先完成或取消当前拖动/,
      );
      return preview;
    };
    await drag();
    await page.keyboard.press(mode === '缩放' ? 'r' : 's');
    assert.equal(
      await transformPanel
        .getByRole('button', { name: mode, exact: true })
        .getAttribute('aria-pressed'),
      'true',
      'dragging keeps its original mode',
    );
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.deepEqual(await call('document.get'), before);
    close(
      (await visual()).point,
      originalVisual.point,
      'Escape restores shape',
    );
    close(
      (await visual()).target,
      originalVisual.target,
      'Escape restores gizmo',
    );
    const preview = await drag();
    await page.screenshot({
      path: resolve(
        outputDirectory,
        `gizmo-${mode === '移动' ? 'translate' : mode === '旋转' ? 'rotate' : 'scale'}-preview.png`,
      ),
    });
    await page.mouse.up();
    await settled();
    assert.equal(
      (await call('document.get')).revision,
      before.revision + 1,
      'one gesture creates one history entry',
    );
    close(
      (await visual()).point,
      preview.point,
      'release preserves preview geometry',
    );
    const committedVisual = await visual();
    for (const i of [0, 1])
      close(
        committedVisual.corners[i],
        preview.corners[i],
        'release preserves gizmo corners',
      );
    await call('undo');
    await settled();
    assert.deepEqual((await call('document.get')).document, before.document);
    close(
      (await visual()).point,
      originalVisual.point,
      'undo restores geometry',
    );
  }
  // Rotated selection followed by centered, snapped scaling. The same controls
  // must stay attached after camera movement and after a previous commit.
  await page.getByRole('button', { name: '旋转', exact: true }).click();
  await page.getByLabel('旋转角度', { exact: true }).fill('30');
  await page
    .getByRole('button', { name: '应用到选中对象', exact: true })
    .click();
  await settled();
  const view = (await call('state')).view;
  await call('set_view', {
    x: view.x - 80,
    y: view.y - 180,
    scale: view.s * 1.5,
  });
  await settled();
  const scaleControl = page.locator(
    '.transform-gizmo .moveable-direction[data-direction="se"]',
  );
  const b = await scaleControl.boundingBox();
  assert.equal(
    await scaleControl.evaluate((el) => getComputedStyle(el).width),
    '12px',
    'handles keep a usable screen size under zoom and rotation',
  );
  const beforeScale = await call('document.get');
  const v = await visual();
  const center = (v) => v.corners[0].map((n, i) => (n + v.corners[1][i]) / 2);
  await page.keyboard.down('Alt');
  await page.keyboard.down('Shift');
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 28, b.y + b.height / 2 + 25, {
    steps: 6,
  });
  const centered = await visual();
  await assertSynchronized(v, centered, 'center scaling after rotation/zoom');
  close(center(v), center(centered), 'Alt keeps the selection center fixed');
  const percent = Number(
    (await page.getByLabel('实时变换').textContent()).split('%')[0],
  );
  assert.equal(percent % 10, 0, 'Shift scales in 10% increments');
  assert.notEqual(percent, 100);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.keyboard.up('Alt');
  await settled();
  assert.equal((await call('document.get')).revision, beforeScale.revision + 1);
  close(
    (await visual()).point,
    centered.point,
    'center scale release preserves preview',
  );
  await call('undo');
  await settled();
  // Shift rotation snaps around the center, even on an already rotated box.
  const r = await page
    .locator('.transform-gizmo .moveable-rotation-control')
    .boundingBox();
  const priorRotate = await call('document.get');
  const priorVisual = await visual();
  await page.keyboard.down('Shift');
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width / 2 + 30, r.y + r.height / 2 + 10, {
    steps: 6,
  });
  const degrees = Number(
    (await page.getByLabel('实时变换').textContent()).replace('°', ''),
  );
  assert.equal(Math.abs(degrees) % 15, 0, 'Shift rotation snaps by 15 degrees');
  assert.notEqual(degrees, 0);
  close(
    center(priorVisual),
    center(await visual()),
    'rotation center remains fixed',
  );
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.keyboard.up('Shift');
  assert.deepEqual(await call('document.get'), priorRotate);
  await call('undo');
  await settled();
  await call('set_view', { fit: true });
  const exported = await call('export', { format: 'json' });
  assert(exported.base64);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .locator('[data-tree-object]')
    .filter({ has: page.locator('.creation-name', { hasText: /^杯子$/ }) })
    .first()
    .click({ position: { x: 60, y: 12 } });
  await page.keyboard.press('r');
  await settled();
  await page.screenshot({
    path: resolve(outputDirectory, 'transform-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1000, height: 720 });
  await page.keyboard.press('g');
  await page.screenshot({
    path: resolve(outputDirectory, 'transform-compact.png'),
    fullPage: true,
  });
};
