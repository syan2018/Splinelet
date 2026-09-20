import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import {
  encodeDocument,
  decodeDocument,
} from '../../../src/lib/document/codec.mjs';
import { createReferenceProject } from '../../../src/lib/editor/new-reference-project.mjs';

if (process.platform !== 'win32')
  throw Error('Native WebView2 acceptance requires Windows');

const executable = resolve('src-tauri/target/release/splinelet.exe');
const output = resolve(
  'outputs/v4-qa',
  `native-default-entry-${new Date().toISOString().replaceAll(':', '-')}-${process.pid}`,
);
const port = 9268;
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const powershell = (script) => {
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
        WEBVIEW2_USER_DATA_FOLDER: resolve(output, 'webview-profile'),
      },
    },
  );
  if (result.status !== 0) throw Error(result.stderr || result.stdout);
  return result.stdout.trim();
};
const projectHasPath = (document) =>
  Object.values(document.sketches).some(
    (sketch) => Object.keys(sketch.paths).length === 1,
  );
const assertPoint = (actual, expected) => {
  assert.ok(Math.abs(actual.x - expected.x) < 1e-9);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-9);
};
const projectSources = [
  {
    name: 'sandrone-example.spl',
    source: resolve('public/sandrone-example.spl'),
  },
  {
    name: 'sandrone-gold-emblem.spl',
    source: resolve('output/agent-emblem/sandrone-gold-emblem.spl'),
  },
];
const launch = (path) =>
  Number(
    powershell(
      `$testProcess = Start-Process -FilePath ${quote(executable)} -ArgumentList ${quote('"' + path + '"')} -WindowStyle Hidden -PassThru; $testProcess.Id`,
    ),
  );

assert.equal(
  powershell(
    '@(Get-Process -Name splinelet -ErrorAction SilentlyContinue).Count',
  ),
  '0',
  'Close existing Splinelet before running this isolated process test',
);
await new Promise((ok, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => server.close(ok));
});

await mkdir(output, { recursive: true });
const reference = await readFile(resolve('public/reference.png'));
const first = createReferenceProject({
  bytes: new Uint8Array(reference),
  mediaType: 'image/png',
  name: 'reference.png',
  width: 1200,
  height: 1200,
});
const second = createReferenceProject({
  bytes: new Uint8Array(reference),
  mediaType: 'image/png',
  name: 'second.png',
  width: 1200,
  height: 1200,
});
const firstPath = resolve(output, 'first.spl');
const secondPath = resolve(output, 'second.spl');
await writeFile(
  firstPath,
  encodeDocument(first.document, { assets: first.assets }),
);
await writeFile(
  secondPath,
  encodeDocument(second.document, { assets: second.assets }),
);
const copiedSources = await Promise.all(
  projectSources.map(async ({ name, source }) => {
    const target = resolve(output, name);
    const original = await readFile(source);
    await copyFile(source, target);
    return { name, source, target, original };
  }),
);

let pid;
let browser;
let page;
const checks = [];
try {
  pid = launch(firstPath);
  let endpoint;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      endpoint = await (
        await fetch(`http://127.0.0.1:${port}/json/version`)
      ).json();
      break;
    } catch {
      await delay(250);
    }
  }
  assert(endpoint?.webSocketDebuggerUrl, 'Native WebView2 did not expose CDP');
  browser = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
  for (let attempt = 0; attempt < 40; attempt++) {
    page = browser.contexts().flatMap((context) => context.pages())[0];
    if (page) break;
    await delay(100);
  }
  assert(page, 'Native WebView2 has no page');
  // Playwright's waitForFunction treats a returned Promise as truthy before
  // its boolean result resolves. Poll the awaited API result instead.
  const waitForApi = async (predicate, arg) => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (await page.evaluate(predicate, arg)) return;
      await delay(50);
    }
    throw Error('Native API condition did not become true within 30 seconds');
  };
  const waitForProject = async (name) => {
    await waitForApi(
      (expected) =>
        window.traceStudio
          ?.call('state')
          .then((state) => state.ready && state.storage.fileName === expected),
      name,
    );
    // state.ready belongs to the current image, so no settling sleep or
    // previous document's worker readiness is needed before editing.
  };
  await page.waitForSelector('[role="application"]', { timeout: 30000 });
  await waitForProject('first.spl');
  checks.push('default entry loads the supplied V4 project through the host');

  await page.evaluate(() =>
    window.traceStudio.call('create_path', {
      name: 'native-save-path',
      mode: 'manual',
      snap: false,
      points: [
        { x: 360, y: 360 },
        { x: 520, y: 440 },
      ],
    }),
  );
  await waitForApi(() =>
    window.traceStudio
      .call('get_project')
      .then((project) => project.paths.length === 1),
  );
  await page.keyboard.press('Control+S');
  await page
    .getByText('工程已保存', { exact: true })
    .waitFor({ timeout: 30000 });
  assert(projectHasPath(decodeDocument(await readFile(firstPath)).document));
  checks.push('V4 host saves an edited document through the bound native path');

  launch(secondPath);
  await waitForProject('second.spl');
  launch(firstPath);
  await waitForApi(() =>
    window.traceStudio
      ?.call('get_project')
      .then((project) => project.paths.length === 1),
  );
  checks.push('native open-file events replace and reopen V4 host documents');

  for (const copied of copiedSources) {
    launch(copied.target);
    await waitForProject(copied.name);
    const before = await page.evaluate(() =>
      window.traceStudio.call('get_project'),
    );
    const path = before.paths.find((item) => item.curves.length > 0);
    assert(path, `${copied.name} must expose an editable source path`);
    const originalHandle = path.curves[0][1];
    const editedHandle = {
      x: originalHandle.x + 3,
      y: originalHandle.y + 2,
    };
    await page.evaluate(
      ({ pathId, position }) =>
        window.traceStudio.call('set_point', {
          pathId,
          curve: 0,
          point: 1,
          position,
        }),
      { pathId: path.id, position: editedHandle },
    );
    const afterEdit = await page.evaluate(() =>
      window.traceStudio.call('get_project'),
    );
    assertPoint(
      afterEdit.paths.find((item) => item.id === path.id).curves[0][1],
      editedHandle,
    );
    await page.evaluate(() => window.traceStudio.call('undo'));
    const afterUndo = await page.evaluate(() =>
      window.traceStudio.call('get_project'),
    );
    assertPoint(
      afterUndo.paths.find((item) => item.id === path.id).curves[0][1],
      originalHandle,
    );
    await page.evaluate(
      ({ pathId, position }) =>
        window.traceStudio.call('set_point', {
          pathId,
          curve: 0,
          point: 1,
          position,
        }),
      { pathId: path.id, position: editedHandle },
    );

    const current = await page.evaluate(() => window.traceStudio.call('state'));
    await page.getByRole('button', { name: '导出', exact: true }).click();
    await page
      .getByRole('button', { name: '源曲线 SVG · 精确贝塞尔', exact: true })
      .click();
    await page
      .getByRole('heading', { name: '源曲线导出', exact: true })
      .waitFor({ timeout: 30000 });
    const thickness = page.getByRole('spinbutton', {
      name: '挤出厚度',
      exact: true,
    });
    await thickness.fill(String(current.depthMM + 0.5));
    await thickness.press('Enter');
    await waitForApi(
      (depth) =>
        window.traceStudio
          .call('state')
          .then((state) => state.depthMM === depth),
      current.depthMM + 0.5,
    );
    await page.keyboard.press('Escape');

    const exported = await page.evaluate(() =>
      window.traceStudio.call('export', { format: 'json' }),
    );
    const v4Copy = resolve(
      output,
      copied.name.replace(/\.spl$/, '-edited-v4.spl'),
    );
    await writeFile(v4Copy, Buffer.from(exported.base64, 'base64'));
    const saved = decodeDocument(await readFile(v4Copy)).document;
    assert(projectHasPath(saved));
    launch(v4Copy);
    await waitForProject(v4Copy.split(/[\\/]/).at(-1));
    const reopened = await page.evaluate(() =>
      window.traceStudio.call('get_project'),
    );
    assertPoint(
      reopened.paths.find((item) => item.id === path.id).curves[0][1],
      editedHandle,
    );
    assert.deepEqual(await readFile(copied.source), copied.original);
    checks.push(
      `${copied.name}: edit handle, undo, edit again, change extrusion, export V4 copy, and reopen`,
    );
  }

  await page.screenshot({ path: resolve(output, 'default-entry.png') });
  await writeFile(
    resolve(output, 'manifest.json'),
    JSON.stringify({ status: 'passed', executable, pid, checks }, null, 2),
  );
  console.log(`PASS native default-entry acceptance: ${output}`);
} catch (error) {
  await page
    ?.screenshot({ path: resolve(output, 'failure.png') })
    .catch(() => {});
  await writeFile(
    resolve(output, 'manifest.json'),
    JSON.stringify(
      {
        status: 'failed',
        executable,
        pid,
        checks,
        error: error.stack || String(error),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser?.close().catch(() => {});
  if (pid)
    try {
      process.kill(pid);
    } catch {}
}
