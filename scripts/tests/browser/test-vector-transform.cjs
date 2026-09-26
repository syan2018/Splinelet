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
  // Drag previews leave the canonical document alone; release commits once.
  for (const mode of ['移动', '旋转', '缩放']) {
    await row.click({ position: { x: 60, y: 12 } });
    await page.keyboard.press('g');
    await page.getByRole('button', { name: mode, exact: true }).click();
    const project = await call('get_project');
    const doc = (await call('document.get')).document;
    const owner = Object.values(doc.nodes).find(
      (node) => node.parentId === group.id && node.kind === 'shape',
    );
    const pathId = project.creation.objects.find((o) => o.id === owner.id)
      .pathIds[0];
    const path = page.locator(`[data-source-id="${pathId}"] path`).last();
    const p = await path.evaluate((el) => {
      const p = el.getPointAtLength(el.getTotalLength() * 0.25);
      const q = new DOMPoint(p.x, p.y).matrixTransform(el.getScreenCTM());
      return { x: q.x, y: q.y };
    });
    const before = await call('document.get');
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 25, p.y - 18, { steps: 5 });
    await page.keyboard.press(mode === '缩放' ? 'r' : 's');
    assert.equal(
      await transformPanel
        .getByRole('button', { name: mode, exact: true })
        .getAttribute('aria-pressed'),
      'true',
      'dragging keeps its original transform mode',
    );
    assert.deepEqual(await call('document.get'), before);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.deepEqual(await call('document.get'), before);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 25, p.y - 18, { steps: 5 });
    await page.mouse.up();
    await settled();
    assert.equal((await call('document.get')).revision, before.revision + 1);
    await call('undo');
    await settled();
    assert.deepEqual((await call('document.get')).document, before.document);
  }
  const exported = await call('export', { format: 'json' });
  assert(exported.base64);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.keyboard.press('r');
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
