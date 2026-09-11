// Supply an isolated Playwright page with a loaded, painted project.
module.exports = async (page) => {
  const assert = require('node:assert/strict'),
    checks = [];
  const call = (action) =>
    page.evaluate((action) => window.traceStudio.call(action), action);
  const check = (ok, name) => {
    assert(ok, name);
    checks.push(name);
  };
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '平面创作', exact: true }).click();
  await page.getByRole('button', { name: '选择 (V)', exact: true }).click();
  await page.locator('.creation-updating').waitFor({ state: 'hidden' });
  const source = await call('get_project'),
    flat = (await call('state')).view;
  await page.getByRole('button', { name: '立体预览', exact: true }).click();
  const canvas = page.locator('.creation-webgl canvas'),
    box = await canvas.boundingBox();
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const frame = () => canvas.screenshot();
  await frame();
  check(
    await page.evaluate(
      (p) =>
        document.elementFromPoint(p.x, p.y)?.getAttribute('aria-label') ===
        '作品立体画布',
      center,
    ),
    'model center hits the WebGL canvas',
  );
  const drag = async (button, dx, dy, label, outside = false) => {
    await page.mouse.move(center.x, center.y);
    const before = await frame();
    await page.mouse.down({ button });
    await page.mouse.move(center.x + dx, center.y + dy, { steps: 10 });
    if (outside)
      await page.mouse.move(box.x + box.width + 30, center.y, { steps: 5 });
    await page.mouse.up({ button });
    check(!before.equals(await frame()), label + ' changes the rendered view');
    const released = await frame();
    await page.mouse.move(center.x - 60, center.y - 40);
    check(released.equals(await frame()), label + ' stops on release');
  };
  await drag('right', 85, 45, 'right pan');
  await drag('left', 70, 45, 'left orbit');
  await drag('middle', 0, 40, 'middle zoom');
  await page.keyboard.down('Space');
  await drag('left', 40, 30, 'Space pan');
  await page.keyboard.up('Space');
  const beforeWheel = await frame();
  await page.mouse.wheel(0, -100);
  check(
    !beforeWheel.equals(await frame()),
    'wheel zoom changes the rendered view',
  );
  await drag('right', 30, 20, 'release outside the canvas', true);
  assert.deepEqual(
    (await call('state')).view,
    flat,
    'camera navigation leaves the flat viewport unchanged',
  );
  assert.deepEqual(
    await call('get_project'),
    source,
    'camera navigation leaves the entire project unchanged',
  );
  checks.push('flat viewport and source project unchanged');
  await page.getByRole('button', { name: '平面创作', exact: true }).click();
  await page.getByRole('button', { name: '立体预览', exact: true }).click();
  await frame();
  await drag('right', 30, 20, 'right pan after switching views');
  await page.getByRole('button', { name: '立体', exact: true }).click();
  await page.mouse.click(center.x, center.y);
  check(
    (await call('state')).creation.selectedCells.length === 1,
    'left click still selects a region',
  );
  await page.getByRole('button', { name: '画笔色：灰棕', exact: true }).click();
  check(
    (await page
      .getByRole('button', { name: '画笔色：灰棕', exact: true })
      .getAttribute('aria-pressed')) === 'true',
    'palette remains interactive',
  );
  return { ok: true, checks };
};
