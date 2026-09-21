import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import {
  encodeDocument,
  decodeDocument,
} from '../../../src/lib/document/codec.mjs';

if (process.platform !== 'win32')
  throw Error('Native WebView2 acceptance requires Windows');
const executable = resolve('src-tauri/target/release/splinelet.exe');
const output = resolve(
  'outputs/v4-qa',
  `native-${new Date().toISOString().replaceAll(':', '-')}-${process.pid}`,
);
const port = 9267;
await mkdir(output, { recursive: true });
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
// Never send command-line files into a pre-existing single-instance host.
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
const first = createDocument(),
  second = createDocument();
const firstPath = resolve(output, 'first.spl'),
  secondPath = resolve(output, 'second.spl');
await writeFile(firstPath, encodeDocument(first));
await writeFile(secondPath, encodeDocument(second));
const launch = (path) =>
  Number(
    powershell(
      `$testProcess = Start-Process -FilePath ${quote(executable)} -ArgumentList ${quote('"' + path + '"')} -WindowStyle Hidden -PassThru; $testProcess.Id`,
    ),
  );
let pid, browser, page;
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
  assert(
    endpoint?.webSocketDebuggerUrl,
    'Owned WebView2 did not expose its dedicated CDP endpoint',
  );
  browser = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
  for (let attempt = 0; attempt < 40; attempt++) {
    page = browser.contexts().flatMap((context) => context.pages())[0];
    if (page) break;
    await delay(100);
  }
  assert(page, 'Owned native WebView2 has no page');
  await page.waitForURL(
    (url) => ['http:', 'https:', 'tauri:'].includes(url.protocol),
    { timeout: 30000 },
  );
  const url = new URL(page.url());
  url.searchParams.set('editor', 'v4');
  await page.goto(url.href);
  await page.locator('[data-editor-model="v4"]').waitFor();
  await page.waitForFunction(() => window.traceStudioV4?.version === '5.0');
  // The initial host may have consumed its first path before candidate navigation;
  // a real second instance supplies the path through the native event boundary.
  launch(firstPath);
  await page
    .getByRole('button', { name: '打开 first.spl', exact: true })
    .click();
  await page.waitForFunction(
    (id) =>
      window.traceStudioV4
        .call('document.get')
        .then((state) => state.document.id === id),
    first.id,
  );
  checks.push('native second-instance path delivery and permissioned open');
  await page.getByRole('button', { name: '新部件', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('工程已保存', { exact: true }).waitFor();
  const saved = decodeDocument(
    new Uint8Array(await readFile(firstPath)),
  ).document;
  assert.equal(Object.keys(saved.nodes).length, 1);
  checks.push('GUI save uses the native atomic writer and bound V4 path');
  launch(secondPath);
  await page
    .getByRole('button', { name: '打开 second.spl', exact: true })
    .click();
  await page.waitForFunction(
    (id) =>
      window.traceStudioV4
        .call('document.get')
        .then((state) => state.document.id === id),
    second.id,
  );
  launch(firstPath);
  await page
    .getByRole('button', { name: '打开 first.spl', exact: true })
    .click();
  await page.waitForFunction(() =>
    window.traceStudioV4
      .call('document.get')
      .then((state) => Object.keys(state.document.nodes).length === 1),
  );
  checks.push(
    'switch project and reopen preserves V4 document identity and nodes',
  );
  const before = await readFile(firstPath);
  await chmod(firstPath, 0o444);
  await page.getByRole('button', { name: '新部件', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('footer [role="alert"]').waitFor();
  assert.deepEqual(await readFile(firstPath), before);
  checks.push(
    'native failed write reports error and preserves previous file bytes',
  );
  await chmod(firstPath, 0o666);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('工程已保存', { exact: true }).waitFor();
  assert.equal(
    Object.keys(
      decodeDocument(new Uint8Array(await readFile(firstPath))).document.nodes,
    ).length,
    2,
  );
  checks.push('retry after native write failure succeeds');
  await page.screenshot({ path: resolve(output, 'native-files.png') });
  await writeFile(
    resolve(output, 'manifest.json'),
    JSON.stringify(
      {
        status: 'passed',
        executable,
        pid,
        checks,
        profile: resolve(output, 'webview-profile'),
      },
      null,
      2,
    ),
  );
  console.log(`PASS native file acceptance: ${output}`);
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
        url: page?.url(),
        checks,
        error: error.stack || String(error),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await chmod(firstPath, 0o666).catch(() => {});
  await browser?.close().catch(() => {});
  if (pid)
    try {
      process.kill(pid);
    } catch {}
}
