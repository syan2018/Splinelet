import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../browser/harness/browser-runner.cjs');

assert.deepEqual(harness.parseArguments([]), {
  suite: 'legacy',
  target: 'web',
  caseName: null,
  port: harness.DEFAULT_PORT,
  inspectorPort: harness.DEFAULT_INSPECTOR_PORT,
  timeoutMs: harness.DEFAULT_TIMEOUT_MS,
  output: null,
  help: false,
});
assert.deepEqual(
  harness.parseArguments([
    '--suite',
    'legacy',
    '--target',
    'desktop-frontend',
    '--case',
    'saving',
    '--port',
    '48123',
    '--inspector-port',
    '49230',
    '--timeout',
    '1500',
    '--output',
    'outputs/v4-qa/unit-run',
  ]),
  {
    suite: 'legacy',
    target: 'desktop-frontend',
    caseName: 'saving',
    port: 48123,
    inspectorPort: 49230,
    timeoutMs: 1500,
    output: 'outputs/v4-qa/unit-run',
    help: false,
  },
);
assert.throws(() => harness.parseArguments(['--suite', 'other']), /未知 suite/);
assert.throws(() => harness.parseArguments(['--port', '0']), /1–65535/);
assert.throws(
  () =>
    harness.parseArguments(['--port', '48123', '--inspector-port', '48123']),
  /必须不同/,
);
assert.throws(() => harness.parseArguments(['--unknown']), /未知参数/);

const registered = harness.verifyLegacyRegistry();
assert.equal(registered.length, 14);
assert.deepEqual(
  registered.map((entry) => entry.module).sort(),
  harness.discoverLegacyModules().sort(),
);
assert.equal(
  registered.find((entry) => entry.name === 'crown-closures').fixture.path,
  'scripts/tests/fixtures/surface-lineage.json',
);
assert.deepEqual(
  registered.find((entry) => entry.name === 'live-surfaces').fixture,
  { kind: 'spl', path: 'public/sandrone-example.spl', exportName: undefined },
);
assert.equal(
  harness.selectCases({ suite: 'legacy', caseName: 'saving' }).length,
  1,
);
assert.throws(
  () => harness.selectCases({ suite: 'legacy', caseName: 'not-a-case' }),
  /未知或未实施/,
);
assert.throws(
  () => harness.selectCases({ suite: 'v4', caseName: null }),
  /尚未实施/,
);
assert.match(harness.usage(), /--suite legacy\|v4/);
const webArguments = harness.createWebServerArguments(
  48123,
  49230,
  'F:/isolated-run',
);
assert(webArguments.includes('--local'));
assert.equal(webArguments[0], 'dev');
assert.deepEqual(webArguments.slice(-2), [
  '--persist-to',
  resolve('F:/isolated-run', 'wrangler-state'),
]);
assert.equal(
  webArguments[webArguments.indexOf('--inspector-port') + 1],
  '49230',
);
assert.throws(
  () => harness.resolveOutputDirectory('../outside', 'ignored'),
  /outputs\/v4-qa/,
);
const normalizedFixture = harness.normalizeFixtureProject({
  paths: [{ groupId: 'legacy-group' }],
});
assert.equal(normalizedFixture.image, '/reference.png');
assert.deepEqual(normalizedFixture.groups, [
  { id: 'legacy-group', name: '导入分组 1' },
]);
const manifestWithArtifacts = harness.createManifest(
  harness.parseArguments([]),
  'unit-run',
  registered.slice(0, 1),
  resolve('F:/Projects/Splinelet/outputs/v4-qa/unit-run'),
);
assert.match(
  manifestWithArtifacts.buildArtifacts.web.digest.sha256,
  /^[a-f0-9]{64}$/,
);
assert(
  manifestWithArtifacts.buildArtifacts.web.entries.some((entry) =>
    entry.path.includes('model-worker-'),
  ),
  'manifest identifies the built web model worker',
);
assert(
  manifestWithArtifacts.buildArtifacts.desktopFrontend.entries.some(
    (entry) => entry.path === 'index.html',
  ),
  'manifest identifies the built desktop entry',
);

let completed = false;
let closed = false;
let readyWaited = false;
const lifecycleResult = await harness.runCase(
  {
    name: 'lifecycle',
    adapter: 'page',
    test: async () => {
      await Promise.resolve();
      completed = true;
      return { ok: true };
    },
  },
  {
    async newContext() {
      return {
        async newPage() {
          return {
            setDefaultTimeout() {},
            setDefaultNavigationTimeout() {},
            async goto() {},
            async waitForFunction() {
              readyWaited = true;
            },
          };
        },
        async close() {
          assert.equal(
            completed,
            true,
            'context closes after async test settles',
          );
          closed = true;
        },
      };
    },
  },
  'http://127.0.0.1:48179',
  'F:/isolated-run',
  100,
);
assert.deepEqual(lifecycleResult, { ok: true });
assert.equal(closed, true);
assert.equal(readyWaited, true, 'runner waits for the public browser API');

const staticRoot = await mkdtemp(
  resolve(tmpdir(), 'splinelet-browser-harness-'),
);
await writeFile(
  resolve(staticRoot, 'index.html'),
  '<main>desktop fixture</main>',
);
await writeFile(resolve(staticRoot, 'asset.js'), 'export default 1;');
const server = await harness.startStaticServer(staticRoot, 0);
try {
  assert.match(
    await (await fetch(server.url + '/nested/route')).text(),
    /desktop fixture/,
  );
  const asset = await fetch(server.url + '/asset.js');
  assert.equal(
    asset.headers.get('content-type'),
    'text/javascript; charset=utf-8',
  );
  assert.equal(await asset.text(), 'export default 1;');
  assert.equal((await fetch(server.url + '/../secret')).status, 200);
} finally {
  await server.close();
  await rm(staticRoot, { recursive: true, force: true });
}

console.log(
  'PASS: browser runner argument validation, complete legacy registry, V4 rejection, and isolated static server.',
);
