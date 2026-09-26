#!/usr/bin/env node
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createWriteStream, existsSync } = require('node:fs');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { relative, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const harness = require('../harness/browser-runner.cjs');

const ROOT = resolve(__dirname, '../../../..');
const DEFAULT_OUTPUT = resolve(
  ROOT,
  'outputs/v4-qa/sandrone-restored-ui-smoke',
);
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

function options(argv) {
  const result = {
    target: 'web',
    port: 4192,
    inspectorPort: 9252,
    output: DEFAULT_OUTPUT,
  };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value) throw Error(`${flag} requires a value`);
    if (flag === '--target') result.target = value;
    else if (flag === '--port') result.port = Number(value);
    else if (flag === '--inspector-port') result.inspectorPort = Number(value);
    else if (flag === '--output') result.output = resolve(ROOT, value);
    else throw Error(`unknown option ${flag}`);
  }
  if (!['web', 'desktop-frontend'].includes(result.target))
    throw Error(`unsupported target ${result.target}`);
  return result;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise((done) => {
      const killer = spawn(
        'taskkill',
        ['/pid', String(child.pid), '/t', '/f'],
        { stdio: 'ignore', windowsHide: true },
      );
      killer.once('exit', done);
      killer.once('error', done);
    });
    return;
  }
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((done) => child.once('exit', done)),
    delay(5000),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function waitForPage(url, child) {
  const deadline = Date.now() + 45_000;
  let last;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null)
      throw Error(`web service exited with ${child.exitCode}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
      last = Error(`HTTP ${response.status}`);
    } catch (error) {
      last = error;
    }
    await delay(150);
  }
  throw Error(`timed out waiting for ${url}: ${last?.message || 'unknown'}`);
}

async function startWeb(port, inspectorPort, output) {
  if (!existsSync(harness.WEB_CONFIG))
    throw Error(
      'dist/server/wrangler.json is missing; use an existing production build',
    );
  const log = createWriteStream(resolve(output, 'server.log'), { flags: 'a' });
  const child = spawn(
    process.execPath,
    [
      require.resolve('wrangler'),
      ...harness.createWebServerArguments(port, inspectorPort, output),
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        MINIFLARE_REGISTRY_PATH: resolve(output, 'miniflare-registry'),
        WRANGLER_LOG_PATH: resolve(output, 'wrangler-logs'),
        WRANGLER_SEND_METRICS: 'false',
        WRANGLER_WRITE_LOGS: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const url = `http://127.0.0.1:${port}`;
  try {
    await waitForPage(url, child);
  } catch (error) {
    await stopChild(child);
    log.end();
    throw error;
  }
  return {
    url,
    pid: child.pid,
    async close() {
      await stopChild(child);
      log.end();
    },
  };
}

async function project(path) {
  const projectFormat = await import(
    pathToFileURL(resolve(ROOT, 'src/lib/project-format.mjs')).href
  );
  return projectFormat.decodeProject(new Uint8Array(await readFile(path)));
}

async function settle(page) {
  await page.waitForFunction(
    async () =>
      window.traceStudio &&
      !(await window.traceStudio.call('state')).busy &&
      !document.querySelector('footer')?.textContent.includes('正在恢复工程'),
    null,
    { timeout: 60_000 },
  );
  await page.locator('.creation-updating').waitFor({
    state: 'hidden',
    timeout: 60_000,
  });
  await page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done)),
      ),
  );
}

async function call(page, action, args = {}) {
  return require('../harness/legacy-call.cjs').legacyCaller(page)(action, args);
}

async function selectSourceAndRegion(page, scene, objectName) {
  const object = scene.creation.objects.find(
    (item) => item.name === objectName,
  );
  assert(object, `${objectName} must exist`);
  const sourceId = object.pathIds[0];
  assert(sourceId, `${objectName} must retain a source path`);
  const cells = scene.cells.filter((cell) => cell.objectId === object.id);
  assert(cells.length > 0, `${objectName} must produce selectable regions`);

  const disclosure = page.getByRole('button', {
    name: `展开${objectName}`,
    exact: true,
  });
  if (await disclosure.count()) await disclosure.click();
  await page.locator(`[data-tree-path="${sourceId}"]`).click();
  assert.deepEqual((await call(page, 'state')).creation.selection, {
    kind: 'path',
    ids: [sourceId],
  });

  const cell = cells.find((item) => item.painted) || cells[0];
  const cellButton = page.locator(`[data-tree-cell="${cell.key}"]`);
  const cellList = page
    .locator(`[data-tree-object="${object.id}"]`)
    .locator('xpath=..');
  const summary = cellList.locator('summary', { hasText: '内部区域' });
  if (
    (await summary.count()) &&
    !(await summary.evaluate((item) => item.parentElement.open))
  )
    await summary.click();
  await cellButton.click();
  assert.deepEqual((await call(page, 'state')).creation.selection, {
    kind: 'cell',
    ids: [cell.key],
  });
  return { object, sourceId, cell };
}

async function editAndUndo(page) {
  const before = await call(page, 'get_project');
  await page
    .getByRole('button', { name: '当前选区浮雕厚度', exact: true })
    .click();
  const input = page.getByLabel('厚度打印层数', { exact: true });
  await input.waitFor();
  const oldValue = Number(await input.inputValue());
  await input.fill(String(oldValue + 1));
  await input.press('Enter');
  await settle(page);
  assert.notDeepEqual(await call(page, 'get_project'), before);
  await page.keyboard.press('Control+z');
  await settle(page);
  assert.deepEqual(
    await call(page, 'get_project'),
    before,
    'one undo must restore the complete loaded project',
  );
}

async function verifyFlatLayout(page, expected) {
  await page.getByRole('button', { name: '平面创作', exact: true }).click();
  await settle(page);
  await page.getByLabel('贝塞尔绘图画布').waitFor();
  await page.getByRole('navigation', { name: '绘图工具' }).waitFor();
  await page.getByRole('button', { name: '节点 (A)', exact: true }).waitFor();
  await page.getByRole('button', { name: '上色', exact: true }).waitFor();
  await page.getByRole('button', { name: '高低', exact: true }).waitFor();
  assert.equal(await page.locator('[data-editor-model="v4"]').count(), 0);
  const image = page.getByLabel('贝塞尔绘图画布').locator('image');
  await image.waitFor();
  assert.match(await image.getAttribute('href'), /^data:image\//);
  const actual = await call(page, 'get_project');
  assert.equal(actual.paths.length, expected.paths);
  for (const name of expected.objects)
    assert(actual.creation.objects.some((object) => object.name === name));
}

async function verifyPreview(page, screenshot) {
  await page.getByRole('button', { name: '立体预览', exact: true }).click();
  const canvas = page.getByLabel('作品立体画布');
  await canvas.waitFor({ timeout: 30_000 });
  const box = await canvas.boundingBox();
  assert(box && box.width > 400 && box.height > 300);
  await page.screenshot({ path: screenshot, fullPage: true });
}

async function smoke(page, output) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (entry) => {
    if (entry.type() === 'error') consoleErrors.push(entry.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.waitForFunction(() => window.traceStudio, null, {
    timeout: 60_000,
  });
  await settle(page);
  await call(page, 'load_project', {
    project: await project(
      resolve(ROOT, 'scripts/tests/fixtures/legacy-sandrone.spl'),
    ),
  });
  await settle(page);
  await verifyFlatLayout(page, {
    paths: 76,
    objects: ['外框', '头饰', '头发', '杯子', '胸前'],
  });
  const builtIn = await call(page, 'creation_inspect');
  const selection = await selectSourceAndRegion(page, builtIn, '胸前');
  await editAndUndo(page);
  await page.screenshot({
    path: resolve(output, 'built-in-sandrone-flat.png'),
    fullPage: true,
  });
  await verifyPreview(page, resolve(output, 'built-in-sandrone-3d.png'));

  const gold = await project(
    resolve(ROOT, 'output/agent-emblem/sandrone-gold-emblem.spl'),
  );
  await call(page, 'load_project', { project: gold });
  await settle(page);
  await verifyFlatLayout(page, {
    paths: 79,
    objects: ['胸前', '金色四瓣标记'],
  });
  const goldScene = await call(page, 'creation_inspect');
  const goldSelection = await selectSourceAndRegion(
    page,
    goldScene,
    '金色四瓣标记',
  );
  await page.locator(`[data-tree-object="${goldSelection.object.id}"]`).click();
  assert.deepEqual((await call(page, 'state')).creation.selection, {
    kind: 'object',
    ids: [goldSelection.object.id],
  });
  await page
    .getByRole('button', { name: '当前部件构造与修改器', exact: true })
    .click();
  const properties = page.locator('.creation-properties');
  const modifierCards = properties.locator('.modifier-card');
  await modifierCards.first().waitFor({ timeout: 30_000 });
  const modifierNames = await modifierCards.evaluateAll((cards) =>
    cards.map((card) => card.getAttribute('aria-label')),
  );
  const modifierPanelText = await properties.innerText();
  await page.screenshot({
    path: resolve(output, 'gold-emblem-flat.png'),
    fullPage: true,
  });
  await writeFile(
    resolve(output, 'gold-emblem-properties.txt'),
    `${modifierPanelText}\n`,
  );
  assert.deepEqual(modifierNames, [
    '半边镜像 · 严格对称',
    '四向旋转 · 4 × 90°',
    '闭合构面 · 外环与镂空',
  ]);
  await verifyPreview(page, resolve(output, 'gold-emblem-3d.png'));

  assert.deepEqual(pageErrors, [], 'page errors are not acceptable');
  return {
    builtIn: {
      paths: 76,
      objects: builtIn.creation.objects.length,
      cells: builtIn.cells.length,
      selectedPath: selection.sourceId,
      selectedRegion: selection.cell.key,
      editUndo: 'complete-project equality restored',
    },
    gold: {
      paths: gold.paths.length,
      objects: goldScene.creation.objects.length,
      cells: goldScene.cells.length,
      emblemCells: goldScene.cells.filter(
        (cell) => cell.objectId === goldSelection.object.id,
      ).length,
      selectedPath: goldSelection.sourceId,
      selectedRegion: goldSelection.cell.key,
      modifierCards: modifierNames,
      modifierCardsVisible: modifierNames.length === 3,
    },
    consoleErrors,
    pageErrors,
  };
}

async function main() {
  const request = options(process.argv.slice(2));
  await mkdir(request.output, { recursive: true });
  const startedAt = new Date().toISOString();
  let service;
  let browser;
  const manifest = {
    name: 'sandrone-restored-ui-smoke',
    purpose: 'legacy UI recovery smoke; this does not assert V4 integration',
    target: request.target,
    status: 'running',
    startedAt,
    output: relative(ROOT, request.output).replaceAll('\\', '/'),
  };
  try {
    service =
      request.target === 'web'
        ? await startWeb(request.port, request.inspectorPort, request.output)
        : await harness.startStaticServer(harness.DESKTOP_ROOT, request.port);
    manifest.service = { url: service.url, pid: service.pid || null };
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 1,
    });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      await page.goto(`${service.url}?editor=v4`, {
        waitUntil: 'domcontentloaded',
      });
      manifest.result = await smoke(page, request.output);
      manifest.status = 'passed';
    } finally {
      await context.close();
    }
  } catch (error) {
    manifest.status = 'failed';
    manifest.error = error instanceof Error ? error.stack : String(error);
    throw error;
  } finally {
    manifest.finishedAt = new Date().toISOString();
    await writeFile(
      resolve(request.output, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    if (browser) await browser.close();
    if (service) await service.close();
  }
  console.log(`PASS: ${request.target} Sandrone restored UI smoke`);
  console.log(`Evidence: ${relative(ROOT, request.output)}`);
}

if (require.main === module)
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });

module.exports = { smoke };
