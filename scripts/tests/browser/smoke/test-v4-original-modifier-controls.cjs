#!/usr/bin/env node
// Real original component + V4 session, on a fresh context and ephemeral port.
const assert = require('node:assert/strict');
const { mkdir, writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const { chromium } = require('playwright');

const root = resolve(__dirname, '../../../..');
const output = resolve(root, 'output/playwright/v4-original-modifier-controls');

async function main() {
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: false,
    root,
    publicDir: false,
    resolve: { alias: { '@': resolve(root, 'src') } },
    server: {
      host: '127.0.0.1',
      port: 0,
      watch: {
        ignored: ['**/src-tauri/target/**', '**/dist/**', '**/output/**'],
      },
    },
    plugins: [
      {
        name: 'isolated-modifier-fixture',
        configureServer(devServer) {
          devServer.middlewares.use(async (req, res, next) => {
            if (req.url !== '/') return next();
            const html = await devServer.transformIndexHtml(
              '/',
              '<!doctype html><html><head><meta charset="utf-8"><title>原修改器组件验收</title><link rel="stylesheet" href="/app/globals.css"><link rel="stylesheet" href="/app/creation.css"></head><body><div id="root"></div><script type="module" src="/scripts/tests/fixtures/v4-modifier-controls.mjs"></script></body></html>',
            );
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(html);
          });
        },
      },
    ],
  });
  let browser;
  let page;
  const failures = [];
  await mkdir(output, { recursive: true });
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1000, height: 900 },
    });
    page = await context.newPage();
    page.on('pageerror', (error) => failures.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
    await page.locator('#evidence[data-ready="true"]').waitFor();
    const evidence = async () =>
      JSON.parse(await page.locator('#evidence').textContent());
    const waitRevision = async (revision) => {
      await page.waitForFunction((before) => {
        const element = document.getElementById('evidence');
        return (
          element?.dataset.ready === 'true' &&
          JSON.parse(element.textContent).revision > before
        );
      }, revision);
      assert.equal(await page.locator('#fixture-error').textContent(), '');
    };
    assert.equal(
      await page.locator('.modifier-card').count(),
      1,
      'V4 operator appears in original card',
    );
    assert.equal(
      await page.getByText('当前直接使用基础面。', { exact: true }).count(),
      0,
    );
    const card = page.locator('.modifier-card');
    const derived = page.locator('[data-derived-curves]');
    assert.equal(await derived.getAttribute('data-derived-curves'), '2');
    const initialPath = await derived.getAttribute('d');
    assert.equal(
      await card.evaluate((el) => getComputedStyle(el).borderRadius),
      '9px',
    );
    assert.equal(
      await card
        .locator('.modifier-card-header')
        .evaluate((el) => getComputedStyle(el).display),
      'flex',
    );
    await card.locator('.modifier-expand').click();
    const angle = page.getByRole('spinbutton', {
      name: '镜像轴角度',
      exact: true,
    });
    assert.ok(Math.abs(Number(await angle.inputValue()) - 135) < 1e-8);
    assert.equal(
      await page
        .getByRole('spinbutton', { name: '镜像中心 X', exact: true })
        .inputValue(),
      '17',
    );
    let before = await evidence();
    await angle.fill('120');
    await angle.press('Enter');
    await waitRevision(before.revision);
    const changed = await evidence();
    assert.ok(Math.abs(changed.angleRad - Math.PI / 6) < 1e-8);
    assert.equal(changed.rawUnchanged, true);
    assert.equal(changed.revision, before.revision + 1);
    before = changed;
    await page.getByRole('button', { name: '测试撤销', exact: true }).click();
    await waitRevision(before.revision);
    assert.equal((await evidence()).baselineRestored, true);

    before = await evidence();
    // Add through the original form; inspect the actual V4 graph and geometry.
    await page.getByRole('button', { name: '添加修改器', exact: true }).click();
    await page
      .getByRole('combobox', { name: '新修改器类型' })
      .selectOption('curve_array');
    const form = page.locator('.modifier-add-form');
    for (const [name, value] of [
      ['阵列数量', '3'],
      ['每份旋转角度', '120'],
      ['阵列中心 X', '17'],
      ['阵列中心 Y', '32'],
    ]) {
      await form.getByRole('spinbutton', { name, exact: true }).fill(value);
      await form.getByRole('spinbutton', { name, exact: true }).press('Enter');
    }
    await form.getByRole('button', { name: '添加', exact: true }).click();
    await waitRevision(before.revision);
    const added = await evidence();
    const array = added.operators.find(
      (operator) => operator.type === 'curve-array',
    );
    assert.deepEqual(array.params.center, [2, 3]);
    assert.equal(array.params.count, 3);
    assert.ok(Math.abs(array.params.angleRad - (2 * Math.PI) / 3) < 1e-8);
    assert.equal(
      array.inputs.input[0].operatorId,
      before.operators.find((operator) => operator.type === 'curve-mirror').id,
    );
    assert.equal(added.curveCount, before.curveCount * 3);
    assert.equal(await derived.getAttribute('data-derived-curves'), '6');
    await page
      .getByRole('combobox', { name: '样条预览阶段' })
      .selectOption(
        `operator:${JSON.stringify([before.operators.find((operator) => operator.type === 'curve-mirror').id, 'curves'])}`,
      );
    assert.equal(await derived.getAttribute('data-derived-curves'), '2');
    assert.equal(await derived.getAttribute('d'), initialPath);
    await page
      .getByRole('combobox', { name: '样条预览阶段' })
      .selectOption('final');
    assert.equal(await derived.getAttribute('data-derived-curves'), '6');
    await page
      .getByRole('checkbox', { name: '派生样条', exact: true })
      .uncheck();
    assert.equal(await derived.count(), 0);
    await page.getByRole('checkbox', { name: '派生样条', exact: true }).check();
    assert.equal(await derived.getAttribute('data-derived-curves'), '6');
    assert.equal(added.rawUnchanged, true);
    assert.equal(added.revision, before.revision + 1);
    assert.equal(await page.locator('.modifier-card').count(), 2);
    await page.getByRole('button', { name: '测试撤销', exact: true }).click();
    await waitRevision(added.revision);
    assert.equal((await evidence()).baselineRestored, true);
    before = await evidence();
    await card.getByRole('checkbox').uncheck();
    await waitRevision(before.revision);
    assert.equal((await evidence()).enabled, false);
    before = await evidence();
    await page.getByRole('button', { name: '测试撤销', exact: true }).click();
    await waitRevision(before.revision);
    assert.equal((await evidence()).baselineRestored, true);

    before = await evidence();
    await page
      .getByRole('button', { name: '测试参数驱动', exact: true })
      .click();
    await waitRevision(before.revision);
    assert.equal(await angle.isDisabled(), true);
    assert.ok(Math.abs(Number(await angle.inputValue()) - 150) < 1e-8);
    before = await evidence();
    await page
      .getByRole('button', { name: '测试缺失参数', exact: true })
      .click();
    await waitRevision(before.revision);
    assert.equal(
      await angle.inputValue(),
      '',
      'missing parameter must not turn into 90 or zero',
    );
    assert.equal(await angle.isDisabled(), true);
    assert.deepEqual((await evidence()).angleRad, {
      kind: 'parameter',
      id: 'angle',
    });
    assert.equal(
      await derived.getAttribute('data-derived-curves'),
      '0',
      'blocked final output must not show a successful earlier stage',
    );
    assert.equal(await derived.getAttribute('d'), '');
    await page.screenshot({
      path: resolve(output, 'missing-parameter.png'),
      fullPage: true,
    });

    before = await evidence();
    await page.getByRole('button', { name: '测试锁定', exact: true }).click();
    await waitRevision(before.revision);
    assert.equal(await card.getByRole('checkbox').isDisabled(), true);
    assert.equal(
      await page
        .getByRole('button', { name: '添加修改器', exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await page
        .getByRole('spinbutton', { name: '镜像中心 X', exact: true })
        .isDisabled(),
      true,
    );
    await page
      .getByRole('button', { name: '测试节点基线', exact: true })
      .click();
    await page.locator('.node-inspector').waitFor();
    assert.equal(
      await page
        .locator('.node-inspector')
        .evaluate((el) => getComputedStyle(el).padding),
      '0px',
    );
    assert.equal(
      await page
        .locator('.node-inspector .spline-operation-group')
        .first()
        .evaluate((el) => getComputedStyle(el).display),
      'grid',
    );
    const sourceBase = await evidence();
    assert.equal(sourceBase.source.curves.length, 2);
    const sourceDerived = await derived.getAttribute('d');
    const mode = page.getByRole('combobox', { name: '节点连接模式' });
    assert.equal(await mode.inputValue(), 'corner');
    await mode.selectOption('symmetric');
    await waitRevision(sourceBase.revision);
    const symmetric = await evidence();
    assert.equal(symmetric.source.modes[1], 'symmetric');
    assert.equal(symmetric.revision, sourceBase.revision + 1);
    assert.deepEqual(symmetric.source.anchors, sourceBase.source.anchors);
    assert.notEqual(await derived.getAttribute('d'), sourceDerived);
    await page.locator('.node-inspector').screenshot({
      path: resolve(output, 'source-node-inspector.png'),
    });
    await page.getByRole('button', { name: '测试撤销', exact: true }).click();
    await waitRevision(symmetric.revision);
    assert.equal((await evidence()).sourceBaselineRestored, true);
    assert.equal(await mode.inputValue(), 'corner');
    before = await evidence();
    await page.getByRole('button', { name: /前一段改为直连/ }).click();
    await waitRevision(before.revision);
    const straightened = await evidence();
    assert.deepEqual(straightened.source.anchors, before.source.anchors);
    assert.notDeepEqual(straightened.source.curves[0], before.source.curves[0]);
    assert.deepEqual(straightened.source.curves[1], before.source.curves[1]);
    await page.getByRole('button', { name: '测试撤销', exact: true }).click();
    await waitRevision(straightened.revision);
    assert.equal((await evidence()).sourceBaselineRestored, true);
    before = await evidence();
    await page.locator('.node-inspector summary').click();
    await page.locator('.node-inspector .spline-danger').click();
    await waitRevision(before.revision);
    const deleted = await evidence();
    assert.equal(deleted.source.curves.length, 1);
    assert.equal(deleted.revision, before.revision + 1);
    await page.getByRole('button', { name: '测试撤销', exact: true }).click();
    await waitRevision(deleted.revision);
    assert.equal((await evidence()).sourceBaselineRestored, true);
    assert.deepEqual(failures, []);
    await writeFile(
      resolve(output, 'result.json'),
      JSON.stringify(
        {
          passed: true,
          scope:
            'original modifier component and V4 session; not default workspace or native file acceptance',
          evidence: await evidence(),
        },
        null,
        2,
      ),
    );
    console.log(
      'PASS original modifier and node DOM: V4 fields, source mode/straighten/delete, derived curves, single undo, parameter binding and lock',
    );
  } catch (error) {
    if (page)
      await page
        .screenshot({ path: resolve(output, 'failure.png'), fullPage: true })
        .catch(() => {});
    console.error(failures);
    throw error;
  } finally {
    await browser?.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
