import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw Error(
    '用法：node scripts/examples/add-sandrone-signature.mjs <input.spl> <output.spl>',
  );
if (resolve(input).toLowerCase() === resolve(output).toLowerCase())
  throw Error('请指定不同的输出文件，保留原工程');
const server = await createServer({
  configFile: resolve(root, 'vite.desktop.config.ts'),
  server: { host: '127.0.0.1', port: 0, strictPort: false },
  logLevel: 'error',
});
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1100 },
  });
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.waitForFunction(() => window.traceStudio);
  const call = (action, args = {}) =>
    page.evaluate(({ action, args }) => window.traceStudio.call(action, args), {
      action,
      args,
    });
  const initial = await call('document.get');
  await page
    .locator('input[accept=".spl,.bezier.json,.json"]')
    .setInputFiles(resolve(input));
  await page.waitForFunction(
    async (id) =>
      (await window.traceStudio.call('document.get')).document.id !== id,
    initial.document.id,
  );
  await call('creation_inspect');
  await page
    .locator('.creation-updating')
    .waitFor({ state: 'hidden', timeout: 90000 });
  await page
    .locator('input[accept=".svg,image/svg+xml"]')
    .setInputFiles(
      resolve(root, 'scripts/tests/fixtures/sandrone-signature.svg'),
    );
  await page.getByLabel('导入宽度', { exact: true }).fill('23');
  await page.getByLabel('导入中心 X', { exact: true }).fill('8');
  await page.getByLabel('导入中心 Y', { exact: true }).fill('-29.5');
  await page
    .getByLabel('导入贴附表面', { exact: true })
    .selectOption({ label: '杯子' });
  await page.getByRole('button', { name: '导入为对象组', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const scene = await call('creation_inspect');
  if (scene.errors?.length) throw Error(JSON.stringify(scene.errors));
  await page
    .locator('.creation-updating')
    .waitFor({ state: 'hidden', timeout: 90000 });
  const exported = await call('export', { format: 'json' });
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(resolve(output), Buffer.from(exported.base64, 'base64'));
  await call('creation_view', { view: '3d' });
  await page.getByRole('button', { name: '正视', exact: true }).click();
  await page.waitForTimeout(500);
  await page.screenshot({
    path: resolve(output.replace(/\.spl$/i, '-preview.png')),
  });
  console.log(`Saved ${resolve(output)}`);
} finally {
  await browser?.close();
  await server.close();
}
